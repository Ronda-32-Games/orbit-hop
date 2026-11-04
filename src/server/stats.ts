/**
 * Informes (mismo criterio que Sum 32, DEC-054): CSV o JSON, sin nombres ni números de Telegram.
 * Cada jugador es un código de 12 letras que no se deshace sin el secreto del servidor.
 *
 *   overview   por día: jugadores, nuevos, partidas Practice y Daily, minutos con la app visible
 *   retention  de los que entraron por primera vez el día X, cuántos volvieron el X+1 y el X+7
 *   funnel     por día: abrieron, primera partida, Practice, Daily empezado/terminado, sin intentos
 *   planets    hasta qué planeta llegan (diseño, Tomi): por modo y tramo de planeta
 *   design     promedios por día y modo: perfectos, saltos, fallos por pared/asteroide, power-ups
 *   sources    de dónde entran (start_param del link)
 *   runs       cada partida, con el jugador en código
 *   players    un renglón por jugador
 *
 * ?from=AAAA-MM-DD&to=AAAA-MM-DD (por defecto, los últimos 90 días). Días en UTC, como el Daily.
 */
import type { Env } from './worker.ts';
import { hmac, toHex } from './crypto.ts';

const MAX_ROWS = 5000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface Query { from: string | null; to: string | null; today: string }
type Row = Record<string, string | number | null>;

function range(q: Query) {
  const back = new Date(Date.parse(`${q.today}T00:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10);
  return { from: q.from && DAY.test(q.from) ? q.from : back, to: q.to && DAY.test(q.to) ? q.to : q.today };
}

const pct = (x: number | null | undefined, n: number | null | undefined) => (x == null || !n ? '' : Math.round((1000 * x) / n) / 10);
const r1 = (x: unknown) => (x == null ? '' : Math.round(Number(x) * 10) / 10);

export async function pseudonym(secret: string, uid: number): Promise<string> {
  return toHex(await hmac(secret, `orbit-hop:player:${uid}`)).slice(0, 12);
}

export function toCsv(rows: Row[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    if (v == null) return '';
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n';
}

async function all<T = Row>(env: Env, sql: string, ...args: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...args).all<T>()).results;
}

async function overview(env: Env, q: Query): Promise<Row[]> {
  const { from, to } = range(q);
  const days = new Map<string, Row & { day: string }>();
  const row = (d: string) => {
    if (!days.has(d)) days.set(d, { day: d, players: 0, new_players: 0, practice_games: 0, daily_games: 0, games: 0, avg_planet: '', best_planet: 0, app_minutes: 0, minutes_per_player: '' });
    return days.get(d)!;
  };
  for (const r of await all<{ day: string; n: number }>(env, `SELECT day, COUNT(*) AS n FROM activity WHERE day BETWEEN ?1 AND ?2 GROUP BY day`, from, to)) row(r.day).players = r.n;
  for (const r of await all<{ day: string; n: number }>(env, `SELECT d0 AS day, COUNT(*) AS n FROM (SELECT user_id, MIN(day) AS d0 FROM activity GROUP BY user_id) WHERE d0 BETWEEN ?1 AND ?2 GROUP BY d0`, from, to)) row(r.day).new_players = r.n;
  for (const r of await all<{ day: string; mode: string; n: number; avg: number; best: number }>(env,
    `SELECT day, mode, COUNT(*) AS n, AVG(planet) AS avg, MAX(planet) AS best FROM runs WHERE status = 'done' AND clean = 1 AND day BETWEEN ?1 AND ?2 GROUP BY day, mode`, from, to)) {
    const d = row(r.day);
    if (r.mode === 'daily') d.daily_games = r.n; else d.practice_games = r.n;
    d.best_planet = Math.max(Number(d.best_planet), r.best);
  }
  for (const r of await all<{ day: string; avg: number }>(env, `SELECT day, AVG(planet) AS avg FROM runs WHERE status = 'done' AND clean = 1 AND day BETWEEN ?1 AND ?2 GROUP BY day`, from, to)) row(r.day).avg_planet = r1(r.avg);
  for (const r of await all<{ day: string; n: number }>(env, `SELECT day, SUM(n) AS n FROM events WHERE event = 'app_seconds' AND day BETWEEN ?1 AND ?2 GROUP BY day`, from, to)) row(r.day).app_minutes = Math.round(r.n / 6) / 10;
  for (const d of days.values()) {
    d.games = Number(d.practice_games) + Number(d.daily_games);
    d.minutes_per_player = d.players ? Math.round((10 * Number(d.app_minutes)) / Number(d.players)) / 10 : '';
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

async function retention(env: Env, q: Query): Promise<Row[]> {
  const { from, to } = range(q);
  const rows = await all<{ cohort_day: string; players: number; d1: number | null; d7: number | null }>(env,
    `SELECT c.d0 AS cohort_day, COUNT(*) AS players,
            CASE WHEN date(c.d0, '+1 day') < ?1 THEN SUM(EXISTS(SELECT 1 FROM activity a WHERE a.user_id = c.user_id AND a.day = date(c.d0, '+1 day'))) END AS d1,
            CASE WHEN date(c.d0, '+7 day') < ?1 THEN SUM(EXISTS(SELECT 1 FROM activity a WHERE a.user_id = c.user_id AND a.day = date(c.d0, '+7 day'))) END AS d7
     FROM (SELECT user_id, MIN(day) AS d0 FROM activity GROUP BY user_id) c
     WHERE c.d0 BETWEEN ?2 AND ?3 GROUP BY c.d0 ORDER BY c.d0`, q.today, from, to);
  return rows.map(r => ({ cohort_day: r.cohort_day, players: r.players, d1_players: r.d1 ?? '', d1_pct: pct(r.d1, r.players), d7_players: r.d7 ?? '', d7_pct: pct(r.d7, r.players) }));
}

async function funnel(env: Env, q: Query): Promise<Row[]> {
  const { from, to } = range(q);
  const days = new Map<string, Row & { day: string }>();
  const row = (d: string) => {
    if (!days.has(d)) days.set(d, { day: d, opened: 0, first_game: 0, practice_players: 0, daily_started: 0, daily_finished: 0, no_attempts: 0 });
    return days.get(d)!;
  };
  for (const r of await all<{ day: string; n: number }>(env, `SELECT day, COUNT(*) AS n FROM activity WHERE day BETWEEN ?1 AND ?2 GROUP BY day`, from, to)) row(r.day).opened = r.n;
  for (const r of await all<{ day: string; n: number }>(env, `SELECT d AS day, COUNT(*) AS n FROM (SELECT user_id, MIN(day) AS d FROM runs WHERE status = 'done' GROUP BY user_id) WHERE d BETWEEN ?1 AND ?2 GROUP BY d`, from, to)) row(r.day).first_game = r.n;
  for (const r of await all<{ day: string; p: number; ds: number; df: number }>(env,
    `SELECT day, COUNT(DISTINCT CASE WHEN mode = 'practice' AND status = 'done' THEN user_id END) AS p,
            COUNT(DISTINCT CASE WHEN mode = 'daily' THEN user_id END) AS ds,
            COUNT(DISTINCT CASE WHEN mode = 'daily' AND status = 'done' THEN user_id END) AS df
     FROM runs WHERE day BETWEEN ?1 AND ?2 GROUP BY day`, from, to)) {
    const d = row(r.day); d.practice_players = r.p; d.daily_started = r.ds; d.daily_finished = r.df;
  }
  for (const r of await all<{ day: string; n: number }>(env, `SELECT day, COUNT(*) AS n FROM events WHERE event = 'no_attempts' AND day BETWEEN ?1 AND ?2 GROUP BY day`, from, to)) row(r.day).no_attempts = r.n;
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Hasta dónde llegan: cantidad de partidas por tramo de planeta (1-4, 5-9, 10-19, 20-29, ...). */
async function planets(env: Env, q: Query): Promise<Row[]> {
  const { from, to } = range(q);
  const rows = await all<{ mode: string; bucket: number; n: number; b: number }>(env,
    `SELECT mode, CASE WHEN planet < 5 THEN 1 WHEN planet < 10 THEN 5 ELSE (planet / 10) * 10 END AS bucket,
            COUNT(*) AS n, SUM(label LIKE '%b') AS b
     FROM runs WHERE status = 'done' AND clean = 1 AND day BETWEEN ?1 AND ?2 GROUP BY mode, bucket ORDER BY mode, bucket`, from, to);
  const tot = new Map<string, number>();
  for (const r of rows) tot.set(r.mode, (tot.get(r.mode) ?? 0) + r.n);
  return rows.map(r => {
    const hi = r.bucket === 1 ? 4 : r.bucket === 5 ? 9 : r.bucket + 9;
    return { mode: r.mode, planets: `${r.bucket}-${hi}`, from_planet: r.bucket, games: r.n, pct: pct(r.n, tot.get(r.mode)), ended_on_b: r.b };
  });
}

/** Lo que mira diseño: promedios por partida, por día y modo. */
async function design(env: Env, q: Query): Promise<Row[]> {
  const { from, to } = range(q);
  const rows = await all<Record<string, number | string>>(env,
    `SELECT day, mode, COUNT(*) AS games, AVG(planet) AS planet, AVG(score) AS score, AVG(taps) AS taps,
            AVG(captures) AS captures, AVG(perfects) AS perfects, AVG(skips) AS skips, AVG(misses) AS misses,
            AVG(miss_wall) AS miss_wall, AVG(miss_ast) AS miss_ast, AVG(powerups) AS powerups,
            AVG(best_streak) AS best_streak, AVG(bonus_s) AS bonus_s, AVG(got32) AS got32,
            AVG(duration_ms) AS duration_ms
     FROM runs WHERE status = 'done' AND clean = 1 AND day BETWEEN ?1 AND ?2 GROUP BY day, mode ORDER BY day, mode`, from, to);
  return rows.map(r => ({
    day: r.day!, mode: r.mode!, games: r.games!, avg_planet: r1(r.planet), avg_score: Math.round(Number(r.score)),
    avg_taps: r1(r.taps), perfect_pct: pct(Number(r.perfects), Number(r.captures)), skip_pct: pct(Number(r.skips), Number(r.captures)),
    avg_misses: r1(r.misses), avg_miss_wall: r1(r.miss_wall), avg_miss_asteroid: r1(r.miss_ast), avg_powerups: r1(r.powerups),
    avg_best_streak: r1(r.best_streak), avg_bonus_s: r1(r.bonus_s), got32_pct: r1(Number(r.got32) * 100),
    avg_round_s: r1(Number(r.duration_ms) / 1000),
  }));
}

async function sources(env: Env, q: Query): Promise<Row[]> {
  const { from, to } = range(q);
  return all<Row>(env, `SELECT day, COALESCE(source, '(none)') AS source, COUNT(*) AS players FROM activity WHERE day BETWEEN ?1 AND ?2 GROUP BY day, source ORDER BY day, players DESC`, from, to);
}

async function runs(env: Env, q: Query): Promise<Row[]> {
  const { from, to } = range(q);
  const rows = await all<Record<string, number | string | null>>(env,
    `SELECT day, started_at, user_id, mode, status, reason, clean, score, planet, label, taps, captures, perfects, skips,
            misses, miss_wall, miss_ast, powerups, best_streak, bonus_s, got32, duration_ms, wall_ms, rules
     FROM runs WHERE day BETWEEN ?1 AND ?2 ORDER BY started_at LIMIT ?3`, from, to, MAX_ROWS);
  const out: Row[] = [];
  for (const r of rows) {
    const { user_id, started_at, ...rest } = r;
    out.push({ day: rest.day!, started_at: new Date(Number(started_at)).toISOString(), player: await pseudonym(env.DAILY_SECRET, Number(user_id)), ...rest });
  }
  return out;
}

async function players(env: Env, _q: Query): Promise<Row[]> {
  const rows = await all<Record<string, number | string | null>>(env,
    `SELECT u.id AS user_id, u.lang AS lang, date(u.created_at / 1000, 'unixepoch') AS first_day, date(u.last_seen / 1000, 'unixepoch') AS last_day,
            (SELECT COUNT(*) FROM activity a WHERE a.user_id = u.id) AS days_active,
            (SELECT source FROM activity a WHERE a.user_id = u.id ORDER BY a.day LIMIT 1) AS first_source,
            (SELECT COUNT(*) FROM runs r WHERE r.user_id = u.id AND r.mode = 'practice' AND r.status = 'done') AS practice_runs,
            (SELECT COUNT(*) FROM runs r WHERE r.user_id = u.id AND r.mode = 'daily') AS daily_runs,
            (SELECT MAX(planet) FROM runs r WHERE r.user_id = u.id AND r.clean = 1) AS best_planet,
            (SELECT MAX(score) FROM runs r WHERE r.user_id = u.id AND r.clean = 1) AS best_score
     FROM users u ORDER BY u.created_at LIMIT ?1`, MAX_ROWS);
  const out: Row[] = [];
  for (const r of rows) {
    const { user_id, ...rest } = r;
    out.push({ player: await pseudonym(env.DAILY_SECRET, Number(user_id)), ...rest, first_source: rest.first_source ?? '', best_planet: rest.best_planet ?? '', best_score: rest.best_score ?? '' });
  }
  return out;
}

export const REPORTS: Record<string, (env: Env, q: Query) => Promise<Row[]>> = {
  overview, retention, funnel, planets, design, sources, runs, players,
};
