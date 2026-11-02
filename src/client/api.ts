/** Llamadas al servidor (solo Daily). Practice funciona sin red. */
import type { Result } from '../rules/index.ts';
import { API_URL, tg } from './env.ts';

export function dailyAvailable(): boolean {
  return API_URL !== '' && !!tg()?.initData;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return await res.json() as T;
}

export interface DailyStart { ok: boolean; seed: number; day: string; token: string; rulesVersion: string; reason?: string }

export function startDaily(): Promise<DailyStart> {
  return post('/api/start', { initData: tg()!.initData, mode: 'daily' });
}

export interface FinishOut { ok: boolean; result?: Result; reason?: string; checksumMatch?: boolean | null }

export function finishDaily(token: string, taps: number[], r: Result): Promise<FinishOut> {
  return post('/api/finish', {
    initData: tg()!.initData, token, taps,
    claim: { score: r.score, planet: r.planet, checksum: r.checksum },
  });
}
