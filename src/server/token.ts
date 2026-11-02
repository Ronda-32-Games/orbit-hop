/**
 * Token de partida: lo da /start y lo devuelve /finish. Firmado con HMAC, así
 * el servidor no necesita base de datos para saber qué semilla le dio a quién
 * y a qué hora.
 */
import { b64url, hmac, safeEqual, toHex, unb64url } from './crypto.ts';

export interface RunTicket {
  /** usuario de Telegram */
  uid: number;
  mode: 'daily';
  /** día UTC, AAAA-MM-DD */
  day: string;
  seed: number;
  rules: string;
  /** hora de emisión, ms */
  iat: number;
  /** único por partida: con D1 se marca usado para que no se reutilice */
  nonce: string;
}

export async function signTicket(t: RunTicket, secret: string): Promise<string> {
  const body = b64url(JSON.stringify(t));
  return `${body}.${toHex(await hmac(secret, body))}`;
}

export async function readTicket(token: string, secret: string): Promise<RunTicket | null> {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(toHex(await hmac(secret, body)), sig)) return null;
  try { return JSON.parse(unb64url(body)) as RunTicket; } catch { return null; }
}

/** Semilla del Daily: secreta hasta que empieza el día, igual para todos ese día. */
export async function dailySeed(day: string, secret: string): Promise<number> {
  const h = await hmac(secret, `orbit-hop:daily:${day}`);
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
