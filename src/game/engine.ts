import type { Fluid, ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { CAP, FILL_RATE, GOAL_ATOMS, N_FLASKS, POUR_RATE } from './config';
import { FAUCETS, faucetOutput, type Faucet } from './faucets';
import { LOOK, coronaAlpha, coronaRadius, css, glowFalloff, haloAlpha, haloRadius, type RGB } from './appearance';
import { Flask, fluidColor, glowColor, transfer, type Point } from './flask';
import { DEFAULT_PRESET, applyFill, type Preset } from './presets';

/** What the god-mode panel needs to show for one flask. */
export interface Inspection {
  T: number;
  N: number;
  cap: number;
  /** Species present, by atom count, largest first. */
  rows: { species: number; atoms: number }[];
  /** Where the flask is drawn, in stage coordinates. */
  x: number;
  y: number;
  scale: number;
  stageW: number;
  stageH: number;
}

export interface EngineCallbacks {
  /** Target atoms across all flasks, rounded. Called only when it changes. */
  onProgress(targetAtoms: number): void;
  onWin(): void;
  /** Throttled to ~10 Hz; null when nothing is inspected. */
  onInspect(info: Inspection | null): void;
}

type Zone = { kind: 'flask'; f: Flask } | { kind: 'faucet'; fa: FaucetLayout } | { kind: 'sink' };
type FaucetLayout = Faucet & { x: number; output: Fluid };

interface Layout {
  pipeY: number;
  spoutY: number;
  fillMouthY: number;
  faucets: FaucetLayout[];
  sink: { cx: number; top: number; w: number; h: number };
  homes: Point[];
}

const THEME_KEYS = ['ink', 'muted', 'line', 'bench', 'glass', 'glasshi', 'pipe', 'accent', 'shadow'] as const;
type Theme = Record<(typeof THEME_KEYS)[number], string>;

const GLOW_STOPS = 32;

const FLASK_PATH = new Path2D('M-11 0 L11 0 L9 22 L26 64 Q28 70 22 70 L-22 70 Q-28 70 -26 64 L-9 22 Z');

/** Owns the canvas: layout, pointer input, the simulation loop and drawing. */
export class GameEngine {
  speed = 1;
  god = true;

  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private S = 1;
  private dpr = 1;
  private L: Layout = {
    pipeY: 0, spoutY: 0, fillMouthY: 0, faucets: [],
    sink: { cx: 0, top: 0, w: 0, h: 0 }, homes: [],
  };
  private flasks: Flask[] = [];
  private drag: { flask: Flask; zone: Zone | null } | null = null;
  private hover: Flask | null = null;
  private pointer: Point = { x: -1, y: -1 };
  private won = false;
  private lastProgress = -1;
  private inspected: Flask | null = null;
  private lastInspect = 0;
  private theme = {} as Theme;
  private last = performance.now();
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private cleanups: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private stage: HTMLElement,
    private chem: ReactionNetwork,
    private cb: EngineCallbacks,
    private preset: Preset = DEFAULT_PRESET,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(stage);
    this.layout();
    this.reset();
    this.bindInput();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const c of this.cleanups) c();
  }

  /** Restart from the current preset. */
  reset(): void {
    this.load(this.preset);
  }

  load(preset: Preset): void {
    this.preset = preset;
    this.flasks = this.L.homes.map((h, i) => {
      const f = new Flask(h, CAP);
      applyFill(f, preset.flasks[i] ?? null);
      return f;
    });
    this.won = false;
    this.drag = null;
    this.hover = null;
    this.lastProgress = -1;
  }

  /* ---------------- layout ---------------- */

  private layout(): void {
    const { stage, canvas, L } = this;
    const W = (this.W = stage.clientWidth);
    const H = (this.H = stage.clientHeight);
    const dpr = (this.dpr = window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const S = (this.S = Math.max(0.55, Math.min(1.1, W / 760)));
    const nF = FAUCETS.length;
    L.pipeY = 30 * S;
    L.spoutY = 62 * S;
    L.fillMouthY = L.spoutY + 16 * S;
    L.faucets = FAUCETS.map((fa, i) => ({ ...fa, output: faucetOutput(fa), x: W * 0.06 + W * 0.72 * (i / (nF - 1)) }));
    L.sink = { cx: W * 0.905, top: 34 * S, w: 74 * S, h: 36 * S };
    const cols = W < 560 ? 4 : 8;
    const rows = Math.ceil(N_FLASKS / cols);
    L.homes = [];
    for (let i = 0; i < N_FLASKS; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const inRow = Math.min(cols, N_FLASKS - r * cols);
      L.homes.push({ x: (W * (c + 0.5)) / inRow, y: H - 22 - (rows - 1 - r) * 106 * S - 70 * S });
    }
    this.flasks.forEach((f, i) => {
      f.home = L.homes[i];
      if (this.drag?.flask !== f) {
        f.x = f.home.x;
        f.y = f.home.y;
      }
    });
  }

  /* ---------------- input ---------------- */

  private bindInput(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      c.addEventListener(type, fn);
      this.cleanups.push(() => c.removeEventListener(type, fn));
    };
    on('pointerdown', (e) => {
      const p = this.ptr(e);
      this.pointer = p;
      const f = this.hitFlask(p);
      if (f) {
        this.drag = { flask: f, zone: null };
        this.hover = null;
        c.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    });
    on('pointermove', (e) => {
      this.pointer = this.ptr(e);
      if (!this.drag) this.hover = this.hitFlask(this.pointer);
    });
    const endDrag = () => {
      if (!this.drag) return;
      const f = this.drag.flask;
      f.x = f.home.x;
      f.y = f.home.y;
      f.ang = 0;
      this.drag = null;
    };
    on('pointerup', endDrag);
    on('pointercancel', endDrag);
    on('pointerleave', () => {
      if (!this.drag) this.hover = null;
    });
    on('contextmenu', (e) => e.preventDefault());
  }

  private ptr(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitFlask(p: Point): Flask | null {
    const { S } = this;
    for (let i = this.flasks.length - 1; i >= 0; i--) {
      const f = this.flasks[i];
      if (this.drag?.flask === f) continue;
      if (p.x > f.home.x - 30 * S && p.x < f.home.x + 30 * S && p.y > f.home.y - 6 * S && p.y < f.home.y + 74 * S)
        return f;
    }
    return null;
  }

  private zoneAt(p: Point, D: Flask): Zone | null {
    const { S, L } = this;
    for (const f of this.flasks) {
      if (f === D) continue;
      if (p.x > f.home.x - 34 * S && p.x < f.home.x + 34 * S && p.y > f.home.y - 30 * S && p.y < f.home.y + 80 * S)
        return { kind: 'flask', f };
    }
    for (const fa of L.faucets) {
      if (Math.abs(p.x - fa.x) < 38 * S && p.y > L.pipeY && p.y < L.spoutY + 150 * S) return { kind: 'faucet', fa };
    }
    const k = L.sink;
    if (p.x > k.cx - k.w / 2 - 40 * S && p.x < k.cx + k.w / 2 + 40 * S && p.y > k.top - 30 * S && p.y < k.top + k.h + 110 * S)
      return { kind: 'sink' };
    return null;
  }

  /* ---------------- main loop ---------------- */

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { S, L, drag, pointer } = this;

    // player actions, real time
    if (drag) {
      const D = drag.flask;
      const z = (drag.zone = this.zoneAt(pointer, D));
      if (!z) {
        D.x = pointer.x;
        D.y = pointer.y - 45 * S;
        D.ang = 0;
      } else if (z.kind === 'faucet') {
        D.x = z.fa.x;
        D.y = L.fillMouthY;
        D.ang = 0;
        D.addFrom(z.fa.output, FILL_RATE * dt);
      } else if (z.kind === 'flask') {
        D.x = z.f.home.x + 16 * S;
        D.y = z.f.home.y - 32 * S;
        D.ang = Math.PI * 0.61;
        transfer(D, z.f, POUR_RATE * dt);
      } else {
        D.x = L.sink.cx + 16 * S;
        D.y = L.sink.top - 16 * S;
        D.ang = Math.PI * 0.61;
        transfer(D, null, POUR_RATE * dt);
      }
    }

    // chemistry, sim time
    const simDt = dt * this.speed;
    if (simDt > 0) {
      const sub = Math.ceil(simDt / 0.02);
      const h = simDt / sub;
      for (const f of this.flasks) for (let i = 0; i < sub; i++) this.chem.step(f, h);
    }

    // goal
    let tgt = 0;
    for (const f of this.flasks) tgt += f.n[TARGET] * 3;
    const rounded = Math.round(tgt);
    if (rounded !== this.lastProgress) {
      this.lastProgress = rounded;
      this.cb.onProgress(rounded);
    }
    if (tgt >= GOAL_ATOMS && !this.won) {
      this.won = true;
      this.cb.onWin();
    }

    this.draw();
    this.inspect(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  private inspect(now: number): void {
    const f = this.god ? (this.drag?.flask ?? this.hover) : null;
    if (!f) {
      if (this.inspected) this.cb.onInspect(null);
      this.inspected = null;
      return;
    }
    if (f === this.inspected && now - this.lastInspect < 100) return;
    this.inspected = f;
    this.lastInspect = now;
    const rows: Inspection['rows'] = [];
    for (let s = 0; s < NS; s++) {
      const atoms = f.n[s] * SPECIES[s].size;
      if (atoms > 0.05) rows.push({ species: s, atoms });
    }
    rows.sort((a, b) => b.atoms - a.atoms);
    const dragging = this.drag?.flask === f;
    this.cb.onInspect({
      T: f.T, N: f.N, cap: f.cap, rows,
      x: dragging ? f.x : f.home.x,
      y: dragging ? f.y : f.home.y,
      scale: this.S, stageW: this.W, stageH: this.H,
    });
  }

  /* ---------------- drawing ---------------- */

  private readTheme(): void {
    const cs = getComputedStyle(document.documentElement);
    for (const k of THEME_KEYS) this.theme[k] = cs.getPropertyValue('--' + k).trim();
  }

  private drawFlask(f: Flask, mx: number, my: number, ang: number): void {
    const { ctx, S, dpr, theme } = this;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.scale(S, S);
    if (f.N > 0.01) {
      // fill level is horizontal in screen space, even when the flask is tilted
      ctx.save();
      ctx.clip(FLASK_PATH);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const [lx, ly] of [[-28, 0], [28, 0], [-28, 70], [28, 70]]) {
        const wx = mx + S * (lx * c - ly * s);
        const wy = my + S * (lx * s + ly * c);
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const lvl = Math.min(1, f.N / f.cap);
      const top = maxY - lvl * (maxY - minY);
      ctx.fillStyle = fluidColor(f);
      ctx.fillRect(minX - 2, top, maxX - minX + 4, maxY - top + 2);
      ctx.restore();
    }
    ctx.fillStyle = theme.glasshi;
    ctx.fill(FLASK_PATH);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = theme.glass;
    ctx.stroke(FLASK_PATH);
    // highlight
    ctx.strokeStyle = theme.glasshi;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-15, 40);
    ctx.lineTo(-20, 60);
    ctx.stroke();
    ctx.restore();
  }

  private drawStream(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4 * this.S;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(x1, (y1 + y2) / 2, x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  private draw(): void {
    const { ctx, W, H, S, L, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.readTheme();
    const { theme } = this;
    ctx.font = `${Math.round(11 * Math.max(S, 0.85))}px "Schibsted Grotesk", sans-serif`;

    // shelves
    ctx.fillStyle = theme.bench;
    for (const y of new Set(L.homes.map((h) => h.y))) ctx.fillRect(0, y + 70 * S, W, 6 * S);

    // pipe + faucets
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 6 * S;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(L.faucets[0].x - 20 * S, L.pipeY);
    ctx.lineTo(L.faucets[L.faucets.length - 1].x + 20 * S, L.pipeY);
    ctx.stroke();
    for (const fa of L.faucets) {
      ctx.strokeStyle = theme.pipe;
      ctx.lineWidth = 5 * S;
      ctx.beginPath();
      ctx.moveTo(fa.x, L.pipeY);
      ctx.lineTo(fa.x, L.spoutY - 4 * S);
      ctx.stroke();
      ctx.fillStyle = theme.pipe;
      ctx.fillRect(fa.x - 5 * S, L.spoutY - 6 * S, 10 * S, 7 * S);
      ctx.fillStyle = fluidColor(fa.output);
      ctx.beginPath();
      ctx.arc(fa.x, L.pipeY, 10 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = theme.glass;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // sink
    const k = L.sink;
    ctx.fillStyle = theme.bench;
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.roundRect(k.cx - k.w / 2, k.top, k.w, k.h, [0, 0, 8 * S, 8 * S]);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme.pipe;
    ctx.beginPath();
    ctx.arc(k.cx, k.top + k.h - 9 * S, 4 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.fillText('sink', k.cx, k.top + k.h + 14 * S);

    // flasks at rest
    const { drag } = this;
    for (const f of this.flasks) {
      if (drag?.flask === f) continue;
      this.drawFlask(f, f.home.x, f.home.y, 0);
      if (f.label) {
        ctx.fillStyle = theme.muted;
        ctx.textAlign = 'center';
        ctx.fillText(f.label, f.home.x, f.home.y + 86 * S);
      }
      if (this.hover === f && this.god) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(f.home.x - 30 * S, f.home.y - 6 * S, 60 * S, 80 * S);
      }
    }

    // dragged flask + streams
    if (drag) {
      const D = drag.flask;
      const z = drag.zone;
      if (z?.kind === 'faucet' && D.N < D.cap - 0.01)
        this.drawStream(z.fa.x, L.spoutY, D.x, D.y + 2 * S, fluidColor(z.fa.output));
      if (z?.kind === 'flask' && D.N > 0.01 && z.f.N < z.f.cap - 0.01)
        this.drawStream(D.x, D.y, z.f.home.x, z.f.home.y + 4 * S, fluidColor(D));
      if (z?.kind === 'sink' && D.N > 0.01) this.drawStream(D.x, D.y, k.cx, k.top + k.h - 6 * S, fluidColor(D));
      this.drawFlask(D, D.x, D.y, D.ang);
    }

    // glow goes on top of everything, so a very hot flask washes out its surroundings
    for (const f of this.flasks) {
      if (drag?.flask === f) this.drawGlow(f, f.x, f.y, f.ang);
      else this.drawGlow(f, f.home.x, f.home.y, 0);
    }
  }

  private drawGlow(f: Flask, mx: number, my: number, ang: number): void {
    const color = glowColor(f);
    if (!color) return;
    // a trace of hot fluid shouldn't blaze like a full flask
    const amount = Math.sqrt(Math.min(1, (4 * f.N) / f.cap));
    const { S } = this;
    // centered on the flask's bulb (local point (0, 50)), following any tilt
    const cx = mx - 50 * S * Math.sin(ang);
    const cy = my + 50 * S * Math.cos(ang);
    this.radialGlow(cx, cy, haloRadius(f.T) * S, color, haloAlpha(f.T) * amount, LOOK.haloSharpness);
    this.radialGlow(cx, cy, coronaRadius(f.T) * S, color, coronaAlpha(f.T) * amount, LOOK.coronaSharpness);
  }

  private radialGlow(cx: number, cy: number, R: number, color: RGB, alpha: number, sharpness: number): void {
    if (alpha < 0.002) return;
    const { ctx } = this;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    // canvas gradients interpolate linearly between stops, so sample the
    // falloff densely enough that the piecewise-linear version looks smooth
    for (let i = 0; i <= GLOW_STOPS; i++) {
      const x = i / GLOW_STOPS;
      grad.addColorStop(x, css(color, alpha * glowFalloff(x, sharpness)));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }
}
