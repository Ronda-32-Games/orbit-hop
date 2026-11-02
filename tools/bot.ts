/**
 * Jugador automático para pruebas: genera partidas realistas (aciertos,
 * perfectos, saltos largos, choques) sin tocar el teléfono.
 */
import { canTap, launchDir, newGame, shipOnOrbit, step, tap } from '../src/rules/sim.ts';
import { ahead, type Rules, RULES, mulberry32 } from '../src/rules/index.ts';

export interface BotOpts {
  /** 0..1: qué tan cerca del centro espera antes de tocar */
  skill: number;
  /** probabilidad de intentar el salto largo cuando se alinea */
  greed: number;
  /** probabilidad por tick de tocar sin mirar */
  panic: number;
  rngSeed: number;
}

export function playBot(seed: number, o: BotOpts, rules: Rules = RULES): number[] {
  const s = newGame(seed, rules);
  const rnd = mulberry32(o.rngSeed);
  const taps: number[] = [];
  while (!s.ended) {
    if (canTap(s) && shouldTap(s, o, rnd)) {
      const t = s.tick;
      if (tap(s)) taps.push(t);
    }
    step(s);
  }
  return taps;
}

function shouldTap(s: ReturnType<typeof newGame>, o: BotOpts, rnd: () => number): boolean {
  if (rnd() < o.panic) return true;
  const p = shipOnOrbit(s), d = launchDir(s);
  for (const { n, depth } of ahead(s.cur, s.rules)) {
    if (depth > 1 && rnd() > o.greed) continue;
    const dx = n.x - p.x, dy = n.y - p.y;
    if (dx * d.x + dy * d.y <= 0) continue; // está atrás
    const perp = Math.abs(dx * d.y - dy * d.x);
    if (perp < n.f * (1 - o.skill * 0.85)) return true;
  }
  return false;
}
