import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Math.* que cambian entre motores (V8 / JavaScriptCore). Ver src/rules/dmath.ts.
const BANNED = /Math\.(sin|cos|tan|asin|acos|atan2?|hypot|exp|expm1|log\w*|pow|cbrt|sinh|cosh|tanh|random)\b|Date\.now|performance\.now/;

test('src/rules no usa funciones que cambian entre motores', () => {
  const dir = new URL('../src/rules/', import.meta.url);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src = readFileSync(new URL(f, dir), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    const m = src.match(BANNED);
    assert.equal(m, null, `${f} usa ${m?.[0]}`);
  }
});
