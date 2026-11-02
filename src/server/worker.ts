/**
 * Servidor de Orbit Hop (Cloudflare Workers, DEC-052).
 *
 *   POST /api/start   { initData, mode: "daily" }
 *        → { seed, day, token, rulesVersion }
 *   POST /api/finish  { initData, token, taps, claim: { score, planet, checksum } }
 *        → { ok: true, result } | { ok: false, reason }
 *
 * /finish rehace la partida con src/rules (el mismo código del teléfono) y
 * solo acepta el puntaje si da igual. Además controla:
 *   - que el usuario de Telegram sea el mismo que pidió la semilla;
 *   - que no haya pasado menos tiempo real que el que dura la partida
 *     (la pausa en segundo plano solo puede sumar tiempo, nunca restar);
 *   - que el token no tenga más de 30 minutos.
 * Falta (con D1): marcar el token como usado, contar intentos del Daily
 * (DEC-052: 3 gratis) y guardar el ranking.
 */
import { RULES, RULES_VERSION, validate } from '../rules/index.ts';
import { verifyInitData } from './telegram.ts';
import { dailySeed, readTicket, signTicket, utcDay } from './token.ts';

export interface Env {
  BOT_TOKEN: string;
  TOKEN_SECRET: string;
  DAILY_SECRET: string;
  /** p. ej. https://ronda-32-games.github.io */
  ALLOWED_ORIGIN: string;
}

/** Hora actual inyectable para las pruebas. */
export interface Deps { now: () => number }

export const MAX_TICKET_AGE_MS = 30 * 60 * 1000;
/** margen por red y redondeos al chequear la duración mínima */
export const DURATION_SLACK_MS = 1500;

export async function handle(req: Request, env: Env, deps: Deps = { now: () => Date.now() }): Promise<Response> {
  const cors = {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const path = new URL(req.url).pathname;
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return json({ ok: false, reason: 'bad_json' }, 400); }

  const now = deps.now();
  const tg = await verifyInitData(String(body.initData ?? ''), env.BOT_TOKEN, Math.floor(now / 1000));
  if (!tg.ok) return json({ ok: false, reason: `telegram_${tg.reason}` }, 401);

  if (path === '/api/start') {
    if (body.mode !== 'daily') return json({ ok: false, reason: 'bad_mode' }, 400);
    const day = utcDay(now);
    const seed = await dailySeed(day, env.DAILY_SECRET);
    const token = await signTicket({
      uid: tg.user.id, mode: 'daily', day, seed, rules: RULES_VERSION, iat: now, nonce: crypto.randomUUID(),
    }, env.TOKEN_SECRET);
    return json({ ok: true, seed, day, token, rulesVersion: RULES_VERSION });
  }

  if (path === '/api/finish') {
    const t = await readTicket(String(body.token ?? ''), env.TOKEN_SECRET);
    if (!t) return json({ ok: false, reason: 'bad_token' }, 400);
    if (t.uid !== tg.user.id) return json({ ok: false, reason: 'wrong_user' }, 403);
    if (t.rules !== RULES_VERSION) return json({ ok: false, reason: 'old_rules' }, 409);
    if (now - t.iat > MAX_TICKET_AGE_MS) return json({ ok: false, reason: 'token_expired' }, 400);

    const claim = body.claim as { score: number; planet: number; checksum?: number } | undefined;
    if (!claim || typeof claim.score !== 'number' || typeof claim.planet !== 'number') {
      return json({ ok: false, reason: 'bad_claim' }, 400);
    }
    const out = validate({ seed: t.seed, taps: body.taps }, claim, RULES);
    if (!out.ok) return json({ ok: false, reason: out.reason }, 422);

    const minMs = (out.result.ticks / RULES.tickHz) * 1000 - DURATION_SLACK_MS;
    if (now - t.iat < minMs) return json({ ok: false, reason: 'too_fast' }, 422);

    // TODO(D1): marcar t.nonce usado, contar intento del día, guardar mejor resultado.
    return json({ ok: true, result: out.result, checksumMatch: out.checksumMatch, day: t.day });
  }

  return json({ ok: false, reason: 'not_found' }, 404);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};
