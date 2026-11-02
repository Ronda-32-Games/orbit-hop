/**
 * Matemática determinista.
 *
 * El teléfono (Android = V8, iPhone = JavaScriptCore) y el servidor (Cloudflare
 * Workers = V8) tienen que llegar al MISMO número, bit por bit, para que el
 * validador pueda rehacer la partida. La suma, resta, multiplicación, división
 * y raíz cuadrada son IEEE-754 y dan igual en todos los motores. Math.sin,
 * Math.cos y Math.atan2 NO: cada motor puede redondear distinto en el último
 * bit, y en 4000 ticks esa diferencia puede cambiar si la nave entra o no en
 * un campo.
 *
 * Por eso las reglas usan solo las funciones de este archivo. Están hechas con
 * + - * / y Math.floor/Math.round (exactos en todos lados). Prohibido usar
 * Math.sin, Math.cos, Math.tan, Math.atan, Math.atan2, Math.hypot, Math.exp,
 * Math.log o Math.pow dentro de src/rules (lo revisa test/rules-purity.test.ts).
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

// π/2 partido en dos (Cody-Waite, valores de fdlibm): k*PIO2_1 es exacto.
const PIO2_1 = 1.5707963267341256;
const PIO2_1T = 6.077100506506192e-11;

// Polinomios de fdlibm (__kernel_sin / __kernel_cos) para |r| <= π/4.
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kSin(r: number): number {
  const z = r * r;
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

function kCos(r: number): number {
  const z = r * r;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}

/** Reduce x a r en [-π/4, π/4] y devuelve el cuadrante (0..3). */
function reduce(x: number): [number, number] {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_1 - k * PIO2_1T;
  const q = ((k % 4) + 4) % 4;
  return [r, q];
}

export function dsin(x: number): number {
  const [r, q] = reduce(x);
  switch (q) {
    case 0: return kSin(r);
    case 1: return kCos(r);
    case 2: return -kSin(r);
    default: return -kCos(r);
  }
}

export function dcos(x: number): number {
  const [r, q] = reduce(x);
  switch (q) {
    case 0: return kCos(r);
    case 1: return -kSin(r);
    case 2: return -kCos(r);
    default: return kSin(r);
  }
}

const TAN_PI_8 = 0.41421356237309503; // tan(π/8)
const TAN_PI_16 = 0.19891236737965800; // tan(π/16)
const PI_4 = 0.7853981633974483;
const PI_8 = 0.39269908169872414;

/** atan por serie de Taylor después de reducir a |u| <= tan(π/16). */
function atanSmall(u: number): number {
  const z = u * u;
  // 1/(2n+1) con signo alternado, hasta u^23: error < 1e-17 en el rango.
  return u * (1 + z * (-1 / 3 + z * (1 / 5 + z * (-1 / 7 + z * (1 / 9 + z * (-1 / 11 +
    z * (1 / 13 + z * (-1 / 15 + z * (1 / 17 + z * (-1 / 19 + z * (1 / 21 + z * (-1 / 23))))))))))));
}

export function datan(x: number): number {
  if (x !== x) return x;
  const neg = x < 0;
  let a = neg ? -x : x;
  let base = 0;
  let flip = false;
  if (a > 1) { a = 1 / a; flip = true; }
  if (a > TAN_PI_8) { a = (a - 1) / (a + 1); base = PI_4; }
  // ahora |a| <= tan(π/8); una vuelta más
  if (a > TAN_PI_16) { a = (a - TAN_PI_8) / (1 + a * TAN_PI_8); base += PI_8; }
  else if (a < -TAN_PI_16) { a = (a + TAN_PI_8) / (1 - a * TAN_PI_8); base -= PI_8; }
  let r = base + atanSmall(a);
  if (flip) r = HALF_PI - r;
  return neg ? -r : r;
}

export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

/** Lleva el ángulo a [-π, π). */
export function wrapAngle(a: number): number {
  return a - TAU * Math.floor((a + PI) / TAU);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/** Raíz cuadrada: IEEE-754 la define exacta (redondeo correcto) en todos los motores. */
export const dsqrt = Math.sqrt;
