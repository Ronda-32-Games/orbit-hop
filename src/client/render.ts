/**
 * Dibujo con assets placeholder (formas en canvas). Solo lee el estado: nada
 * de lo que pasa acá cambia la partida, así que acá sí se puede usar Math.*.
 * Cuando lleguen los assets de Lía se reemplazan las funciones draw*.
 */
import {
  astPos, fieldOf, kids, label, launchDir, puPos, shipOnOrbit, wallRadius,
  type GameState, type PNode, type PuType, type SimEvent,
} from '../rules/index.ts';

const COL = {
  tinta: '#151A2D', tinta2: '#232A45', papel: '#F2EDE3', lima: '#C5F04A', coral: '#FF5A47',
  cielo: '#5EA2FF', amarillo: '#F4B740', lila: '#B98CFF', rosa: '#FF9AD5',
};
export const PU_STYLE: Record<PuType, { c: string; txt: string; icon: string }> = {
  grav: { c: COL.lima, txt: 'GRAVITY', icon: '◆' },
  shield: { c: COL.cielo, txt: 'SHIELD', icon: '○' },
  aim: { c: COL.papel, txt: 'AIM', icon: '⊕' },
  slow: { c: COL.rosa, txt: 'SLOW', icon: '⧗' },
};
const FONT = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

interface Fx { x: number; y: number; life: number; c: string; txt: string; ring: boolean }

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
    // Se ven ~3 planetas adelante: unos 420 x 760 px de mundo.
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
        case 'asteroidBroken': this.add(e.x, e.y, COL.cielo, 'CRASH!'); break;
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
    x.fillStyle = COL.tinta; x.fillRect(0, 0, this.W, this.H);
    x.save();
    x.translate(this.W / 2, this.H * 0.62);
    x.scale(Z, Z);
    x.translate(-this.cam.x, -this.cam.y);

    // pared
    const wr = wallRadius(s);
    x.strokeStyle = 'rgba(255,90,71,.35)'; x.lineWidth = 3;
    x.beginPath(); x.arc(s.cur.x, s.cur.y, wr, 0, Math.PI * 2); x.stroke();

    const vis = this.visible(s);
    const next = kids(s.cur, s.rules);
    x.lineWidth = 1;
    for (const n of vis) {
      if (n.par && vis.includes(n.par)) {
        x.strokeStyle = 'rgba(242,237,227,.06)';
        x.beginPath(); x.moveTo(n.par.x, n.par.y); x.lineTo(n.x, n.y); x.stroke();
      }
    }
    for (const n of vis) this.drawPlanet(s, n, next.includes(n));
    for (const n of vis) if (n.par && vis.includes(n.par)) { this.drawAsteroid(s, n); this.drawPowerUp(n); }

    // mira
    if (s.aim > 0 && !s.fly) {
      const d = launchDir(s);
      x.strokeStyle = 'rgba(242,237,227,.5)'; x.setLineDash([2, 8]);
      x.beginPath(); x.moveTo(ship.x, ship.y); x.lineTo(ship.x + d.x * wr, ship.y + d.y * wr); x.stroke();
      x.setLineDash([]);
    }
    this.drawTrail();
    this.drawShip(s, ship);
    this.drawFx(dtS);
    x.restore();
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

  private drawPlanet(s: GameState, n: PNode, isNext: boolean) {
    const x = this.ctx;
    const ahead = n.num > s.cur.num;
    x.strokeStyle = isNext ? (s.grav > 0 ? 'rgba(197,240,74,.9)' : 'rgba(197,240,74,.55)')
      : ahead ? 'rgba(242,237,227,.18)' : 'rgba(242,237,227,.06)';
    x.lineWidth = 1.5; x.setLineDash([4, 6]);
    x.beginPath(); x.arc(n.x, n.y, fieldOf(s, n), 0, Math.PI * 2); x.stroke();
    x.setLineDash([]);
    x.fillStyle = n.num === 32 ? COL.amarillo : n.br === 'b' ? COL.lila : !ahead ? COL.cielo : COL.papel;
    x.beginPath(); x.arc(n.x, n.y, 16, 0, Math.PI * 2); x.fill();
    x.fillStyle = COL.tinta; x.font = `700 12px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label(n), n.x, n.y + 1);
  }

  private drawAsteroid(s: GameState, n: PNode) {
    if (!n.ast || n.ast.dead) return;
    const x = this.ctx, q = astPos(n, s.astT), R = s.rules.astR;
    x.fillStyle = COL.coral; x.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + this.t, rr = R * (i % 2 ? 0.8 : 1);
      x.lineTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr);
    }
    x.closePath(); x.fill();
  }

  private drawPowerUp(n: PNode) {
    if (!n.pu || n.pu.taken) return;
    const x = this.ctx, q = puPos(n), s = 9 + Math.sin(this.t * 5) * 2, st = PU_STYLE[n.pu.t];
    x.fillStyle = x.strokeStyle = st.c; x.lineWidth = 3; x.beginPath();
    switch (n.pu.t) {
      case 'grav': x.moveTo(q.x, q.y - s); x.lineTo(q.x + s, q.y); x.lineTo(q.x, q.y + s); x.lineTo(q.x - s, q.y); x.closePath(); x.fill(); break;
      case 'shield': x.arc(q.x, q.y, s, 0, Math.PI * 2); x.stroke(); break;
      case 'aim': x.arc(q.x, q.y, s * 0.7, 0, Math.PI * 2); x.moveTo(q.x - s, q.y); x.lineTo(q.x + s, q.y); x.moveTo(q.x, q.y - s); x.lineTo(q.x, q.y + s); x.stroke(); break;
      case 'slow': x.moveTo(q.x - s, q.y - s); x.lineTo(q.x + s, q.y - s); x.lineTo(q.x - s, q.y + s); x.lineTo(q.x + s, q.y + s); x.closePath(); x.fill(); break;
    }
    x.lineWidth = 1;
  }

  private drawTrail() {
    const x = this.ctx, tr = this.trail;
    x.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      x.strokeStyle = `rgba(197,240,74,${(i / tr.length) * 0.7})`; x.lineWidth = 1 + (i / tr.length) * 6;
      x.beginPath(); x.moveTo(tr[i - 1]!.x, tr[i - 1]!.y); x.lineTo(tr[i]!.x, tr[i]!.y); x.stroke();
    }
    x.lineWidth = 1;
  }

  private drawShip(s: GameState, p: { x: number; y: number }) {
    const x = this.ctx;
    x.fillStyle = COL.lima; x.beginPath(); x.arc(p.x, p.y, s.rules.shipR, 0, Math.PI * 2); x.fill();
    if (s.shield) {
      x.strokeStyle = COL.cielo; x.lineWidth = 2;
      x.beginPath(); x.arc(p.x, p.y, 13 + Math.sin(this.t * 6), 0, Math.PI * 2); x.stroke(); x.lineWidth = 1;
    }
  }

  private drawFx(dtS: number) {
    const x = this.ctx;
    for (const e of this.fx) {
      e.life -= dtS * 1.2;
      const a = Math.max(0, Math.min(1, e.life)), g = 1 - a;
      x.globalAlpha = a;
      if (e.ring) { x.strokeStyle = e.c; x.beginPath(); x.arc(e.x, e.y, 20 + g * 40, 0, Math.PI * 2); x.stroke(); }
      if (e.txt) { x.fillStyle = e.c; x.font = `700 14px ${FONT}`; x.textAlign = 'center'; x.fillText(e.txt, e.x, e.y - 34 - g * 20); }
    }
    x.globalAlpha = 1;
    this.fx = this.fx.filter(e => e.life > 0);
  }
}
