import { equilibrate } from '../chem/equilibrium';
import { temperature, type Fluid, type NetReaction, type ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
import { beeper, type Beeper } from './beeper';
import {
  FLASK_CENTER, aimValve, flaskBox, flaskLip, flaskMouth, flip, hoseEndBox, hoseMouth, onScale, onTool, openingOf,
  scaleBox, scaleCenter, scaleSpot, spoutAt, tankMouth, toolBox, toolCenter, valveNear, valveZ,
} from './bodies';
import { CAP, FILL_RATE, GOAL_VOLUME, HOME_H, HOME_W, N_FLASKS, POUR_RATE, TRACE } from './config';
import { cool, exposure, taper } from './cooling';
import { FAUCETS, faucetOutput, faucetTarget } from './faucets';
import { FLASK_H, FLASK_OUTLINE, areaBelow, fillLevel } from './flaskShape';
import { Flask, Vessel, fluidColor, transfer, volume, volumeUnit, type Point } from './flask';
import { boxesOverlap, moveBox, roomBoxes, walk, type Box } from './physics';
import { CENTER, placement, type Placement } from './place';
import { DEFAULT_PRESET, METER_AT, RECEPTACLE_AT, SPECTROMETER_AT, applyFill, type Preset } from './presets';
import { rumble, type Rumble } from './rumble';
import { loadChem, loadVessel, saveChem, saveVessel, type SaveState } from './save';
import { Scale, glassGrams } from './scale';
import {
  COUNTERS, LIFT, PAPER_Z, ROOM, Z_HOME, fromFrac, groundAt, toFrac, toLocal, toWorld, wrapAngle, type Pose, type Vec3,
} from './space';
import {
  HEATER, HEATER_CELLS, HEATER_TUBE, Hose, MAX_FLOW, RECEPTACLE_TIMES, SCAN_LIGHTS, SHAPES, SUMP_TIP, TANK_H, TOOL_NAMES,
  Tool, UNIQUE_TOOLS, cupFillHeight, drip, mouthBelow, scanLevel, sumpFillHeight, tankX, type Mouth, type ToolKind,
} from './tools';
import { typingIn } from './typing';
import {
  PAPER_HANDLE, PAPER_HEADER, PAPER_MIN, PAPER_TEXT, PAPER_TEXT_MAX, Paper, eraseAt, extend, loadPaper, savePaper,
  textAt,
} from './paper';
import { View, type FaucetSpot, type Frame, type Pick } from './view';
import { WaterSounds } from './water';

/** What the info panel shows for one vessel: all of it in god mode, otherwise just its color. */
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
  /** Where to put the panel: beside x0..x1 at height y, in a stage stageW × stageH, in CSS pixels. */
  x0: number;
  x1: number;
  y: number;
  stageW: number;
  stageH: number;
}

/** What the heads-up display shows: the crosshair's hints, and what's being held. */
export interface Hud {
  /** Whether the mouse is captured for looking around; if not, the game shows how to start. */
  locked: boolean;
  /** Whether E would pick up what the crosshair is on. */
  grab: boolean;
  /** Whether something is being held (E lets go). */
  holding: boolean;
  /** Whether the left button would press the key or button the crosshair is on. */
  press: boolean;
  /** Whether the right button would do something: turn the valve looked at, or let fluid out of what's held. */
  right: boolean;
  /** While a valve is being turned, where the pointer that aims its lever is, in CSS pixels; or with the pencil, where it points. */
  aim: { x: number; y: number } | null;
  /** Whether the pencil is in hand. */
  pencil: boolean;
  /** Whether F would flip something: the tool held, or else the one looked at, if it can be flipped. */
  flip: boolean;
  /** What the right button does now, in a word, for the touch screen's button that stands in for it. */
  hand: 'Pour' | 'Flow' | 'Turn' | 'Erase';
  /** A brief note, like there being no room for something. */
  note: string | null;
}

export interface EngineCallbacks {
  /** The receptacle has taken GOAL_VOLUME of the target. */
  onWin(): void;
  /** Throttled to ~10 Hz; null when nothing is inspected. */
  onInspect(info: Inspection | null): void;
  /** A vessel was double-clicked in god mode; look it up with GameEngine.vessel(id). */
  onEdit(id: string): void;
  /** Something that can be carried was double-clicked to write a note about it: the note's id (see GameEngine.note). */
  onLabel(id: string): void;
  /** The pencil was picked up or put down (see setPencil). */
  onPencil(on: boolean): void;
  /** A line of text on a sticky note is to be typed, or null when there's none to type any more. */
  onPaperText(edit: PaperEdit | null): void;
  /** Whenever the heads-up display changes. */
  onHud(hud: Hud): void;
}

/** What the player is holding. A hose is held by one end, or (just made) both. */
type Held = (
  | { kind: 'flask'; f: Flask }
  | { kind: 'tool'; t: Tool }
  | { kind: 'scale'; sc: Scale }
  | { kind: 'hose'; h: Hose; end: 'inlet' | 'outlet' | 'both' }
) & {
  /** How far it's turned from facing the player, and how far in front of their eyes it's held. */
  relYaw: number;
  dist: number;
};

/**
 * A line of text on a sticky note being typed: a new one (index −1) with the left end of its baseline at (x, y) on
 * the sheet, or an old one, by its index in the sheet's texts.
 */
export interface PaperEdit {
  paper: Paper;
  index: number;
  x: number;
  y: number;
}

/** Things that can be made from the hotbar, in its order. */
export const ITEMS = [
  'flask', 'dispenser', 'pipette', 'exchanger', 'separator', 'splitter', 'sorter', 'heater', 'scale', 'hose', 'tank',
] as const;
export type Item = (typeof ITEMS)[number];
/** The key that makes each item, in ITEMS order: along the number row, 1 to 9, then 0 and -. */
export const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'] as const;
/** The same keys, as KeyboardEvent codes, so they work whatever the keyboard layout's shift state. */
const HOTKEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus'];

/** How tipped a flask held to pour is: past the horizontal, mouth down. */
const POUR_ANG = Math.PI * 0.61;
/** How long a flask takes to tip to pour, or stand back up, in real seconds. */
const TIP_S = 0.3;
/** How far below a faucet something can be and still get filled. */
const FAUCET_REACH = 24;
/** How fast a falling drop speeds up, in world units per sim second squared: a 500-unit fall takes 0.7 s. */
const GRAVITY = 2000;
/** The player's eyes, standing and crouching; their body's radius; and how fast they walk, per real second. */
const EYE = 620;
const CROUCH_EYE = 330;
const PLAYER_R = 45;
const WALK = 560;
/** How far away something can be and still be picked up or pressed. */
const REACH = 460;
/** The nearest and furthest something can be held, from the eyes to its middle, beyond its own size. */
const HOLD_NEAR = 40;
const HOLD_FAR = 520;
/** Radians the view turns per pixel the mouse moves, and that something held turns with Shift. */
const LOOK_SENS = 0.0022;
const TURN_SENS = 0.008;
/** How fast the look stick turns the view when pushed all the way, in radians per real second: across, and up or down. */
const STICK_TURN = 2.4;
const STICK_TILT = 1.6;
/** Whether the screen is mainly touched, rather than pointed at with a mouse: then the on-screen sticks walk and look. */
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
/** How long two clicks can be apart and count as a double-click, in ms. */
const DOUBLE_MS = 380;
/** Where the faucets are: along the right wall over its counter, this high, this far apart. */
const FAUCET_Y = LIFT + 300;
const FAUCET_Z0 = 360;
const FAUCET_GAP = 64;
const FAUCET_OUT = 70;
/** How long a note stays up, in ms. */
const NOTE_MS = 1600;
/** A flask's outline's area, in local units squared, for how exposed its fluid is (see exposures). */
const FLASK_AREA = areaBelow(FLASK_OUTLINE, 0);
/** Width of the stem a funnel-shaped tank narrows to, in local units. */
const FUNNEL_STEM = 6;

/** Owns the lab: what's in it, the player, input, the simulation loop, and the view that draws it. */
export class GameEngine {
  speed = 1;
  god = true;

  private view: View;
  private flasks: Flask[] = [];
  private tools: Tool[] = [];
  private scales: Scale[] = [];
  private hoses: Hose[] = [];
  private faucets: (FaucetSpot & { start: (typeof FAUCETS)[number] })[];
  /** Where the player stands, which way they look (yaw about the vertical, pitch up), and how far they crouch (0 to 1). */
  private player = { x: 480, z: 620, yaw: 0, pitch: -0.08, crouch: 0 };
  private keys = new Set<string>();
  /** Where the on-screen sticks are pushed (see stick). */
  private sticks = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
  /** Whether the touch screen's crouch button is held (see touchCrouch). */
  private crouchHeld = false;
  /** When the pencil last drew by touch, so the mouse events a browser makes up from a touch are ignored. */
  private lastTouch = -Infinity;
  private held: Held | null = null;
  /** Whether the right button is held: a held flask tips and pours, and a held tool or hose lets fluid out, only while it is. */
  private rightHeld = false;
  /** A valve being turned with the right button, and where on screen the pointer aiming its lever is. */
  private turning: { t: Tool; k: number; aim: { x: number; y: number } } | null = null;
  /** The scale whose tare key is held down, to draw it pressed. */
  private tarePress: Scale | null = null;
  private locked = false;
  /** Open tops, as of the latest look this frame (see mouths). */
  private open: Mouth[] = [];
  /** What overflowed each vessel this frame, and where it spilled from, for drawing (see fill). */
  private spills = new Map<Vessel, { at: Vec3; v: Vessel }>();
  private spillTime = 1;
  /** Drops that have let go of an outlet and are on their way down. */
  private falling: { v: Vessel; x: number; y: number; z: number; vy: number }[] = [];
  private faucetFlows: { fa: FaucetSpot; m: Mouth }[] = [];
  /** Where the held flask poured this frame, if it did: its lip, and what it poured into (null: the sink). */
  private pour: { from: Vec3; into: Mouth | null } | null = null;
  /** What the crosshair is on. */
  private target: (Pick & { point: Vec3; distance: number }) | null = null;
  /** A brief note on the display, like there being no room for something (see say). */
  private flash: { text: string; until: number } | null = null;
  private lastClick = { at: 0, id: '' };
  private won = false;
  /** The target the receptacle has taken, all told, by volume: what counts toward the goal. */
  private delivered = 0;
  /** Each receptacle's sounds, through its cycle (see Tool.press). */
  private beepers = new Map<Tool, Beeper>();
  /** The player's sticky notes, on the back wall, the one on top last (see paper.ts). They're notes, not lab, so Reset keeps them. */
  papers: Paper[] = [];
  /** Whether the pencil is in hand: then the mouse moves a pointer (see `cursor`) that draws on sticky notes. */
  private pencil = false;
  /** Where the pencil points, on the canvas in CSS pixels, while it's in hand. */
  private cursor = { x: 0, y: 0 };
  /** What the pencil is doing while a button's held: marking out a new sheet, drawing, moving or resizing one, or erasing. */
  private paperDrag:
    | { kind: 'new'; from: Point }
    | { kind: 'draw'; paper: Paper; stroke: number[]; from: Point; moved: boolean }
    | { kind: 'move'; paper: Paper; off: Point }
    | { kind: 'resize'; paper: Paper }
    | { kind: 'erase' }
    | null = null;
  private inspected: Vessel | null = null;
  private lastInspect = 0;
  private lastHud = '';
  private last = performance.now();
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private nextToolId = 0;
  private viewW = 0;
  private viewH = 0;
  private rumbles = new Map<Tool, Rumble>();
  private water = new WaterSounds();
  /** This frame's streams, for their sound: how much ran into each vessel, by volume. */
  private inflow = new Map<Vessel, number>();
  /** Where each drop that landed in a vessel this frame landed, for its sound. */
  private landed: Vec3[] = [];
  private firstFrame = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private stage: HTMLElement,
    private chem: ReactionNetwork,
    private cb: EngineCallbacks,
    private preset: Preset = DEFAULT_PRESET,
  ) {
    // along the right wall, left to right as the player faces it
    this.faucets = FAUCETS.map((start, i) => {
      const z = FAUCET_Z0 + i * FAUCET_GAP;
      return {
        start,
        spout: { x: ROOM.x1 - FAUCET_OUT, y: FAUCET_Y, z },
        wall: { x: ROOM.x1 - 14, y: FAUCET_Y + 70, z },
        output: faucetOutput(start, chem),
        note: '',
      };
    });
    this.view = new View(canvas, this.faucets);
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
    for (const r of this.rumbles.values()) r.stop();
    this.water.stop();
    this.view.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /**
   * A vessel by the id passed to onEdit: `f<index>` for a flask, `t<tool>.<tank>` for a tool's tank.
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

  /**
   * God mode: bring a vessel (by id, as for vessel) to full chemical equilibrium at its temperature, at once (see
   * equilibrate). If that leaves it more molecules than fit, the excess spills over its rim.
   */
  equilibrate(id: string): void {
    const v = this.vessel(id)?.vessel;
    if (!v) return;
    equilibrate(v, this.chem.U, temperature(v));
    this.open = this.mouths();
    this.overflow(v);
  }

  /** God mode: what's reacting in a vessel (by id, as for vessel) right now, busiest first (see netRates). */
  reactions(id: string): NetReaction[] {
    const v = this.vessel(id)?.vessel;
    return v ? this.chem.netRates(v) : [];
  }

  /**
   * The note an id names, to read and change: a flask's label (`f3`, by index), a tank's (`t2.0`, by tool id and
   * tank), a tool's own note (`t2`; only a tool with more than one tank has one), a scale's (`s1`), a hose's (`h0`)
   * or a faucet's (`F5`), by index. Things are replaced on reset and load, so look this up each time.
   */
  note(id: string): { text: string; set(text: string): void } | null {
    const label = (o: { label: string } | undefined) => o && { text: o.label, set: (s: string) => void (o.label = s) };
    const note = (o: { note: string } | undefined) => o && { text: o.note, set: (s: string) => void (o.note = s) };
    const tank = /^t(\d+)\.(\d+)$/.exec(id);
    if (tank) return label(this.tools.find((t) => t.id === +tank[1])?.tanks[+tank[2]]) ?? null;
    const m = /^([fFsht])(\d+)$/.exec(id);
    if (!m) return null;
    const i = +m[2];
    const found =
      m[1] === 'f' ? label(this.flasks[i])
      : m[1] === 't' ? note(this.tools.find((t) => t.id === i && t.tanks.length > 1))
      : m[1] === 's' ? note(this.scales[i])
      : m[1] === 'h' ? note(this.hoses[i])
      : note(this.faucets[i]);
    return found ?? null;
  }

  /** Where a note (see note for its id) is written, in the room: just above what it's about. */
  private noteAt(id: string): Vec3 | null {
    const tank = /^t(\d+)\.(\d+)$/.exec(id);
    if (tank) {
      const t = this.tools.find((u) => u.id === +tank[1]);
      const k = +tank[2];
      if (!t?.tanks[k]) return null;
      const lines = t.shape.label?.length ?? 0;
      return onTool(t, tankX(t.shape.tanks[k]), openingOf(t, k).y - (lines ? 11 * lines + 10 : 9));
    }
    const m = /^([fFsht])(\d+)$/.exec(id);
    if (!m) return null;
    const i = +m[2];
    if (m[1] === 'f') return this.flasks[i] ? toWorld(this.flasks[i].pose, { x: 0, y: 13, z: 0 }) : null;
    if (m[1] === 't') {
      const t = this.tools.find((u) => u.id === i);
      const b = t?.shape.box;
      return t && b ? onTool(t, (b.x0 + b.x1) / 2, b.y0 - 21) : null;
    }
    if (m[1] === 's') {
      const sc = this.scales[i];
      return sc ? toWorld(sc.pose, { x: 0, y: sc.load.length ? FLASK_H + 26 : 13, z: 0 }) : null;
    }
    if (m[1] === 'h') return this.hoses[i] ? { ...this.hoses[i].inlet, y: this.hoses[i].inlet.y + 13 } : null;
    const fa = this.faucets[i];
    return fa ? { x: fa.spout.x, y: fa.wall.y + 21, z: fa.spout.z } : null;
  }

  /** Restart from the current preset. */
  reset(): void {
    this.load(this.preset);
  }

  load(preset: Preset): void {
    this.preset = preset;
    this.flasks = Array.from({ length: N_FLASKS }, (_, i) => {
      const f = new Flask(CAP);
      f.pose = { x: (HOME_W * (i + 0.5)) / N_FLASKS, y: LIFT + 92, z: Z_HOME, yaw: 0 };
      f.glass = glassGrams(i);
      applyFill(f, preset.flasks[i] ?? null);
      return f;
    });
    this.delivered = 0;
    this.scales = (preset.scales ?? []).map(([fx, fy]) => new Scale({ ...fromFrac({ x: fx, y: fy }), yaw: 0 }));
    this.nextToolId = preset.tools?.length ?? 0;
    this.tools = (preset.tools ?? []).map((spec, i) => {
      const t = new Tool(spec.kind, i, { ...fromFrac({ x: spec.at[0], y: spec.at[1] }), yaw: 0 }, spec.valves);
      spec.tanks?.forEach((fill, k) => t.tanks[k] && applyFill(t.tanks[k], fill));
      return t;
    });
    this.uniqueTools();
    this.hoses = (preset.hoses ?? []).map(({ from, to }) => {
      const sp = spoutAt(this.tools[from.tool], from.spout);
      const t = this.tools[to.tool];
      const m = tankMouth(t, to.tank ?? 0);
      const out = onTool(t, tankX(t.shape.tanks[to.tank ?? 0]) + (to.dx ?? 0), -24);
      return new Hose({ ...sp, y: sp.y - 16 }, { ...out, y: Math.max(out.y, m.y + 24) });
    });
    this.settle();
    this.afterLoad();
  }

  private afterLoad(): void {
    this.won = false;
    for (const b of this.beepers.values()) b.stop();
    this.beepers.clear();
    this.falling = [];
    this.held = this.turning = this.tarePress = null;
    this.firstFrame = true;
  }

  /** Everything in the lab, plus the chemistry parameters, for saving. */
  snapshot(): SaveState {
    const depth = (p: Pose) => ({ z: p.z, yaw: p.yaw });
    return {
      v: 1,
      preset: this.preset.id,
      flasks: this.flasks.map((f) => ({
        ...saveVessel(f), x: f.pose.x / HOME_W, up: f.pose.y - LIFT, glass: f.glass, ...depth(f.pose),
      })),
      tools: this.tools.map((t) => ({
        kind: t.kind, id: t.id, ...this.frac(t.pose), ...depth(t.pose), valves: [...t.valves], tanks: t.tanks.map(saveVessel),
        drops: t.drops.map(saveVessel),
        ...(t.tube.length ? { tube: t.tube.map(saveVessel) } : {}),
        ...(t.flipped ? { flipped: true } : {}),
        ...(t.note ? { note: t.note } : {}),
        ...(t.reading ? { reading: [...t.reading] } : {}),
      })),
      scales: this.scales.map((sc) => ({
        ...this.frac(sc.pose), ...depth(sc.pose), tare: sc.tare,
        load: sc.load.map(({ f, dx }) => ({ f: this.flasks.indexOf(f), dx })).filter((l) => l.f >= 0),
        ...(sc.note ? { note: sc.note } : {}),
      })),
      hoses: this.hoses.map((h) => ({
        inlet: { ...toFrac(h.inlet), z: h.inlet.z }, outlet: { ...toFrac(h.outlet), z: h.outlet.z },
        funnel: saveVessel(h.funnel), drop: saveVessel(h.drop),
        ...(h.note ? { note: h.note } : {}),
      })),
      // where they started on the old flat bench, so the save still loads there, with their notes
      faucets: this.faucets.map((fa, i, all) => ({ x: (i + 0.5) / all.length, y: 30 / HOME_H, ...(fa.note ? { note: fa.note } : {}) })),
      delivered: this.delivered,
      ...(this.papers.length ? { papers: this.papers.map(savePaper) } : {}),
      player: { x: this.player.x, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch },
      chem: saveChem(this.chem.params),
    };
  }

  private frac(p: Vec3): { fx: number; fy: number } {
    const f = toFrac(p);
    return { fx: f.x, fy: f.y };
  }

  /** Replace the lab with a saved one. `preset` is what Reset will go back to afterwards. */
  restore(s: SaveState, preset: Preset): void {
    this.preset = preset;
    loadChem(this.chem.params, s.chem);
    this.chem.rebuild();
    const num = (x: unknown, d: number) => (Number.isFinite(x) ? (x as number) : d);
    const pose = (p: Vec3, saved: { z?: number; yaw?: number }): Pose => this.inRoom({ ...p, z: num(saved.z, Z_HOME), yaw: num(saved.yaw, 0) });
    this.flasks = s.flasks.map((sf, i) => {
      const f = new Flask(CAP);
      f.pose = pose({ x: sf.x * HOME_W, y: LIFT + sf.up, z: 0 }, sf);
      f.glass = Number.isFinite(sf.glass) ? sf.glass : glassGrams(i);
      loadVessel(f, sf);
      return f;
    });
    this.tools = s.tools
      .filter((st) => st.kind in SHAPES)
      .map((st) => {
        const t = new Tool(st.kind, st.id, pose(fromFrac({ x: st.fx, y: st.fy }), st), st.valves ?? []);
        t.tanks.forEach((v, k) => st.tanks?.[k] && loadVessel(v, st.tanks[k]));
        t.drops.forEach((v, k) => st.drops?.[k] && loadVessel(v, st.drops[k]));
        t.tube.forEach((v, k) => st.tube?.[k] && loadVessel(v, st.tube[k]));
        t.flipped = !!st.flipped && !!t.shape.flippable;
        if (typeof st.note === 'string') t.note = st.note;
        if (Array.isArray(st.reading) && st.reading.length === 18) t.reading = st.reading.map((x) => Math.max(0, Number(x) || 0));
        return t;
      });
    this.nextToolId = Math.max(-1, ...this.tools.map((t) => t.id)) + 1;
    this.uniqueTools();
    this.scales = s.scales.map((ss) => {
      const sc = new Scale(pose(fromFrac({ x: ss.fx, y: ss.fy }), ss));
      sc.tare = ss.tare ?? 0;
      if (typeof ss.note === 'string') sc.note = ss.note;
      for (const { f, dx } of ss.load ?? []) if (this.flasks[f]) sc.put(this.flasks[f], dx);
      return sc;
    });
    this.hoses = s.hoses.map((sh) => {
      const end = (e: { x: number; y: number; z?: number }) => this.inRoom({ ...fromFrac(e), z: num(e.z, Z_HOME), yaw: 0 });
      const h = new Hose(end(sh.inlet), end(sh.outlet));
      if (sh.funnel) loadVessel(h.funnel, sh.funnel);
      if (sh.drop) loadVessel(h.drop, sh.drop);
      if (typeof sh.note === 'string') h.note = sh.note;
      return h;
    });
    const fs = s.faucets ?? [];
    this.faucets.forEach((fa, i) => {
      const note = fs.length === this.faucets.length ? fs[i]?.note : undefined;
      fa.note = typeof note === 'string' ? note : '';
    });
    this.delivered = Number.isFinite(s.delivered) ? Math.max(0, s.delivered!) : 0;
    this.papers = (Array.isArray(s.papers) ? s.papers : []).map(loadPaper).filter((p): p is Paper => !!p);
    this.paperDrag = null;
    this.cb.onPaperText(null);
    const pl = s.player;
    if (pl && [pl.x, pl.z, pl.yaw, pl.pitch].every(Number.isFinite)) {
      const p = this.inRoom({ x: pl.x, y: 0, z: pl.z, yaw: pl.yaw });
      Object.assign(this.player, { x: p.x, z: p.z, yaw: pl.yaw, pitch: pl.pitch });
    }
    this.settle();
    this.afterLoad();
  }

  /** A pose kept inside the room. */
  private inRoom<P extends Vec3>(p: P): P {
    const m = 30;
    return {
      ...p,
      x: Math.max(ROOM.x0 + m, Math.min(ROOM.x1 - m, p.x)),
      y: Math.max(m, Math.min(ROOM.y1 - m, p.y)),
      z: Math.max(ROOM.z0 + m, Math.min(ROOM.z1 - m, p.z)),
    };
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
    const add = (kind: ToolKind, at: [number, number]) => {
      if (!this.tools.some((t) => t.kind === kind))
        this.tools.push(new Tool(kind, this.nextToolId++, { ...fromFrac({ x: at[0], y: at[1] }), yaw: 0 }));
    };
    add('spectrometer', SPECTROMETER_AT);
    add('meter', METER_AT);
    add('receptacle', RECEPTACLE_AT);
  }

  /** Stand each flask on a scale where the scale now is. */
  private settle(): void {
    for (const sc of this.scales) for (const { f, dx } of sc.load) f.pose = onScale(sc, dx);
  }

  /** The flasks standing on scales. */
  private standing(): Set<Flask> {
    return new Set(this.scales.flatMap((sc) => sc.load.map((l) => l.f)));
  }

  /* ---------------- making and putting away ---------------- */

  /**
   * Make a new flask, tool, scale or hose in the player's grip, facing them, if there's room for it there and
   * their hands are free. Returns whether it did.
   */
  spawn(kind: Item): boolean {
    if (this.held) {
      this.say('Hands full');
      return false;
    }
    let held: Held;
    if (kind === 'flask') {
      const f = new Flask(CAP);
      f.glass = glassGrams(this.flasks.length);
      held = { kind: 'flask', f, relYaw: 0, dist: 0 };
    } else if (kind === 'scale') held = { kind: 'scale', sc: new Scale(), relYaw: 0, dist: 0 };
    else if (kind === 'hose') held = { kind: 'hose', h: new Hose({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), end: 'both', relYaw: 0, dist: 0 };
    else held = { kind: 'tool', t: new Tool(kind, this.nextToolId, undefined), relYaw: 0, dist: 0 };
    held.dist = this.holdDist(held);
    this.placeHeld(held, this.gripPose(held));
    held.dist = this.clampDist(held, held.dist);
    const box = this.heldBox(held);
    if (this.obstacles(held).some((o) => boxesOverlap(box, o))) {
      this.say('No room');
      return false;
    }
    if (held.kind === 'flask') this.flasks.push(held.f);
    if (held.kind === 'scale') this.scales.push(held.sc);
    if (held.kind === 'hose') this.hoses.push(held.h);
    if (held.kind === 'tool') {
      this.nextToolId++;
      this.tools.push(held.t);
    }
    this.held = held;
    return true;
  }

  /** Put away whatever's held, unless it's one of a kind. */
  private putAway(): void {
    const h = this.held;
    if (!h) return;
    if (h.kind === 'tool' && UNIQUE_TOOLS.includes(h.t.kind)) {
      this.say("Can't put that away");
      return;
    }
    if (h.kind === 'flask') this.flasks.splice(this.flasks.indexOf(h.f), 1);
    if (h.kind === 'tool') this.tools.splice(this.tools.indexOf(h.t), 1);
    if (h.kind === 'scale') this.scales.splice(this.scales.indexOf(h.sc), 1);
    if (h.kind === 'hose') this.hoses.splice(this.hoses.indexOf(h.h), 1);
    this.held = null;
  }

  private say(text: string): void {
    this.flash = { text, until: performance.now() + NOTE_MS };
  }

  /* ---------------- bodies ---------------- */

  /**
   * The middle of what's held, in its own frame: what's held in front of the eyes, and where its box is centered.
   * A hose end's box doesn't turn, so for one this is straight up or down.
   */
  private anchor(h: Held): Vec3 {
    if (h.kind === 'flask') return FLASK_CENTER;
    if (h.kind === 'tool') return toolCenter(h.t);
    if (h.kind === 'scale') return scaleCenter(h.sc);
    const b = this.heldBox(h);
    const e = h.end === 'outlet' ? h.h.outlet : h.h.inlet;
    return { x: 0, y: b.y - e.y, z: 0 };
  }

  /** How far in front of the eyes something is held to start with: just clear of the player, with room to see it. */
  private holdDist(h: Held): number {
    const b = this.heldBox(h);
    return Math.hypot(b.hx, b.hz) + 90;
  }

  /** Where it's held from: its own pose, or for a hose, the end that's held (which doesn't turn). */
  private heldPose(h: Held): Pose {
    if (h.kind === 'flask') return h.f.pose;
    if (h.kind === 'tool') return h.t.pose;
    if (h.kind === 'scale') return h.sc.pose;
    return { ...(h.end === 'outlet' ? h.h.outlet : h.h.inlet), yaw: 0 };
  }

  /** Put what's held at a pose, with whatever goes along with it. */
  private placeHeld(h: Held, p: Pose): void {
    if (h.kind === 'flask') h.f.pose = p;
    else if (h.kind === 'tool') h.t.pose = p;
    else if (h.kind === 'scale') {
      h.sc.pose = p;
      this.settle();
    } else {
      const at = { x: p.x, y: p.y, z: p.z };
      if (h.end === 'both') {
        // the outlet trails off to the funnel's right, as the player sees it
        Object.assign(h.h.inlet, at);
        Object.assign(h.h.outlet, toWorld({ ...at, yaw: this.player.yaw + h.relYaw }, { x: 70, y: -30, z: 0 }));
      } else Object.assign(h.h[h.end], at);
    }
  }

  /** Where what's held would be, in front of the eyes. */
  private gripPose(h: Held): Pose {
    const eye = this.eye();
    const d = this.lookDir();
    const yaw = h.kind === 'hose' ? 0 : wrapAngle(this.player.yaw + h.relYaw);
    const off = toWorld({ x: 0, y: 0, z: 0, yaw }, this.anchor(h));
    return { x: eye.x + d.x * h.dist - off.x, y: eye.y + d.y * h.dist - off.y, z: eye.z + d.z * h.dist - off.z, yaw };
  }

  /** The box of what's held (a hose held by both ends: its funnel's). */
  private heldBox(h: Held): Box {
    if (h.kind === 'flask') return flaskBox(h.f);
    if (h.kind === 'tool') return toolBox(h.t);
    if (h.kind === 'scale') return scaleBox(h.sc, true);
    return hoseEndBox(h.h, h.end === 'outlet' ? 'outlet' : 'inlet');
  }

  /** Where the box of what's held would be with it at pose p. */
  private boxAt(h: Held, p: Pose): Box {
    const c = toWorld(p, this.anchor(h));
    return { ...this.heldBox(h), ...c, yaw: p.yaw };
  }

  /** The pose what's held would have for its box to be at b. */
  private poseForBox(h: Held, b: Box): Pose {
    const off = toWorld({ x: 0, y: 0, z: 0, yaw: b.yaw }, this.anchor(h));
    return { x: b.x - off.x, y: b.y - off.y, z: b.z - off.z, yaw: wrapAngle(b.yaw) };
  }

  /** The walls, counters, and everything in the room but what's held (and what rides on it). */
  private obstacles(h: Held | null): Box[] {
    const room = roomBoxes(ROOM);
    const counters = COUNTERS.map((c) => ({
      x: (c.x0 + c.x1) / 2, y: LIFT / 2, z: (c.z0 + c.z1) / 2, yaw: 0, hx: (c.x1 - c.x0) / 2, hy: LIFT / 2, hz: (c.z1 - c.z0) / 2,
    }));
    const riders = h?.kind === 'scale' ? new Set(h.sc.load.map((l) => l.f)) : new Set<Flask>();
    const out: Box[] = [...room, ...counters];
    for (const f of this.flasks) if (!(h?.kind === 'flask' && h.f === f) && !riders.has(f)) out.push(flaskBox(f));
    for (const t of this.tools) if (!(h?.kind === 'tool' && h.t === t)) out.push(toolBox(t));
    for (const sc of this.scales) if (!(h?.kind === 'scale' && h.sc === sc)) out.push(scaleBox(sc));
    for (const hose of this.hoses)
      for (const end of ['inlet', 'outlet'] as const)
        if (!(h?.kind === 'hose' && h.h === hose && (h.end === end || h.end === 'both'))) out.push(hoseEndBox(hose, end));
    return out;
  }

  private eyeHeight(): number {
    return EYE + (CROUCH_EYE - EYE) * this.player.crouch;
  }

  private eye(): Vec3 {
    return { x: this.player.x, y: this.eyeHeight(), z: this.player.z };
  }

  /** The way the player looks, as a unit vector. */
  private lookDir(): Vec3 {
    const { yaw, pitch } = this.player;
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  }

  /* ---------------- input ---------------- */

  /** Capture the mouse to look around (the browser lets go of it on Escape). */
  lock(): void {
    if (TOUCH) {
      // a touch screen has no mouse to capture: the sticks walk and look
      this.locked = true;
      return;
    }
    if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  /**
   * Push one of the on-screen sticks (on a touch screen) to (x, y), each from −1 to 1, x right and y down; (0, 0)
   * lets go of it. The move stick walks as far as it's pushed (up is forward); the look stick turns the view.
   */
  stick(which: 'move' | 'look', x: number, y: number): void {
    this.sticks[which] = { x, y };
  }

  /* On a touch screen, the on-screen buttons stand in for the keys and the right button (see TouchControls). */

  /** Where a pointer event happened on the canvas, in CSS pixels. */
  private screenPt(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** E: pick up what the crosshair is on, or let go of what's held. */
  touchGrab(): void {
    if (this.locked) this.grabOrRelease();
  }

  /** F: flip the tool held or looked at. */
  touchFlip(): void {
    if (this.locked) this.flipTarget();
  }

  /** Backspace: put away what's held. */
  touchPutAway(): void {
    if (this.locked) this.putAway();
  }

  /** C, held or let go. */
  touchCrouch(on: boolean): void {
    this.crouchHeld = on;
  }

  /**
   * The right button, pressed or let go: it pours, lets fluid out, or turns the valve looked at; with the pencil in
   * hand, touches on the view erase while it's held.
   */
  hand(down: boolean): void {
    if (!down) {
      this.rightHeld = false;
      this.turning = null;
    } else if (this.pencil) this.rightHeld = true;
    else if (this.locked) this.rightDown();
  }

  /** A finger dragged (dx, dy) pixels on the right button's stand-in: while a valve turns, it moves the aim. */
  handDrag(dx: number, dy: number): void {
    if (this.turning) this.look(dx, dy, false);
  }

  /** Shift and the mouse, and the wheel: a drag across turns what's held, and up holds it further, down nearer. */
  turnHeld(dx: number, dy: number): void {
    const h = this.held;
    if (!h) return;
    h.relYaw = wrapAngle(h.relYaw - dx * TURN_SENS);
    h.dist = this.clampDist(h, h.dist * Math.exp(-dy * 0.004));
  }

  private bindInput(): void {
    const c = this.canvas;
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener));
    };
    const onLock = () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) {
        this.keys.clear();
        this.rightHeld = false;
        this.turning = null;
        this.tarePress = null;
      }
    };
    document.addEventListener('pointerlockchange', onLock);
    this.cleanups.push(() => document.removeEventListener('pointerlockchange', onLock));
    // with the pencil in hand on a touch screen, the finger is the pencil's point, and erases while the right
    // button's stand-in is held
    on(c, 'pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.pencil || !this.locked) return;
      this.lastTouch = performance.now();
      this.cursor = this.screenPt(e);
      const at = this.wallAt();
      if (at) this.pencilDown(at, this.rightHeld ? 2 : 0);
      c.setPointerCapture(e.pointerId);
    });
    on(c, 'pointermove', (e) => {
      if (e.pointerType !== 'touch' || !this.paperDrag) return;
      this.lastTouch = performance.now();
      this.cursor = this.screenPt(e);
      const at = this.wallAt();
      if (at) this.pencilMove(at);
    });
    const touchUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !this.paperDrag) return;
      this.lastTouch = performance.now();
      this.pencilUp(this.wallAt());
    };
    on(c, 'pointerup', touchUp);
    on(c, 'pointercancel', touchUp);
    on(c, 'mousedown', (e) => {
      if (this.pencil && performance.now() - this.lastTouch < 1000) return;
      if (!this.locked) {
        if (e.button === 0) this.lock();
        return;
      }
      e.preventDefault();
      if (this.pencil) {
        const at = this.wallAt();
        if (at) this.pencilDown(at, e.button);
        return;
      }
      if (e.button === 0) this.leftDown();
      if (e.button === 2) this.rightDown();
    });
    on(window, 'mouseup', (e) => {
      if (this.pencil && performance.now() - this.lastTouch < 1000) return;
      if (this.paperDrag) {
        this.pencilUp(this.wallAt());
        return;
      }
      if (e.button === 0) this.tarePress = null;
      if (e.button === 2) {
        this.rightHeld = false;
        this.turning = null;
      }
    });
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => {
      if (this.locked) this.look(e.movementX, e.movementY, e.shiftKey);
    });
    on(c, 'wheel', (e) => {
      e.preventDefault();
      if (!this.held) return;
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      this.held.dist = this.clampDist(this.held, this.held.dist * Math.exp(-px * 0.0012));
    });
    on(window, 'keydown', (e) => {
      if (typingIn(e.target) || !this.locked || e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyE') this.grabOrRelease();
      if (e.code === 'KeyF') this.flipTarget();
      if (e.code === 'KeyP') this.setPencil(!this.pencil);
      const item = HOTKEY_CODES.indexOf(e.code);
      if (item >= 0) {
        this.spawn(ITEMS[item]);
        e.preventDefault();
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        this.putAway();
        e.preventDefault();
      }
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
  }

  private clampDist(h: Held, d: number): number {
    const b = this.heldBox(h);
    const r = Math.hypot(b.hx, b.hz);
    return Math.max(r + HOLD_NEAR, Math.min(r + HOLD_FAR, d));
  }

  /** The mouse moved by (dx, dy) pixels: aim a valve's lever, turn what's held (with Shift), or look around. */
  private look(dx: number, dy: number, shift: boolean): void {
    if (this.pencil) {
      // the pointer moves, and pushed past the edge of the view, turns it
      const c = this.cursor;
      const x = c.x + dx;
      const y = c.y + dy;
      c.x = Math.max(0, Math.min(this.viewW, x));
      c.y = Math.max(0, Math.min(this.viewH, y));
      const p = this.player;
      p.yaw = wrapAngle(p.yaw - (x - c.x) * LOOK_SENS);
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - (y - c.y) * LOOK_SENS));
      const at = this.wallAt();
      if (at) this.pencilMove(at);
      return;
    }
    if (this.turning) {
      const a = this.turning.aim;
      a.x = Math.max(0, Math.min(this.viewW, a.x + dx));
      a.y = Math.max(0, Math.min(this.viewH, a.y + dy));
      this.aimTurning();
      return;
    }
    if (shift && this.held) {
      this.held.relYaw = wrapAngle(this.held.relYaw - dx * TURN_SENS);
      return;
    }
    const p = this.player;
    p.yaw = wrapAngle(p.yaw - dx * LOOK_SENS);
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - dy * LOOK_SENS));
  }

  /** Point the lever of the valve being turned at where the aim is, on the tool's front face. */
  private aimTurning(): void {
    const tr = this.turning;
    if (!tr || !this.viewW) return;
    const { t, k, aim } = tr;
    const { o, d } = this.view.ray((aim.x / this.viewW) * 2 - 1, 1 - (aim.y / this.viewH) * 2);
    const n = { x: Math.sin(t.pose.yaw), y: 0, z: Math.cos(t.pose.yaw) };
    const p0 = onTool(t, 0, 0, valveZ(t));
    const dn = d.x * n.x + d.z * n.z;
    if (Math.abs(dn) < 1e-3) return;
    const s = ((p0.x - o.x) * n.x + (p0.z - o.z) * n.z) / dn;
    if (s <= 0) return;
    const l = toLocal(t.pose, { x: o.x + d.x * s, y: o.y + d.y * s, z: o.z + d.z * s });
    aimValve(t, k, l.x, -l.y);
  }

  private grabOrRelease(): void {
    if (this.held) {
      this.release();
      return;
    }
    const p = this.target;
    if (!p) return;
    let h: Held;
    if (p.kind === 'faucet') return;
    if (p.kind === 'tool' && p.t.shape.fixed) {
      this.say('That stays where it is');
      return;
    }
    if (p.kind === 'flask') {
      for (const sc of this.scales) sc.remove(p.f);
      h = { kind: 'flask', f: p.f, relYaw: 0, dist: 0 };
    } else if (p.kind === 'tool') h = { kind: 'tool', t: p.t, relYaw: 0, dist: 0 };
    else if (p.kind === 'scale') h = { kind: 'scale', sc: p.sc, relYaw: 0, dist: 0 };
    else h = { kind: 'hose', h: p.h, end: p.end, relYaw: 0, dist: 0 };
    h.relYaw = h.kind === 'hose' ? 0 : wrapAngle(this.heldPose(h).yaw - this.player.yaw);
    // it comes to the player's hands, as far as it can
    h.dist = this.clampDist(h, this.holdDist(h));
    this.held = h;
  }

  /** Let go of what's held: an arm comes down to hold it where it is, or a flask let go over a scale stands on it. */
  private release(): void {
    const h = this.held;
    if (!h) return;
    if (h.kind === 'flask') {
      h.f.tilt = 0;
      for (const sc of this.scales) {
        const dx = scaleSpot(sc, h.f.pose);
        if (dx === null) continue;
        sc.put(h.f, dx);
        this.settle();
        break;
      }
    }
    if (h.kind === 'hose' && h.end === 'both') h.end = 'inlet';
    this.held = null;
  }

  /** Flip the tool being held, or else the one looked at (see flip), if it's one that can be flipped. */
  private flipTarget(): void {
    const t = this.held?.kind === 'tool' ? this.held.t : this.target?.kind === 'tool' ? this.target.t : null;
    if (t) flip(t);
  }

  private leftDown(): void {
    const p = this.target;
    if (p?.kind === 'tool' && p.part === 'button') {
      const t = p.t;
      if (t.kind === 'receptacle') {
        if (t.press()) {
          this.beepers.get(t)?.stop();
          this.beepers.set(t, beeper(this.hear(this.machineAt(t))));
        }
      } else if (t.scan()) this.rumbles.set(t, rumble(this.hear(this.machineAt(t))));
      return;
    }
    if (p?.kind === 'scale' && p.part === 'tare') {
      p.sc.zero();
      this.tarePress = p.sc;
      return;
    }
    // a double-click on anything that can be carried writes a note about it; in god mode a flask or tank opens the
    // editor instead, which has a field for its label
    const id = this.targetNote();
    const now = performance.now();
    if (id && id === this.lastClick.id && now - this.lastClick.at < DOUBLE_MS) {
      this.lastClick = { at: 0, id: '' };
      document.exitPointerLock();
      if (this.god && /^(f\d+|t\d+\.\d+)$/.test(id)) this.cb.onEdit(id);
      else this.cb.onLabel(id);
      return;
    }
    this.lastClick = { at: now, id: id ?? '' };
  }

  /**
   * The id of the note (see note) for what the crosshair is on: a hose by either end; a tool, by the tank looked at,
   * or the one tank it has, or else its own note; a flask; a scale; or a faucet.
   */
  private targetNote(): string | null {
    const p = this.target;
    if (!p) return null;
    if (p.kind === 'flask') return `f${this.flasks.indexOf(p.f)}`;
    if (p.kind === 'tool') {
      const t = p.t;
      if (p.part === 'tank') return `t${t.id}.${p.k}`;
      return t.tanks.length === 1 ? `t${t.id}.0` : `t${t.id}`;
    }
    if (p.kind === 'scale') return `s${this.scales.indexOf(p.sc)}`;
    if (p.kind === 'hose') return `h${this.hoses.indexOf(p.h)}`;
    return `F${p.i}`;
  }

  private rightDown(): void {
    this.rightHeld = true;
    if (this.held) return;
    const k = this.valveAimed();
    if (!k) return;
    this.turning = { ...k, aim: { x: this.viewW / 2, y: this.viewH / 2 } };
    this.aimTurning();
  }

  /**
   * The valve the crosshair is on, or within VALVE_REACH of on its tool's front face (see valveNear), if any. Where
   * valves crowd together, the nearest.
   */
  private valveAimed(): { t: Tool; k: number } | null {
    const p = this.target;
    if (p?.kind !== 'tool' || p.t.shape.noValve) return null;
    if (p.part === 'valve') return { t: p.t, k: p.k };
    const l = toLocal(p.t.pose, p.point);
    const k = valveNear(p.t, l.x, -l.y);
    return k === null ? null : { t: p.t, k };
  }

  /** For checks in a browser: stand somewhere, look somewhere, and act as if the mouse were captured. */
  debug(p: Partial<{ x: number; z: number; yaw: number; pitch: number; locked: boolean }>): void {
    const { locked, ...rest } = p;
    Object.assign(this.player, rest);
    if (locked !== undefined) this.locked = locked;
  }

  /* ---------------- sticky notes ---------------- */

  /** Whether the pencil is in hand (see setPencil). */
  get pencilOn(): boolean {
    return this.pencil;
  }

  /**
   * Pick the pencil up or put it down. While it's in hand, the mouse moves a pointer instead of the view (turning the
   * view only when pushed past its edge), and the left button marks out a new sticky note on bare back wall, draws on
   * a note, moves one by its top strip, resizes one by its bottom right corner, or throws one away by the × at its top
   * right; a click on a note types a line of text there (or edits the line clicked); and the right button erases.
   */
  setPencil(on: boolean): void {
    if (on === this.pencil) return;
    this.pencil = on;
    this.paperDrag = null;
    this.turning = null;
    this.cursor = { x: this.viewW / 2, y: this.viewH / 2 };
    if (!on) this.cb.onPaperText(null);
    this.cb.onPencil(on);
  }

  /**
   * Where the pencil points on the back wall, where sticky notes go, as a point on the old flat bench (x across, y down
   * in world units, as paper.ts works in); null if it isn't pointing at the wall.
   */
  private wallAt(): Point | null {
    if (!this.viewW) return null;
    const { o, d } = this.view.ray((this.cursor.x / this.viewW) * 2 - 1, 1 - (this.cursor.y / this.viewH) * 2);
    if (d.z >= -1e-6) return null;
    const s = (PAPER_Z - o.z) / d.z;
    const x = o.x + d.x * s;
    const y = o.y + d.y * s;
    if (x < ROOM.x0 || x > ROOM.x1 || y < 0 || y > ROOM.y1) return null;
    return { x, y: -y };
  }

  /** A sticky note's top left corner, on the old flat bench (see wallAt). */
  private paperXY(pa: Paper): Point {
    const p = fromFrac({ x: pa.fx, y: pa.fy });
    return { x: p.x, y: -p.y };
  }

  /** A point on the old flat bench (see wallAt), as fractions of its home area. */
  private flatToFrac(p: Point): Point {
    return toFrac({ x: p.x, y: -p.y, z: 0 });
  }

  /** A point on the old flat bench, on a sticky note, from its top left corner. */
  private onPaper(pa: Paper, p: Point): Point {
    const o = this.paperXY(pa);
    return { x: p.x - o.x, y: p.y - o.y };
  }

  /** The sticky note under p, the one on top first. */
  private paperAt(p: Point): Paper | null {
    for (let i = this.papers.length - 1; i >= 0; i--) {
      const q = this.onPaper(this.papers[i], p);
      if (q.x >= 0 && q.y >= 0 && q.x <= this.papers[i].w && q.y <= this.papers[i].h) return this.papers[i];
    }
    return null;
  }

  private raisePaper(pa: Paper): void {
    this.papers.splice(this.papers.indexOf(pa), 1);
    this.papers.push(pa);
  }

  private pencilDown(p: Point, button: number): void {
    if (button === 2) {
      this.paperDrag = { kind: 'erase' };
      this.pencilMove(p);
      return;
    }
    if (button !== 0) return;
    const pa = this.paperAt(p);
    if (!pa) {
      this.paperDrag = { kind: 'new', from: p };
      return;
    }
    this.raisePaper(pa);
    const q = this.onPaper(pa, p);
    const right = q.x >= pa.w - PAPER_HANDLE;
    if (right && q.y <= PAPER_HANDLE) {
      this.papers.splice(this.papers.indexOf(pa), 1);
      this.cb.onPaperText(null);
    } else if (right && q.y >= pa.h - PAPER_HANDLE) this.paperDrag = { kind: 'resize', paper: pa };
    else if (q.y <= PAPER_HEADER) this.paperDrag = { kind: 'move', paper: pa, off: q };
    else {
      const stroke: number[] = [];
      extend(pa, stroke, q);
      pa.strokes.push(stroke);
      this.paperDrag = { kind: 'draw', paper: pa, stroke, from: p, moved: false };
    }
  }

  private pencilMove(p: Point): void {
    const d = this.paperDrag;
    if (!d) return;
    if (d.kind === 'draw') {
      extend(d.paper, d.stroke, this.onPaper(d.paper, p));
      if (Math.hypot(p.x - d.from.x, p.y - d.from.y) > 3) d.moved = true;
    } else if (d.kind === 'move') {
      const at = this.flatToFrac({ x: p.x - d.off.x, y: p.y - d.off.y });
      d.paper.fx = at.x;
      d.paper.fy = at.y;
    } else if (d.kind === 'resize') {
      const q = this.onPaper(d.paper, p);
      d.paper.w = Math.max(PAPER_MIN.w, q.x);
      d.paper.h = Math.max(PAPER_MIN.h, q.y);
    } else if (d.kind === 'erase') {
      const pa = this.paperAt(p);
      if (pa) eraseAt(pa, this.onPaper(pa, p));
    }
  }

  private pencilUp(p: Point | null): void {
    const d = this.paperDrag;
    this.paperDrag = null;
    if (d?.kind === 'draw' && !d.moved) {
      // a click, not a stroke: type there, or edit the line clicked
      d.paper.strokes.splice(d.paper.strokes.indexOf(d.stroke), 1);
      const q = this.onPaper(d.paper, d.from);
      const i = textAt(d.paper, q);
      const t = d.paper.texts[i];
      document.exitPointerLock();
      this.cb.onPaperText(t ? { paper: d.paper, index: i, x: t.x, y: t.y } : { paper: d.paper, index: -1, x: q.x, y: q.y + PAPER_TEXT / 2 });
    } else if (d?.kind === 'new' && p) {
      const x0 = Math.min(d.from.x, p.x);
      const y0 = Math.min(d.from.y, p.y);
      const w = Math.abs(p.x - d.from.x);
      const h = Math.abs(p.y - d.from.y);
      if (w >= PAPER_MIN.w && h >= PAPER_MIN.h) {
        const at = this.flatToFrac({ x: x0, y: y0 });
        this.papers.push(new Paper(at.x, at.y, w, h));
      }
    }
  }

  /** The text a line on a sticky note being typed starts with: what's there already, if it's an old one. */
  paperText(edit: PaperEdit): string {
    return edit.index >= 0 ? (edit.paper.texts[edit.index]?.text ?? '') : '';
  }

  /** Where a line on a sticky note being typed starts (the left end of its baseline), on the canvas in CSS pixels. */
  paperTextSpot(edit: PaperEdit): { x: number; y: number } | null {
    if (!this.papers.includes(edit.paper)) return null;
    const o = this.paperXY(edit.paper);
    return this.view.project({ x: o.x + edit.x, y: -(o.y + edit.y), z: PAPER_Z }, this.viewW, this.viewH);
  }

  /** Keep a line typed on a sticky note: a new one is added, an old one changed, and an empty one rubbed out. */
  writePaperText(edit: PaperEdit, text: string): void {
    const { paper, index } = edit;
    if (!this.papers.includes(paper)) return;
    text = text.trim().slice(0, PAPER_TEXT_MAX);
    if (index >= 0 && paper.texts[index]) {
      if (text) paper.texts[index].text = text;
      else paper.texts.splice(index, 1);
    } else if (text) paper.texts.push({ x: edit.x, y: edit.y, text });
  }

  /** The sticky notes as the view draws them: each sheet's top left corner on the back wall, and a sheet being marked out. */
  private paperFrame(): Frame['papers'] {
    const d = this.paperDrag;
    const p = d?.kind === 'new' ? this.wallAt() : null;
    return {
      sheets: this.papers.map((paper) => ({ paper, at: this.paperXY(paper) })),
      pencil: this.pencil,
      draft: d?.kind === 'new' && p ? { x0: Math.min(d.from.x, p.x), y0: Math.min(d.from.y, p.y), x1: Math.max(d.from.x, p.x), y1: Math.max(d.from.y, p.y) } : null,
    };
  }

  /* ---------------- layout ---------------- */

  private layout(): void {
    this.viewW = this.stage.clientWidth;
    this.viewH = this.stage.clientHeight;
    this.view.resize(this.viewW, this.viewH, Math.min(2, window.devicePixelRatio || 1));
  }

  /** Where a note (see note for its id) is written, on the canvas in CSS pixels, for its editor. */
  labelSpot(id: string): { x: number; y: number } | null {
    const p = this.noteAt(id);
    if (!p) return null;
    return this.view.project(p, this.viewW, this.viewH) ?? { x: this.viewW / 2, y: this.viewH / 2 };
  }

  /** Where a sound at p in the room is heard from. */
  private hear(p: Vec3): Placement {
    const h = this.view.toHead(p);
    return placement(h.x, h.y, h.z);
  }

  /** Where a tool's machinery sounds from: the middle of its cabinet. */
  private machineAt(t: Tool): Vec3 {
    return onTool(t, 0, 60);
  }

  /* ---------------- fluid ---------------- */

  private vessels(): Vessel[] {
    return [...this.flasks, ...this.tools.flatMap((t) => [...t.tanks, ...t.tube]), ...this.hoses.map((h) => h.funnel)];
  }

  /**
   * Every vessel holding fluid, with how exposed that fluid is to the room (see exposure): how deep it stands, and
   * how wide on average, as it's shown, taking the flat outline its shape is built from. A flask fills its wide base
   * first; a tank fills straight up, a funnel from its narrow stem; a pipette fills its tube, then its cup; a sump
   * fills first; a heater's tube holds a shallow stream along its floor.
   */
  private exposures(): [Vessel, number][] {
    const out: [Vessel, number][] = [];
    const share = (v: Vessel) => Math.min(1, volume(v) / v.cap);
    for (const f of this.flasks) {
      if (f.N <= 0) continue;
      const h = FLASK_H + fillLevel(0, share(f));
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
      // its funnel is 28 across at the mouth, 8 at the bottom, and 12 deep
      const { h, w } = taper(share(hose.funnel), 12, 8, 28);
      if (hose.funnel.N > 0) out.push([hose.funnel, exposure(h, w)]);
    }
    return out;
  }

  /** Every open top that falling fluid can land in. A flask tipped to pour has none. */
  private mouths(): Mouth[] {
    const out: Mouth[] = [];
    for (const f of this.flasks) if (f.tilt < 0.05) out.push(flaskMouth(f));
    for (const t of this.tools) if (!t.lidded) t.tanks.forEach((_, k) => out.push(tankMouth(t, k)));
    for (const h of this.hoses) out.push(hoseMouth(h));
    return out;
  }

  /** Where something falling from p stops: the first open top under it, or else the floor or counter. */
  private landsAt(p: Vec3, mouths: readonly Mouth[]): number {
    const m = mouthBelow(mouths, p);
    return m ? m.y : groundAt(p.x, p.z);
  }

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

  /**
   * Whatever of v's contents, mixed, no longer fits spills over its rim, falling into the first open top
   * below (which may overflow in turn), or down the sink. A vessel with no rim (a flask tipped to pour)
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

  /* ---------------- main loop ---------------- */

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.move(dt);
    this.view.look(this.eye(), this.player.yaw, this.player.pitch);
    // a hose held by one end can't pick up its other end
    if (!this.turning) this.target = this.view.pick(REACH, this.held?.kind === 'hose' ? this.held.h : this.heldObject());
    this.simulate(dt);
    this.render(dt);
    this.inspect(now);
    this.hud(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Walk, crouch, and carry: what's held follows the eyes, stopping short of whatever's in its way. */
  private move(dt: number): void {
    const p = this.player;
    const k = this.keys;
    const { move, look } = this.sticks;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - move.y;
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + move.x;
    // the look stick turns the view at a rate, gently near its middle so small turns can be aimed
    if (look.x || look.y) {
      p.yaw = wrapAngle(p.yaw - look.x * Math.abs(look.x) * STICK_TURN * dt);
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - look.y * Math.abs(look.y) * STICK_TILT * dt));
    }
    const crouching = k.has('KeyC') || this.crouchHeld;
    p.crouch = Math.max(0, Math.min(1, p.crouch + (crouching ? 1 : -1) * dt * 5));
    const h = this.held;
    const obstacles = this.obstacles(h);
    let load = h ? this.heldBox(h) : null;
    if (fwd || side) {
      // keys walk at full speed whichever way; the move stick as far as it's pushed
      const len = Math.hypot(fwd, side);
      const sp = (WALK * dt * Math.min(1, len)) / len;
      const dx = (-Math.sin(p.yaw) * fwd + Math.cos(p.yaw) * side) * sp;
      const dz = (-Math.cos(p.yaw) * fwd - Math.sin(p.yaw) * side) * sp;
      const body = { x: p.x, z: p.z, r: PLAYER_R, y0: 0, y1: this.eyeHeight() + 20 };
      const r = walk(body, load, dx, dz, obstacles);
      p.x = r.player.x;
      p.z = r.player.z;
      if (h && r.load) {
        this.placeHeld(h, this.poseForBox(h, r.load));
        load = r.load;
      }
    }
    if (!h || !load) return;
    // what's held goes toward where it'd be in front of the eyes, the short way round
    const want = this.boxAt(h, this.gripPose(h));
    want.yaw = load.yaw + wrapAngle(want.yaw - load.yaw);
    this.placeHeld(h, this.poseForBox(h, moveBox(load, want, obstacles)));
    if (h.kind === 'flask') {
      const goal = this.rightHeld ? POUR_ANG : 0;
      const step = (POUR_ANG * dt) / TIP_S;
      h.f.tilt = h.f.tilt < goal ? Math.min(goal, h.f.tilt + step) : Math.max(goal, h.f.tilt - step);
    }
  }

  /** The thing the player holds, as the view knows it (a hose end's point, for a hose held by one end). */
  private heldObject(): object | null {
    const h = this.held;
    if (!h) return null;
    if (h.kind === 'flask') return h.f;
    if (h.kind === 'tool') return h.t;
    if (h.kind === 'scale') return h.sc;
    return h.end === 'both' ? h.h : h.h[h.end];
  }

  private simulate(dt: number): void {
    this.spills.clear();
    this.inflow.clear();
    this.landed = [];
    this.pour = null;
    const simDt = dt * this.speed;
    const mouths = (this.open = this.mouths());
    const h = this.held;

    // the held flask, tipped all the way, pours from its lip into whatever's below
    const D = h?.kind === 'flask' && this.rightHeld && h.f.tilt >= POUR_ANG * 0.97 ? h.f : null;
    if (D && simDt > 0) {
      const from = flaskLip(D);
      this.pour = { from, into: mouthBelow(mouths, from) };
    }

    // each faucet fills whatever is right under it
    this.faucetFlows = [];
    for (const fa of this.faucets) {
      fa.output = faucetOutput(fa.start, this.chem); // cheap, and follows edits to the chemistry
      const m = faucetTarget(mouths, fa.spout, FAUCET_REACH);
      if (m && simDt > 0) this.faucetFlows.push({ fa, m });
    }

    const scanFrom = this.tools.map((t) => t.scanAge);
    const cycleFrom = this.tools.map((t) => t.cycle && { ...t.cycle });
    const vessels = this.vessels();
    // how exposed each one's fluid is to the room, from how it stands now; it hardly changes in a frame
    const exposures = simDt > 0 ? this.exposures() : [];
    if (simDt > 0) {
      const sub = Math.ceil(simDt / 0.02);
      const step = simDt / sub;
      const spouts = this.tools.map((t) => t.shape.spouts.map((_, j) => spoutAt(t, j)));
      const targets = spouts.map((sps) => sps.map((sp) => mouthBelow(mouths, sp)));
      const outlets = this.hoses.map((hose) => hose.outlet);
      const hoseTargets = outlets.map((sp) => mouthBelow(mouths, sp));
      // a fast flow streams straight into what's below (overflowing it if it's full); a slow one gathers
      // in a drop, which falls on its own time
      const pour = (drop: Vessel, out: Vessel | null, sp: Vec3, target: Mouth | null): boolean => {
        const down = drip(drop, out, step);
        if (down && down === out) {
          if (target) this.stream(target.v, out);
        } else if (down) this.falling.push({ v: down, x: sp.x, y: sp.y, z: sp.z, vy: 0 });
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
      // a held tool or hose lets nothing out without the right button
      const stillTool = !this.rightHeld && h?.kind === 'tool' && h.t.shape.spouts.length ? h.t : null;
      const stillHose = !this.rightHeld && h?.kind === 'hose' ? h.h : null;
      for (let i = 0; i < sub; i++) {
        if (D && this.pour) {
          const out = new Vessel(Infinity);
          transfer(D, out, POUR_RATE * step);
          if (this.pour.into) this.stream(this.pour.into.v, out);
        }
        for (const { fa, m } of this.faucetFlows) this.stream(m.v, fa.output, FILL_RATE * step);
        this.tools.forEach((t, j) => {
          if (t === stillTool) return;
          t.step(step).forEach((out, k) => {
            tally(toolTotals[j][k], out, false); // before pouring, which can gather it into a drop
            tally(toolTotals[j][k], null, pour(t.drops[k], out, spouts[j][k], targets[j][k]));
          });
        });
        this.hoses.forEach((hose, j) => {
          if (hose === stillHose) return;
          const out = hose.step(step);
          tally(hoseTotals[j], out, false);
          tally(hoseTotals[j], null, pour(hose.drop, out, outlets[j], hoseTargets[j]));
        });
        // falling drops land in the first open top they pass, or go down the sink
        this.falling = this.falling.filter((d) => {
          const from = d.y;
          d.vy += GRAVITY * step;
          d.y -= d.vy * step;
          const m = mouthBelow(mouths, { x: d.x, y: from, z: d.z });
          const lands = !!m && m.y >= d.y;
          if (lands) {
            this.fill(m!.v, d.v);
            this.landed.push({ x: d.x, y: m!.y, z: d.z });
          }
          return !lands && d.y > groundAt(d.x, d.z);
        });
        for (const v of vessels) {
          this.chem.step(v, step);
          // by molecules, breaking bonds swells a fluid, and whatever no longer fits spills
          this.overflow(v);
        }
        for (const [v, e] of exposures) cool(v, e, step);
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
        r.stop(); // done, put away, or the lab was replaced
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
        b.stop(); // done, or the lab was replaced
        this.beepers.delete(t);
      }

    // fluid's sounds, each heard from where it lands: a stream from the mouth it runs into
    const streams = new Map<Vessel, { flow: number; full: number; at: Placement }>();
    for (const [v, amount] of this.inflow) {
      const m = this.open.find((mo) => mo.v === v);
      streams.set(v, { flow: amount / simDt, full: volume(v) / v.cap, at: m ? this.hear(m) : CENTER });
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
  }

  private render(dt: number): void {
    const mouths = this.open;
    const streams: Frame['streams'][number][] = [];
    for (const t of this.tools)
      t.out.forEach((out, k) => {
        if (!out || !t.streaming[k]) return;
        const sp = spoutAt(t, k);
        streams.push({ from: sp, toY: this.landsAt(sp, mouths), fluid: out, flow: t.flow[k] });
      });
    for (const hose of this.hoses)
      if (hose.out && hose.streaming)
        streams.push({ from: hose.outlet, toY: this.landsAt(hose.outlet, mouths), fluid: hose.out, flow: hose.flow });
    for (const { at, v } of this.spills.values())
      if (v.N > TRACE) streams.push({ from: at, toY: this.landsAt(at, mouths), fluid: v, flow: volume(v) / (MAX_FLOW * this.spillTime) });
    for (const { fa, m } of this.faucetFlows) streams.push({ from: fa.spout, toY: m.y, fluid: fa.output, flow: FILL_RATE / CAP });
    const h = this.held;
    if (this.pour && h?.kind === 'flask' && h.f.N > TRACE)
      streams.push({ from: this.pour.from, toY: this.pour.into?.y ?? groundAt(this.pour.from.x, this.pour.from.z), fluid: h.f, flow: POUR_RATE / CAP });
    const drops: Frame['drops'][number][] = [];
    for (const t of this.tools) t.drops.forEach((v, k) => drops.push({ at: spoutAt(t, k), v, hanging: true }));
    for (const hose of this.hoses) drops.push({ at: hose.outlet, v: hose.drop, hanging: true });
    for (const d of this.falling) drops.push({ at: d, v: d.v, hanging: false });
    const shake = new Map<Tool, number>();
    if (this.speed > 0) for (const t of this.tools) if (t.scanning) shake.set(t, scanLevel(t.scanAge) * 2.5);
    this.view.render({
      eye: this.eye(), yaw: this.player.yaw, pitch: this.player.pitch,
      flasks: this.flasks, tools: this.tools, scales: this.scales, hoses: this.hoses, faucets: this.faucets,
      held: this.heldObject(), standing: this.standing(), streams, drops,
      tarePress: this.tarePress, hot: this.target, shake, dt, delivered: this.delivered, papers: this.paperFrame(),
    });
    if (this.firstFrame) {
      // everything starts held, rather than every arm snapping down at once
      this.view.settleArms();
      this.firstFrame = false;
    }
  }

  /** The vessel the info panel is showing: what's held, if it's a flask, or else the flask or tank looked at. */
  private inspectTarget(): Vessel | null {
    const h = this.held;
    if (h?.kind === 'flask') return h.f;
    const p = this.target;
    if (p?.kind === 'flask') return p.f;
    if (p?.kind === 'tool' && p.part === 'tank') return p.t.tanks[p.k];
    return null;
  }

  private inspect(now: number): void {
    const f = this.locked ? this.inspectTarget() : null;
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
      if (atoms > CAP * 1e-4) rows.push({ species: s, atoms });
    }
    rows.sort((a, b) => b.atoms - a.atoms);
    const cx = this.viewW / 2;
    const cy = this.viewH / 2;
    this.cb.onInspect({
      brief: !this.god, color: f.N > TRACE ? fluidColor(f) : null,
      T: temperature(f), volume: volume(f), cap: f.cap, unit: volumeUnit(), rows,
      // beside the crosshair
      x0: cx - 40, x1: cx + 40, y: cy - 30, stageW: this.viewW, stageH: this.viewH,
    });
  }

  /** Whether the right button would do something now (see Hud.right). */
  private rightWouldDo(): boolean {
    if (this.rightHeld) return false;
    const h = this.held;
    if (h?.kind === 'flask') return h.f.N > TRACE;
    if (h?.kind === 'tool') {
      const t = h.t;
      const free = t.kind === 'splitter' || t.kind === 'sorter' || t.kind === 'heater' || t.kind === 'meter';
      const drains = (k: number) => free || t.valves[k] > 0;
      // a heater's tube runs whatever its valves say
      return (t.shape.spouts.length > 0 && t.tanks.some((v, k) => v.N > TRACE && drains(k))) || t.tube.some((v) => v.N > TRACE);
    }
    if (h?.kind === 'hose') return h.h.funnel.N > TRACE;
    return !this.pencil && !!this.valveAimed();
  }

  private hud(now: number): void {
    if (this.flash && now > this.flash.until) this.flash = null;
    const p = this.target;
    const h = this.held;
    const hud: Hud = {
      locked: this.locked,
      grab: !this.held && !!p && p.kind !== 'faucet' && !(p.kind === 'tool' && p.t.shape.fixed),
      holding: !!this.held,
      press:
        (p?.kind === 'tool' && p.part === 'button' && !(p.t.kind === 'receptacle' ? p.t.cycle : p.t.scanning)) ||
        (p?.kind === 'scale' && p.part === 'tare'),
      right: this.rightWouldDo(),
      aim: this.pencil ? { ...this.cursor } : this.turning ? { ...this.turning.aim } : null,
      pencil: this.pencil,
      flip: !!(h?.kind === 'tool' ? h.t : !h && p?.kind === 'tool' ? p.t : null)?.shape.flippable,
      hand: this.pencil ? 'Erase' : h?.kind === 'flask' ? 'Pour' : h ? 'Flow' : 'Turn',
      note: this.flash?.text ?? null,
    };
    const key = JSON.stringify(hud);
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.cb.onHud(hud);
  }
}

export type { ToolKind };
