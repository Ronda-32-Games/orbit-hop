import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_ATTEMPTS, handle, purge, USER_TABLES, type Env } from '../src/server/worker.ts';
import { signInitDataForTest } from '../src/server/telegram.ts';
import { replay } from '../src/rules/index.ts';
import { playBot } from '../tools/bot.ts';
import { makeD1 } from './d1.ts';

const T0 = Date.UTC(2026, 10, 1, 15, 0, 0);
const DAY = 86400000;
const ORIGIN = 'https://ronda-32-games.github.io';

function makeEnv(over: Partial<Env> = {}): Env & { DB: ReturnType<typeof makeD1> } {
  return {
    BOT_TOKEN: '123456:TEST-TOKEN', TOKEN_SECRET: 'token-secret-test', DAILY_SECRET: 'daily-secret-test',
    STATS_TOKEN: 'stats-test', ALLOWED_ORIGIN: ORIGIN, EVENTS_ENABLED: 'true', DB: makeD1(), ...over,
  } as Env & { DB: ReturnType<typeof makeD1> };
}

async function initData(uid: number, nowMs: number, token = '123456:TEST-TOKEN', extra: Record<string, string> = {}) {
  return signInitDataForTest({
    auth_date: String(Math.floor(nowMs / 1000)), query_id: 'AAH-test',
    user: JSON.stringify({ id: uid, first_name: 'Nacho', last_name: 'Rud', language_code: 'es' }), ...extra,
  }, token);
}

function mk(env: Env) {
  const call = async (path: string, body: Record<string, unknown>, nowMs: number, uid = 10) => {
    const req = new Request(`https://api.example.dev${path}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: ORIGIN },
      body: JSON.stringify({ initData: await initData(uid, nowMs), ...body }),
    });
    const res = await handle(req, env, { now: () => nowMs });
    return { status: res.status, data: await res.json() as any, res };
  };
  const get = async (path: string, nowMs: number, auth?: string) => {
    const req = new Request(`https://api.example.dev${path}`, { headers: { Origin: ORIGIN, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) } });
    const res = await handle(req, env, { now: () => nowMs });
    return { status: res.status, text: await res.text(), res };
  };
  const playDaily = async (uid = 10, now = T0, rngSeed = 9) => {
    const s = await call('/api/start', { mode: 'daily' }, now, uid);
    assert.equal(s.status, 200, JSON.stringify(s.data));
    const taps = playBot(s.data.seed, { skill: 0.7, greed: 0.2, panic: 0, rngSeed });
    const r = replay({ seed: s.data.seed, taps });
    assert.ok(r.ok);
    const end = now + (r.result.ticks / 60) * 1000 + 800;
    const f = await call('/api/finish', { token: s.data.token, taps, claim: { score: r.result.score, planet: r.result.planet, checksum: r.result.checksum } }, end, uid);
    return { s, f, r, taps, end };
  };
  return { call, get, playDaily };
}

test('Daily: todos reciben la misma semilla ese día; otro día cambia', async () => {
  const env = makeEnv(), { call } = mk(env);
  const a = await call('/api/start', { mode: 'daily' }, T0, 10), b = await call('/api/start', { mode: 'daily' }, T0, 11);
  assert.equal(a.data.seed, b.data.seed);
  assert.equal(a.data.day, '2026-11-01');
  const c = await call('/api/start', { mode: 'daily' }, T0 + DAY, 10);
  assert.notEqual(c.data.seed, a.data.seed);
});

test('partida completa aceptada, guardada y con ranking', async () => {
  const env = makeEnv(), { playDaily } = mk(env);
  const { f, r } = await playDaily();
  assert.equal(f.status, 200, JSON.stringify(f.data));
  assert.equal(f.data.result.score, r.result.score);
  assert.equal(f.data.checksumMatch, true);
  assert.equal(f.data.daily.rank, 1);
  assert.equal(f.data.daily.attemptsLeft, DAILY_ATTEMPTS - 1);
  const row = env.DB.raw.prepare(`SELECT * FROM runs`).get() as any;
  assert.equal(row.status, 'done');
  assert.equal(row.clean, 1);
  assert.equal(row.planet, r.result.planet);
  assert.equal(row.skips, r.result.skips);
});

test('token de un solo uso', async () => {
  const env = makeEnv(), { call, playDaily } = mk(env);
  const { s, taps, r, end } = await playDaily();
  const again = await call('/api/finish', { token: s.data.token, taps, claim: { score: r.result.score, planet: r.result.planet } }, end + 1000);
  assert.equal(again.data.reason, 'token_used');
});

test(`Daily: ${DAILY_ATTEMPTS} intentos por día (DEC-052) y aviso no_attempts`, async () => {
  const env = makeEnv(), { call, playDaily } = mk(env);
  for (let i = 0; i < DAILY_ATTEMPTS; i++) await playDaily(10, T0 + i * 120000, i + 1);
  const st = await call('/api/start', { mode: 'daily' }, T0 + 400000);
  assert.equal(st.status, 403);
  assert.equal(st.data.reason, 'no_attempts');
  const ev = env.DB.raw.prepare(`SELECT n FROM events WHERE event = 'no_attempts'`).get() as any;
  assert.ok(ev.n >= 1);
  const next = await call('/api/start', { mode: 'daily' }, T0 + DAY);
  assert.equal(next.status, 200);
});

test('trampas rechazadas por el servidor', async () => {
  const env = makeEnv(), { call } = mk(env);
  const fresh = async () => {
    const s = await call('/api/start', { mode: 'daily' }, T0, 20);
    const taps = playBot(s.data.seed, { skill: 0.7, greed: 0.2, panic: 0, rngSeed: 9 });
    const r = replay({ seed: s.data.seed, taps });
    assert.ok(r.ok);
    return { token: s.data.token, taps, claim: { score: r.result.score, planet: r.result.planet } };
  };
  const end = T0 + 70000;
  let g = await fresh();
  assert.equal((await call('/api/finish', { ...g, claim: { ...g.claim, score: g.claim.score * 2 } }, end, 20)).data.reason, 'claim_mismatch');
  g = await fresh();
  assert.equal((await call('/api/finish', g, end, 99)).data.reason, 'wrong_user');
  assert.equal((await call('/api/finish', { ...g, token: g.token.slice(0, -2) + '00' }, end, 20)).data.reason, 'bad_token');
  assert.equal((await call('/api/finish', g, T0 + 20000, 20)).data.reason, 'too_fast');
  const e2 = makeEnv(), m2 = mk(e2);
  const s = await m2.call('/api/start', { mode: 'daily' }, T0, 20);
  assert.equal((await m2.call('/api/finish', { token: s.data.token, taps: [], claim: { score: 0, planet: 1 } }, T0 + 31 * 60000, 20)).data.reason, 'token_expired');
  const req = new Request('https://api.example.dev/api/session', { method: 'POST', body: JSON.stringify({ initData: await initData(10, T0, '999:OTRO') }) });
  const bad = await handle(req, env, { now: () => T0 });
  assert.equal(((await bad.json()) as any).reason, 'telegram_bad_hash');
});

test('sesión: cuenta el día activo una vez, con la fuente del link', async () => {
  const env = makeEnv(), { call } = mk(env);
  const req = async (now: number) => handle(new Request('https://api.example.dev/api/session', {
    method: 'POST', body: JSON.stringify({ initData: await initData(10, now, undefined, { start_param: 'post003' }) }),
  }), env, { now: () => now });
  const r = await (await req(T0)).json() as any;
  assert.equal(r.ok, true);
  assert.equal(r.daily.attemptsLeft, DAILY_ATTEMPTS);
  await req(T0 + 1000);
  const rows = env.DB.raw.prepare(`SELECT * FROM activity`).all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'post003');
  assert.equal((env.DB.raw.prepare(`SELECT n FROM events WHERE event = 'opened'`).get() as any).n, 2);
  const u = env.DB.raw.prepare(`SELECT * FROM users`).get() as any;
  assert.equal(u.name, 'Nacho R.');
  assert.ok(!('username' in u));
  void call;
});

test('Practice: se guarda rehecha; un puntaje inventado queda marcado', async () => {
  const env = makeEnv(), { call } = mk(env);
  const seed = 4242;
  const taps = playBot(seed, { skill: 0.6, greed: 0.3, panic: 0, rngSeed: 4 });
  const r = replay({ seed, taps });
  assert.ok(r.ok);
  const ok = await call('/api/practice', { seed, taps, claim: { score: r.result.score, planet: r.result.planet }, wallMs: 61000 }, T0);
  assert.deepEqual(ok.data, { ok: true, saved: true, clean: true });
  const bad = await call('/api/practice', { seed, taps, claim: { score: 999999, planet: r.result.planet }, wallMs: 61000 }, T0);
  assert.equal(bad.data.clean, false);
  const rows = env.DB.raw.prepare(`SELECT status, clean, reason, planet FROM runs ORDER BY clean DESC`).all() as any[];
  assert.equal(rows[0].clean, 1);
  assert.equal(rows[0].planet, r.result.planet);
  assert.equal(rows[1].reason, 'claim_mismatch');
  const junk = await call('/api/practice', { seed: 'x', taps: 'y' }, T0);
  assert.equal(junk.data.clean, false);
});

test('eventos que avisa el juego, con tope; apagados no guardan nada', async () => {
  const env = makeEnv(), { call } = mk(env);
  await call('/api/event', { events: { app_seconds: 99999, practice_start: 2, inventado: 5 } }, T0);
  const rows = env.DB.raw.prepare(`SELECT event, n, source FROM events ORDER BY event`).all() as any[];
  assert.deepEqual(rows.map(r => [r.event, r.n, r.source]), [['app_seconds', 900, 'reported'], ['practice_start', 2, 'reported']]);
  const off = makeEnv({ EVENTS_ENABLED: 'false' }), m = mk(off);
  assert.equal((await m.call('/api/event', { events: { app_seconds: 30 } }, T0)).data.saved, false);
  await m.call('/api/session', {}, T0);
  assert.equal((off.DB.raw.prepare(`SELECT COUNT(*) AS n FROM activity`).get() as any).n, 0);
});

test('borrar mis datos recorre todas las tablas con user_id', async () => {
  const env = makeEnv(), { call, playDaily } = mk(env);
  await call('/api/session', {}, T0);
  await call('/api/event', { events: { app_seconds: 30 } }, T0);
  await playDaily();
  await playDaily(11);
  const tables = (env.DB.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as any[]).map(r => r.name);
  for (const t of tables) {
    const cols = (env.DB.raw.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
    if (cols.includes('user_id')) assert.ok((USER_TABLES as readonly string[]).includes(t), `${t} tiene user_id y no está en USER_TABLES`);
  }
  const d = await call('/api/me/delete', {}, T0 + 100000);
  assert.equal(d.data.deleted, true);
  for (const t of USER_TABLES) assert.equal((env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = 10`).get() as any).n, 0, t);
  assert.equal((env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM users WHERE id = 10`).get() as any).n, 0);
  assert.ok((env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM runs WHERE user_id = 11`).get() as any).n > 0);
});

test('purga diaria: partidas a los 30 días, jugador a los 12 meses sin entrar (DEC-064)', async () => {
  const env = makeEnv(), { call, playDaily } = mk(env);
  await call('/api/session', {}, T0);
  await playDaily();
  await call('/api/session', {}, T0 + 40 * DAY, 11);
  await purge(env, T0 + 31 * DAY);
  assert.equal((env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM runs`).get() as any).n, 0);
  assert.equal((env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM activity WHERE user_id = 10`).get() as any).n, 1);
  await purge(env, T0 + 366 * DAY);
  assert.equal((env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM users WHERE id = 10`).get() as any).n, 0);
  assert.equal((env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM users WHERE id = 11`).get() as any).n, 1);
});

test('informes: con token, sin nombres; sin token no', async () => {
  const env = makeEnv(), { call, get, playDaily } = mk(env);
  for (const uid of [10, 11, 12]) await call('/api/session', {}, T0, uid);
  await call('/api/session', {}, T0 + DAY, 10);
  await playDaily(10);
  const seed = 7, taps = playBot(seed, { skill: 0.6, greed: 0.3, panic: 0, rngSeed: 4 }), r = replay({ seed, taps });
  assert.ok(r.ok);
  await call('/api/practice', { seed, taps, claim: { score: r.result.score, planet: r.result.planet }, wallMs: 60000 }, T0, 11);
  await call('/api/event', { events: { app_seconds: 120 } }, T0, 11);
  const today = T0 + 9 * DAY;
  assert.equal((await get('/api/stats/overview.json', today)).status, 401);
  assert.equal((await get('/api/stats/overview.json', today, 'nope')).status, 401);
  for (const name of ['overview', 'retention', 'funnel', 'planets', 'design', 'sources', 'runs', 'players']) {
    const res = await get(`/api/stats/${name}.json`, today, 'stats-test');
    assert.equal(res.status, 200, `${name}: ${res.text}`);
    assert.ok(!/Nacho|"user_id"|"10"/.test(res.text), `${name} deja ver datos personales`);
    assert.equal(res.res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  }
  const ov = JSON.parse((await get('/api/stats/overview.json', today, 'stats-test')).text).rows;
  const d0 = ov.find((x: any) => x.day === '2026-11-01');
  assert.equal(d0.players, 3);
  assert.equal(d0.new_players, 3);
  assert.equal(d0.daily_games, 1);
  assert.equal(d0.practice_games, 1);
  assert.equal(d0.app_minutes, 2);
  const ret = JSON.parse((await get('/api/stats/retention.json', today, 'stats-test')).text).rows;
  assert.deepEqual([ret[0].players, ret[0].d1_players, ret[0].d7_players], [3, 1, 0]);
  const csv = await get('/api/stats/runs.csv', today, 'stats-test');
  assert.match(csv.text.split('\n')[0]!, /^day,started_at,player,mode/);
});

test('CORS: solo la dirección del juego', async () => {
  const env = makeEnv();
  const pre = await handle(new Request('https://api.example.dev/api/stats/overview.json', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const other = await handle(new Request('https://api.example.dev/api/health', { headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
});

test('tutorial: queda marcado por jugador y la sesión lo devuelve', async () => {
  const env = makeEnv(), { call } = mk(env);
  assert.equal((await call('/api/session', {}, T0)).data.tutorialDone, false);
  await call('/api/event', { events: { tutorial_skip: 1 } }, T0);
  assert.equal((await call('/api/session', {}, T0 + 1000)).data.tutorialDone, true);
  assert.equal((await call('/api/session', {}, T0 + 1000, 11)).data.tutorialDone, false);
  const off = makeEnv({ EVENTS_ENABLED: 'false' }), m = mk(off);
  await m.call('/api/event', { events: { tutorial_done: 1 } }, T0);
  assert.equal((await m.call('/api/session', {}, T0)).data.tutorialDone, true);
});
