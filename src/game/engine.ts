import { equilibrate } from '../chem/equilibrium';
import { temperature, type Fluid, type NetReaction, type ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { POD, WAKE_S, airlockBoxes, ease, inPod, outOfAirlock, type Wake } from './airlock';
import { hushAlarms } from './ambience';
import { beeper, type Beeper } from './beeper';
import {
  FLASK_CENTER, NOZZLE_H, SCALE_ANCHOR, SCALE_SLOTS, STAND_MAX, aimValve, flaskBox, flaskLip, flaskMouth, flip, nozzleBox, nozzleStand,
  onBench, onGrid, onScale, onTool, scaleBox, scaleCenter, scaleSpot, spoutAt, spoutNear, standBase, tankMouth, tankNoteY, toolAnchor,
  toolBox, toolCenter, toolStands, valveNear, valveZ, type Stand,
} from './bodies';
import { CAP, FILL_RATE, GOAL_TARGET, HOME_H, HOME_W, N_FLASKS, POUR_RATE, TRACE } from './config';
import { cool, exposure, taper } from './cooling';
import { FAUCETS, faucetIndex, faucetOutput, faucetTarget } from './faucets';
import { FLASK_H, FLASK_OUTLINE, areaBelow, fillLevel } from './flaskShape';
import { Flask, Vessel, fluidColor, roomFor, transfer, volume, volumeUnit, type Point } from './flask';
import { boxesOverlap, moveBox, roomBoxes, walk, type Box } from './physics';
import { CENTER, placement, type Placement } from './place';
import { DEFAULT_PRESET, METER_AT, REFERENCE_FILL, SPECTROMETER_AT, STATION_POSE, applyFill, type Preset, type Spot } from './presets';
import { rumble, type Rumble } from './rumble';
import { loadChem, loadVessel, saveChem, saveVessel, type SaveState } from './save';
import { Scale, glassGrams } from './scale';
import {
  CELL, COUNTERS, LIFT, PAPER_Z, ROOM, SPIN, Z_HOME, counterUnder, dist3, fromFrac, groundAt, toCardinal, toFrac, toLocal, toWorld, wrapAngle,
  type Pose, type Vec3,
} from './space';
import {
  HEATER, HEATER_CELLS, HEATER_TUBE, Hose, MAX_FLOW, RECEPTACLE_TIMES, SCAN_LIGHTS, SHAPES, STATION, SUMP_TIP, TANK_H, TOOL_NAMES,
  Tool, UNIQUE_TOOLS, aimAt, cupFillHeight, type HoseMount, drip, mouthBelow, sameMount, scanLevel, sumpFillHeight, tankX, type Mouth,
  type ToolKind,
} from './tools';
import { typingIn } from './typing';
import {
  PAPER_HANDLE, PAPER_HEADER, PAPER_MIN, PAPER_TEXT, PAPER_TEXT_MAX, Paper, eraseAt, extend, loadPaper, savePaper,
  textAt,
} from './paper';
import { View, type AirlockLook, type FaucetSpot, type Frame, type GuideLook, type Pick } from './view';
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
  /** Whether the player is still shut in the cryopod, waking (see Wake), where the message inside it says what to do. */
  inPod: boolean;
  /** Whether E would pick up what the crosshair is on. */
  grab: boolean;
  /** Whether something is being held. */
  holding: boolean;
  /** Whether E would set down what's held: whether there's somewhere for it to rest (see placement). */
  drop: boolean;
  /** Whether the left button would press the key or button the crosshair is on, or do something with a hose. */
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
  /** Everything the player can do just now besides walking and looking, with how (see Action), for a reminder. */
  actions: Action[];
}

/**
 * Something the player can do just now: the keys or buttons that do it, pressed together, and what it does, in a few
 * words. Keys are named as on the keyboard; 'LMB' and 'RMB' are the mouse's left and right buttons, 'LMB2' a
 * double-click, 'Wheel' its wheel and '←→' moving it across. `off` if it can't be done here, though it could elsewhere.
 */
export interface Action {
  keys: string[];
  does: string;
  off?: boolean;
}

export interface EngineCallbacks {
  /** The cryostabilizer reference holds GOAL_TARGET of the target. */
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
  /** OK was pressed on the message inside the cryopod: the player is awake. */
  onAwake(): void;
}

/**
 * An outlet lined up with a mouth below it (see GameEngine.aims): whether fluid from it would land there (a hit) or
 * just miss, and which of them is held: the outlet, a held flask's lip (as it would pour), or the mouth.
 */
interface Aim {
  from: Vec3;
  m: Mouth;
  hit: boolean;
  held: 'outlet' | 'lip' | 'mouth';
}

/** Where something let go of comes to rest (see GameEngine.rest): its pose, and for a flask, the scale it stands on. */
interface Rest {
  pose: Pose;
  scale?: { sc: Scale; dx: number };
}

/** What the player is holding. A hose is held by its nozzle. */
type Held = (
  | { kind: 'flask'; f: Flask }
  | { kind: 'tool'; t: Tool }
  | { kind: 'scale'; sc: Scale }
  | { kind: 'hose'; h: Hose }
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
export const ITEMS = ['flask', 'dispenser', 'pipette', 'exchanger', 'separator', 'splitter', 'sorter', 'heater', 'scale', 'tank'] as const;
export type Item = (typeof ITEMS)[number];
/** The key that makes each item, in ITEMS order: along the number row, 1 to 9, then 0. */
export const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
/** The same keys, as KeyboardEvent codes, so they work whatever the keyboard layout's shift state. */
const HOTKEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];

/** How tipped a flask held to pour is: past the horizontal, mouth down. */
const POUR_ANG = Math.PI * 0.61;
/** How long a flask takes to tip to pour, or stand back up, in real seconds. */
const TIP_S = 0.3;
/** How far across, in world units, an outlet can miss a mouth by and still show a faint guide to it (see guides). */
const GUIDE_NEAR = 40;
/** How fast a falling drop speeds up, in world units per sim second squared: a 500-unit fall takes 0.7 s. */
const GRAVITY = 2000;
/** The player's eyes, standing and crouching; their body's radius; and how fast they walk, per real second. */
const EYE = 620;
const CROUCH_EYE = 330;
const PLAYER_R = 45;
/** Walking speed, in world units per real second. */
const WALK = 840;
/** How far away something can be and still be picked up or pressed. */
const REACH = 460;
/** The nearest and furthest something can be held, from the eyes to its middle, beyond its own size. */
const HOLD_NEAR = 40;
/** How much further off than other things a flask is held to start with (see holdDist). */
const FLASK_HOLD = 1.7;
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
/**
 * Where the faucets are: along the right wall over its counter, a grid cell apart, each spout over the middle of a
 * cell of the counter's one row (see CELL, SINK_D). Their spouts are a little under eye level, high enough over the
 * counter for a flask on a scale (whose mouth is 112 up) to go under one, at the foot of a neck FAUCET_NECK long.
 */
const FAUCET_Y = LIFT + 160;
const FAUCET_NECK = 30;
const FAUCET_Z0 = 3.5 * CELL;
const FAUCET_GAP = CELL;
const FAUCET_OUT = CELL / 2;
/** How long a note stays up, in ms. */
const NOTE_MS = 1600;
/** A flask's outline's area, in local units squared, for how exposed its fluid is (see exposures). */
const FLASK_AREA = areaBelow(FLASK_OUTLINE, 0);
/** Width of the stem a funnel-shaped tank narrows to, in local units. */
const FUNNEL_STEM = 6;

/** Where a tool stands, in the room, from a preset's spot for it. */
const spotPose = (s: Spot): Pose => ({ ...fromFrac({ x: s.at[0], y: s.at[1] }, s.z), yaw: s.yaw ?? 0 });

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
  private player = { x: 480, z: 380, yaw: 0, pitch: -0.08, crouch: 0 };
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
  /** The faucets pouring into something this frame: where from (the faucet, or its hose's nozzle), and into what. */
  private faucetFlows: { fa: FaucetSpot; from: Vec3; m: Mouth }[] = [];
  /** Where the held flask poured this frame, if it did: its lip, and what it poured into (null: the sink). */
  private pour: { from: Vec3; into: Mouth | null } | null = null;
  /** Where what's held would come to rest if let go, as of the last frame drawn (see placement). */
  private placed: ReturnType<GameEngine['placement']> | null = null;
  /** What the crosshair is on. */
  private target: (Pick & { point: Vec3; distance: number }) | null = null;
  /** A brief note on the display, like there being no room for something (see say). */
  private flash: { text: string; until: number } | null = null;
  private lastClick = { at: 0, id: '' };
  private won = false;
  /** Whether the alarms are silenced, by the button under the beacon (see hushAlarms). Saved, and kept through Reset. */
  private alarmsOff = false;
  /** Whether the porthole's blinds are shut, by the button beside it. Saved, and kept through Reset. */
  private blindsShut = false;
  /** Where the player is in waking up in the airlock (see Wake), and how many sim seconds it's been there. */
  private wake: Wake = 'closed';
  /** How far the ship has turned, in radians (see SPIN), for the stars. */
  private spin = 0;
  private wakeT = Infinity;
  /** The cryostabilizer station's sounds, through its cycle (see Tool.press). */
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
        wall: { x: ROOM.x1 - 14, y: FAUCET_Y + FAUCET_NECK, z },
        output: faucetOutput(start, chem),
        note: '',
      };
    });
    this.view = new View(canvas, this.faucets, EYE);
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
    // there's only one of a unique tool, so it needs no number
    const nth = UNIQUE_TOOLS.includes(tool.kind) ? '' : ` ${this.tools.filter((t) => t.kind === tool.kind && t.id <= tool.id).length}`;
    const tank = tool.tanks.length > 1 ? ` ${tool.shape.tanks[k].name}` : '';
    const label = tool.tanks[k].label ? ` (${tool.tanks[k].label})` : '';
    return { vessel: tool.tanks[k], title: `${TOOL_NAMES[tool.kind]}${nth}${tank}${label}` };
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
   * tank), a tool's own note (`t2`; only a tool with more than one tank has one), a scale's (`s1`) or a faucet's
   * (`F5`), by index. Things are replaced on reset and load, so look this up each time.
   */
  note(id: string): { text: string; set(text: string): void } | null {
    const label = (o: { label: string } | undefined) => o && { text: o.label, set: (s: string) => void (o.label = s) };
    const note = (o: { note: string } | undefined) => o && { text: o.note, set: (s: string) => void (o.note = s) };
    const tank = /^t(\d+)\.(\d+)$/.exec(id);
    if (tank) return label(this.tools.find((t) => t.id === +tank[1])?.tanks[+tank[2]]) ?? null;
    const m = /^([fFst])(\d+)$/.exec(id);
    if (!m) return null;
    const i = +m[2];
    const found =
      m[1] === 'f' ? label(this.flasks[i])
      : m[1] === 't' ? note(this.tools.find((t) => t.id === i && t.tanks.length > 1))
      : m[1] === 's' ? note(this.scales[i])
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
      return onTool(t, tankX(t.shape.tanks[k]), tankNoteY(t, k));
    }
    const m = /^([fFst])(\d+)$/.exec(id);
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
      f.pose = { x: (i + 0.5) * CELL, y: LIFT + FLASK_H, z: Z_HOME, yaw: 0 };
      f.glass = glassGrams(i);
      applyFill(f, preset.flasks[i] ?? null);
      return f;
    });
    this.scales = (preset.scales ?? []).map(([fx, fy]) => new Scale({ ...fromFrac({ x: fx, y: fy }), yaw: 0 }));
    this.nextToolId = preset.tools?.length ?? 0;
    this.tools = (preset.tools ?? []).map((spec, i) => {
      const t = new Tool(spec.kind, i, spotPose(spec), spec.valves);
      spec.tanks?.forEach((fill, k) => t.tanks[k] && applyFill(t.tanks[k], fill));
      return t;
    });
    this.uniqueTools();
    this.hoses = (preset.hoses ?? []).map(({ from, to }) => {
      const m = tankMouth(this.tools[to.tool], to.tank ?? 0);
      return new Hose({ tool: this.tools[from.tool], spout: from.spout }, { x: m.x, y: m.y + (to.up ?? 24), z: m.z });
    });
    this.restAll();
    this.afterLoad();
  }

  private afterLoad(): void {
    this.won = false;
    for (const b of this.beepers.values()) b.stop();
    this.beepers.clear();
    this.falling = [];
    this.held = this.turning = this.tarePress = null;
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
        outlet: { ...toFrac(h.outlet), z: h.outlet.z, yaw: h.turn },
        on: 'tool' in h.on ? { tool: h.on.tool.id, spout: h.on.spout } : { faucet: h.on.faucet },
      })),
      // where they started on the old flat bench, so the save still loads there, with their notes
      faucets: this.faucets.map((fa, i, all) => ({ x: (i + 0.5) / all.length, y: 30 / HOME_H, ...(fa.note ? { note: fa.note } : {}) })),
      ...(this.alarmsOff ? { alarmsOff: true } : {}),
      ...(this.blindsShut ? { blindsShut: true } : {}),
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
    this.oldStation(s);
    this.scales = s.scales.map((ss) => {
      const sc = new Scale(pose(fromFrac({ x: ss.fx, y: ss.fy }), ss));
      sc.tare = ss.tare ?? 0;
      if (typeof ss.note === 'string') sc.note = ss.note;
      for (const { f, dx } of ss.load ?? []) if (this.flasks[f]) sc.put(this.flasks[f], dx);
      return sc;
    });
    // a hose on a spout or a faucet; older saves' hoses whose funnels hung under one become its, and the rest are
    // gone, with whatever was in their funnels
    const fs = s.faucets ?? [];
    this.hoses = [];
    for (const sh of s.hoses) {
      const on = sh.on;
      if (!on || !sh.outlet) continue;
      const fa = Number.isInteger(on.faucet) ? faucetIndex(on.faucet!, fs.length) : null;
      const t = this.tools.find((u) => u.id === on.tool);
      const mount: HoseMount | null =
        t && Number.isInteger(on.spout) && on.spout! >= 0 && on.spout! < t.shape.spouts.length ? { tool: t, spout: on.spout! }
        : fa !== null ? { faucet: fa }
        : null;
      if (!mount || this.hoses.some((h) => sameMount(h.on, mount))) continue;
      const o = sh.outlet;
      const h = new Hose(mount, this.inRoom({ ...fromFrac(o), z: num(o.z, Z_HOME) }));
      h.turn = num(o.yaw, 0);
      this.hoses.push(h);
    }
    for (const fa of this.faucets) fa.note = '';
    fs.forEach((f, i) => {
      const j = faucetIndex(i, fs.length);
      if (j !== null && typeof f?.note === 'string') this.faucets[j].note = f.note;
    });
    this.setAlarmsOff(!!s.alarmsOff);
    this.blindsShut = !!s.blindsShut;
    this.papers = (Array.isArray(s.papers) ? s.papers : []).map(loadPaper).filter((p): p is Paper => !!p);
    this.paperDrag = null;
    this.cb.onPaperText(null);
    const pl = s.player;
    if (pl && [pl.x, pl.z, pl.yaw, pl.pitch].every(Number.isFinite)) {
      const p = this.inRoom({ x: pl.x, y: 0, z: pl.z, yaw: pl.yaw });
      Object.assign(this.player, { x: p.x, z: p.z, yaw: pl.yaw, pitch: pl.pitch });
    }
    this.restAll();
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
   * meter and a cryostabilizer station: if there's none, one is added where it starts, the station's reference holding
   * what's left on board (see REFERENCE_FILL). The station is built into the wall, so it's always where it is.
   */
  private uniqueTools(): void {
    for (const kind of UNIQUE_TOOLS) {
      const first = this.tools.find((t) => t.kind === kind);
      this.tools = this.tools.filter((t) => t.kind !== kind || t === first);
    }
    const add = (kind: ToolKind, at: Pose) => {
      if (this.tools.some((t) => t.kind === kind)) return;
      const t = new Tool(kind, this.nextToolId++, at);
      if (kind === 'receptacle') applyFill(t.tanks[2], REFERENCE_FILL);
      this.tools.push(t);
    };
    add('spectrometer', spotPose(SPECTROMETER_AT));
    add('meter', spotPose(METER_AT));
    add('receptacle', STATION_POSE);
    this.station().pose = { ...STATION_POSE };
  }

  /** The cryostabilizer station (see STATION): there's always exactly one. */
  private station(): Tool {
    return this.tools.find((t) => t.kind === 'receptacle')!;
  }

  /**
   * A save from before the cryostabilizer station had a tester and the reference (when the receptacle stood on an
   * island and flushed what it took away, counting it as delivered, and the reference was a tool of its own) gets the
   * station's reference filled with what its reference held, or what it started with if it had none, plus what it had
   * delivered.
   */
  private oldStation(s: SaveState): void {
    const saved = s.tools.find((st) => st.kind === 'receptacle');
    if (saved && (saved.tanks?.length ?? 0) >= SHAPES.receptacle.tanks.length) return;
    const ref = this.station().tanks[2];
    const old = s.tools.find((st) => (st.kind as string) === 'reference')?.tanks?.[0];
    if (old) loadVessel(ref, old);
    else applyFill(ref, REFERENCE_FILL);
    const delivered = Number.isFinite(s.delivered) ? Math.max(0, s.delivered!) : 0;
    ref.setMolecules(TARGET, ref.n[TARGET] + Math.round(delivered / roomFor(TARGET)));
  }

  /**
   * Set everything that stands on the bench (flasks, scales, and tools like the spectrometer) down on the counter
   * under it, if there is one, and stand each flask on a scale where the scale now is. Presets and older saves leave
   * things in the air, where arms from the ceiling used to hold them.
   */
  private restAll(): void {
    this.toGrid();
    const riders = this.standing();
    const down = (b: Box, move: (dy: number) => void) => {
      const top = counterUnder(b);
      const dy = top === null ? 0 : b.y - b.hy - top;
      if (dy > 0) move(dy);
    };
    for (const f of this.flasks) if (!riders.has(f)) down(flaskBox(f), (dy) => (f.pose = { ...f.pose, y: f.pose.y - dy }));
    for (const sc of this.scales) down(scaleBox(sc), (dy) => (sc.pose = { ...sc.pose, y: sc.pose.y - dy }));
    for (const t of this.tools) if (onBench(t)) down(toolBox(t), (dy) => (t.pose = { ...t.pose, y: t.pose.y - dy }));
    this.settle();
  }

  /**
   * Put everything on the grid (see onGrid), as it would be set down: presets and older saves can leave things
   * anywhere. A tool or a hose's nozzle whose stand that leaves off the counter (as one an older save left near the
   * back wall can be) comes forward a cell or two, as it faces, until its stand is on it. A flask on a scale goes to
   * the nearer of its places, or off it if the other flask there has it.
   */
  private toGrid(): void {
    const onCounter = (t: Tool) => toolStands(t).every((st) => counterUnder(standBase(st, 0)) !== null);
    for (const t of this.tools) {
      if (t.shape.wall) continue;
      t.pose = onGrid(t.pose, toolAnchor(t));
      for (let i = 0; i < 2 && !onCounter(t); i++) t.pose = { ...toWorld(t.pose, { x: 0, y: 0, z: CELL }), yaw: t.pose.yaw };
    }
    for (const sc of this.scales) {
      sc.pose = onGrid(sc.pose, SCALE_ANCHOR);
      const load = sc.load.splice(0);
      for (const { f, dx } of load) {
        const slot = dx < 0 ? SCALE_SLOTS[0] : SCALE_SLOTS[1];
        if (!sc.load.some((l) => l.dx === slot)) sc.put(f, slot);
      }
    }
    const riders = this.standing();
    for (const f of this.flasks) if (!riders.has(f)) f.pose = onGrid(f.pose);
    for (const h of this.hoses) {
      h.turn = toCardinal(h.turn);
      const g = onGrid({ ...h.outlet, yaw: 0 });
      h.outlet = { x: g.x, y: g.y, z: g.z };
      for (let i = 0; i < 2 && counterUnder(standBase(nozzleStand(h.outlet, h.turn), 0)) === null; i++)
        h.outlet = toWorld({ ...h.outlet, yaw: h.turn }, { x: 0, y: 0, z: CELL });
    }
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
   * Make a new flask, tool or scale in the player's grip, facing them, if there's room for it there and
   * their hands are free. Returns whether it did.
   */
  spawn(kind: Item): boolean {
    if (inPod(this.wake)) return false;
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
    if (held.kind === 'tool') {
      this.nextToolId++;
      this.tools.push(held.t);
    }
    this.held = held;
    return true;
  }

  /**
   * Put away whatever's held, unless it's one of a kind: a tool with the hoses pulled out of its spouts, and a hose's
   * nozzle rolled back up into its spout or faucet.
   */
  private putAway(): void {
    const h = this.held;
    if (!h) return;
    if (h.kind === 'tool' && UNIQUE_TOOLS.includes(h.t.kind)) {
      this.say("Can't put that away");
      return;
    }
    if (h.kind === 'flask') this.flasks.splice(this.flasks.indexOf(h.f), 1);
    if (h.kind === 'tool') {
      this.tools.splice(this.tools.indexOf(h.t), 1);
      this.hoses = this.hoses.filter((hose) => !('tool' in hose.on && hose.on.tool === h.t));
    }
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
   * A hose's nozzle's box doesn't turn, so for one this is straight up.
   */
  private anchor(h: Held): Vec3 {
    if (h.kind === 'flask') return FLASK_CENTER;
    if (h.kind === 'tool') return toolCenter(h.t);
    if (h.kind === 'scale') return scaleCenter(h.sc);
    return { x: 0, y: NOZZLE_H / 2, z: 0 };
  }

  /**
   * How far in front of the eyes something is held to start with: just clear of the player, with room to see it; a
   * flask, which is small, further off, so it isn't in the player's face.
   */
  private holdDist(h: Held): number {
    const b = this.heldBox(h);
    return (Math.hypot(b.hx, b.hz) + 90) * (h.kind === 'flask' ? FLASK_HOLD : 1);
  }

  /** Where it's held from: its own pose, or for a hose, its nozzle's tip (which doesn't turn). */
  private heldPose(h: Held): Pose {
    if (h.kind === 'flask') return h.f.pose;
    if (h.kind === 'tool') return h.t.pose;
    if (h.kind === 'scale') return h.sc.pose;
    return { ...h.h.outlet, yaw: 0 };
  }

  /** Put what's held at a pose, with whatever goes along with it. */
  private placeHeld(h: Held, p: Pose): void {
    if (h.kind === 'flask') h.f.pose = p;
    else if (h.kind === 'tool') h.t.pose = p;
    else if (h.kind === 'scale') {
      h.sc.pose = p;
      this.settle();
    } else h.h.outlet = { x: p.x, y: p.y, z: p.z };
  }

  /**
   * Where what's held would be, in front of the eyes: facing the nearest way along the grid to how it's turned from
   * the player, so it turns in quarter turns.
   */
  private gripPose(h: Held): Pose {
    const eye = this.eye();
    const d = this.lookDir();
    const yaw = h.kind === 'hose' ? 0 : toCardinal(this.player.yaw + h.relYaw);
    const off = toWorld({ x: 0, y: 0, z: 0, yaw }, this.anchor(h));
    return { x: eye.x + d.x * h.dist - off.x, y: eye.y + d.y * h.dist - off.y, z: eye.z + d.z * h.dist - off.z, yaw };
  }

  /** The box of what's held (a hose's nozzle's, for a hose). */
  private heldBox(h: Held): Box {
    if (h.kind === 'flask') return flaskBox(h.f);
    if (h.kind === 'tool') return toolBox(h.t);
    if (h.kind === 'scale') return scaleBox(h.sc, true);
    return nozzleBox(h.h);
  }

  /** Where the box of what's held would be with it at pose p. */
  private boxAt(h: Held, p: Pose): Box {
    const c = toWorld(p, this.anchor(h));
    return { ...this.heldBox(h), ...c, yaw: h.kind === 'flask' ? 0 : p.yaw };
  }

  /** The pose what's held would have for its box to be at b. */
  private poseForBox(h: Held, b: Box): Pose {
    const off = toWorld({ x: 0, y: 0, z: 0, yaw: b.yaw }, this.anchor(h));
    return { x: b.x - off.x, y: b.y - off.y, z: b.z - off.z, yaw: wrapAngle(b.yaw) };
  }

  /**
   * The walls, counters, and everything in the room but what's held (and what rides on it), including the bases of
   * the stands holding up everything else (unless `bases` is false).
   */
  private obstacles(h: Held | null, bases = true): Box[] {
    // while the airlock's doors are open, its doorway and chamber take the front wall's place
    const room = this.wake === 'closed' ? roomBoxes(ROOM) : [...roomBoxes(ROOM, false), ...airlockBoxes()];
    const counters = COUNTERS.map((c) => ({
      x: (c.x0 + c.x1) / 2, y: LIFT / 2, z: (c.z0 + c.z1) / 2, yaw: 0, hx: (c.x1 - c.x0) / 2, hy: LIFT / 2, hz: (c.z1 - c.z0) / 2,
    }));
    const riders = h?.kind === 'scale' ? new Set(h.sc.load.map((l) => l.f)) : new Set<Flask>();
    const out: Box[] = [...room, ...counters];
    for (const f of this.flasks) if (!(h?.kind === 'flask' && h.f === f) && !riders.has(f)) out.push(flaskBox(f));
    for (const t of this.tools) if (!(h?.kind === 'tool' && h.t === t)) out.push(toolBox(t));
    for (const sc of this.scales) if (!(h?.kind === 'scale' && h.sc === sc)) out.push(scaleBox(sc));
    for (const hose of this.hoses)
      if (!(h?.kind === 'hose' && h.h === hose)) {
        out.push(nozzleBox(hose));
        if (bases) out.push(standBase(nozzleStand(hose.outlet, hose.turn)));
      }
    if (bases) for (const t of this.tools) if (!(h?.kind === 'tool' && h.t === t)) for (const st of toolStands(t)) out.push(standBase(st));
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
    // a flask is round, so turning it does nothing (see faceFlask)
    if (h.kind !== 'flask') h.relYaw = wrapAngle(h.relYaw - dx * TURN_SENS);
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
        if (e.button !== 0) return;
        // the mouse is free, so it can press OK in the pod where it points, as well as capturing the mouse
        if (this.wake === 'pod') {
          const r = c.getBoundingClientRect();
          const at = this.view.pick(REACH, null, ((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
          if (at?.kind === 'wake') this.pressOk();
        }
        this.lock();
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
      if (typingIn(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      // Enter is OK on the message inside the cryopod, as it was on the notice it replaced
      if (e.code === 'Enter' && this.wake === 'pod') this.pressOk();
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.repeat || inPod(this.wake)) return;
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
      if (this.held.kind !== 'flask') this.held.relYaw = wrapAngle(this.held.relYaw - dx * TURN_SENS);
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
    if (inPod(this.wake)) return;
    if (this.held) {
      this.release();
      return;
    }
    const p = this.target;
    if (!p) return;
    let h: Held;
    if (p.kind === 'faucet' || p.kind === 'alarm' || p.kind === 'blinds' || p.kind === 'wake') return;
    if (p.kind === 'tool' && p.t.shape.fixed) {
      this.say('That stays where it is');
      return;
    }
    if (p.kind === 'flask') {
      for (const sc of this.scales) sc.remove(p.f);
      h = { kind: 'flask', f: p.f, relYaw: 0, dist: 0 };
    } else if (p.kind === 'tool') h = { kind: 'tool', t: p.t, relYaw: 0, dist: 0 };
    else if (p.kind === 'scale') h = { kind: 'scale', sc: p.sc, relYaw: 0, dist: 0 };
    else {
      this.holdHose(p.h);
      return;
    }
    h.relYaw = h.kind === 'flask' ? 0 : wrapAngle(this.heldPose(h).yaw - this.player.yaw);
    // it comes to the player's hands, as far as it can
    h.dist = this.clampDist(h, this.holdDist(h));
    this.held = h;
  }

  /** Take hold of a hose's nozzle, where it is: it's small, and the hose trails behind it, so it isn't brought near. */
  private holdHose(hose: Hose): void {
    const h: Held = { kind: 'hose', h: hose, relYaw: 0, dist: 0 };
    h.dist = this.clampDist(h, dist3(this.eye(), hose.outlet));
    this.held = h;
  }

  /**
   * The spout or faucet the crosshair is on, to pull a hose out of: a faucet's spout or the pipe down to it (not its
   * knob, which is for its note), a tool's spout's tip, or the tool just above it (see spoutNear). Null if it's on
   * neither.
   */
  private mountAimed(): HoseMount | null {
    const p = this.target;
    if (p?.kind === 'faucet') return p.spout ? { faucet: p.i } : null;
    if (p?.kind !== 'tool' || !p.t.shape.spouts.length) return null;
    if (p.part === 'spout') return { tool: p.t, spout: p.k };
    const l = toLocal(p.t.pose, p.point);
    const j = spoutNear(p.t, l.x, -l.y);
    return j === null ? null : { tool: p.t, spout: j };
  }

  /**
   * Pull out the hose of a spout or faucet, and hold its nozzle; or, if it's already out, take hold of its nozzle,
   * wherever it is.
   */
  private pullHose(m: HoseMount): void {
    const old = this.hoses.find((h) => sameMount(h.on, m));
    if (old) return this.holdHose(old);
    const hose = new Hose(m, this.mountAt(m));
    this.hoses.push(hose);
    this.holdHose(hose);
  }

  /** Where the spout or faucet a hose runs from is. */
  private mountAt(m: HoseMount): Vec3 {
    return 'tool' in m ? spoutAt(m.tool, m.spout) : this.faucets[m.faucet].spout;
  }

  /** The hose pulled out of a spout or faucet, if there is one. */
  private hoseOn(m: HoseMount): Hose | undefined {
    return this.hoses.find((h) => sameMount(h.on, m));
  }

  /** Where what leaves a tool's spout comes out: the spout, or the nozzle of its hose if one's pulled out. */
  private outletAt(t: Tool, j: number): Vec3 {
    return this.hoseOn({ tool: t, spout: j })?.outlet ?? spoutAt(t, j);
  }

  /** Where what a faucet pours comes out, the same way. */
  private faucetOutlet(i: number): Vec3 {
    return this.hoseOn({ faucet: i })?.outlet ?? this.faucets[i].spout;
  }

  /**
   * Let go of what's held, if it can be set down (see placement): it comes to rest there, on the grid. If it can't, a
   * note says why, and it stays in hand.
   */
  private release(): void {
    const h = this.held;
    if (!h) return;
    const pl = this.placement(h);
    if (!('rest' in pl)) {
      this.say(pl.why);
      return;
    }
    this.placeHeld(h, pl.rest.pose);
    if (h.kind === 'flask') {
      h.f.tilt = 0;
      if (pl.rest.scale) {
        pl.rest.scale.sc.put(h.f, pl.rest.scale.dx);
        this.settle();
      }
    }
    if (h.kind === 'hose') h.h.turn = toCardinal(this.player.yaw);
    this.held = null;
  }

  /** Flip the tool being held, or else the one looked at (see flip), if it's one that can be flipped. */
  private flipTarget(): void {
    if (inPod(this.wake)) return;
    const t = this.held?.kind === 'tool' ? this.held.t : this.target?.kind === 'tool' ? this.target.t : null;
    if (t) flip(t);
  }

  private leftDown(): void {
    const p = this.target;
    if (p?.kind === 'tool' && p.part === 'button') {
      const t = p.t;
      // the station's sounds start with its cycle, in simulate, since it can start one itself
      if (t.kind === 'receptacle') t.press();
      else if (t.scan()) this.rumbles.set(t, rumble(this.hear(this.machineAt(t))));
      return;
    }
    if (p?.kind === 'wake') {
      this.pressOk();
      return;
    }
    if (inPod(this.wake)) return;
    // a hose's nozzle in hand is set down; with empty hands, a spout or faucet's hose is pulled out, or its nozzle
    // taken hold of if it's out, and so is a nozzle looked at
    if (this.held?.kind === 'hose') {
      this.release();
      return;
    }
    const m = this.held ? null : this.mountAimed();
    if (m) {
      this.pullHose(m);
      return;
    }
    if (!this.held && p?.kind === 'hose') {
      this.holdHose(p.h);
      return;
    }
    if (p?.kind === 'alarm') {
      this.setAlarmsOff(!this.alarmsOff);
      return;
    }
    if (p?.kind === 'blinds') {
      this.blindsShut = !this.blindsShut;
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
   * The id of the note (see note) for what the crosshair is on: a tool, by the tank looked at, or the one tank it has,
   * or else its own note; a flask; a scale; or a faucet. A hose has none.
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
    if (p.kind === 'hose' || p.kind === 'alarm' || p.kind === 'blinds' || p.kind === 'wake') return null;
    return `F${p.i}`;
  }

  private rightDown(): void {
    if (inPod(this.wake)) return;
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
    if (on === this.pencil || (on && inPod(this.wake))) return;
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

  /** Where a tool's machinery sounds from: the middle of its cabinet, or the cryostabilizer station's panel. */
  private machineAt(t: Tool): Vec3 {
    if (t.shape.wall) {
      const p = STATION.panel;
      return onTool(t, (p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, STATION.plate - STATION.out);
    }
    return onTool(t, 0, 60);
  }

  /* ---------------- fluid ---------------- */

  private vessels(): Vessel[] {
    return [...this.flasks, ...this.tools.flatMap((t) => [...t.tanks, ...t.tube])];
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
    return out;
  }

  /** Every open top that falling fluid can land in. A flask tipped to pour has none. */
  private mouths(): Mouth[] {
    const out: Mouth[] = [];
    for (const f of this.flasks) if (f.tilt < 0.05) out.push(flaskMouth(f));
    for (const t of this.tools) t.tanks.forEach((_, k) => t.isOpen(k) && out.push(tankMouth(t, k)));
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
    if (!this.turning) this.target = this.view.pick(REACH, this.heldObject());
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
    // shut in the pod, they can only look
    if (inPod(this.wake)) return;
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
    // what's held goes toward where it'd be in front of the eyes, and then turns there in a quarter turn, all at once,
    // if there's room; a flask's box doesn't turn (see flaskBox): it's turned to face the player after it's moved, below
    const want = this.boxAt(h, this.gripPose(h));
    const turn = h.kind === 'flask' ? 0 : wrapAngle(want.yaw - load.yaw);
    let moved = moveBox(load, { ...want, yaw: load.yaw }, obstacles);
    if (Math.abs(turn) > 1e-9) {
      const turned = { ...moved, yaw: load.yaw + turn };
      if (!obstacles.some((o) => boxesOverlap(turned, o) && !boxesOverlap(moved, o))) moved = turned;
    }
    this.placeHeld(h, this.poseForBox(h, moved));
    if (h.kind === 'flask') {
      this.faceFlask(h.f);
      const goal = this.rightHeld ? POUR_ANG : 0;
      const step = (POUR_ANG * dt) / TIP_S;
      h.f.tilt = h.f.tilt < goal ? Math.min(goal, h.f.tilt + step) : Math.max(goal, h.f.tilt - step);
    }
  }

  /**
   * Turn a held flask to face the player, so that it tips to pour (about its own front-to-back axis) about the
   * level line from the player to it, toward the player's right. A flask is round, so this is all its turn is for.
   */
  private faceFlask(f: Flask): void {
    const p = this.player;
    f.pose = { ...f.pose, yaw: Math.atan2(p.x - f.pose.x, p.z - f.pose.z) };
  }

  /** The thing the player holds, as the view knows it. */
  private heldObject(): object | null {
    const h = this.held;
    if (!h) return null;
    if (h.kind === 'flask') return h.f;
    if (h.kind === 'tool') return h.t;
    if (h.kind === 'scale') return h.sc;
    return h.h;
  }

  private simulate(dt: number): void {
    this.spills.clear();
    this.inflow.clear();
    this.landed = [];
    this.pour = null;
    // the lab waits for the player to press OK in the pod, as it did through the rest of the intro
    const simDt = this.wake === 'pod' ? 0 : dt * this.speed;
    this.spin = (this.spin + SPIN * simDt) % (2 * Math.PI);
    const mouths = (this.open = this.mouths());
    const h = this.held;

    // the held flask, tipped all the way, pours from its lip into whatever's below
    const D = h?.kind === 'flask' && this.rightHeld && h.f.tilt >= POUR_ANG * 0.97 ? h.f : null;
    if (D && simDt > 0) {
      const from = flaskLip(D);
      this.pour = { from, into: mouthBelow(mouths, from) };
    }

    // a held tool, or a hose's nozzle in hand, lets nothing out without the right button: the tool, or the tool or
    // faucet the hose is pulled out of, stops
    let stillTool: Tool | null = null;
    let stillFaucet: number | null = null;
    if (!this.rightHeld && h?.kind === 'tool' && h.t.shape.spouts.length) stillTool = h.t;
    if (!this.rightHeld && h?.kind === 'hose') {
      if ('tool' in h.h.on) stillTool = h.h.on.tool;
      else stillFaucet = h.h.on.faucet;
    }

    // each faucet fills whatever is right under it, or under its hose's nozzle
    this.faucetFlows = [];
    this.faucets.forEach((fa, i) => {
      fa.output = faucetOutput(fa.start, this.chem); // cheap, and follows edits to the chemistry
      const from = this.faucetOutlet(i);
      const m = faucetTarget(mouths, from);
      if (m && simDt > 0 && i !== stillFaucet) this.faucetFlows.push({ fa, from, m });
    });

    const scanFrom = this.tools.map((t) => t.scanAge);
    const cycleFrom = this.tools.map((t) => t.cycle && { ...t.cycle });
    const vessels = this.vessels();
    // how exposed each one's fluid is to the room, from how it stands now; it hardly changes in a frame
    const exposures = simDt > 0 ? this.exposures() : [];
    if (simDt > 0) {
      const sub = Math.ceil(simDt / 0.02);
      const step = simDt / sub;
      // where each spout's fluid comes out: the spout, or its hose's nozzle
      const spouts = this.tools.map((t) => t.shape.spouts.map((_, j) => this.outletAt(t, j)));
      const targets = spouts.map((sps) => sps.map((sp) => mouthBelow(mouths, sp)));
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
      const tally = (tot: { v: Vessel; streamed: boolean }, out: Vessel | null, streamed: boolean) => {
        if (out) tot.v.addFrom(out, volume(out), true);
        tot.streamed ||= streamed;
      };
      for (let i = 0; i < sub; i++) {
        this.stepWake(step);
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

    // the station's cycles go by sim time too, whether its button or a full receptacle started them: a blip for each
    // beep of its thinking that came round this frame, its verdict as the thinking ends, and the rush of a flush into
    // the tester or the reference, silent while paused
    this.tools.forEach((t, j) => {
      const from = cycleFrom[j];
      const c = t.cycle;
      if (c && !from) {
        this.beepers.get(t)?.stop();
        this.beepers.set(t, beeper(this.hear(this.machineAt(t))));
      }
      const b = this.beepers.get(t);
      if (!b) return;
      b.place(this.hear(this.machineAt(t)));
      // how far through the thinking it was at the start of the frame, and is now
      const thought = (cy: Tool['cycle']) => (!cy || cy.phase === 'flush' ? -1 : cy.phase === 'think' ? cy.age : Infinity);
      const [a, z] = [from ? thought(from) : -1, c ? thought(c) : Infinity];
      if (a < Infinity && z > a) {
        for (const beep of t.beeps) if (beep.t > a && beep.t <= z) b.beep(beep.freq);
        if (z === Infinity) b.verdict(t.verdict === 'pass');
      }
      const rush = c?.phase === 'flush' || c?.phase === 'pass';
      b.flush(simDt > 0 && c && rush ? 1 - (0.6 * c.age) / RECEPTACLE_TIMES[c.phase] : 0);
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

    // goal: enough of the target in the cryostabilizer reference
    if (this.station().tanks[2].n[TARGET] >= GOAL_TARGET && !this.won) {
      this.won = true;
      this.cb.onWin();
    }
  }

  /**
   * Each outlet that lines up with one of `mouths`, for the guides: from each outlet of what's held (a flask's lip,
   * tipped as it would be to pour; a tool's spouts; a hose's nozzle) to the mouth it would land in, or would just
   * miss; and the same from every other outlet (spouts, nozzles, faucets) to what's held.
   */
  private aims(h: Held, mouths: readonly Mouth[]): Aim[] {
    // what's held, as outlets and as vessels that can be landed in
    const mine = new Set<Vessel>();
    const outlets: { at: Vec3; lip: boolean }[] = [];
    if (h.kind === 'flask') {
      mine.add(h.f);
      outlets.push({ at: flaskLip(h.f, POUR_ANG), lip: true });
    } else if (h.kind === 'tool') {
      for (const v of h.t.tanks) mine.add(v);
      // a spout with its hose out lets out at the hose's nozzle, which stays where it is (see below)
      h.t.shape.spouts.forEach((_, j) => {
        if (!this.hoseOn({ tool: h.t, spout: j })) outlets.push({ at: spoutAt(h.t, j), lip: false });
      });
    } else if (h.kind === 'scale') for (const { f } of h.sc.load) mine.add(f);
    else outlets.push({ at: h.h.outlet, lip: false });
    const out: Aim[] = [];
    const aim = (from: Vec3, held: Aim['held']) => {
      const a = aimAt(mouths, from, GUIDE_NEAR);
      if (!a || mine.has(a.m.v) !== (held === 'mouth')) return;
      out.push({ from, m: a.m, hit: a.hit, held });
    };
    for (const o of outlets) aim(o.at, o.lip ? 'lip' : 'outlet');
    if (mine.size) {
      for (const t of this.tools)
        t.shape.spouts.forEach((_, j) => {
          const hose = this.hoseOn({ tool: t, spout: j });
          if (hose || !(h.kind === 'tool' && h.t === t)) aim(hose?.outlet ?? spoutAt(t, j), 'mouth');
        });
      this.faucets.forEach((_, i) => aim(this.faucetOutlet(i), 'mouth'));
    }
    return out;
  }

  /**
   * Where what's held would be set down, at pose p: on the grid (see onGrid), facing the nearest way along it, with its
   * mouths and spouts over the middles of cells.
   */
  private gridded(h: Held, p: Pose): Pose {
    if (h.kind === 'tool') return onGrid(p, toolAnchor(h.t));
    if (h.kind === 'scale') return onGrid(p, SCALE_ANCHOR);
    return onGrid(p);
  }

  /**
   * Where what's held would come to rest if let go now (see rest): on the grid (see gridded), in the cell under where
   * it's held. If it can't rest there, why not.
   */
  private placement(h: Held): { rest: Rest } | { why: string } {
    const p = this.heldPose(h);
    const obstacles = this.obstacles(h);
    const solid = this.obstacles(h, false);
    const r = this.rest(h, this.gridded(h, p), obstacles, solid);
    return typeof r === 'string' ? { why: r } : { rest: r };
  }

  /**
   * Where what's held, at pose p, would come to rest if let go, or why it can't. Only squarely on a counter: a flask,
   * a scale or a tool that stands on the bench goes straight down until it stands on the counter under it, which its
   * whole footprint must be over (or a flask over a scale, onto its platform); a tool or hose's nozzle on a stand stays at
   * the height it's held, no higher than its stand reaches, while its stand's base goes down onto the counter, which
   * the whole base must be over (what it holds can reach out past the counter's edge). Either way, it mustn't bump into anything on the way down, nor its stand's base sit
   * on anything but the counter. (Stands don't bump into each other: their rods can stand side by side.)
   */
  private rest(h: Held, p: Pose, obstacles: readonly Box[], solid: readonly Box[]): Rest | string {
    const now = this.heldBox(h);
    // what's in the way of a box, besides whatever what's held is already stuck in
    const blocked = (b: Box) => obstacles.some((o) => boxesOverlap(b, o) && !boxesOverlap(now, o));
    // box `to`, stretched up to the height of box `from`: what it passes through, going straight down
    const span = (to: Box, from: Box): Box => {
      const y0 = Math.min(to.y - to.hy, from.y - from.hy);
      const y1 = Math.max(to.y + to.hy, from.y + from.hy);
      // the whole of it, not just its parts, since its parts don't stretch
      return { ...to, y: (y0 + y1) / 2, hy: (y1 - y0) / 2, parts: undefined };
    };
    const box = this.boxAt(h, p);
    const stands = this.standsAt(h, p);
    if (stands.length) {
      const tops = stands.map((st) => counterUnder(standBase(st, 0)));
      if (tops.some((t) => t === null)) return 'Its stand needs a counter under it';
      const drop = Math.max(0, ...stands.map((st, i) => st.clampY - tops[i]! - STAND_MAX));
      const to = { ...box, y: box.y - drop };
      if (blocked(span(to, box))) return 'No room';
      if (stands.some((st, i) => solid.some((o) => boxesOverlap(standBase(st, tops[i]!), o)))) return 'No room for its stand';
      return { pose: { ...p, y: p.y - drop } };
    }
    if (h.kind === 'flask')
      for (const sc of this.scales) {
        const dx = scaleSpot(sc, p, Infinity);
        if (dx === null) continue;
        const pose = onScale(sc, dx);
        const to = this.boxAt(h, pose);
        return blocked(span(to, { ...to, y: box.y })) ? 'No room' : { pose, scale: { sc, dx } };
      }
    const top = counterUnder(box);
    if (top === null) return 'Set it down on a counter';
    const dy = box.y - box.hy - top;
    const to = { ...box, y: box.y - dy };
    if (blocked(span(to, box))) return 'No room';
    return { pose: { ...p, y: p.y - dy } };
  }

  /** The stands that would hold up what's held, at pose p: none for what stands on the bench. */
  private standsAt(h: Held, p: Pose): Stand[] {
    if (h.kind === 'tool') return toolStands(h.t, p);
    // a hose's nozzle held faces the way along the grid nearest the player's, so its stand is behind it
    return h.kind === 'hose' ? [nozzleStand(p, toCardinal(this.player.yaw))] : [];
  }

  /** Every stand in the lab, with what it holds up. */
  private stands(): { s: Stand; of: Pick }[] {
    const out: { s: Stand; of: Pick }[] = [];
    for (const t of this.tools) for (const s of toolStands(t)) out.push({ s, of: { kind: 'tool', t, part: 'body', k: 0 } });
    const held = this.held;
    for (const h of this.hoses) {
      // one held faces the player (see standsAt)
      const inHand = held?.kind === 'hose' && held.h === h;
      out.push({ s: nozzleStand(h.outlet, inHand ? toCardinal(this.player.yaw) : h.turn), of: { kind: 'hose', h } });
    }
    return out;
  }

  /**
   * Guides for lining up what's held (see aims), shown only while something's held, since that's when things are
   * being lined up: solid where fluid would land in a mouth, faint where it would just miss; and green, as it will be
   * once let go and set down on the grid, wherever fluid would land in a mouth then.
   */
  private guides(pl: ReturnType<GameEngine['placement']> | null): Frame['guides'] {
    const h = this.held;
    if (!h) return [];
    const guide = (a: Aim, look: GuideLook): Frame['guides'][number] => {
      const { x, y, z, hx, hz, yaw = 0 } = a.m;
      return { from: a.from, toY: y, look, mouth: { x, y, z, hx, hz, yaw } };
    };
    const out = this.aims(h, this.open).map((a) => guide(a, a.hit ? 'solid' : 'faint'));
    if (pl && 'rest' in pl) {
      // what it'll line up with once let go: put it there, upright, for a moment, to see
      const at = this.heldPose(h);
      const tilt = h.kind === 'flask' ? h.f.tilt : 0;
      if (h.kind === 'flask') h.f.tilt = 0;
      this.placeHeld(h, pl.rest.pose);
      for (const a of this.aims(h, this.mouths())) if (a.hit && a.held !== 'lip') out.push(guide(a, 'snap'));
      this.placeHeld(h, at);
      if (h.kind === 'flask') h.f.tilt = tilt;
    }
    return out;
  }

  /**
   * Where what's held would come to rest, outlined on the counter: its footprint, or its stands' bases. Outlined in
   * red, under where it is, if it can't be set down there.
   */
  private footprints(pl: ReturnType<GameEngine['placement']> | null): Frame['footprints'] {
    const h = this.held;
    if (!h || !pl) return [];
    const ok = 'rest' in pl;
    const p = ok ? pl.rest.pose : this.heldPose(h);
    const stands = this.standsAt(h, p);
    if (stands.length)
      return stands.map((st) => {
        const b = standBase(st, ok ? (counterUnder(standBase(st, 0)) ?? groundAt(st.x, st.z)) : groundAt(st.x, st.z));
        return { x: b.x, y: b.y - b.hy, z: b.z, hx: b.hx, hz: b.hz, yaw: b.yaw, ok };
      });
    const b = this.boxAt(h, p);
    const y = ok ? b.y - b.hy : groundAt(b.x, b.z);
    return [{ x: b.x, y, z: b.z, hx: b.hx, hz: b.hz, yaw: b.yaw, ok }];
  }

  private render(dt: number): void {
    const mouths = this.open;
    const streams: Frame['streams'][number][] = [];
    for (const t of this.tools)
      t.out.forEach((out, k) => {
        if (!out || !t.streaming[k]) return;
        const sp = this.outletAt(t, k);
        streams.push({ from: sp, toY: this.landsAt(sp, mouths), fluid: out, flow: t.flow[k] });
      });
    for (const { at, v } of this.spills.values())
      if (v.N > TRACE) streams.push({ from: at, toY: this.landsAt(at, mouths), fluid: v, flow: volume(v) / (MAX_FLOW * this.spillTime) });
    for (const { fa, from, m } of this.faucetFlows) streams.push({ from, toY: m.y, fluid: fa.output, flow: FILL_RATE / CAP });
    const h = this.held;
    if (this.pour && h?.kind === 'flask' && h.f.N > TRACE)
      streams.push({ from: this.pour.from, toY: this.pour.into?.y ?? groundAt(this.pour.from.x, this.pour.from.z), fluid: h.f, flow: POUR_RATE / CAP });
    const drops: Frame['drops'][number][] = [];
    for (const t of this.tools) t.drops.forEach((v, k) => drops.push({ at: this.outletAt(t, k), v, hanging: true }));
    for (const d of this.falling) drops.push({ at: d, v: d.v, hanging: false });
    const shake = new Map<Tool, number>();
    if (this.speed > 0) for (const t of this.tools) if (t.scanning) shake.set(t, scanLevel(t.scanAge) * 2.5);
    const pl = (this.placed = h ? this.placement(h) : null);
    // each hose from its spout or faucet to its nozzle, with what's running through it
    const hoses = this.hoses.map((hose) => {
      const on = hose.on;
      const fluid = 'tool' in on ? on.tool.out[on.spout] : (this.faucetFlows.find((f) => f.fa === this.faucets[on.faucet])?.fa.output ?? null);
      return { h: hose, from: this.mountAt(on), fluid };
    });
    this.view.render({
      eye: this.eye(), yaw: this.player.yaw, pitch: this.player.pitch,
      flasks: this.flasks, tools: this.tools, scales: this.scales, hoses, faucets: this.faucets,
      streams, drops,
      tarePress: this.tarePress, hot: this.target, shake, dt, alarmsOff: this.alarmsOff, blindsShut: this.blindsShut, spin: this.spin,
      airlock: this.airlockLook(),
      papers: this.paperFrame(),
      guides: this.guides(pl), footprints: this.footprints(pl), stands: this.stands(),
    });
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
  /** Everything the player can do just now besides walking and looking (see Hud.actions). */
  private actions(): Action[] {
    const out: Action[] = [];
    const add = (keys: string[], does: string, off = false) => out.push(off ? { keys, does, off } : { keys, does });
    // turning a valve takes the mouse over until the button's let go
    if (this.turning) {
      add(['Mouse'], 'point the lever');
      add(['RMB'], 'let go when it’s set');
      return out;
    }
    const p = this.target;
    const h = this.held;
    if (inPod(this.wake)) {
      if (this.wake === 'pod') add(['LMB'], 'OK', p?.kind !== 'wake');
      add(['Esc'], 'let go of the mouse');
      add(['/'], 'hide this list');
      return out;
    }
    if (this.pencil) {
      add(['LMB'], 'drag to draw, or on bare wall to mark out a sheet');
      add(['LMB'], 'click a sheet to type on it');
      add(['RMB'], 'drag to erase');
      add(['P'], 'put the pencil down');
    }
    if (h) {
      const ok = !!this.placed && 'rest' in this.placed;
      const how = h.kind === 'hose' ? 'set the hose’s end down' : 'set it down';
      add(['E'], ok ? how : `${how}: not here`, !ok);
      if (h.kind === 'hose') add(['LMB'], ok ? how : `${how}: not here`, !ok);
      if (!this.pencil && this.rightWouldDo()) add(['RMB'], h.kind === 'flask' ? 'hold to pour' : 'hold to let it flow');
      if (h.kind !== 'flask' && h.kind !== 'hose') add(['Shift', '←→'], 'turn it');
      add(['Wheel'], 'hold it nearer or further');
      if (h.kind === 'tool' && h.t.shape.flippable) add(['F'], 'flip it');
      if (h.kind === 'hose') add(['Backspace'], 'roll the hose back up');
      else if (!(h.kind === 'tool' && UNIQUE_TOOLS.includes(h.t.kind))) add(['Backspace'], 'put it away');
    } else {
      if (p && this.grabbable(p)) add(['E'], 'pick it up');
      if (!this.pencil && this.rightWouldDo()) add(['RMB'], 'hold and point to turn the valve');
      if (p?.kind === 'tool' && p.t.shape.flippable) add(['F'], 'flip it');
      add(['1–0'], 'make equipment in your hands');
    }
    if (!this.pencil) {
      if (p?.kind === 'alarm') add(['LMB'], this.alarmsOff ? 'let the alarms sound again' : 'silence the alarms');
      else if (p?.kind === 'blinds') add(['LMB'], this.blindsShut ? 'open the blinds' : 'shut the blinds');
      else if (this.pressable()) add(['LMB'], 'press it');
      const m = h ? null : this.mountAimed();
      if (m) add(['LMB'], this.hoseOn(m) ? 'take hold of its hose' : 'pull out its hose');
      else if (!h && p?.kind === 'hose') add(['LMB'], 'take hold of it');
      const id = this.targetNote();
      if (id) add(['LMB2'], this.god && /^(f\d+|t\d+\.\d+)$/.test(id) ? 'edit it (god mode)' : 'write a note about it');
      add(['P'], 'pick up the pencil');
    }
    add(['C'], 'crouch');
    add(['Esc'], 'let go of the mouse');
    add(['/'], 'hide this list');
    return out;
  }

  private setAlarmsOff(off: boolean): void {
    this.alarmsOff = off;
    hushAlarms(off);
  }

  /**
   * Whether the left button would do something with a hose: set down the nozzle in hand, if it can be, or with empty
   * hands, pull out the hose of the spout or faucet the crosshair is on, or take hold of it or the nozzle looked at.
   */
  private hoseClick(): boolean {
    if (this.held?.kind === 'hose') return !!this.placed && 'rest' in this.placed;
    return !this.held && (!!this.mountAimed() || this.target?.kind === 'hose');
  }

  /** Whether the left button would press the key or button the crosshair is on. */
  private pressable(): boolean {
    const p = this.target;
    return (
      (p?.kind === 'tool' && p.part === 'button' && !(p.t.kind === 'receptacle' ? p.t.cycle : p.t.scanning)) ||
      (p?.kind === 'scale' && p.part === 'tare') ||
      p?.kind === 'alarm' ||
      p?.kind === 'blinds' ||
      p?.kind === 'wake'
    );
  }

  /** Whether E would pick up `p`: anything but what's fixed in place. */
  private grabbable(p: Pick): boolean {
    return p.kind !== 'faucet' && p.kind !== 'alarm' && p.kind !== 'blinds' && p.kind !== 'wake' && !(p.kind === 'tool' && p.t.shape.fixed);
  }

  /* ---------------- waking in the airlock ---------------- */

  /**
   * Put the player in the cryopod in the airlock, facing the lab through its open doors, with the message on its
   * glass: the intro's last part, the first time and on a replay. They can look around, but nothing else, until
   * they press OK (see pressOk). Whatever they held is set down if it can be, or else put away.
   */
  enterPod(): void {
    if (this.held) this.release();
    if (this.held && !(this.held.kind === 'tool' && UNIQUE_TOOLS.includes(this.held.t.kind))) this.putAway();
    this.held = null;
    this.setPencil(false);
    this.turning = null;
    this.rightHeld = false;
    Object.assign(this.player, { x: POD.x, z: POD.z, yaw: 0, pitch: -0.12, crouch: 0 });
    this.wake = 'pod';
    this.wakeT = 0;
  }

  /** OK, on the message inside the pod: it flickers out, the pod's front slides up, and then the player can walk. */
  private pressOk(): void {
    if (this.wake !== 'pod') return;
    this.wake = 'flicker';
    this.wakeT = 0;
    this.cb.onAwake();
  }

  /** On through waking up, over a sim substep of h seconds (see Wake), like everything else that happens. */
  private stepWake(h: number): void {
    const t = (this.wakeT += h);
    const next = (w: Wake) => {
      this.wake = w;
      this.wakeT = 0;
    };
    if (this.wake === 'flicker' && t >= WAKE_S.flicker) next('opening');
    else if (this.wake === 'opening' && t >= WAKE_S.open) next('out');
    else if (this.wake === 'out' && outOfAirlock(this.player.z, PLAYER_R)) next('closed');
  }

  /** How the airlock looks just now, for the view. */
  private airlockLook(): AirlockLook {
    const w = this.wake;
    const t = this.wakeT;
    // the message flickers, on less and less of the time, until it's gone
    const flick = w === 'flicker' && Math.sin(t * 90) + Math.sin(t * 37) > 2.6 * (t / WAKE_S.flicker) - 0.6;
    return {
      door: w === 'closed' ? 1 - ease(t / WAKE_S.close) : 1,
      front: w === 'opening' ? ease(t / WAKE_S.open) : inPod(w) ? 0 : 1,
      // the room's light floods in as the front slides up
      dark: w === 'opening' ? 1 - ease(t / WAKE_S.open) : inPod(w) ? 1 : 0,
      message: w === 'pod' || flick,
      okHot: w === 'pod' && this.target?.kind === 'wake',
    };
  }

  private rightWouldDo(): boolean {
    if (this.rightHeld) return false;
    const h = this.held;
    if (h?.kind === 'flask') return h.f.N > TRACE;
    if (h?.kind === 'tool') return this.wouldFlow(h.t);
    // a faucet always runs
    if (h?.kind === 'hose') return 'tool' in h.h.on ? this.wouldFlow(h.h.on.tool) : true;
    return !this.pencil && !!this.valveAimed();
  }

  /** Whether fluid would leave a tool's spouts if it ran. */
  private wouldFlow(t: Tool): boolean {
    // the station's reference through its faucet, or the tester out its waste nozzle
    if (t.kind === 'receptacle') return (t.valves[0] > 0 && t.tanks[2].N > TRACE) || !!t.cycle;
    const free = t.kind === 'splitter' || t.kind === 'sorter' || t.kind === 'heater' || t.kind === 'meter';
    const drains = (k: number) => free || t.valves[k] > 0;
    // a heater's tube runs whatever its valves say
    return (t.shape.spouts.length > 0 && t.tanks.some((v, k) => v.N > TRACE && drains(k))) || t.tube.some((v) => v.N > TRACE);
  }

  private hud(now: number): void {
    if (this.flash && now > this.flash.until) this.flash = null;
    const p = this.target;
    const h = this.held;
    const hud: Hud = {
      locked: this.locked,
      grab: !this.held && !!p && this.grabbable(p),
      inPod: inPod(this.wake),
      holding: !!this.held,
      drop: !!this.placed && 'rest' in this.placed,
      press: this.pressable() || this.hoseClick(),
      right: this.rightWouldDo(),
      aim: this.pencil ? { ...this.cursor } : this.turning ? { ...this.turning.aim } : null,
      pencil: this.pencil,
      flip: !!(h?.kind === 'tool' ? h.t : !h && p?.kind === 'tool' ? p.t : null)?.shape.flippable,
      hand: this.pencil ? 'Erase' : h?.kind === 'flask' ? 'Pour' : h ? 'Flow' : 'Turn',
      note: this.flash?.text ?? null,
      actions: this.actions(),
    };
    const key = JSON.stringify(hud);
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.cb.onHud(hud);
  }
}

export type { ToolKind };
