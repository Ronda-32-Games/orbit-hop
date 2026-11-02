/**
 * Autotest de determinismo en el teléfono: rehace las partidas de referencia
 * (generadas en Node/V8) con el motor de este navegador y compara la huella.
 * En iPhone esto prueba JavaScriptCore contra el servidor.
 */
import { replay, RULES_VERSION } from '../rules/index.ts';
import golden from './golden.json';

export function runSelftest(): { pass: boolean; text: string } {
  const lines: string[] = [];
  let pass = true;
  const t0 = performance.now();
  for (const g of golden) {
    const r = replay({ seed: g.seed, taps: g.taps });
    const ok = r.ok && r.result.score === g.expect.score && r.result.planet === g.expect.planet
      && r.result.checksum === g.expect.checksum;
    pass &&= ok;
    const got = r.ok ? `${r.result.label} ${r.result.score} ${r.result.checksum.toString(16)}` : r.reason;
    lines.push(`${ok ? 'OK  ' : 'FAIL'} seed ${g.seed}: ${got}${ok ? '' : ` (expected ${g.expect.label} ${g.expect.score} ${g.expect.checksum.toString(16)})`}`);
  }
  const ms = performance.now() - t0;
  const head = `Orbit Hop selftest ${pass ? 'PASS' : 'FAIL'} · ${RULES_VERSION} · ${golden.length} runs in ${ms.toFixed(0)} ms`;
  return { pass, text: [head, ...lines, '', navigator.userAgent].join('\n') };
}
