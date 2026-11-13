import { equilibrate } from '../chem/equilibrium';
import { Lag, temperature, type Fluid, type NetReaction, type ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { AIRLOCK, BLINDED_S, POD, RISE_S, SETTLE_S, WAKE_S, airlockBoxes, ease, inPod, outOfAirlock, type Wake } from './airlock';
import { hushAlarms } from './ambience';
import {
  FLASK_CENTER, FLASK_LIP, NOZZLE_H, NOZZLE_REACH, SCALE_ANCHOR, SCALE_SLOTS, STAND_MAX, aimValve, bathAt, dipPoses, dippedIn, footAt, flaskBox, flaskFluid,
  flaskLip, flaskMouth, nozzleBox, tankFluid, docked, nozzleMounts, nozzleStand, onGrid, onScale, onTool, scaleBox, scaleCenter, scaleSpot, snapReach, spoutAt, spoutNear, standBase,
  tankMouth, tankNoteY, toolAnchor, toolBox, toolCenter, toolStands, valveNear, valveZ, type NozzleMount, type Stand,
} from './bodies';
import { CABINET, endless, isStocked, putIn, stockWith, takeFrom, takeSlot, type Stock, type Stocked } from './cabinet';
import { changeover, type ChangeoverSound } from './changeover';
import { chime } from './chime';
import { diverter, type Diverter } from './diverter';
import { CAP, DELIVERY, FILL_RATE, HOME_H, HOME_W, POUR_RATE, TRACE } from './config';
import { cool, exposure, taper } from './cooling';
import { FAUCETS, WALL_FAUCETS, faucetIndex, faucetOutput, faucetTarget } from './faucets';
import { FLASK_H, FLASK_OUTLINE, areaBelow, fillLevel } from './flaskShape';
import { Flask, Vessel, fluidColor, roomFor, sustenance, transfer, volume, volumeUnit } from './flask';
import { History, arrange, arrangement, type Arrangement } from './history';
import { boxesOverlap, roomBoxes, walk, type Box } from './physics';
import { CENTER, placement, type Placement } from './place';
import { ANALYZER_AT, DEFAULT_PRESET, REFERENCE_FILL, SPECTROSCOPE_AT, STATION_POSE, VISUALIZER_AT, applyFill, type Preset, type Spot } from './presets';
import { rumble, type Rumble } from './rumble';
import { CRYOSTABILIZER, FIRST_SUPPLY, litresOf, type Supply } from './supply';
import { shatter } from './shatter';
import { WHEELS, wheelMove, wheelPick, type WheelAim } from './wheel';
import { loadChem, loadVessel, saveChem, saveVessel, type SaveState } from './save';
import { Scale, glassGrams } from './scale';
import { sleep, type Sleeper, type SleepStats, type Woke } from './sleep';
import {
  CELL, COUNTERS, LIFT, ROOM, SPIN, Z_HOME, counterUnder, dist3, fromFrac, groundAt, toCardinal, toFrac, toLocal, toWorld, wrapAngle,
  type Pose, type Vec3,
} from './space';
import {
  changeoverAt, ANALYZER_HUM, BOND_KEYS, INSTRUMENT, HEATER, HEATER_CELLS, HEATER_TUBE, DIVERTER_HOLD, Hose, INLINE_TOOLS, MAX_FLOW, SHAPES, STATION, STRIP_FOOT, SUMP_TIP,
  TANK_H, TOOL_NAMES, isDipper, isThermometer, Tool, UNIQUE_TOOLS, cupFillHeight, type HoseMount, drip, mouthBelow, sameMount, sumpFillHeight, levelIn, spaceOf, tankPieces, tankX,
  type Mouth, type ToolKind,
} from './tools';
import { typingIn } from './typing';
import { ARRIVAL, View, type AirlockLook, type FaucetSpot, type Frame, type GuideLook, type Icons, type Pick } from './view';
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
  /**
   * Whether the left button would do something: press the key or button the crosshair is on, do something with a hose,
   * or set down what's held or pick up what's looked at.
   */
  press: boolean;
  /**
   * Whether the right button would do something: turn the valve looked at, let fluid out of what's held, or dip a held
   * wicking strip or thermometer into what's looked at.
   */
  right: boolean;
  /** While a valve is being turned, where the pointer that aims its lever is, in CSS pixels. */
  aim: { x: number; y: number } | null;
  /** Whether Enter would write a note about what the crosshair is on (see GameEngine.note). */
  label: boolean;
  /** What the right button does now, in a word, for the touch screen's button that stands in for it. */
  hand: 'Pour' | 'Flow' | 'Dip' | 'Turn';
  /** A brief note, like there being no room for something. */
  note: string | null;
  /** Whether the note is a tip, something the player can now do, not something they can't. */
  tip: boolean;
  /** Everything the player can do just now besides walking and looking, with how (see Action), for a reminder. */
  actions: Action[];
  /** How far the screen has faded to black as the player falls asleep in the pod, or wakes, 0 to 1. */
  black: number;
  /** How far the screen has faded to white in the light of Mu Ceti (see Wake's arriving), 0 to 1. */
  white: number;
  /** Whether the game's over, won: the player has arrived at Mu Ceti (see Wake's arrived). */
  ended: boolean;
  /** Whether god mode's preview of the end's white void is up (see GameEngine.previewArrival). */
  preview: boolean;
  /**
   * While an equipment wheel is held open (see wheel.ts): what's on it, in order, where its pointer is, which of them
   * it picks, if any, and which of them there are none left of in the cabinet. Otherwise null.
   */
  wheel: (WheelAim & { items: readonly Stocked[]; pick: number | null; none: boolean[] }) | null;
  /** While the player's asleep in the pod (see Wake) or napping (see GameEngine.nap), the whole sim seconds they've slept; otherwise null. */
  slept: number | null;
  /**
   * While they're asleep, what the station's reservoir is of (see Supply), the litres of it there, to two places, and
   * the litres needed; otherwise null.
   */
  reservoir: { name: string; litres: number; goalL: number } | null;
  /** How far shut the player's eyes are, for a nap (see GameEngine.nap): 0 open, 1 shut. */
  lids: number;
  /** Whether they're napping, their eyes shut: N wakes them. */
  napping: boolean;
  /** Whether N would start a nap just now. */
  nap: boolean;
}

/**
 * Something the player can do just now: the keys or buttons that do it, pressed together, and what it does, in a few
 * words. Keys are named as on the keyboard; 'LMB' and 'RMB' are the mouse's left and right buttons, 'Wheel' its wheel, '←→' moving it across and '↑↓' up and down. `off` if it can't be done here, though
 * it could elsewhere.
 */
export interface Action {
  keys: string[];
  does: string;
  off?: boolean;
}

export interface EngineCallbacks {
  /** Throttled to ~10 Hz; null when nothing is inspected. */
  onInspect(info: Inspection | null): void;
  /** Enter was pressed on a vessel in god mode; look it up with GameEngine.vessel(id). */
  onEdit(id: string): void;
  /** Enter was pressed on something, to write a note about it: the note's id (see GameEngine.note). */
  onLabel(id: string): void;
  /** Whenever the heads-up display changes. */
  onHud(hud: Hud): void;
  /** OK was pressed on the message inside the cryopod: the player is awake. */
  onAwake(): void;
}

/**
 * An outlet lined up with a mouth below it (see GameEngine.aims), which fluid from it would land in, and which of them is
 * held: the outlet, a held flask's lip (as it would pour), or the mouth.
 */
interface Aim {
  from: Vec3;
  m: Mouth;
  held: 'outlet' | 'lip' | 'mouth';
}

/** Where something let go of comes to rest (see GameEngine.rest): its pose, and for a flask, the scale it stands on. */
interface Rest {
  pose: Pose;
  scale?: { sc: Scale; dx: number };
  /** For a hose's nozzle, where its stand goes (see nozzleMounts). */
  hose?: NozzleMount;
  /** Where each hose following what's held would come to rest with it, in Held.follow's order (see followRests). */
  follow?: Rest[];
}

/**
 * A hose whose nozzle pours into something being carried, and so goes along with it (see gather): the vessel it pours
 * into, where its tip is and which way it faces, in the frame of what's carried (see carryFrame); and where it was
 * before, to put it back, or null if it was pulled out for this.
 */
interface Follower {
  hose: Hose;
  into: Vessel;
  off: Vec3;
  turn: number;
  was: { outlet: Vec3; turn: number; reach: number } | null;
}

/** What the player is holding. A hose is held by its nozzle. */
type Held = (
  | { kind: 'flask'; f: Flask }
  | { kind: 'tool'; t: Tool }
  | { kind: 'scale'; sc: Scale }
  /** A hose by its nozzle, with how far behind it its stand is wanted, as the clamp's arm is slid (see snapReach). */
  | { kind: 'hose'; h: Hose; reach: number }
) & {
  /**
   * How far it's turned from facing the player, and how far from their eyes it's held, along `dir`: which way it is
   * from them as they look (x right, y up, z ahead), so it stays where it was picked up, as seen; straight ahead if
   * left out, as for something made in hand.
   */
  relYaw: number;
  dist: number;
  dir?: Vec3;
  /**
   * Where it was picked up from, for Q to put it back (see putBack); none for what was made in hand, or a hose just
   * pulled out.
   */
  from?: Rest;
  /** The hoses pulled out of a tool's spouts as it was picked up (see keepPouring), for Q to roll back up. */
  made?: Hose[];
  /** The hoses pouring into what's carried, which go along with it (see gather). */
  follow?: Follower[];
};

/**
 * The keys that, held, open the equipment wheels (see WHEELS), in their order: let go, the key of the wheel that's
 * open makes what its pointer picks.
 */
const WHEEL_CODES = ['Digit1', 'Digit2'];
/** Those keys, as they're named for the player. */
const WHEEL_KEYS = ['1', '2'];

/** How tipped a flask held to pour is: past the horizontal, mouth down. */
const POUR_ANG = Math.PI * 0.61;
/** How long a flask takes to tip to pour, or stand back up, in real seconds. */
const TIP_S = 0.3;
/**
 * A held flask poured into what the crosshair is on (see pourPose) goes with its lip over the mouth's middle, at
 * least POUR_GAP above it, and as much higher as it has to, up to POUR_RISE, to clear everything.
 */
const POUR_GAP = 20;
const POUR_RISE = 300;
/** How far above a mouth, at least, a held nozzle goes with the crosshair on it (see nozzleOver), up to POUR_RISE. */
const NOZZLE_GAP = 15;
/** How long a dipper takes to lower into what it's aimed at, or rise back out, in real seconds (see dipAim). */
const DIP_S = 0.2;
/**
 * How long a wicking strip has to be held dipped in a fluid, in real seconds from its foot touching it, before it
 * drinks it: a shorter tap only takes a spot (see Tool.touch).
 */
const DIP_SOAK = 0.35;
/** How fast a falling drop speeds up, in world units per sim second squared: a 500-unit fall takes 0.7 s. */
const GRAVITY = 2000;
/** The player's eyes, and their body's radius. */
const EYE = 620;
const PLAYER_R = 45;
/** Walking speed, in world units per real second. */
const WALK = 840;
/** Where the player stands in the pod, and how they face: out at the lab, eyes a little down. */
const IN_POD = { x: POD.x, z: POD.z, yaw: 0, pitch: -0.12 };
/**
 * Real milliseconds the sleeping lab runs for at a time (see pump), between which the page gets on with anything
 * else, so it stays responsive.
 */
const SLEEP_SLICE_MS = 12;
/** How far away something can be and still be picked up or pressed. */
const REACH = 460;
/** The nearest and furthest something can be held, from the eyes to its middle, beyond its own size. */
const HOLD_NEAR = 40;
/** How much further off than other things a flask is held to start with (see holdDist). */
const FLASK_HOLD = 1.7;
const HOLD_FAR = 520;
/** The counters, as boxes from the floor up to their tops. */
/** The equipment cabinet, solid all through: nothing's set down in it but by putting it away. */
const CABINET_BOX: Box = {
  x: (CABINET.x0 + CABINET.x1) / 2, y: CABINET.y1 / 2, z: (CABINET.z0 + CABINET.z1) / 2, yaw: 0,
  hx: (CABINET.x1 - CABINET.x0) / 2, hy: CABINET.y1 / 2, hz: (CABINET.z1 - CABINET.z0) / 2,
};
const COUNTER_BOXES: readonly Box[] = COUNTERS.map((c) => ({
  x: (c.x0 + c.x1) / 2, y: LIFT / 2, z: (c.z0 + c.z1) / 2, yaw: 0, hx: (c.x1 - c.x0) / 2, hy: LIFT / 2, hz: (c.z1 - c.z0) / 2,
}));
/** How far, in grid cells, what's let go of can be moved from the cell it's held over to find room for it (see placement). */
const SEEK = 2;
/** How far from straight ahead, in radians, the middle of what's held can be, so it's always in view (see holdInPlace). */
const HOLD_CONE = Math.PI / 6;
/** Radians the view turns per pixel the mouse moves, and that something held turns with Shift. */
const LOOK_SENS = 0.0022;
const TURN_SENS = 0.008;
/** How far a held nozzle's stand slides out per pixel the mouse moves up with Shift. */
const REACH_SENS = 0.5;
/** How fast the look stick turns the view when pushed all the way, in radians per real second: across, and up or down. */
const STICK_TURN = 2.4;
const STICK_TILT = 1.6;
/** The key held for undo and redo: Command on a Mac, Control elsewhere. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
/** Whether the screen is mainly touched, rather than pointed at with a mouse: then the on-screen sticks walk and look. */
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
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
/**
 * An island's faucet rises from the island's middle, a corner of four cells, and reaches out over the middle of one
 * of them, this far along x and along z (see CELL).
 */
const ISLAND_FAUCET_OUT = CELL / 2;
/** How thick an island faucet's riser is, round, for bumping into: its radius. */
const RISER_R = 6;
/** How long a note stays up, in ms. */
const NOTE_MS = 1600;
/** How long the note that she can nap stays up, in ms: long enough to read. */
const NAP_HINT_MS = 9000;
/** Real seconds the player's eyes take to close for a nap, and to open again as they wake (see GameEngine.nap). */
const NAP_S = { close: 0.9, open: 0.6 };
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
  /** What's in the equipment cabinet (see cabinet.ts): what the equipment wheels make comes out of it, and goes back in. */
  private stock: Stock = stockWith({});
  /** Where the player stands, and which way they look (yaw about the vertical, pitch up). */
  private player = { x: 480, z: 380, yaw: 0, pitch: -0.08 };
  private keys = new Set<string>();
  /** Where the on-screen sticks are pushed (see stick). */
  private sticks = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
  private held: Held | null = null;
  /** Whether the right button is held: a held flask tips and pours, and a held tool or hose lets fluid out, only while it is. */
  private rightHeld = false;
  /** A valve being turned with the right button, and where on screen the pointer aiming its lever is. */
  private turning: { t: Tool; k: number; aim: { x: number; y: number } } | null = null;
  /**
   * While an equipment wheel is held open, which of WHEELS it is and where its pointer is; the mouse moves it, rather
   * than looking around.
   */
  private wheel: (WheelAim & { which: number }) | null = null;
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
  /** Where the held flask is kept, over the mouth the right button was pressed on, while it's held (see pourPose). */
  private pinned: Pose | null = null;
  /** How far a held dipper aimed at an open top is lowered into it, from 0 (hovering) to 1 (dipped; see dipAim). */
  private dip = 0;
  /** Real seconds the held wicking strip has been dipped in a fluid since its foot touched it (see DIP_SOAK). */
  private dipFor = 0;
  /**
   * Whether the held wicking strip is still on its way in from a press of the right button: a tap, however brief, takes
   * it all the way in before it rises, so its foot always touches what it's dipped in (see dipping).
   */
  private tapping = false;
  /** Where the held flask poured this frame, if it did: its lip, and what it poured into (null: the sink). */
  private pour: { from: Vec3; into: Mouth | null } | null = null;
  /** Where what's held would come to rest if let go, as of the last frame drawn (see placement). */
  private placed: ReturnType<GameEngine['placement']> | null = null;
  /** What the crosshair is on. */
  private target: (Pick & { point: Vec3; distance: number }) | null = null;
  /** A brief note on the display, like there being no room for something (see say). */
  private flash: { text: string; until: number; tip?: boolean } | null = null;
  /** Whether the alarms are silenced, by the button under the beacon (see hushAlarms). Saved, and kept through Reset. */
  private alarmsOff = false;
  /** Whether the porthole's blinds are shut, by the button beside it. Saved, and kept through Reset. */
  private blindsShut = false;
  /** Where the player is in waking up in the airlock (see Wake), and how many sim seconds it's been there. */
  private wake: Wake = 'closed';
  /** How far the ship has turned, in radians (see SPIN), for the stars. */
  private spin = 0;
  /** Sim seconds the lab has run, for what blinks on sim time. */
  private clock = 0;
  private wakeT = Infinity;
  /** While asleep (see Wake), the sleep under way (see sleep.ts), its stats, and the clock when it began. */
  private sleeping: { run: Generator<void, Woke>; stats: SleepStats; from: number; woke: Woke | null } | null = null;
  /** Real seconds since the player woke from a sleep, while the screen fades in from black (see RISE_S); else null. */
  private riseT: number | null = null;
  /**
   * Whether the player woke because there's enough cryostabilizer for the rest of the voyage: the pod welcomes them to
   * Mu Ceti, and what follows is the end (see Wake's arriving).
   */
  private arrival = false;
  /**
   * What the pod's message says is on board, as of when they were put in it: the litres of cryostabilizer, and while
   * the station is still fitted for something before it (see SUPPLIES), the litres of that; else null.
   */
  private podNotice: { litres: number; first: number | null } = { litres: 0, first: null };
  /**
   * A nap under way (see nap): how far shut the player's eyes are, 0 to 1, and whether they're waking, their eyes
   * opening again. With their eyes shut, the lab runs on as it does while they sleep in the pod (see sleeping).
   */
  private napping: { lids: number; waking: boolean } | null = null;
  /**
   * Whether the player has been told they can nap: the station has delivered steadily for DELIVERY.nap sim seconds on
   * end, once. From then on N naps. It's saved with the lab.
   */
  private napKnown = false;
  /**
   * While previewing the end's white void (see previewArrival), how the player stood before, to put them back; null
   * otherwise.
   */
  private previewing: { x: number; z: number; yaw: number; pitch: number } | null = null;
  /** While settling into the pod (see Wake), where the player started from, and how many real seconds it's been. */
  private settling: { x: number; z: number; yaw: number; pitch: number; t: number } | null = null;
  /** Runs the sleeping lab a slice at a time (see pump), independent of frames. */
  private pumper = new MessageChannel();
  /** The supply station's diverter's sounds, while it's swinging or letting into the reservoir. */
  private diverters = new Map<Tool, Diverter>();
  /**
   * The sounds of the station's changeover, while one's under way (see changeoverSounds), with the part of it and the
   * supply the station was fitted for when last heard.
   */
  private changing: { sound: ChangeoverSound; part: string; supply: Supply } | null = null;
  /** Undo and redo, of the lab's arrangement (see history.ts). */
  private history = new History();
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
  /** Each vessel's chemistry, put off while it's quiet (see ReactionNetwork.tick). */
  private lags = new WeakMap<Vessel, Lag>();

  constructor(
    private canvas: HTMLCanvasElement,
    private stage: HTMLElement,
    private chem: ReactionNetwork,
    private cb: EngineCallbacks,
    private preset: Preset = DEFAULT_PRESET,
  ) {
    // the colors' along the right wall, left to right as the player faces it; then the solvent's, one on each island
    const islands = COUNTERS.filter((c) => c.island);
    this.faucets = FAUCETS.map((start, i) => {
      const output = faucetOutput(start, chem);
      if (i < WALL_FAUCETS) {
        const z = FAUCET_Z0 + i * FAUCET_GAP;
        return {
          start, output, note: '',
          spout: { x: ROOM.x1 - FAUCET_OUT, y: FAUCET_Y, z },
          wall: { x: ROOM.x1 - 14, y: FAUCET_Y + FAUCET_NECK, z },
        };
      }
      const c = islands[i - WALL_FAUCETS];
      const x = (c.x0 + c.x1) / 2;
      const z = (c.z0 + c.z1) / 2;
      return {
        start, output, note: '',
        spout: { x: x + ISLAND_FAUCET_OUT, y: FAUCET_Y, z: z + ISLAND_FAUCET_OUT },
        wall: { x, y: FAUCET_Y + FAUCET_NECK, z },
        base: { x, y: LIFT, z },
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
    this.sleeping = null;
    this.pumper.port1.close();
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
   * tank), a tool's own note (`t2`; only a tool with no tank, or more than one, has one), a scale's (`s1`) or a faucet's
   * (`F5`), by index. Things are replaced on reset and load, so look this up each time.
   */
  note(id: string): { text: string; set(text: string): void } | null {
    const label = (o: { label: string } | undefined) => o && { text: o.label, set: (s: string) => this.change(() => (o.label = s)) };
    const note = (o: { note: string } | undefined) => o && { text: o.note, set: (s: string) => this.change(() => (o.note = s)) };
    const tank = /^t(\d+)\.(\d+)$/.exec(id);
    if (tank) return label(this.tools.find((t) => t.id === +tank[1])?.tanks[+tank[2]]) ?? null;
    const m = /^([fFst])(\d+)$/.exec(id);
    if (!m) return null;
    const i = +m[2];
    const found =
      m[1] === 'f' ? label(this.flasks[i])
      : m[1] === 't' ? note(this.tools.find((t) => t.id === i && t.tanks.length !== 1))
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
    // a preset's flasks along the front of the first island
    const island = COUNTERS.find((c) => c.island)!;
    this.flasks = preset.flasks.map((fill, i) => {
      const f = new Flask(CAP);
      f.pose = { x: island.x0 + (i + 0.5) * CELL, y: LIFT + FLASK_H, z: island.z1 - CELL / 2, yaw: 0 };
      f.glass = glassGrams(i);
      applyFill(f, fill);
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
    // a new lab's station is fitted for the first thing the ship is short of, and nobody has napped in it
    this.station().stock(FIRST_SUPPLY);
    this.napKnown = false;
    this.hoses = (preset.hoses ?? []).map(({ from, to }) => {
      const m = tankMouth(this.tools[to.tool], to.tank ?? 0);
      return new Hose({ tool: this.tools[from.tool], spout: from.spout }, { x: m.x, y: m.y + (to.up ?? 24), z: m.z }, NOZZLE_REACH.min);
    });
    this.restAll();
    this.stock = stockWith(this.outOfCabinet());
    this.afterLoad();
  }

  /** How many of each kind the cabinet stocks are out in the lab. */
  private outOfCabinet(): Partial<Record<Stocked, number>> {
    const out: Partial<Record<Stocked, number>> = {};
    const kinds: string[] = [...this.flasks.map(() => 'flask'), ...this.scales.map(() => 'scale'), ...this.tools.map((t) => t.kind)];
    for (const k of kinds) if (isStocked(k)) out[k] = (out[k] ?? 0) + 1;
    return out;
  }

  /**
   * Put back in the cabinet whatever a save left where it now stands (an older save's things along the back counter,
   * before the cabinet took that end of it), emptied, as if put away; and whatever couldn't be put away, as a unique
   * tool can't, somewhere near. Returns how many of each kind were put back.
   */
  private clearCabinet(): Partial<Record<Stocked, number>> {
    const back: Partial<Record<Stocked, number>> = {};
    const inIt = (b: Box) => boxesOverlap(b, CABINET_BOX);
    const count = (k: Stocked) => (back[k] = (back[k] ?? 0) + 1);
    // a scale goes with whatever stands on it
    const scales = new Set(this.scales.filter((sc) => inIt(scaleBox(sc, true))));
    const riders = new Set([...scales].flatMap((sc) => sc.load.map((l) => l.f)));
    const flasks = new Set(this.flasks.filter((f) => riders.has(f) || inIt(flaskBox(f))));
    const tools = new Set(this.tools.filter((t) => !t.shape.wall && isStocked(t.kind) && inIt(toolBox(t))));
    scales.forEach(() => count('scale'));
    flasks.forEach(() => count('flask'));
    tools.forEach((t) => count(t.kind as Stocked));
    this.scales = this.scales.filter((sc) => !scales.has(sc));
    this.flasks = this.flasks.filter((f) => !flasks.has(f));
    this.tools = this.tools.filter((t) => !tools.has(t));
    for (const sc of this.scales) for (const { f } of [...sc.load]) if (flasks.has(f)) sc.remove(f);
    this.hoses = this.hoses.filter((h) => !('tool' in h.on && tools.has(h.on.tool)) && !inIt(nozzleBox(h)));
    // what can't be put away (a unique tool) goes somewhere near instead
    for (const t of this.tools) if (!t.shape.wall && inIt(toolBox(t))) t.pose = this.roomy(t);
    return back;
  }

  private afterLoad(): void {
    // a lab loads with the airlock shut, until its station has been delivering steadily again, and anyone in it or
    // asleep in the pod wakes in the lab
    if (this.wake === 'open' || this.wake === 'settling' || this.wake === 'boarding' || this.wake === 'asleep' || this.arrival) {
      this.arrival = false;
      this.riseT = null;
      this.wake = 'closed';
      this.wakeT = Infinity;
      this.sleeping = null;
      const p = this.player;
      const r = this.inRoom({ x: p.x, y: 0, z: p.z, yaw: p.yaw });
      [p.x, p.z] = [r.x, r.z];
    }
    // and anyone napping wakes
    if (this.napping) {
      this.napping.waking = true;
      this.sleeping = null;
    }
    for (const d of this.diverters.values()) d.stop();
    this.diverters.clear();
    this.changing?.sound.stop();
    this.changing = null;
    this.falling = [];
    this.held = this.turning = this.tarePress = null;
    this.history.clear();
  }

  /* ---------------- undo ---------------- */

  /** How the lab is arranged just now (see history.ts). */
  private arranged(): Arrangement {
    const { flasks, tools, scales, hoses, faucets, stock, alarmsOff, blindsShut } = this;
    return arrangement({ flasks, tools, scales, hoses, faucets, stock }, { alarmsOff, blindsShut });
  }

  /** An action that changes the arrangement is starting (see History.mark). */
  private mark(): void {
    this.history.mark(this.arranged());
  }

  /** The action under way is done (see History.commit). */
  private commit(): void {
    this.history.commit(this.arranged());
  }

  /** Change the arrangement at once, as one step to undo. */
  private change(fn: () => void): void {
    this.mark();
    fn();
    this.commit();
  }

  /**
   * Ctrl+Z: undo the last change to the lab's arrangement (see history.ts), or with something in hand, put it back
   * (see putBack), as a carry isn't done until it's set down. Ctrl+Shift+Z or Ctrl+Y: redo.
   */
  undo(redo = false): void {
    if (inPod(this.wake) || this.dozing()) return;
    if (this.held) {
      if (!redo) this.putBack();
      return;
    }
    const now = this.arranged();
    const a = redo ? this.history.redo(now) : this.history.undo(now);
    if (!a) return;
    const { flasks, tools, scales, hoses, faucets, stock } = this;
    arrange({ flasks, tools, scales, hoses, faucets, stock }, a);
    this.setAlarmsOff(a.alarmsOff);
    this.blindsShut = a.blindsShut;
    this.turning = null;
    this.open = this.mouths();
  }

  /** A valve being turned is let go of: that's a step to undo, if it moved. */
  private endTurn(): void {
    if (!this.turning) return;
    this.turning = null;
    this.commit();
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
        ...(t.note ? { note: t.note } : {}),
        ...(t.memory ? { memory: t.memory } : {}),
        ...(t.paper.length ? { paper: t.paper.map(saveVessel) } : {}),
        ...(t.bed.length ? { bed: t.bed.map(saveVessel) } : {}),
      })),
      scales: this.scales.map((sc) => ({
        ...this.frac(sc.pose), ...depth(sc.pose), tare: sc.tare,
        load: sc.load.map(({ f, dx }) => ({ f: this.flasks.indexOf(f), dx })).filter((l) => l.f >= 0),
        ...(sc.note ? { note: sc.note } : {}),
      })),
      hoses: this.hoses.map((h) => ({
        outlet: { ...toFrac(h.outlet), z: h.outlet.z, yaw: h.turn, reach: h.reach },
        on: 'tool' in h.on ? { tool: h.on.tool.id, spout: h.on.spout } : { faucet: h.on.faucet },
      })),
      // where they started on the old flat bench, so the save still loads there, with their notes
      faucets: this.faucets.map((fa, i, all) => ({ x: (i + 0.5) / all.length, y: 30 / HOME_H, ...(fa.note ? { note: fa.note } : {}) })),
      cabinet: Object.fromEntries(
        (Object.keys(this.stock) as Stocked[]).filter((k) => !endless(k)).map((k) => [k, this.stock[k].flatMap((on, i) => (on ? [i] : []))]),
      ),
      ...(this.alarmsOff ? { alarmsOff: true } : {}),
      ...(this.blindsShut ? { blindsShut: true } : {}),
      ...(this.napKnown ? { nap: true } : {}),
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
        if (typeof st.note === 'string') t.note = st.note;
        t.remember(st.memory);
        t.paper.forEach((v, k) => st.paper?.[k] && loadVessel(v, st.paper[k]));
        t.bed.forEach((v, k) => st.bed?.[k] && loadVessel(v, st.bed[k]));
        // an older save's strip stood in a tray, posed at the tray's top, 4 above its paper's foot: it's bare paper now,
        // so it goes up to keep its paper where it was (its tray, and what was in it, are gone), and the tray's label
        // is its note
        if (st.kind === 'strip' && st.tanks?.length) {
          t.pose = { ...t.pose, y: t.pose.y + STRIP_FOOT - 4 };
          const label = st.tanks[0]?.label;
          if (!t.note && typeof label === 'string') t.note = label;
        }
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
      const h = new Hose(mount, this.inRoom({ ...fromFrac(o), z: num(o.z, Z_HOME) }), snapReach(num(o.reach, NOZZLE_REACH.min)));
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
    this.napKnown = !!s.nap;
    const pl = s.player;
    if (pl && [pl.x, pl.z, pl.yaw, pl.pitch].every(Number.isFinite)) {
      const p = this.inRoom({ x: pl.x, y: 0, z: pl.z, yaw: pl.yaw });
      Object.assign(this.player, { x: p.x, z: p.z, yaw: pl.yaw, pitch: pl.pitch });
    }
    const back = this.clearCabinet();
    this.restAll();
    // the cabinet as saved, with whatever was just put back in it; or for a save from before it, full but for what's out
    if (s.cabinet) {
      this.stock = stockWith({});
      for (const k of Object.keys(this.stock) as Stocked[]) {
        if (endless(k) || !Array.isArray(s.cabinet[k])) continue;
        const filled = new Set(s.cabinet[k]);
        this.stock[k] = this.stock[k].map((_, i) => filled.has(i));
        for (let n = back[k] ?? 0; n > 0; n--) putIn(this.stock, k);
      }
    } else this.stock = stockWith(this.outOfCabinet());
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
   * Keep at most one of each unique tool (see UNIQUE_TOOLS), the first. There's always a composition analyzer, a
   * spectroscope, a bond visualizer and a station: if there's none, one is added where it starts, or as
   * near there as it has room (see roomy), the station fitted for the cryostabilizer, its reservoir holding what's
   * left on board (see Tool.stock), as a save from before it was fitted for anything else would have it. The
   * station is built into the wall, so it's always where it is.
   */
  private uniqueTools(): void {
    for (const kind of UNIQUE_TOOLS) {
      const first = this.tools.find((t) => t.kind === kind);
      this.tools = this.tools.filter((t) => t.kind !== kind || t === first);
    }
    const add = (kind: ToolKind, at: Pose) => {
      if (this.tools.some((t) => t.kind === kind)) return;
      const t = new Tool(kind, this.nextToolId++, at);
      if (kind === 'receptacle') t.stock(CRYOSTABILIZER);
      else t.pose = this.roomy(t);
      this.tools.push(t);
    };
    // the station first, since it's always where it is, for the others to keep clear of
    add('receptacle', STATION_POSE);
    this.station().pose = { ...STATION_POSE };
    add('analyzer', spotPose(ANALYZER_AT));
    add('spectroscope', spotPose(SPECTROSCOPE_AT));
    add('visualizer', spotPose(VISUALIZER_AT));
  }

  /**
   * Where a tool new to the lab (see uniqueTools) can go: where it is, if it would come to rest there as if set down
   * (see rest), or else the nearest spot on the grid where it would, at the same height and facing the same way. An
   * older save can have something where a tool it lacked starts. Where it is, if there's room nowhere.
   */
  private roomy(t: Tool): Pose {
    const h: Held = { kind: 'tool', t, relYaw: 0, dist: 0 };
    const obstacles = this.obstacles(h);
    const solid = this.obstacles(h, false);
    const spots: Pose[] = [];
    for (let x = ROOM.x0 + CELL / 2; x < ROOM.x1; x += CELL)
      for (let z = ROOM.z0 + CELL / 2; z < ROOM.z1; z += CELL) spots.push(this.gridded(h, { ...t.pose, x, z }));
    const off = (p: Pose) => Math.hypot(p.x - t.pose.x, p.z - t.pose.z);
    for (const p of [this.gridded(h, t.pose), ...spots.sort((a, b) => off(a) - off(b))]) {
      const r = this.rest(h, p, obstacles, solid);
      if (typeof r !== 'string') return r.pose;
    }
    return t.pose;
  }

  /** The station (see STATION): there's always exactly one. */
  private station(): Tool {
    return this.tools.find((t) => t.kind === 'receptacle')!;
  }

  /**
   * A save from before the supply station was a funnel over a diverter gets the station's reservoir filled
   * with what its reservoir held: the third of the three columns it had (a buffer, a tester and the reservoir); or,
   * from before that (when the receptacle stood on an island and flushed what it took away, counting it as delivered,
   * and the reservoir was a tool of its own), what that held, or what it started with if it had none, plus what it
   * had delivered. Whatever was waiting in the old buffer and tester is judged as the diverter would judge it, all
   * together, and let into the reservoir if it passes; the funnel starts empty.
   */
  private oldStation(s: SaveState): void {
    const saved = s.tools.find((st) => st.kind === 'receptacle');
    const tanks = saved?.tanks ?? [];
    if (tanks.length === SHAPES.receptacle.tanks.length) return;
    const [funnel, ref] = this.station().tanks;
    loadVessel(funnel, { n: {}, Q: 0, label: funnel.label });
    const waiting = tanks.length === 3 ? tanks.slice(0, 2) : tanks.slice(0, 1);
    const old = tanks.length === 3 ? tanks[2] : s.tools.find((st) => (st.kind as string) === 'reference')?.tanks?.[0];
    if (old) loadVessel(ref, old);
    else applyFill(ref, REFERENCE_FILL);
    const delivered = tanks.length < 3 && Number.isFinite(s.delivered) ? Math.max(0, s.delivered!) : 0;
    ref.setMolecules(TARGET, ref.n[TARGET] + Math.round(delivered / roomFor(TARGET)));
    const lot = new Vessel(Infinity);
    for (const w of waiting) {
      const v = new Vessel(Infinity);
      if (w) loadVessel(v, w);
      lot.addFrom(v, volume(v));
    }
    if (sustenance(lot) > 0) ref.addFrom(lot, volume(lot));
  }

  /**
   * Set everything that stands on the bench (flasks and scales) down on the counter under it, if there is one, and stand each flask on a scale where the scale now is. Presets and older saves leave
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
      for (let i = 0; i < 2 && counterUnder(standBase(nozzleStand(h.outlet, h.turn, h.reach), 0)) === null; i++)
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
   * Take a flask, tool or scale out of the equipment cabinet into the player's grip, facing them, if their hands are
   * free (what's held passes through everything, so there's always room) and there's one left. Returns whether it did.
   */
  spawn(kind: Stocked): boolean {
    if (inPod(this.wake) || this.dozing()) return false;
    if (this.held) {
      this.say('Hands full');
      return false;
    }
    if (!endless(kind) && !this.stock[kind].includes(true)) {
      this.say('None left in the cabinet');
      return false;
    }
    this.mark();
    const held = this.fresh(kind, takeFrom(this.stock, kind)!);
    held.dist = this.holdDist(held);
    this.placeHeld(held, this.gripPose(held));
    held.dist = this.clampDist(held, held.dist);
    this.enter(held);
    this.held = held;
    return true;
  }

  /** A little picture of each kind of thing the equipment wheels make, as it's drawn in the lab (see the view's IconStudio). */
  icons(): Readonly<Icons> {
    return this.view.icons();
  }

  /**
   * Open one of the equipment wheels, its pointer in its middle, if there'd be any use in it: with hands free, and the
   * mouse not busy turning a valve. With the other wheel open, it takes its place, the pointer staying where it is.
   */
  private openWheel(which: number): void {
    if (this.turning) return;
    if (this.held) {
      this.say('Hands full');
      return;
    }
    this.wheel = { x: 0, y: 0, ...this.wheel, which };
  }

  /** Close an equipment wheel, if it's the one that's open, making what its pointer picks, if anything. */
  private closeWheel(which: number): void {
    const w = this.wheel;
    if (w?.which !== which) return;
    this.wheel = null;
    const items = WHEELS[which];
    const pick = wheelPick(w, items.length);
    if (pick !== null) this.spawn(items[pick]);
  }

  /** Take the one in a slot of the cabinet out of it, held just where it stood, as anything's picked up. */
  private takeOut(kind: Stocked, slot: number): void {
    if (!this.stock[kind][slot]) return;
    this.mark();
    takeSlot(this.stock, kind, slot);
    const held = this.fresh(kind, slot);
    this.placeHeld(held, CABINET.slots[kind][slot]);
    held.relYaw = held.kind === 'flask' ? 0 : wrapAngle(this.heldPose(held).yaw - this.player.yaw);
    held.follow = [];
    this.enter(held);
    this.holdInPlace(held);
    this.held = held;
  }

  /** A new one of a kind, empty, as it comes out of the cabinet's `slot`, held but not yet in the lab (see enter). */
  private fresh(kind: Stocked, slot: number): Held {
    if (kind === 'flask') {
      const f = new Flask(CAP);
      // each of the cabinet's flasks its own weight
      f.glass = glassGrams(slot);
      return { kind: 'flask', f, relYaw: 0, dist: 0 };
    }
    if (kind === 'scale') return { kind: 'scale', sc: new Scale(), relYaw: 0, dist: 0 };
    return { kind: 'tool', t: new Tool(kind, this.nextToolId++, undefined), relYaw: 0, dist: 0 };
  }

  /** Bring something just made (see fresh) into the lab. */
  private enter(h: Held): void {
    if (h.kind === 'flask') this.flasks.push(h.f);
    if (h.kind === 'scale') this.scales.push(h.sc);
    if (h.kind === 'tool') this.tools.push(h.t);
  }

  /**
   * Put away whatever's held, unless it's one of a kind: back in the equipment cabinet, emptied, a tool with the hoses
   * pulled out of its spouts rolled back up, and a hose's nozzle rolled back up into its spout or faucet.
   */
  private putAway(): void {
    if (this.dozing()) return;
    const h = this.held;
    if (!h) return;
    if (h.kind === 'tool' && UNIQUE_TOOLS.includes(h.t.kind)) {
      this.say("Can't put that away");
      return;
    }
    this.unfollow(h);
    if (h.kind === 'flask') this.flasks.splice(this.flasks.indexOf(h.f), 1);
    if (h.kind === 'tool') {
      this.tools.splice(this.tools.indexOf(h.t), 1);
      this.hoses = this.hoses.filter((hose) => !('tool' in hose.on && hose.on.tool === h.t));
    }
    if (h.kind === 'scale') this.scales.splice(this.scales.indexOf(h.sc), 1);
    const kind = h.kind === 'tool' ? h.t.kind : h.kind;
    if (isStocked(kind)) putIn(this.stock, kind);
    if (h.kind === 'hose') this.hoses.splice(this.hoses.indexOf(h.h), 1);
    this.held = null;
    this.pinned = null;
    this.commit();
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
   * Where what's held would be, where it's held from the eyes (see Held.dir): facing the nearest way along the grid to
   * how it's turned from the player, so it turns in quarter turns.
   */
  private gripPose(h: Held): Pose {
    const eye = this.eye();
    const { right, up, ahead } = this.viewAxes();
    const k = h.dir ?? { x: 0, y: 0, z: 1 };
    const d = {
      x: right.x * k.x + up.x * k.y + ahead.x * k.z, y: right.y * k.x + up.y * k.y + ahead.y * k.z, z: right.z * k.x + up.z * k.y + ahead.z * k.z,
    };
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

  /**
   * The walls, counters, and everything in the room but what's held (and what rides on it), including the bases of
   * the stands holding up everything else (unless `bases` is false). A held tool's own hoses' nozzles don't get in its
   * way, since one left at its spout (see keepPouring) is rolled back up if it's set down there again (see setDown),
   * nor do the hoses following it (see gather). Nor are the tool `away`, about to be picked up, and the hoses `skip`.
   */
  private obstacles(h: Held | null, bases = true, away: Tool | null = null, skip: ReadonlySet<Hose> = new Set()): Box[] {
    // while the airlock's doors are open, its doorway and chamber take the front wall's place
    const room = this.wake === 'closed' ? roomBoxes(ROOM) : [...roomBoxes(ROOM, false), ...airlockBoxes()];
    const riders = h?.kind === 'scale' ? new Set(h.sc.load.map((l) => l.f)) : new Set<Flask>();
    const out: Box[] = [...room, ...COUNTER_BOXES, CABINET_BOX, ...this.risers()];
    for (const f of this.flasks) if (!(h?.kind === 'flask' && h.f === f) && !riders.has(f)) out.push(flaskBox(f));
    const gone = (t: Tool) => (h?.kind === 'tool' && h.t === t) || t === away;
    for (const t of this.tools) if (!gone(t)) out.push(toolBox(t));
    for (const sc of this.scales) if (!(h?.kind === 'scale' && h.sc === sc)) out.push(scaleBox(sc));
    const following = new Set(h?.follow?.map((f) => f.hose));
    for (const hose of this.hoses)
      if (!(h?.kind === 'hose' && h.h === hose) && !following.has(hose) && !skip.has(hose)) {
        if (!(h?.kind === 'tool' && 'tool' in hose.on && hose.on.tool === h.t)) out.push(nozzleBox(hose));
        if (bases) out.push(standBase(nozzleStand(hose.outlet, hose.turn, hose.reach)));
      }
    if (bases) for (const t of this.tools) if (!gone(t)) for (const st of toolStands(t)) out.push(standBase(st));
    return out;
  }

  /** The islands' faucets' risers, each a round post from the counter up to its knob. */
  private risers(): Box[] {
    return this.faucets.flatMap(({ base, wall }) => {
      if (!base) return [];
      const hy = (wall.y - base.y) / 2;
      return [{ x: base.x, y: base.y + hy, z: base.z, yaw: 0, hx: RISER_R, hy, hz: RISER_R, round: true }];
    });
  }

  private eye(): Vec3 {
    return { x: this.player.x, y: EYE, z: this.player.z };
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

  /** E: pick up what the crosshair is on, or let go of what's held. */
  touchGrab(): void {
    if (this.locked) this.grabOrRelease(false);
  }

  /** Enter: write a note about what the crosshair is on. */
  touchNote(): void {
    if (this.locked) this.writeNote();
  }

  /** N: nap, or wake from one. */
  touchNap(): void {
    if (this.dozing()) this.wakeNap();
    else if (this.locked) this.nap();
  }

  /** Backspace: put away what's held. */
  touchPutAway(): void {
    if (this.locked) this.putAway();
  }

  /** The right button, pressed or let go: it pours, lets fluid out, dips a strip or a thermometer, or turns the valve looked at. */
  hand(down: boolean): void {
    if (!down) {
      this.rightHeld = false;
      this.endTurn();
    } else if (this.locked) this.rightDown();
  }

  /** A finger dragged (dx, dy) pixels on the right button's stand-in: while a valve turns, it moves the aim. */
  handDrag(dx: number, dy: number): void {
    if (this.turning) this.look(dx, dy, false);
  }

  /**
   * The touch screen's stand-in for Shift and the mouse, and the wheel: a drag across turns what's held, and up holds it
   * further, down nearer; but for a hose's nozzle, up slides its stand out and down in (see slideReach).
   */
  turnHeld(dx: number, dy: number): void {
    const h = this.held;
    if (!h) return;
    // a flask is round, so turning it does nothing (see faceFlask)
    if (h.kind !== 'flask') h.relYaw = wrapAngle(h.relYaw - dx * TURN_SENS);
    if (h.kind === 'hose') this.slideReach(h, dy);
    else h.dist = this.clampDist(h, h.dist * Math.exp(-dy * 0.004));
  }

  /** The mouse or a finger moved `dy` pixels down: slide a held nozzle's stand in, or up, out, within NOZZLE_REACH. */
  private slideReach(h: Held & { kind: 'hose' }, dy: number): void {
    h.reach = Math.min(NOZZLE_REACH.max, Math.max(NOZZLE_REACH.min, h.reach - dy * REACH_SENS));
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
        this.endTurn();
        this.tarePress = null;
        this.wheel = null;
      }
    };
    document.addEventListener('pointerlockchange', onLock);
    this.cleanups.push(() => document.removeEventListener('pointerlockchange', onLock));
    on(c, 'mousedown', (e) => {
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
      // the wheel has the mouse while it's open
      if (this.wheel) return;
      if (e.button === 0) this.leftDown(e.shiftKey);
      if (e.button === 2) this.rightDown();
    });
    on(window, 'mouseup', (e) => {
      if (e.button === 0) this.tarePress = null;
      if (e.button === 2) {
        this.rightHeld = false;
        this.endTurn();
      }
    });
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => {
      if (!this.locked) return;
      if (this.wheel) this.wheel = { ...this.wheel, ...wheelMove(this.wheel, e.movementX, e.movementY) };
      else this.look(e.movementX, e.movementY, e.shiftKey);
    });
    on(c, 'wheel', (e) => {
      e.preventDefault();
      if (!this.held) return;
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      this.held.dist = this.clampDist(this.held, this.held.dist * Math.exp(-px * 0.0012));
    });
    on(window, 'keydown', (e) => {
      if (typingIn(e.target)) return;
      // the usual keys for undo and redo, captured or not
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault();
        this.undo(e.code === 'KeyY' || e.shiftKey);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Enter is OK on the message inside the cryopod, as it was on the notice it replaced
      if (e.code === 'Enter' && this.wake === 'pod') this.pressOk();
      // napping, or nodding off, N wakes them, whether or not the mouse is captured, and nothing else does anything
      if (this.dozing()) {
        if (e.code === 'KeyN' && !e.repeat) this.wakeNap();
        return;
      }
      // in god mode, = shows the end's white void, or puts the lab back
      if (e.code === 'Equal' && (this.god || this.previewing)) {
        if (!e.repeat) this.previewArrival(!this.previewing);
        return;
      }
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.repeat || inPod(this.wake) || this.previewing) return;
      if (e.code === 'KeyE') this.grabOrRelease(e.shiftKey);
      if (e.code === 'KeyQ') this.putBack();
      if (e.code === 'Enter') {
        // the note's text box opens at once, and this Enter mustn't be taken as finishing it
        e.preventDefault();
        this.writeNote();
      }
      if (e.code === 'KeyN') this.nap();
      const wheel = WHEEL_CODES.indexOf(e.code);
      if (wheel >= 0) {
        this.openWheel(wheel);
        e.preventDefault();
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        this.putAway();
        e.preventDefault();
      }
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      const wheel = WHEEL_CODES.indexOf(e.code);
      if (wheel >= 0) this.closeWheel(wheel);
    });
    on(window, 'blur', () => {
      this.keys.clear();
      this.wheel = null;
    });
  }

  private clampDist(h: Held, d: number): number {
    const b = this.heldBox(h);
    const r = Math.hypot(b.hx, b.hz);
    return Math.max(r + HOLD_NEAR, Math.min(r + HOLD_FAR, d));
  }

  /** The mouse moved by (dx, dy) pixels: aim a valve's lever, turn what's held (with Shift), or look around. */
  private look(dx: number, dy: number, shift: boolean): void {
    if (this.turning) {
      const a = this.turning.aim;
      a.x = Math.max(0, Math.min(this.viewW, a.x + dx));
      a.y = Math.max(0, Math.min(this.viewH, a.y + dy));
      this.aimTurning();
      return;
    }
    if (shift && this.held) {
      if (this.held.kind !== 'flask') this.held.relYaw = wrapAngle(this.held.relYaw - dx * TURN_SENS);
      if (this.held.kind === 'hose') this.slideReach(this.held, dy);
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

  /**
   * Pick up what the crosshair is on, or let go of what's held. Picked up `linked` (with Shift), it stays hooked up to
   * what it pours into and what pours into it (see keepPouring and gather); otherwise it's moved alone.
   */
  private grabOrRelease(linked: boolean): void {
    if (this.dozing()) return;
    if (inPod(this.wake)) return;
    if (this.held) {
      if (this.intoCabinet()) this.putAway();
      else this.release();
      return;
    }
    const p = this.target;
    if (!p) return;
    let h: Held;
    if (p.kind === 'stock') {
      this.takeOut(p.item, p.slot);
      return;
    }
    if (p.kind === 'faucet' || p.kind === 'alarm' || p.kind === 'blinds' || p.kind === 'wake' || p.kind === 'cabinet') return;
    if (p.kind === 'tool' && p.t.shape.fixed) {
      this.say('That stays where it is');
      return;
    }
    // picking something up starts a step to undo, done once it's set down (see setDown)
    this.mark();
    if (p.kind === 'flask') {
      const sc = this.scales.find((s) => s.load.some((l) => l.f === p.f));
      const scale = sc && { sc, dx: sc.load.find((l) => l.f === p.f)!.dx };
      for (const s of this.scales) s.remove(p.f);
      h = { kind: 'flask', f: p.f, relYaw: 0, dist: 0, from: { pose: { ...p.f.pose }, ...(scale ? { scale } : {}) } };
    } else if (p.kind === 'tool') {
      const made = linked ? this.keepPouring(p.t) : [];
      if (typeof made === 'string') {
        this.say(made);
        return;
      }
      h = { kind: 'tool', t: p.t, relYaw: 0, dist: 0, from: { pose: { ...p.t.pose } }, made };
    }
    else if (p.kind === 'scale') h = { kind: 'scale', sc: p.sc, relYaw: 0, dist: 0, from: { pose: { ...p.sc.pose } } };
    else {
      this.holdHose(p.h);
      return;
    }
    h.relYaw = h.kind === 'flask' ? 0 : wrapAngle(this.heldPose(h).yaw - this.player.yaw);
    h.follow = linked ? this.gather(h) : [];
    this.holdInPlace(h);
    this.held = h;
  }

  /**
   * Keep a tool about to be picked up pouring into whatever it pours into: each of its spouts with no hose out letting
   * something out (see flowing) over an open top (but its own) gets its hose pulled out, the nozzle left just where the spout is, on a stand wherever
   * there's room for one (see standFor). Returns those hoses, or if one has no room for its stand, why it can't be.
   */
  private keepPouring(t: Tool): Hose[] | string {
    const made: Hose[] = [];
    for (const j of this.pouringOut(t)) {
      const sp = spoutAt(t, j);
      const hose = new Hose({ tool: t, spout: j }, sp, NOZZLE_REACH.min);
      hose.turn = toCardinal(this.player.yaw);
      const r = this.standFor(hose, t);
      if (typeof r === 'string') {
        this.hoses = this.hoses.filter((x) => !made.includes(x));
        this.commit(); // nothing came of it
        return 'No room for a hose’s stand';
      }
      hose.outlet = { x: r.pose.x, y: r.pose.y, z: r.pose.z };
      ({ turn: hose.turn, reach: hose.reach } = r.hose!);
      made.push(hose);
      this.hoses.push(hose);
    }
    return made;
  }

  /** The spouts of tool t that keepPouring would pull hoses out of: with none out, letting something out into an open top not its own. */
  private pouringOut(t: Tool): number[] {
    const out: number[] = [];
    for (let j = 0; j < t.shape.spouts.length; j++) {
      if (this.hoseOn({ tool: t, spout: j }) || !this.flowing(t, j)) continue;
      const m = mouthBelow(this.open, spoutAt(t, j));
      if (m && !t.tanks.includes(m.v)) out.push(j);
    }
    return out;
  }

  /** Whether picking up p with Shift would keep anything hooked up to it (see keepPouring and gather). */
  private hooked(p: Pick): boolean {
    if (p.kind === 'tool' && this.pouringOut(p.t).length) return true;
    const h: Held | null =
      p.kind === 'flask' ? { kind: 'flask', f: p.f, relYaw: 0, dist: 0 }
      : p.kind === 'tool' ? { kind: 'tool', t: p.t, relYaw: 0, dist: 0 }
      : p.kind === 'scale' ? { kind: 'scale', sc: p.sc, relYaw: 0, dist: 0 }
      : null;
    return !!h && this.feeders(h).length > 0;
  }

  /**
   * Whatever pours into what's about to be carried keeps pouring into it: each faucet, nozzle, or spout letting
   * something out (see flowing), whose stream lands in it (a flask, a tool's open tanks, or the flasks on a scale), has
   * its hose, pulled out if it isn't, go along with it (see follow) until it's set down, when they're set down over it
   * too (see followRests). An idle spout that happens to be over it is left be.
   */
  private gather(h: Held): Follower[] {
    const frame = this.carryFrame(h, this.heldPose(h));
    return this.feeders(h).map(({ m, at, into }) => {
      let hose = this.hoseOn(m);
      const was = hose ? { outlet: { ...hose.outlet }, turn: hose.turn, reach: hose.reach } : null;
      if (!hose) {
        hose = new Hose(m, at, NOZZLE_REACH.min);
        hose.turn = toCardinal(this.player.yaw);
        this.hoses.push(hose);
      }
      return { hose, into, off: toLocal(frame, hose.outlet), turn: wrapAngle(hose.turn - frame.yaw), was };
    });
  }

  /** What gather would bring along with h: each faucet or spout (at its outlet) whose stream lands in it, and in which of its vessels. */
  private feeders(h: Held): { m: HoseMount; at: Vec3; into: Vessel }[] {
    const vs = new Set<Vessel>(h.kind === 'flask' ? [h.f] : h.kind === 'tool' ? h.t.tanks : h.kind === 'scale' ? h.sc.load.map((l) => l.f) : []);
    const out: { m: HoseMount; at: Vec3; into: Vessel }[] = [];
    const add = (m: HoseMount, at: Vec3) => {
      const mouth = mouthBelow(this.open, at);
      if (!mouth || !vs.has(mouth.v)) return;
      if (!this.hoseOn(m) && 'tool' in m && !this.flowing(m.tool, m.spout)) return;
      out.push({ m, at, into: mouth.v });
    };
    this.faucets.forEach((_, i) => add({ faucet: i }, this.faucetOutlet(i)));
    for (const t of this.tools)
      t.shape.spouts.forEach((_, j) => {
        // a carried tool's own spouts go with it anyway
        if (!(h.kind === 'tool' && h.t === t && !this.hoseOn({ tool: t, spout: j }))) add({ tool: t, spout: j }, this.outletAt(t, j));
      });
    return out;
  }

  /** Whether spout j of tool t is letting something out: streaming, or gathering a drop. */
  private flowing(t: Tool, j: number): boolean {
    return !!t.out[j] || t.drops[j].N > 0;
  }

  /** The frame the hoses following what's held (see gather) go along in, with it at pose p: a flask's doesn't turn. */
  private carryFrame(h: Held, p: Pose): Pose {
    return h.kind === 'flask' ? { ...p, yaw: 0 } : p;
  }

  /** Bring the hoses following what's held (see gather) along with it, where it now is. */
  private follow(h: Held): void {
    const frame = this.carryFrame(h, this.heldPose(h));
    for (const f of h.follow ?? []) {
      f.hose.outlet = toWorld(frame, f.off);
      f.hose.turn = wrapAngle(f.turn + frame.yaw);
    }
  }

  /**
   * Where the hoses following what's held (see gather) would come to rest if it were set down at rest r: each over the
   * same spot of it, on the grid, on a stand where there's room (see rest), still pouring into it; as high over it as
   * it was if there's room, or else as low as there is, from NOZZLE_GAP over the mouth up to POUR_RISE. Or why not.
   */
  private followRests(h: Held, r: Rest): Rest[] | string {
    const fs = h.follow ?? [];
    const at = this.heldPose(h);
    const tilt = h.kind === 'flask' ? h.f.tilt : 0;
    const saved = fs.map((f) => ({ outlet: f.hose.outlet, turn: f.hose.turn, reach: f.hose.reach }));
    // put it there, upright, for a moment, to see; and each hose there in turn, for the next to go round
    if (h.kind === 'flask') h.f.tilt = 0;
    this.placeHeld(h, r.pose);
    const mouths = this.mouths();
    const frame = this.carryFrame(h, r.pose);
    const unplaced = new Set(fs.map((f) => f.hose));
    const out: Rest[] = [];
    let why: string | null = null;
    for (const f of fs) {
      unplaced.delete(f.hose);
      f.hose.turn = wrapAngle(f.turn + frame.yaw);
      const fh: Held = { kind: 'hose', h: f.hose, reach: f.hose.reach, relYaw: wrapAngle(f.hose.turn - this.player.yaw), dist: 0 };
      const tip = onGrid({ ...toWorld(frame, f.off), yaw: 0 });
      const mouthY = mouths.find((m) => m.v === f.into)?.y ?? tip.y;
      const ys = [tip.y];
      for (let up = NOZZLE_GAP; up <= POUR_RISE; up += 10) ys.push(mouthY + up);
      const obstacles = this.obstacles(fh, true, null, unplaced);
      const solid = this.obstacles(fh, false, null, unplaced);
      let res: Rest | null = null;
      for (const y of ys) {
        const r1 = this.rest(fh, { ...tip, y }, obstacles, solid);
        if (typeof r1 !== 'string' && mouthBelow(mouths, r1.pose)?.v === f.into) {
          res = r1;
          break;
        }
      }
      if (!res) {
        why = 'No room for a hose following it';
        break;
      }
      out.push(res);
      f.hose.outlet = { x: res.pose.x, y: res.pose.y, z: res.pose.z };
      ({ turn: f.hose.turn, reach: f.hose.reach } = res.hose!);
    }
    fs.forEach((f, i) => Object.assign(f.hose, saved[i]));
    this.placeHeld(h, at);
    if (h.kind === 'flask') h.f.tilt = tilt;
    return why ?? out;
  }

  /** Put the hoses following what's held back where they were before, rolling up any pulled out for it (see gather). */
  private unfollow(h: Held): void {
    for (const f of h.follow ?? []) {
      if (f.was) Object.assign(f.hose, { outlet: f.was.outlet, turn: f.was.turn, reach: f.was.reach });
      else this.hoses.splice(this.hoses.indexOf(f.hose), 1);
    }
    h.follow = [];
  }

  /**
   * Where a hose's nozzle, left where it is, would rest (see rest), with its stand where it's turned to go if there's
   * room, or else the first place there is; or why it can't. The tool `away` is about to be picked up, so it's no
   * obstacle.
   */
  private standFor(hose: Hose, away: Tool | null = null): Rest | string {
    const h: Held = { kind: 'hose', h: hose, reach: hose.reach, relYaw: wrapAngle(hose.turn - this.player.yaw), dist: 0 };
    return this.rest(h, { ...hose.outlet, yaw: 0 }, this.obstacles(h, true, away), this.obstacles(h, false, away));
  }

  /**
   * Take hold of a hose's nozzle, where it is: it's small, and the hose trails behind it, so it isn't brought near. Its
   * stand stays the way it was from it, and as far, until turned or slid. Q puts it back `from` where it was, by default
   * where it is now; a hose fresh out of its spout has nowhere to be put back to (null), so Q rolls it back up.
   */
  private holdHose(
    hose: Hose,
    from: Rest | null = { pose: { ...hose.outlet, yaw: 0 }, hose: { turn: hose.turn, reach: hose.reach } },
  ): void {
    this.mark();
    const h: Held = {
      kind: 'hose', h: hose, reach: hose.reach, relYaw: wrapAngle(hose.turn - this.player.yaw), dist: 0, from: from ?? undefined,
    };
    this.holdInPlace(h);
    this.held = h;
  }

  /**
   * Hold what's picked up just where it is, as the player sees it: it doesn't move until they do (see Held.dir). It
   * stays turned as it was from them, too (see Held.relYaw). But its middle is never held more than HOLD_CONE from
   * straight ahead: what's further off to a side (or behind) is brought round to that, so it's always in front of them.
   */
  private holdInPlace(h: Held): void {
    const c = this.boxAt(h, this.heldPose(h));
    const e = this.eye();
    const v = { x: c.x - e.x, y: c.y - e.y, z: c.z - e.z };
    h.dist = Math.max(1, Math.hypot(v.x, v.y, v.z));
    const { right, up, ahead } = this.viewAxes();
    const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
    const d = { x: dot(v, right) / h.dist, y: dot(v, up) / h.dist, z: dot(v, ahead) / h.dist };
    const side = Math.hypot(d.x, d.y);
    if (d.z < Math.cos(HOLD_CONE)) {
      const k = side > 1e-6 ? Math.sin(HOLD_CONE) / side : 0;
      h.dir = { x: d.x * k, y: d.y * k, z: side > 1e-6 ? Math.cos(HOLD_CONE) : 1 };
    } else h.dir = d;
  }

  /** Which ways are right, up and ahead, as the player looks, in the room. */
  private viewAxes(): { right: Vec3; up: Vec3; ahead: Vec3 } {
    const { yaw, pitch } = this.player;
    const ahead = this.lookDir();
    const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    const up = { x: Math.sin(yaw) * Math.sin(pitch), y: Math.cos(pitch), z: Math.cos(yaw) * Math.sin(pitch) };
    return { right, up, ahead };
  }

  /**
   * The spout or faucet the crosshair is on, to pull a hose out of: a faucet's spout or the pipe down to it (not its
   * knob, which is for its note), a tool's spout's tip, or the tool just above it (see spoutNear). Null if it's on
   * neither.
   */
  private mountAimed(): HoseMount | null {
    const p = this.target;
    if (p?.kind === 'faucet') return p.spout ? { faucet: p.i } : null;
    // nothing on the station can be worked through its changeover
    if (p?.kind !== 'tool' || !p.t.shape.spouts.length || p.t.swap !== null) return null;
    if (p.part === 'spout') return { tool: p.t, spout: p.k };
    const l = toLocal(p.t.pose, p.point);
    const j = spoutNear(p.t, l.x, -l.y);
    return j === null ? null : { tool: p.t, spout: j };
  }

  /**
   * Pull out the hose of a spout or faucet, and hold its nozzle where the spout is; or, if it's already out, bring its
   * nozzle back there from wherever it is (out of sight, perhaps), and hold it there just the same, though Q puts it
   * back where it was.
   */
  private pullHose(m: HoseMount): void {
    this.mark();
    const old = this.hoses.find((h) => sameMount(h.on, m));
    const hose = old ?? new Hose(m, this.mountAt(m), NOZZLE_REACH.min);
    const from: Rest | null = old ? { pose: { ...old.outlet, yaw: 0 }, hose: { turn: old.turn, reach: old.reach } } : null;
    hose.outlet = this.mountAt(m);
    // its stand starts out behind it, as the player faces
    hose.turn = toCardinal(this.player.yaw);
    if (!old) this.hoses.push(hose);
    this.holdHose(hose, from);
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
    this.setDown(h, pl.rest);
  }

  /**
   * Q: put back what's held where it was picked up from (see Held.from), as it was, or if it was made in hand, put it
   * away (see putAway); a hose just pulled out is rolled back up.
   */
  private putBack(): void {
    if (this.dozing()) return;
    const h = this.held;
    if (!h || inPod(this.wake)) return;
    if (!h.from) return this.putAway();
    this.hoses = this.hoses.filter((x) => !h.made?.includes(x));
    this.unfollow(h);
    this.setDown(h, h.from);
  }

  /** Let go of what's held, at rest (see rest): standing on a scale, for a flask, and for a nozzle, with its stand there. */
  private setDown(h: Held, rest: Rest): void {
    this.placeHeld(h, rest.pose);
    // a tool's hose whose nozzle is right where its spout now is, as one left there when it was picked up and it's
    // put back, is rolled back up
    if (h.kind === 'tool')
      this.hoses = this.hoses.filter((x) => !('tool' in x.on && x.on.tool === h.t && dist3(x.outlet, spoutAt(h.t, x.on.spout)) < 1));
    if (h.kind === 'flask') {
      h.f.tilt = 0;
      if (rest.scale) {
        rest.scale.sc.put(h.f, rest.scale.dx);
        this.settle();
      }
    }
    if (h.kind === 'hose' && rest.hose) ({ turn: h.h.turn, reach: h.h.reach } = rest.hose);
    h.follow?.forEach((f, i) => {
      const fr = rest.follow?.[i];
      if (!fr) return;
      f.hose.outlet = { x: fr.pose.x, y: fr.pose.y, z: fr.pose.z };
      ({ turn: f.hose.turn, reach: f.hose.reach } = fr.hose!);
    });
    this.held = null;
    this.pinned = null;
    this.commit();
  }

  private leftDown(shift: boolean): void {
    if (this.dozing()) return;
    const p = this.target;
    if (p?.kind === 'wake') {
      this.pressOk();
      return;
    }
    if (inPod(this.wake)) return;
    // with empty hands, a spout or faucet's hose is pulled out, or its nozzle taken hold of if it's out, and so is a
    // nozzle looked at
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
      this.change(() => this.setAlarmsOff(!this.alarmsOff));
      return;
    }
    if (p?.kind === 'blinds') {
      this.change(() => (this.blindsShut = !this.blindsShut));
      return;
    }
    if (p?.kind === 'scale' && p.part === 'tare') {
      this.change(() => p.sc.zero());
      this.tarePress = p.sc;
      return;
    }
    // anywhere else, what's held is set down, or with empty hands, what's looked at picked up
    if (this.held) this.release();
    else if (p && this.grabbable(p)) this.grabOrRelease(shift);
  }

  /**
   * Write a note about what the crosshair is on, if it can have one (see targetNote): the mouse is let go, to type it.
   * In god mode a flask or tank opens the editor instead, which has a field for its label.
   */
  private writeNote(): void {
    if (this.dozing()) return;
    const id = this.targetNote();
    if (!id || inPod(this.wake)) return;
    document.exitPointerLock();
    if (this.god && /^(f\d+|t\d+\.\d+)$/.test(id)) this.cb.onEdit(id);
    else this.cb.onLabel(id);
  }

  /**
   * The id of the note (see note) for what the crosshair is on: a tool, by the tank looked at, or the one tank it has,
   * or else (with no tank, or more than one) its own note; a flask; a scale; or a faucet. A hose has none.
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
    if (p.kind === 'faucet') return `F${p.i}`;
    return null;
  }

  private rightDown(): void {
    if (this.dozing()) return;
    if (inPod(this.wake)) return;
    this.rightHeld = true;
    const h = this.held;
    if (h?.kind === 'flask') {
      // on a flask or tank, the held flask goes over it to pour in
      const m = this.mouthAimed();
      this.pinned = m && this.pourPose(h, m);
      if (this.pinned) {
        this.placeHeld(h, this.pinned);
        this.faceFlask(h.f);
      }
    }
    // a strip aimed at an open top goes all the way in, however soon the button's let go
    if (h?.kind === 'tool' && h.t.kind === 'strip' && this.mouthAimed()) this.tapping = true;
    if (h) return;
    const k = this.valveAimed();
    if (!k) return;
    this.mark();
    this.turning = { ...k, aim: { x: this.viewW / 2, y: this.viewH / 2 } };
    this.aimTurning();
  }

  /** The open top of the vessel the crosshair is on, to pour a held flask into: a flask's, or a tool's tank's. */
  private mouthAimed(): Mouth | null {
    const p = this.target;
    const v = p?.kind === 'flask' ? p.f : p?.kind === 'tool' && p.part === 'tank' ? p.t.tanks[p.k] : null;
    return (v && this.open.find((m) => m.v === v)) ?? null;
  }

  /**
   * Where the held flask would pour into mouth m from: facing the player (see faceFlask), with its lip, tipped all the
   * way, over the mouth's middle, POUR_GAP above it, or higher if that's what it takes to bump into nothing; null if
   * it can't within POUR_RISE, or what it would pour from there would land in something else.
   */
  private pourPose(h: Held & { kind: 'flask' }, m: Mouth): Pose | null {
    const obstacles = this.obstacles(h);
    const yaw = Math.atan2(this.player.x - m.x, this.player.z - m.z);
    const lip = toWorld({ x: 0, y: 0, z: 0, yaw }, { x: FLASK_LIP * Math.cos(POUR_ANG), y: -FLASK_LIP * Math.sin(POUR_ANG), z: 0 });
    const others = this.open.filter((o) => o.v !== h.f);
    for (let up = POUR_GAP; up <= POUR_RISE; up += 10) {
      const pose = { x: m.x - lip.x, y: m.y + up - lip.y, z: m.z - lip.z, yaw };
      if (obstacles.some((o) => boxesOverlap(this.boxAt(h, pose), o))) continue;
      return mouthBelow(others, { x: m.x, y: m.y + up, z: m.z }) === m ? pose : null;
    }
    return null;
  }

  /**
   * Where a held nozzle goes with the crosshair on an open top (see mouthAimed): over the mouth's middle, on the grid,
   * NOZZLE_GAP above it or as much higher as it takes (up to POUR_RISE) for it and its stand to have room, so it can
   * be set down there and what it lets out lands in the mouth. Null if there's no such place.
   */
  private nozzleOver(h: Held & { kind: 'hose' }): Pose | null {
    const m = this.mouthAimed();
    if (!m) return null;
    const obstacles = this.obstacles(h);
    const solid = this.obstacles(h, false);
    for (let up = NOZZLE_GAP; up <= POUR_RISE; up += 10) {
      const p = onGrid({ x: m.x, y: m.y + up, z: m.z, yaw: 0 });
      const r = this.rest(h, p, obstacles, solid);
      if (typeof r !== 'string') return mouthBelow(this.open, r.pose) === m ? p : null;
    }
    return null;
  }

  /**
   * Where a held dipper (see DIPPERS) goes with the crosshair on an open top (see mouthAimed): upright, facing as it's
   * held, over the middle of the mouth, on the grid, hovering a little above it, or dipped into it, its foot just
   * under the fluid's surface (see dipPoses); and where it would be set down standing in it, deeper (see dipPoses and
   * rest), or why it can't be. Null if the crosshair is on no open top.
   */
  private dipAim(h: Held & { kind: 'tool' }): { hover: Pose; dipped: Pose; rest: { rest: Rest } | { why: string } } | null {
    const p = this.target;
    const m = this.mouthAimed();
    if (!m || (p?.kind !== 'flask' && p?.kind !== 'tool')) return null;
    const fluid = p.kind === 'flask' ? flaskFluid(p.f) : tankFluid(p.t, p.k);
    const { hover, dipped, stood } = dipPoses(h.t, m, fluid, toCardinal(this.player.yaw + h.relYaw));
    const r = this.rest(h, stood, [...this.obstacles(h), this.me()], [...this.obstacles(h, false), this.me()]);
    return { hover, dipped, rest: typeof r === 'string' ? { why: r } : { rest: r } };
  }

  /** The player's body, as a box, which what's set down mustn't overlap. */
  private me(): Box {
    const { x, z } = this.player;
    return { x, y: (EYE + 20) / 2, z, yaw: 0, hx: PLAYER_R, hy: (EYE + 20) / 2, hz: PLAYER_R, round: true };
  }

  /**
   * The valve the crosshair is on, or within VALVE_REACH of on its tool's front face (see valveNear), if any. Where
   * valves crowd together, the nearest.
   */
  private valveAimed(): { t: Tool; k: number } | null {
    const p = this.target;
    if (p?.kind !== 'tool' || p.t.shape.noValve || p.t.swap !== null) return null;
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

  /** Where a tool's machinery sounds from: the middle of its cabinet, or the supply station's display. */
  private machineAt(t: Tool): Vec3 {
    if (t.shape.wall) {
      const d = STATION.display;
      return onTool(t, (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, -STATION.out);
    }
    if (t.kind === 'analyzer') {
      const b = INSTRUMENT.body;
      return onTool(t, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
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
   * fills first; a swell bulb fills its bulb, then its neck; a heater's tube holds a shallow stream along its floor.
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
        if (sh.neck) {
          // as it's drawn: its depth, and the side of a square as big across as it is on average
          const ps = tankPieces(sh, k, W);
          const h = levelIn(ps, share(v));
          out.push([v, exposure(h, Math.sqrt((share(v) * spaceOf(ps)) / h))]);
        } else if (sh.cup) {
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
    // (the station's funnel is back in the wall through a changeover)
    for (const t of this.tools) if (!t.away) t.tanks.forEach((_, k) => t.isOpen(k) && out.push(tankMouth(t, k)));
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
    // a fluid's volume is never more than its atoms, so most vessels needn't be measured
    if (v.N <= v.cap) return;
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
    // a nap: their eyes close, or open again, in their own time
    const nap = this.napping;
    // (the alarm of the station's changeover wakes them, even as they nod off)
    if (nap && !nap.waking && this.station().swap !== null) this.wakeNap();
    if (nap) {
      nap.lids = Math.max(0, Math.min(1, nap.lids + (nap.waking ? -dt / NAP_S.open : dt / NAP_S.close)));
      if (nap.waking && nap.lids <= 0) this.napping = null;
    }
    // asleep, the screen is black: nothing to draw, and the lab runs on its own (see fallAsleep)
    if (this.asleep()) {
      if (!this.sleeping) this.fallAsleep();
      this.hud(now);
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    // nodding off, they stand where they are
    if (!nap || nap.waking) this.move(dt);
    if (this.wake === 'settling') this.settleIn(dt);
    if (this.held) this.follow(this.held);
    this.view.look(this.eye(), this.player.yaw, this.player.pitch);
    if (!this.turning) this.target = this.previewing ? null : this.view.pick(REACH, this.heldObject());
    this.simulate(dt);
    // the end stands the lab still as it was when there was enough, so it goes on in real time
    if (this.arrival && this.wake !== 'pod') this.stepWake(dt);
    if (this.riseT !== null) this.riseT = this.riseT + dt >= RISE_S ? null : this.riseT + dt;
    this.render(dt);
    this.inspect(now);
    this.hud(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Walk, and carry: what's held follows the eyes, through anything in its way (see placement for where it goes). */
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
    // shut in the pod, or in the preview of the end, they can only look
    if (inPod(this.wake) || this.previewing) return;
    const h = this.held;
    if (fwd || side) {
      // keys walk at full speed whichever way; the move stick as far as it's pushed
      const len = Math.hypot(fwd, side);
      const sp = (WALK * dt * Math.min(1, len)) / len;
      const dx = (-Math.sin(p.yaw) * fwd + Math.cos(p.yaw) * side) * sp;
      const dz = (-Math.cos(p.yaw) * fwd - Math.sin(p.yaw) * side) * sp;
      const body = { x: p.x, z: p.z, r: PLAYER_R, y0: 0, y1: EYE + 20 };
      const r = walk(body, dx, dz, this.obstacles(h));
      p.x = r.x;
      p.z = r.z;
      // walking into the open pod is getting into it, to sleep
      if (this.wake === 'open' && Math.hypot(p.x - POD.x, p.z - POD.z) < POD.r) {
        this.board();
        return;
      }
    }
    if (h?.kind !== 'flask' || !this.rightHeld) this.pinned = null;
    // a nozzle held with the crosshair on an open top goes straight over it, where it would be set down to pour in;
    // and a strip or a thermometer hovers over it, and lowers into it while the right button's held, or, a strip, until
    // it's all the way in from a tap
    const aim = h?.kind === 'tool' && isDipper(h.t.kind) ? this.dipAim(h) : null;
    if (!aim) this.tapping = false;
    this.dip = aim ? Math.max(0, Math.min(1, this.dip + ((this.rightHeld || this.tapping ? 1 : -1) * dt) / DIP_S)) : 0;
    if (!h) return;
    const lower = ease(this.dip);
    const over = h.kind === 'hose' ? this.nozzleOver(h)
      : aim ? { ...aim.hover, y: aim.hover.y + (aim.dipped.y - aim.hover.y) * lower, x: aim.dipped.x, z: aim.dipped.z }
      : null;
    if (over) {
      this.placeHeld(h, over);
      return;
    }
    // what's held goes where it'd be in front of the eyes (or a flask pouring into something, over it), turned as
    // it's held
    this.placeHeld(h, this.pinned ?? this.gripPose(h));
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

  /**
   * Whether spout j of tool t is a held tool's with no hose out: what leaves it goes straight down the drain, so
   * nothing it's carried over catches it.
   */
  private loose(t: Tool, j: number): boolean {
    return this.held?.kind === 'tool' && this.held.t === t && !this.hoseOn({ tool: t, spout: j });
  }

  /** The thing the player holds, as the view knows it. */
  /**
   * Whether letting go of what's held would put it in the equipment cabinet: it's aimed at the cabinet, or at
   * something in it, and it's something the cabinet holds.
   */
  private intoCabinet(): boolean {
    const h = this.held;
    const p = this.target;
    if (!h || h.kind === 'hose' || (p?.kind !== 'cabinet' && p?.kind !== 'stock')) return false;
    return isStocked(h.kind === 'tool' ? h.t.kind : h.kind);
  }

  private heldObject(): object | null {
    const h = this.held;
    if (!h) return null;
    if (h.kind === 'flask') return h.f;
    if (h.kind === 'tool') return h.t;
    if (h.kind === 'scale') return h.sc;
    return h.h;
  }

  /**
   * Run the lab for a frame of dt real seconds; or, `quiet`, for dt sim seconds with nothing drawn or heard, as while
   * the player sleeps (see Sleeper.advance).
   */
  private simulate(dt: number, quiet = false): void {
    this.spills.clear();
    this.inflow.clear();
    this.landed = [];
    this.pour = null;
    // the lab waits for the player to press OK in the pod, as it did through the rest of the intro
    // and once there's enough cryostabilizer, the lab stands still as it was then, through the end
    const simDt = quiet ? dt : this.wake === 'pod' || this.arrival ? 0 : dt * this.speed;
    this.spin = (this.spin + SPIN * simDt) % (2 * Math.PI);
    this.clock += simDt;
    const mouths = (this.open = this.mouths());
    const h = this.held;

    // the held flask, tipped all the way, pours from its lip into whatever's below
    const D = h?.kind === 'flask' && this.rightHeld && h.f.tilt >= POUR_ANG * 0.97 ? h.f : null;
    if (D && simDt > 0) {
      const from = flaskLip(D);
      this.pour = { from, into: mouthBelow(mouths, from) };
    }

    // a hose's nozzle in hand lets nothing out without the right button: the tool or faucet it's pulled out of stops
    let stillTool: Tool | null = null;
    let stillFaucet: number | null = null;
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

    this.clearStation();
    const gateFrom = this.tools.map((t) => t.gate);
    const steadyFrom = this.station().steady;
    const vessels = this.vessels();
    // how exposed each one's fluid is to the room, from how it stands now; it hardly changes in a frame
    const exposures = simDt > 0 ? this.exposures() : [];
    // what each thermometer's bulb and each strip's foot is in (see dipping)
    const whole = this.tools.map((t) => !t.broken);
    this.dipping(quiet ? 0 : dt);
    if (simDt > 0) {
      const sub = Math.ceil(simDt / 0.02);
      const step = simDt / sub;
      // where each spout's fluid comes out: the spout, or its hose's nozzle
      const spouts = this.tools.map((t) => t.shape.spouts.map((_, j) => this.outletAt(t, j)));
      // a held tool keeps running, but what leaves a spout of it with no hose out goes down the drain, not into
      // whatever it's swung over (see loose)
      const targets = this.tools.map((t, i) => spouts[i].map((sp, j) => (this.loose(t, j) ? null : mouthBelow(mouths, sp))));
      // a fast flow streams straight into what's below (overflowing it if it's full); a slow one gathers
      // in a drop, which falls on its own time
      const pour = (drop: Vessel, out: Vessel | null, sp: Vec3, target: Mouth | null, loose: boolean): boolean => {
        const down = drip(drop, out, step);
        if (down && down === out) {
          if (target) this.stream(target.v, out);
        } else if (down && !loose) this.falling.push({ v: down, x: sp.x, y: sp.y, z: sp.z, vy: 0 });
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
            if (quiet) {
              pour(t.drops[k], out, spouts[j][k], targets[j][k], this.loose(t, k));
              return;
            }
            tally(toolTotals[j][k], out, false); // before pouring, which can gather it into a drop
            tally(toolTotals[j][k], null, pour(t.drops[k], out, spouts[j][k], targets[j][k], this.loose(t, k)));
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
          let lag = this.lags.get(v);
          if (!lag) this.lags.set(v, (lag = new Lag()));
          this.chem.tick(v, step, lag);
          // by molecules, breaking bonds swells a fluid, and whatever no longer fits spills
          this.overflow(v);
        }
        for (const [v, e] of exposures) cool(v, e, step);
      }
      if (!quiet) this.tools.forEach((t, j) =>
        toolTotals[j].forEach(({ v, streamed }, k) => {
          t.out[k] = v.N > 0 ? v : null;
          t.flow[k] = volume(v) / (MAX_FLOW * simDt);
          t.streaming[k] = streamed;
        }),
      );
    }
    this.spillTime = simDt;
    if (quiet) {
      // nothing's drawn, and what a tool's step handed out is its own, good only until its next step (see Tool.step)
      for (const t of this.tools) {
        t.out.fill(null);
        t.flow.fill(0);
        t.streaming.fill(false);
      }
      return;
    }

    // an analyzer hums quietly while it has something to read, on sim time, so silent while paused
    for (const t of this.tools) {
      if (t.kind !== 'analyzer' || !t.reading || this.rumbles.has(t)) continue;
      this.rumbles.set(t, rumble(this.hear(this.machineAt(t))));
    }
    for (const [t, r] of this.rumbles) {
      if (!this.tools.includes(t) || !t.reading) {
        r.stop(); // done, put away, or the lab was replaced
        this.rumbles.delete(t);
        continue;
      }
      r.place(this.hear(this.machineAt(t)));
      r.level(simDt > 0 ? ANALYZER_HUM : 0);
    }

    // the station's diverter goes by sim time too: a clunk as it swings
    this.tools.forEach((t, j) => {
      if (t.kind !== 'receptacle') return;
      const swung = t.gate !== gateFrom[j];
      if (swung && !this.diverters.has(t)) this.diverters.set(t, diverter(this.hear(this.machineAt(t))));
      const d = this.diverters.get(t);
      if (!d) return;
      d.place(this.hear(this.machineAt(t)));
      if (swung) d.swing(t.gate === 'reservoir');
    });
    for (const [t, d] of this.diverters)
      if (!this.tools.includes(t) || t.sinceFlow >= DIVERTER_HOLD + 1) {
        d.stop(); // quiet a while, or the lab was replaced
        this.diverters.delete(t);
      }
    this.changeoverSounds(simDt);
    // a thermometer whose bulb got too hot shatters, with a crack of glass, on sim time like what broke it
    this.tools.forEach((t, j) => {
      if (t.broken && whole[j]) shatter(this.hear(footAt(t)));
    });
    // and it chimes as it's been delivering steadily for long enough to open the airlock
    const st = this.station();
    if (st.supply.airlock && steadyFrom < DELIVERY.streak && st.steady >= DELIVERY.streak) chime(this.hear(this.machineAt(st)));

    // fluid's sounds, each heard from where it lands: a stream from the mouth it runs into
    const streams = new Map<Vessel, { flow: number; full: number; at: Placement }>();
    for (const [v, amount] of this.inflow) {
      const m = this.open.find((mo) => mo.v === v);
      streams.set(v, { flow: amount / simDt, full: volume(v) / v.cap, at: m ? this.hear(m) : CENTER });
    }
    this.water.update(dt, this.landed.map((p) => this.hear(p)), streams);

    this.napHint();
  }

  /**
   * The first time the station has delivered steadily for DELIVERY.nap, whatever it's fitted for, a note says the
   * player can nap, as they can from then on (see nap).
   */
  private napHint(): void {
    const st = this.station();
    if (!this.napKnown && st.steady >= DELIVERY.nap) {
      this.napKnown = true;
      const text = 'Steady delivery. Press N to nap while it runs.';
      this.flash = { text, until: performance.now() + NAP_HINT_MS, tip: true };
    }
  }

  /**
   * The station's changeover is heard on sim time too (see changeover.ts): its alarm sounding on and off; a rumble
   * while the block or the door slides, and a duller one while the door's shut, with the next block being brought
   * behind it; and a clunk as the block unlatches, as the door shuts, as it lifts again, as the next block is set
   * down behind it, and as that seats in the wall.
   */
  private changeoverSounds(simDt: number): void {
    const st = this.station();
    if (st.swap === null) {
      this.changing?.sound.stop();
      this.changing = null;
      return;
    }
    const at = changeoverAt(st.swap);
    const from = this.hear(this.machineAt(st));
    const c = (this.changing ??= { sound: changeover(from), part: at.part, supply: st.supply });
    c.sound.place(from);
    const { part } = at;
    const rumble = part === 'retract' || part === 'extend' ? 0.8 : part === 'shut' || part === 'open' ? 0.5 : part === 'away' ? 0.35 : 0;
    c.sound.run(simDt > 0 && at.alarm, simDt > 0 ? rumble : 0, part === 'away');
    if (part !== c.part && (part === 'retract' || part === 'away' || part === 'open' || part === 'clear')) c.sound.clunk(false);
    if (st.supply !== c.supply) c.sound.clunk(true);
    c.part = part;
    c.supply = st.supply;
  }

  /**
   * Through the station's changeover (see CHANGEOVER), nothing of it can be worked: its hoses are rolled up, a hose of
   * its in hand is let go of, and so is its valve if it's being turned.
   */
  private clearStation(): void {
    const st = this.station();
    if (st.swap === null) return;
    const its = (h: Hose) => 'tool' in h.on && h.on.tool === st;
    if (this.turning?.t === st) this.endTurn();
    const held = this.held?.kind === 'hose' && its(this.held.h);
    this.hoses = this.hoses.filter((h) => !its(h));
    if (held) {
      this.held = null;
      this.pinned = null;
      this.commit();
    }
  }

  /**
   * Each outlet that lines up with one of `mouths`, for the guides: from each outlet of what's held (a flask's lip,
   * tipped as it would be to pour; a tool's spouts; a hose's nozzle) to the mouth it would land in; and the same from
   * every other outlet (spouts, nozzles, faucets) to what's held.
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
      const m = mouthBelow(mouths, from);
      if (!m || mine.has(m.v) !== (held === 'mouth')) return;
      out.push({ from, m, held });
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
    if (h.kind === 'hose') return docked(onGrid(p), this.tools);
    return onGrid(p);
  }

  /**
   * Where what's held would come to rest if let go now (see rest): on the grid (see gridded), in the cell under where
   * it's held if it can rest there, or else the nearest cell, no more than SEEK cells off, where it can, clear of the
   * player too. If it can't rest anywhere near, why not where it's held.
   */
  private placement(h: Held): { rest: Rest } | { why: string } {
    // a strip or a thermometer aimed at an open top is set down standing in it
    const aim = h.kind === 'tool' && isDipper(h.t.kind) ? this.dipAim(h) : null;
    if (aim) return aim.rest;
    const p = this.heldPose(h);
    const me = this.me();
    const obstacles = [...this.obstacles(h), me];
    const solid = [...this.obstacles(h, false), me];
    // each cell's spot, nearest where it's held first; that's the cell it's held over
    const spots: Pose[] = [];
    for (let i = -SEEK; i <= SEEK; i++)
      for (let j = -SEEK; j <= SEEK; j++) {
        const g = this.gridded(h, { ...p, x: p.x + i * CELL, z: p.z + j * CELL });
        if (Math.hypot(g.x - p.x, g.z - p.z) <= SEEK * CELL) spots.push(g);
      }
    spots.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    let why: string | null = null;
    for (const g of spots) {
      const r = this.rest(h, g, obstacles, solid);
      const follow = typeof r === 'string' || !h.follow?.length ? null : this.followRests(h, r);
      const out = typeof r === 'string' ? r : typeof follow === 'string' ? follow : { rest: follow ? { ...r, follow } : r };
      if (typeof out !== 'string') return out;
      why ??= out;
    }
    return { why: why! };
  }

  /**
   * Where what's held, at pose p, would come to rest if let go, or why it can't. Only squarely on a counter: a flask,
   * a scale or a tool that stands on the bench goes straight up or down until it stands on the counter under it, which
   * its whole footprint must be over (or a flask over a scale, onto its platform); a tool or hose's nozzle on a stand
   * stays at the height it's held, no higher than its stand reaches and no lower than the top of a counter it's held
   * sunk into, while its stand's base goes down onto the counter, which the whole base must be over (what it holds can
   * reach out past the counter's edge). Either way, it mustn't overlap anything where it comes to rest (what's held passes through everything, so there's no way down to look
   * at), nor its stand's base sit on anything but the counter. (Stands don't bump into each other: their rods can stand side by side.) A hose's
   * nozzle's stand goes where it's wanted (see nozzleWant) if it can, or else the first place it can of nozzleMounts.
   */
  private rest(h: Held, p: Pose, obstacles: readonly Box[], solid: readonly Box[]): Rest | string {
    const blocked = (b: Box) => obstacles.some((o) => boxesOverlap(b, o));
    const box = this.boxAt(h, p);
    const onStands = (stands: Stand[]): Rest | string => {
      const tops = stands.map((st) => counterUnder(standBase(st, 0)));
      if (tops.some((t) => t === null)) return 'Its stand needs a counter under it';
      let dy = -Math.max(0, ...stands.map((st, i) => st.clampY - tops[i]! - STAND_MAX));
      // held sunk into a counter, it comes up to stand on it: all of a strip or a thermometer, though its lower part
      // bumps into nothing else
      const sunk = LIFT - (box.y + dy - box.hy);
      const solidBox = h.kind === 'tool' && isDipper(h.t.kind) ? { ...box, parts: undefined } : box;
      if (sunk > 0 && COUNTER_BOXES.some((c) => boxesOverlap({ ...solidBox, y: box.y + dy }, c))) dy += sunk;
      const to = { ...box, y: box.y + dy };
      if (blocked(to)) return 'No room';
      if (stands.some((st, i) => solid.some((o) => boxesOverlap(standBase(st, tops[i]!), o)))) return 'No room for its stand';
      return { pose: { ...p, y: p.y + dy } };
    };
    if (h.kind === 'hose') {
      // the nozzle itself is in the way, wherever its stand goes
      const at = onStands([]);
      if (typeof at === 'string') return at;
      let why: string | null = null;
      for (const m of nozzleMounts(this.nozzleWant(h))) {
        const r = onStands([nozzleStand(p, m.turn, m.reach)]);
        if (typeof r !== 'string') return { ...r, hose: m };
        why ??= r;
      }
      return why!;
    }
    const stands = this.standsAt(h, p);
    if (stands.length) return onStands(stands);
    if (h.kind === 'flask')
      for (const sc of this.scales) {
        const dx = scaleSpot(sc, p, Infinity);
        if (dx === null) continue;
        const pose = onScale(sc, dx);
        const to = this.boxAt(h, pose);
        return blocked(to) ? 'No room' : { pose, scale: { sc, dx } };
      }
    const top = counterUnder(box);
    if (top === null) return 'Set it down on a counter';
    const dy = box.y - box.hy - top;
    const to = { ...box, y: box.y - dy };
    if (blocked(to)) return 'No room';
    return { pose: { ...p, y: p.y - dy } };
  }

  /**
   * The stands that would hold up what's held, at pose p: none for what stands on the bench, and for a hose's nozzle,
   * where its stand would go if it were set down there (see rest), or where it's wanted if it can't be.
   */
  private standsAt(h: Held, p: Pose, rest?: Rest): Stand[] {
    if (h.kind === 'tool') return toolStands(h.t, p);
    if (h.kind !== 'hose') return [];
    const m = rest?.hose ?? this.nozzleWant(h);
    return [nozzleStand(p, m.turn, m.reach)];
  }

  /**
   * Where a held nozzle's stand is wanted: turned with the player like anything held (in quarter turns, so the nozzle
   * faces the way along the grid nearest how it's turned from them, with the stand behind it), as far behind as its
   * clamp's arm is slid.
   */
  private nozzleWant(h: Held & { kind: 'hose' }): NozzleMount {
    return { turn: toCardinal(this.player.yaw + h.relYaw), reach: snapReach(h.reach) };
  }

  /** Every stand in the lab, with what it holds up; but none for a dipper (see DIPPERS) while it's in hand. */
  private stands(): { s: Stand; of: Pick }[] {
    const out: { s: Stand; of: Pick }[] = [];
    const held = this.held;
    for (const t of this.tools) {
      // a strip or a thermometer in hand is just itself: its stand is there once it's set down
      if (held?.kind === 'tool' && held.t === t && isDipper(t.kind)) continue;
      for (const s of toolStands(t)) out.push({ s, of: { kind: 'tool', t, part: 'body', k: 0 } });
    }
    const pl = this.placed;
    const follow = held?.follow ?? [];
    for (const h of this.hoses) {
      // one held stands where it would be set down (see standsAt), and so does one following what's held (see gather),
      // if it can be, or else it has none for now
      const k = follow.findIndex((f) => f.hose === h);
      let s: Stand | undefined;
      if (k >= 0) {
        const r = pl && 'rest' in pl ? pl.rest.follow?.[k] : undefined;
        if (r) s = nozzleStand(r.pose, r.hose!.turn, r.hose!.reach);
      } else if (held?.kind === 'hose' && held.h === h) s = this.standsAt(held, this.heldPose(held), pl && 'rest' in pl ? pl.rest : undefined)[0];
      else s = nozzleStand(h.outlet, h.turn, h.reach);
      if (s) out.push({ s, of: { kind: 'hose', h } });
    }
    return out;
  }

  /**
   * Guides for lining up what's held (see aims), shown only while something's held, since that's when things are
   * being lined up: gray from a held flask's lip to where it would pour; and green, as it will be once let go and set
   * down on the grid, wherever fluid would land in a mouth then. Each ends at the vessel that would take the fluid,
   * which flashes green.
   */
  private guides(pl: ReturnType<GameEngine['placement']> | null): Frame['guides'] {
    const h = this.held;
    if (!h) return [];
    const guide = (a: Aim, look: GuideLook): Frame['guides'][number] => {
      const { x, y, z, hx, hz, yaw = 0 } = a.m;
      return { from: a.from, toY: y, look, mouth: { x, y, z, hx, hz, yaw }, v: a.m.v };
    };
    const out = this.aims(h, this.open).filter((a) => a.held === 'lip').map((a) => guide(a, 'solid'));
    if (pl && 'rest' in pl) {
      // what it'll line up with once let go: put it there, upright, for a moment, to see
      const at = this.heldPose(h);
      const tilt = h.kind === 'flask' ? h.f.tilt : 0;
      if (h.kind === 'flask') h.f.tilt = 0;
      this.placeHeld(h, pl.rest.pose);
      for (const a of this.aims(h, this.mouths())) if (a.held !== 'lip') out.push(guide(a, 'snap'));
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
    const base = (st: Stand) => {
      const b = standBase(st, ok ? (counterUnder(standBase(st, 0)) ?? groundAt(st.x, st.z)) : groundAt(st.x, st.z));
      return { x: b.x, y: b.y - b.hy, z: b.z, hx: b.hx, hz: b.hz, yaw: b.yaw, ok };
    };
    // the stands of the hoses following it (see gather), where they'd go
    const follow = ok ? (pl.rest.follow ?? []).map((r) => base(nozzleStand(r.pose, r.hose!.turn, r.hose!.reach))) : [];
    const stands = this.standsAt(h, p, ok ? pl.rest : undefined);
    if (stands.length) return [...stands.map(base), ...follow];
    const b = this.boxAt(h, p);
    const y = ok ? b.y - b.hy : groundAt(b.x, b.z);
    return [{ x: b.x, y, z: b.z, hx: b.hx, hz: b.hz, yaw: b.yaw, ok }, ...follow];
  }

  private render(dt: number): void {
    const mouths = this.open;
    const streams: Frame['streams'][number][] = [];
    for (const t of this.tools)
      t.out.forEach((out, k) => {
        if (!out || !t.streaming[k]) return;
        const sp = this.outletAt(t, k);
        streams.push({ from: sp, toY: this.loose(t, k) ? groundAt(sp.x, sp.z) : this.landsAt(sp, mouths), fluid: out, flow: t.flow[k] });
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
    const pl = (this.placed = h ? this.placement(h) : null);
    // each hose from its spout or faucet to its nozzle, with what's running through it
    const hoses = this.hoses.map((hose) => {
      const on = hose.on;
      const fluid = 'tool' in on ? on.tool.out[on.spout] : (this.faucetFlows.find((f) => f.fa === this.faucets[on.faucet])?.fa.output ?? null);
      return { h: hose, from: this.mountAt(on), fluid };
    });
    this.view.render({
      eye: this.eye(), yaw: this.player.yaw, pitch: this.player.pitch,
      flasks: this.flasks, tools: this.tools, scales: this.scales, hoses, faucets: this.faucets, stock: this.stock,
      streams, drops,
      tarePress: this.tarePress, hot: this.hot(), dt, clock: this.clock,
      energies: BOND_KEYS.map((k) => this.chem.params.bonds[k].E), alarmsOff: this.alarmsOff, blindsShut: this.blindsShut, spin: this.spin,
      airlock: this.airlockLook(),
      guides: this.guides(pl), footprints: this.footprints(pl), stands: this.stands(),
    });
  }

  /**
   * What's outlined: what the crosshair is on, but the whole equipment cabinet while what's held would go into it,
   * and nothing for the cabinet itself otherwise.
   */
  private hot(): Pick | null {
    const p = this.target;
    if (this.held) return this.intoCabinet() ? { kind: 'cabinet' } : p?.kind === 'cabinet' || p?.kind === 'stock' ? null : p;
    return p?.kind === 'cabinet' ? null : p;
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
    // and so does an equipment wheel, until its key's let go
    if (this.wheel) {
      add(['Mouse'], 'point at what to take');
      add([WHEEL_KEYS[this.wheel.which]], 'let go to take it');
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
    if (h) {
      const ok = !!this.placed && 'rest' in this.placed;
      const how = h.kind === 'hose' ? 'set the hose’s end down'
        : h.kind === 'tool' && isDipper(h.t.kind) && this.mouthAimed() ? 'stand it in it'
        : 'set it down';
      // a button looked at takes the click
      if (this.intoCabinet()) add(['LMB'], 'put it in the cabinet');
      else if (!this.onButton()) add(['LMB'], ok ? how : `${how}: not here`, !ok);
      if (this.rightWouldDo())
        add(
          ['RMB'],
          h.kind === 'tool' ? (h.t.kind === 'strip' ? 'tap to dip it, hold to soak it' : 'hold to dip it in')
          : h.kind !== 'flask' ? 'hold to let it flow'
          : this.mouthAimed() ? 'hold to pour into it'
          : 'hold to pour',
        );
      if (h.kind === 'hose') {
        add(['Shift', '←→'], 'swing its stand round');
        add(['Shift', '↑↓'], 'slide its stand out or in');
      } else if (h.kind !== 'flask') add(['Shift', '←→'], 'turn it');
      add(['Wheel'], 'hold it nearer or further');
      if (h.kind === 'hose') add(['Backspace'], 'roll the hose back up');
      else if (!(h.kind === 'tool' && UNIQUE_TOOLS.includes(h.t.kind))) add(['Backspace'], 'put it back in the cabinet');
      add(['Q'], !h.from ? (h.kind === 'hose' ? 'roll the hose back up' : 'put it back in the cabinet') : 'put it back');
    } else {
      if (this.rightWouldDo()) add(['RMB'], 'hold and point to turn the valve');
      add([WHEEL_KEYS.join(', ')], 'hold to grab equipment');
    }
    if (p?.kind === 'alarm') add(['LMB'], this.alarmsOff ? 'let the alarms sound again' : 'silence the alarms');
    else if (p?.kind === 'blinds') add(['LMB'], this.blindsShut ? 'open the blinds' : 'shut the blinds');
    else if (this.pressable()) add(['LMB'], 'press it');
    const m = h ? null : this.mountAimed();
    if (m) add(['LMB'], this.hoseOn(m) ? 'take hold of its hose' : 'pull out its hose');
    else if (!h && p?.kind === 'hose') add(['LMB'], 'take hold of it');
    else if (!h && p && this.grabbable(p) && !this.onButton()) {
      add(['LMB'], 'pick it up');
      if (this.hooked(p)) add(['Shift', 'LMB'], 'pick it up still hooked up');
    }
    const id = this.targetNote();
    if (id) add(['Enter'], this.god && /^(f\d+|t\d+\.\d+)$/.test(id) ? 'edit it (god mode)' : 'write a note about it');
    if (this.canNap()) add(['N'], 'nap');
    if (!h && this.history.canUndo) add([MOD, 'Z'], 'undo');
    if (!h && this.history.canRedo) add([MOD, 'Shift', 'Z'], 'redo');
    add(['Esc'], 'let go of the mouse');
    add(['/'], 'hide this list');
    return out;
  }

  private setAlarmsOff(off: boolean): void {
    this.alarmsOff = off;
    hushAlarms(off);
  }

  /**
   * Whether the left button would do something (see leftDown): press the key or button the crosshair is on, or else set
   * down what's held, if it can be, or with empty hands, pull out a hose or pick up what's looked at.
   */
  private leftWouldDo(): boolean {
    if (this.onButton()) return this.pressable();
    if (this.held) return this.intoCabinet() || (!!this.placed && 'rest' in this.placed);
    const p = this.target;
    return !!this.mountAimed() || (!!p && this.grabbable(p));
  }

  /** Whether the crosshair is on a key or button, which takes the left button's click even with something in hand. */
  private onButton(): boolean {
    const p = this.target;
    return (
      (p?.kind === 'scale' && p.part === 'tare') ||
      p?.kind === 'alarm' || p?.kind === 'blinds' || p?.kind === 'wake'
    );
  }

  /** Whether the left button would press the key or button the crosshair is on. */
  private pressable(): boolean {
    const p = this.target;
    return (
      (p?.kind === 'scale' && p.part === 'tare') ||
      p?.kind === 'alarm' ||
      p?.kind === 'blinds' ||
      p?.kind === 'wake'
    );
  }

  /** Whether `p` can be picked up: anything but what's fixed in place. */
  private grabbable(p: Pick): boolean {
    return (
      p.kind !== 'faucet' && p.kind !== 'alarm' && p.kind !== 'blinds' && p.kind !== 'wake' && p.kind !== 'cabinet' &&
      !(p.kind === 'tool' && p.t.shape.fixed)
    );
  }

  /* ---------------- waking in the airlock ---------------- */

  /**
   * Put the player in the cryopod in the airlock, facing the lab through its open doors, with the message on its
   * glass: the intro's last part, the first time and on a replay. They can look around, but nothing else, until
   * they press OK (see pressOk). Whatever they held is set down if it can be, or else put away.
   */
  enterPod(): void {
    this.intoPod();
    this.wake = 'pod';
    this.wakeT = 0;
    this.sleeping = null;
    this.riseT = null;
    this.arrival = false;
    this.podNotice = this.onBoard();
  }

  /**
   * What's on board, for the pod's message: the litres of cryostabilizer (what the station's reservoir holds, once
   * it's fitted for it; till then, what was left after the incident), and while the station is fitted for something
   * before it, the litres of that in its reservoir.
   */
  private onBoard(): { litres: number; first: number | null } {
    const st = this.station();
    const held = litresOf(st.tanks[1].n[st.supply.species]);
    return st.supply === CRYOSTABILIZER ? { litres: held, first: null } : { litres: CRYOSTABILIZER.startL, first: held };
  }

  /** Put the player in the pod, facing the lab, empty-handed (see emptyHanded). */
  private intoPod(): void {
    this.emptyHanded();
    Object.assign(this.player, IN_POD);
  }

  /** Leave the player empty-handed: whatever they held is set down if it can be, or else put away. */
  private emptyHanded(): void {
    if (this.held) this.release();
    if (this.held && !(this.held.kind === 'tool' && UNIQUE_TOOLS.includes(this.held.t.kind))) this.putAway();
    this.held = null;
    this.endTurn();
    this.rightHeld = false;
  }

  /** The player walked into the open pod: they ease into place in it, it closes on them, and they fall asleep (see Wake). */
  private board(): void {
    this.emptyHanded();
    const { x, z, yaw, pitch } = this.player;
    this.settling = { x, z, yaw, pitch, t: 0 };
    this.wake = 'settling';
    this.wakeT = 0;
  }

  /** Ease the player into place in the pod over dt real seconds, then let its front close (see Wake's settling). */
  private settleIn(dt: number): void {
    const s = this.settling;
    if (!s) return;
    s.t = Math.min(SETTLE_S, s.t + dt);
    const k = ease(s.t / SETTLE_S);
    const p = this.player;
    p.x = s.x + (IN_POD.x - s.x) * k;
    p.z = s.z + (IN_POD.z - s.z) * k;
    // turning the short way round
    p.yaw = wrapAngle(s.yaw + wrapAngle(IN_POD.yaw - s.yaw) * k);
    p.pitch = s.pitch + (IN_POD.pitch - s.pitch) * k;
    if (s.t < SETTLE_S) return;
    this.settling = null;
    this.wake = 'boarding';
    this.wakeT = 0;
  }

  /**
   * The player has fallen asleep: the lab's sounds fall silent (the ship's ambience plays on), and the lab runs on
   * (see sleep.ts) as fast as it can, a slice at a time (see pump), until the goal's reached (when they stay asleep,
   * and have won) or the station stops delivering (when they wake).
   */
  private fallAsleep(): void {
    this.water.update(0.1, [], new Map());
    for (const r of this.rumbles.values()) r.stop();
    this.rumbles.clear();
    for (const d of this.diverters.values()) d.stop();
    this.diverters.clear();
    this.changing?.sound.stop();
    this.changing = null;
    const stats = { plain: 0, jumped: 0, jumps: 0 };
    this.sleeping = { run: sleep(this.sleeper(), stats, !!this.napping), stats, from: this.clock, woke: null };
    this.pumper.port1.onmessage = () => this.pump();
    this.pumper.port2.postMessage(null);
  }

  /**
   * Run the sleeping lab for a slice of real time, SLEEP_SLICE_MS, then let the page get on with anything else (a
   * message comes after whatever's waiting) and run another; while it's paused, check back now and then.
   */
  private pump(): void {
    const s = this.sleeping;
    if (!s || s.woke || !this.asleep()) return;
    if (this.speed === 0) {
      setTimeout(() => this.pumper.port2.postMessage(null), 100);
      return;
    }
    const now = performance.now();
    while (performance.now() - now < SLEEP_SLICE_MS) {
      const r = s.run.next();
      if (!r.done) continue;
      s.woke = r.value;
      if (this.napping) this.wakeNap();
      else this.wakeFrom(r.value);
      return;
    }
    this.pumper.port2.postMessage(null);
  }

  /** The lab as the sleeper sees it (see sleep.ts). */
  private sleeper(): Sleeper {
    return {
      vessels: () => [
        ...this.flasks.map((v) => ({ v, terminal: true })),
        ...this.tools.flatMap((t) => [
          ...t.tanks.map((v, k) => ({ v, terminal: !drains(t, k) })),
          ...t.tube.map((v) => ({ v, terminal: false })),
          ...t.bed.map((v) => ({ v, terminal: false })),
        ]),
      ],
      station: this.station(),
      clock: () => this.clock,
      advance: (dt) => this.simulate(dt, true),
      skip: (dt) => {
        this.clock += dt;
        this.spin = (this.spin + SPIN * dt) % (2 * Math.PI);
        this.station().steady += dt;
      },
    };
  }

  /** Whether the player is napping or nodding off (see nap): nothing they'd do does anything, but N, which wakes them. */
  private dozing(): boolean {
    return !!this.napping && !this.napping.waking;
  }

  /** Whether the player is asleep, in the pod or in a nap with their eyes shut: the lab runs on its own, undrawn. */
  private asleep(): boolean {
    const nap = this.napping;
    return this.wake === 'asleep' || (!!nap && !nap.waking && nap.lids >= 1);
  }

  /**
   * Whether N would start a nap: once the player's been told they can (see napKnown), out in the lab, with empty
   * hands, and the station not in the middle of its changeover, whose alarm nobody could nap through.
   */
  private canNap(): boolean {
    return (
      this.napKnown && !this.napping && !inPod(this.wake) && !this.previewing && !this.held && !this.turning &&
      this.station().swap === null
    );
  }

  /**
   * N: nap where they stand. Their eyes close, over NAP_S.close real seconds (it's their own doing, like
   * walking), and then the lab runs on as fast as it can, as while they sleep in the pod (see fallAsleep), whether or
   * not anything is being delivered, until N wakes them (see wakeNap), or the station's reservoir comes to hold enough
   * of what it's fitted for.
   */
  private nap(): void {
    if (!this.canNap()) {
      if (this.napKnown && this.held && !inPod(this.wake)) this.say('Hands full');
      return;
    }
    this.rightHeld = false;
    this.keys.clear();
    this.wheel = null;
    this.flash = null;
    this.napping = { lids: 0, waking: false };
  }

  /** Wake from a nap: the lab runs as ever again, and their eyes open, over NAP_S.open real seconds. */
  private wakeNap(): void {
    if (!this.napping) return;
    this.napping.waking = true;
    this.sleeping = null;
  }

  /** How far the screen has faded to black (see Hud.black). */
  private black(): number {
    const t = this.wakeT;
    if (this.wake === 'boarding') return ease((t - WAKE_S.open) / WAKE_S.fade);
    if (this.wake === 'asleep') return 1;
    if (this.riseT !== null) return 1 - ease(this.riseT / RISE_S);
    return 0;
  }

  /**
   * Wake the player from a sleep, in the pod as at first, as the screen fades in from black (see Wake's asleep): with
   * the same message, its numbers up to date, if the station stopped delivering; or a welcome to Mu Ceti, if there's
   * enough cryostabilizer.
   */
  private wakeFrom(why: Woke): void {
    this.sleeping = null;
    this.wake = 'pod';
    this.wakeT = 0;
    this.riseT = 0;
    this.arrival = why === 'goal';
    this.podNotice = this.onBoard();
  }

  /**
   * Once arrived at Mu Ceti (see Wake's arrived), carry on in the lab as it was when there was enough cryostabilizer:
   * the player stands just out of the airlock, facing the lab, with its doors shut.
   */
  continueTinkering(): void {
    if (this.wake !== 'arrived') return;
    this.arrival = false;
    this.wake = 'closed';
    this.wakeT = Infinity;
    Object.assign(this.player, { x: AIRLOCK.x, z: ROOM.z1 - 150, yaw: 0, pitch: 0 });
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
    if (this.wake === 'flicker' && t >= WAKE_S.flicker) next(this.arrival ? 'arriving' : 'opening');
    else if (this.wake === 'opening' && t >= WAKE_S.open) next('out');
    else if (this.wake === 'arriving' && t >= WAKE_S.arrive) next('arrived');
    else if (this.wake === 'boarding' && t >= WAKE_S.open + WAKE_S.fade) next('asleep');
    else if (this.wake === 'out' && outOfAirlock(this.player.z, PLAYER_R)) next('closed');
    // steady delivery of cryostabilizer opens the doors again, and once it stops they close, when she's out in the lab
    else if (this.wake === 'closed' && this.station().supply.airlock && this.station().steady >= DELIVERY.streak) next('open');
    else if (this.wake === 'open' && this.station().steady === 0 && outOfAirlock(this.player.z, PLAYER_R)) next('closed');
  }

  /** How the airlock looks just now, for the view. */
  private airlockLook(): AirlockLook {
    const w = this.wake;
    const t = this.wakeT;
    if (this.previewing) {
      const up = ARRIVAL.open;
      const notice = { arrival: true } as const;
      return { door: 1, front: up, dark: 1 - up, message: false, notice, okHot: false, lamp: false, arrival: true };
    }
    // how far up the pod's front is: sliding up as they wake, down as they settle in, and otherwise up but while
    // they're shut in it
    const up =
      w === 'opening' || w === 'arriving' ? ease(t / WAKE_S.open)
      : w === 'boarding' ? 1 - ease(t / WAKE_S.open)
      : w === 'pod' || w === 'flicker' || w === 'asleep' ? 0
      : 1;
    // the message flickers, on less and less of the time, until it's gone
    const flick = w === 'flicker' && Math.sin(t * 90) + Math.sin(t * 37) > 2.6 * (t / WAKE_S.flicker) - 0.6;
    return {
      door: w === 'closed' ? 1 - ease(t / WAKE_S.close) : w === 'open' ? ease(t / WAKE_S.close) : 1,
      front: up,
      // the room's light floods in as the front slides up, and is shut out as it slides down
      dark: 1 - up,
      message: w === 'pod' || flick,
      notice: this.arrival ? { arrival: true } : { arrival: false, ...this.podNotice },
      okHot: w === 'pod' && this.target?.kind === 'wake',
      // flashing while the doors stand open to sleep, a second on and half a second off, on sim time
      lamp: w === 'open' && this.clock % 1.5 < 1,
      arrival: this.arrival && (w === 'arriving' || w === 'arrived'),
    };
  }

  /**
   * Show the end's white void (see ARRIVAL) in place of the lab, or put the lab back: for god mode, to see how it
   * looks. The player stands in the pod, facing out, and can look around but not walk; the pod's front stands as far
   * open as ARRIVAL.open says. The lab runs on as ever, unseen.
   */
  previewArrival(on: boolean): void {
    if (on === !!this.previewing || (on && inPod(this.wake))) return;
    const p = this.player;
    if (on) {
      this.emptyHanded();
      this.previewing = { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch };
      Object.assign(p, IN_POD);
    } else {
      Object.assign(p, this.previewing);
      this.previewing = null;
    }
  }

  private rightWouldDo(): boolean {
    if (this.rightHeld) return false;
    const h = this.held;
    if (h?.kind === 'flask') return h.f.N > TRACE;
    // a strip or a thermometer dips into the open top looked at
    if (h?.kind === 'tool' && isDipper(h.t.kind)) return !!this.mouthAimed();
    // a held tool runs anyway
    if (h?.kind === 'tool') return false;
    // a faucet always runs
    if (h?.kind === 'hose') return 'tool' in h.h.on ? this.wouldFlow(h.h.on.tool) : true;
    return !!this.valveAimed();
  }

  /**
   * What each dipper's foot is in (see footAt and dippedIn), from where it is now, held or set down; it doesn't change
   * much in a frame. A thermometer's bulb reads whatever it's in. A wicking strip counts as in a fluid only while it's
   * set down, or held dipped with the right button (or on its way in from a tap of it, see tapping), so carrying one
   * past fluid does nothing; it drinks it while it's set down, or once it's been held dipped DIP_SOAK real seconds
   * (`dt`, as the player's own movements go), so a tap only spots it (see Tool.dipIn).
   */
  private dipping(dt: number): void {
    const h = this.held;
    let dipped = false;
    for (const t of this.tools) {
      if (isThermometer(t.kind)) t.bath = bathAt(footAt(t), this.flasks, this.tools);
      if (t.kind !== 'strip') continue;
      const held = h?.kind === 'tool' && h.t === t;
      // one in hand is in the fluid once it's all the way down, so its spot is as deep as it's dipped
      const d = !held || ((this.rightHeld || this.tapping) && this.dip >= 1) ? dippedIn(footAt(t), this.flasks, this.tools) : null;
      if (held && d) {
        dipped = true;
        this.dipFor += dt;
      }
      t.dipIn(d?.v ?? null, !held || this.dipFor > DIP_SOAK, d?.depth);
    }
    if (!dipped) this.dipFor = 0;
    // all the way in, its foot has touched: a tap is over, and it rises unless the button's still held
    if (this.dip >= 1) this.tapping = false;
  }

  /** Whether fluid would leave a tool's spouts if it ran. */
  private wouldFlow(t: Tool): boolean {
    // the station's reservoir through its faucet, or its funnel through the diverter, unless its block is away
    if (t.kind === 'receptacle') return !t.away && t.tanks.some((v, k) => v.N > TRACE && drains(t, k));
    // a column's dry bed drinks what's in its funnel, and lets nothing out
    if (t.kind === 'column') return t.soaked >= 1 && t.valves[0] > 0 && t.tanks[0].N > TRACE;
    // a heater's tube runs whatever its valves say
    return (t.shape.spouts.length > 0 && t.tanks.some((v, k) => v.N > TRACE && drains(t, k))) || t.tube.some((v) => v.N > TRACE);
  }

  /** What the station's reservoir is of, and the litres of it there, to two places, of the litres needed (see Hud.reservoir). */
  private reservoirHud(): NonNullable<Hud['reservoir']> {
    const { supply, tanks } = this.station();
    return { name: supply.name, litres: Math.floor(100 * litresOf(tanks[1].n[supply.species])) / 100, goalL: supply.goalL };
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
      press: this.leftWouldDo(),
      right: this.rightWouldDo(),
      aim: this.turning ? { ...this.turning.aim } : null,
      label: !inPod(this.wake) && !!this.targetNote(),
      hand: h?.kind === 'flask' ? 'Pour' : h?.kind === 'hose' ? 'Flow' : h?.kind === 'tool' && isDipper(h.t.kind) ? 'Dip' : 'Turn',
      note: this.flash?.text ?? null,
      tip: !!this.flash?.tip,
      actions: this.actions(),
      black: this.black(),
      // blinded a while by the white void once the pod's open, then all white
      white:
        this.wake === 'arriving' ? ease((this.wakeT - WAKE_S.open - BLINDED_S) / (WAKE_S.arrive - WAKE_S.open - BLINDED_S))
        : this.wake === 'arrived' ? 1
        : 0,
      preview: !!this.previewing,
      wheel: this.wheel && {
        x: this.wheel.x,
        y: this.wheel.y,
        items: WHEELS[this.wheel.which],
        pick: wheelPick(this.wheel, WHEELS[this.wheel.which].length),
        none: WHEELS[this.wheel.which].map((k) => !endless(k) && !this.stock[k].includes(true)),
      },
      ended: this.wake === 'arrived',
      slept: this.sleeping ? Math.floor(this.clock - this.sleeping.from) : null,
      reservoir: this.sleeping ? this.reservoirHud() : null,
      lids: this.napping ? ease(this.napping.lids) : 0,
      napping: this.dozing(),
      nap: this.canNap(),
    };
    const key = JSON.stringify(hud);
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.cb.onHud(hud);
  }
}

/**
 * Whether tank k of a tool lets fluid out on its own: a funnel or an instrument's tube always (the station's funnel
 * through its diverter), a multiplexer's funnel unless its valve takes only from the other, a tank with a valve as
 * long as it's open.
 */
function drains(t: Tool, k: number): boolean {
  if (t.kind === 'receptacle') return k === 0 || t.valves[0] > 0;
  if (t.kind === 'multiplexer') return k ? t.valves[0] > 0 : t.valves[0] < 1;
  // a dry column's bed drinks from its funnel, its tap open or not
  if (t.kind === 'column') return t.soaked < 1 || t.valves[0] > 0;
  return t.kind === 'splitter' || t.kind === 'sorter' || t.kind === 'heater' || INLINE_TOOLS.includes(t.kind) || t.valves[k] > 0;
}

export type { ToolKind };
