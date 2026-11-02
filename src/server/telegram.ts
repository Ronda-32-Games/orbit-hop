/**
 * Verificación de initData de Telegram Mini Apps (docs oficiales:
 * "Validating data received via the Mini App").
 *   secret = HMAC_SHA256(key = "WebAppData", msg = bot_token)
 *   hash   = hex(HMAC_SHA256(key = secret, msg = data_check_string))
 * data_check_string = pares clave=valor (sin hash), ordenados, unidos con \n.
 */
import { hmac, safeEqual, toHex } from './crypto.ts';

export interface TgUser { id: number; first_name?: string; username?: string; language_code?: string }

export type InitDataCheck =
  | { ok: true; user: TgUser; authDate: number }
  | { ok: false; reason: 'missing' | 'bad_hash' | 'expired' | 'no_user' };

export async function verifyInitData(initData: string, botToken: string, nowS: number, maxAgeS = 86400): Promise<InitDataCheck> {
  if (!initData) return { ok: false, reason: 'missing' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing' };
  const pairs: string[] = [];
  params.forEach((v, k) => { if (k !== 'hash') pairs.push(`${k}=${v}`); });
  pairs.sort();
  const secret = await hmac('WebAppData', botToken);
  const calc = toHex(await hmac(secret, pairs.join('\n')));
  if (!safeEqual(calc, hash)) return { ok: false, reason: 'bad_hash' };
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowS - authDate > maxAgeS) return { ok: false, reason: 'expired' };
  try {
    const user = JSON.parse(params.get('user') ?? '') as TgUser;
    if (typeof user.id !== 'number') return { ok: false, reason: 'no_user' };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: 'no_user' };
  }
}

/** Solo para pruebas: arma un initData firmado como lo haría Telegram. */
export async function signInitDataForTest(fields: Record<string, string>, botToken: string): Promise<string> {
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort();
  const secret = await hmac('WebAppData', botToken);
  const hash = toHex(await hmac(secret, pairs.join('\n')));
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}
