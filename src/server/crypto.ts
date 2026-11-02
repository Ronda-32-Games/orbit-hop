/** HMAC-SHA256 con WebCrypto (igual en Cloudflare Workers y en Node 20+). */
const enc = new TextEncoder();

export async function hmac(key: Uint8Array<ArrayBuffer> | string, msg: string): Promise<Uint8Array<ArrayBuffer>> {
  const raw = typeof key === 'string' ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

/** Comparación en tiempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s: string): string {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(p + '='.repeat((4 - (p.length % 4)) % 4))));
}
