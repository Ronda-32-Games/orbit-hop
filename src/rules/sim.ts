/**
 * La partida. Corre a pasos fijos de 1/60 s (ticks). La entrada del jugador es
 * solo "toqué en el tick N", así que una partida entera se describe con
 * (semilla, lista de ticks de toque). El teléfono la juega y el servidor la
 * rehace con este mismo archivo.
 *
 * Reglas (GDD v0.2):
 * - Un toque suelta la nave por la tangente. Captura el primer campo que toca
 *   de los planetas hasta 3 adelante. Puntos x profundidad (x2 / x3 al saltear).
 * - Sin multa de tiempo por fallar: pared o asteroide revientan la nave, vuelve
 *   al planeta y se reinician combo y racha.
 * - Perfecto (pasa cerca del centro): combo +0,5 hasta x3; desde el 3.º seguido
 *   +1 s cada uno, tope +5 s por partida.
 * - ¡32!: +500 y +3 s una vez. Camino B: puntos x2.
 * - Power-ups: gravedad (campos x1,6 por 3 saltos), escudo (rompés un
 *   asteroide), mira (línea de tiro 2 tiros), cámara lenta (3 s; órbita y
 *   asteroides a 0,45, el reloj sigue normal).
 */
import type { Rules } from './config.ts';
import { datan2, dcos, dist2, dsin, dsqrt, wrapAngle } from './dmath.ts';
import { ahead, astPos, type Cand, kids, label, makeRoot, type PNode, type PuType, puPos } from './world.ts';

export type SimEvent =
  | { type: 'launch'; x: number; y: number }
  | { type: 'capture'; x: number; y: number; perfect: boolean; depth: number; pts: number; node: PNode }
  | { type: 'miss'; x: number; y: number; cause: 'wall' | 'asteroid' }
  | { type: 'asteroidBroken'; x: number; y: number }
  | { type: 'powerup'; x: number; y: number; pu: PuType }
  | { type: 'timeBonus'; x: number; y: number; ticks: number }
  | { type: 'bonus32'; x: number; y: number }
  | { type: 'end' };

export interface Flight {
  x: number; y: number; vx: number; vy: number;
  cand: Cand[];
  wallR2: number;
}

export interface GameState {
  readonly rules: Rules;
  readonly seed: number;
  tick: number;
  ticksLeft: number;
  cur: PNode;
  angle: number;
  fly: Flight | null;
  score: number;
  combo: number;
  streak: number;
  bonusTicks: number;
  grav: number;
  shield: boolean;
  aim: number;
  slowLeft: number;
  /** reloj de los asteroides: avanza más lento en cámara lenta */
  astT: number;
  got32: boolean;
  taps: number;
  perfects: number;
  captures: number;
  misses: number;
  /** solo para métricas (no entran en la huella): */
  skips: number;
  missWall: number;
  missAst: number;
  powerups: number;
  bestStreak: number;
  ended: boolean;
  /** huella de la partida: si el teléfono y el servidor no coinciden, cambia */
  checksum: number;
  /** null = no guardar eventos (servidor) */
  events: SimEvent[] | null;
}

export function newGame(seed: number, rules: Rules, withEvents = false): GameState {
  return {
    rules, seed: seed >>> 0,
    tick: 0, ticksLeft: rules.roundTicks,
    cur: makeRoot(seed >>> 0, rules), angle: 0, fly: null,
    score: 0, combo: 1, streak: 0, bonusTicks: 0,
    grav: 0, shield: false, aim: 0, slowLeft: 0, astT: 0,
    got32: false, taps: 0, perfects: 0, captures: 0, misses: 0,
    skips: 0, missWall: 0, missAst: 0, powerups: 0, bestStreak: 0,
    ended: false, checksum: 0x811c9dc5, events: withEvents ? [] : null,
  };
}

// ---- huella -------------------------------------------------------------
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function hashInt(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xff), 16777619);
  h = Math.imul(h ^ ((v >>> 8) & 0xff), 16777619);
  h = Math.imul(h ^ ((v >>> 16) & 0xff), 16777619);
  return Math.imul(h ^ (v >>> 24), 16777619) >>> 0;
}
/** Mezcla los bits exactos del float: detecta una diferencia en el último bit. */
function hashFloat(h: number, v: number): number {
  f64[0] = v;
  return hashInt(hashInt(h, u32[0]!), u32[1]!);
}

function emit(s: GameState, e: SimEvent) {
  if (s.events) s.events.push(e);
}

/** Radio del campo con gravedad aplicada. */
export function fieldOf(s: GameState, n: PNode): number {
  return s.grav > 0 ? n.f * s.rules.gravMul : n.f;
}

/** Posición de la nave en órbita. */
export function shipOnOrbit(s: GameState): { x: number; y: number } {
  return { x: s.cur.x + dcos(s.angle) * s.rules.orbitR, y: s.cur.y + dsin(s.angle) * s.rules.orbitR };
}

/** Dirección de salida si se toca ahora (tangente a la órbita). */
export function launchDir(s: GameState): { x: number; y: number } {
  return { x: -dsin(s.angle) * s.cur.dir, y: dcos(s.angle) * s.cur.dir };
}

/** Radio de la pared: el planeta más lejano visible + su campo + margen. "Si se ve, se puede alcanzar". */
export function wallRadius(s: GameState): number {
  let m = 0;
  for (const c of ahead(s.cur, s.rules)) {
    const dx = c.n.x - s.cur.x, dy = c.n.y - s.cur.y;
    m = Math.max(m, dsqrt(dx * dx + dy * dy) + fieldOf(s, c.n));
  }
  return m + s.rules.wallPad;
}

export function canTap(s: GameState): boolean {
  return !s.ended && s.fly === null;
}

/** Toque. Devuelve false si no tiene efecto (nave en vuelo o partida terminada). */
export function tap(s: GameState): boolean {
  if (!canTap(s)) return false;
  s.taps++;
  if (s.aim > 0) s.aim--;
  const p = shipOnOrbit(s);
  const d = launchDir(s);
  const cand: Cand[] = ahead(s.cur, s.rules).map(({ n, depth }) => {
    const dx = n.x - p.x, dy = n.y - p.y;
    return { n, depth, perp: Math.abs(dx * d.y - dy * d.x) };
  });
  const wr = wallRadius(s);
  s.fly = { x: p.x, y: p.y, vx: d.x, vy: d.y, cand, wallR2: wr * wr };
  s.checksum = hashInt(s.checksum, s.tick);
  emit(s, { type: 'launch', x: p.x, y: p.y });
  return true;
}

function miss(s: GameState, cause: 'wall' | 'asteroid') {
  const f = s.fly!;
  s.fly = null;
  s.combo = 1;
  s.streak = 0;
  s.misses++;
  if (cause === 'wall') s.missWall++; else s.missAst++;
  s.checksum = hashFloat(hashInt(s.checksum, 0xdead), f.x);
  emit(s, { type: 'miss', x: f.x, y: f.y, cause });
}

/** Avanza un tick. */
export function step(s: GameState): void {
  if (s.ended) return;
  const r = s.rules;
  const sl = s.slowLeft > 0 ? r.slowMul : 1;
  s.tick++;
  s.astT += r.dt * sl;
  if (s.slowLeft > 0) s.slowLeft--;

  if (s.fly) flyStep(s);
  else s.angle = wrapAngle(s.angle + s.cur.w * s.cur.dir * r.dt * sl);

  s.ticksLeft--;
  if (s.ticksLeft <= 0) {
    s.ticksLeft = 0;
    s.ended = true;
    s.checksum = hashInt(hashInt(s.checksum, s.score), s.tick);
    emit(s, { type: 'end' });
  }
}

function flyStep(s: GameState) {
  const r = s.rules, f = s.fly!;
  const v = r.shipV * r.dt;
  f.x += f.vx * v;
  f.y += f.vy * v;

  // asteroides y power-ups de los tramos alcanzables
  const hitR2 = (r.astR + r.shipR) * (r.astR + r.shipR);
  const puR2 = r.puPickR * r.puPickR;
  for (const c of f.cand) {
    const n = c.n;
    if (n.ast && !n.ast.dead) {
      const q = astPos(n, s.astT);
      if (dist2(f.x, f.y, q.x, q.y) < hitR2) {
        n.ast.dead = true; // un asteroide chocado desaparece
        if (s.shield) {
          s.shield = false;
          emit(s, { type: 'asteroidBroken', x: q.x, y: q.y });
        } else {
          miss(s, 'asteroid');
          return;
        }
      }
    }
    if (n.pu && !n.pu.taken) {
      const q = puPos(n);
      if (dist2(f.x, f.y, q.x, q.y) < puR2) {
        n.pu.taken = true;
        const t = n.pu.t;
        if (t === 'grav') s.grav = r.gravHops;
        else if (t === 'shield') s.shield = true;
        else if (t === 'aim') s.aim = r.aimShots;
        else s.slowLeft = r.slowTicks;
        s.powerups++;
        s.checksum = hashInt(s.checksum, 0x900 + PU_CODE[t]);
        emit(s, { type: 'powerup', x: q.x, y: q.y, pu: t });
      }
    }
  }

  // captura: el primer campo que toca, en orden de recorrido
  for (const c of f.cand) {
    const fe = fieldOf(s, c.n);
    const cap = fe * r.captureDistFrac;
    if (c.perp < fe && dist2(f.x, f.y, c.n.x, c.n.y) < cap * cap) {
      capture(s, c, fe);
      return;
    }
  }

  if (dist2(f.x, f.y, s.cur.x, s.cur.y) > f.wallR2) miss(s, 'wall');
}

const PU_CODE: Record<PuType, number> = { grav: 1, shield: 2, aim: 3, slow: 4 };

function capture(s: GameState, c: Cand, fe: number) {
  const r = s.rules, f = s.fly!, q = c.n;
  const perfect = c.perp < fe * r.perfectFrac;
  s.cur = q;
  s.angle = datan2(f.y - q.y, f.x - q.x);
  s.fly = null;
  s.captures++;
  if (c.depth > 1) s.skips++;
  if (perfect) {
    s.perfects++;
    s.combo = Math.min(r.comboMax, s.combo + r.comboStep);
    s.streak++;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
  } else {
    s.combo = 1;
    s.streak = 0;
  }
  if (perfect && s.streak >= r.perfStreakFrom && s.bonusTicks < r.perfCapTicks) {
    const add = Math.min(r.perfTicks, r.perfCapTicks - s.bonusTicks);
    s.ticksLeft += add;
    s.bonusTicks += add;
    emit(s, { type: 'timeBonus', x: q.x, y: q.y, ticks: add });
  }
  const pts = Math.round(r.pts * s.combo * c.depth * (q.br === 'b' ? r.branchB.ptsMul : 1));
  s.score += pts;
  if (s.grav > 0) s.grav--;
  s.checksum = hashFloat(hashInt(hashInt(s.checksum, s.tick), q.key), s.angle);
  emit(s, { type: 'capture', x: q.x, y: q.y, perfect, depth: c.depth, pts, node: q });
  if (!s.got32 && q.num >= 32) {
    s.got32 = true;
    s.score += r.bonus32Pts;
    s.ticksLeft += r.bonus32Ticks;
    emit(s, { type: 'bonus32', x: q.x, y: q.y });
  }
  kids(q, r); // deja generado lo que viene (para el render)
}

export interface Result {
  rulesVersion: string;
  seed: number;
  score: number;
  planet: number;
  label: string;
  taps: number;
  perfects: number;
  captures: number;
  misses: number;
  skips: number;
  missWall: number;
  missAst: number;
  powerups: number;
  bestStreak: number;
  /** segundos ganados por racha de perfectos */
  bonusS: number;
  got32: boolean;
  ticks: number;
  checksum: number;
}

export function resultOf(s: GameState): Result {
  return {
    rulesVersion: s.rules.rulesVersion,
    seed: s.seed,
    score: s.score,
    planet: s.cur.num,
    label: label(s.cur),
    taps: s.taps,
    perfects: s.perfects,
    captures: s.captures,
    misses: s.misses,
    skips: s.skips,
    missWall: s.missWall,
    missAst: s.missAst,
    powerups: s.powerups,
    bestStreak: s.bestStreak,
    bonusS: s.bonusTicks / s.rules.tickHz,
    got32: s.got32,
    ticks: s.tick,
    checksum: s.checksum >>> 0,
  };
}

/** Ranking: planeta alcanzado (20a y 20b valen igual), desempata el puntaje. */
export function compareResults(a: Pick<Result, 'planet' | 'score'>, b: Pick<Result, 'planet' | 'score'>): number {
  return b.planet - a.planet || b.score - a.score;
}
