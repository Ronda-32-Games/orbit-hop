/**
 * Cliente: entrada, bucle de pasos fijos, HUD y pantallas.
 * El toque se guarda y se aplica en el próximo tick, igual que en el replay
 * del servidor: tick N → tap() → step(). Solo se anotan los toques con efecto.
 */
import { label, makeRules, newGame, RULES, resultOf, step, tap, type GameState, type Result } from '../rules/index.ts';
import { dailyAvailable, finishDaily, startDaily } from './api.ts';
import { haptic, initTelegram, readTestMode, storage } from './env.ts';
import { PU_STYLE, Renderer } from './render.ts';
import { runSelftest } from './selftest.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

initTelegram();
const mode = readTestMode();
const store = storage();
const rules = mode.roundS !== null ? makeRules({ roundS: mode.roundS }) : RULES;
const renderer = new Renderer($<HTMLCanvasElement>('c'));

type Phase = 'menu' | 'loading' | 'playing' | 'paused' | 'result';
let phase: Phase = 'menu';
let s: GameState = newGame(mode.seed ?? 7, rules, true);
let taps: number[] = [];
let pendingTap = false;
let daily: { token: string; day: string } | null = null;
renderer.reset(s);

const DT = 1 / rules.tickHz;
const PAUSE_GAP_S = 1; // DEC-039: un salto de más de 1 s pausa sin descontar
let acc = 0, last = performance.now();
let fps = 0, fpsMin = 999, frames = 0, fpsT = 0;

// ---- pantallas ----------------------------------------------------------
function show(id: string | null) {
  for (const o of ['menu', 'pause', 'result', 'selftest']) $(o).hidden = o !== id;
}

function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

function begin(seed: number) {
  s = newGame(seed, rules, true);
  taps = []; pendingTap = false; acc = 0; last = performance.now();
  fpsMin = 999; fps = 0;
  renderer.reset(s);
  phase = 'playing';
  show(null);
}

async function beginDaily() {
  phase = 'loading';
  $('m-note').textContent = 'Loading today’s Daily…';
  try {
    const r = await startDaily();
    if (!r.ok) throw new Error(r.reason);
    daily = { token: r.token, day: r.day };
    begin(r.seed);
  } catch (e) {
    phase = 'menu';
    $('m-note').textContent = 'Could not reach the server. Try Practice.';
  }
}

function beginPractice() {
  daily = null;
  begin(mode.seed ?? newSeed());
}

async function finish() {
  phase = 'result';
  const r = resultOf(s);
  show('result');
  const again = $<HTMLButtonElement>('b-again'), menu = $<HTMLButtonElement>('b-menu');
  // DEC-039: resultado protegido 0,8 s para que un toque tardío no lo cierre.
  again.disabled = menu.disabled = true;
  setTimeout(() => { again.disabled = menu.disabled = false; }, 800);

  $('r-planet').textContent = `Planet ${r.label}`;
  $('r-line').textContent = `${r.score} pts · ${r.perfects} perfect · ${r.taps} taps`;
  $('r-mode').textContent = daily ? `Daily ${daily.day}` : mode.noRecord ? 'Test run (no record)' : 'Practice';
  $('r-best').textContent = '';

  if (daily) {
    $('r-best').textContent = 'Checking score…';
    again.hidden = true;
    try {
      const out = await finishDaily(daily.token, taps, r);
      $('r-best').textContent = out.ok ? 'Score confirmed ✓' : `Score not accepted (${out.reason})`;
    } catch {
      $('r-best').textContent = 'Could not send the score.';
    }
  } else {
    again.hidden = false;
    if (!mode.noRecord) savePracticeBest(r);
  }
}

function savePracticeBest(r: Result) {
  const best = store.get<{ planet: number; score: number; label: string }>('oh.best');
  const better = !best || r.planet > best.planet || (r.planet === best.planet && r.score > best.score);
  if (better) store.set('oh.best', { planet: r.planet, score: r.score, label: r.label });
  const b = better ? r : best!;
  $('r-best').textContent = better && best ? 'New best!' : `Best: planet ${b.label} · ${b.score} pts`;
}

// ---- entrada ------------------------------------------------------------
function onPress(e: Event) {
  if (phase === 'playing') { pendingTap = true; e.preventDefault(); }
  else if (phase === 'paused') { phase = 'playing'; last = performance.now(); acc = 0; show(null); e.preventDefault(); }
}
$('c').addEventListener('pointerdown', e => { if (e.isPrimary) onPress(e); });
$('pause').addEventListener('pointerdown', onPress);
addEventListener('keydown', e => { if (e.code === 'Space') onPress(e); });

$('b-practice').onclick = beginPractice;
$('b-daily').onclick = () => { void beginDaily(); };
$('b-again').onclick = () => (daily ? null : beginPractice());
$('b-menu').onclick = () => { phase = 'menu'; daily = null; show('menu'); };
$('b-st-close').onclick = () => { phase = 'menu'; show('menu'); };

function pause() {
  if (phase !== 'playing') return;
  phase = 'paused';
  pendingTap = false;
  show('pause');
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---- bucle --------------------------------------------------------------
function frame(now: number) {
  requestAnimationFrame(frame);
  let d = (now - last) / 1000;
  last = now;
  if (phase === 'playing') {
    if (d > PAUSE_GAP_S) { pause(); d = 0; }
    acc += Math.min(d, 0.25);
    while (acc >= DT && !s.ended) {
      if (pendingTap) {
        pendingTap = false;
        const t = s.tick;
        if (tap(s)) { taps.push(t); haptic('tap'); }
      }
      step(s);
      acc -= DT;
      drainEvents();
    }
    if (s.ended) void finish();
    meter(d);
  }
  renderer.draw(s, Math.min(d, 0.1));
  hud();
}

function drainEvents() {
  const evs = s.events!;
  if (!evs.length) return;
  for (const e of evs) {
    if (e.type === 'capture') haptic(e.perfect ? 'good' : 'tap');
    else if (e.type === 'miss') haptic('bad');
  }
  renderer.onEvents(evs);
  evs.length = 0;
}

function meter(d: number) {
  if (!mode.test || d <= 0) return;
  frames++; fpsT += d;
  if (fpsT >= 0.5) {
    const f = frames / fpsT;
    fps = fps ? fps * 0.7 + f * 0.3 : f;
    if (f < fpsMin) fpsMin = f;
    frames = 0; fpsT = 0;
  }
}

const H = { pl: $('h-pl'), sc: $('h-sc'), cb: $('h-cb'), tm: $('h-tm'), pu: $('pu'), ms: $('ms') };
function hud() {
  H.pl.textContent = label(s.cur);
  H.sc.textContent = String(s.score);
  H.cb.textContent = `x${s.combo}`;
  H.tm.textContent = (s.ticksLeft / rules.tickHz).toFixed(1);
  const pu: string[] = [];
  if (s.grav > 0) pu.push(`${PU_STYLE.grav.icon}${s.grav}`);
  if (s.shield) pu.push(PU_STYLE.shield.icon);
  if (s.aim > 0) pu.push(`${PU_STYLE.aim.icon}${s.aim}`);
  if (s.slowLeft > 0) pu.push(PU_STYLE.slow.icon);
  H.pu.textContent = pu.join('  ');
  if (mode.test) {
    H.ms.textContent = `fps ${fps.toFixed(0)} · min ${fpsMin === 999 ? '—' : fpsMin.toFixed(0)} · seed ${s.seed} · tick ${s.tick} · taps ${taps.length} · ${s.checksum.toString(16)}${mode.roundS ? ` · round ${mode.roundS}s` : ''}`;
  }
}

// Gancho para pruebas automáticas (solo en modo de prueba).
if (mode.test) {
  (globalThis as unknown as { __oh: unknown }).__oh = {
    get s() { return s; }, get taps() { return taps; }, get phase() { return phase; },
    press() { if (phase === 'playing') pendingTap = true; },
  };
}

// ---- arranque -----------------------------------------------------------
$('ms').hidden = !mode.test;
$('b-daily').hidden = !dailyAvailable();
if (mode.selftest) {
  const r = runSelftest();
  $('st-out').textContent = r.text;
  $('selftest').querySelector('h1')!.textContent = r.pass ? 'Self-test PASS' : 'Self-test FAIL';
  show('selftest');
} else {
  show('menu');
}
requestAnimationFrame(frame);
