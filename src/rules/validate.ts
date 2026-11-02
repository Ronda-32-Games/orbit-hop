/**
 * Validador: rehace la partida con las mismas reglas que corrió el teléfono.
 * Lo usan el servidor (para aceptar un puntaje) y el cliente (autotest).
 *
 * Qué garantiza: que el puntaje sale de esa semilla y esos toques. Un puntaje
 * inventado, editado o de otra grilla no pasa.
 * Qué NO garantiza solo: que los toques los hizo una persona (un bot que lee
 * la pantalla podría jugar perfecto). Para eso están el token con hora de
 * inicio y el control de duración del servidor (src/server).
 */
import { maxTicks, type Rules, RULES } from './config.ts';
import { newGame, type Result, resultOf, step, tap } from './sim.ts';

export interface RunInput {
  seed: number;
  /** tick de cada toque que tuvo efecto, de menor a mayor */
  taps: number[];
}

export interface Claim {
  score: number;
  planet: number;
  checksum?: number;
}

export type ValidateFail =
  | 'bad_seed' | 'bad_taps' | 'too_many_taps' | 'taps_not_increasing' | 'tap_out_of_range'
  | 'tap_without_effect' | 'taps_after_end' | 'claim_mismatch';

export type ValidateOutcome =
  | { ok: true; result: Result; checksumMatch: boolean | null }
  | { ok: false; reason: ValidateFail; result?: Result };

/** Revisa la forma de la entrada antes de simular (barato, corta datos basura). */
export function checkShape(input: unknown, rules: Rules = RULES): ValidateFail | null {
  const i = input as RunInput;
  if (!i || typeof i.seed !== 'number' || !Number.isInteger(i.seed) || i.seed < 0 || i.seed > 0xffffffff) return 'bad_seed';
  if (!Array.isArray(i.taps)) return 'bad_taps';
  if (i.taps.length > rules.maxTaps) return 'too_many_taps';
  const limit = maxTicks(rules);
  let prev = -1;
  for (const t of i.taps) {
    if (typeof t !== 'number' || !Number.isInteger(t)) return 'bad_taps';
    if (t < 0 || t >= limit) return 'tap_out_of_range';
    if (t <= prev) return 'taps_not_increasing';
    prev = t;
  }
  return null;
}

/** Rehace la partida. Un toque que no tuvo efecto invalida la entrada: el cliente solo manda toques efectivos. */
export function replay(input: RunInput, rules: Rules = RULES): ValidateOutcome {
  const s = newGame(input.seed, rules, false);
  const taps = input.taps;
  let i = 0;
  while (!s.ended) {
    if (i < taps.length && taps[i] === s.tick) {
      if (!tap(s)) return { ok: false, reason: 'tap_without_effect', result: resultOf(s) };
      i++;
    }
    step(s);
  }
  if (i < taps.length) return { ok: false, reason: 'taps_after_end', result: resultOf(s) };
  return { ok: true, result: resultOf(s), checksumMatch: null };
}

export function validate(input: unknown, claim?: Claim, rules: Rules = RULES): ValidateOutcome {
  const bad = checkShape(input, rules);
  if (bad) return { ok: false, reason: bad };
  const out = replay(input as RunInput, rules);
  if (!out.ok || !claim) return out;
  const r = out.result;
  if (r.score !== claim.score || r.planet !== claim.planet) {
    return { ok: false, reason: 'claim_mismatch', result: r };
  }
  return { ok: true, result: r, checksumMatch: claim.checksum === undefined ? null : claim.checksum === r.checksum };
}
