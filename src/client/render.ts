/**
 * Renderer — Dirección C «Neón Suave» (aprobada por Ignacio, 2026-11).
 * Fondo espacio profundo, objetos con glow neón, sin bordes duros.
 * Solo lee el estado: nada de lo que pasa acá cambia la partida,
 * así que acá sí se puede usar Math.*.
 */
import {
  astPos, fieldOf, kids, label, launchDir, puPos, shipOnOrbit, wallRadius,
  type GameState, type PNode, type PuType, type SimEvent,
} from '../rules/index.ts';

// ── Paleta base ────────────────────────────────────────────────────────────
const COL = {
  tinta: '#080814',   // fondo espacio profundo
  tinta2: '#12103a',  // fondo gradiente borde
  papel: '#F2EDE3',
  lima: '#C5F04A',
  coral: '#FF5A47',
  cielo: '#5EA2FF',
  amarillo: '#F4B740',
  lila: '#B98CFF',
  rosa: '#FF9AD5',
};

// ── Colores neón por planeta (4 tipos, cíclicos por n.num % 4) ─────────────
// 0 = círculo violeta, 1 = octágono cyan, 2 = oval pink-magenta, 3 = pentágono dorado
const PLANET_NEON = [
  { gIn: '#7040d0', gOut: '#c080ff', dot: 'rgba(192,128,255,0.7)', sides: 0, scaleY: 1.0,  detail: 'ring'   },
  { gIn: '#20a090', gOut: '#40e8d0', dot: 'rgba(64,232,208,0.7)',  sides: 8, scaleY: 1.0,  detail: 'crater' },
  { gIn: '#c02080', gOut: '#ff60c0', dot: 'rgba(255,96,192,0.6)',  sides: 0, scaleY: 0.58, detail: 'cloud'  },
  { gIn: '#906010', gOut: '#f0c040', dot: 'rgba(240,192,64,0.65)', sides: 5, scaleY: 1.0,  detail: 'dot'    },
];

// Planeta especial #32: dorado brillante
const PLANET_32 = { gIn: '#a07010', gOut: '#ffd060', dot: 'rgba(255,210,80,0.8)', sides: 0, scaleY: 1.0, detail: 'ring' };
// Planeta rama B: violeta intenso
const PLANET_B  = { gIn: '#5020a0', gOut: '#9060e0', dot: 'rgba(160,96,240,0.75)', sides: 6, scaleY: 1.0, detail: 'crater' };

export const PU_STYLE: Record<PuType, { c: string; txt: string; icon: string }> = {
  grav:   { c: '#40d0c0', txt: 'GRAVITY', icon: '◆' },
  shield: { c: COL.cielo, txt: 'SHIELD',  icon: '○' },
  aim:    { c: COL.papel, txt: 'AIM',     icon: '⊕' },
  slow:   { c: COL.rosa,  txt: 'SLOW',    icon: '⧗' },
};
const FONT = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

interface Fx { x: number; y: number; life: number; c: string; txt: string; ring: boolean }

// ── Estrellas (fijas, generadas una sola vez) ──────────────────────────────
interface Star { x: number; y: number; r: number; a: number; twinkleOff: number }
const STARS: Star[] = Array.from({ length: 90 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: 0.4 + Math.random() * 1.1,
  a: 0.35 + Math.random() * 0.65,
  twinkleOff: Math.random() * Math.PI * 2,
}));

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private W = 0; private H = 0; private dpr = 1; private zoom = 1;
  private cam = { x: 0, y: -60 };
  private fx: Fx[] = [];
  private trail: { x: number; y: number }[] = [];
  private visited: PNode[] = [];
  private t = 0;
  private lastCur: PNode | null = null;

  constructor(private cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d', { alpha: false })!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2.5);
    this.W = this.cv.clientWidth; this.H = this.cv.clientHeight;
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
    this.zoom = Math.max(0.55, Math.min(1.25, this.W / 420, this.H / 760));
  }

  reset(s: GameState) {
    this.fx = []; this.trail = []; this.visited = []; this.lastCur = s.cur;
    const p = s.cur;
    this.cam = { x: p.x, y: p.y - 60 };
  }

  onEvents(evs: SimEvent[]) {
    for (const e of evs) {
      switch (e.type) {
        case 'capture': {
          const txt = e.depth > 1 ? `SKIP x${e.depth}` : e.perfect ? 'PERFECT' : '';
          this.add(e.x, e.y, e.perfect ? COL.lima : COL.cielo, txt);
          break;
        }
        case 'launch': this.trail = []; break;
        case 'miss': this.trail = []; this.add(e.x, e.y, COL.coral, 'BOOM'); break;
        case 'asteroidBroken': this.add(e.x, e.y, '#40e8d0', 'CRASH!'); break;
        case 'powerup': this.add(e.x, e.y, PU_STYLE[e.pu].c, PU_STYLE[e.pu].txt, 1.3); break;
        case 'timeBonus': this.add(e.x, e.y + 46, COL.lima, `+${Math.round(e.ticks / 60)}s`, 1.2, false); break;
        case 'bonus32': this.add(e.x, e.y, COL.amarillo, '32!', 1.6); break;
      }
    }
  }

  private add(x: number, y: number, c: string, txt: string, life = 1, ring = true) {
    this.fx.push({ x, y, c, txt, life, ring });
  }

  draw(s: GameState, dtS: number) {
    const x = this.ctx, Z = this.zoom;
    this.t += dtS;
    if (this.lastCur && this.lastCur !== s.cur) {
      this.visited.push(this.lastCur);
      if (this.visited.length > 2) this.visited.shift();
    }
    this.lastCur = s.cur;
    const ship = s.fly ? { x: s.fly.x, y: s.fly.y } : shipOnOrbit(s);
    if (s.fly) { this.trail.push(ship); if (this.trail.length > 22) this.trail.shift(); }
    else if (this.trail.length) this.trail.shift();

    const tg = s.fly ?? s.cur;
    const k = 1 - Math.pow(0.92, dtS * 60);
    this.cam.x += (tg.x - this.cam.x) * k;
    this.cam.y += (tg.y - 60 - this.cam.y) * k;

    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // ── Fondo espacio profundo ─────────────────────────────────────────────
    const bg = x.createRadialGradient(this.W / 2, this.H / 2, 0, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
    bg.addColorStop(0, '#12103a');
    bg.addColorStop(1, '#080814');
    x.fillStyle = bg;
    x.fillRect(0, 0, this.W, this.H);

    // ── Estrellas ──────────────────────────────────────────────────────────
    x.save();
    for (const s2 of STARS) {
      const tw = 0.85 + 0.15 * Math.sin(this.t * 1.8 + s2.twinkleOff);
      const alpha = s2.a * tw;
      x.shadowColor = 'rgba(220,220,255,' + (alpha * 0.6) + ')';
      x.shadowBlur = s2.r * 3;
      x.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      x.beginPath();
      x.arc(s2.x * this.W, s2.y * this.H, s2.r, 0, Math.PI * 2);
      x.fill();
    }
    x.shadowBlur = 0;
    x.restore();

    x.save();
    x.translate(this.W / 2, this.H * 0.62);
    x.scale(Z, Z);
    x.translate(-this.cam.x, -this.cam.y);

    // ── Pared (radio de alcance) ───────────────────────────────────────────
    const wr = wallRadius(s);
    x.strokeStyle = 'rgba(255,90,71,.25)';
    x.shadowColor = 'rgba(255,90,71,.3)'; x.shadowBlur = 8;
    x.lineWidth = 2;
    x.beginPath(); x.arc(s.cur.x, s.cur.y, wr, 0, Math.PI * 2); x.stroke();
    x.shadowBlur = 0;

    // ── Líneas de árbol ───────────────────────────────────────────────────
    const vis = this.visible(s);
    const next = kids(s.cur, s.rules);
    x.lineWidth = 1;
    for (const n of vis) {
      if (n.par && vis.includes(n.par)) {
        x.strokeStyle = 'rgba(180,150,255,.07)';
        x.beginPath(); x.moveTo(n.par.x, n.par.y); x.lineTo(n.x, n.y); x.stroke();
      }
    }

    // ── Campo orbital (círculo punteado) ──────────────────────────────────
    for (const n of vis) {
      const isNext = next.includes(n);
      const ahead = n.num > s.cur.num;
      const def = this.planetDef(n);
      const orbitAlpha = isNext ? (s.grav > 0 ? 0.75 : 0.45) : ahead ? 0.15 : 0.06;
      x.strokeStyle = isNext
        ? `rgba(${isNext && s.grav > 0 ? '197,240,74' : def.gOut.replace('#', '').match(/../g)!.map(h => parseInt(h, 16)).join(',')}, ${orbitAlpha})`
        : `rgba(200,180,255,${orbitAlpha})`;
      x.lineWidth = 1.2; x.setLineDash([4, 7]);
      x.beginPath(); x.arc(n.x, n.y, fieldOf(s, n), 0, Math.PI * 2); x.stroke();
      x.setLineDash([]);
    }

    for (const n of vis) this.drawPlanet(s, n, next.includes(n));
    for (const n of vis) if (n.par && vis.includes(n.par)) { this.drawAsteroid(s, n); this.drawPowerUp(n); }

    // ── Mira de lanzamiento ───────────────────────────────────────────────
    if (s.aim > 0 && !s.fly) {
      const d = launchDir(s);
      x.strokeStyle = 'rgba(220,200,255,.45)'; x.setLineDash([2, 9]);
      x.lineWidth = 1;
      x.beginPath(); x.moveTo(ship.x, ship.y); x.lineTo(ship.x + d.x * wr, ship.y + d.y * wr); x.stroke();
      x.setLineDash([]);
    }

    this.drawTrail();
    this.drawShip(s, ship);
    this.drawFx(dtS);
    x.restore();
  }

  // ── Selector de definición de planeta ─────────────────────────────────────
  private planetDef(n: PNode) {
    if (n.num === 32) return PLANET_32;
    if (n.br === 'b') return PLANET_B;
    return PLANET_NEON[n.num % 4]!;
  }

  // ── Helpers de forma ──────────────────────────────────────────────────────
  /** Traza un polígono regular de `sides` lados centrado en (0,0) radio `r`. */
  private polyPath(sides: number, r: number, angleOff = 0) {
    const x = this.ctx;
    x.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + angleOff;
      if (i === 0) x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath();
  }

  // ── Planeta ────────────────────────────────────────────────────────────────
  private drawPlanet(s: GameState, n: PNode, isNext: boolean) {
    const x = this.ctx;
    const def = this.planetDef(n);
    const R = 16;
    const alive = n.num <= s.cur.num || isNext || n.num > s.cur.num;

    x.save();
    x.translate(n.x, n.y);

    // Glow exterior difuso del planeta
    const glowAlpha = alive ? 0.55 : 0.25;
    x.shadowColor = def.gOut;
    x.shadowBlur = 18;

    // Gradiente radial interior→exterior
    const gr = x.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
    gr.addColorStop(0, def.gIn);
    gr.addColorStop(1, def.gOut);
    x.fillStyle = gr;
    x.globalAlpha = glowAlpha + (alive ? 0.45 : 0);

    if (def.sides === 0) {
      // Círculo o elipse
      x.scale(1, def.scaleY);
      x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill();
    } else {
      // Polígono regular
      const angleOff = -Math.PI / 2;
      x.scale(1, def.scaleY);
      this.polyPath(def.sides, R, angleOff);
      x.fill();
    }
    x.shadowBlur = 0;
    x.globalAlpha = 1;
    x.restore();

    // ── Número en el centro ────────────────────────────────────────────────
    x.save();
    x.translate(n.x, n.y);
    x.shadowColor = 'rgba(0,0,0,0.7)'; x.shadowBlur = 4;
    x.fillStyle = 'rgba(255,255,255,0.92)';
    x.font = `700 11px ${FONT}`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label(n), 0, 1);
    x.shadowBlur = 0;
    x.restore();

    // ── Puntos orbitales (dots) ────────────────────────────────────────────
    const dotCount = 6;
    const orbitR = fieldOf(s, n);
    const dotAlpha = isNext ? 0.55 : n.num > s.cur.num ? 0.28 : 0.14;
    x.save();
    x.translate(n.x, n.y);
    for (let i = 0; i < dotCount; i++) {
      const a = (i / dotCount) * Math.PI * 2 + this.t * 0.25;
      const dx = Math.cos(a) * orbitR, dy = Math.sin(a) * orbitR;
      x.fillStyle = def.dot.replace(/[\d.]+\)$/, `${dotAlpha})`);
      x.beginPath(); x.arc(dx, dy, 1.5, 0, Math.PI * 2); x.fill();
    }
    x.restore();
  }

  // ── Asteroide ─────────────────────────────────────────────────────────────
  private drawAsteroid(s: GameState, n: PNode) {
    if (!n.ast || n.ast.dead) return;
    const x = this.ctx, q = astPos(n, s.astT), R = s.rules.astR;

    x.save();
    x.translate(q.x, q.y);

    // Glow rojo-naranja de peligro
    x.shadowColor = 'rgba(255,80,20,0.85)';
    x.shadowBlur = 18;

    // Roca marrón: forma irregular (7 vértices)
    x.fillStyle = '#7a5a3a';
    x.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + this.t * 0.6;
      const rr = R * (i % 2 ? 0.78 : 1.0);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
    x.fill();

    // Borde naranja neón
    x.shadowColor = 'rgba(255,80,20,0.7)';
    x.shadowBlur = 10;
    x.strokeStyle = 'rgba(255,100,30,0.95)';
    x.lineWidth = 2;
    x.stroke();

    x.shadowBlur = 0;
    x.restore();
  }

  // ── Power-up ───────────────────────────────────────────────────────────────
  private drawPowerUp(n: PNode) {
    if (!n.pu || n.pu.taken) return;
    const x = this.ctx, q = puPos(n), pulse = 9 + Math.sin(this.t * 5) * 2, st = PU_STYLE[n.pu.t];

    x.save();
    x.translate(q.x, q.y);
    x.shadowColor = st.c;
    x.shadowBlur = 14;
    x.strokeStyle = st.c;
    x.fillStyle = st.c;
    x.lineWidth = 2.5;

    switch (n.pu.t) {
      case 'grav': {
        // 4 flechas apuntando hacia el centro (gravity well)
        const arrowLen = pulse * 1.05;
        const arrowTip = pulse * 0.52;
        const hw = pulse * 0.26; // ancho cabeza de flecha
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const tx = Math.cos(a), ty = Math.sin(a);
          const nx2 = -ty, ny2 = tx; // normal
          // Cola → punta (hacia centro)
          const tailX = tx * arrowLen, tailY = ty * arrowLen;
          const tipX  = tx * arrowTip, tipY  = ty * arrowTip;
          // Cabeza de flecha
          const hx1 = tipX + nx2 * hw + tx * hw, hy1 = tipY + ny2 * hw + ty * hw;
          const hx2 = tipX - nx2 * hw + tx * hw, hy2 = tipY - ny2 * hw + ty * hw;
          x.beginPath();
          x.moveTo(tailX, tailY);
          x.lineTo(tipX, tipY);
          x.stroke();
          x.beginPath();
          x.moveTo(tipX, tipY);
          x.lineTo(hx1, hy1);
          x.lineTo(hx2, hy2);
          x.closePath();
          x.fill();
        }
        // Punto central
        x.shadowBlur = 20;
        x.fillStyle = 'rgba(64,208,192,0.95)';
        x.beginPath(); x.arc(0, 0, 3.5, 0, Math.PI * 2); x.fill();
        // Ring difuso exterior
        x.globalAlpha = 0.3;
        x.beginPath(); x.arc(0, 0, arrowLen + 4, 0, Math.PI * 2); x.stroke();
        x.globalAlpha = 1;
        break;
      }
      case 'shield': {
        x.lineWidth = 2;
        x.beginPath(); x.arc(0, 0, pulse, 0, Math.PI * 2); x.stroke();
        // segundo anillo más tenue
        x.globalAlpha = 0.35;
        x.beginPath(); x.arc(0, 0, pulse + 5, 0, Math.PI * 2); x.stroke();
        x.globalAlpha = 1;
        break;
      }
      case 'aim': {
        x.beginPath();
        x.arc(0, 0, pulse * 0.7, 0, Math.PI * 2); x.stroke();
        x.beginPath();
        x.moveTo(-pulse, 0); x.lineTo(pulse, 0);
        x.moveTo(0, -pulse); x.lineTo(0, pulse);
        x.stroke();
        break;
      }
      case 'slow': {
        // Reloj de arena (hourglass)
        const hs = pulse * 0.7;
        x.beginPath();
        x.moveTo(-hs, -hs); x.lineTo(hs, -hs); x.lineTo(-hs, hs); x.lineTo(hs, hs); x.closePath();
        x.stroke();
        // Punto central
        x.beginPath(); x.arc(0, 0, 2.5, 0, Math.PI * 2); x.fill();
        break;
      }
    }

    x.shadowBlur = 0;
    x.restore();
  }

  // ── Trail ─────────────────────────────────────────────────────────────────
  private drawTrail() {
    const x = this.ctx, tr = this.trail;
    x.save();
    x.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const prog = i / tr.length;
      // violeta → cyan gradient
      const r = Math.round(160 - prog * 96);   // 160→64
      const g = Math.round(80  + prog * 152);  // 80→232
      const b = Math.round(255 - prog * 55);   // 255→200
      const a = prog * 0.75;
      x.shadowColor = `rgb(${r},${g},${b})`;
      x.shadowBlur = 8 * prog;
      x.strokeStyle = `rgba(${r},${g},${b},${a})`;
      x.lineWidth = 1 + prog * 6;
      x.beginPath();
      x.moveTo(tr[i - 1]!.x, tr[i - 1]!.y);
      x.lineTo(tr[i]!.x, tr[i]!.y);
      x.stroke();
    }
    x.shadowBlur = 0;
    x.restore();
  }

  // ── Nave ──────────────────────────────────────────────────────────────────
  private drawShip(s: GameState, p: { x: number; y: number }) {
    const x = this.ctx, R = s.rules.shipR;

    // Glow blanco neón
    x.shadowColor = 'rgba(255,255,255,0.9)';
    x.shadowBlur = 16;
    x.fillStyle = '#e8e0ff';  // blanco levemente violáceo
    x.beginPath(); x.arc(p.x, p.y, R, 0, Math.PI * 2); x.fill();

    // Punto interior violeta
    x.shadowBlur = 0;
    x.fillStyle = '#a060ff';
    x.beginPath(); x.arc(p.x, p.y, R * 0.38, 0, Math.PI * 2); x.fill();

    // Shield bubble
    if (s.shield) {
      x.shadowColor = COL.cielo; x.shadowBlur = 12;
      x.strokeStyle = COL.cielo; x.lineWidth = 2;
      x.globalAlpha = 0.7;
      x.beginPath(); x.arc(p.x, p.y, 14 + Math.sin(this.t * 6), 0, Math.PI * 2); x.stroke();
      x.globalAlpha = 1;
      x.shadowBlur = 0;
    }
    x.lineWidth = 1;
  }

  // ── FX flotantes ──────────────────────────────────────────────────────────
  private drawFx(dtS: number) {
    const x = this.ctx;
    for (const e of this.fx) {
      e.life -= dtS * 1.2;
      const a = Math.max(0, Math.min(1, e.life)), g = 1 - a;
      x.globalAlpha = a;
      x.shadowColor = e.c; x.shadowBlur = 10;
      if (e.ring) { x.strokeStyle = e.c; x.lineWidth = 1.5; x.beginPath(); x.arc(e.x, e.y, 20 + g * 40, 0, Math.PI * 2); x.stroke(); }
      if (e.txt) { x.fillStyle = e.c; x.font = `700 14px ${FONT}`; x.textAlign = 'center'; x.fillText(e.txt, e.x, e.y - 34 - g * 20); }
    }
    x.globalAlpha = 1;
    x.shadowBlur = 0;
    x.lineWidth = 1;
    this.fx = this.fx.filter(e => e.life > 0);
  }

  private visible(s: GameState): PNode[] {
    const out = [...this.visited.filter(n => n !== s.cur), s.cur];
    let lvl = [s.cur];
    for (let d = 0; d < s.rules.reach; d++) {
      const nx: PNode[] = [];
      for (const n of lvl) for (const c of kids(n, s.rules)) { nx.push(c); out.push(c); }
      lvl = nx;
    }
    return out;
  }
}
