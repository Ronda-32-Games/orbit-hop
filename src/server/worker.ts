/**
 * Servidor de Orbit Hop (Cloudflare Workers + D1, DEC-052). Mismo molde que Sum 32 (TASK-063).
 *
 *   GET  /api/health
 *   POST /api/session   { initData }                      → jugador + estado del Daily; cuenta el día activo
 *   POST /api/start     { initData, mode: "daily" }       → { seed, day, token, attemptsLeft }  (gasta un intento)
 *   POST /api/finish    { initData, token, taps, claim }  → rehace la partida y guarda el resultado
 *   POST /api/practice  { initData, seed, taps, claim, wallMs } → guarda una partida de Practice (rehecha)
 *   POST /api/event     { initData, events: { app_seconds, ... } } → lo que avisa el juego
 *   POST /api/me/delete { initData }                      → borra todo lo de quien pide
 *   GET  /api/stats/<informe>.csv|.json   (Authorization: Bearer STATS_TOKEN) → planillas, sin nombres
 *   cron diario: borra según los plazos de DEC-064.
 *
 * Todo pedido del juego lleva initData de Telegram en el cuerpo. El juego manda el cuerpo como
 * text/plain para que el navegador no tenga que preguntar antes (CORS simple), y así también
 * llegan los avisos con keepalive cuando la app se cierra.
 *
 * /finish rehace la partida con src/rules (el mismo código del teléfono) y solo acepta el
 * puntaje si da igual. Además: mismo usuario de Telegram, token de un solo uso (la partida
 * queda cerrada en D1), no menos tiempo real que el de la partida, token de 30 min como mucho.
 */
import { compareResults, RULES, RULES_VERSION, type Result, validate } from '../rules/index.ts';
import type { D1, D1Stmt } from './d1.ts';
import { REPORTS, toCsv } from './stats.ts';
import { type TgUser, verifyInitData } from './telegram.ts';
import { dailySeed, readTicket, signTicket, utcDay } from './token.ts';

export interface Env {
  BOT_TOKEN: string;
  TOKEN_SECRET: string;
  DAILY_SECRET: string;
  /** para leer /api/stats; sin él, los informes no existen */
  STATS_TOKEN?: string;
  /** p. ej. https://ronda-32-games.github.io (puede ser una lista separada por comas) */
  ALLOWED_ORIGIN: string;
  /** "true" guarda actividad y eventos (privacy.html publicada) */
  EVENTS_ENABLED?: string;
  DB: D1;
}

/** Hora actual inyectable para las pruebas. */
export interface Deps { now: () => number }

export const MAX_TICKET_AGE_MS = 30 * 60 * 1000;
/** margen por red y redondeos al chequear la duración mínima */
export const DURATION_SLACK_MS = 1500;
/** DEC-052: en v1 el Daily da 3 intentos gratis y ningún reintento. */
export const DAILY_ATTEMPTS = 3;
/** tope de partidas de Practice guardadas por jugador y día (cuida las escrituras de D1) */
export const PRACTICE_MAX_PER_DAY = 200;
const MAX_BODY = 32 * 1024;
const DAY_MS = 86400000;
/** Tablas con datos de una persona. Si se agrega una con user_id y no está acá, falla una prueba. */
export const USER_TABLES = ['runs', 'daily_best', 'activity', 'events'] as const;
/** Lo que el juego puede avisar y el máximo por pedido (manda cada 60 s como mucho). */
export const REPORTED: Record<string, number> = { app_seconds: 900, practice_start: 30, pause: 60 };

class HttpError extends Error {
  constructor(readonly status: number, readonly reason: string) { super(reason); }
}

const eventsOn = (env: Env) => String(env.EVENTS_ENABLED) === 'true';

function displayName(u: TgUser): string {
  const ln = u.last_name;
  return (`${u.first_name || 'Player'}${ln ? ` ${ln[0]}.` : ''}`).slice(0, 24);
}

/** start_param de Telegram, sin datos personales: solo letras, números y _ hasta 32. */
function cleanSource(sp: string | null): string | null {
  if (!sp) return null;
  const t = sp.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return t || null;
}

// ---- base -----------------------------------------------------------------

async function upsertUser(env: Env, u: TgUser, now: number) {
  await env.DB.prepare(
    `INSERT INTO users (id, name, lang, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(id) DO UPDATE SET name = ?2, lang = ?3, last_seen = ?4`,
  ).bind(u.id, displayName(u), (u.language_code ?? '').slice(0, 8) || null, now).run();
}

async function markActive(env: Env, uid: number, now: number, source: string | null = null) {
  if (!eventsOn(env)) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO activity (user_id, day, source) VALUES (?1, ?2, ?3)`)
    .bind(uid, utcDay(now), source).run();
}

function bumpStmt(env: Env, uid: number, event: string, now: number, source = 'server', n = 1): D1Stmt {
  return env.DB.prepare(
    `INSERT INTO events (user_id, day, event, n, first_at, last_at, source) VALUES (?1, ?2, ?3, ?6, ?4, ?4, ?5)
     ON CONFLICT(user_id, day, event) DO UPDATE SET n = n + ?6, last_at = ?4`,
  ).bind(uid, utcDay(now), event, now, source, n);
}

async function bump(env: Env, uid: number, event: string, now: number, source = 'server', n = 1) {
  if (eventsOn(env)) await bumpStmt(env, uid, event, now, source, n).run();
}

export interface DailyState { day: string; attemptsAllowed: number; attemptsUsed: number; attemptsLeft: number; best: { planet: number; score: number; label: string | null } | null; rank: number | null; players: number; resetsInMs: number }

async function dailyState(env: Env, uid: number, now: number): Promise<DailyState> {
  const day = utcDay(now);
  const used = Number(await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs WHERE user_id = ?1 AND day = ?2 AND mode = 'daily'`).bind(uid, day).first('n') ?? 0);
  const best = await env.DB.prepare(`SELECT planet, score, label, at FROM daily_best WHERE day = ?1 AND user_id = ?2`).bind(day, uid).first<{ planet: number; score: number; label: string | null; at: number }>();
  const players = Number(await env.DB.prepare(`SELECT COUNT(*) AS n FROM daily_best WHERE day = ?1`).bind(day).first('n') ?? 0);
  let rank: number | null = null;
  if (best) {
    const ahead = Number(await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM daily_best WHERE day = ?1 AND (planet > ?2 OR (planet = ?2 AND (score > ?3 OR (score = ?3 AND at < ?4))))`,
    ).bind(day, best.planet, best.score, best.at).first('n') ?? 0);
    rank = ahead + 1;
  }
  return {
    day, attemptsAllowed: DAILY_ATTEMPTS, attemptsUsed: used, attemptsLeft: Math.max(0, DAILY_ATTEMPTS - used),
    best: best ? { planet: best.planet, score: best.score, label: best.label } : null, rank, players,
    resetsInMs: Date.parse(`${day}T00:00:00Z`) + DAY_MS - now,
  };
}

function runColumns(r: Result) {
  return [r.score, r.planet, r.label, r.taps, r.captures, r.perfects, r.skips, r.misses, r.missWall, r.missAst,
    r.powerups, r.bestStreak, r.bonusS, r.got32 ? 1 : 0, Math.round((r.ticks / RULES.tickHz) * 1000)];
}
const RUN_SET = `score = ?3, planet = ?4, label = ?5, taps = ?6, captures = ?7, perfects = ?8, skips = ?9, misses = ?10,
  miss_wall = ?11, miss_ast = ?12, powerups = ?13, best_streak = ?14, bonus_s = ?15, got32 = ?16, duration_ms = ?17`;

// ---- rutas ----------------------------------------------------------------

async function session(env: Env, u: TgUser, startParam: string | null, now: number) {
  await upsertUser(env, u, now);
  await markActive(env, u.id, now, cleanSource(startParam));
  await bump(env, u.id, 'opened', now);
  return { ok: true, user: { name: displayName(u) }, daily: await dailyState(env, u.id, now), rulesVersion: RULES_VERSION };
}

async function startDaily(env: Env, u: TgUser, now: number) {
  await upsertUser(env, u, now);
  await markActive(env, u.id, now);
  const st = await dailyState(env, u.id, now);
  if (st.attemptsLeft <= 0) {
    await bump(env, u.id, 'no_attempts', now);
    throw new HttpError(403, 'no_attempts');
  }
  const seed = await dailySeed(st.day, env.DAILY_SECRET);
  const id = crypto.randomUUID();
  const stmts = [
    // Una partida abierta que se dejó sin terminar queda como abandonada (y gastó su intento).
    env.DB.prepare(`UPDATE runs SET status = 'abandoned', updated_at = ?2 WHERE user_id = ?1 AND mode = 'daily' AND status = 'open'`).bind(u.id, now),
    env.DB.prepare(`INSERT INTO runs (id, user_id, mode, day, seed, rules, started_at, status, updated_at) VALUES (?1, ?2, 'daily', ?3, ?4, ?5, ?6, 'open', ?6)`)
      .bind(id, u.id, st.day, seed, RULES_VERSION, now),
  ];
  if (eventsOn(env)) stmts.push(bumpStmt(env, u.id, 'daily_start', now));
  await env.DB.batch(stmts);
  const token = await signTicket({ uid: u.id, mode: 'daily', day: st.day, seed, rules: RULES_VERSION, iat: now, nonce: id }, env.TOKEN_SECRET);
  return { ok: true, seed, day: st.day, token, rulesVersion: RULES_VERSION, attemptsLeft: st.attemptsLeft - 1 };
}

async function finishDaily(env: Env, u: TgUser, body: Record<string, unknown>, now: number) {
  const t = await readTicket(String(body.token ?? ''), env.TOKEN_SECRET);
  if (!t) throw new HttpError(400, 'bad_token');
  if (t.uid !== u.id) throw new HttpError(403, 'wrong_user');
  if (t.rules !== RULES_VERSION) throw new HttpError(409, 'old_rules');
  if (now - t.iat > MAX_TICKET_AGE_MS) throw new HttpError(400, 'token_expired');
  const run = await env.DB.prepare(`SELECT status FROM runs WHERE id = ?1 AND user_id = ?2`).bind(t.nonce, u.id).first<{ status: string }>();
  if (!run) throw new HttpError(404, 'no_run');
  if (run.status !== 'open') throw new HttpError(409, 'token_used');

  const reject = async (status: number, reason: string, r?: Result) => {
    await env.DB.prepare(`UPDATE runs SET status = 'rejected', reason = ?2, wall_ms = ?3, updated_at = ?4 WHERE id = ?1`)
      .bind(t.nonce, reason, now - t.iat, now).run();
    if (r) await bump(env, u.id, 'daily_rejected', now);
    throw new HttpError(status, reason);
  };

  const claim = body.claim as { score: number; planet: number; checksum?: number } | undefined;
  if (!claim || typeof claim.score !== 'number' || typeof claim.planet !== 'number') return reject(400, 'bad_claim');
  const out = validate({ seed: t.seed, taps: body.taps }, claim, RULES);
  if (!out.ok) return reject(422, out.reason, out.result);
  const minMs = (out.result.ticks / RULES.tickHz) * 1000 - DURATION_SLACK_MS;
  if (now - t.iat < minMs) return reject(422, 'too_fast', out.result);

  const r = out.result;
  const stmts: D1Stmt[] = [
    env.DB.prepare(`UPDATE runs SET status = 'done', clean = 1, wall_ms = ?18, updated_at = ?19, ${RUN_SET} WHERE id = ?1 AND user_id = ?2`)
      .bind(t.nonce, u.id, ...runColumns(r), now - t.iat, now),
  ];
  const prev = await env.DB.prepare(`SELECT planet, score FROM daily_best WHERE day = ?1 AND user_id = ?2`).bind(t.day, u.id).first<{ planet: number; score: number }>();
  const improved = !prev || compareResults(r, prev) < 0;
  if (improved) {
    stmts.push(env.DB.prepare(
      `INSERT INTO daily_best (day, user_id, planet, score, label, run_id, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(day, user_id) DO UPDATE SET planet = ?3, score = ?4, label = ?5, run_id = ?6, at = ?7`,
    ).bind(t.day, u.id, r.planet, r.score, r.label, t.nonce, now));
  }
  if (eventsOn(env)) stmts.push(bumpStmt(env, u.id, 'daily_finish', now));
  await env.DB.batch(stmts);
  const st = await dailyState(env, u.id, now);
  if (st.attemptsLeft === 0) await bump(env, u.id, 'no_attempts', now);
  return { ok: true, result: r, checksumMatch: out.checksumMatch, day: t.day, improved, daily: st };
}

async function practice(env: Env, u: TgUser, body: Record<string, unknown>, now: number) {
  const day = utcDay(now);
  const count = Number(await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs WHERE user_id = ?1 AND day = ?2 AND mode = 'practice'`).bind(u.id, day).first('n') ?? 0);
  if (count >= PRACTICE_MAX_PER_DAY) return { ok: true, saved: false };
  const claim = body.claim as { score: number; planet: number; checksum?: number } | undefined;
  const out = validate({ seed: body.seed, taps: body.taps }, claim, RULES);
  const wall = Math.max(0, Math.min(3600_000, Math.floor(Number(body.wallMs) || 0)));
  const id = crypto.randomUUID();
  const seed = typeof body.seed === 'number' && Number.isInteger(body.seed) ? (body.seed >>> 0) : 0;
  const stmts: D1Stmt[] = [];
  if (out.ok || out.result) {
    const r = out.ok ? out.result : out.result!;
    stmts.push(env.DB.prepare(
      `INSERT INTO runs (id, user_id, mode, day, seed, rules, started_at, status, reason, clean, wall_ms, updated_at,
         score, planet, label, taps, captures, perfects, skips, misses, miss_wall, miss_ast, powerups, best_streak, bonus_s, got32, duration_ms)
       VALUES (?1, ?2, 'practice', ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
    ).bind(id, u.id, ...runColumns(r), day, seed, RULES_VERSION, now - wall, out.ok ? 'done' : 'rejected',
      out.ok ? null : out.reason, out.ok ? 1 : 0, wall, now));
  } else {
    stmts.push(env.DB.prepare(
      `INSERT INTO runs (id, user_id, mode, day, seed, rules, started_at, status, reason, wall_ms, updated_at)
       VALUES (?1, ?2, 'practice', ?3, ?4, ?5, ?6, 'rejected', ?7, ?8, ?9)`,
    ).bind(id, u.id, day, seed, RULES_VERSION, now - wall, out.reason, wall, now));
  }
  await upsertUser(env, u, now);
  await markActive(env, u.id, now);
  await env.DB.batch(stmts);
  return { ok: true, saved: true, clean: out.ok };
}

async function report(env: Env, u: TgUser, body: Record<string, unknown>, now: number) {
  if (!eventsOn(env)) return { ok: true, saved: false };
  const ev = body.events && typeof body.events === 'object' ? body.events as Record<string, unknown> : {};
  const stmts: D1Stmt[] = [];
  for (const [k, max] of Object.entries(REPORTED)) {
    const n = Math.min(max, Math.floor(Number(ev[k]) || 0));
    if (n > 0) stmts.push(bumpStmt(env, u.id, k, now, 'reported', n));
  }
  if (!stmts.length) throw new HttpError(400, 'no_events');
  await markActive(env, u.id, now);
  await env.DB.batch(stmts);
  return { ok: true, saved: true };
}

async function deleteMe(env: Env, uid: number) {
  await env.DB.batch([
    ...USER_TABLES.map(t => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?1`).bind(uid)),
    env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(uid),
  ]);
  return { ok: true, deleted: true };
}

/** Plazos de DEC-064: partidas 30 días; actividad, eventos y mejores 12 meses; jugador sin entrar 12 meses, todo. */
export async function purge(env: Env, now: number) {
  const d30 = utcDay(now - 30 * DAY_MS), y1 = utcDay(now - 365 * DAY_MS), y1ms = now - 365 * DAY_MS;
  const gone = (await env.DB.prepare(`SELECT id FROM users WHERE last_seen < ?1`).bind(y1ms).all<{ id: number }>()).results;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM runs WHERE day < ?1`).bind(d30),
    env.DB.prepare(`DELETE FROM activity WHERE day < ?1`).bind(y1),
    env.DB.prepare(`DELETE FROM events WHERE day < ?1`).bind(y1),
    env.DB.prepare(`DELETE FROM daily_best WHERE day < ?1`).bind(y1),
  ]);
  for (const g of gone) await deleteMe(env, g.id);
  return { users: gone.length };
}

async function stats(req: Request, env: Env, url: URL, path: string, now: number): Promise<Response | object> {
  const m = /^\/api\/stats\/([a-z_]+)\.(csv|json)$/.exec(path);
  if (!env.STATS_TOKEN || !m || !REPORTS[m[1]!]) throw new HttpError(404, 'not_found');
  const given = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  if (given.length !== env.STATS_TOKEN.length || given !== env.STATS_TOKEN) throw new HttpError(401, 'bad_token');
  const rows = await REPORTS[m[1]!]!(env, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), today: utcDay(now) });
  if (m[2] === 'json') return { ok: true, rows };
  return new Response(toCsv(rows), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="orbit-hop-${m[1]}-${utcDay(now)}.csv"` } });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_big');
  try {
    const b = JSON.parse(text || '{}');
    return b && typeof b === 'object' ? b as Record<string, unknown> : {};
  } catch { throw new HttpError(400, 'bad_json'); }
}

async function route(req: Request, env: Env, now: number): Promise<Response | object> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'GET' && path === '/api/health') return { ok: true, day: utcDay(now), rulesVersion: RULES_VERSION };
  if (req.method === 'GET' && path.startsWith('/api/stats/')) return stats(req, env, url, path, now);
  if (req.method !== 'POST') throw new HttpError(405, 'method');

  const body = await readBody(req);
  const initData = String(body.initData ?? '');
  const tg = await verifyInitData(initData, env.BOT_TOKEN, Math.floor(now / 1000));
  if (!tg.ok) throw new HttpError(401, `telegram_${tg.reason}`);
  const u = tg.user;
  const startParam = new URLSearchParams(initData).get('start_param');

  switch (path) {
    case '/api/session': return session(env, u, startParam, now);
    case '/api/start':
      if (body.mode !== 'daily') throw new HttpError(400, 'bad_mode');
      return startDaily(env, u, now);
    case '/api/finish': return finishDaily(env, u, body, now);
    case '/api/practice': return practice(env, u, body, now);
    case '/api/event': return report(env, u, body, now);
    case '/api/me/delete': return deleteMe(env, u.id);
  }
  throw new HttpError(404, 'not_found');
}

function corsFor(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export async function handle(req: Request, env: Env, deps: Deps = { now: () => Date.now() }): Promise<Response> {
  const cors = corsFor(req, env);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const out = await route(req, env, deps.now());
    if (out instanceof Response) {
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    }
    return json(out);
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, reason: e.reason }, e.status);
    console.error(e);
    return json({ ok: false, reason: 'server' }, 500);
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
  async scheduled(_ev: unknown, env: Env): Promise<void> {
    await purge(env, Date.now());
  },
};
