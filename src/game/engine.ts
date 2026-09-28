import type { Fluid, ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { CAP, FILL_RATE, GOAL_ATOMS, N_FLASKS, POUR_RATE, TRACE } from './config';
import { FAUCETS, faucetOutput, type Faucet } from './faucets';
import { LOOK, coronaAlpha, coronaRadius, css, glowFalloff, haloAlpha, haloRadius, type RGB } from './appearance';
import { Flask, Vessel, fluidColor, glowColor, transfer, type Point } from './flask';
import { DEFAULT_PRESET, applyFill, type Preset } from './presets';
import { SCALE_SHAPE, Scale, glassGrams } from './scale';
import { HELIX, TANK_H, TOOL_NAMES, Tool, mouthBelow, tankX, type Mouth } from './tools';

/** What the god-mode panel needs to show for one vessel. */
export interface Inspection {
  T: number;
  N: number;
  cap: number;
  /** Species present, by atom count, largest first. */
  rows: { species: number; atoms: number }[];
  /** The vessel's horizontal extent and top, in stage coordinates, for placing the panel beside it. */
  x0: number;
  x1: number;
  y: number;
  stageW: number;
  stageH: number;
}

export interface EngineCallbacks {
  /** Target atoms across all vessels, rounded to a thousandth of the goal. Called only when it changes. */
  onProgress(targetAtoms: number): void;
  onWin(): void;
  /** Throttled to ~10 Hz; null when nothing is inspected. */
  onInspect(info: Inspection | null): void;
  /** A vessel was double-clicked in god mode; look it up with GameEngine.vessel(id). */
  onEdit(id: string): void;
}

/** Where a carried flask is. Pouring zones tilt it; filling zones hold it upright under a stream. */
type Zone =
  | { kind: 'flask'; f: Flask }
  | { kind: 'tank'; v: Vessel; x: number; y: number }
  | { kind: 'spout'; p: Point }
  | { kind: 'scale'; scale: Scale; dx: number; p: Point }
  | { kind: 'faucet'; fa: FaucetLayout }
  | { kind: 'sink' };
type FaucetLayout = Faucet & { x: number; output: Fluid };

interface Layout {
  pipeY: number;
  spoutY: number;
  fillMouthY: number;
  faucets: FaucetLayout[];
  /** Top of the lowest shelf. */
  benchY: number;
  /** Top of the sink, which runs along the bottom of the stage. */
  floorY: number;
  homes: Point[];
}

const THEME_KEYS = ['ink', 'muted', 'line', 'bench', 'glass', 'glasshi', 'pipe', 'accent', 'shadow'] as const;
type Theme = Record<(typeof THEME_KEYS)[number], string>;

const GLOW_STOPS = 32;

const POUR_ANG = Math.PI * 0.61;
/** How far below a faucet something can be and still get filled, in local units. */
const FAUCET_REACH = 60;
/** Half-width of the part of a flask's mouth that catches a falling stream, in local units. */
const FLASK_CATCH = 14;
/** A tool's spout snaps to line up with a mouth this close below it, in local units. */
const SNAP = 24;
/** Pixels of right-click drag (right or up opens) to turn a valve from closed to fully open. */
const VALVE_PX = 150;
const SINK_H = 16;
/** The separator's splitter, below its valve, in local units. */
const SEP_BODY = { x0: -42, x1: 42, y0: 100, y1: 112 };

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
  private L: Layout = { pipeY: 0, spoutY: 0, fillMouthY: 0, faucets: [], benchY: 0, floorY: 0, homes: [] };
  private flasks: Flask[] = [];
  /** Back to front. */
  private tools: Tool[] = [];
  /** The carried flask; `off` is where it was grabbed, relative to its mouth. */
  private drag: { flask: Flask; zone: Zone | null; off: Point } | null = null;
  private toolDrag: { tool: Tool; off: Point } | null = null;
  private scales: Scale[] = [];
  private scaleDrag: { scale: Scale; off: Point } | null = null;
  private valveDrag: { tool: Tool; k: number; v0: number; p0: Point } | null = null;
  private hover: Flask | null = null;
  private hoverTool: Tool | null = null;
  private hoverTank: Vessel | null = null;
  private faucetFlows: { fa: FaucetLayout; m: Mouth }[] = [];
  private pointer: Point = { x: -1, y: -1 };
  private won = false;
  private lastProgress = -1;
  private inspected: Vessel | null = null;
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

  /**
   * A vessel by the id passed to onEdit: `f<slot>` for a flask, `t<tool>.<tank>` for a tool's tank.
   * Vessels are replaced on reset/load, so look this up each time.
   */
  vessel(id: string): { vessel: Vessel; title: string } | undefined {
    const fm = /^f(\d+)$/.exec(id);
    if (fm) {
      const i = +fm[1];
      const f = this.flasks[i];
      return f && { vessel: f, title: `Flask ${i + 1}${f.label ? ` (${f.label})` : ''}` };
    }
    const tm = /^t(\d+)\.(\d+)$/.exec(id);
    const tool = tm ? this.tools.find((t) => t.id === +tm[1]) : undefined;
    const k = tm ? +tm[2] : -1;
    if (!tool || !tool.tanks[k]) return undefined;
    const nth = this.tools.filter((t) => t.kind === tool.kind && t.id <= tool.id).length;
    const tank = tool.tanks.length > 1 ? ` ${tool.shape.tanks[k].name}` : '';
    return { vessel: tool.tanks[k], title: `${TOOL_NAMES[tool.kind]} ${nth}${tank}` };
  }

  /** Restart from the current preset. */
  reset(): void {
    this.load(this.preset);
  }

  load(preset: Preset): void {
    this.preset = preset;
    this.flasks = this.L.homes.map((h, i) => {
      const f = new Flask({ ...h }, CAP);
      f.glass = glassGrams(i);
      applyFill(f, preset.flasks[i] ?? null);
      return f;
    });
    this.scales = (preset.scales ?? []).map(([fx, fy]) => new Scale(fx, fy));
    this.settle();
    this.tools = (preset.tools ?? []).map((spec, i) => {
      const t = new Tool(spec.kind, i, spec.at[0], spec.at[1], spec.valves);
      spec.tanks?.forEach((fill, k) => t.tanks[k] && applyFill(t.tanks[k], fill));
      return t;
    });
    this.snapAll();
    this.won = false;
    this.drag = this.toolDrag = this.valveDrag = this.scaleDrag = null;
    this.hover = this.hoverTool = this.hoverTank = null;
    this.lastProgress = -1;
  }

  private vessels(): Vessel[] {
    return [...this.flasks, ...this.tools.flatMap((t) => t.tanks)];
  }

  /* ---------------- layout ---------------- */

  private layout(): void {
    const { stage, canvas, L } = this;
    const prev = { W: this.W, S: this.S, floorY: L.floorY };
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
    L.faucets = FAUCETS.map((fa, i) => ({
      ...fa, output: faucetOutput(fa, this.chem.U), x: W * 0.06 + W * 0.72 * (i / (nF - 1)),
    }));
    L.floorY = H - SINK_H * S;
    const cols = W < 560 ? 4 : 8;
    const rows = Math.ceil(N_FLASKS / cols);
    L.homes = [];
    for (let i = 0; i < N_FLASKS; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const inRow = Math.min(cols, N_FLASKS - r * cols);
      L.homes.push({ x: (W * (c + 0.5)) / inRow, y: L.floorY - 22 * S - (rows - 1 - r) * 106 * S - 70 * S });
    }
    L.benchY = Math.max(...L.homes.map((h) => h.y)) + 70 * S;
    // keep resting flasks in proportion: across by width, and up from the floor by scale, which keeps shelves full
    if (prev.W > 0)
      for (const f of this.flasks)
        f.home = this.clampRest({ x: (f.home.x * W) / prev.W, y: L.floorY - ((prev.floorY - f.home.y) * S) / prev.S });
    for (const t of this.tools) this.place(t, this.toolXY(t));
    for (const sc of this.scales) this.placeScale(sc, this.scaleXY(sc));
    this.settle();
    this.snapAll();
  }

  /** A flask's resting place (its mouth), kept on the stage and above the sink. */
  private clampRest(p: Point): Point {
    const { S, W } = this;
    return { x: Math.max(28 * S, Math.min(W - 28 * S, p.x)), y: Math.max(6 * S, Math.min(this.L.floorY - 70 * S, p.y)) };
  }

  /** Stand each flask on a scale where the scale now is, and put every flask not being carried at rest. */
  private settle(): void {
    const { S } = this;
    for (const sc of this.scales) {
      const o = this.scaleXY(sc);
      for (const { f, dx } of sc.load) f.home = { x: o.x + dx * S, y: o.y - 70 * S };
    }
    for (const f of this.flasks)
      if (this.drag?.flask !== f) {
        f.x = f.home.x;
        f.y = f.home.y;
      }
  }

  /* ---------------- scale geometry ---------------- */

  /** Top center of a scale's platform, in stage coordinates. */
  private scaleXY(sc: Scale): Point {
    return { x: sc.fx * this.W, y: sc.fy * this.H };
  }

  private placeScale(sc: Scale, p: Point): void {
    const { S, W, H } = this;
    const b = SCALE_SHAPE.box;
    sc.fx = Math.max(-b.x0 * S, Math.min(W - b.x1 * S, p.x)) / W;
    sc.fy = Math.max(-b.y0 * S, Math.min(this.L.floorY - b.y1 * S, p.y)) / H;
  }

  private onScale(sc: Scale, p: Point, r: { x0: number; x1: number; y0: number; y1: number }): boolean {
    const o = this.scaleXY(sc);
    const { S } = this;
    return p.x > o.x + r.x0 * S && p.x < o.x + r.x1 * S && p.y > o.y + r.y0 * S && p.y < o.y + r.y1 * S;
  }

  /** The scale whose body (not what's standing on it) is under p. */
  private hitScale(p: Point): Scale | null {
    const { platform: pl, body } = SCALE_SHAPE;
    for (let i = this.scales.length - 1; i >= 0; i--)
      if (this.onScale(this.scales[i], p, { x0: pl.x0, x1: pl.x1, y0: -2, y1: body.y1 })) return this.scales[i];
    return null;
  }

  /* ---------------- tool geometry ---------------- */

  /** Top center of a tool, in stage coordinates. */
  private toolXY(t: Tool): Point {
    return { x: t.fx * this.W, y: t.fy * this.H };
  }

  /** A point in a tool's local units, in stage coordinates. */
  private onTool(t: Tool, p: Point): Point {
    const o = this.toolXY(t);
    return { x: o.x + p.x * this.S, y: o.y + p.y * this.S };
  }

  /** The tip of spout j, where fluid leaves the tool, in stage coordinates. */
  private spoutAt(t: Tool, j: number): Point {
    return this.onTool(t, { x: t.shape.spouts[j], y: t.shape.spoutY });
  }

  private valveAt(t: Tool, k: number): Point {
    return this.onTool(t, { x: tankX(t.shape.tanks[k]), y: t.shape.valveY });
  }

  private tankRect(t: Tool, k: number): { x0: number; x1: number; y0: number; y1: number } {
    const o = this.toolXY(t);
    const { S } = this;
    const tk = t.shape.tanks[k];
    return { x0: o.x + tk.x0 * S, x1: o.x + tk.x1 * S, y0: o.y, y1: o.y + TANK_H * S };
  }

  /** Move a tool, keeping it on the stage and above the sink. */
  private place(t: Tool, p: Point): void {
    const { S, W, H } = this;
    const b = t.shape.box;
    const x = Math.max(-b.x0 * S, Math.min(W - b.x1 * S, p.x));
    const y = Math.max(-b.y0 * S, Math.min(this.L.floorY - b.y1 * S, p.y));
    t.fx = x / W;
    t.fy = y / H;
  }

  /** Every open top that falling fluid can land in. */
  private mouths(except?: Tool): Mouth[] {
    const { S, drag } = this;
    const out: Mouth[] = [];
    for (const f of this.flasks) {
      const carried = drag?.flask === f;
      if (carried && f.ang !== 0) continue; // tilted to pour
      const p = carried ? f : f.home;
      out.push({ v: f, x0: p.x - FLASK_CATCH * S, x1: p.x + FLASK_CATCH * S, y: p.y });
    }
    for (const t of this.tools) {
      if (t === except) continue;
      t.tanks.forEach((v, k) => {
        const r = this.tankRect(t, k);
        out.push({ v, x0: r.x0, x1: r.x1, y: r.y0 });
      });
    }
    return out;
  }

  /**
   * Line a spout up with the mouth below it, if one is close, so the stream goes in.
   * With several spouts, the one closest to lined up wins.
   */
  private snap(t: Tool): void {
    const mouths = this.mouths(t);
    let shift: number | null = null;
    t.shape.spouts.forEach((_, j) => {
      const sp = this.spoutAt(t, j);
      let best: Mouth | null = null;
      for (const m of mouths) {
        const cx = (m.x0 + m.x1) / 2;
        const near = (sp.x >= m.x0 && sp.x <= m.x1) || Math.abs(sp.x - cx) < SNAP * this.S;
        if (near && m.y > sp.y && (!best || m.y < best.y)) best = m;
      }
      const d = best && (best.x0 + best.x1) / 2 - sp.x;
      if (d !== null && (shift === null || Math.abs(d) < Math.abs(shift))) shift = d;
    });
    if (shift !== null) t.fx += shift / this.W;
  }

  /** Snap every tool, lowest first, so a tool stacked above another lines up with where it ended up. */
  private snapAll(): void {
    for (const t of [...this.tools].sort((a, b) => b.fy - a.fy)) this.snap(t);
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
      const t = this.hitTool(p);
      if (e.button === 2) {
        if (t) {
          // the valve nearest the pointer, left to right
          const o = this.toolXY(t);
          const dist = (j: number) => Math.abs(p.x - o.x - tankX(t.shape.tanks[j]) * this.S);
          let k = 0;
          for (let j = 1; j < t.tanks.length; j++) if (dist(j) < dist(k)) k = j;
          this.valveDrag = { tool: t, k, v0: t.valves[k], p0: p };
          c.setPointerCapture(e.pointerId);
        }
      } else if (e.button === 0) {
        if (t) {
          const o = this.toolXY(t);
          this.toolDrag = { tool: t, off: { x: p.x - o.x, y: p.y - o.y } };
          this.tools.splice(this.tools.indexOf(t), 1);
          this.tools.push(t); // bring to front
          c.setPointerCapture(e.pointerId);
        } else if (this.hitScale(p)) {
          const sc = this.hitScale(p)!;
          if (this.onScale(sc, p, SCALE_SHAPE.tare)) sc.zero();
          else {
            const o = this.scaleXY(sc);
            this.scaleDrag = { scale: sc, off: { x: p.x - o.x, y: p.y - o.y } };
            c.setPointerCapture(e.pointerId);
          }
        } else {
          const f = this.hitFlask(p);
          if (f) {
            this.drag = { flask: f, zone: null, off: { x: p.x - f.home.x, y: p.y - f.home.y } };
            for (const sc of this.scales) sc.remove(f);
            c.setPointerCapture(e.pointerId);
          }
        }
      }
      this.updateHover();
      e.preventDefault();
    });
    on('pointermove', (e) => {
      const p = (this.pointer = this.ptr(e));
      if (this.valveDrag) {
        const { tool, k, v0, p0 } = this.valveDrag;
        tool.valves[k] = Math.max(0, Math.min(1, v0 + (p.x - p0.x - (p.y - p0.y)) / VALVE_PX));
      } else if (this.toolDrag) {
        const { tool, off } = this.toolDrag;
        this.place(tool, { x: p.x - off.x, y: p.y - off.y });
        this.snap(tool);
      } else if (this.scaleDrag) {
        const { scale, off } = this.scaleDrag;
        this.placeScale(scale, { x: p.x - off.x, y: p.y - off.y });
        this.settle();
      }
      this.updateHover();
    });
    const endDrag = () => {
      this.toolDrag = this.valveDrag = this.scaleDrag = null;
      if (this.drag) {
        // a flask stays where it's let go; one tilted to pour stands back up where it's held
        const { flask: f, zone, off } = this.drag;
        if (zone?.kind === 'scale') zone.scale.put(f, zone.dx);
        else if (f.ang !== 0) f.home = this.clampRest({ x: this.pointer.x - off.x, y: this.pointer.y - off.y });
        else f.home = this.clampRest({ x: f.x, y: f.y });
        f.ang = 0;
        this.drag = null;
        this.settle();
      }
      this.updateHover();
    };
    on('pointerup', endDrag);
    on('pointercancel', endDrag);
    on('pointerleave', () => {
      this.pointer = { x: -1, y: -1 };
      this.updateHover();
    });
    on('contextmenu', (e) => e.preventDefault());
    on('dblclick', (e) => {
      if (!this.god) return;
      const p = this.ptr(e);
      const hit = this.tankAt(p);
      if (hit) {
        this.cb.onEdit(`t${hit.tool.id}.${hit.k}`);
        return;
      }
      const f = this.hitFlask(p);
      if (f) this.cb.onEdit(`f${this.flasks.indexOf(f)}`);
    });
  }

  private updateHover(): void {
    const p = this.pointer;
    const busy = this.drag || this.toolDrag || this.valveDrag || this.scaleDrag;
    this.hoverTool = busy ? null : this.hitTool(p);
    const hit = busy ? null : this.tankAt(p);
    this.hoverTank = hit ? hit.tool.tanks[hit.k] : null;
    this.hover = busy || this.hoverTool ? null : this.hitFlask(p);
  }

  private ptr(e: MouseEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** The frontmost tool under p. */
  private hitTool(p: Point): Tool | null {
    const { S } = this;
    for (let i = this.tools.length - 1; i >= 0; i--) {
      const t = this.tools[i];
      const o = this.toolXY(t);
      const b = t.shape.box;
      if (p.x > o.x + b.x0 * S && p.x < o.x + b.x1 * S && p.y > o.y + b.y0 * S && p.y < o.y + b.y1 * S) return t;
    }
    return null;
  }

  /** The tank under p, on the frontmost tool under p. */
  private tankAt(p: Point): { tool: Tool; k: number } | null {
    const tool = this.hitTool(p);
    if (!tool) return null;
    for (let k = 0; k < tool.tanks.length; k++) {
      const r = this.tankRect(tool, k);
      if (p.x > r.x0 && p.x < r.x1 && p.y > r.y0 - 6 * this.S && p.y < r.y1) return { tool, k };
    }
    return null;
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
    for (let i = this.tools.length - 1; i >= 0; i--) {
      const t = this.tools[i];
      for (let k = 0; k < t.tanks.length; k++) {
        const r = this.tankRect(t, k);
        if (p.x > r.x0 - 8 * S && p.x < r.x1 + 8 * S && p.y > r.y0 - 40 * S && p.y < r.y1)
          return { kind: 'tank', v: t.tanks[k], x: (r.x0 + r.x1) / 2, y: r.y0 };
      }
    }
    for (const sc of this.scales) {
      const o = this.scaleXY(sc);
      const pl = SCALE_SHAPE.platform;
      if (p.x < o.x + (pl.x0 - 10) * S || p.x > o.x + (pl.x1 + 10) * S || p.y < o.y - 80 * S || p.y > o.y + 20 * S)
        continue;
      // stand it on the platform right under where it's held
      const held = p.x - (this.drag?.off.x ?? 0);
      const x = Math.max(o.x + (pl.x0 + 24) * S, Math.min(o.x + (pl.x1 - 24) * S, held));
      return { kind: 'scale', scale: sc, dx: (x - o.x) / S, p: { x, y: o.y - 70 * S } };
    }
    for (const t of this.tools)
      for (let j = 0; j < t.shape.spouts.length; j++) {
        const sp = this.spoutAt(t, j);
        if (Math.abs(p.x - sp.x) < 30 * S && p.y > sp.y && p.y < sp.y + 130 * S) return { kind: 'spout', p: sp };
      }
    for (const fa of L.faucets) {
      if (Math.abs(p.x - fa.x) < 38 * S && p.y > L.pipeY && p.y < L.spoutY + 150 * S) return { kind: 'faucet', fa };
    }
    if (p.y > L.benchY + 8 * S) return { kind: 'sink' };
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
      D.ang = 0;
      if (!z) {
        D.x = pointer.x - drag.off.x;
        D.y = pointer.y - drag.off.y;
      } else if (z.kind === 'faucet') {
        D.x = z.fa.x;
        D.y = L.fillMouthY;
      } else if (z.kind === 'spout') {
        D.x = z.p.x;
        D.y = z.p.y + 16 * S;
      } else if (z.kind === 'scale') {
        D.x = z.p.x;
        D.y = z.p.y;
      } else {
        D.ang = POUR_ANG;
        if (z.kind === 'flask') {
          D.x = z.f.home.x + 16 * S;
          D.y = z.f.home.y - 32 * S;
          transfer(D, z.f, POUR_RATE * dt);
        } else if (z.kind === 'tank') {
          D.x = z.x + 16 * S;
          D.y = z.y - 32 * S;
          transfer(D, z.v, POUR_RATE * dt);
        } else {
          D.x = pointer.x;
          D.y = L.floorY - 8 * S;
          transfer(D, null, POUR_RATE * dt);
        }
      }
    }

    // faucets also run in real time: each fills whatever is held right under it
    const mouths = this.mouths();
    this.faucetFlows = [];
    for (const fa of L.faucets) {
      fa.output = faucetOutput(fa, this.chem.U); // cheap, and follows edits to the chemistry
      const m = mouthBelow(mouths, { x: fa.x, y: L.spoutY });
      if (!m || m.y - L.spoutY > FAUCET_REACH * S || m.v.N > m.v.cap - TRACE) continue;
      m.v.addFrom(fa.output, FILL_RATE * dt);
      this.faucetFlows.push({ fa, m });
    }

    // tools and chemistry, sim time, interleaved so a drip meets the reaction it feeds
    const simDt = dt * this.speed;
    const vessels = this.vessels();
    if (simDt > 0) {
      const sub = Math.ceil(simDt / 0.02);
      const h = simDt / sub;
      const targets = this.tools.map((t) => t.shape.spouts.map((_, j) => mouthBelow(mouths, this.spoutAt(t, j))));
      for (let i = 0; i < sub; i++) {
        this.tools.forEach((t, j) =>
          t.step(h).forEach((out, k) => {
            // whatever doesn't fit overflows to the sink
            if (out) targets[j][k]?.v.addFrom(out, out.N);
          }),
        );
        for (const v of vessels) this.chem.step(v, h);
      }
    }

    // goal
    let tgt = 0;
    for (const v of vessels) tgt += v.n[TARGET] * 3;
    const q = GOAL_ATOMS / 1000;
    const rounded = Math.round(tgt / q) * q;
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

  /** The vessel god mode is showing, with its extent for placing the panel. */
  private inspectTarget(): { v: Vessel; x0: number; x1: number; y: number } | null {
    if (!this.god) return null;
    const { S } = this;
    const f = this.drag?.flask ?? this.hover;
    if (f) {
      const p = this.drag ? f : f.home;
      return { v: f, x0: p.x - 28 * S, x1: p.x + 28 * S, y: p.y };
    }
    if (this.hoverTank) {
      const tool = this.hoverTool!;
      const r = this.tankRect(tool, tool.tanks.indexOf(this.hoverTank));
      return { v: this.hoverTank, x0: r.x0, x1: r.x1, y: r.y0 };
    }
    return null;
  }

  private inspect(now: number): void {
    const target = this.inspectTarget();
    const f = target?.v;
    if (!target || !f) {
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
      if (atoms > CAP * 1e-4) rows.push({ species: s, atoms });
    }
    rows.sort((a, b) => b.atoms - a.atoms);
    this.cb.onInspect({
      T: f.T, N: f.N, cap: f.cap, rows,
      x0: target.x0, x1: target.x1, y: target.y,
      stageW: this.W, stageH: this.H,
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
    if (f.N > TRACE) {
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

  /** An open-topped glass tank with a rounded floor. */
  private drawTank(v: Vessel, x0: number, y0: number, x1: number, y1: number): void {
    const { ctx, S, theme } = this;
    const r = 6 * S;
    const wall = new Path2D();
    wall.moveTo(x0, y0);
    wall.lineTo(x0, y1 - r);
    wall.quadraticCurveTo(x0, y1, x0 + r, y1);
    wall.lineTo(x1 - r, y1);
    wall.quadraticCurveTo(x1, y1, x1, y1 - r);
    wall.lineTo(x1, y0);
    const inside = new Path2D(wall);
    inside.closePath();
    if (v.N > TRACE) {
      ctx.save();
      ctx.clip(inside);
      const top = y1 - Math.min(1, v.N / v.cap) * (y1 - y0);
      ctx.fillStyle = fluidColor(v);
      ctx.fillRect(x0, top, x1 - x0, y1 - top + 1);
      ctx.restore();
    }
    ctx.fillStyle = theme.glasshi;
    ctx.fill(inside);
    ctx.strokeStyle = theme.glass;
    ctx.lineWidth = 1.6;
    ctx.stroke(wall);
    ctx.beginPath();
    ctx.moveTo(x0 - 3 * S, y0);
    ctx.lineTo(x0, y0);
    ctx.moveTo(x1, y0);
    ctx.lineTo(x1 + 3 * S, y0);
    ctx.stroke();
  }

  private drawTool(t: Tool): void {
    const { ctx, S, theme } = this;
    const o = this.toolXY(t);
    const sh = t.shape;
    const pipes = (pts: number[][], width: number) => {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.scale(S, S);
      ctx.strokeStyle = theme.pipe;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    };

    // drain pipes and spouts, behind the tanks
    ctx.fillStyle = theme.pipe;
    if (t.kind === 'exchanger')
      sh.tanks.forEach((tk, k) => {
        // down into the helix at one end, and out of it at the other
        pipes([[tankX(tk), TANK_H], [tankX(tk), HELIX.y - HELIX.r]], 4);
        pipes([[sh.spouts[k], HELIX.y + HELIX.r], [sh.spouts[k], sh.spoutY - 4]], 4);
      });
    else if (t.kind === 'separator') {
      pipes([[0, TANK_H], [0, SEP_BODY.y0]], 4);
      for (const x of sh.spouts) pipes([[x, SEP_BODY.y1], [x, sh.spoutY - 4]], 4);
    } else pipes([[0, TANK_H], [0, sh.spoutY - 4]], 4);
    for (const x of sh.spouts) ctx.fillRect(o.x + (x - 4) * S, o.y + (sh.spoutY - 6) * S, 8 * S, 6 * S);
    t.tanks.forEach((v, k) => {
      const r = this.tankRect(t, k);
      this.drawTank(v, r.x0, r.y0, r.x1, r.y1);
    });
    if (t.kind === 'exchanger') this.drawHelix(t);
    if (t.kind === 'separator') {
      // the splitter: one pipe in, two out, with a divider between the outlets
      const { x0, x1, y0, y1 } = SEP_BODY;
      ctx.fillStyle = theme.bench;
      ctx.strokeStyle = theme.pipe;
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.roundRect(o.x + x0 * S, o.y + y0 * S, (x1 - x0) * S, (y1 - y0) * S, 5 * S);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(o.x, o.y + (y0 + 5) * S);
      ctx.lineTo(o.x, o.y + y1 * S);
      ctx.stroke();
    }

    // the rate, while turning a valve or hovering the tool (but not a tank, which shows the god-mode panel)
    const showRates = this.valveDrag?.tool === t || (this.hoverTool === t && !(this.god && this.hoverTank));
    t.tanks.forEach((_, k) => {
      // valve: the lever lies across the pipe when closed and along it when open
      const vc = this.valveAt(t, k);
      const side = vc.x < this.toolXY(t).x - 1 ? -1 : 1; // levers and labels point away from the middle
      const a = -t.valves[k] * (Math.PI / 2);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 3 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(vc.x, vc.y);
      ctx.lineTo(vc.x + side * 13 * S * Math.cos(a), vc.y + 13 * S * Math.sin(a));
      ctx.stroke();
      ctx.fillStyle = theme.bench;
      ctx.strokeStyle = theme.pipe;
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.arc(vc.x, vc.y, 5 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (showRates && (this.valveDrag?.tool !== t || this.valveDrag.k === k)) {
        ctx.fillStyle = theme.ink;
        ctx.textAlign = side < 0 ? 'right' : 'left';
        ctx.fillText(`${t.valves[k].toFixed(2)} flask/s`, vc.x + side * 16 * S, vc.y + 12 * S);
      }
    });

    ctx.fillStyle = theme.muted;
    if (t.tanks.length > 1) {
      ctx.textAlign = 'center';
      sh.tanks.forEach((tk) => ctx.fillText(tk.name, o.x + tankX(tk) * S, o.y + 14 * S));
    }
    if (this.god && this.hoverTank && t.tanks.includes(this.hoverTank)) {
      const r = this.tankRect(t, t.tanks.indexOf(this.hoverTank));
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x0 - 5 * S, r.y0 - 5 * S, r.x1 - r.x0 + 10 * S, r.y1 - r.y0 + 10 * S);
    }
  }

  private drawScale(sc: Scale): void {
    const { ctx, S, theme } = this;
    const o = this.scaleXY(sc);
    const { platform: pl, body, display: d, tare } = SCALE_SHAPE;
    const X = (x: number) => o.x + x * S;
    const Y = (y: number) => o.y + y * S;
    ctx.save();
    ctx.fillStyle = theme.bench;
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.roundRect(X(body.x0), Y(4), (body.x1 - body.x0) * S, (body.y1 - 4) * S, 6 * S);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme.pipe;
    ctx.fillRect(X(pl.x0), Y(0), (pl.x1 - pl.x0) * S, 5 * S);

    // an LCD looks the same in either theme
    ctx.fillStyle = '#26302b';
    ctx.beginPath();
    ctx.roundRect(X(d.x0), Y(d.y0), (d.x1 - d.x0) * S, (d.y1 - d.y0) * S, 3 * S);
    ctx.fill();
    const g = sc.reading();
    ctx.fillStyle = '#9fe0b8';
    ctx.font = `${Math.round(13 * S)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(g === null ? 'OVER' : `${g} g`, X(d.x1 - 5), Y((d.y0 + d.y1) / 2 + 1));

    const hot = !this.drag && !this.scaleDrag && this.onScale(sc, this.pointer, tare);
    ctx.fillStyle = theme.line;
    ctx.strokeStyle = hot ? theme.accent : theme.pipe;
    ctx.lineWidth = 1.5 * S;
    ctx.beginPath();
    ctx.roundRect(X(tare.x0), Y(tare.y0), (tare.x1 - tare.x0) * S, (tare.y1 - tare.y0) * S, 4 * S);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme.ink;
    ctx.font = `${Math.round(10 * Math.max(S, 0.85))}px "Schibsted Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('tare', X((tare.x0 + tare.x1) / 2), Y((tare.y0 + tare.y1) / 2 + 0.5));
    ctx.restore();
  }

  /**
   * The exchanger's two hoses as a double helix: glass tubes that pass over
   * and under each other, each showing its stream going from inlet color to
   * outlet color as it trades heat (or empty, when its valve is shut).
   */
  private drawHelix(t: Tool): void {
    const { ctx, S, theme } = this;
    const o = this.toolXY(t);
    const { x0, x1, y, r, halfTwists } = HELIX;
    const X = (x: number) => o.x + x * S;
    const steps = 16; // per half-twist
    // Strand k's phase runs 0 → halfTwists·π across the helix; its height is
    // cos(phase) and its depth sin(phase), flipped for the second strand.
    // Strand A (k = 0) enters at the left and B at the right.
    const point = (k: number, u: number) => {
      const x = x0 + (x1 - x0) * u;
      const th = Math.PI * halfTwists * u;
      return { x: X(x), y: o.y + (y - (k ? -1 : 1) * r * Math.cos(th)) * S, z: (k ? -1 : 1) * Math.sin(th) };
    };
    // split at each half-twist, where the strands are furthest apart, and draw back to front
    const segs: { k: number; i: number; z: number }[] = [];
    for (let k = 0; k < 2; k++)
      for (let i = 0; i < halfTwists; i++) segs.push({ k, i, z: point(k, (i + 0.5) / halfTwists).z });
    segs.sort((a, b) => a.z - b.z);

    const fill = t.tanks.map((tank, k) => {
      const out = t.out[k];
      if (!out) return theme.bench;
      // inlet at the tank's end, outlet at the far end
      const g = ctx.createLinearGradient(X(k ? x1 : x0), 0, X(k ? x0 : x1), 0);
      g.addColorStop(0, fluidColor(tank.N > TRACE ? tank : out));
      g.addColorStop(1, fluidColor(out));
      return g;
    });
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const { k, i } of segs) {
      ctx.beginPath();
      for (let j = 0; j <= steps; j++) {
        const p = point(k, (i + j / steps) / halfTwists);
        if (j) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
      ctx.strokeStyle = theme.pipe;
      ctx.lineWidth = 7 * S;
      ctx.stroke();
      ctx.strokeStyle = fill[k];
      ctx.lineWidth = 4 * S;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawStream(x1: number, y1: number, x2: number, y2: number, color: string, width = 4): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width * this.S;
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

    // sink, all along the bottom: whatever falls off the bench ends up here
    ctx.fillStyle = theme.bench;
    ctx.fillRect(0, L.floorY, W, H - L.floorY);
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    for (let x = 8 * S; x < W; x += 12 * S) {
      ctx.moveTo(x, L.floorY + 4 * S);
      ctx.lineTo(x, H - 3 * S);
    }
    ctx.stroke();
    ctx.fillStyle = theme.bench;
    ctx.fillRect(W - 50 * S, L.floorY, 40 * S, H - L.floorY);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('sink', W - 30 * S, (L.floorY + H) / 2);
    ctx.textBaseline = 'alphabetic';

    // streams, behind everything they fall past
    const { drag } = this;
    const mouths = this.mouths();
    for (const t of this.tools)
      t.out.forEach((out, k) => {
        if (!out) return;
        const sp = this.spoutAt(t, k);
        const m = mouthBelow(mouths, sp);
        this.drawStream(sp.x, sp.y, sp.x, m ? m.y + 2 * S : H, fluidColor(out), 1.5 + 3 * Math.min(1, t.flow[k]));
      });
    for (const { fa, m } of this.faucetFlows) this.drawStream(fa.x, L.spoutY, fa.x, m.y + 2 * S, fluidColor(fa.output));
    if (drag && drag.flask.N > TRACE) {
      const D = drag.flask;
      const z = drag.zone;
      if (z?.kind === 'flask' && z.f.N < z.f.cap - TRACE)
        this.drawStream(D.x, D.y, z.f.home.x, z.f.home.y + 4 * S, fluidColor(D));
      if (z?.kind === 'tank' && z.v.N < z.v.cap - TRACE) this.drawStream(D.x, D.y, z.x, z.y + 4 * S, fluidColor(D));
      if (z?.kind === 'sink') this.drawStream(D.x, D.y, D.x - 4 * S, H, fluidColor(D));
    }

    // shelves
    ctx.fillStyle = theme.bench;
    for (const y of new Set(L.homes.map((h) => h.y))) ctx.fillRect(0, y + 70 * S, W, 6 * S);
    for (const sc of this.scales) this.drawScale(sc);

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

    // flasks at rest
    for (const f of this.flasks) {
      if (drag?.flask === f) continue;
      this.drawFlask(f, f.home.x, f.home.y, 0);
      // a label would cover a scale's display
      if (f.label && !this.scales.some((sc) => sc.load.some((l) => l.f === f))) {
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

    for (const t of this.tools) this.drawTool(t);
    if (drag) this.drawFlask(drag.flask, drag.flask.x, drag.flask.y, drag.flask.ang);

    // glow goes on top of everything, so a very hot flask washes out its surroundings
    for (const f of this.flasks) {
      const p = drag?.flask === f ? f : { ...f.home, ang: 0 };
      // centered on the flask's bulb (local point (0, 50)), following any tilt
      this.drawGlow(f, p.x - 50 * S * Math.sin(p.ang), p.y + 50 * S * Math.cos(p.ang), f.cap);
    }
    for (const t of this.tools)
      t.tanks.forEach((v, k) => {
        const r = this.tankRect(t, k);
        this.drawGlow(v, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, v.cap);
      });
  }

  /** Glow from a vessel's fluid, centered on (cx, cy). */
  private drawGlow(f: Fluid, cx: number, cy: number, cap: number): void {
    const color = glowColor(f);
    if (!color) return;
    // a trace of hot fluid shouldn't blaze like a full flask
    const amount = Math.sqrt(Math.min(1, (4 * f.N) / cap));
    const { S } = this;
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
