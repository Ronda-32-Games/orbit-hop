/**
 * El mapa: planetas generados al vuelo desde la semilla. Misma semilla, misma
 * ruta para todos (Daily, desafíos). Cada planeta tiene una clave entera
 * derivada de la de su padre, y su azar sale solo de esa clave: no importa en
 * qué orden se generen los planetas, siempre salen iguales.
 */
import type { Rules } from './config.ts';
import { dcos, dsin, dsqrt, HALF_PI } from './dmath.ts';
import { mix, mulberry32 } from './rng.ts';

export type PuType = 'grav' | 'shield' | 'aim' | 'slow';
export const PU_TYPES: readonly PuType[] = ['grav', 'shield', 'aim', 'slow'];
export type Branch = '' | 'a' | 'b';

export interface Asteroid { amp: number; w: number; ph: number; dead: boolean }
export interface PowerUp { off: number; t: PuType; taken: boolean }

export interface PNode {
  key: number;
  num: number;
  br: Branch;
  x: number;
  y: number;
  /** radio del campo de captura */
  f: number;
  /** velocidad de giro, rad/s */
  w: number;
  dir: 1 | -1;
  par: PNode | null;
  kids: PNode[] | null;
  /** asteroide que cruza el tramo par → este planeta */
  ast: Asteroid | null;
  /** power-up sobre el tramo par → este planeta */
  pu: PowerUp | null;
  /** último tipo de power-up en el camino hasta acá (para no repetir) */
  lastPu: PuType | null;
}

export function makeRoot(seed: number, r: Rules): PNode {
  return {
    key: mix(seed >>> 0, 0x0bb17), num: 1, br: '', x: 0, y: 0,
    f: r.rootField, w: r.rootW, dir: 1, par: null, kids: null, ast: null, pu: null, lastPu: null,
  };
}

export function label(n: PNode): string {
  return n.num + n.br;
}

export function kids(n: PNode, r: Rules): PNode[] {
  if (n.kids) return n.kids;
  const rnd = mulberry32(n.key);
  const num = n.num + 1;
  const fork = r.forkAt.includes(num);
  const k = Math.min(num, r.difficultyCapPlanet) / r.difficultyCapPlanet;
  const out: PNode[] = [];
  const count = fork ? 2 : 1;
  for (let j = 0; j < count; j++) {
    const br: Branch = fork ? (j ? 'b' : 'a') : n.br;
    const hard = br === 'b';
    const d = r.hopDistMin + k * r.hopDistGrow;
    let ang: number;
    if (fork) {
      ang = -HALF_PI + (j ? r.forkSpread : -r.forkSpread) + (rnd() - 0.5) * r.forkJitter;
    } else {
      const side = rnd() < 0.5 ? -1 : 1;
      ang = -HALF_PI + side * (r.diagMin + rnd() * r.diagRange);
    }
    const c: PNode = {
      key: mix(n.key, j + 1),
      num, br,
      x: n.x + dcos(ang) * d,
      y: n.y + dsin(ang) * d,
      f: Math.max(r.fieldMin, r.fieldStart - k * r.fieldShrink + (hard ? r.branchB.fieldDelta : 0)),
      w: r.orbitStart + k * r.orbitGrow + (hard ? r.branchB.orbitDelta : 0),
      dir: rnd() < 0.5 ? 1 : -1,
      par: n, kids: null, ast: null, pu: null, lastPu: n.lastPu,
    };
    const roll = rnd();
    // En una bifurcación nunca hay asteroide en los dos caminos.
    const siblingHasAst = fork && j === 1 && out[0]!.ast !== null;
    const astChance = r.astChanceBase + k * r.astChanceGrow + (hard ? r.branchB.astExtra : 0);
    if (!siblingHasAst && num >= r.astFrom && roll < astChance) {
      c.ast = {
        amp: r.astAmpMin + rnd() * r.astAmpRange,
        w: r.astWMin + rnd() * r.astWRange,
        ph: rnd() * 6.3,
        dead: false,
      };
    } else if (num >= r.puFrom && rnd() < r.puChance) {
      const off = (rnd() - 0.5) * r.puOffRange;
      let idx = Math.floor(rnd() * 4);
      if (r.puNoRepeat && PU_TYPES[idx] === n.lastPu) idx = (idx + 1 + Math.floor(rnd() * 3)) % 4;
      const t = PU_TYPES[idx]!;
      c.pu = { off, t, taken: false };
      c.lastPu = t;
    }
    out.push(c);
  }
  n.kids = out;
  return out;
}

export interface Cand { n: PNode; depth: number; perp: number }

/** Planetas alcanzables: hasta `reach` adelante, en orden de recorrido (hijo, nieto, ...). */
export function ahead(n: PNode, r: Rules, depth = 1, out: { n: PNode; depth: number }[] = []) {
  if (depth > r.reach) return out;
  for (const c of kids(n, r)) {
    out.push({ n: c, depth });
    ahead(c, r, depth + 1, out);
  }
  return out;
}

/** Posición del asteroide del tramo par → c, según el reloj de asteroides (no al azar). */
export function astPos(c: PNode, astT: number): { x: number; y: number } {
  const p = c.par!, a = c.ast!;
  const mx = (p.x + c.x) / 2, my = (p.y + c.y) / 2;
  const dx = c.x - p.x, dy = c.y - p.y, L = dsqrt(dx * dx + dy * dy);
  const s = dsin(astT * a.w + a.ph) * a.amp;
  return { x: mx - (dy / L) * s, y: my + (dx / L) * s };
}

export function puPos(c: PNode): { x: number; y: number } {
  const p = c.par!, u = c.pu!;
  const dx = c.x - p.x, dy = c.y - p.y, L = dsqrt(dx * dx + dy * dy);
  return { x: (p.x + c.x) / 2 - (dy / L) * u.off, y: (p.y + c.y) / 2 + (dx / L) * u.off };
}
