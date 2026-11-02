import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datan2, dcos, dsin, makeRules, mulberry32, RULES, validate, replay, newGame, step, maxTicks } from '../src/rules/index.ts';
import { playBot } from '../tools/bot.ts';

test('dsin/dcos/datan2 se parecen a Math (solo cambia el último bit)', () => {
  const r = mulberry32(1);
  let worst = 0;
  for (let i = 0; i < 200000; i++) {
    const x = (r() - 0.5) * 600;
    worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    const y = (r() - 0.5) * 900, z = (r() - 0.5) * 900;
    worst = Math.max(worst, Math.abs(datan2(y, z) - Math.atan2(y, z)));
  }
  assert.ok(worst < 1e-12, `error máximo ${worst}`);
  assert.equal(datan2(0, -1), Math.PI);
  assert.equal(datan2(1, 0), Math.PI / 2);
});

const bots = [
  { skill: 0.9, greed: 0.05, panic: 0, rngSeed: 1 },
  { skill: 0.6, greed: 0.3, panic: 0.002, rngSeed: 2 },
  { skill: 0.3, greed: 0.6, panic: 0.01, rngSeed: 3 },
];

test('misma semilla y mismos toques: mismo resultado, bit por bit', () => {
  for (const seed of [1, 32, 123456789, 0xffffffff]) {
    for (const b of bots) {
      const taps = playBot(seed, b);
      const a = replay({ seed, taps });
      const c = replay({ seed, taps });
      assert.ok(a.ok && c.ok);
      assert.deepEqual(a.result, c.result);
    }
  }
});

test('el bot llega lejos y usa todas las reglas', () => {
  let maxPlanet = 0, any32 = false, anyMiss = false, anyBonus = false;
  for (let seed = 1; seed <= 40; seed++) {
    const taps = playBot(seed, bots[0]!);
    const out = replay({ seed, taps });
    assert.ok(out.ok);
    maxPlanet = Math.max(maxPlanet, out.result.planet);
    any32 ||= out.result.got32;
    anyMiss ||= out.result.misses > 0;
    anyBonus ||= out.result.ticks > RULES.roundTicks;
  }
  assert.ok(maxPlanet >= 20, `planeta máximo ${maxPlanet}`);
  assert.ok(anyMiss && anyBonus, 'faltan choques o bonos de tiempo');
  console.log(`  planeta máximo del bot: ${maxPlanet} · llegó al 32: ${any32}`);
});

test('el validador acepta la partida real y rechaza las trampas', () => {
  const seed = 32;
  const taps = playBot(seed, bots[1]!);
  const real = replay({ seed, taps });
  assert.ok(real.ok);
  const claim = { score: real.result.score, planet: real.result.planet, checksum: real.result.checksum };

  const ok = validate({ seed, taps }, claim);
  assert.ok(ok.ok && ok.checksumMatch === true);

  const reject = (input: unknown, c = claim) => {
    const r = validate(input, c);
    assert.equal(r.ok, false);
    return r.ok ? '' : r.reason;
  };
  assert.equal(reject({ seed, taps }, { ...claim, score: claim.score + 100 }), 'claim_mismatch');
  assert.notEqual(validate({ seed: 33, taps }, claim).ok, true); // mismos toques en otra grilla
  assert.equal(reject({ seed, taps: [...taps].reverse() }), 'taps_not_increasing');
  assert.equal(reject({ seed, taps: [-1] }), 'tap_out_of_range');
  assert.equal(reject({ seed, taps: [maxTicks(RULES)] }), 'tap_out_of_range');
  assert.equal(reject({ seed, taps: ['1'] }), 'bad_taps');
  assert.equal(reject({ seed: 1.5, taps }), 'bad_seed');
  assert.equal(reject({ seed, taps: new Array(RULES.maxTaps + 1).fill(0).map((_, i) => i) }), 'too_many_taps');
  // un toque con la nave en vuelo no puede estar en la lista
  const t0 = taps[0]!;
  assert.equal(reject({ seed, taps: [t0, t0 + 1, ...taps.slice(1)] }), 'tap_without_effect');
  // correr un toque un tick cambia la partida (o la invalida)
  const moved = [...taps]; moved[3] = moved[3]! + 1;
  const mv = validate({ seed, taps: moved }, claim);
  assert.ok(!mv.ok || mv.checksumMatch === false);
});

test('el modo de prueba (round corto) da otra partida que las reglas oficiales no aceptan', () => {
  const short = makeRules({ roundS: 5 });
  const s = newGame(7, short);
  while (!s.ended) step(s);
  assert.equal(s.tick, 300);
});

test('el replay entra holgado en el CPU de un Worker gratis (10 ms)', () => {
  const runs = [] as { seed: number; taps: number[] }[];
  for (let seed = 100; seed < 150; seed++) runs.push({ seed, taps: playBot(seed, bots[0]!) });
  const t0 = performance.now();
  for (const r of runs) replay(r);
  const per = (performance.now() - t0) / runs.length;
  console.log(`  replay promedio: ${per.toFixed(2)} ms`);
  assert.ok(per < 5, `${per} ms por partida`);
});
