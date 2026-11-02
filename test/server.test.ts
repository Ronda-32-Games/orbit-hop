import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, type Env } from '../src/server/worker.ts';
import { signInitDataForTest } from '../src/server/telegram.ts';
import { replay } from '../src/rules/index.ts';
import { playBot } from '../tools/bot.ts';

const env: Env = {
  BOT_TOKEN: '123456:TEST-TOKEN',
  TOKEN_SECRET: 'token-secret-test',
  DAILY_SECRET: 'daily-secret-test',
  ALLOWED_ORIGIN: 'https://ronda-32-games.github.io',
};

const T0 = Date.UTC(2026, 10, 1, 15, 0, 0);

async function initData(uid: number, nowMs: number, token = env.BOT_TOKEN) {
  return signInitDataForTest({
    auth_date: String(Math.floor(nowMs / 1000)),
    query_id: 'AAH-test',
    user: JSON.stringify({ id: uid, first_name: 'Nacho' }),
  }, token);
}

async function call(path: string, body: unknown, nowMs: number) {
  const req = new Request(`https://api.example.dev${path}`, { method: 'POST', body: JSON.stringify(body) });
  const res = await handle(req, env, { now: () => nowMs });
  return { status: res.status, data: await res.json() as any };
}

async function start(uid = 10) {
  const s = await call('/api/start', { initData: await initData(uid, T0), mode: 'daily' }, T0);
  assert.equal(s.status, 200);
  return s.data as { seed: number; token: string; day: string };
}

test('Daily: todos reciben la misma semilla ese día; otro día cambia', async () => {
  const a = await start(10), b = await start(11);
  assert.equal(a.seed, b.seed);
  assert.equal(a.day, '2026-11-01');
  const next = T0 + 86400000;
  const c = await call('/api/start', { initData: await initData(10, next), mode: 'daily' }, next);
  assert.notEqual(c.data.seed, a.seed);
});

test('partida completa aceptada', async () => {
  const { seed, token } = await start();
  const taps = playBot(seed, { skill: 0.7, greed: 0.2, panic: 0, rngSeed: 9 });
  const r = replay({ seed, taps });
  assert.ok(r.ok);
  const end = T0 + (r.result.ticks / 60) * 1000 + 800;
  const f = await call('/api/finish', {
    initData: await initData(10, end), token, taps,
    claim: { score: r.result.score, planet: r.result.planet, checksum: r.result.checksum },
  }, end);
  assert.equal(f.status, 200, JSON.stringify(f.data));
  assert.equal(f.data.result.score, r.result.score);
  assert.equal(f.data.checksumMatch, true);
});

test('trampas rechazadas por el servidor', async () => {
  const { seed, token } = await start();
  const taps = playBot(seed, { skill: 0.7, greed: 0.2, panic: 0, rngSeed: 9 });
  const r = replay({ seed, taps });
  assert.ok(r.ok);
  const claim = { score: r.result.score, planet: r.result.planet };
  const end = T0 + 70000;
  const finish = async (over: Record<string, unknown>, now = end, uid = 10) =>
    (await call('/api/finish', { initData: await initData(uid, now), token, taps, claim, ...over }, now)).data.reason;

  assert.equal(await finish({ claim: { ...claim, score: claim.score * 2 } }), 'claim_mismatch');
  assert.equal(await finish({}, end, 99), 'wrong_user');
  assert.equal(await finish({ token: token.slice(0, -2) + '00' }), 'bad_token');
  assert.equal(await finish({}, T0 + 20000), 'too_fast'); // 60 s de juego en 20 s
  assert.equal(await finish({}, T0 + 31 * 60000), 'token_expired');
  const bad = await call('/api/finish', { initData: await initData(10, end, '999:OTRO'), token, taps, claim }, end);
  assert.equal(bad.data.reason, 'telegram_bad_hash');
});
