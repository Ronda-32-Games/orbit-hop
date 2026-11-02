import raw from './config.json';

export type RawConfig = typeof raw;

/** Parámetros ya pasados a ticks. Todo lo que toca tiempo en las reglas es entero. */
export interface Rules extends RawConfig {
  dt: number;
  roundTicks: number;
  bonus32Ticks: number;
  perfTicks: number;
  perfCapTicks: number;
  slowTicks: number;
}

export const RULES_VERSION = raw.rulesVersion;

export function makeRules(overrides: Partial<RawConfig> = {}): Rules {
  const c = { ...raw, ...overrides } as RawConfig;
  const hz = c.tickHz;
  return {
    ...c,
    dt: 1 / hz,
    roundTicks: Math.round(c.roundS * hz),
    bonus32Ticks: Math.round(c.bonus32S * hz),
    perfTicks: Math.round(c.perfTimeS * hz),
    perfCapTicks: Math.round(c.perfTimeCapS * hz),
    slowTicks: Math.round(c.slowS * hz),
  };
}

/** Reglas oficiales: las únicas que valen para Daily y desafíos. */
export const RULES: Rules = makeRules();

/** Tope de ticks de una partida oficial: ronda + racha de perfectos + ¡32!. */
export function maxTicks(r: Rules): number {
  return r.roundTicks + r.perfCapTicks + r.bonus32Ticks;
}
