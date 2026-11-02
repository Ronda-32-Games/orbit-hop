/** Telegram, modo de prueba (DEC-038) y servidor. */

declare const __API_URL__: string;
export const API_URL: string = typeof __API_URL__ === 'string' ? __API_URL__ : '';

interface TgWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  ready(): void;
  expand(): void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  HapticFeedback?: {
    impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(s: 'error' | 'success' | 'warning'): void;
  };
}

export function tg(): TgWebApp | null {
  return (globalThis as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;
}

export function initTelegram() {
  const w = tg();
  if (!w) return;
  try {
    w.ready(); w.expand();
    w.disableVerticalSwipes?.();
    w.setHeaderColor?.('#151A2D'); w.setBackgroundColor?.('#151A2D');
  } catch { /* fuera de Telegram */ }
}

export function haptic(kind: 'tap' | 'good' | 'bad') {
  const h = tg()?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'bad') h.notificationOccurred('error');
    else h.impactOccurred(kind === 'good' ? 'medium' : 'light');
  } catch { /* nada */ }
}

export interface TestMode {
  /** muestra el panel ms */
  test: boolean;
  seed: number | null;
  roundS: number | null;
  selftest: boolean;
  /** con seed o round no se guarda récord (DEC-038) */
  noRecord: boolean;
}

/**
 * Mismas llaves que Sum 32: ?test, ?seed=32, ?round=5, ?selftest en la dirección,
 * o startapp=test, test_seed32_round5, selftest desde Telegram.
 */
export function readTestMode(): TestMode {
  const q = new URLSearchParams(location.search);
  const sp = tg()?.initDataUnsafe?.start_param ?? q.get('tgWebAppStartParam') ?? '';
  const parts = sp.split('_').filter(Boolean);
  const fromSp = (p: string) => {
    const m = parts.find(x => x.startsWith(p) && /^\d+$/.test(x.slice(p.length)));
    return m ? Number(m.slice(p.length)) : null;
  };
  const num = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : null);
  const seed = num(q.get('seed')) ?? fromSp('seed');
  const roundRaw = num(q.get('round')) ?? fromSp('round');
  const roundS = roundRaw !== null ? Math.max(3, Math.min(600, roundRaw)) : null;
  const selftest = q.has('selftest') || parts.includes('selftest');
  const test = q.has('test') || parts[0] === 'test' || seed !== null || roundS !== null || selftest;
  return { test, seed: seed !== null ? seed >>> 0 : null, roundS, selftest, noRecord: seed !== null || roundS !== null };
}

export function storage() {
  return {
    get<T>(k: string): T | null { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } },
    set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin storage */ } },
  };
}
