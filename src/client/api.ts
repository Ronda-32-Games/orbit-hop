/**
 * Llamadas al servidor. Practice se juega sin red; el servidor solo la anota.
 * El cuerpo va como text/plain para que sea un pedido CORS simple (sin pregunta previa):
 * así también sale con keepalive cuando la app se cierra.
 */
import type { Result } from '../rules/index.ts';
import { API_URL, tg } from './env.ts';
import type { TestMode } from './env.ts';

/** Tracking: solo dentro de Telegram, con servidor y fuera del modo de prueba (como Sum 32). */
export function trackingOn(mode: TestMode): boolean {
  return API_URL !== '' && !!tg()?.initData && !mode.test;
}

/** Daily: dentro de Telegram y con servidor; con seed o round no (no hay récord, DEC-038). */
export function dailyAvailable(mode: TestMode): boolean {
  return API_URL !== '' && !!tg()?.initData && !mode.noRecord;
}

async function post<T>(path: string, body: Record<string, unknown> = {}, keepalive = false): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: 'POST', keepalive, headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ initData: tg()!.initData, ...body }),
  });
  return await res.json() as T;
}

export interface DailyState { day: string; attemptsAllowed: number; attemptsUsed: number; attemptsLeft: number; best: { planet: number; score: number; label: string | null } | null; rank: number | null; players: number; resetsInMs: number }
export interface SessionOut { ok: boolean; daily?: DailyState; tutorialDone?: boolean; reason?: string }

export function session(): Promise<SessionOut> {
  return post('/api/session');
}

export interface DailyStart { ok: boolean; seed: number; day: string; token: string; rulesVersion: string; attemptsLeft: number; reason?: string }

export function startDaily(): Promise<DailyStart> {
  return post('/api/start', { mode: 'daily' });
}

export interface FinishOut { ok: boolean; result?: Result; reason?: string; checksumMatch?: boolean | null; improved?: boolean; daily?: DailyState }

export function finishDaily(token: string, taps: number[], r: Result): Promise<FinishOut> {
  return post('/api/finish', { token, taps, claim: { score: r.score, planet: r.planet, checksum: r.checksum } });
}

export function sendPractice(seed: number, taps: number[], r: Result, wallMs: number): Promise<unknown> {
  return post('/api/practice', { seed, taps, claim: { score: r.score, planet: r.planet, checksum: r.checksum }, wallMs });
}

export function sendEvents(events: Record<string, number>, keepalive: boolean): Promise<unknown> {
  return post('/api/event', { events }, keepalive);
}

export function deleteMyData(): Promise<{ ok: boolean; deleted?: boolean }> {
  return post('/api/me/delete');
}
