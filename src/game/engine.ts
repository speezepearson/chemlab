import { temperature, type Fluid, type ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
import { CAP, FILL_RATE, FLASK_L, GOAL_L, GOAL_VOLUME, HOME_H, HOME_W, N_FLASKS, POUR_RATE, TRACE } from './config';
import { FAUCETS, faucetOutput, faucetTarget, type Faucet } from './faucets';
import { LOOK, coronaAlpha, coronaRadius, css, glowFalloff, haloAlpha, haloRadius, type RGB } from './appearance';
import { FLASK_OUTLINE, FLASK_PATH_DATA, areaBelow, fillLevel, tiltedOutline } from './flaskShape';
import { cool, exposure, taper } from './cooling';
import { Flask, Vessel, fluidColor, glowColor, transfer, volume, volumeUnit, type Point } from './flask';
import { DEFAULT_PRESET, METER_AT, RECEPTACLE_AT, SPECTROMETER_AT, applyFill, type Preset } from './presets';
import { loadChem, loadVessel, saveChem, saveVessel, type SaveState } from './save';
import { SCALE_SHAPE, Scale, glassGrams } from './scale';
import { CENTER, placement, type Placement } from './place';
import { rumble, type Rumble } from './rumble';
import { beeper, type Beeper } from './beeper';
import { WaterSounds } from './water';
import {
  HEATER, HEATER_BOX, HEATER_CELLS, HEATER_TUBE, METER_BODY, METER_DIGITS, RECEPTACLE_BODY, RECEPTACLE_LAMPS,
  RECEPTACLE_TIMES, SUMP_TIP, meterText, sumpFillHeight, HELIX, Hose, MAX_FLOW, SCAN_LIGHTS, SHAPES,
  SORTER_CHUTE, SPECTROMETER, TANK_H, TOOL_NAMES, Tool, chuteY, cupFillHeight, drip, UNIQUE_TOOLS, mouthBelow, scanLevel,
  tankX, type Mouth, type ToolKind,
} from './tools';

/** What the hover panel needs to show for one vessel: all of it in god mode, otherwise just its color. */
export interface Inspection {
  /** Outside god mode: show only the color. */
  brief: boolean;
  /** The fluid's color, as drawn in the vessel; null if it's empty. */
  color: string | null;
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
  /** The receptacle has taken GOAL_VOLUME of the target. */
  onWin(): void;
  /** Throttled to ~10 Hz; null when nothing is inspected. */
  onInspect(info: Inspection | null): void;
  /** A vessel was double-clicked in god mode; look it up with GameEngine.vessel(id). */
  onEdit(id: string): void;
  /** Outside god mode, a flask or a tool's tank was double-clicked to label it: its id, as for onEdit. */
  onLabel(id: string): void;
  /** Whether letting go of something at this point (in client coordinates) puts it away. */
  isDiscard(clientX: number, clientY: number): boolean;
}

/** Where a carried flask is: pouring zones tilt it, and a scale stands it on its platform. */
type Zone =
  | { kind: 'flask'; f: Flask }
  | { kind: 'tank'; v: Vessel; x: number; y: number }
  | { kind: 'scale'; scale: Scale; dx: number; p: Point }
  | { kind: 'sink' };
/** A faucet where it is: (fx, fy) is where it joins its pipe, as fractions of the home area (see HOME_W). */
type FaucetLayout = Faucet & { fx: number; fy: number; output: Fluid };

interface Layout {
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
/** How far a faucet's spout is below where it joins its pipe, in local units. */
const FAUCET_DROP = 32;
/** How far below a faucet something can be and still get filled, in local units. */
const FAUCET_REACH = 24;
/** Half-width of the part of a flask's mouth that catches a falling stream, in local units. */
const FLASK_CATCH = 14;
/** Where an overflowing flask spills, right of its mouth's center, in local units: just outside its lip. */
const FLASK_LIP = 12;
/** Where a flask's label sits, below its mouth, in local units: the text's baseline, on the bench under it. */
const LABEL_Y = 86;
/** How close to a valve, in world units, the pointer can be before it stops turning the lever: the valve's core (see drawTool), not its lever. */
const VALVE_DEADZONE = 6;
/** How near a valve's center, in world units, the right button grabs it: the reach of its lever, or a dial's ticks. */
const VALVE_REACH = 15;
/**
 * Side of the square, in screen pixels, around the pointer that's checked for a tool's drawing (see drawnAt):
 * odd, so it's centered, and wide enough to catch a thin pipe.
 */
const HIT_PX = 5;
/** How opaque a tool's drawing must be at the pointer to count as hit, from 0 to 255: anything but nothing. */
const HIT_ALPHA = 4;
const SINK_H = 16;
/** Width of a stream flowing one flask per second, in world units; it goes as the square root of the flow. */
const STREAM_WIDTH = 4.5;
/** How fast a falling drop speeds up, in world units per sim second squared: a 500-unit fall takes 0.7 s. */
const GRAVITY = 2000;
/** Drawn radius of a DROP_R_ATOMS drop, in world units; it goes as the cube root of the drop's size. */
const DROP_R = 3;
const DROP_R_ATOMS = 1.5e6;
/** The most the camera zooms in and out, in screen pixels per world unit. */
const MAX_ZOOM = 4;
const MIN_ZOOM = 0.05;
/** How much a pixel of scroll zooms: the zoom is multiplied by e^(−this·Δy). */
const ZOOM_PER_PX = 0.0015;
/** The separator's manifold, below its valve, spanning its five spouts, in local units. */
const SEP_BODY = { x0: -150, x1: 150, y0: 100, y1: 112 };
/** How far a spectrometer shakes at the height of its run, in world units. */
const SHAKE = 2.5;
/** A CRT's phosphor green. */
const PHOSPHOR = '64, 255, 110';
/** The heater's wire as its dial turns up, at even steps from 0 to 1: copper, then glowing red, orange, yellow, white. */
const WIRE_RAMP: readonly RGB[] = [[184, 115, 51], [196, 62, 38], [255, 96, 30], [255, 192, 84], [255, 250, 236]];

/** The heater's wire's color at dial setting d (see WIRE_RAMP). */
function wireColor(d: number): RGB {
  const x = Math.max(0, Math.min(1, d)) * (WIRE_RAMP.length - 1);
  const i = Math.min(WIRE_RAMP.length - 2, Math.floor(x));
  return WIRE_RAMP[i].map((c, k) => c + (WIRE_RAMP[i + 1][k] - c) * (x - i)) as RGB;
}

const FLASK_PATH = new Path2D(FLASK_PATH_DATA);
/** The inside of a flask, in local units squared, as drawn. */
const FLASK_AREA = areaBelow(FLASK_OUTLINE, 0);
/** How tall a flask is inside, mouth to base, in local units. */
const FLASK_DEPTH = 70;
/** Width of the stem a funnel-shaped tank narrows to, in local units (see drawTank). */
const FUNNEL_STEM = 6;

/** Owns the canvas: layout, pointer input, the simulation loop and drawing. */
export class GameEngine {
  speed = 1;
  god = true;

  private ctx: CanvasRenderingContext2D;
  /** A few pixels to draw into for hit-testing (see drawnAt). */
  private readonly hitCtx = Object.assign(document.createElement('canvas'), { width: HIT_PX, height: HIT_PX })
    .getContext('2d', { willReadFrequently: true })!;
  /**
   * The bottom of the world, in world units: it runs on forever every other way. Everything is laid out,
   * hit-tested and drawn in world units (S is the size of a tool's local unit in them), and the camera maps
   * them to the screen.
   */
  private readonly H = HOME_H;
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
  private L: Layout = { faucets: [], benchY: 0, floorY: 0, homes: [] };
  private flasks: Flask[] = [];
  /** Back to front. */
  private tools: Tool[] = [];
  /** The carried flask; `off` is where it was grabbed, relative to its mouth. */
  private drag: { flask: Flask; zone: Zone | null; off: Point } | null = null;
  /** A tool being carried, and where it was picked up (as fractions, see fromFrac). */
  private toolDrag: { tool: Tool; off: Point; from?: Point } | null = null;
  private scales: Scale[] = [];
  private scaleDrag: { scale: Scale; off: Point } | null = null;
  private hoses: Hose[] = [];
  /** Open tops, as of the latest look this frame (see mouths). */
  private open: Mouth[] = [];
  /** What overflowed each vessel this frame, and where it spilled from, for drawing (see fill). */
  private spills = new Map<Vessel, { at: Point; v: Vessel }>();
  /** How long this frame's spills took, in sim seconds. */
  private spillTime = 1;
  /** Whether the carried flask poured this frame (it doesn't while the sim is paused). */
  private pouring = false;
  /** Drops that have let go of an outlet and are on their way down. */
  private falling: { v: Vessel; x: number; y: number; vy: number }[] = [];
  /** A hose end being carried, or (just out of the palette) the whole hose, with its outlet this far from the inlet. */
  private hoseDrag: { hose: Hose; end: 'inlet' | 'outlet' | 'both'; gap?: Point } | null = null;
  private faucetDrag: { fa: FaucetLayout; off: Point } | null = null;
  /** The scale whose tare key is held down, to draw it pressed. */
  private tarePress: Scale | null = null;
  private valveDrag: { tool: Tool; k: number } | null = null;
  /** The flipped tool drawTool is drawing just now, on a mirrored canvas (see lx); null the rest of the time. */
  private mirrored: Tool | null = null;
  private hover: Flask | null = null;
  private hoverTool: Tool | null = null;
  private hoverTank: Vessel | null = null;
  /** Whether the right mouse button is held: a carried flask pours, and anything carried takes from faucets, only while it is. */
  private rightHeld = false;
  private faucetFlows: { fa: FaucetLayout; m: Mouth }[] = [];
  private pointer: Point = { x: -1, y: -1 };
  private won = false;
  private inspected: Vessel | null = null;
  private lastInspect = 0;
  private theme = {} as Theme;
  private last = performance.now();
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private nextToolId = 0;
  /** Running spectrometers' sounds. */
  private rumbles = new Map<Tool, Rumble>();
  /** Each receptacle's sounds, through its cycle (see Tool.press). */
  private beepers = new Map<Tool, Beeper>();
  /** The target the receptacle has taken, all told, by volume: what counts toward the goal. */
  private delivered = 0;
  private water = new WaterSounds();
  /** This frame's streams, for their sound: how much ran into each vessel, by volume. */
  private inflow = new Map<Vessel, number>();
  /** Where each drop that landed in a vessel this frame landed, for its sound. */
  private landed: Point[] = [];

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
    for (const r of this.rumbles.values()) r.stop();
    this.water.stop();
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
    const label = tool.tanks[k].label ? ` (${tool.tanks[k].label})` : '';
    return { vessel: tool.tanks[k], title: `${TOOL_NAMES[tool.kind]} ${nth}${tank}${label}` };
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
    this.uniqueTools();
    for (const t of this.tools) this.place(t, this.toolXY(t));
    const { S } = this;
    this.hoses = (preset.hoses ?? []).map(({ from, to }) => {
      const h = new Hose({ x: 0, y: 0 }, { x: 0, y: 0 });
      const sp = this.spoutAt(this.tools[from.tool], from.spout);
      const r = this.openingOf(this.tools[to.tool], to.tank ?? 0);
      this.moveHoseEnd(h, 'inlet', { x: sp.x, y: sp.y + 16 * S });
      this.moveHoseEnd(h, 'outlet', { x: (r.x0 + r.x1) / 2 + (to.dx ?? 0) * S, y: r.y - 24 * S });
      return h;
    });
    this.placeFaucets();
    this.won = false;
    this.falling = [];
    this.drag = this.toolDrag = this.valveDrag = this.scaleDrag = this.hoseDrag = this.faucetDrag = null;
    this.hover = this.hoverTool = this.hoverTank = null;
    this.delivered = 0;
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
        ...(t.tube.length ? { tube: t.tube.map(saveVessel) } : {}),
        ...(t.flipped ? { flipped: true } : {}),
        ...(t.reading ? { reading: [...t.reading] } : {}),
      })),
      scales: this.scales.map((sc) => ({
        fx: sc.fx, fy: sc.fy, tare: sc.tare,
        load: sc.load.map(({ f, dx }) => ({ f: this.flasks.indexOf(f), dx })).filter((l) => l.f >= 0),
      })),
      hoses: this.hoses.map((h) => ({ inlet: { ...h.inlet }, outlet: { ...h.outlet }, funnel: saveVessel(h.funnel), drop: saveVessel(h.drop) })),
      faucets: L.faucets.map((fa) => ({ x: fa.fx, y: fa.fy })),
      delivered: this.delivered,
      chem: saveChem(this.chem.params),
    };
  }

  /** Replace the bench with a saved one. `preset` is what Reset will go back to afterwards. */
  restore(s: SaveState, preset: Preset): void {
    const { S, L } = this;
    this.preset = preset;
    loadChem(this.chem.params, s.chem);
    this.chem.rebuild();
    for (const fa of L.faucets) fa.output = faucetOutput(fa, this.chem);
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
        t.tube.forEach((v, k) => st.tube?.[k] && loadVessel(v, st.tube[k]));
        t.flipped = !!st.flipped && !!t.shape.flippable;
        if (Array.isArray(st.reading) && st.reading.length === 18) t.reading = st.reading.map((x) => Math.max(0, Number(x) || 0));
        return t;
      });
    this.nextToolId = Math.max(-1, ...this.tools.map((t) => t.id)) + 1;
    this.uniqueTools();
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
    this.placeFaucets(s.faucets);
    this.delivered = Number.isFinite(s.delivered) ? Math.max(0, s.delivered!) : 0;
    this.won = false;
    this.falling = [];
    this.drag = this.toolDrag = this.valveDrag = this.scaleDrag = this.hoseDrag = this.faucetDrag = null;
    this.hover = this.hoverTool = this.hoverTank = null;
  }

  /**
   * Keep at most one of each unique tool (see UNIQUE_TOOLS), the first. There's always a mass spectrometer, a flow
   * meter and a receptacle: if there's none, one is added where it starts.
   */
  private uniqueTools(): void {
    for (const kind of UNIQUE_TOOLS) {
      const first = this.tools.find((t) => t.kind === kind);
      this.tools = this.tools.filter((t) => t.kind !== kind || t === first);
    }
    if (!this.tools.some((t) => t.kind === 'spectrometer'))
      this.tools.push(new Tool('spectrometer', this.nextToolId++, ...SPECTROMETER_AT));
    if (!this.tools.some((t) => t.kind === 'meter')) this.tools.push(new Tool('meter', this.nextToolId++, ...METER_AT));
    if (!this.tools.some((t) => t.kind === 'receptacle'))
      this.tools.push(new Tool('receptacle', this.nextToolId++, ...RECEPTACLE_AT));
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

  /**
   * Put a new flask, scale, hose or tool down under the pointer, as a hotkey does: where it would land if it were
   * dragged out of the palette and let go there, without carrying it. Does nothing, returning false, while the
   * pointer is off the bench or something is being carried.
   */
  placeAt(kind: 'flask' | 'scale' | 'hose' | ToolKind): boolean {
    const p = this.pointer;
    const busy = this.drag || this.toolDrag || this.valveDrag || this.scaleDrag || this.hoseDrag || this.faucetDrag;
    if (busy || this.panDrag || (p.x === -1 && p.y === -1)) return false;
    const { S } = this;
    if (kind === 'hose') {
      const h = new Hose({ x: 0, y: 0 }, { x: 0, y: 0 });
      this.moveHoseEnd(h, 'inlet', p);
      this.moveHoseEnd(h, 'outlet', { x: p.x + 60 * S, y: p.y + 30 * S });
      this.hoses.push(h);
    } else if (kind === 'flask') {
      const f = new Flask(this.clampRest({ x: p.x, y: p.y - 35 * S }), CAP);
      f.glass = glassGrams(this.flasks.length);
      this.flasks.push(f);
      const zone = this.zoneAt(p, f);
      if (zone?.kind === 'scale') zone.scale.put(f, zone.dx);
      this.settle();
    } else if (kind === 'scale') {
      const sc = new Scale(0, 0);
      this.placeScale(sc, p);
      this.scales.push(sc);
    } else {
      const t = new Tool(kind, this.nextToolId++, 0, 0);
      this.place(t, { x: p.x, y: p.y - 40 * S });
      this.tools.push(t);
    }
    this.updateHover();
    return true;
  }

  private vessels(): Vessel[] {
    return [...this.flasks, ...this.tools.flatMap((t) => [...t.tanks, ...t.tube]), ...this.hoses.map((h) => h.funnel)];
  }

  /**
   * Every vessel holding fluid, with how exposed that fluid is to the room (see exposure): how deep it stands,
   * and how wide on average, as it's drawn. A flask fills its wide base first; a tank fills straight up, a funnel
   * from its narrow stem; a pipette fills its tube, then its cup; a heater's tube holds a shallow stream along its
   * floor.
   */
  private exposures(): [Vessel, number][] {
    const out: [Vessel, number][] = [];
    const share = (v: Vessel) => Math.min(1, volume(v) / v.cap);
    for (const f of this.flasks) {
      if (f.N <= 0) continue;
      const h = FLASK_DEPTH - fillLevel(0, share(f));
      out.push([f, exposure(h, (share(f) * FLASK_AREA) / h)]);
    }
    for (const t of this.tools) {
      const sh = t.shape;
      const H = sh.tankH ?? TANK_H;
      t.tanks.forEach((v, k) => {
        if (v.N <= 0) return;
        const W = sh.tanks[k].x1 - sh.tanks[k].x0;
        if (sh.cup) {
          const cupW = 2 * sh.cup.w;
          const h = cupFillHeight(share(v), W, H, cupW, sh.cup.h);
          const area = share(v) * (W * H + ((W + cupW) / 2) * sh.cup.h);
          out.push([v, exposure(h, area / h)]);
        } else if (sh.sump) {
          const h = sumpFillHeight(share(v), W, H, sh.sump);
          const area = share(v) * (W * H + ((sh.sump.w + SUMP_TIP) / 2) * sh.sump.h);
          out.push([v, exposure(h, area / h)]);
        } else {
          const { h, w } = taper(share(v), H, sh.funnel ? FUNNEL_STEM : W, W);
          out.push([v, exposure(h, w)]);
        }
      });
      const full = (HEATER.feed * HEATER.transit) / HEATER_CELLS;
      for (const v of t.tube) {
        if (v.N <= 0) continue;
        const d = 2 * HEATER_TUBE.r;
        out.push([v, exposure(d * Math.min(1, volume(v) / full), d)]);
      }
    }
    for (const hose of this.hoses) {
      // its funnel is 28 wide at the mouth, 8 at the bottom, and 12 deep (see drawHose)
      const { h, w } = taper(share(hose.funnel), 12, 8, 28);
      if (hose.funnel.N > 0) out.push([hose.funnel, exposure(h, w)]);
    }
    return out;
  }

  /* ---------------- layout ---------------- */

  /** Lay out the world, once: the faucets (see placeFaucets), and the shelf along the bottom of the home area. */
  private layoutWorld(): void {
    const { L, S, H } = this;
    L.faucets = FAUCETS.map((fa) => ({ ...fa, output: faucetOutput(fa, this.chem), fx: 0, fy: 0 }));
    this.placeFaucets();
    L.floorY = H - SINK_H * S;
    L.homes = [];
    for (let i = 0; i < N_FLASKS; i++) L.homes.push({ x: (HOME_W * (i + 0.5)) / N_FLASKS, y: L.floorY - 92 * S });
    L.benchY = Math.max(...L.homes.map((h) => h.y)) + 70 * S;
  }

  /**
   * Put the faucets where they start, evenly along the top of the home area, or where a save had them. A save
   * with a different number of faucets is from before the faucets changed, so its places are ignored.
   */
  private placeFaucets(saved: readonly Point[] = []): void {
    const n = this.L.faucets.length;
    if (saved.length !== n) saved = [];
    this.L.faucets.forEach((fa, i) => {
      const at = saved[i];
      const ok = at && Number.isFinite(at.x) && Number.isFinite(at.y);
      fa.fx = ok ? at.x : (i + 0.5) / n;
      fa.fy = ok ? at.y : 30 / HOME_H;
    });
  }

  /** Where a faucet joins its pipe, and the tip of its spout, in world units. */
  private faucetXY(fa: FaucetLayout): { pipe: Point; spout: Point } {
    const pipe = this.fromFrac({ x: fa.fx, y: fa.fy });
    return { pipe, spout: { x: pipe.x, y: pipe.y + FAUCET_DROP * this.S } };
  }

  /** The faucet under p, frontmost (last drawn) first. */
  private hitFaucet(p: Point): FaucetLayout | null {
    const { S } = this;
    for (let i = this.L.faucets.length - 1; i >= 0; i--) {
      const { pipe, spout } = this.faucetXY(this.L.faucets[i]);
      const onPipe = Math.abs(p.x - pipe.x) < 22 * S && Math.abs(p.y - pipe.y) < 11 * S;
      const onDrop = Math.abs(p.x - pipe.x) < 7 * S && p.y > pipe.y && p.y < spout.y + 2 * S;
      if (onPipe || onDrop) return this.L.faucets[i];
    }
    return null;
  }

  /** Move a faucet, keeping its spout above the sink. */
  private moveFaucet(fa: FaucetLayout, p: Point): void {
    const at = this.toFrac({ x: p.x, y: Math.min(this.L.floorY - (FAUCET_DROP + 24) * this.S, p.y) });
    fa.fx = at.x;
    fa.fy = at.y;
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

  /** Keep the zoom in range, and the view from going below the bottom of the world. */
  private clampCam(): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom));
    this.cam = { x: this.cam.x, y: Math.min(this.H - this.viewH / this.zoom, this.cam.y) };
  }

  /** Where a flask's or tank's label is drawn (see vessel for its id), on the canvas in CSS pixels. */
  labelSpot(id: string): Point | null {
    const fm = /^f(\d+)$/.exec(id);
    if (fm) {
      const f = this.flasks[+fm[1]];
      return f ? this.toScreen({ x: f.home.x, y: f.home.y + LABEL_Y * this.S }) : null;
    }
    const tm = /^t(\d+)\.(\d+)$/.exec(id);
    const tool = tm ? this.tools.find((t) => t.id === +tm[1]) : undefined;
    const k = tm ? +tm[2] : -1;
    return tool && tool.tanks[k] ? this.toScreen(this.tankLabelAt(tool, k)) : null;
  }

  /** Where a tank's label is written: just above its rim and any lid, or above the tool's own label if it has one. */
  private tankLabelAt(t: Tool, k: number): Point {
    const o = this.openingOf(t, k);
    const lines = t.shape.label?.length ?? 0;
    return { x: (o.x0 + o.x1) / 2, y: o.y - (lines ? 11 * lines + 10 : 9) * this.S };
  }

  /** Where a sound at p in the world is heard from: full and centered in view, fading and panning off screen. */
  private hear(p: Point): Placement {
    const s = this.toScreen(p);
    return placement(s.x, s.y, this.viewW, this.viewH);
  }

  /** Where a tool's machinery sounds from: the middle of its cabinet. */
  private machineAt(t: Tool): Point {
    const o = this.toolXY(t);
    return { x: o.x, y: o.y + 60 * this.S };
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

  /** A flask's resting place (its mouth), kept above the sink. */
  private clampRest(p: Point): Point {
    return { x: p.x, y: Math.min(this.L.floorY - 70 * this.S, p.y) };
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
    const at = this.toFrac({ x: p.x, y: Math.min(this.L.floorY - SCALE_SHAPE.box.y1 * this.S, p.y) });
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
    return { x: o.x + this.lx(t, p.x) * this.S, y: o.y + p.y * this.S };
  }

  /**
   * A local x on a tool as it stands: negated if it's flipped. While drawTool draws a flipped tool, the canvas
   * itself is mirrored, so then it's left as is.
   */
  private lx(t: Tool, x: number): number {
    return t.flipped && this.mirrored !== t ? -x : x;
  }

  /** A span of local x on a tool as it stands, left to right (see lx). */
  private spanOn(t: Tool, x0: number, x1: number): [number, number] {
    const a = this.lx(t, x0);
    const b = this.lx(t, x1);
    return a < b ? [a, b] : [b, a];
  }

  /** The tip of spout j, where fluid leaves the tool, in stage coordinates. */
  private spoutAt(t: Tool, j: number): Point {
    return this.onTool(t, { x: t.shape.spouts[j], y: t.shape.spoutY });
  }

  /** Whether p is inside a rectangle given in a tool's local units. */
  private inToolRect(t: Tool, p: Point, r: { x0: number; x1: number; y0: number; y1: number }): boolean {
    const o = this.toolXY(t);
    const [x0, x1] = this.spanOn(t, r.x0, r.x1);
    const { S } = this;
    return p.x > o.x + x0 * S && p.x < o.x + x1 * S && p.y > o.y + r.y0 * S && p.y < o.y + r.y1 * S;
  }

  /** Where valve k is: as the shape places it, or under tank k. */
  private valveAt(t: Tool, k: number): Point {
    return this.onTool(t, t.shape.valves?.[k] ?? { x: tankX(t.shape.tanks[k]), y: t.shape.valveY });
  }

  /**
   * Point a valve's lever at p: straight up from the valve is fully open, straight right is closed,
   * and in between is partly open. Below the valve it closes, and left of it (past the down-left
   * diagonal) it opens, so a wild swing lands at the nearer end. A splitter's lever instead sweeps the
   * upper half: straight left sends everything left, straight right everything right, and below the
   * valve it goes to the nearer side. A dial points at p, turning clockwise from down-left (0) to down-right (1),
   * and straight below it goes to the nearer end. Within VALVE_DEADZONE of the valve the angle is too jumpy to
   * mean anything, so the lever stays put.
   */
  private aimValve(t: Tool, k: number, p: Point): void {
    const vc = this.valveAt(t, k);
    if (Math.hypot(p.x - vc.x, p.y - vc.y) < VALVE_DEADZONE) return;
    if (k === t.shape.dial) {
      const cw = Math.atan2(p.x - vc.x, vc.y - p.y); // clockwise from straight up
      t.valves[k] = Math.max(0, Math.min(1, (cw + 0.75 * Math.PI) / (1.5 * Math.PI)));
      return;
    }
    const a = Math.atan2(vc.y - p.y, p.x - vc.x); // counterclockwise from right
    if (t.kind === 'splitter') {
      t.valves[k] = a >= 0 ? 1 - a / Math.PI : a > -Math.PI / 2 ? 1 : 0;
      return;
    }
    const open = a < -0.75 * Math.PI ? 1 : a / (Math.PI / 2);
    t.valves[k] = Math.max(0, Math.min(1, open));
  }

  /** Where fluid goes into a tank: its open top, or the mouth of the little funnel on top if it has one. */
  private openingOf(t: Tool, k: number): { x0: number; x1: number; y: number } {
    const r = this.tankRect(t, k);
    const cup = t.shape.cup;
    if (!cup) return { x0: r.x0, x1: r.x1, y: r.y0 };
    const cx = (r.x0 + r.x1) / 2;
    return { x0: cx - cup.w * this.S, x1: cx + cup.w * this.S, y: r.y0 - cup.h * this.S };
  }

  private tankRect(t: Tool, k: number): { x0: number; x1: number; y0: number; y1: number } {
    const o = this.toolXY(t);
    const { S } = this;
    const [x0, x1] = this.spanOn(t, t.shape.tanks[k].x0, t.shape.tanks[k].x1);
    return { x0: o.x + x0 * S, x1: o.x + x1 * S, y0: o.y, y1: o.y + (t.shape.tankH ?? TANK_H) * S };
  }

  /**
   * Flip a tool left to right (see Tool.flipped), about the middle of its box, so it stays where it is. Does
   * nothing, returning false, if its shape isn't flippable.
   */
  private flip(t: Tool): boolean {
    if (!t.shape.flippable) return false;
    const b = t.shape.box;
    // the box's middle is at c now and will be at −c, so move the tool 2c to keep it put
    const shift = 2 * this.lx(t, (b.x0 + b.x1) / 2) * this.S;
    t.flipped = !t.flipped;
    t.fx += shift / HOME_W;
    if (this.toolDrag?.tool === t) this.toolDrag.off.x -= shift;
    this.updateHover();
    return true;
  }

  /** Move a tool, keeping it above the sink. */
  private place(t: Tool, p: Point): void {
    const at = this.toFrac({ x: p.x, y: Math.min(this.L.floorY - t.shape.box.y1 * this.S, p.y) });
    t.fx = at.x;
    t.fy = at.y;
  }

  /* ---------------- hose geometry ---------------- */

  /** A hose end's point in stage coordinates: the funnel's mouth, or the outlet's tip. */
  private hoseEnd(h: Hose, end: 'inlet' | 'outlet'): Point {
    return this.fromFrac(h[end]);
  }

  private moveHoseEnd(h: Hose, end: 'inlet' | 'outlet', p: Point): void {
    h[end] = this.toFrac({ x: p.x, y: Math.min(this.L.floorY - 16 * this.S, p.y) });
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

  /**
   * Every open top that falling fluid can land in. Something carried (see carried) has none unless the right
   * button is held, or `withCarried` asks what would be open if it were.
   */
  private mouths(withCarried = false): Mouth[] {
    const { S, drag } = this;
    const held = this.rightHeld || withCarried ? new Set<Vessel>() : this.carried();
    const out: Mouth[] = [];
    for (const f of this.flasks) {
      if (held.has(f)) continue;
      const carried = drag?.flask === f;
      if (carried && f.ang !== 0) continue; // tilted to pour
      const p = carried ? f : f.home;
      // it overflows down the right side of its neck
      out.push({ v: f, x0: p.x - FLASK_CATCH * S, x1: p.x + FLASK_CATCH * S, y: p.y, rim: { x: p.x + FLASK_LIP * S, y: p.y } });
    }
    for (const t of this.tools) {
      if (t.lidded || t.tanks.some((v) => held.has(v))) continue;
      t.tanks.forEach((v, k) => {
        const r = this.openingOf(t, k);
        out.push({ v, x0: r.x0, x1: r.x1, y: r.y, rim: { x: r.x1 + 3 * S, y: r.y } });
      });
    }
    for (const h of this.hoses) {
      if (held.has(h.funnel)) continue;
      const e = this.hoseEnd(h, 'inlet');
      out.push({ v: h.funnel, x0: e.x - 14 * S, x1: e.x + 14 * S, y: e.y, rim: { x: e.x + 15 * S, y: e.y } });
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
        const v = this.valveNear(p);
        if (v) {
          this.valveDrag = v;
          this.aimValve(v.tool, v.k, p);
          c.setPointerCapture(e.pointerId);
        }
      } else if (e.button === 0) {
        if (t?.kind === 'receptacle' && this.inToolRect(t, p, RECEPTACLE_BODY.button)) {
          if (t.press()) {
            this.beepers.get(t)?.stop();
            this.beepers.set(t, beeper(this.hear(this.machineAt(t))));
          }
        } else if (t?.kind === 'spectrometer' && this.inToolRect(t, p, SPECTROMETER.button)) {
          if (t.scan()) this.rumbles.set(t, rumble(this.hear(this.machineAt(t))));
        } else if (t && !t.shape.fixed) {
          const o = this.toolXY(t);
          this.toolDrag = { tool: t, off: { x: p.x - o.x, y: p.y - o.y }, from: { x: t.fx, y: t.fy } };
          this.tools.splice(this.tools.indexOf(t), 1);
          this.tools.push(t); // bring to front
          c.setPointerCapture(e.pointerId);
        } else if (this.hitScale(p)) {
          const sc = this.hitScale(p)!;
          if (this.onScale(sc, p, SCALE_SHAPE.tare)) {
            sc.zero();
            this.tarePress = sc;
          }
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
          } else if (this.hitFaucet(p)) {
            const fa = this.hitFaucet(p)!;
            const { pipe } = this.faucetXY(fa);
            this.faucetDrag = { fa, off: { x: p.x - pipe.x, y: p.y - pipe.y } };
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
      } else if (this.faucetDrag) {
        const { fa, off } = this.faucetDrag;
        this.moveFaucet(fa, { x: p.x - off.x, y: p.y - off.y });
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
      if ((this.drag || this.toolDrag || this.scaleDrag || this.hoseDrag || this.faucetDrag) && !(e.buttons & 1)) {
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
        const from = this.toolDrag?.from;
        if (t && UNIQUE_TOOLS.includes(t.kind) && from) {
          // a one-of-a-kind tool can't be put away: it goes back where it was picked up
          t.fx = from.x;
          t.fy = from.y;
        } else if (t) this.tools.splice(this.tools.indexOf(t), 1);
        if (sc) this.scales.splice(this.scales.indexOf(sc), 1);
        const hose = this.hoseDrag?.hose;
        if (hose) this.hoses.splice(this.hoses.indexOf(hose), 1);
        if (f) {
          this.flasks.splice(this.flasks.indexOf(f), 1);
          for (const s of this.scales) s.remove(f);
          this.drag = null;
        }
      }
      this.toolDrag = this.valveDrag = this.scaleDrag = this.hoseDrag = this.faucetDrag = this.tarePress = null;
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
      if (this.drag || this.toolDrag || this.scaleDrag || this.valveDrag || this.hoseDrag || this.faucetDrag || this.panDrag) return;
      this.pointer = { x: -1, y: -1 };
      this.updateHover();
    });
    // F flips the tool being carried, or else the one under the pointer
    onWindow('keydown', (e) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target;
      if (el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const t = this.toolDrag?.tool ?? this.hoverTool;
      if (t && this.flip(t)) e.preventDefault();
    });
    on('contextmenu', (e) => e.preventDefault());
    // the right button pours while carrying, which shouldn't open a menu wherever it's clicked
    onWindow('contextmenu', (e) => {
      if (this.drag || this.toolDrag || this.scaleDrag || this.hoseDrag) e.preventDefault();
    });
    on('dblclick', (e) => {
      const p = this.ptr(e);
      if (!this.god) {
        const hit = this.tankAt(p);
        const f = hit ? null : this.hitFlask(p);
        if (hit) this.cb.onLabel(`t${hit.tool.id}.${hit.k}`);
        else if (f) this.cb.onLabel(`f${this.flasks.indexOf(f)}`);
        return;
      }
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
    const busy = this.drag || this.toolDrag || this.valveDrag || this.scaleDrag || this.hoseDrag || this.faucetDrag;
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

  /** The valve nearest p within VALVE_REACH of its center, on any tool; the frontmost tool's if two are as near. */
  private valveNear(p: Point): { tool: Tool; k: number } | null {
    let best: { tool: Tool; k: number } | null = null;
    let reach = VALVE_REACH * this.S;
    for (let i = this.tools.length - 1; i >= 0; i--) {
      const tool = this.tools[i];
      if (tool.shape.noValve) continue;
      tool.valves.forEach((_, k) => {
        const v = this.valveAt(tool, k);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach) [best, reach] = [{ tool, k }, d];
      });
    }
    return best;
  }

  /**
   * The frontmost tool under p: one with something drawn there (within a couple of screen pixels), so the
   * empty space around its tanks, pipes and levers isn't part of it. Glass counts, however faint.
   */
  private hitTool(p: Point): Tool | null {
    const { S } = this;
    for (let i = this.tools.length - 1; i >= 0; i--) {
      const t = this.tools[i];
      const o = this.toolXY(t);
      const b = t.shape.box;
      const [bx0, bx1] = this.spanOn(t, b.x0, b.x1);
      // the box holds everything but valve levers, which reach a little past it
      const m = 15 * S;
      const inBox = p.x > o.x + bx0 * S - m && p.x < o.x + bx1 * S + m && p.y > o.y + b.y0 * S - m && p.y < o.y + b.y1 * S + m;
      if (inBox && this.drawnAt(p, () => this.drawTool(t))) return t;
    }
    return null;
  }

  /**
   * Whether `draw`, drawing in world units with this.ctx as usual, puts anything within HIT_PX / 2 screen pixels
   * of p. It draws into a few pixels around p instead of the canvas, so it's cheap, and so a hit always matches
   * what's on screen.
   */
  private drawnAt(p: Point, draw: () => void): boolean {
    const hit = this.hitCtx;
    const main = this.ctx;
    hit.setTransform(1, 0, 0, 1, 0, 0);
    hit.clearRect(0, 0, HIT_PX, HIT_PX);
    hit.font = main.font;
    const z = this.zoom;
    hit.setTransform(z, 0, 0, z, HIT_PX / 2 - z * p.x, HIT_PX / 2 - z * p.y);
    this.ctx = hit;
    try {
      draw();
    } finally {
      this.ctx = main;
    }
    const px = hit.getImageData(0, 0, HIT_PX, HIT_PX).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] >= HIT_ALPHA) return true;
    return false;
  }

  /** The tank under p, on the frontmost tool under p. */
  private tankAt(p: Point): { tool: Tool; k: number } | null {
    const tool = this.hitTool(p);
    if (!tool) return null;
    for (let k = 0; k < tool.tanks.length; k++) {
      const r = this.tankRect(tool, k);
      const o = this.openingOf(tool, k);
      const inTank = p.x > r.x0 && p.x < r.x1 && p.y > r.y0 - 6 * this.S && p.y < r.y1;
      const inCup = p.x > o.x0 && p.x < o.x1 && p.y > o.y - 6 * this.S && p.y < r.y0;
      if (inTank || inCup) return { tool, k };
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
      if (t.lidded) continue;
      for (let k = 0; k < t.tanks.length; k++) {
        const r = this.tankRect(t, k);
        const o = this.openingOf(t, k);
        if (p.x > o.x0 - 8 * S && p.x < o.x1 + 8 * S && p.y > o.y - 40 * S && p.y < r.y1)
          return { kind: 'tank', v: t.tanks[k], x: (o.x0 + o.x1) / 2, y: o.y };
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

  /**
   * The vessels being carried: a flask, a tool's tanks, a hose's funnel (by either end), or the flasks on a
   * scale. They take in fluid (see mouths), and pour it out, only while the right button is held.
   */
  private carried(): Set<Vessel> {
    const out = new Set<Vessel>();
    if (this.drag) out.add(this.drag.flask);
    if (this.toolDrag) for (const v of this.toolDrag.tool.tanks) out.add(v);
    if (this.hoseDrag) out.add(this.hoseDrag.hose.funnel);
    if (this.scaleDrag) for (const { f } of this.scaleDrag.scale.load) out.add(f);
    return out;
  }

  /* ---------------- main loop ---------------- */

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { S, L, drag, pointer } = this;
    this.open = this.mouths();
    this.spills.clear();
    this.inflow.clear();
    this.landed = [];

    // where the carried flask is, and what it's pouring into (null: the sink), if anything
    let pourInto: Vessel | null | undefined;
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
          pourInto = z.f;
        } else if (z.kind === 'tank') {
          D.x = z.x + 16 * S;
          D.y = z.y - 32 * S;
          pourInto = z.v;
        } else {
          D.x = pointer.x;
          D.y = L.floorY - 8 * S;
          pourInto = null;
        }
      }
    }

    // each faucet fills whatever is parked right under it, or held there with the right button
    const simDt = dt * this.speed;
    const mouths = (this.open = this.mouths());
    const carried = this.carried();
    this.faucetFlows = [];
    for (const fa of L.faucets) {
      fa.output = faucetOutput(fa, this.chem); // cheap, and follows edits to the chemistry
      const m = faucetTarget(mouths, this.faucetXY(fa).spout, FAUCET_REACH * S, carried, this.rightHeld);
      if (m && simDt > 0) this.faucetFlows.push({ fa, m });
    }
    this.pouring = simDt > 0 && pourInto !== undefined;

    const scanFrom = this.tools.map((t) => t.scanAge);
    const cycleFrom = this.tools.map((t) => t.cycle && { ...t.cycle });

    // everything that moves fluid, and chemistry, on sim time, interleaved so a drip meets the reaction it
    // feeds, and a faucet keeps up with the valve draining what it fills
    const vessels = this.vessels();
    // how exposed each one's fluid is to the room, from how it stands now; it hardly changes in a frame
    const exposures = simDt > 0 ? this.exposures() : [];
    if (simDt > 0) {
      const sub = Math.ceil(simDt / 0.02);
      const h = simDt / sub;
      const spouts = this.tools.map((t) => t.shape.spouts.map((_, j) => this.spoutAt(t, j)));
      const targets = spouts.map((sps) => sps.map((sp) => mouthBelow(mouths, sp)));
      const outlets = this.hoses.map((hose) => this.hoseEnd(hose, 'outlet'));
      const hoseTargets = outlets.map((sp) => mouthBelow(mouths, sp));
      // a fast flow streams straight into what's below (overflowing it if it's full); a slow one gathers
      // in a drop, which falls on its own time
      const pour = (drop: Vessel, out: Vessel | null, sp: Point, target: Mouth | null): boolean => {
        const down = drip(drop, out, h);
        if (down && down === out) {
          if (target) this.stream(target.v, out);
        } else if (down) this.falling.push({ v: down, x: sp.x, y: sp.y, vy: 0 });
        return !!down && down === out;
      };
      // what leaves each outlet over the whole frame, for drawing: a single substep's can be nothing, as when a
      // wide-open valve drains its tank in the first one
      const total = () => ({ v: new Vessel(Infinity), streamed: false });
      const toolTotals = this.tools.map((t) => t.shape.spouts.map(total));
      const hoseTotals = this.hoses.map(total);
      const tally = (tot: { v: Vessel; streamed: boolean }, out: Vessel | null, streamed: boolean) => {
        if (out) tot.v.addFrom(out, volume(out), true);
        tot.streamed ||= streamed;
      };
      const stillTool = !this.rightHeld && this.toolDrag?.tool.shape.spouts.length ? this.toolDrag.tool : null;
      const stillHose = this.rightHeld ? null : (this.hoseDrag?.hose ?? null);
      for (let i = 0; i < sub; i++) {
        if (drag && pourInto) this.pourFrom(drag.flask, pourInto, POUR_RATE * h);
        else if (drag && pourInto === null) transfer(drag.flask, null, POUR_RATE * h);
        for (const { fa, m } of this.faucetFlows) this.stream(m.v, fa.output, FILL_RATE * h);
        this.tools.forEach((t, j) => {
          // carried, it pours nothing out without the right button (a spectrometer has nothing to pour)
          if (t === stillTool) return;
          t.step(h).forEach((out, k) => {
            tally(toolTotals[j][k], out, false); // before pouring, which can gather it into a drop
            tally(toolTotals[j][k], null, pour(t.drops[k], out, spouts[j][k], targets[j][k]));
          });
        });
        this.hoses.forEach((hose, j) => {
          if (hose === stillHose) return;
          const out = hose.step(h);
          tally(hoseTotals[j], out, false);
          tally(hoseTotals[j], null, pour(hose.drop, out, outlets[j], hoseTargets[j]));
        });
        // falling drops land in the first open top they pass, or go down the sink
        this.falling = this.falling.filter((d) => {
          const from = d.y;
          d.vy += GRAVITY * h;
          d.y += d.vy * h;
          const m = mouthBelow(mouths, { x: d.x, y: from });
          if (m && m.y <= d.y) {
            this.fill(m.v, d.v);
            this.landed.push({ x: d.x, y: m.y });
          }
          return !(m && m.y <= d.y) && d.y < this.H;
        });
        for (const v of vessels) {
          this.chem.step(v, h);
          // by molecules, breaking bonds swells a fluid, and whatever no longer fits spills
          this.overflow(v);
        }
        for (const [v, e] of exposures) cool(v, e, h);
      }
      this.tools.forEach((t, j) =>
        toolTotals[j].forEach(({ v, streamed }, k) => {
          t.out[k] = v.N > 0 ? v : null;
          t.flow[k] = volume(v) / (MAX_FLOW * simDt);
          t.streaming[k] = streamed;
        }),
      );
      this.hoses.forEach((hose, j) => {
        const { v, streamed } = hoseTotals[j];
        hose.out = v.N > 0 ? v : null;
        hose.flow = volume(v) / (MAX_FLOW * simDt);
        hose.streaming = streamed;
      });
    }
    this.spillTime = simDt;

    // spectrometer runs go by sim time too (Tool.step ages them): a step louder each phase, a chime as each
    // ends, silent while paused
    this.tools.forEach((t, j) => {
      const r = this.rumbles.get(t);
      if (!r) return;
      r.place(this.hear(this.machineAt(t)));
      for (const at of SCAN_LIGHTS) if (scanFrom[j] < at && t.scanAge >= at) r.chime();
      r.level(simDt > 0 ? scanLevel(t.scanAge) : 0);
    });
    for (const [t, r] of this.rumbles)
      if (!this.tools.includes(t) || !t.scanning) {
        r.stop(); // done, put away, or the bench was replaced
        this.rumbles.delete(t);
      }

    // receptacle cycles go by sim time too: a blip for each beep of its thinking that came round this frame, its
    // verdict as the thinking ends, and the rush of a flush, silent while paused
    this.tools.forEach((t, j) => {
      const b = this.beepers.get(t);
      const from = cycleFrom[j];
      if (!b) return;
      b.place(this.hear(this.machineAt(t)));
      if (from?.phase === 'think') {
        const until = t.cycle?.phase === 'think' ? t.cycle.age : Infinity;
        for (const beep of t.beeps) if (beep.t > from.age && beep.t <= until) b.beep(beep.freq);
        if (t.cycle?.phase !== 'think') b.verdict(t.verdict === 'pass');
      }
      const c = t.cycle;
      b.flush(simDt > 0 && c?.phase === 'flush' ? 1 - (0.6 * c.age) / RECEPTACLE_TIMES.flush : 0);
    });
    for (const [t, b] of this.beepers)
      if (!this.tools.includes(t) || !t.cycle) {
        b.stop(); // done, or the bench was replaced
        this.beepers.delete(t);
      }

    // fluid's sounds, each heard from where it lands: a stream from the mouth it runs into
    const streams = new Map<Vessel, { flow: number; full: number; at: Placement }>();
    for (const [v, amount] of this.inflow) {
      const m = this.open.find((mo) => mo.v === v);
      const at = m ? this.hear({ x: (m.x0 + m.x1) / 2, y: m.y }) : CENTER;
      streams.set(v, { flow: amount / simDt, full: volume(v) / v.cap, at });
    }
    this.water.update(dt, this.landed.map((p) => this.hear(p)), streams);

    // goal: what the receptacle has flushed down its hose
    for (const t of this.tools) {
      this.delivered += t.flushed;
      t.flushed = 0;
    }
    if (this.delivered >= GOAL_VOLUME && !this.won) {
      this.won = true;
      this.cb.onWin();
    }

    this.draw();
    this.inspect(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  /**
   * Pour `amount` of src (by volume) into v, without depleting src, however full v is. Whatever no longer
   * fits overflows (see overflow).
   */
  private fill(v: Vessel, src: Fluid, amount = volume(src)): void {
    v.addFrom(src, amount, true);
    this.overflow(v);
  }

  /** fill, as a stream rather than a drop: it's heard trickling in. */
  private stream(v: Vessel, src: Fluid, amount = volume(src)): void {
    this.inflow.set(v, (this.inflow.get(v) ?? 0) + amount);
    this.fill(v, src, amount);
  }

  /** Pour `amount` out of a carried flask into v (see fill). */
  private pourFrom(D: Flask, v: Vessel, amount: number): void {
    const poured = new Vessel(Infinity);
    transfer(D, poured, amount);
    this.stream(v, poured);
  }

  /**
   * Whatever of v's contents, mixed, no longer fits spills over its rim, falling into the first open top
   * below (which may overflow in turn), or down the sink. A vessel with no rim (a flask tilted to pour)
   * spills straight down the sink.
   */
  private overflow(v: Vessel): void {
    const over = volume(v) - v.cap;
    if (over <= 0) return;
    const out = new Vessel(Infinity);
    transfer(v, out, over);
    const rim = this.open.find((m) => m.v === v)?.rim;
    if (!rim || out.N <= 0) return;
    let spill = this.spills.get(v);
    if (!spill) this.spills.set(v, (spill = { at: rim, v: new Vessel(Infinity) }));
    spill.v.addFrom(out, volume(out), true);
    const below = mouthBelow(this.open, rim);
    if (below) this.stream(below.v, out);
  }

  /** The vessel the hover panel is showing, with its extent for placing the panel. */
  private inspectTarget(): { v: Vessel; x0: number; x1: number; y: number } | null {
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
      brief: !this.god, color: f.N > TRACE ? fluidColor(f) : null,
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

  /** The fluid in a tank with a cup, standing across tube and cup together (see cupFillHeight). */
  private drawCupFluid(t: Tool, k: number): void {
    const v = t.tanks[k];
    if (v.N <= TRACE) return;
    const { ctx, S } = this;
    const r = this.tankRect(t, k);
    const o = this.openingOf(t, k);
    const cup = t.shape.cup!;
    const h = cupFillHeight(volume(v) / v.cap, (r.x1 - r.x0) / S, (r.y1 - r.y0) / S, 2 * cup.w, cup.h);
    // the cup, then the tube with its floor rounded as drawTank rounds it
    const rad = Math.min(6 * S, (r.x1 - r.x0) / 2);
    const inside = new Path2D();
    inside.moveTo(o.x0, o.y);
    inside.lineTo(r.x0, r.y0);
    inside.lineTo(r.x0, r.y1 - rad);
    inside.quadraticCurveTo(r.x0, r.y1, r.x0 + rad, r.y1);
    inside.lineTo(r.x1 - rad, r.y1);
    inside.quadraticCurveTo(r.x1, r.y1, r.x1, r.y1 - rad);
    inside.lineTo(r.x1, r.y0);
    inside.lineTo(o.x1, o.y);
    inside.closePath();
    ctx.save();
    ctx.clip(inside);
    ctx.fillStyle = fluidColor(v);
    const top = r.y1 - h * S;
    ctx.fillRect(o.x0, top, o.x1 - o.x0, r.y1 - top + 1);
    ctx.restore();
  }

  /**
   * Ten marks up the left wall of a tank with a cup, at each tenth of its capacity as its fluid is drawn (see
   * cupFillHeight): evenly up the tube, then closer together up the widening cup, the last at the brim. Halves are
   * longer.
   */
  private drawGraduations(t: Tool, k: number): void {
    const { ctx, S, theme } = this;
    const r = this.tankRect(t, k);
    const o = this.openingOf(t, k);
    const cup = t.shape.cup!;
    const tubeW = (r.x1 - r.x0) / S;
    const tubeH = (r.y1 - r.y0) / S;
    ctx.strokeStyle = theme.glass;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i <= 10; i++) {
      const h = cupFillHeight(i / 10, tubeW, tubeH, 2 * cup.w, cup.h);
      const y = r.y1 - h * S;
      // the left wall: straight up the tube, then slanting out up the cup
      const x = h <= tubeH ? r.x0 : r.x0 + ((h - tubeH) / cup.h) * (o.x0 - r.x0);
      ctx.moveTo(x, y);
      ctx.lineTo(x + (i % 5 === 0 ? 5 : 3) * S, y);
    }
    ctx.stroke();
  }

  /** The little glass funnel on top of a tank, narrowing from its mouth (see openingOf) to the tank's top. */
  private drawCup(t: Tool, k: number): void {
    const { ctx, theme } = this;
    const r = this.tankRect(t, k);
    const o = this.openingOf(t, k);
    const glass = new Path2D();
    glass.moveTo(o.x0, o.y);
    glass.lineTo(r.x0, r.y0);
    glass.lineTo(r.x1, r.y0);
    glass.lineTo(o.x1, o.y);
    ctx.fillStyle = theme.glasshi;
    ctx.fill(glass);
    const sides = new Path2D();
    sides.moveTo(o.x0, o.y);
    sides.lineTo(r.x0, r.y0);
    sides.moveTo(r.x1, r.y0);
    sides.lineTo(o.x1, o.y);
    ctx.strokeStyle = theme.glass;
    ctx.lineWidth = 1.6;
    ctx.stroke(sides);
  }

  /**
   * An open-topped glass tank with a rounded floor, or a funnel narrowing to a stem; `lip` flares its rim. A `sump`
   * (see ToolShape.sump, in local units) is a narrow point under the floor's middle, which fills first.
   */
  private drawTank(
    v: Vessel, x0: number, y0: number, x1: number, y1: number, funnel = false, lip = true, showFluid = true,
    sump?: { w: number; h: number },
  ): void {
    const { ctx, S, theme } = this;
    const r = Math.min(6 * S, (x1 - x0) / 2);
    const cx = (x0 + x1) / 2;
    const wall = new Path2D();
    wall.moveTo(x0, y0);
    if (funnel) {
      wall.lineTo(cx - 3 * S, y1);
      wall.lineTo(cx + 3 * S, y1);
    } else {
      wall.lineTo(x0, y1 - r);
      wall.quadraticCurveTo(x0, y1, x0 + r, y1);
      if (sump) {
        wall.lineTo(cx - (sump.w / 2) * S, y1);
        wall.lineTo(cx - (SUMP_TIP / 2) * S, y1 + sump.h * S);
        wall.lineTo(cx + (SUMP_TIP / 2) * S, y1 + sump.h * S);
        wall.lineTo(cx + (sump.w / 2) * S, y1);
      }
      wall.lineTo(x1 - r, y1);
      wall.quadraticCurveTo(x1, y1, x1, y1 - r);
    }
    wall.lineTo(x1, y0);
    const inside = new Path2D(wall);
    inside.closePath();
    if (showFluid && v.N > TRACE) {
      ctx.save();
      ctx.clip(inside);
      const share = Math.min(1, volume(v) / v.cap);
      const bottom = y1 + (sump?.h ?? 0) * S;
      const top = sump ? bottom - sumpFillHeight(share, (x1 - x0) / S, (y1 - y0) / S, sump) * S : y1 - share * (y1 - y0);
      ctx.fillStyle = fluidColor(v);
      ctx.fillRect(x0, top, x1 - x0, bottom - top + 1);
      ctx.restore();
    }
    ctx.fillStyle = theme.glasshi;
    ctx.fill(inside);
    ctx.strokeStyle = theme.glass;
    ctx.lineWidth = 1.6;
    ctx.stroke(wall);
    if (!lip) return;
    ctx.beginPath();
    ctx.moveTo(x0 - 3 * S, y0);
    ctx.lineTo(x0, y0);
    ctx.moveTo(x1, y0);
    ctx.lineTo(x1 + 3 * S, y0);
    ctx.stroke();
  }

  /**
   * Draw a tool, mirrored about its center line if it's flipped: the canvas is mirrored while it's drawn, so the
   * drawing code needn't know, except to keep valves and writing the right way round (see upright).
   */
  private drawTool(t: Tool): void {
    if (!t.flipped) return this.drawToolAsIs(t);
    const { ctx } = this;
    const o = this.toolXY(t);
    ctx.save();
    ctx.translate(2 * o.x, 0);
    ctx.scale(-1, 1);
    this.mirrored = t;
    try {
      this.drawToolAsIs(t);
    } finally {
      this.mirrored = null;
      ctx.restore();
    }
  }

  /** Draw something at x the right way round, even on a flipped tool (see drawTool): a valve, or writing. */
  private upright(x: number, draw: () => void): void {
    if (!this.mirrored) return draw();
    const { ctx } = this;
    ctx.save();
    ctx.translate(2 * x, 0);
    ctx.scale(-1, 1);
    try {
      draw();
    } finally {
      ctx.restore();
    }
  }

  private drawToolAsIs(t: Tool): void {
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

    // drain pipes and spouts, behind the tanks, from the bottom of the tanks (and their sumps)
    const floor = (sh.tankH ?? TANK_H) + (sh.sump?.h ?? 0);
    ctx.fillStyle = theme.pipe;
    if (t.kind === 'exchanger')
      sh.tanks.forEach((tk, k) => {
        // down into the helix at one end, and out of it at the other
        pipes([[tankX(tk), floor], [tankX(tk), HELIX.y - HELIX.r]], 4);
        pipes([[sh.spouts[k], HELIX.y + HELIX.r], [sh.spouts[k], sh.spoutY - 4]], 4);
      });
    else if (t.kind === 'separator') {
      pipes([[0, floor], [0, SEP_BODY.y0]], 4);
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
    } else if (t.kind === 'heater') {
      // the funnel's stem down into the tube, a pipe from the tube down through each tap, and the far end
      // turning down into the last spout
      const { x1, y, r } = HEATER_TUBE;
      const end = sh.spouts[sh.spouts.length - 1];
      pipes([[tankX(sh.tanks[0]), sh.tankH!], [tankX(sh.tanks[0]), y - r + 1]], 4);
      for (const x of sh.spouts.slice(0, -1)) pipes([[x, y + r - 1], [x, sh.spoutY - 4]], 4);
      pipes([[x1 + r - 1, y], [end - 4, y], [end, y + 4], [end, sh.spoutY - 4]], 4);
    } else if (t.kind === 'spectrometer') pipes([[0, sh.tankH!], [0, SPECTROMETER.body.y0]], 4);
    else if (t.kind === 'receptacle') {
      // the hose, from the cabinet's foot straight down off the bench, showing a flush going down it
      const x = RECEPTACLE_BODY.hoseX;
      const down = (this.H - o.y) / S;
      pipes([[x, RECEPTACLE_BODY.y1], [x, down]], 9);
      ctx.save();
      ctx.strokeStyle = t.cycle?.phase === 'flush' && t.tanks[0].N > TRACE ? fluidColor(t.tanks[0]) : theme.bench;
      ctx.lineWidth = 5 * S;
      ctx.beginPath();
      ctx.moveTo(o.x + x * S, o.y + (RECEPTACLE_BODY.y1 + 1) * S);
      ctx.lineTo(o.x + x * S, o.y + down * S);
      ctx.stroke();
      ctx.restore();
      // and the reject pipe, from the vessel's floor down through the cabinet to the reject valve and spout
      pipes([[sh.spouts[0], sh.tankH!], [sh.spouts[0], sh.spoutY - 4]], 4);
    }
    else pipes([[0, floor], [0, sh.spoutY - 4]], 4);
    for (const x of sh.spouts) ctx.fillRect(o.x + (x - 4) * S, o.y + (sh.spoutY - 6) * S, 8 * S, 6 * S);
    t.tanks.forEach((v, k) => {
      const r = this.tankRect(t, k);
      if (sh.cup) this.drawCupFluid(t, k);
      this.drawTank(v, r.x0, r.y0, r.x1, r.y1, sh.funnel, !sh.cup, !sh.cup, sh.sump);
      if (sh.cup) this.drawCup(t, k);
      if (sh.cup) this.drawGraduations(t, k);
      if (t.lidded) {
        // a lid, and nothing gets in
        ctx.fillStyle = theme.pipe;
        ctx.beginPath();
        ctx.roundRect(r.x0 - 4 * S, r.y0 - 5 * S, r.x1 - r.x0 + 8 * S, 6 * S, 2 * S);
        ctx.fill();
      }
    });
    if (sh.label) {
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      sh.label.forEach((line, i) => ctx.fillText(line, o.x, o.y + (-21 + 11 * i) * S));
    }
    t.tanks.forEach((v, k) => {
      if (!v.label) return;
      const at = this.tankLabelAt(t, k);
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      this.upright(at.x, () => ctx.fillText(v.label, at.x, at.y));
    });
    if (t.kind === 'exchanger') this.drawHelix(t);
    if (t.kind === 'sorter') this.drawChute(t);
    if (t.kind === 'heater') this.drawHeater(t);
    if (t.kind === 'spectrometer') this.drawSpectrometer(t);
    if (t.kind === 'meter') this.drawMeter(t);
    if (t.kind === 'receptacle') this.drawReceptacle(t);
    if (t.kind === 'tank') this.drawTankGraduations(t);
    if (t.kind === 'separator') {
      // the manifold: one pipe in, five out, with a divider between each two outlets
      const { x0, x1, y0, y1 } = SEP_BODY;
      ctx.fillStyle = theme.bench;
      ctx.strokeStyle = theme.pipe;
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.roundRect(o.x + x0 * S, o.y + y0 * S, (x1 - x0) * S, (y1 - y0) * S, 5 * S);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let k = 1; k < sh.spouts.length; k++) {
        const x = (sh.spouts[k - 1] + sh.spouts[k]) / 2;
        ctx.moveTo(o.x + x * S, o.y + (y0 + 5) * S);
        ctx.lineTo(o.x + x * S, o.y + y1 * S);
      }
      ctx.stroke();
      // a handle on its left end, so it doesn't look the same flipped (it says nothing about which side gets what)
      ctx.lineWidth = 2.5 * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(o.x + x0 * S, o.y + (y0 + 3) * S);
      ctx.lineTo(o.x + (x0 - 6) * S, o.y + (y0 + 3) * S);
      ctx.lineTo(o.x + (x0 - 6) * S, o.y + (y1 - 3) * S);
      ctx.lineTo(o.x + x0 * S, o.y + (y1 - 3) * S);
      ctx.stroke();
    }

    if (!sh.noValve) t.valves.forEach((_, k) => this.upright(this.valveAt(t, k).x, () => {
      if (k === sh.dial) return this.drawDial(t, k);
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
    }));

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
   * A heater's tube: glass, with what's in each stretch of it lying along its floor (as deep as that stretch
   * holds when the funnel feeds it flat out), and the wire coiled down its middle, from copper to white-hot as
   * the dial turns up; and the box the dial sits on, with the wire's lead running down into the tube.
   */
  private drawHeater(t: Tool): void {
    const { ctx, S, theme } = this;
    const o = this.toolXY(t);
    const { x0, x1, y, r } = HEATER_TUBE;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(S, S);
    const tube = new Path2D();
    tube.roundRect(x0 - r, y - r, x1 - x0 + 2 * r, 2 * r, r);
    // the fluid
    ctx.save();
    ctx.clip(tube);
    const w = (x1 - x0) / HEATER_CELLS;
    const full = (HEATER.feed * HEATER.transit) / HEATER_CELLS;
    t.tube.forEach((v, c) => {
      if (v.N <= TRACE) return;
      const d = 2 * r * Math.min(1, volume(v) / full);
      // the ends run on into the tube's rounded caps
      const a = c === 0 ? x0 - r : x0 + c * w;
      const b = c === HEATER_CELLS - 1 ? x1 + r : x0 + (c + 1) * w;
      ctx.fillStyle = fluidColor(v);
      ctx.fillRect(a, y + r - d, b - a + 0.3, d);
    });
    ctx.restore();
    ctx.fillStyle = theme.glasshi;
    ctx.fill(tube);
    // the box, and the wire's lead down from it into the tube
    const dial = t.valves[t.shape.dial!];
    const rgb = wireColor(dial);
    const lead = HEATER_BOX.x0 + 32;
    ctx.fillStyle = theme.bench;
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(HEATER_BOX.x0, HEATER_BOX.y0, HEATER_BOX.x1 - HEATER_BOX.x0, HEATER_BOX.y1 - HEATER_BOX.y0, 4);
    ctx.fill();
    ctx.stroke();
    // the wire, coiled along the tube and up into the box, glowing as it heats
    ctx.strokeStyle = css(rgb);
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dial > 0) {
      ctx.shadowColor = css(rgb, Math.min(1, 1.3 * dial));
      ctx.shadowBlur = (2 + 8 * dial) * S * this.zoom * this.dpr;
    }
    ctx.beginPath();
    ctx.moveTo(x0, y);
    for (let x = x0; x <= lead; x += 0.75) ctx.lineTo(x, y + 2.6 * Math.sin(((x - x0) / 5) * Math.PI));
    ctx.lineTo(lead, HEATER_BOX.y1);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = theme.glass;
    ctx.lineWidth = 1.6 / S;
    ctx.stroke(tube);
    ctx.restore();
  }

  /**
   * A dial, valve k: a knob on a ring of ticks running clockwise from down-left (off) to down-right (full), its
   * pointer at its setting.
   */
  private drawDial(t: Tool, k: number): void {
    const { ctx, S, theme } = this;
    const vc = this.valveAt(t, k);
    // canvas angles run clockwise from the right; the dial's from straight up
    const at = (d: number) => -0.75 * Math.PI + 1.5 * Math.PI * d - Math.PI / 2;
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1 * S;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = at(i / 6);
      ctx.moveTo(vc.x + 10.5 * S * Math.cos(a), vc.y + 10.5 * S * Math.sin(a));
      ctx.lineTo(vc.x + 13 * S * Math.cos(a), vc.y + 13 * S * Math.sin(a));
    }
    ctx.stroke();
    ctx.fillStyle = theme.bench;
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.arc(vc.x, vc.y, 8 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const a = at(t.valves[k]);
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2.2 * S;
    ctx.beginPath();
    ctx.moveTo(vc.x + 1.5 * S * Math.cos(a), vc.y + 1.5 * S * Math.sin(a));
    ctx.lineTo(vc.x + 7 * S * Math.cos(a), vc.y + 7 * S * Math.sin(a));
    ctx.stroke();
  }

  /**
   * The size sorter's chute: a plain sloping floor with a hopper under each of its two screens, into its drop
   * pipe, and a film of what's flowing down it.
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
    // the floor: plain all the way, so it doesn't give away what the screens let through
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(c.x0, c.y0);
    ctx.lineTo(c.x1, c.y1);
    ctx.stroke();
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
   * last sample (see spectrum), lighting up one hexagon at a time as a run goes on; and the run button. No
   * words anywhere: reading it is part of the game.
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
      ctx.shadowColor = green(0.85);
      ctx.shadowBlur = blur(2);
      ctx.strokeStyle = green(0.85);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let j = 0; j < 6; j++) ctx.lineTo(...corner(j));
      ctx.closePath();
      ctx.stroke();
    });
    // scanlines
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    for (let y = sc.y0; y < sc.y1; y += 1.5) ctx.fillRect(sc.x0, y, sc.x1 - sc.x0, 0.6);
    ctx.restore();
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 1.5;
    ctx.stroke(glass);

    // a lamp that blinks through a run, and the run button, sunk in while it runs
    ctx.fillStyle = t.scanning && Math.floor(t.scanAge * 3) % 2 === 0 ? '#ffb43a' : theme.pipe;
    ctx.beginPath();
    ctx.arc(sc.x0 + 6, (button.y0 + button.y1) / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    const busy = this.drag || this.toolDrag || this.valveDrag || this.scaleDrag || this.hoseDrag;
    const hot = !busy && !t.scanning && this.inToolRect(t, this.pointer, button);
    this.drawKey(button, t.scanning, hot);
    ctx.restore();
  }

  /**
   * A red push key filling r, in the current (local) units: standing on its shadow with a highlight along
   * its top, brighter under the pointer, and when pressed sitting down flush and darker.
   */
  private drawKey(r: { x0: number; x1: number; y0: number; y1: number }, pressed: boolean, hot: boolean): void {
    const { ctx } = this;
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    const slab = (x: number, y: number, w: number, h: number, rad: number) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, rad);
      ctx.fill();
    };
    if (!pressed) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      slab(r.x0 + 0.8, r.y0 + 2.2, w, h, 4);
    }
    const top = r.y0 + (pressed ? 1.8 : 0);
    ctx.fillStyle = pressed ? '#9c2d28' : hot ? '#ec5a50' : '#d8443b';
    slab(r.x0, top, w, h, 4);
    ctx.strokeStyle = '#7a221e';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!pressed) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      slab(r.x0 + 3, top + 1.6, w - 6, 3, 1.5);
    }
  }

  /**
   * Text on a seven-segment display, right-aligned in `cells` digit cells ending at x, with its digits' tops at
   * y, in the current (local) units: lit segments glow, and unlit ones show faintly, as on a real display.
   * Shows digits, '-', and the letters of "OUEr"; a '.' lights the decimal point after the digit before it.
   */
  private drawSevenSeg(text: string, x: number, y: number, cells: number, color: string, ghost: string): void {
    const { ctx } = this;
    const W = 7; // digit width
    const H = 13; // digit height
    const T = 1.7; // segment thickness
    const PITCH = 11;
    // segments as [x0, y0, x1, y1] in the digit's box: a, b, c, d, e, f, g
    const SEG = [
      [0, 0, W, 0], [W, 0, W, H / 2], [W, H / 2, W, H], [0, H, W, H], [0, H / 2, 0, H], [0, 0, 0, H / 2], [0, H / 2, W, H / 2],
    ];
    const LIT: Record<string, string> = {
      '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc',
      '8': 'abcdefg', '9': 'abcdfg', '-': 'g', O: 'abcdef', U: 'bcdef', E: 'adefg', r: 'eg', ' ': '',
    };
    // each cell is a character and whether the decimal point after it is lit
    const parsed: { ch: string; dp: boolean }[] = [];
    for (const ch of text) {
      if (ch === '.' && parsed.length) parsed[parsed.length - 1].dp = true;
      else parsed.push({ ch, dp: false });
    }
    while (parsed.length < cells) parsed.unshift({ ch: ' ', dp: false });
    const shown = parsed.slice(-cells);
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineWidth = T;
    for (let i = 0; i < cells; i++) {
      const { ch, dp } = shown[i];
      const lit = LIT[ch] ?? '';
      const left = x - (cells - i) * PITCH + (PITCH - W) / 2;
      // the decimal point, at the foot of the gap after the digit
      ctx.fillStyle = dp ? color : ghost;
      ctx.shadowColor = dp ? color : 'transparent';
      ctx.shadowBlur = dp ? 3 * this.S * this.zoom * this.dpr : 0;
      ctx.beginPath();
      ctx.arc(left + W + 1.6, y + H, T * 0.6, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 7; k++) {
        const on = lit.includes('abcdefg'[k]);
        const [ax, ay, bx, by] = SEG[k];
        // a little slant, and a gap where segments meet
        const sl = (yy: number) => (H - yy) * 0.12;
        const gx = ax === bx ? 0 : 1.1;
        const gy = ay === by ? 0 : 1.1;
        ctx.strokeStyle = on ? color : ghost;
        ctx.shadowColor = on ? color : 'transparent';
        ctx.shadowBlur = on ? 3 * this.S * this.zoom * this.dpr : 0;
        ctx.beginPath();
        ctx.moveTo(left + ax + gx + sl(ay + gy), y + ay + gy);
        ctx.lineTo(left + bx - gx + sl(by - gy), y + by - gy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Ten thin, faint lines across the big tank, one at each tenth of its capacity as its fluid is drawn (see
   * sumpFillHeight), the last at the brim.
   */
  private drawTankGraduations(t: Tool): void {
    const { ctx, theme, S } = this;
    const r = this.tankRect(t, 0);
    const sump = t.shape.sump!;
    ctx.save();
    ctx.strokeStyle = theme.glass;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 1; i <= 10; i++) {
      const y = r.y1 + sump.h * S - sumpFillHeight(i / 10, (r.x1 - r.x0) / S, (r.y1 - r.y0) / S, sump) * S;
      ctx.moveTo(r.x0, y);
      ctx.lineTo(r.x1, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A receptacle's cabinet: a row of lamps that blink with its thinking (each beep lights one for a moment), a
   * verdict lamp, green or red, its button (sunk in through a cycle), a green-on-black screen like the
   * spectrometer's showing the litres it's taken so far of the litres needed, and the reject valve under it, which
   * has no handle: it opens itself to pour out what the receptacle refused.
   */
  private drawReceptacle(t: Tool): void {
    const { ctx, S, theme } = this;
    const o = this.toolXY(t);
    const { lamps, verdict, button, screen: sc, ...b } = RECEPTACLE_BODY;
    const COLORS = ['#ffb43a', '#54d0ff', '#ff5a4f', '#7dff6a', '#b48cff', '#fff4c2'];
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(S, S);
    ctx.fillStyle = theme.bench;
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 6);
    ctx.fill();
    ctx.stroke();
    const glow = (local: number) => local * S * this.zoom * this.dpr;
    const lamp = (x: number, y: number, r: number, color: string | null) => {
      ctx.save();
      ctx.fillStyle = color ?? theme.pipe;
      if (color) {
        ctx.shadowColor = color;
        ctx.shadowBlur = glow(6);
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    // a lamp is lit for a moment after each beep that lights it
    const c = t.cycle;
    const lit = (i: number) =>
      c?.phase === 'think' && t.beeps.some((bp) => bp.lamp === i && bp.t <= c.age && c.age - bp.t < 0.12);
    for (let i = 0; i < RECEPTACLE_LAMPS; i++) lamp(lamps.x0 + i * lamps.dx, lamps.y, lamps.r, lit(i) ? COLORS[i] : null);
    lamp(verdict.x, verdict.y, verdict.r, t.verdict === 'pass' ? '#5cff7a' : t.verdict === 'fail' ? '#ff4a3d' : null);
    const busy = this.drag || this.toolDrag || this.valveDrag || this.scaleDrag || this.hoseDrag;
    const hot = !busy && !c && this.inToolRect(t, this.pointer, button);
    this.drawKey(button, !!c, hot);

    // the screen: accepted / required, in litres
    const glass = new Path2D();
    glass.roundRect(sc.x0, sc.y0, sc.x1 - sc.x0, sc.y1 - sc.y0, 3);
    ctx.fillStyle = '#040a06';
    ctx.fill(glass);
    ctx.save();
    ctx.clip(glass);
    const accepted = (this.delivered / CAP) * FLASK_L;
    ctx.fillStyle = ctx.shadowColor = `rgba(${PHOSPHOR}, 0.9)`;
    ctx.shadowBlur = glow(2);
    ctx.font = '8.5px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${accepted.toFixed(3)} L / ${GOAL_L.toFixed(3)} L`, (sc.x0 + sc.x1) / 2, (sc.y0 + sc.y1) / 2 + 0.5);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    for (let y = sc.y0; y < sc.y1; y += 1.5) ctx.fillRect(sc.x0, y, sc.x1 - sc.x0, 0.6);
    ctx.restore();
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 1.2;
    ctx.stroke(glass);
    ctx.restore();
    // the reject valve: just its body, with no handle, since only the receptacle opens it
    const vc = this.onTool(t, { x: t.shape.spouts[0], y: t.shape.valveY });
    ctx.fillStyle = theme.bench;
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.arc(vc.x, vc.y, 4.5 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /** A flow meter's cabinet, with its reading (see meterText) on a seven-segment display like the scale's. */
  private drawMeter(t: Tool): void {
    const { ctx, S, theme } = this;
    const o = this.toolXY(t);
    const { display: d, ...b } = METER_BODY;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(S, S);
    ctx.fillStyle = theme.bench;
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#050603';
    ctx.beginPath();
    ctx.roundRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, 3);
    ctx.fill();
    this.drawSevenSeg(meterText(t.rate), d.x1 - 2, d.y0 + 2.5, METER_DIGITS, 'yellowgreen', 'rgba(154, 205, 50, 0.08)');
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

    // a seven-segment readout in whole grams, yellow-green on black in either theme ("OUEr" when overloaded)
    ctx.translate(o.x, o.y);
    ctx.scale(S, S);
    ctx.fillStyle = '#050603';
    ctx.beginPath();
    ctx.roundRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, 3);
    ctx.fill();
    const g = sc.reading();
    this.drawSevenSeg(g === null ? 'OUEr' : String(g), d.x1 - 4, d.y0 + 3.5, 6, 'yellowgreen', 'rgba(154, 205, 50, 0.08)');

    // the tare key: no label, like the spectrometer's
    const hot = !this.drag && !this.scaleDrag && this.onScale(sc, this.pointer, tare);
    this.drawKey(tare, this.tarePress === sc, hot && this.tarePress !== sc);
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
    const { ctx, H, S, L, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    this.readTheme();
    const { theme } = this;
    this.worldTransform();
    ctx.font = `${Math.round(11 * Math.max(S, 0.85))}px "Schibsted Grotesk", sans-serif`;
    // the world runs on forever sideways, so things that do are drawn across the view
    const left = this.cam.x - 10 * S;
    const right = this.cam.x + this.viewW / this.zoom + 10 * S;

    // sink, all along the floor: whatever falls off the bench ends up here
    ctx.fillStyle = theme.bench;
    ctx.fillRect(left, L.floorY, right - left, H - L.floorY);
    ctx.strokeStyle = theme.pipe;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    for (let x = Math.floor(left / (12 * S)) * 12 * S + 8 * S; x < right; x += 12 * S) {
      ctx.moveTo(x, L.floorY + 4 * S);
      ctx.lineTo(x, H - 3 * S);
    }
    ctx.stroke();
    ctx.fillStyle = theme.bench;
    ctx.fillRect(HOME_W - 50 * S, L.floorY, 40 * S, H - L.floorY);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('sink', HOME_W - 30 * S, (L.floorY + H) / 2);
    // the floor stays visible however far out the view zooms
    ctx.fillStyle = theme.pipe;
    ctx.fillRect(left, L.floorY, right - left, Math.max(2 * S, 2 / this.zoom));
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
    for (const { at, v } of this.spills.values()) {
      if (v.N <= TRACE) continue;
      const m = mouthBelow(mouths, at);
      this.drawStream(at.x, at.y, at.x, m ? m.y + 2 * S : H, fluidColor(v), volume(v) / (MAX_FLOW * this.spillTime));
    }
    for (const { fa, m } of this.faucetFlows) {
      const { spout } = this.faucetXY(fa);
      this.drawStream(spout.x, spout.y, spout.x, m.y + 2 * S, fluidColor(fa.output), FILL_RATE / CAP);
    }
    if (drag && this.pouring && drag.flask.N > TRACE) {
      const D = drag.flask;
      const z = drag.zone;
      if (z?.kind === 'flask') this.drawStream(D.x, D.y, z.f.home.x, z.f.home.y + 4 * S, fluidColor(D), POUR_RATE / CAP);
      if (z?.kind === 'tank') this.drawStream(D.x, D.y, z.x, z.y + 4 * S, fluidColor(D), POUR_RATE / CAP);
      if (z?.kind === 'sink') this.drawStream(D.x, D.y, D.x - 4 * S, H, fluidColor(D), POUR_RATE / CAP);
    }

    // shelves
    ctx.fillStyle = theme.bench;
    for (const y of new Set(L.homes.map((h) => h.y))) ctx.fillRect(left, y + 70 * S, right - left, 6 * S);
    for (const sc of this.scales) this.drawScale(sc);

    // faucets, each on its own stub of pipe
    ctx.lineCap = 'round';
    for (const fa of L.faucets) {
      const { pipe, spout } = this.faucetXY(fa);
      ctx.strokeStyle = theme.pipe;
      ctx.lineWidth = 6 * S;
      ctx.beginPath();
      ctx.moveTo(pipe.x - 20 * S, pipe.y);
      ctx.lineTo(pipe.x + 20 * S, pipe.y);
      ctx.stroke();
      ctx.lineWidth = 5 * S;
      ctx.beginPath();
      ctx.moveTo(pipe.x, pipe.y);
      ctx.lineTo(spout.x, spout.y - 4 * S);
      ctx.stroke();
      ctx.fillStyle = theme.pipe;
      ctx.fillRect(spout.x - 5 * S, spout.y - 6 * S, 10 * S, 7 * S);
      ctx.fillStyle = fluidColor(fa.output);
      ctx.beginPath();
      ctx.arc(pipe.x, pipe.y, 10 * S, 0, Math.PI * 2);
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
        ctx.fillText(f.label, f.home.x, f.home.y + LABEL_Y * S);
      }
      if (this.hover === f && this.god) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(f.home.x - 30 * S, f.home.y - 6 * S, 60 * S, 80 * S);
      }
    }

    for (const t of this.tools) {
      // a running spectrometer shakes, harder as its run goes on
      const shake = this.speed > 0 ? scanLevel(t.scanAge) * SHAKE * S : 0;
      ctx.save();
      if (shake) ctx.translate(shake * (2 * Math.random() - 1), shake * (2 * Math.random() - 1));
      this.drawTool(t);
      ctx.restore();
    }
    for (const h of this.hoses) this.drawHose(h);
    this.drawDrops();
    if (drag) this.drawFlask(drag.flask, drag.flask.x, drag.flask.y, drag.flask.ang);
    if (this.rightWouldDo()) this.drawRightHint();

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

  /**
   * Whether pressing the right button now would do something: turn the valve the pointer is near, pour the
   * carried flask into what it's over, let a carried tool or hose flow, or catch something falling into what's
   * carried (from a faucet, spout or hose).
   */
  private rightWouldDo(): boolean {
    const { pointer: p, S } = this;
    if (this.rightHeld || (p.x === -1 && p.y === -1)) return false;
    if (this.valveNear(p)) return true;
    const carried = this.carried();
    if (!carried.size) return false;
    if (this.drag) {
      const z = this.zoneAt(p, this.drag.flask);
      if (z && z.kind !== 'scale') return true;
    }
    const tool = this.toolDrag?.tool;
    const free = tool?.kind === 'splitter' || tool?.kind === 'sorter' || tool?.kind === 'heater' || tool?.kind === 'meter';
    const drains = (k: number) => free || tool!.valves[k] > 0;
    if (tool?.shape.spouts.length && tool.tanks.some((v, k) => v.N > TRACE && drains(k))) return true;
    // a heater's tube runs whatever its valves say
    if (tool?.tube.some((v) => v.N > TRACE)) return true;
    if (this.hoseDrag && this.hoseDrag.hose.funnel.N > TRACE) return true;
    const open = this.mouths(true);
    const catches = (from: Point, reach = Infinity) => {
      const m = mouthBelow(open, from);
      return !!m && carried.has(m.v) && m.y - from.y <= reach;
    };
    if (this.L.faucets.some((fa) => catches(this.faucetXY(fa).spout, FAUCET_REACH * S))) return true;
    for (const u of this.tools)
      if (u.shape.spouts.some((_, k) => (u.out[k] || u.drops[k].N > 0) && catches(this.spoutAt(u, k)))) return true;
    return this.hoses.some((h) => (h.out || h.drop.N > 0) && catches(this.hoseEnd(h, 'outlet')));
  }

  /** A little mouse with its right button lit, just below and right of the pointer: the right button would do something. */
  private drawRightHint(): void {
    const { ctx, theme } = this;
    const s = this.toScreen(this.pointer);
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(Math.round(s.x + 14), Math.round(s.y + 12));
    ctx.globalAlpha = 0.75;
    const body = new Path2D();
    body.roundRect(0, 0, 12, 17, 6);
    ctx.fillStyle = theme.bench;
    ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(6, 0, 6, 7);
    ctx.restore();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke(body);
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(12, 7);
    ctx.moveTo(6, 0);
    ctx.lineTo(6, 7);
    ctx.stroke();
    ctx.restore();
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
