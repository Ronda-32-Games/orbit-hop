/**
 * Tracking del juego (mismo criterio que Sum 32, TASK-063 y privacy.html):
 * solo dentro de Telegram y fuera del modo de prueba. Si algo falla, el juego sigue igual.
 *
 * - Al abrir: /api/session (cuenta el día activo y trae los intentos del Daily).
 * - Cada partida de Practice terminada: /api/practice con semilla y toques (el servidor la rehace).
 * - Cada 60 s o al ocultarse: segundos con la app visible, Practice empezadas y pausas.
 */
import type { Result } from '../rules/index.ts';
import { type DailyState, sendEvents, sendPractice, session, trackingOn } from './api.ts';
import type { TestMode } from './env.ts';

export interface Tracker {
  readonly on: boolean;
  /** estado del Daily que trajo la sesión (null si no hay) */
  daily(): Promise<DailyState | null>;
  /** el servidor dice que esta persona ya vio el tutorial (null si no se sabe) */
  tutorialDone(): Promise<boolean | null>;
  /** tutorial visto entero o cortado: se manda enseguida */
  tutorial(how: 'tutorial_done' | 'tutorial_skip'): void;
  add(event: 'practice_start' | 'pause', n?: number): void;
  practice(seed: number, taps: number[], r: Result, wallMs: number): void;
}

export function makeTracker(mode: TestMode): Tracker {
  const on = trackingOn(mode);
  const pending: Record<string, number> = { app_seconds: 0, practice_start: 0, pause: 0 };
  let visibleSince: number | null = document.hidden ? null : Date.now();
  const sess = on ? session().catch(() => null) : Promise.resolve(null);

  function collect() {
    if (visibleSince === null) return;
    const now = Date.now();
    pending.app_seconds! += Math.round((now - visibleSince) / 1000);
    visibleSince = document.hidden ? null : now;
  }
  function flush(keepalive: boolean) {
    if (!on) return;
    collect();
    const ev: Record<string, number> = {};
    for (const k of Object.keys(pending)) if (pending[k]! > 0) { ev[k] = pending[k]!; pending[k] = 0; }
    if (Object.keys(ev).length) sendEvents(ev, keepalive).catch(() => {});
  }

  if (on) {
    setInterval(() => { if (!document.hidden) flush(false); }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush(true); else visibleSince = Date.now();
    });
    addEventListener('pagehide', () => flush(true));
  }

  return {
    on,
    async daily() { return (await sess)?.daily ?? null; },
    async tutorialDone() { const r = await sess; return r?.ok ? !!r.tutorialDone : null; },
    tutorial(how) { if (on) sendEvents({ [how]: 1 }, true).catch(() => {}); },
    add(event, n = 1) { if (on) pending[event] = (pending[event] ?? 0) + n; },
    practice(seed, taps, r, wallMs) {
      if (!on) return;
      sendPractice(seed, taps, r, wallMs).catch(() => {});
      flush(false);
    },
  };
}
