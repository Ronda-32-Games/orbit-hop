/**
 * Tutorial "fantasma" de la primera partida (mismo criterio que Sum 32, TASK-067 / DEC-058).
 * Antes de la primera partida, un fantasma juega solo con el motor de verdad:
 *   1. suelta la nave antes de tiempo → no cae en ningún campo y explota en la pared;
 *   2. espera el momento justo → cae en el centro del campo: PERFECT;
 *   3. apunta más lejos → saltea un planeta: SKIP x2.
 * Un toque en cualquier momento lo corta y arranca la partida. Después no vuelve a salir
 * (queda en el teléfono y en el servidor), salvo con "How to play" o startapp=tutorial.
 *
 * Los momentos de cada toque no están escritos a mano: se buscan simulando, así el
 * tutorial sigue andando aunque cambien las reglas o el mundo.
 */
import { makeRules, newGame, step, tap, type GameState, type Rules, type SimEvent } from '../rules/index.ts';

export const TUTORIAL_SEED = 3;
/** reloj largo para que el tutorial nunca se quede sin tiempo */
export const tutorialRules = (): Rules => makeRules({ roundS: 600 });

export interface TutorialStep { tick: number; caption: string; after: string }
export interface TutorialPlan { seed: number; rules: Rules; steps: TutorialStep[]; endTick: number }

type Outcome = { kind: 'miss'; cause: string; tick: number } | { kind: 'capture'; depth: number; perfect: boolean; tick: number } | null;

/** Juega desde cero los toques dados y uno más en `t`; dice cómo terminó ese último salto. */
function tryTap(seed: number, rules: Rules, prefix: number[], t: number): Outcome {
  const s = newGame(seed, rules, true);
  let i = 0;
  while (s.tick < t) {
    if (i < prefix.length && prefix[i] === s.tick) { tap(s); i++; }
    step(s);
  }
  s.events!.length = 0;
  if (!tap(s)) return null;
  for (let k = 0; k < 600 && !s.ended; k++) {
    step(s);
    for (const e of s.events! as SimEvent[]) {
      if (e.type === 'miss') return { kind: 'miss', cause: e.cause, tick: s.tick };
      if (e.type === 'capture') return { kind: 'capture', depth: e.depth, perfect: e.perfect, tick: s.tick };
    }
    s.events!.length = 0;
  }
  return null;
}

function find(seed: number, rules: Rules, prefix: number[], from: number, ok: (o: NonNullable<Outcome>) => boolean) {
  for (let t = from; t < from + 900; t++) {
    const o = tryTap(seed, rules, prefix, t);
    if (o && ok(o)) return { t, o };
  }
  return null;
}

function planFor(seed: number): TutorialPlan | null {
  const rules = tutorialRules();
  const steps: TutorialStep[] = [];
  const taps: number[] = [];
  // 1. Antes de tiempo: falla contra la pared (pasado el primer segundo, para que se vea la órbita).
  const a = find(seed, rules, taps, 150, o => o.kind === 'miss' && o.cause === 'wall');
  if (!a) return null;
  taps.push(a.t);
  steps.push({ tick: a.t, caption: 'Your ship orbits the planet. Tap to let go…', after: 'Too early: it missed every field. Boom!' });
  // 2. En el momento justo: perfecto en el planeta siguiente.
  const b = find(seed, rules, taps, a.o.tick + 130, o => o.kind === 'capture' && o.perfect && o.depth === 1);
  if (!b) return null;
  taps.push(b.t);
  steps.push({ tick: b.t, caption: 'Wait until the ship points at the dotted field…', after: 'Landed in the center: PERFECT.' });
  // 3. Más lejos: saltear un planeta (si no aparece, el tutorial queda en dos pasos).
  const c = find(seed, rules, taps, b.o.tick + 140, o => o.kind === 'capture' && o.depth === 2);
  let end = b.o.tick + 110;
  if (c) {
    taps.push(c.t);
    steps.push({ tick: c.t, caption: 'Aim at a planet further ahead…', after: `Skipped a planet: x2 points!` });
    end = c.o.tick + 110;
  }
  return { seed, rules, steps, endTick: end };
}

/** Lo que el juego necesita para correrlo cuadro a cuadro. */
export class TutorialRun {
  readonly s: GameState;
  private i = 0;
  caption = '';
  /** ms hasta el próximo toque del fantasma (para animar el dedo); null si ya no hay */
  nextTapIn: number | null = null;
  tapFlash = 0;
  done = false;

  constructor(readonly plan: TutorialPlan) {
    this.s = newGame(plan.seed, plan.rules, true);
    this.caption = plan.steps[0]!.caption;
  }

  /** Un tick: toca si le toca, avanza y actualiza el texto. */
  tick() {
    const s = this.s, st = this.plan.steps[this.i];
    if (st && s.tick === st.tick) {
      tap(s);
      this.tapFlash = 18;
      this.caption = st.after;
      this.i++;
    }
    step(s);
    if (this.tapFlash > 0) this.tapFlash--;
    const nx = this.plan.steps[this.i];
    // el texto del próximo paso aparece 1,25 s antes del toque, después de dejar leer el anterior
    if (nx && nx.tick - s.tick === 75) this.caption = nx.caption;
    this.nextTapIn = nx ? ((nx.tick - s.tick) * 1000) / s.rules.tickHz : null;
    if (!nx && s.tick >= this.plan.endTick) { this.done = true; this.caption = 'Your turn! Tap to start.'; }
  }
}

/** Plan del tutorial; si con la semilla de siempre no salen los pasos (reglas nuevas), prueba otras. */
export function planTutorial(): TutorialPlan | null {
  for (const seed of [TUTORIAL_SEED, 7, 1, 11, 21]) {
    const p = planFor(seed);
    if (p && p.steps.length === 3) return p;
  }
  return planFor(TUTORIAL_SEED);
}
