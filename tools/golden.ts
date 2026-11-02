/**
 * Partidas de referencia ("golden"). Se generan en Node (V8) y el teléfono las
 * rehace en su propio motor con ?selftest (o startapp=selftest). Si un iPhone
 * (JavaScriptCore) da otra huella, las reglas no son deterministas ahí.
 * Regenerar SOLO si cambian las reglas a propósito (y subir rulesVersion):
 *   npm run golden
 */
import { writeFileSync } from 'node:fs';
import { replay } from '../src/rules/index.ts';
import { playBot } from './bot.ts';

const cases = [
  { seed: 32, bot: { skill: 0.95, greed: 0.05, panic: 0, rngSeed: 1 } },
  { seed: 1, bot: { skill: 0.6, greed: 0.3, panic: 0.002, rngSeed: 2 } },
  { seed: 20261101, bot: { skill: 0.3, greed: 0.6, panic: 0.01, rngSeed: 3 } },
  { seed: 0xffffffff, bot: { skill: 0.85, greed: 0.15, panic: 0.001, rngSeed: 4 } },
  { seed: 777, bot: { skill: 0.8, greed: 0.4, panic: 0, rngSeed: 5 } },
  { seed: 4242, bot: { skill: 0.5, greed: 0.1, panic: 0.004, rngSeed: 6 } },
];

const out = cases.map(({ seed, bot }) => {
  const taps = playBot(seed, bot);
  const r = replay({ seed, taps });
  if (!r.ok) throw new Error(`golden ${seed} inválida: ${r.reason}`);
  const { score, planet, label, checksum, ticks } = r.result;
  console.log(`seed ${seed}: planeta ${label}, ${score} pts, ${taps.length} toques, huella ${checksum.toString(16)}`);
  return { seed, taps, expect: { score, planet, label, checksum, ticks } };
});

writeFileSync(new URL('../src/client/golden.json', import.meta.url), JSON.stringify(out) + '\n');
