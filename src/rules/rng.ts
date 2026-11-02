/** Azar determinista: enteros de 32 bits con Math.imul, iguales en todo motor. */

export type Rng = () => number;

/** mulberry32: devuelve números en [0, 1). */
export function mulberry32(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mezcla dos enteros en uno (para la clave de cada planeta). */
export function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

/** Normaliza cualquier número a semilla uint32. */
export function toSeed(n: number): number {
  return (Math.floor(n) >>> 0);
}
