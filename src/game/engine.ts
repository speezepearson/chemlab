import { temperature, type Fluid, type ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
import { CAP, FILL_RATE, GOAL_ATOMS, HOME_H, HOME_W, N_FLASKS, POUR_RATE, TRACE, WORLD_SCALE } from './config';
import { FAUCETS, faucetOutput, faucetTarget, type Faucet } from './faucets';
import { LOOK, coronaAlpha, coronaRadius, css, glowFalloff, haloAlpha, haloRadius, type RGB } from './appearance';
import { FLASK_PATH_DATA, fillLevel, tiltedOutline } from './flaskShape';
import { Flask, Vessel, fluidColor, glowColor, sustenance, transfer, volume, volumeUnit, type Point } from './flask';
import { DEFAULT_PRESET, applyFill, type Preset } from './presets';
import { loadChem, loadVessel, saveChem, saveVessel, type SaveState } from './save';
import { SCALE_SHAPE, Scale, glassGrams } from './scale';
import { rumble } from './rumble';
import {
  HELIX, Hose, SCAN_LIGHTS, SCAN_RAMP, SHAPES, SORTER_CHUTE, SPECTROMETER, TANK_H, TOOL_NAMES, Tool, chuteY, drip,
  mouthBelow, scanLevel, tankX, type Mouth, type ToolKind,
} from './tools';

/** What the god-mode panel needs to show for one vessel. */
export interface Inspection {
  T: number;
  /** How full it is, out of cap, in `unit` (atoms or molecules, see VOLUME). */
  volume: number;
  cap: number;
  unit: string;
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
  /** Target atoms across all vessels at least GOAL_PURITY pure, rounded to a thousandth of the goal. Called only when it changes. */
  onProgress(targetAtoms: number): void;
  onWin(): void;
  /** Throttled to ~10 Hz; null when nothing is inspected. */
  onInspect(info: Inspection | null): void;
  /** A vessel was double-clicked in god mode; look it up with GameEngine.vessel(id). */
  onEdit(id: string): void;
  /** Whether letting go of something at this point (in client coordinates) puts it away. */
  isDiscard(clientX: number, clientY: number): boolean;
}

/** Where a carried flask is: pouring zones tilt it, and a scale stands it on its platform. */
type Zone =
  | { kind: 'flask'; f: Flask }
  | { kind: 'tank'; v: Vessel; x: number; y: number }
  | { kind: 'scale'; scale: Scale; dx: number; p: Point }
  | { kind: 'sink' };
type FaucetLayout = Faucet & { x: number; output: Fluid };

interface Layout {
  pipeY: number;
  spoutY: number;
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
const FAUCET_REACH = 24;
/** Half-width of the part of a flask's mouth that catches a falling stream, in local units. */
const FLASK_CATCH = 14;
/** How close to a valve, in world units, the pointer can be before it stops turning the lever. */
const VALVE_DEADZONE = 20;
const SINK_H = 16;
/** Width of a stream flowing one flask per second, in world units; it goes as the square root of the flow. */
const STREAM_WIDTH = 4.5;
/** How fast a falling drop speeds up, in world units per sim second squared: a 500-unit fall takes 0.7 s. */
const GRAVITY = 2000;
/** Drawn radius of a DROP_R_ATOMS drop, in world units; it goes as the cube root of the drop's size. */
const DROP_R = 3;
const DROP_R_ATOMS = 1.5e6;
/** The most the camera zooms in, in screen pixels per world unit. */
const MAX_ZOOM = 4;
/** How much a pixel of scroll zooms: the zoom is multiplied by e^(−this·Δy). */
const ZOOM_PER_PX = 0.0015;
/** The separator's splitter, below its valve, in local units. */
const SEP_BODY = { x0: -42, x1: 42, y0: 100, y1: 112 };
/** How far a spectrometer shakes at the height of its run, in world units. */
const SHAKE = 2.5;
/** A CRT's phosphor green. */
const PHOSPHOR = '64, 255, 110';

const FLASK_PATH = new Path2D(FLASK_PATH_DATA);

/** Owns the canvas: layout, pointer input, the simulation loop and drawing. */
export class GameEngine {
  speed = 1;
  god = true;

  private ctx: CanvasRenderingContext2D;
  /**
   * The world's size, in world units. Everything is laid out, hit-tested and drawn in world units (S is
   * the size of a tool's local unit in them), and the camera maps them to the screen.
   */
  private readonly W = HOME_W * WORLD_SCALE;
  private readonly H = HOME_H * WORLD_SCALE;
  private readonly S = 1;
  private dpr = 1;
  /** The canvas's size, in CSS pixels. */
  private viewW = 0;
  private viewH = 0;
  /** The camera: screen pixels per world unit, and the world point at the canvas's top left. */
  private zoom = 1;
  private cam: Point = { x: 0, y: 0 };
  /** Whether the player has zoomed or panned; until then, resizing refits the home area. */
  private camMoved = false;
  /** Panning by dragging the background: where it started on screen, and the camera then. */
  private panDrag: { start: Point; cam: Point } | null = null;
  private L: Layout = { pipeY: 0, spoutY: 0, faucets: [], benchY: 0, floorY: 0, homes: [] };
  private flasks: Flask[] = [];
  /** Back to front. */
  private tools: Tool[] = [];
  /** The carried flask; `off` is where it was grabbed, relative to its mouth. */
  private drag: { flask: Flask; zone: Zone | null; off: Point } | null = null;
  private toolDrag: { tool: Tool; off: Point } | null = null;
  private scales: Scale[] = [];
  private scaleDrag: { scale: Scale; off: Point } | null = null;
  private hoses: Hose[] = [];
  /** Drops that have let go of an outlet and are on their way down. */
  private falling: { v: Vessel; x: number; y: number; vy: number }[] = [];
  /** A hose end being carried, or (just out of the palette) the whole hose, with its outlet this far from the inlet. */
  private hoseDrag: { hose: Hose; end: 'inlet' | 'outlet' | 'both'; gap?: Point } | null = null;
  private valveDrag: { tool: Tool; k: number } | null = null;
  private hover: Flask | null = null;
  private hoverTool: Tool | null = null;
  private hoverTank: Vessel | null = null;
  /** Whether the right mouse button is held: a carried flask pours, and anything carried takes from faucets, only while it is. */
  private rightHeld = false;
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
  private nextToolId = 0;
  /** Running spectrometers' rumbles, each with what stops it. */
  private rumbles = new Map<Tool, () => void>();

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
    this.layoutWorld();
    this.layout();
    this.reset();
    this.bindInput();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const c of this.cleanups) c();
    for (const stop of this.rumbles.values()) stop();
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
    this.nextToolId = preset.tools?.length ?? 0;
    this.tools = (preset.tools ?? []).map((spec, i) => {
      const t = new Tool(spec.kind, i, spec.at[0], spec.at[1], spec.valves);
      spec.tanks?.forEach((fill, k) => t.tanks[k] && applyFill(t.tanks[k], fill));
      return t;
    });
    for (const t of this.tools) this.place(t, this.toolXY(t));
    const { S } = this;
    this.hoses = (preset.hoses ?? []).map(({ from, to }) => {
      const h = new Hose({ x: 0, y: 0 }, { x: 0, y: 0 });
      const sp = this.spoutAt(this.tools[from.tool], from.spout);
      const r = this.tankRect(this.tools[to.tool], to.tank ?? 0);
      this.moveHoseEnd(h, 'inlet', { x: sp.x, y: sp.y + 16 * S });
      this.moveHoseEnd(h, 'outlet', { x: (r.x0 + r.x1) / 2 + (to.dx ?? 0) * S, y: r.y0 - 24 * S });
      return h;
    });
    this.won = false;
    this.falling = [];
    this.drag = this.toolDrag = this.valveDrag = this.scaleDrag = this.hoseDrag = null;
    this.hover = this.hoverTool = this.hoverTank = null;
    this.lastProgress = -1;
  }

  /** Everything on the bench, plus the chemistry parameters, for saving. */
  snapshot(): SaveState {
    const { S, L } = this;
    return {
      v: 1,
      preset: this.preset.id,
      flasks: this.flasks.map((f) => ({ ...saveVessel(f), x: f.home.x / HOME_W, up: (L.floorY - f.home.y) / S, glass: f.glass })),
      tools: this.tools.map((t) => ({
        kind: t.kind, id: t.id, fx: t.fx, fy: t.fy, valves: [...t.valves], tanks: t.tanks.map(saveVessel), drops: t.drops.map(saveVessel),
        ...(t.reading ? { reading: [...t.reading] } : {}),
      })),
      scales: this.scales.map((sc) => ({
        fx: sc.fx, fy: sc.fy, tare: sc.tare,
        load: sc.load.map(({ f, dx }) => ({ f: this.flasks.indexOf(f), dx })).filter((l) => l.f >= 0),
      })),
      hoses: this.hoses.map((h) => ({ inlet: { ...h.inlet }, outlet: { ...h.outlet }, funnel: saveVessel(h.funnel), drop: saveVessel(h.drop) })),
      chem: saveChem(this.chem.params),
    };
  }

  /** Replace the bench with a saved one. `preset` is what Reset will go back to afterwards. */
  restore(s: SaveState, preset: Preset): void {
    const { S, L } = this;
    this.preset = preset;
    loadChem(this.chem.params, s.chem);
    this.chem.rebuild();
    L.faucets = L.faucets.map((fa) => ({ ...fa, output: faucetOutput(fa, this.chem.U) }));
    this.flasks = s.flasks.map((sf, i) => {
      const f = new Flask(this.clampRest({ x: sf.x * HOME_W, y: L.floorY - sf.up * S }), CAP);
      f.glass = Number.isFinite(sf.glass) ? sf.glass : glassGrams(i);
      loadVessel(f, sf);
      return f;
    });
    this.tools = s.tools
      .filter((st) => st.kind in SHAPES)
      .map((st) => {
        const t = new Tool(st.kind, st.id, st.fx, st.fy, st.valves ?? []);
        t.tanks.forEach((v, k) => st.tanks?.[k] && loadVessel(v, st.tanks[k]));
        t.drops.forEach((v, k) => st.drops?.[k] && loadVessel(v, st.drops[k]));
        if (Array.isArray(st.reading) && st.reading.length === 18) t.reading = st.reading.map((x) => Math.max(0, Number(x) || 0));
        return t;
      });
    this.nextToolId = Math.max(-1, ...this.tools.map((t) => t.id)) + 1;
    this.scales = s.scales.map((ss) => {
      const sc = new Scale(ss.fx, ss.fy);
      sc.tare = ss.tare ?? 0;
      for (const { f, dx } of ss.load ?? []) if (this.flasks[f]) sc.put(this.flasks[f], dx);
      return sc;
    });
    this.hoses = s.hoses.map((sh) => {
      const h = new Hose({ ...sh.inlet }, { ...sh.outlet });
      if (sh.funnel) loadVessel(h.funnel, sh.funnel);
      if (sh.drop) loadVessel(h.drop, sh.drop);
      return h;
    });
    for (const t of this.tools) this.place(t, this.toolXY(t));
    for (const sc of this.scales) this.placeScale(sc, this.scaleXY(sc));
    this.settle();
    this.won = false;
    this.falling = [];
    this.drag = this.toolDrag = this.valveDrag = this.scaleDrag = this.hoseDrag = null;
    this.hover = this.hoverTool = this.hoverTank = null;
    this.lastProgress = -1;
  }

  /** Make a new flask, scale or tool under the pointer (in client coordinates) and start carrying it. */
  spawn(kind: 'flask' | 'scale' | 'hose' | ToolKind, clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    const p = (this.pointer = this.toWorld({ x: clientX - r.left, y: clientY - r.top }));
    const { S } = this;
    if (kind === 'hose') {
      const h = new Hose(this.toFrac(p), this.toFrac({ x: p.x + 60 * S, y: p.y + 30 * S }));
      this.hoses.push(h);
      this.hoseDrag = { hose: h, end: 'both', gap: { x: 60 * S, y: 30 * S } };
    } else if (kind === 'flask') {
      const f = new Flask({ x: p.x, y: p.y - 35 * S }, CAP);
      f.glass = glassGrams(this.flasks.length);
      this.flasks.push(f);
      this.drag = { flask: f, zone: null, off: { x: 0, y: 35 * S } };
    } else if (kind === 'scale') {
      const at = this.toFrac(p);
      const sc = new Scale(at.x, at.y);
      this.scales.push(sc);
      this.scaleDrag = { scale: sc, off: { x: 0, y: 0 } };
    } else {
      const at = this.toFrac({ x: p.x, y: p.y - 40 * S });
      const t = new Tool(kind, this.nextToolId++, at.x, at.y);
      this.tools.push(t);
      this.toolDrag = { tool: t, off: { x: 0, y: 40 * S } };
    }
    this.updateHover();
  }

  private vessels(): Vessel[] {
    return [...this.flasks, ...this.tools.flatMap((t) => t.tanks), ...this.hoses.map((h) => h.funnel)];
  }

  /* ---------------- layout ---------------- */

  /** Lay out the world, once: the faucets evenly along its top, and the shelf in the home area at the bottom left. */
  private layoutWorld(): void {
    const { L, S, W, H } = this;
    L.pipeY = 30 * S;
    L.spoutY = 62 * S;
    L.faucets = FAUCETS.map((fa, i) => ({
      ...fa, output: faucetOutput(fa, this.chem.U), x: (W * (i + 0.5)) / FAUCETS.length,
    }));
    L.floorY = H - SINK_H * S;
    L.homes = [];
    for (let i = 0; i < N_FLASKS; i++) L.homes.push({ x: (HOME_W * (i + 0.5)) / N_FLASKS, y: L.floorY - 92 * S });
    L.benchY = Math.max(...L.homes.map((h) => h.y)) + 70 * S;
  }

  /** Fit the canvas to the stage, and the camera to the canvas. */
  private layout(): void {
    const { stage, canvas } = this;
    this.viewW = stage.clientWidth;
    this.viewH = stage.clientHeight;
    const dpr = (this.dpr = window.devicePixelRatio || 1);
    canvas.width = Math.round(this.viewW * dpr);
    canvas.height = Math.round(this.viewH * dpr);
    if (this.camMoved) this.clampCam();
    else {
      // the home area, as big as fits, along the bottom left
      this.zoom = Math.min(this.viewW / HOME_W, this.viewH / HOME_H);
      this.cam = { x: 0, y: this.H - this.viewH / this.zoom };
      this.clampCam();
    }
  }

  /** Keep the zoom in range and the world in view, centered along any axis where it's smaller than the view. */
  private clampCam(): void {
    const { W, H } = this;
    const minZoom = Math.min(this.viewW / W, this.viewH / H);
    this.zoom = Math.max(minZoom, Math.min(MAX_ZOOM, this.zoom));
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    this.cam = {
      x: vw >= W ? (W - vw) / 2 : Math.max(0, Math.min(W - vw, this.cam.x)),
      y: vh >= H ? (H - vh) / 2 : Math.max(0, Math.min(H - vh, this.cam.y)),
    };
  }

  /** A point on the canvas, in CSS pixels, in world units. */
  private toWorld(p: Point): Point {
    return { x: this.cam.x + p.x / this.zoom, y: this.cam.y + p.y / this.zoom };
  }

  /** A point in the world, on the canvas in CSS pixels. */
  private toScreen(p: Point): Point {
    return { x: (p.x - this.cam.x) * this.zoom, y: (p.y - this.cam.y) * this.zoom };
  }

  /** Draw in world units from here on. */
  private worldTransform(): void {
    const k = this.dpr * this.zoom;
    this.ctx.setTransform(k, 0, 0, k, -k * this.cam.x, -k * this.cam.y);
  }

  /**
   * Tools, scales and hose ends store their positions as fractions of the home area (see HOME_W), which
   * run outside [0, 1] for the rest of the world. This is such a position in world units.
   */
  private fromFrac(f: Point): Point {
    return { x: f.x * HOME_W, y: this.H - HOME_H + f.y * HOME_H };
  }

  private toFrac(p: Point): Point {
    return { x: p.x / HOME_W, y: (p.y - (this.H - HOME_H)) / HOME_H };
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
    return this.fromFrac({ x: sc.fx, y: sc.fy });
  }

  private placeScale(sc: Scale, p: Point): void {
    const { S, W } = this;
    const b = SCALE_SHAPE.box;
    const at = this.toFrac({
      x: Math.max(-b.x0 * S, Math.min(W - b.x1 * S, p.x)),
      y: Math.max(-b.y0 * S, Math.min(this.L.floorY - b.y1 * S, p.y)),
    });
    sc.fx = at.x;
    sc.fy = at.y;
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
    return this.fromFrac({ x: t.fx, y: t.fy });
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

  /** Whether p is inside a rectangle given in a tool's local units. */
  private inToolRect(t: Tool, p: Point, r: { x0: number; x1: number; y0: number; y1: number }): boolean {
    const a = this.onTool(t, { x: r.x0, y: r.y0 });
    const b = this.onTool(t, { x: r.x1, y: r.y1 });
    return p.x > a.x && p.x < b.x && p.y > a.y && p.y < b.y;
  }

  private valveAt(t: Tool, k: number): Point {
    return this.onTool(t, { x: tankX(t.shape.tanks[k]), y: t.shape.valveY });
  }

  /**
   * Point a valve's lever at p: straight up from the valve is fully open, straight right is closed,
   * and in between is partly open. Below the valve it closes, and left of it (past the down-left
   * diagonal) it opens, so a wild swing lands at the nearer end. A splitter's lever instead sweeps the
   * upper half: straight left sends everything left, straight right everything right, and below the
   * valve it goes to the nearer side. Within VALVE_DEADZONE of the valve the angle is too jumpy to mean
   * anything, so the lever stays put.
   */
  private aimValve(t: Tool, k: number, p: Point): void {
    const vc = this.valveAt(t, k);
    if (Math.hypot(p.x - vc.x, p.y - vc.y) < VALVE_DEADZONE) return;
    const a = Math.atan2(vc.y - p.y, p.x - vc.x); // counterclockwise from right
    if (t.kind === 'splitter') {
      t.valves[k] = a >= 0 ? 1 - a / Math.PI : a > -Math.PI / 2 ? 1 : 0;
      return;
    }
    const open = a < -0.75 * Math.PI ? 1 : a / (Math.PI / 2);
    t.valves[k] = Math.max(0, Math.min(1, open));
  }

  private tankRect(t: Tool, k: number): { x0: number; x1: number; y0: number; y1: number } {
    const o = this.toolXY(t);
    const { S } = this;
    const tk = t.shape.tanks[k];
    return { x0: o.x + tk.x0 * S, x1: o.x + tk.x1 * S, y0: o.y, y1: o.y + (t.shape.tankH ?? TANK_H) * S };
  }

  /** Move a tool, keeping it on the stage and above the sink. */
  private place(t: Tool, p: Point): void {
    const { S, W } = this;
    const b = t.shape.box;
    const at = this.toFrac({
      x: Math.max(-b.x0 * S, Math.min(W - b.x1 * S, p.x)),
      y: Math.max(-b.y0 * S, Math.min(this.L.floorY - b.y1 * S, p.y)),
    });
    t.fx = at.x;
    t.fy = at.y;
  }

  /* ---------------- hose geometry ---------------- */

  /** A hose end's point in stage coordinates: the funnel's mouth, or the outlet's tip. */
  private hoseEnd(h: Hose, end: 'inlet' | 'outlet'): Point {
    return this.fromFrac(h[end]);
  }

  private moveHoseEnd(h: Hose, end: 'inlet' | 'outlet', p: Point): void {
    const { S, W } = this;
    const x = Math.max(16 * S, Math.min(W - 16 * S, p.x));
    const y = Math.max(4 * S, Math.min(this.L.floorY - 16 * S, p.y));
    h[end] = this.toFrac({ x, y });
  }

  /** The hose end under p, frontmost first. */
  private hitHoseEnd(p: Point): { hose: Hose; end: 'inlet' | 'outlet' } | null {
    const { S } = this;
    for (let i = this.hoses.length - 1; i >= 0; i--)
      for (const end of ['outlet', 'inlet'] as const) {
        const e = this.hoseEnd(this.hoses[i], end);
        // the funnel hangs below its mouth, and the nozzle above its tip
        const cy = end === 'inlet' ? e.y + 6 * S : e.y - 6 * S;
        if (Math.hypot(p.x - e.x, p.y - cy) < 16 * S) return { hose: this.hoses[i], end };
      }
    return null;
  }

  /** Every open top that falling fluid can land in. */
  private mouths(): Mouth[] {
    const { S, drag } = this;
    const out: Mouth[] = [];
    for (const f of this.flasks) {
      const carried = drag?.flask === f;
      if (carried && f.ang !== 0) continue; // tilted to pour
      const p = carried ? f : f.home;
      out.push({ v: f, x0: p.x - FLASK_CATCH * S, x1: p.x + FLASK_CATCH * S, y: p.y });
    }
    for (const t of this.tools) {
      t.tanks.forEach((v, k) => {
        const r = this.tankRect(t, k);
        out.push({ v, x0: r.x0, x1: r.x1, y: r.y0 });
      });
    }
    for (const h of this.hoses) {
      const e = this.hoseEnd(h, 'inlet');
      out.push({ v: h.funnel, x0: e.x - 14 * S, x1: e.x + 14 * S, y: e.y });
    }
    return out;
  }

  /* ---------------- input ---------------- */

  private bindInput(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      c.addEventListener(type, fn);
      this.cleanups.push(() => c.removeEventListener(type, fn));
    };
    // drag the background (or anything with the middle button) to pan
    const startPan = (e: PointerEvent) => {
      this.panDrag = { start: this.screenPt(e), cam: { ...this.cam } };
      c.style.cursor = 'grabbing';
      c.setPointerCapture(e.pointerId);
    };
    on('pointerdown', (e) => {
      const p = this.ptr(e);
      this.pointer = p;
      this.rightHeld = (e.buttons & 2) !== 0;
      if (e.button === 1) {
        startPan(e);
        e.preventDefault();
        return;
      }
      const t = this.hitTool(p);
      const hoseEnd = e.button === 0 ? this.hitHoseEnd(p) : null;
      if (hoseEnd) {
        this.hoseDrag = hoseEnd;
        const hs = this.hoses;
        hs.push(...hs.splice(hs.indexOf(hoseEnd.hose), 1)); // bring to front
        c.setPointerCapture(e.pointerId);
      } else if (e.button === 2) {
        if (t && !t.shape.noValve) {
          // the valve nearest the pointer, left to right
          const o = this.toolXY(t);
          const dist = (j: number) => Math.abs(p.x - o.x - tankX(t.shape.tanks[j]) * this.S);
          let k = 0;
          for (let j = 1; j < t.tanks.length; j++) if (dist(j) < dist(k)) k = j;
          this.valveDrag = { tool: t, k };
          this.aimValve(t, k, p);
          c.setPointerCapture(e.pointerId);
        }
      } else if (e.button === 0) {
        if (t?.kind === 'spectrometer' && this.inToolRect(t, p, SPECTROMETER.button)) {
          if (t.scan()) this.rumbles.set(t, rumble(SCAN_RAMP));
        } else if (t) {
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
          } else startPan(e);
        }
      }
      this.updateHover();
      e.preventDefault();
    });
    // moves and releases are heard on the whole window, so a drag can start on the palette
    const onWindow = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn);
      this.cleanups.push(() => window.removeEventListener(type, fn));
    };
    /** Move whatever is being dragged to follow the pointer, at p in the world. */
    const follow = (p: Point) => {
      if (this.valveDrag) {
        this.aimValve(this.valveDrag.tool, this.valveDrag.k, p);
      } else if (this.toolDrag) {
        const { tool, off } = this.toolDrag;
        this.place(tool, { x: p.x - off.x, y: p.y - off.y });
      } else if (this.scaleDrag) {
        const { scale, off } = this.scaleDrag;
        this.placeScale(scale, { x: p.x - off.x, y: p.y - off.y });
        this.settle();
      } else if (this.hoseDrag) {
        const { hose, end, gap } = this.hoseDrag;
        if (end === 'both') {
          this.moveHoseEnd(hose, 'inlet', p);
          this.moveHoseEnd(hose, 'outlet', { x: p.x + gap!.x, y: p.y + gap!.y });
        } else this.moveHoseEnd(hose, end, p);
      }
      this.updateHover();
    };
    onWindow('pointermove', (e) => {
      if (this.panDrag) {
        const sp = this.screenPt(e);
        const { start, cam } = this.panDrag;
        this.cam = { x: cam.x - (sp.x - start.x) / this.zoom, y: cam.y - (sp.y - start.y) / this.zoom };
        this.clampCam();
        this.camMoved = true;
        this.pointer = this.toWorld(sp);
        return;
      }
      const p = (this.pointer = this.ptr(e));
      // pressing or releasing a second button while one is held is a move, not a down or up
      this.rightHeld = (e.buttons & 2) !== 0;
      if ((this.drag || this.toolDrag || this.scaleDrag || this.hoseDrag) && !(e.buttons & 1)) {
        // let go of the left button while holding the right: drop what's carried
        endDrag(e);
        return;
      }
      follow(p);
    });
    // scroll to zoom, keeping the world point under the pointer where it is
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sp = this.screenPt(e);
      const at = this.toWorld(sp);
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewH : 1);
      this.zoom *= Math.exp(-px * ZOOM_PER_PX);
      this.clampCam(); // clamps the zoom
      this.cam = { x: at.x - sp.x / this.zoom, y: at.y - sp.y / this.zoom };
      this.clampCam();
      this.camMoved = true;
      this.pointer = this.toWorld(sp);
      if (!this.panDrag) follow(this.pointer);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    this.cleanups.push(() => c.removeEventListener('wheel', onWheel));
    const endDrag = (e: PointerEvent) => {
      if (this.panDrag) {
        this.panDrag = null;
        c.style.cursor = '';
      }
      this.pointer = this.ptr(e);
      this.rightHeld = (e.buttons & 2) !== 0;
      if (this.cb.isDiscard(e.clientX, e.clientY)) {
        // dropped back on the palette: put it away
        const t = this.toolDrag?.tool;
        const sc = this.scaleDrag?.scale;
        const f = this.drag?.flask;
        if (t) this.tools.splice(this.tools.indexOf(t), 1);
        if (sc) this.scales.splice(this.scales.indexOf(sc), 1);
        const hose = this.hoseDrag?.hose;
        if (hose) this.hoses.splice(this.hoses.indexOf(hose), 1);
        if (f) {
          this.flasks.splice(this.flasks.indexOf(f), 1);
          for (const s of this.scales) s.remove(f);
          this.drag = null;
        }
      }
      this.toolDrag = this.valveDrag = this.scaleDrag = this.hoseDrag = null;
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
    onWindow('pointerup', endDrag);
    onWindow('pointercancel', endDrag);
    on('pointerleave', () => {
      if (this.drag || this.toolDrag || this.scaleDrag || this.valveDrag || this.hoseDrag || this.panDrag) return;
      this.pointer = { x: -1, y: -1 };
      this.updateHover();
    });
    on('contextmenu', (e) => e.preventDefault());
    // the right button pours while carrying, which shouldn't open a menu wherever it's clicked
    onWindow('contextmenu', (e) => {
      if (this.drag || this.toolDrag || this.scaleDrag || this.hoseDrag) e.preventDefault();
    });
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
    const busy = this.drag || this.toolDrag || this.valveDrag || this.scaleDrag || this.hoseDrag;
    this.hoverTool = busy ? null : this.hitTool(p);
    const hit = busy ? null : this.tankAt(p);
    this.hoverTank = hit ? hit.tool.tanks[hit.k] : null;
    this.hover = busy || this.hoverTool ? null : this.hitFlask(p);
  }

  /** Where an event happened on the canvas, in CSS pixels. */
  private screenPt(e: MouseEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Where an event happened in the world. */
  private ptr(e: MouseEvent): Point {
    return this.toWorld(this.screenPt(e));
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
    for (const h of this.hoses) {
      const e = this.hoseEnd(h, 'inlet');
      if (Math.abs(p.x - e.x) < 24 * S && p.y > e.y - 40 * S && p.y < e.y + 20 * S)
        return { kind: 'tank', v: h.funnel, x: e.x, y: e.y };
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
    if (p.y > L.benchY + 8 * S) return { kind: 'sink' };
    return null;
  }

  /** The vessels being carried: they catch a faucet's stream only while the right button is held. */
  private carried(): Set<Vessel> {
    const out = new Set<Vessel>();
    if (this.drag) out.add(this.drag.flask);
    if (this.toolDrag) for (const v of this.toolDrag.tool.tanks) out.add(v);
    if (this.hoseDrag && this.hoseDrag.end !== 'outlet') out.add(this.hoseDrag.hose.funnel);
    return out;
  }

  /* ---------------- main loop ---------------- */

  private frame = (now: number): void => {
    const elapsed = (now - this.last) / 1000;
    const dt = Math.min(0.1, elapsed);
    this.last = now;

    // spectrometer runs go by the clock, like their rumble, even while the tab is hidden
    for (const t of this.tools) if (t.scanning) t.scanAge += elapsed;
    for (const [t, stop] of this.rumbles) {
      if (!this.tools.includes(t)) stop(); // put away, or the bench was replaced
      if (!this.tools.includes(t) || !t.scanning) this.rumbles.delete(t);
    }
    const { S, L, drag, pointer } = this;

    // player actions, real time
    if (drag) {
      const D = drag.flask;
      // a scale takes a flask whenever it's held over one, but pouring needs the right button
      let z = this.zoneAt(pointer, D);
      if (z && z.kind !== 'scale' && !this.rightHeld) z = null;
      drag.zone = z;
      D.ang = 0;
      if (!z) {
        D.x = pointer.x - drag.off.x;
        D.y = pointer.y - drag.off.y;
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

    // faucets also run in real time: each fills whatever is parked right under it, or held there with the right button
    const mouths = this.mouths();
    const carried = this.carried();
    this.faucetFlows = [];
    for (const fa of L.faucets) {
      fa.output = faucetOutput(fa, this.chem.U); // cheap, and follows edits to the chemistry
      const m = faucetTarget(mouths, { x: fa.x, y: L.spoutY }, FAUCET_REACH * S, carried, this.rightHeld);
      if (!m) continue;
      m.v.addFrom(fa.output, FILL_RATE * dt);
      this.faucetFlows.push({ fa, m });
    }

    // tools and chemistry, sim time, interleaved so a drip meets the reaction it feeds
    const simDt = dt * this.speed;
    const vessels = this.vessels();
    if (simDt > 0) {
      const sub = Math.ceil(simDt / 0.02);
      const h = simDt / sub;
      const spouts = this.tools.map((t) => t.shape.spouts.map((_, j) => this.spoutAt(t, j)));
      const targets = spouts.map((sps) => sps.map((sp) => mouthBelow(mouths, sp)));
      const outlets = this.hoses.map((hose) => this.hoseEnd(hose, 'outlet'));
      const hoseTargets = outlets.map((sp) => mouthBelow(mouths, sp));
      // a fast flow streams straight into what's below (whatever doesn't fit overflows to the sink);
      // a slow one gathers in a drop, which falls on its own time
      const pour = (drop: Vessel, out: Vessel | null, sp: Point, target: Mouth | null): boolean => {
        const down = drip(drop, out, h);
        if (down && down === out) target?.v.addFrom(out, volume(out));
        else if (down) this.falling.push({ v: down, x: sp.x, y: sp.y, vy: 0 });
        return !!down && down === out;
      };
      for (let i = 0; i < sub; i++) {
        this.tools.forEach((t, j) =>
          t.step(h).forEach((out, k) => (t.streaming[k] = pour(t.drops[k], out, spouts[j][k], targets[j][k]))),
        );
        this.hoses.forEach((hose, j) => (hose.streaming = pour(hose.drop, hose.step(h), outlets[j], hoseTargets[j])));
        // falling drops land in the first open top they pass, or go down the sink
        this.falling = this.falling.filter((d) => {
          const from = d.y;
          d.vy += GRAVITY * h;
          d.y += d.vy * h;
          const m = mouthBelow(mouths, { x: d.x, y: from });
          if (m && m.y <= d.y) m.v.addFrom(d.v, volume(d.v));
          return !(m && m.y <= d.y) && d.y < this.H;
        });
        for (const v of vessels) {
          this.chem.step(v, h);
          // by molecules, breaking bonds swells a fluid, and whatever no longer fits spills
          const over = volume(v) - v.cap;
          if (over > 0) transfer(v, null, over);
        }
      }
    }

    // goal
    let tgt = 0;
    for (const v of vessels) tgt += sustenance(v);
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
      T: temperature(f), volume: volume(f), cap: f.cap, unit: volumeUnit(), rows,
      // the panel goes beside it on screen
      x0: this.toScreen({ x: target.x0, y: target.y }).x,
      x1: this.toScreen({ x: target.x1, y: target.y }).x,
      y: this.toScreen({ x: target.x0, y: target.y }).y,
      stageW: this.viewW, stageH: this.viewH,
    });
  }

  /* ---------------- drawing ---------------- */

  private readTheme(): void {
    const cs = getComputedStyle(document.documentElement);
    for (const k of THEME_KEYS) this.theme[k] = cs.getPropertyValue('--' + k).trim();
  }

  private drawFlask(f: Flask, mx: number, my: number, ang: number): void {
    const { ctx, S, theme } = this;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.scale(S, S);
    if (f.N > TRACE) {
      // fill level is horizontal in screen space, even when the flask is tilted, and
      // high enough that the colored area is in proportion to the amount of fluid
      ctx.save();
      ctx.clip(FLASK_PATH);
      const pts = tiltedOutline(ang);
      const minX = mx + S * Math.min(...pts.map((p) => p.x));
      const maxX = mx + S * Math.max(...pts.map((p) => p.x));
      const maxY = my + S * Math.max(...pts.map((p) => p.y));
      this.worldTransform();
      const top = my + S * fillLevel(ang, volume(f) / f.cap);
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

  /** An open-topped glass tank with a rounded floor, or a funnel narrowing to a stem. */
  private drawTank(v: Vessel, x0: number, y0: number, x1: number, y1: number, funnel = false): void {
    const { ctx, S, theme } = this;
    const r = 6 * S;
    const wall = new Path2D();
    wall.moveTo(x0, y0);
    if (funnel) {
      const cx = (x0 + x1) / 2;
      wall.lineTo(cx - 3 * S, y1);
      wall.lineTo(cx + 3 * S, y1);
    } else {
      wall.lineTo(x0, y1 - r);
      wall.quadraticCurveTo(x0, y1, x0 + r, y1);
      wall.lineTo(x1 - r, y1);
      wall.quadraticCurveTo(x1, y1, x1, y1 - r);
    }
    wall.lineTo(x1, y0);
    const inside = new Path2D(wall);
    inside.closePath();
    if (v.N > TRACE) {
      ctx.save();
      ctx.clip(inside);
      const top = y1 - Math.min(1, volume(v) / v.cap) * (y1 - y0);
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
    } else if (t.kind === 'splitter') {
      // the stem down through the valve, then a fork out to the two spouts
      const fork = sh.valveY + 10;
      pipes([[0, sh.tankH!], [0, fork]], 4);
      for (const x of sh.spouts) pipes([[0, fork], [x, fork + 16], [x, sh.spoutY - 4]], 4);
    } else if (t.kind === 'sorter') {
      // the stem down to the chute, a drop pipe under each screen, and the chute's end turning down
      const x = tankX(sh.tanks[0]);
      pipes([[x, sh.tankH!], [x, chuteY(x)]], 4);
      sh.spouts.forEach((x, k) => pipes([[x, k < sh.spouts.length - 1 ? chuteY(x) + 8 : SORTER_CHUTE.y1], [x, sh.spoutY - 4]], 4));
    } else if (t.kind === 'spectrometer') pipes([[0, sh.tankH!], [0, SPECTROMETER.body.y0]], 4);
    else pipes([[0, TANK_H], [0, sh.spoutY - 4]], 4);
    for (const x of sh.spouts) ctx.fillRect(o.x + (x - 4) * S, o.y + (sh.spoutY - 6) * S, 8 * S, 6 * S);
    t.tanks.forEach((v, k) => {
      const r = this.tankRect(t, k);
      this.drawTank(v, r.x0, r.y0, r.x1, r.y1, sh.funnel);
    });
    if (t.kind === 'exchanger') this.drawHelix(t);
    if (t.kind === 'sorter') this.drawChute(t);
    if (t.kind === 'spectrometer') this.drawSpectrometer(t);
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

    if (!sh.noValve) t.tanks.forEach((_, k) => {
      // valve: the lever points right when closed and up when open, toward where the pointer turned it;
      // a splitter's points toward the side that gets more, straight up for an even split
      const vc = this.valveAt(t, k);
      const a = t.kind === 'splitter' ? -Math.PI * (1 - t.valves[k]) : -t.valves[k] * (Math.PI / 2);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 3 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(vc.x, vc.y);
      ctx.lineTo(vc.x + 13 * S * Math.cos(a), vc.y + 13 * S * Math.sin(a));
      ctx.stroke();
      ctx.fillStyle = theme.bench;
      ctx.strokeStyle = theme.pipe;
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.arc(vc.x, vc.y, 5 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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

  /**
   * The size sorter's chute: a sloping floor with two screens in it, fine then coarse, each over a hopper
   * into its drop pipe, and a film of what's flowing down it.
   */
  private drawChute(t: Tool): void {
    const { ctx, S, theme } = this;
    const o = this.toolXY(t);
    const c = SORTER_CHUTE;
    const sp = t.shape.spouts;
    const HALF = 12; // half a screen's length
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(S, S);
    ctx.lineCap = 'butt';
    // hoppers under the screens
    ctx.fillStyle = theme.pipe;
    for (const x of sp.slice(0, -1)) {
      ctx.beginPath();
      ctx.moveTo(x - HALF, chuteY(x - HALF) + 2);
      ctx.lineTo(x + HALF, chuteY(x + HALF) + 2);
      ctx.lineTo(x + 3, chuteY(x) + 10);
      ctx.lineTo(x - 3, chuteY(x) + 10);
      ctx.closePath();
      ctx.fill();
    }
    // the floor, solid between the screens and open-meshed over them (finer over the first)
    const floor = (x0: number, x1: number, dash: number[]) => {
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x0, chuteY(x0));
      ctx.lineTo(x1, chuteY(x1));
      ctx.stroke();
    };
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 4;
    let x = c.x0;
    sp.slice(0, -1).forEach((h, k) => {
      floor(x, h - HALF, []);
      floor(h - HALF, h + HALF, k ? [3, 3] : [1.5, 1.5]);
      x = h + HALF;
    });
    floor(x, c.x1, []);
    ctx.setLineDash([]);
    // the end of the chute turns down into the last spout
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x1 - 2, c.y1);
    ctx.quadraticCurveTo(c.x1 + 4, c.y1, c.x1 + 4, c.y1 + 8);
    ctx.stroke();
    // what's sliding down: before each screen, everything that hasn't fallen through one yet
    const stops = [tankX(t.shape.tanks[0]), ...sp.slice(0, -1), c.x1];
    ctx.lineWidth = 2;
    for (let k = 0; k < sp.length; k++) {
      const on = new Vessel(Infinity);
      for (const v of t.out.slice(k)) if (v) on.addFrom(v, volume(v));
      if (on.N <= 0) continue;
      ctx.strokeStyle = fluidColor(on);
      ctx.beginPath();
      ctx.moveTo(stops[k], chuteY(stops[k]) - 3);
      ctx.lineTo(stops[k + 1], chuteY(stops[k + 1]) - 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * A mass spectrometer's cabinet: an old green-on-black screen with a hexagon per molecule size (1, 2, 3
   * atoms), each cut into sextants by color (see SEXTANT_ATOMS) that glow as bright as their share of the
   * last sample (see spectrum), lighting up one hexagon at a time as a run goes on; and the run button.
   */
  private drawSpectrometer(t: Tool): void {
    const { ctx, S, theme } = this;
    const o = this.toolXY(t);
    const { body, screen: sc, hexes, button } = SPECTROMETER;
    const green = (a: number) => `rgba(${PHOSPHOR}, ${a})`;
    /** Canvas shadows are in device pixels, whatever the transform. */
    const blur = (local: number) => local * S * this.zoom * this.dpr;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(S, S);
    ctx.fillStyle = theme.bench;
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(body.x0, body.y0, body.x1 - body.x0, body.y1 - body.y0, 6);
    ctx.fill();
    ctx.stroke();

    // the screen, black in either theme
    const glass = new Path2D();
    glass.roundRect(sc.x0, sc.y0, sc.x1 - sc.x0, sc.y1 - sc.y0, 5);
    ctx.fillStyle = '#040a06';
    ctx.fill(glass);
    ctx.save();
    ctx.clip(glass);
    const scanningHex = t.scanning ? SCAN_LIGHTS.findIndex((at) => t.scanAge < at) : -1;
    hexes.xs.forEach((cx, w) => {
      const { y: cy, r } = hexes;
      // flat-topped, so sextant j runs clockwise from the corner at −120° + 60j°
      const corner = (j: number) => {
        const a = ((-120 + 60 * j) * Math.PI) / 180;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
      };
      if (t.reading && t.scanAge >= SCAN_LIGHTS[w])
        for (let j = 0; j < 6; j++) {
          const b = Math.min(1, t.reading[w * 6 + j]);
          if (b <= 0) continue;
          ctx.fillStyle = ctx.shadowColor = green(b);
          ctx.shadowBlur = blur(5);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(...corner(j));
          ctx.lineTo(...corner(j + 1));
          ctx.closePath();
          ctx.fill();
        }
      // the one being read flickers
      const a = w === scanningHex ? 0.5 + 0.35 * Math.sin(performance.now() / 40) : 0.85;
      ctx.shadowColor = green(a);
      ctx.shadowBlur = blur(2);
      ctx.strokeStyle = green(a);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let j = 0; j < 6; j++) ctx.lineTo(...corner(j));
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = green(a * 0.3);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let j = 0; j < 3; j++) {
        ctx.moveTo(...corner(j));
        ctx.lineTo(...corner(j + 3));
      }
      ctx.stroke();
      ctx.fillStyle = green(0.7);
      ctx.font = '7px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(w + 1), cx, sc.y1 - 5);
    });
    // scanlines
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    for (let y = sc.y0; y < sc.y1; y += 1.5) ctx.fillRect(sc.x0, y, sc.x1 - sc.x0, 0.6);
    ctx.restore();
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 1.5;
    ctx.stroke(glass);

    // a lamp that blinks through a run, and the run button
    ctx.fillStyle = t.scanning && Math.floor(t.scanAge * 3) % 2 === 0 ? '#ffb43a' : theme.pipe;
    ctx.beginPath();
    ctx.arc(sc.x0 + 6, (button.y0 + button.y1) / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    const busy = this.drag || this.toolDrag || this.valveDrag || this.scaleDrag || this.hoseDrag;
    const hot = !busy && !t.scanning && this.inToolRect(t, this.pointer, button);
    ctx.fillStyle = theme.line;
    ctx.strokeStyle = hot ? theme.accent : theme.pipe;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(button.x0, button.y0, button.x1 - button.x0, button.y1 - button.y0, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = t.scanning ? theme.muted : theme.ink;
    ctx.font = '10px "Schibsted Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.scanning ? 'busy' : 'run', (button.x0 + button.x1) / 2, (button.y0 + button.y1) / 2 + 0.5);
    ctx.restore();
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

  /** A hose: a funnel at the inlet, a nozzle at the outlet, and a drooping tube between, showing what's flowing. */
  private drawHose(hose: Hose): void {
    const { ctx, S, theme } = this;
    const i = this.hoseEnd(hose, 'inlet');
    const o = this.hoseEnd(hose, 'outlet');
    const a = { x: i.x, y: i.y + 12 * S };
    const b = { x: o.x, y: o.y - 10 * S };
    const droop = 70 * S;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x, a.y + droop, b.x, b.y - droop, b.x, b.y);
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 7 * S;
    ctx.stroke();
    ctx.strokeStyle = hose.out ? fluidColor(hose.out) : theme.bench;
    ctx.lineWidth = 4 * S;
    ctx.stroke();
    // funnel
    ctx.beginPath();
    ctx.moveTo(i.x - 14 * S, i.y);
    ctx.lineTo(i.x + 14 * S, i.y);
    ctx.lineTo(i.x + 4 * S, i.y + 12 * S);
    ctx.lineTo(i.x - 4 * S, i.y + 12 * S);
    ctx.closePath();
    ctx.fillStyle = hose.funnel.N > TRACE ? fluidColor(hose.funnel) : theme.glasshi;
    ctx.fill();
    ctx.strokeStyle = theme.glass;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // nozzle
    ctx.fillStyle = theme.pipe;
    ctx.fillRect(o.x - 4 * S, o.y - 10 * S, 8 * S, 10 * S);
    ctx.restore();
  }

  /** The drops hanging from slow outlets, and those on their way down. */
  private drawDrops(): void {
    const { ctx, S } = this;
    const bead = (v: Vessel, x: number, y: number, hanging: boolean) => {
      if (v.N <= 0) return;
      const r = DROP_R * Math.cbrt(v.N / DROP_R_ATOMS) * S;
      ctx.fillStyle = fluidColor(v);
      ctx.beginPath();
      // a hanging drop swells from the outlet's tip; a falling one is centered where it is
      ctx.arc(x, hanging ? y + r : y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const t of this.tools)
      t.drops.forEach((v, k) => {
        const sp = this.spoutAt(t, k);
        bead(v, sp.x, sp.y, true);
      });
    for (const hose of this.hoses) {
      const sp = this.hoseEnd(hose, 'outlet');
      bead(hose.drop, sp.x, sp.y, true);
    }
    for (const d of this.falling) bead(d.v, d.x, d.y, false);
  }

  /** A stream falling from (x1, y1) to (x2, y2), `flow` flasks per second wide (see STREAM_WIDTH). */
  private drawStream(x1: number, y1: number, x2: number, y2: number, color: string, flow: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = STREAM_WIDTH * Math.sqrt(flow) * this.S;
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
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    this.readTheme();
    const { theme } = this;
    this.worldTransform();
    // the world's edge, for when it's zoomed out far enough to see it
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1 / this.zoom;
    ctx.strokeRect(0, 0, W, H);
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
        if (!out || !t.streaming[k]) return;
        const sp = this.spoutAt(t, k);
        const m = mouthBelow(mouths, sp);
        this.drawStream(sp.x, sp.y, sp.x, m ? m.y + 2 * S : H, fluidColor(out), t.flow[k]);
      });
    for (const hose of this.hoses) {
      if (!hose.out || !hose.streaming) continue;
      const sp = this.hoseEnd(hose, 'outlet');
      const m = mouthBelow(mouths, sp);
      this.drawStream(sp.x, sp.y, sp.x, m ? m.y + 2 * S : H, fluidColor(hose.out), hose.flow);
    }
    for (const { fa, m } of this.faucetFlows) this.drawStream(fa.x, L.spoutY, fa.x, m.y + 2 * S, fluidColor(fa.output), FILL_RATE / CAP);
    if (drag && drag.flask.N > TRACE) {
      const D = drag.flask;
      const z = drag.zone;
      if (z?.kind === 'flask' && volume(z.f) < z.f.cap - TRACE)
        this.drawStream(D.x, D.y, z.f.home.x, z.f.home.y + 4 * S, fluidColor(D), POUR_RATE / CAP);
      if (z?.kind === 'tank' && volume(z.v) < z.v.cap - TRACE) this.drawStream(D.x, D.y, z.x, z.y + 4 * S, fluidColor(D), POUR_RATE / CAP);
      if (z?.kind === 'sink') this.drawStream(D.x, D.y, D.x - 4 * S, H, fluidColor(D), POUR_RATE / CAP);
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

    for (const t of this.tools) {
      // a running spectrometer shakes, harder as its run goes on
      const shake = scanLevel(t.scanAge) * SHAKE * S;
      ctx.save();
      if (shake) ctx.translate(shake * (2 * Math.random() - 1), shake * (2 * Math.random() - 1));
      this.drawTool(t);
      ctx.restore();
    }
    for (const h of this.hoses) this.drawHose(h);
    this.drawDrops();
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
    const amount = Math.sqrt(Math.min(1, (4 * volume(f)) / cap));
    const { S } = this;
    const T = temperature(f);
    this.radialGlow(cx, cy, haloRadius(T) * S, color, haloAlpha(T) * amount, LOOK.haloSharpness);
    this.radialGlow(cx, cy, coronaRadius(T) * S, color, coronaAlpha(T) * amount, LOOK.coronaSharpness);
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
