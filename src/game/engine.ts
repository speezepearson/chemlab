import { equilibrate } from '../chem/equilibrium';
import { Lag, temperature, type Fluid, type NetReaction, type ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { AIRLOCK, BLINDED_S, POD, RISE_S, SETTLE_S, WAKE_S, airlockBoxes, ease, inPod, outOfAirlock, type Wake } from './airlock';
import { hushAlarms } from './ambience';
import {
  COCK_EXTENT, COCK_WHEEL_Z, FLASK_CENTER, FLASK_LIP, NEAR, NEAR_STEP, NOZZLE_H, NOZZLE_REACH, SCALE_SLOTS, STAND_MAX, STOPCOCK, aimAngle, cockBox, settleAngle, swept, sweep, turnValve, valveAt, valveFaceZ, valveLocal, VALVE_WHEEL, bathAt, dipPoses, dippedIn, footAt, flaskBox, flaskFluid,
  FLASK_CATCH, flaskLip, flaskMouth, nozzleBox, paperMouth, tankFluid, docked, magnetShift, nozzleMounts, nozzleStand, onScale, onTool, scaleBox, scaleCenter, scaleSpot, snapReach, spoutAt, standBase,
  spoutTip, tankMouth, tankNoteY, toolBox, toolCenter, toolStands, type Magnets, type NozzleMount, type Stand,
} from './bodies';
import { CABINET, endless, isStocked, putIn, stockWith, takeFrom, takeSlot, type Stock, type Stocked } from './cabinet';
import { changeover, type ChangeoverSound } from './changeover';
import { chime } from './chime';
import { diverter, type Diverter } from './diverter';
import { CAP, DELIVERY, HOME_H, HOME_W, POUR_RATE, TRACE } from './config';
import { cool, exposure, taper } from './cooling';
import { FAUCETS, WALL_FAUCETS, faucetIndex, faucetOutput, faucetRate, faucetTarget, faucetValvePose, FAUCET_VALVE } from './faucets';
import { FLASK_H, FLASK_OUTLINE, areaBelow, fillLevel } from './flaskShape';
import { Flask, Vessel, roomFor, sustenance, transfer, volume, volumeUnit } from './flask';
import { History, arrange, arrangement, type Arrangement } from './history';
import { boxesOverlap, roomBoxes, walk, type Box } from './physics';
import { CENTER, placement, type Placement } from './place';
import { DEFAULT_PRESET, LAMP_POSE, REFERENCE_FILL, SPECTROSCOPE_AT, STATION_POSE, applyFill, type Preset, type Spot } from './presets';
import { CRYOSTABILIZER, FIRST_SUPPLY, litresOf, type Supply } from './supply';
import { shatter } from './shatter';
import { WHEELS, wheelMove, wheelPick, type WheelAim } from './wheel';
import { loadChem, loadVessel, saveChem, saveVessel, type SaveState } from './save';
import { Scale, glassGrams } from './scale';
import { sleep, type Sleeper, type SleepStats, type Woke } from './sleep';
import { script, smell, span, type Fragment } from './smell';
import {
  CELL, COUNTERS, LIFT, ROOM, SPIN, Z_HOME, counterUnder, dist3, fromFrac, groundAt, toCardinal, toFrac, toLocal, toWorld, wrapAngle,
  type Pose, type Vec3,
} from './space';
import {
  changeoverAt, BOND_KEYS, HEATER, HEATER_CELLS, HEATER_TUBE, DIVERTER_HOLD, Hose, MAX_FLOW, SHAPES, STATION, STRIP_FOOT, SUMP_TIP,
  TANK_H, TOOL_NAMES, isBlotter, isDipper, isThermometer, Blotter, Tool, UNIQUE_TOOLS, cupFillHeight, type Cock, type HoseMount, drip, mouthBelow, sameMount, sumpFillHeight, levelIn, spaceOf, tankPieces, tankX,
  type Mouth, type ToolKind,
} from './tools';
import { typingIn } from './typing';
import { ARRIVAL, View, type AirlockLook, type FaucetSpot, type Frame, type GuideLook, type Icons, type Pick } from './view';
import { WaterSounds } from './water';

/** What the info panel shows for one vessel: all of it in god mode, otherwise just its color. */
export interface Inspection {
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
  /** While a valve is being turned, where the pointer that turns it by sweeping round it is, in CSS pixels. */
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
  /**
   * What the last sniff smelled of (see script in smell.ts), until SMELL_MS after the last of it came up: its lines,
   * each the pieces it's said in; how many of those pieces, counted through the lines in order, have come up so far;
   * and whether it's fading `out`, over the last SMELL_FADE_MS. `n` counts the sniffs, so the same thing twice running
   * shows as new. Otherwise null.
   */
  smell: { n: number; lines: string[][]; shown: number; out: boolean } | null;
  /** Whether she's sniffing something (see GameEngine.sniff): nothing can be aimed at or done until she's back. */
  sniffing: boolean;
}

/**
 * Something the player can do just now: the keys or buttons that do it, pressed together, and what it does, in a few
 * words. Keys are named as on the keyboard; 'LMB' and 'RMB' are the mouse's left and right buttons, 'Wheel' its wheel, and '↑↓' moving it up and down. `off` if it can't be done here, though
 * it could elsewhere.
 */
export interface Action {
  keys: string[];
  does: string;
  off?: boolean;
}

export interface EngineCallbacks {
  /** Throttled to ~10 Hz; null when nothing is inspected, as nothing is outside god mode. */
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
  /** For a stopcock, what it goes on (see CockSpot). */
  cock?: CockSpot;
}

/** Where a stopcock is, or goes (see Cock): on a spout or a faucet, at its tip, or on the end of its hose (`nozzle`). */
interface CockSpot {
  m: HoseMount;
  nozzle: boolean;
}

/**
 * How near the line the crosshair is on the end of an outlet must be for a stopcock in hand to go on it, if the
 * crosshair isn't on it (see GameEngine.cockAim).
 */
const COCK_SNAP = 30;

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
  /** A stopcock, hanging from `pose` (see STOPCOCK): it has no pose of its own but on what it's fitted on. */
  | { kind: 'cock'; c: Cock; pose: Pose }
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
  /**
   * Moved by a ghost (see ghostly): where it's held, while the thing itself stays where it was, in the lab and running,
   * until it's set down; or, one just made, out of the lab until then. Set for just what ghostly says, as it's taken.
   */
  ghost?: { pose: Pose };
};

/**
 * Whether what's held is moved by a ghost of it (see Held.ghost): what stands on the bench on stands, and a scale,
 * stay where they are, running, until they're set down; what's used while it's held (a flask, a dipper, a sheet of
 * blotting paper, a hose's nozzle) is carried in hand.
 */
const ghostly = (h: Held) => h.kind === 'scale' || (h.kind === 'tool' && !isDipper(h.t.kind) && !isBlotter(h.t.kind));

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
/**
 * The heater as older saves have it: with four spouts, three taps' and then its end's, and as many valves, a tap's
 * each and then its dial. `kept` are the two of each that it still has, in order: its middle tap, which drew from
 * where its one tap does now, and its last, which is its end's spout or its dial. A hose on either of those spouts
 * stays on it; one on either of the other two taps' is rolled up, and what hung from them is gone.
 */
const OLD_HEATER = { spouts: 4, kept: [1, 3] };
/**
 * The tools that had flow valves of their own, before there were stopcocks (see Cock): for each spout, which of its
 * saved valves let it out. A save from then fits a stopcock on each of those spouts, set as that valve was, so that it
 * runs on as it did (see GameEngine.loadCocks).
 */
const OLD_FLOW: Partial<Record<ToolKind, number[]>> = {
  dispenser: [0], pipette: [0], tank: [0], column: [0], exchanger: [0, 1], separator: [0, 0], dilatometer: [0, 1],
};
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
/** How far from straight ahead, in radians, the middle of what's held can be, so it's always in view (see holdInPlace). */
const HOLD_CONE = Math.PI / 6;
/** Radians the view turns per pixel the mouse moves, and that something held turns with Shift. */
const LOOK_SENS = 0.0022;
/** The view's field of view, top to bottom, in degrees. */
const FOV = 90;
/**
 * Z, held, zooms the view in: the field of view it narrows to, in degrees, and how long it takes to get there, or
 * back, in real seconds (it's the player's own doing, like walking).
 */
const ZOOM = { fov: 30, s: 0.12 };
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
 * Where the faucets are: along the right wall over its counter (see SINK_D), a cell apart, each spout FAUCET_OUT
 * out from the wall, in line with the station's (see STATION.out), so a flask under one clears the manifold. Their spouts are a little under eye level, high enough over the
 * counter for a flask on a scale (whose mouth is 112 up) to go under one, at the foot of a neck FAUCET_NECK long: long
 * enough for the valve on it (see FAUCET_VALVE), clear of the elbow above and the spout's tip below.
 */
const FAUCET_Y = LIFT + 160;
const FAUCET_NECK = 35;
const FAUCET_Z0 = 5.5 * CELL;
const FAUCET_GAP = CELL;
const FAUCET_OUT = 50;
/**
 * An island's faucet rises from the island's middle, a corner of four cells, and reaches out over the middle of one
 * of them, this far along x and along z (see CELL).
 */
const ISLAND_FAUCET_OUT = CELL / 2;
/** How thick an island faucet's riser is, round, for bumping into: its radius. */
const RISER_R = 6;

/**
 * A faucet in the lab: where it is and what it pours (see FaucetSpot), the faucet it is, and, as a tool's spout has
 * (see Tool.drops, out, flow and streaming), the drop hanging at its outlet, what it let out over the last frame, for
 * drawing, that as a share of MAX_FLOW a sim second, and whether it streamed; and `packet`, its own, for what it lets
 * out in a substep.
 */
type LabFaucet = FaucetSpot & {
  start: (typeof FAUCETS)[number];
  drop: Vessel;
  packet: Vessel;
  out: Vessel | null;
  flow: number;
  streaming: boolean;
};

/** A faucet's valve set to `valve`, with no stopcock on it, nothing hanging from it, and nothing let out yet. */
function faucetFlow(valve = 0): Omit<LabFaucet, keyof FaucetSpot | 'start'> & { valve: number; cock: Cock | null } {
  return { valve, cock: null, drop: new Vessel(Infinity), packet: new Vessel(Infinity), out: null, flow: 0, streaming: false };
}

/**
 * A valve the player can turn: built-in valve k of tool t, faucet `faucet`'s (see FAUCET_VALVE), or the stopcock on
 * the spout or faucet `cock` (see Cock).
 */
type ValveRef = { t: Tool; k: number } | { faucet: number } | { cock: HoseMount };
/** How long a note stays up, in ms. */
const NOTE_MS = 1600;
/**
 * How long what a sniff smelled of stays up once the last of it has come up, in ms, and how long it takes to fade
 * out, at the end of that (it's on the display, not in the lab).
 */
const SMELL_MS = 5000;
export const SMELL_FADE_MS = 1100;
/**
 * A sniff (see GameEngine.sniff), which is the player's own doing, so in real seconds: how long her head takes to
 * lean `in` to the vessel's rim, the `beat` her nose stays there after the last of what she says of it has come up,
 * and how long it takes to come back `out` to where she stood. And where her eyes are with her nose at the rim: `up` over its near edge, looking down at the mouth
 * `into` it from that edge. Under something that leaves less room than that over the rim, they're `clear` below it, if
 * that's still `least` over the rim, or else as far further `back` as it takes, a step at a time, as far as `reach`.
 */
const SNIFF = { in: 0.45, beat: 0.9, out: 0.35, up: 30, into: 12, clear: 8, least: 12, back: 8, reach: 40 };
/** How long the note that she can nap stays up, in ms: long enough to read. */
const NAP_HINT_MS = 9000;
/** Real seconds the player's eyes take to close for a nap, and to open again as they wake (see GameEngine.nap). */
const NAP_S = { close: 0.9, open: 0.6 };
/** A flask's outline's area, in local units squared, for how exposed its fluid is (see exposures). */
const FLASK_AREA = areaBelow(FLASK_OUTLINE, 0);
/** What stands for a flask not yet on a scale's empty place, as an open top a magnet lines up (see magnets). */
const SCALE_PLACE = new Vessel(0);
/** Width of the stem a funnel-shaped tank narrows to, in local units. */
const FUNNEL_STEM = 6;

/** Where a tool stands, in the room, from a preset's spot for it. */
const spotPose = (s: Spot): Pose => ({ ...fromFrac({ x: s.at[0], y: s.at[1] }, s.z), yaw: s.yaw ?? 0 });

/** Where the view is, and which way it looks (yaw about the vertical, pitch up). */
interface Gaze {
  eye: Vec3;
  yaw: number;
  pitch: number;
}

/** Owns the lab: what's in it, the player, input, the simulation loop, and the view that draws it. */
export class GameEngine {
  speed = 1;
  god = true;

  private view: View;
  private flasks: Flask[] = [];
  private tools: Tool[] = [];
  private scales: Scale[] = [];
  private hoses: Hose[] = [];
  private faucets: LabFaucet[];
  /** What's in the equipment cabinet (see cabinet.ts): what the equipment wheels make comes out of it, and goes back in. */
  private stock: Stock = stockWith({});
  /** Where the player stands, and which way they look (yaw about the vertical, pitch up). */
  private player = { x: 480, z: 380, yaw: 0, pitch: -0.08 };
  private keys = new Set<string>();
  /** Where the on-screen sticks are pushed (see stick). */
  private sticks = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
  private held: Held | null = null;
  /** Whether the right button is held: a held flask tips and pours, a held hose lets fluid out, and a held dipper dips, only while it is. */
  private rightHeld = false;
  /**
   * A valve being turned with the right button (a tool's or a faucet's), where on screen the pointer turning it is, and
   * the angle round the valve's middle it was last at (see aimAngle), which it turns the valve by sweeping round from;
   * null while it's in the dead zone, or before it's first been taken.
   */
  private turning: (ValveRef & { aim: { x: number; y: number }; last: number | null }) | null = null;
  /** How far the view is zoomed in (see ZOOM), from 0, not at all, to 1. */
  private zoom = 0;
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
  /**
   * The sniff under way (see sniff): the vessel; how far her head has leaned in to its rim, from 0, where she stands,
   * to 1, there (see SNIFF); where the view is then (see Gaze), and, if it's the flask in her hand, where that's
   * brought up to under her nose; the real time her nose is at the rim until, once it's there and she's smelled what's
   * in it (see stepSniff); and whether she's on her way back.
   */
  private sniffing: { v: Vessel; lean: number; to: Gaze; hand: Pose | null; until: number | null; leaving: boolean } | null = null;
  /**
   * What the last sniff smelled of (see sniff), until it's faded from the display: what she says of it, piece by piece
   * (see script); the real time her nose reached the rim, which its pieces come up after; how many of them had come up
   * when the sniff was cut short, if it was, since no more do then; and the real time it's gone. And how many sniffs
   * there have been.
   */
  private smelled: { script: Fragment[]; n: number; from: number; cut: number | null; until: number } | null = null;
  private sniffs = 0;
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
          start, output, note: '', ...faucetFlow(),
          spout: { x: ROOM.x1 - FAUCET_OUT, y: FAUCET_Y, z },
          wall: { x: ROOM.x1 - 14, y: FAUCET_Y + FAUCET_NECK, z },
        };
      }
      const c = islands[i - WALL_FAUCETS];
      const x = (c.x0 + c.x1) / 2;
      const z = (c.z0 + c.z1) / 2;
      return {
        start, output, note: '', ...faucetFlow(),
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
      // its stopcocks as the preset sets them, or else as it comes (see ToolShape.fitted)
      spec.cocks?.forEach((c, j) => j < t.cocks.length && (t.cocks[j] = c === null ? null : { valve: c, nozzle: false }));
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
    // a new lab's faucets are all shut
    for (const fa of this.faucets) Object.assign(fa, faucetFlow());
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
    this.hoses = this.hoses.filter((h) => !('tool' in h.on && tools.has(h.on.tool)) && !inIt(this.nozzleBox(h)));
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
    this.sniffing = null;
    this.smelled = null;
    this.history.clear();
    this.tidyCocks();
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
    if (inPod(this.wake) || this.dozing() || this.sniffing) return;
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
    this.tidyCocks();
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
    // a ghost of something just made isn't in the lab yet, so it's saved as still in the cabinet
    const h = this.held;
    const stock = Object.fromEntries(Object.entries(this.stock).map(([k, v]) => [k, [...v]])) as Stock;
    const fresh = h && !this.inLab(h) ? (h.kind === 'tool' ? h.t.kind : h.kind) : null;
    if (fresh && isStocked(fresh)) putIn(stock, fresh);
    // and a stopcock in hand is saved as back where it was taken from, or in the cabinet
    if (h?.kind === 'cock' && !h.from) putIn(stock, 'stopcock');
    return {
      v: 1,
      preset: this.preset.id,
      flasks: this.flasks.map((f) => ({
        ...saveVessel(f), x: f.pose.x / HOME_W, up: f.pose.y - LIFT, glass: f.glass, ...depth(f.pose),
      })),
      tools: this.tools.map((t) => ({
        kind: t.kind, id: t.id, ...this.frac(t.pose), ...depth(t.pose), valves: [...t.valves], tanks: t.tanks.map(saveVessel),
        cocks: t.cocks.map((_, j) => {
          const c = this.cockSaved({ tool: t, spout: j });
          return c && { valve: c.valve, ...(c.nozzle ? { nozzle: true } : {}) };
        }),
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
      faucets: this.faucets.map((fa, i, all) => ({
        x: (i + 0.5) / all.length, y: 30 / HOME_H, valve: fa.valve, ...(fa.note ? { note: fa.note } : {}),
        ...((c) => (c ? { cock: { valve: c.valve, ...(c.nozzle ? { nozzle: true } : {}) } } : {}))(this.cockSaved({ faucet: i })),
      })),
      cabinet: Object.fromEntries(
        (Object.keys(stock) as Stocked[]).filter((k) => !endless(k)).map((k) => [k, stock[k].flatMap((on, i) => (on ? [i] : []))]),
      ),
      ...(this.alarmsOff ? { alarmsOff: true } : {}),
      ...(this.blindsShut ? { blindsShut: true } : {}),
      ...(this.napKnown ? { nap: true } : {}),
      player: { x: this.player.x, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch },
      chem: saveChem(this.chem.params),
    };
  }

  /**
   * The stopcock a save keeps on a spout or faucet: the one there, or the one in hand, if it was taken off it (it's
   * saved as put back, as anything in hand is).
   */
  private cockSaved(m: HoseMount): Cock | null {
    const h = this.held;
    const from = h?.kind === 'cock' ? h.from?.cock : undefined;
    if (h?.kind === 'cock' && from && sameMount(from.m, m)) return { ...h.c, nozzle: from.nozzle };
    return this.cockOn(m);
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
    const longHeaters = new Set<number>();
    this.tools = s.tools
      .filter((st) => st.kind in SHAPES)
      .map((st) => {
        // (an older save's heater had three taps, each with a spout, before its end's: see OLD_HEATER)
        const long = (a: unknown[] | undefined) => st.kind === 'heater' && a?.length === OLD_HEATER.spouts;
        const saved = (long(st.valves) ? OLD_HEATER.kept.map((j) => st.valves![j]) : st.valves) ?? [];
        const drops = long(st.drops) ? OLD_HEATER.kept.map((j) => st.drops![j]) : st.drops;
        if (long(st.valves) || long(st.drops)) longHeaters.add(st.id);
        // (an older save's swell bulbs had a valve under each bulb before their dial, which is all they have now)
        const valves = st.kind === 'dilatometer' && saved.length === 3 ? [saved[2]] : SHAPES[st.kind].valves ? saved : [];
        const t = new Tool(st.kind, st.id, pose(fromFrac({ x: st.fx, y: st.fy }), st), valves);
        this.loadCocks(t, st, saved);
        t.tanks.forEach((v, k) => st.tanks?.[k] && loadVessel(v, st.tanks[k]));
        t.drops.forEach((v, k) => drops?.[k] && loadVessel(v, drops[k]));
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
    // (past every saved tool's id, those of kinds there no longer are included, so that a tool added below doesn't get
    // a dropped one's id, and with it the hoses that were on its spouts)
    this.nextToolId = Math.max(-1, ...s.tools.map((st) => st.id).filter(Number.isFinite)) + 1;
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
      // (a hose on a spout of an older save's heater is on the spout that's become: its middle tap's, or its end's)
      const spout = t && longHeaters.has(t.id) && Number.isInteger(on.spout) ? OLD_HEATER.kept.indexOf(on.spout!) : on.spout;
      const mount: HoseMount | null =
        t && Number.isInteger(spout) && spout! >= 0 && spout! < t.shape.spouts.length ? { tool: t, spout: spout! }
        : fa !== null ? { faucet: fa }
        : null;
      if (!mount || this.hoses.some((h) => sameMount(h.on, mount))) continue;
      const o = sh.outlet;
      const h = new Hose(mount, this.inRoom({ ...fromFrac(o), z: num(o.z, Z_HOME) }), snapReach(num(o.reach, NOZZLE_REACH.min)));
      h.turn = num(o.yaw, 0);
      this.hoses.push(h);
    }
    // a faucet's valve is as it was saved; a save from before faucets had valves, which ran all the time, says nothing,
    // and its faucets run on, fully open, so that a line fed from them keeps running
    for (const fa of this.faucets) Object.assign(fa, faucetFlow(1), { note: '' });
    fs.forEach((f, i) => {
      const j = faucetIndex(i, fs.length);
      if (j === null) return;
      if (typeof f?.note === 'string') this.faucets[j].note = f.note;
      if (Number.isFinite(f?.valve)) this.faucets[j].valve = Math.max(0, Math.min(1, f.valve!));
      const c = f?.cock;
      if (c && typeof c === 'object') this.faucets[j].cock = { valve: Number.isFinite(c.valve) ? Math.max(0, Math.min(1, c.valve)) : 0, nozzle: !!c.nozzle };
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

  /**
   * Fit the stopcocks a save says tool t has (see Cock), on the spouts it says: each with its setting, at its tip or on
   * the end of its hose. A save from before there were stopcocks says nothing, and its tool gets one, at the spout's
   * tip, on each spout an old valve of its let out of (see OLD_FLOW), set as that was (`valves`, as saved).
   */
  private loadCocks(t: Tool, st: SaveState['tools'][number], valves: readonly number[]): void {
    const unit = (x: unknown) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x as number)) : 0);
    if (Array.isArray(st.cocks)) {
      t.cocks.forEach((_, j) => {
        const c = st.cocks![j];
        t.cocks[j] = c && typeof c === 'object' ? { valve: unit(c.valve), nozzle: !!c.nozzle } : null;
      });
      return;
    }
    const old = OLD_FLOW[t.kind];
    if (old) t.cocks.forEach((_, j) => (t.cocks[j] = { valve: unit(valves[old[j]]), nozzle: false }));
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
   * Keep at most one of each unique tool (see UNIQUE_TOOLS), the first. There's always a spectroscope, a station and a
   * shadow lamp: if there's none, one is added where it starts, or as near there as it has room (see roomy), the
   * station fitted for the cryostabilizer, its reservoir holding what's left on board (see Tool.stock), as a save from
   * before it was fitted for anything else would have it. The station is built into the wall, and the shadow lamp
   * stands on its own bench, so they're always where they are.
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
      else if (!t.shape.fixed) t.pose = this.roomy(t);
      this.tools.push(t);
    };
    // the station and the shadow lamp first, since they're always where they are, for the others to keep clear of
    add('receptacle', STATION_POSE);
    this.station().pose = { ...STATION_POSE };
    add('shadowlamp', LAMP_POSE);
    this.tools.find((t) => t.kind === 'shadowlamp')!.pose = { ...LAMP_POSE };
    add('spectroscope', spotPose(SPECTROSCOPE_AT));
  }

  /**
   * Where a tool new to the lab (see uniqueTools) can go: where it is, if it would come to rest there as if set down
   * (see rest), or else the nearest of the spots a whole number of cells (see CELL) from there across the room where
   * it would, at the same height and facing the same way. An older save can have something where a tool it lacked
   * starts. Where it is, if there's room nowhere.
   */
  private roomy(t: Tool): Pose {
    const h: Held = { kind: 'tool', t, relYaw: 0, dist: 0 };
    const obstacles = this.obstacles(h);
    const solid = this.obstacles(h, false);
    const spots: Pose[] = [];
    const steps = (from: number, lo: number, hi: number) => {
      const out: number[] = [];
      for (let v = from - Math.floor((from - lo) / CELL) * CELL; v < hi; v += CELL) out.push(v);
      return out;
    };
    for (const x of steps(t.pose.x, ROOM.x0, ROOM.x1)) for (const z of steps(t.pose.z, ROOM.z0, ROOM.z1)) spots.push({ ...t.pose, x, z });
    const off = (p: Pose) => Math.hypot(p.x - t.pose.x, p.z - t.pose.z);
    for (const p of [t.pose, ...spots.sort((a, b) => off(a) - off(b))]) {
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
   * Set everything that stands or lies on the bench (flasks, scales and sheets of blotting paper) down on the counter
   * under it, if there is one, and stand each flask on a scale where the scale now is. Presets and older saves leave
   * things in the air, where arms from the ceiling used to hold them; and a sheet from when sheets were thicker lies
   * that much above the counter.
   */
  private restAll(): void {
    this.toCounters();
    const riders = this.standing();
    const down = (b: Box, move: (dy: number) => void) => {
      const top = counterUnder(b);
      const dy = top === null ? 0 : b.y - b.hy - top;
      if (dy > 0) move(dy);
    };
    for (const f of this.flasks) if (!riders.has(f)) down(flaskBox(f), (dy) => (f.pose = { ...f.pose, y: f.pose.y - dy }));
    for (const sc of this.scales) down(scaleBox(sc), (dy) => (sc.pose = { ...sc.pose, y: sc.pose.y - dy }));
    for (const t of this.tools) if (t.shape.flat) down(toolBox(t), (dy) => (t.pose = { ...t.pose, y: t.pose.y - dy }));
    this.settle();
  }

  /**
   * Mend what presets and older saves can leave amiss, which is otherwise left where and as it is: a tool or a hose's
   * nozzle whose stand is off the counter (as one an older save left near the back wall can be) comes forward up to
   * three cells (see CELL), as it faces, until its stand is on it; and a flask on a scale goes to the nearer of its
   * places, or off it if the other flask there has it.
   */
  private toCounters(): void {
    const onCounter = (t: Tool) => toolStands(t).every((st) => counterUnder(standBase(st, 0)) !== null);
    for (const t of this.tools) {
      // (what's fixed is where it is)
      if (t.shape.fixed) continue;
      for (let i = 0; i < 3 && !onCounter(t); i++) t.pose = { ...toWorld(t.pose, { x: 0, y: 0, z: CELL }), yaw: t.pose.yaw };
    }
    for (const sc of this.scales) {
      const load = sc.load.splice(0);
      for (const { f, dx } of load) {
        const slot = dx < 0 ? SCALE_SLOTS[0] : SCALE_SLOTS[1];
        if (!sc.load.some((l) => l.dx === slot)) sc.put(f, slot);
      }
    }
    for (const h of this.hoses) {
      for (let i = 0; i < 3 && counterUnder(standBase(nozzleStand(h.outlet, h.turn, h.reach), 0)) === null; i++)
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
    this.ghostIf(held);
    held.dist = this.holdDist(held);
    this.placeHeld(held, this.gripPose(held));
    held.dist = this.clampDist(held, held.dist);
    // (a ghost of something new is all there is of it until it's set down)
    if (!held.ghost) this.enter(held);
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
    this.ghostIf(held);
    this.placeHeld(held, CABINET.slots[kind][slot]);
    held.relYaw = held.kind === 'flask' ? 0 : wrapAngle(this.heldPose(held).yaw - this.player.yaw);
    held.follow = [];
    if (!held.ghost) this.enter(held);
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
    // a stopcock comes out shut
    if (kind === 'stopcock') return { kind: 'cock', c: { valve: 0, nozzle: false }, pose: { ...CABINET.slots.stopcock[slot] }, relYaw: 0, dist: 0 };
    // (held with its middle on the crosshair, like anything made in hand, a sheet lying flat included: looked down on,
    // as a sheet is when it's laid on a counter, its face is seen)
    return { kind: 'tool', t: new Tool(kind, this.nextToolId++, undefined), relYaw: 0, dist: 0 };
  }

  /** Make what's just been taken hold of move by a ghost (see Held.ghost), if it's moved that way (see ghostly), starting where it is. */
  private ghostIf(h: Held): void {
    if (ghostly(h)) h.ghost = { pose: { ...this.objPose(h) } };
  }

  /** Whether what's held is in the lab: all of it is, but a ghost of something just made (see Held.ghost). */
  private inLab(h: Held): boolean {
    if (h.kind === 'tool') return this.tools.includes(h.t);
    if (h.kind === 'scale') return this.scales.includes(h.sc);
    return true;
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
      this.tools = this.tools.filter((t) => t !== h.t);
      this.hoses = this.hoses.filter((hose) => !('tool' in hose.on && hose.on.tool === h.t));
    }
    if (h.kind === 'scale') this.scales = this.scales.filter((sc) => sc !== h.sc);
    // (a stopcock goes back in its compartment, if there's a place for it there; if not, it's just gone, as anything
    // more of a kind than the cabinet holds is)
    const kind = h.kind === 'tool' ? h.t.kind : h.kind === 'cock' ? 'stopcock' : h.kind;
    if (isStocked(kind)) putIn(this.stock, kind);
    if (h.kind === 'hose') {
      this.hoses.splice(this.hoses.indexOf(h.h), 1);
      // (a stopcock on its end goes with it, up to the spout's tip)
      this.cockToTip(h.h.on);
    }
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
    if (h.kind === 'cock') {
      const { y0, y1, z0, z1 } = COCK_EXTENT;
      return { x: 0, y: -(y0 + y1) / 2, z: (z0 + z1) / 2 };
    }
    // (a nozzle's box reaches down over a stopcock on its end, see nozzleBox)
    return { x: 0, y: (NOZZLE_H - (this.cockOn(h.h.on)?.nozzle ? STOPCOCK.drop : 0)) / 2, z: 0 };
  }

  /**
   * How far in front of the eyes something is held to start with: just clear of the player, with room to see it; a
   * flask, which is small, further off, so it isn't in the player's face.
   */
  private holdDist(h: Held): number {
    const b = this.heldBox(h);
    return (Math.hypot(b.hx, b.hz) + 90) * (h.kind === 'flask' ? FLASK_HOLD : 1);
  }

  /** Where it's held from: its own pose, or for a hose, its nozzle's tip (which doesn't turn); or its ghost's. */
  private heldPose(h: Held): Pose {
    return h.ghost ? h.ghost.pose : this.objPose(h);
  }

  /** Where what's held itself is: as heldPose, but for one moved by a ghost, where it's been left. */
  private objPose(h: Held): Pose {
    if (h.kind === 'flask') return h.f.pose;
    if (h.kind === 'tool') return h.t.pose;
    if (h.kind === 'scale') return h.sc.pose;
    if (h.kind === 'cock') return h.pose;
    return { ...h.h.outlet, yaw: 0 };
  }

  /** Hold what's held at a pose, with whatever goes along with it; or its ghost (see Held.ghost). */
  private placeHeld(h: Held, p: Pose): void {
    if (h.ghost) h.ghost.pose = p;
    else this.putAt(h, p);
  }

  /**
   * Put what's held itself at a pose, with whatever goes along with it, ghost or not: to set it down, or for a
   * moment, to see what would be if it were there.
   */
  private putAt(h: Held, p: Pose): void {
    if (h.kind === 'flask') h.f.pose = p;
    else if (h.kind === 'tool') h.t.pose = p;
    else if (h.kind === 'scale') {
      h.sc.pose = p;
      this.settle();
    } else if (h.kind === 'cock') h.pose = p;
    else h.h.outlet = { x: p.x, y: p.y, z: p.z };
  }

  /**
   * Where what's held would be, where it's held from the eyes (see Held.dir): facing the nearest of the four ways
   * along the room (see toCardinal) to how it's turned from the player, so it turns in quarter turns; but while Alt is
   * held (see free), just as it's turned from them, so it turns as they do.
   */
  private gripPose(h: Held): Pose {
    const eye = this.eye();
    const { right, up, ahead } = this.viewAxes();
    const k = h.dir ?? { x: 0, y: 0, z: 1 };
    const d = {
      x: right.x * k.x + up.x * k.y + ahead.x * k.z, y: right.y * k.x + up.y * k.y + ahead.y * k.z, z: right.z * k.x + up.z * k.y + ahead.z * k.z,
    };
    const yaw = h.kind === 'hose' ? 0 : this.facing(h);
    const off = toWorld({ x: 0, y: 0, z: 0, yaw }, this.anchor(h));
    return { x: eye.x + d.x * h.dist - off.x, y: eye.y + d.y * h.dist - off.y, z: eye.z + d.z * h.dist - off.z, yaw };
  }

  /** The box of what's held (a hose's nozzle's, for a hose). */
  private heldBox(h: Held): Box {
    if (h.kind === 'flask') return flaskBox(h.f);
    if (h.kind === 'tool') return toolBox(h.t);
    if (h.kind === 'scale') return scaleBox(h.sc, true);
    if (h.kind === 'cock') return cockBox(h.pose, h.pose.yaw);
    return this.nozzleBox(h.h);
  }

  /** A hose's nozzle's box, with the stopcock on its end, if there is one (see nozzleBox in bodies.ts). */
  private nozzleBox(hose: Hose): Box {
    return nozzleBox(hose, !!this.cockOn(hose.on)?.nozzle);
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
   *
   * A sheet of blotting paper lying on a counter (see ToolShape.flat) is in nothing's way but another sheet's: whatever
   * else is set down on its cell stands on it as if it weren't there, a stand's base included. And nothing but
   * another sheet, and what's built in (the room, the counters, the cabinet, the faucets' risers and the tools that
   * are fixed), is in the way of a held sheet, which is laid under whatever stands there.
   */
  private obstacles(h: Held | null, bases = true, away: Tool | null = null, skip: ReadonlySet<Hose> = new Set()): Box[] {
    // while the airlock's doors are open, its doorway and chamber take the front wall's place
    const room = this.wake === 'closed' ? roomBoxes(ROOM) : [...roomBoxes(ROOM, false), ...airlockBoxes()];
    const riders = h?.kind === 'scale' ? new Set(h.sc.load.map((l) => l.f)) : new Set<Flask>();
    const out: Box[] = [...room, ...COUNTER_BOXES, CABINET_BOX, ...this.risers()];
    const gone = (t: Tool) => (h?.kind === 'tool' && h.t === t) || t === away;
    if (h?.kind === 'tool' && h.t.shape.flat) {
      for (const t of this.tools) if (!gone(t) && (t.shape.flat || t.shape.fixed)) out.push(toolBox(t));
      return out;
    }
    for (const f of this.flasks) if (!(h?.kind === 'flask' && h.f === f) && !riders.has(f)) out.push(flaskBox(f));
    for (const t of this.tools) if (!gone(t) && !t.shape.flat) out.push(toolBox(t));
    for (const sc of this.scales) if (!(h?.kind === 'scale' && h.sc === sc)) out.push(scaleBox(sc));
    const following = new Set(h?.follow?.map((f) => f.hose));
    for (const hose of this.hoses)
      if (!(h?.kind === 'hose' && h.h === hose) && !following.has(hose) && !skip.has(hose)) {
        if (!(h?.kind === 'tool' && 'tool' in hose.on && hose.on.tool === h.t)) out.push(this.nozzleBox(hose));
        if (bases) out.push(standBase(nozzleStand(hose.outlet, hose.turn, hose.reach)));
      }
    if (bases) for (const t of this.tools) if (!gone(t)) for (const st of toolStands(t)) out.push(standBase(st));
    return out;
  }

  /** The islands' faucets' risers, each a round post from the counter up to its elbow. */
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

  /**
   * Where the view is and which way it looks: from the player's eyes, the way they look; or, sniffing, on its way from
   * there to the rim of what's sniffed, or back (see sniff). Only the view goes: she stands where she stood.
   */
  private gaze(): Gaze {
    const eye = this.eye();
    const { yaw, pitch } = this.player;
    const s = this.sniffing;
    if (!s) return { eye, yaw, pitch };
    const a = ease(s.lean);
    const mix = (p: number, q: number) => p + (q - p) * a;
    return {
      eye: { x: mix(eye.x, s.to.eye.x), y: mix(eye.y, s.to.eye.y), z: mix(eye.z, s.to.eye.z) },
      yaw: wrapAngle(yaw + wrapAngle(s.to.yaw - yaw) * a),
      pitch: mix(pitch, s.to.pitch),
    };
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
   * R: turn what's held a quarter turn anticlockwise, as seen from above; for a hose's nozzle, that swings its stand
   * round it. A flask is round, so turning it does nothing (see faceFlask).
   */
  private turn(): void {
    const h = this.held;
    if (h && h.kind !== 'flask') h.relYaw = wrapAngle(h.relYaw + Math.PI / 2);
  }

  /**
   * The touch screen's stand-in for R, Shift and the mouse, and the wheel: a drag across turns what's held, and up holds it
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
        // letting go of the mouse (Esc) cuts a sniff short
        this.endSniff();
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
      // the wheel has the mouse while it's open, and her hands do nothing while she sniffs
      if (this.wheel || this.sniffing) return;
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
      else if (!this.sniffing) this.look(e.movementX, e.movementY, e.shiftKey);
    });
    on(c, 'wheel', (e) => {
      e.preventDefault();
      if (!this.held || this.sniffing) return;
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
      if (e.ctrlKey || e.metaKey) return;
      // Alt is the browser's while the mouse is free; captured, it's held to set things down just as they're held (see
      // free), and the browser mustn't take it, or the keys pressed with it, for its own (its menu, Alt+D, ...)
      if (e.altKey) {
        if (!this.locked) return;
        e.preventDefault();
      }
      // Enter is OK on the message inside the cryopod, as it was on the notice it replaced
      if (e.code === 'Enter' && this.wake === 'pod') this.pressOk();
      // napping, or nodding off, N wakes them, whether or not the mouse is captured, and nothing else does anything
      if (this.dozing()) {
        if (e.code === 'KeyN' && !e.repeat) this.wakeNap();
        return;
      }
      // in god mode, = shows the end's white void, or puts the lab back
      if (e.code === 'Equal' && (this.god || this.previewing) && !this.sniffing) {
        if (!e.repeat) this.previewArrival(!this.previewing);
        return;
      }
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.repeat || inPod(this.wake) || this.previewing) return;
      // sniffing, F cuts it short, and no other key does anything until she's back where she stood
      if (this.sniffing) {
        if (e.code === 'KeyF') this.endSniff();
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyE') this.grabOrRelease(e.shiftKey);
      if (e.code === 'KeyQ') this.putBack();
      if (e.code === 'KeyR') this.turn();
      if (e.code === 'Enter') {
        // the note's text box opens at once, and this Enter mustn't be taken as finishing it
        e.preventDefault();
        this.writeNote();
      }
      if (e.code === 'KeyN') this.nap();
      if (e.code === 'KeyF') this.sniff();
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
      // (letting go of Alt mustn't open the browser's menu either)
      if (this.locked && (e.code === 'AltLeft' || e.code === 'AltRight')) e.preventDefault();
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

  /** The mouse moved by (dx, dy) pixels: sweep round a valve to turn it, slide a held nozzle's stand (with Shift), or look around. */
  private look(dx: number, dy: number, shift: boolean): void {
    if (this.turning) {
      const a = this.turning.aim;
      a.x = Math.max(0, Math.min(this.viewW, a.x + dx));
      a.y = Math.max(0, Math.min(this.viewH, a.y + dy));
      this.aimTurning();
      return;
    }
    // with Shift, a held nozzle's stand slides along its arm instead (R turns things: see turn)
    if (shift && this.held?.kind === 'hose') {
      this.slideReach(this.held, dy);
      return;
    }
    const p = this.player;
    // zoomed in, the mouse turns the view less, so what's seen moves across the screen as it ever does
    const sens = (LOOK_SENS * Math.tan((this.fov() * Math.PI) / 360)) / Math.tan((FOV * Math.PI) / 360);
    p.yaw = wrapAngle(p.yaw - dx * sens);
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - dy * sens));
  }

  /** The view's field of view now, top to bottom, in degrees: narrower as far as it's zoomed in (see ZOOM). */
  private fov(): number {
    return FOV + (ZOOM.fov - FOV) * ease(this.zoom);
  }

  /**
   * Turn the valve being turned by as far as the pointer has swept round its middle since it was last taken, on the face
   * it lies on (a tool's handwheel's or dial's, or a faucet's, see faucetValvePose): never to where the
   * pointer is, only by how far it's gone round, so taking hold of it moves nothing, and nor does the pointer coming out
   * of the dead zone round its middle.
   */
  private aimTurning(): void {
    const tr = this.turning;
    if (!tr || !this.viewW) return;
    const { aim } = tr;
    const { o, d } = this.view.ray((aim.x / this.viewW) * 2 - 1, 1 - (aim.y / this.viewH) * 2);
    const t = 't' in tr ? tr.t : null;
    const fa = 'faucet' in tr ? this.faucets[tr.faucet] : null;
    const cock = 'cock' in tr ? this.cockOn(tr.cock) : null;
    if ('cock' in tr && !cock) return;
    const pose = t ? t.pose : cock ? this.cockFrame({ m: (tr as { cock: HoseMount }).cock, nozzle: cock.nozzle }) : faucetValvePose(fa!);
    const n = { x: Math.sin(pose.yaw), y: 0, z: Math.cos(pose.yaw) };
    const p0 =
      t && 't' in tr ? onTool(t, 0, 0, valveFaceZ(t, tr.k))
      : cock ? toWorld(pose, { x: 0, y: 0, z: COCK_WHEEL_Z + VALVE_WHEEL.thick / 2 })
      : toWorld(pose, { x: 0, y: 0, z: FAUCET_VALVE.pipe + VALVE_WHEEL.gap + VALVE_WHEEL.thick });
    const dn = d.x * n.x + d.z * n.z;
    if (Math.abs(dn) < 1e-3) return;
    const s = ((p0.x - o.x) * n.x + (p0.z - o.z) * n.z) / dn;
    if (s <= 0) return;
    const l = toLocal(pose, { x: o.x + d.x * s, y: o.y + d.y * s, z: o.z + d.z * s });
    // the pointer's angle round the valve's middle, x right and y down on its face
    const c = 't' in tr ? valveLocal(tr.t, tr.k) : cock ? { x: 0, y: STOPCOCK.wheelY } : { x: 0, y: 0 };
    const a = aimAngle(l.x - c.x, -l.y - c.y);
    const by = swept(tr.last, a);
    tr.last = a;
    if (!by) return;
    if ('t' in tr) turnValve(tr.t, tr.k, by);
    else if (cock) {
      // a stopcock turns as a plain valve does
      cock.angle = sweep('valve', settleAngle('valve', cock.angle, cock.valve), by);
      cock.valve = valveAt('valve', cock.angle);
    } else if (fa) {
      // a faucet's valve turns as a tool's plain valve does
      fa.angle = sweep('valve', settleAngle('valve', fa.angle, fa.valve), by);
      fa.valve = valveAt('valve', fa.angle);
    }
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
    // (the shadow lamp's button is for pressing, with the left button)
    if (p.kind === 'tool' && p.part === 'button') return;
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
    this.ghostIf(h);
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
      if (this.hoseOn({ tool: t, spout: j }) || !this.flowing({ tool: t, spout: j })) continue;
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
      if (!this.hoseOn(m) && !this.flowing(m)) return;
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

  /** Whether a spout or a faucet is letting something out: streaming, or gathering a drop. */
  private flowing(m: HoseMount): boolean {
    if ('faucet' in m) {
      const fa = this.faucets[m.faucet];
      return !!fa.out || fa.drop.N > 0;
    }
    return !!m.tool.out[m.spout] || m.tool.drops[m.spout].N > 0;
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
   * same spot of it, on a stand where there's room (see rest), still pouring into it; as high over it as
   * it was if there's room, or else as low as there is, from NOZZLE_GAP over the mouth up to POUR_RISE. Or why not.
   */
  private followRests(h: Held, r: Rest): Rest[] | string {
    const fs = h.follow ?? [];
    const at = this.objPose(h);
    const tilt = h.kind === 'flask' ? h.f.tilt : 0;
    const saved = fs.map((f) => ({ outlet: f.hose.outlet, turn: f.hose.turn, reach: f.hose.reach }));
    // put it there, upright, for a moment, to see; and each hose there in turn, for the next to go round
    if (h.kind === 'flask') h.f.tilt = 0;
    this.putAt(h, r.pose);
    const mouths = this.mouths();
    const frame = this.carryFrame(h, r.pose);
    const unplaced = new Set(fs.map((f) => f.hose));
    const out: Rest[] = [];
    let why: string | null = null;
    for (const f of fs) {
      unplaced.delete(f.hose);
      f.hose.turn = wrapAngle(f.turn + frame.yaw);
      const fh: Held = { kind: 'hose', h: f.hose, reach: f.hose.reach, relYaw: wrapAngle(f.hose.turn - this.player.yaw), dist: 0 };
      const tip = { ...toWorld(frame, f.off), yaw: 0 };
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
    this.putAt(h, at);
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
   * valve), or a tool's spout, its tip or the pipe that runs to it alone. Null if it's on
   * neither.
   */
  private mountAimed(): HoseMount | null {
    const p = this.target;
    if (p?.kind === 'faucet') return p.spout ? { faucet: p.i } : null;
    // (nothing on the station can be worked through its changeover)
    if (p?.kind !== 'tool' || p.part !== 'spout' || !p.t.shape.spouts.length || p.t.swap !== null) return null;
    return { tool: p.t, spout: p.k };
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

  /**
   * Where a hose pulled out of a spout or faucet runs from: its tip, or the foot of the stopcock fitted there, if
   * there is one at its tip (see spoutAt).
   */
  private mountAt(m: HoseMount): Vec3 {
    if ('tool' in m) return spoutAt(m.tool, m.spout);
    const fa = this.faucets[m.faucet];
    return fa.cock && !fa.cock.nozzle ? { ...fa.spout, y: fa.spout.y - STOPCOCK.drop } : fa.spout;
  }

  /** The stopcock on a spout or faucet, wherever on it it is (see Cock), if there is one. */
  private cockOn(m: HoseMount): Cock | null {
    return 'tool' in m ? (m.tool.cocks[m.spout] ?? null) : this.faucets[m.faucet].cock;
  }

  /** Bring the stopcock on the end of a spout's or faucet's hose, if there is one, up to its tip (see Cock). */
  private cockToTip(m: HoseMount): void {
    const c = this.cockOn(m);
    if (c) c.nozzle = false;
  }

  /**
   * Bring every stopcock that's on the end of a hose that isn't out any more (rolled up, or never loaded) up to its
   * spout's tip.
   */
  private tidyCocks(): void {
    for (const t of this.tools) t.cocks.forEach((c, j) => c?.nozzle && !this.hoseOn({ tool: t, spout: j }) && (c.nozzle = false));
    this.faucets.forEach((fa, i) => fa.cock?.nozzle && !this.hoseOn({ faucet: i }) && (fa.cock.nozzle = false));
  }

  /** Fit stopcock c on a spout or faucet, or with null, take off the one there. */
  private setCock(m: HoseMount, c: Cock | null): void {
    if ('tool' in m) m.tool.cocks[m.spout] = c;
    else this.faucets[m.faucet].cock = c;
  }

  /**
   * Whether a spout or faucet can have a stopcock fitted on it: any but the station's waste spigot, which only its
   * diverter works.
   */
  private takesCock(m: HoseMount): boolean {
    return !('tool' in m && m.tool.shape.wall && m.spout === 0);
  }

  /** Whether a spout is the station's while its changeover's under way, when nothing on it can be worked. */
  private awayOn(m: HoseMount): boolean {
    return 'tool' in m && m.tool.swap !== null;
  }

  /** Whether a hose's nozzle at p is docked on an inline instrument's tube (see docked). */
  private isDocked(p: Vec3): boolean {
    const q = { ...p, yaw: 0 };
    return docked(q, this.tools) !== q;
  }

  /**
   * Where a stopcock on a spout or faucet hangs from and which way it faces (see STOPCOCK): at the spout's tip, facing
   * the tool's front; or on the end of its hose, under the nozzle, facing the way the nozzle does.
   */
  private cockFrame(spot: CockSpot): Pose {
    const { m } = spot;
    const hose = spot.nozzle ? this.hoseOn(m) : undefined;
    if (hose) return { ...hose.outlet, yaw: hose.turn };
    if ('tool' in m) return { ...spoutTip(m.tool, m.spout), yaw: m.tool.pose.yaw };
    // a faucet's faces as its valve does
    const fa = this.faucets[m.faucet];
    return { ...fa.spout, yaw: faucetValvePose(fa).yaw };
  }

  /** Where what a hose lets out leaves it: its nozzle's tip, or the foot of the stopcock on its end. */
  private nozzleOut(hose: Hose): Vec3 {
    const o = hose.outlet;
    return this.cockOn(hose.on)?.nozzle ? { ...o, y: o.y - STOPCOCK.drop } : o;
  }

  /** The hose pulled out of a spout or faucet, if there is one. */
  private hoseOn(m: HoseMount): Hose | undefined {
    return this.hoses.find((h) => sameMount(h.on, m));
  }

  /**
   * Where what leaves a tool's spout comes out: the spout (or the foot of the stopcock at its tip, see spoutAt), or
   * the nozzle of its hose if one's pulled out (or the foot of the stopcock on its end, see nozzleOut).
   */
  private outletAt(t: Tool, j: number): Vec3 {
    const hose = this.hoseOn({ tool: t, spout: j });
    return hose ? this.nozzleOut(hose) : spoutAt(t, j);
  }

  /** Where what a faucet pours comes out, the same way. */
  private faucetOutlet(i: number): Vec3 {
    const hose = this.hoseOn({ faucet: i });
    return hose ? this.nozzleOut(hose) : this.mountAt({ faucet: i });
  }

  /**
   * Let go of what's held, if it can be set down (see placement): it comes to rest there. If it can't, a
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
    // one moved by a ghost was never moved: it's just let go of, as it is
    if (h.ghost) {
      this.held = null;
      this.pinned = null;
      this.commit();
      return;
    }
    this.setDown(h, h.from);
  }

  /** Let go of what's held, at rest (see rest): standing on a scale, for a flask, and for a nozzle, with its stand there. */
  private setDown(h: Held, rest: Rest): void {
    // (one moved by a ghost goes there at once; one just made comes into the lab)
    if (!this.inLab(h)) this.enter(h);
    this.putAt(h, rest.pose);
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
    // a nozzle docked on an instrument's tube has no room under it: a stopcock on its end goes to the spout's tip
    if (h.kind === 'hose' && this.isDocked(h.h.outlet)) this.cockToTip(h.h.on);
    if (h.kind === 'cock' && rest.cock) {
      h.c.nozzle = rest.cock.nozzle;
      this.setCock(rest.cock.m, h.c);
    }
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
    // with empty hands, a stopcock looked at is taken off
    const cock = this.held ? null : this.cockAimed();
    if (cock) {
      this.takeCock(cock);
      return;
    }
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
    if (p?.kind === 'tool' && p.part === 'button') {
      this.change(() => p.t.press());
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

  /**
   * What F would sniff: the flask or tank the crosshair is on, if it's open on top (see mouths), or 'sealed' if it
   * isn't, since nothing can be smelled through glass; or, with the crosshair on neither, the flask in hand (though F
   * does nothing while it's pouring: see handBusy). Null if there's nothing to sniff, as when the station's block is
   * back in the wall.
   */
  private sniffAim(): Vessel | 'sealed' | null {
    const p = this.target;
    const v = p?.kind === 'flask' ? p.f : p?.kind === 'tool' && p.part === 'tank' && !p.t.away ? p.t.tanks[p.k] : null;
    if (v) return this.open.some((m) => m.v === v) ? v : 'sealed';
    return this.held?.kind === 'flask' ? this.held.f : null;
  }

  /**
   * F: sniff what's in the vessel the crosshair is on, or in the flask in hand (see sniffAim). Her head leans in until
   * her nose is just over the vessel's rim, the view going with it to look down into its mouth (see rimGaze); or the
   * flask in her hand is brought up under her nose (see noseGaze). There she smells what's in it, as it is just then, by
   * what it's made of and how warm it is, and says what she makes of it, a piece at a time (see stepSniff); a beat
   * after the last of it she straightens up again, the view going back to just where it was. Until it's back she neither walks nor looks around, and her hands do nothing: only F,
   * or letting go of the mouse, cuts it short (see endSniff). It's her own doing, like her eyes closing for a nap, so
   * it all goes in real time, and works while the lab's paused; the lab runs on under it as ever. Only the view moves:
   * she stands where she stood. Not while what's in her hand is pouring, flowing or dipping.
   */
  private sniff(): void {
    if (this.dozing() || inPod(this.wake) || this.turning || this.wheel || this.sniffing) return;
    const v = this.sniffAim();
    if (!v) return;
    if (v === 'sealed') {
      this.say('It’s sealed');
      return;
    }
    if (this.handBusy()) return;
    const m = this.held?.kind === 'flask' && this.held.f === v ? null : this.open.find((o) => o.v === v);
    const hand = m ? null : this.noseGaze();
    this.smelled = null;
    this.sniffing = { v, lean: 0, to: m ? this.rimGaze(m) : hand!.gaze, hand: hand && hand.flask, until: null, leaving: false };
  }

  /** Whether what's held is being poured, let flow or dipped, with the right button: there's no sniffing meanwhile. */
  private handBusy(): boolean {
    return !!this.held && this.rightHeld;
  }

  /**
   * Cut a sniff short, if one's under way: she straightens up from wherever her head has got to, and says no more of
   * it than she has, which stays up as long as it would have.
   */
  private endSniff(): void {
    const s = this.sniffing;
    if (!s || s.leaving) return;
    s.leaving = true;
    const now = performance.now();
    const said = this.smelled;
    if (!said || said.cut !== null) return;
    said.cut = this.said(now);
    if (!said.cut) this.smelled = null;
    else if (said.cut < said.script.length) said.until = now + SMELL_MS;
  }

  /** How many pieces of what the last sniff smelled of have come up by real time `now` (see smelled). */
  private said(now: number): number {
    const s = this.smelled;
    if (!s) return 0;
    if (s.cut !== null) return s.cut;
    let k = 0;
    for (let t = s.from; k < s.script.length && (t += 1000 * s.script[k].wait) <= now; k++);
    return k;
  }

  /**
   * A frame of dt real seconds of the sniff under way (see sniff), at real time `now`: her head leans in, and once her
   * nose is at the rim she smells what's in the vessel then. What she says of it (see script) comes up on the display
   * a piece at a time from then on, in real time, and fades SMELL_MS after the last of it. SNIFF.beat after that last
   * piece she straightens up, and once she has, it's over.
   */
  private stepSniff(dt: number, now: number): void {
    const s = this.sniffing;
    if (!s) return;
    s.lean = Math.max(0, Math.min(1, s.lean + (s.leaving ? -dt / SNIFF.out : dt / SNIFF.in)));
    if (s.leaving) {
      if (s.lean <= 0) this.sniffing = null;
      return;
    }
    if (s.lean < 1) return;
    if (s.until === null) {
      const says = script(smell(s.v.n, temperature(s.v)));
      const last = now + 1000 * span(says);
      this.smelled = { script: says, n: ++this.sniffs, from: now, cut: null, until: last + SMELL_MS };
      s.until = last + 1000 * SNIFF.beat;
    } else if (now >= s.until) s.leaving = true;
  }

  /**
   * Where the view is with her nose at the rim of an open top: SNIFF.up over its edge nearest where she stands, facing
   * across it from there, and looking down at the mouth SNIFF.into in from that edge, so into it. Under something
   * drawn that leaves less room (a nozzle or a spout over it, the tool it's standing under), her eyes are SNIFF.clear
   * below that, if that's still SNIFF.least over the rim, or else as far back from the edge as it takes; and with no
   * room anywhere, the view stays where it is, and she sniffs from where she stands.
   */
  private rimGaze(m: Mouth): Gaze {
    const p = this.player;
    // level, from the mouth's middle back toward her
    let bx = p.x - m.x;
    let bz = p.z - m.z;
    const d = Math.hypot(bx, bz);
    [bx, bz] = d < 1 ? [Math.sin(p.yaw), Math.cos(p.yaw)] : [bx / d, bz / d];
    const yaw = Math.atan2(bx, bz);
    // how far the mouth reaches that way: a box's edge, but no further than a round one's would be
    const c = Math.cos(m.yaw ?? 0);
    const sn = Math.sin(m.yaw ?? 0);
    const edge = Math.min(Math.max(m.hx, m.hz), 1 / Math.max(Math.abs(bx * c - bz * sn) / m.hx, Math.abs(bx * sn + bz * c) / m.hz));
    for (let back = 0; back <= SNIFF.reach; back += SNIFF.back) {
      const x = m.x + bx * (edge + back);
      const z = m.z + bz * (edge + back);
      const room = this.view.clearance({ x, y: m.y + 1, z }, { x: 0, y: 1, z: 0 }, SNIFF.up + SNIFF.clear) + 1;
      const up = Math.min(SNIFF.up, room - SNIFF.clear);
      if (up >= SNIFF.least) return { eye: { x, y: m.y + up, z }, yaw, pitch: -Math.atan2(up, SNIFF.into + back) };
    }
    return { eye: this.eye(), yaw: p.yaw, pitch: p.pitch };
  }

  /**
   * Sniffing the flask in her hand, there's no rim out in the room to lean to: it's brought up under her nose instead,
   * to where she sees it as she would one she'd leaned to (see rimGaze), and she looks down into it from where she
   * stands. Where the view is then, and where the flask is.
   */
  private noseGaze(): { gaze: Gaze; flask: Pose } {
    const eye = this.eye();
    const { yaw } = this.player;
    const flask = { x: eye.x - Math.sin(yaw) * FLASK_CATCH, y: eye.y - SNIFF.up, z: eye.z - Math.cos(yaw) * FLASK_CATCH, yaw: 0 };
    return { gaze: { eye, yaw, pitch: -Math.atan2(SNIFF.up, SNIFF.into) }, flask };
  }

  /**
   * Where what's held is: in front of the eyes (see gripPose), or, a flask being sniffed, on its way from there up to
   * under her nose, or back (see noseGaze).
   */
  private heldAt(h: Held): Pose {
    const grip = this.gripPose(h);
    const s = this.sniffing;
    if (!s?.hand || h.kind !== 'flask' || h.f !== s.v) return grip;
    const a = ease(s.lean);
    return { x: grip.x + (s.hand.x - grip.x) * a, y: grip.y + (s.hand.y - grip.y) * a, z: grip.z + (s.hand.z - grip.z) * a, yaw: grip.yaw };
  }

  private rightDown(): void {
    if (this.dozing()) return;
    if (inPod(this.wake)) return;
    this.rightHeld = true;
    const h = this.held;
    if (h?.kind === 'flask') {
      // on a flask or tank, the held flask goes over it to pour in
      const m = this.mouthAimed(true);
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
    this.turning = { ...k, aim: { x: this.viewW / 2, y: this.viewH / 2 }, last: null };
    this.aimTurning();
  }

  /**
   * The open top of the vessel the crosshair is on, to pour a held flask into: a flask's, or a tool's tank's; or, with
   * `sheets`, the face of a sheet of blotting paper (see BLOTTERS), which is poured onto but has nothing to dip into.
   */
  private mouthAimed(sheets = false): Mouth | null {
    const p = this.target;
    const v =
      p?.kind === 'flask' ? p.f
      : p?.kind === 'tool' && p.part === 'tank' ? p.t.tanks[p.k]
      : sheets && p?.kind === 'tool' && isBlotter(p.t.kind) ? p.t.paper[0]
      : null;
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
   * Where a held nozzle goes with the crosshair on an open top (see mouthAimed): over the mouth's middle,
   * NOZZLE_GAP above it or as much higher as it takes (up to POUR_RISE) for it and its stand to have room, so it can
   * be set down there and what it lets out lands in the mouth. Null if there's no such place.
   */
  private nozzleOver(h: Held & { kind: 'hose' }): Pose | null {
    const m = this.mouthAimed(true);
    if (!m) return null;
    const obstacles = this.obstacles(h);
    const solid = this.obstacles(h, false);
    // (with a stopcock on its end, that far above the stopcock's foot)
    const foot = this.cockOn(h.h.on)?.nozzle ? STOPCOCK.drop : 0;
    for (let up = NOZZLE_GAP + foot; up <= POUR_RISE + foot; up += 10) {
      const p = { x: m.x, y: m.y + up, z: m.z, yaw: 0 };
      const r = this.rest(h, p, obstacles, solid);
      if (typeof r !== 'string') return mouthBelow(this.open, r.pose) === m ? p : null;
    }
    return null;
  }

  /**
   * Where a held dipper (see DIPPERS) goes with the crosshair on an open top (see mouthAimed): upright, facing as it's
   * held (see facing), over the middle of the mouth, hovering a little above it, or dipped into it, its foot just
   * under the fluid's surface (see dipPoses); and where it would be set down standing in it, deeper (see dipPoses and
   * rest), or why it can't be. Null if the crosshair is on no open top.
   */
  private dipAim(h: Held & { kind: 'tool' }): { hover: Pose; dipped: Pose; rest: { rest: Rest } | { why: string } } | null {
    const p = this.target;
    const m = this.mouthAimed();
    if (!m || (p?.kind !== 'flask' && p?.kind !== 'tool')) return null;
    const fluid = p.kind === 'flask' ? flaskFluid(p.f) : tankFluid(p.t, p.k);
    const { hover, dipped, stood } = dipPoses(h.t, m, fluid, this.facing(h));
    const r = this.rest(h, stood, [...this.obstacles(h), this.me()], [...this.obstacles(h, false), this.me()]);
    return { hover, dipped, rest: typeof r === 'string' ? { why: r } : { rest: r } };
  }

  /** The player's body, as a box, which what's set down mustn't overlap. */
  private me(): Box {
    const { x, z } = this.player;
    return { x, y: (EYE + 20) / 2, z, yaw: 0, hx: PLAYER_R, hy: (EYE + 20) / 2, hz: PLAYER_R, round: true };
  }

  /**
   * The valve the crosshair is on, if any: a tool's handwheel or dial, or a faucet's, never a part beside one (see
   * the view's partOf).
   */
  private valveAimed(): ValveRef | null {
    const p = this.target;
    // a faucet's valve is its handwheel, and so is a stopcock's on it
    if (p?.kind === 'faucet') return p.valve ? { faucet: p.i } : p.cock && p.turns ? { cock: { faucet: p.i } } : null;
    if (p?.kind === 'hose') return p.cock && p.turns && !this.awayOn(p.h.on) ? { cock: p.h.on } : null;
    if (p?.kind !== 'tool' || p.t.swap !== null) return null;
    // a stopcock's is its handwheel, and the hub it's on
    if (p.part === 'cock') return p.turns ? { cock: { tool: p.t, spout: p.k } } : null;
    return p.part === 'valve' ? { t: p.t, k: p.k } : null;
  }

  /** The stopcock the crosshair is on, to take off (see takeCock): the spout or faucet it's on, wherever on it it is. */
  private cockAimed(): HoseMount | null {
    const p = this.target;
    if (p?.kind === 'tool' && p.part === 'cock' && p.t.swap === null) return { tool: p.t, spout: p.k };
    if (p?.kind === 'hose' && p.cock && !this.awayOn(p.h.on)) return p.h.on;
    if (p?.kind === 'faucet' && p.cock) return { faucet: p.i };
    return null;
  }

  /**
   * Take a stopcock off what it's on into the hand, just where it was, so that what it was on is fully open. Q puts it
   * back.
   */
  private takeCock(m: HoseMount): void {
    const c = this.cockOn(m);
    if (!c) return;
    this.mark();
    const spot = { m, nozzle: c.nozzle };
    const pose = this.cockFrame(spot);
    this.setCock(m, null);
    const h: Held = { kind: 'cock', c, pose, relYaw: wrapAngle(pose.yaw - this.player.yaw), dist: 0, from: { pose, cock: spot } };
    this.holdInPlace(h);
    this.held = h;
  }

  /**
   * Where a held stopcock would go on, if it were let go of now: the end of an outlet with none on it (see takesCock),
   * the one the crosshair is on (a spout, or a hose's nozzle), or else the one nearest the line it's on, within
   * COCK_SNAP of it and REACH of the eyes; and why it can't, if it would be in something there (see cockRoom). Null if there's nowhere near.
   */
  private cockAim(): { spot: CockSpot; pose: Pose; why: string | null } | null {
    const free = (m: HoseMount) => this.takesCock(m) && !this.cockOn(m) && !this.awayOn(m);
    const p = this.target;
    let spot: CockSpot | null = null;
    if (p?.kind === 'tool' && p.part === 'spout' && p.t.swap === null && free({ tool: p.t, spout: p.k })) spot = { m: { tool: p.t, spout: p.k }, nozzle: false };
    // a hose's nozzle, for one on its end; or a faucet's spout
    if (p?.kind === 'hose' && !p.cock && free(p.h.on)) spot = { m: p.h.on, nozzle: true };
    if (p?.kind === 'faucet' && p.spout && free({ faucet: p.i })) spot = { m: { faucet: p.i }, nozzle: false };
    if (!spot) {
      // the one nearest the line the crosshair is on, within reach
      const eye = this.eye();
      const look = this.lookDir();
      let best = COCK_SNAP;
      const near = (s: CockSpot) => {
        const q = this.cockFrame(s);
        const v = { x: q.x - eye.x, y: q.y - eye.y, z: q.z - eye.z };
        const along = v.x * look.x + v.y * look.y + v.z * look.z;
        if (along <= 0 || along > REACH) return;
        const d = Math.hypot(v.x - along * look.x, v.y - along * look.y, v.z - along * look.z);
        if (d <= best) [best, spot] = [d, s];
      };
      for (const t of this.tools) if (t.swap === null) t.shape.spouts.forEach((_, j) => free({ tool: t, spout: j }) && near({ m: { tool: t, spout: j }, nozzle: false }));
      this.faucets.forEach((_, i) => free({ faucet: i }) && near({ m: { faucet: i }, nozzle: false }));
      for (const hose of this.hoses) if (free(hose.on) && !this.awayOn(hose.on)) near({ m: hose.on, nozzle: true });
    }
    if (!spot) return null;
    const pose = this.cockFrame(spot);
    // (nor under a nozzle docked on an instrument's tube, which is in the tube)
    const docked = spot.nozzle && this.isDocked(pose);
    return { spot, pose, why: !docked && this.cockRoom(spot, pose) ? null : 'No room for a stopcock there' };
  }

  /**
   * Whether there's room for a stopcock on `spot`, hanging from `pose`: it mustn't be in anything but what it's
   * fitted on (the tool whose spout it is, or the hose's nozzle).
   */
  private cockRoom(spot: CockSpot, pose: Pose): boolean {
    const m = spot.m;
    const own = 'tool' in m && !spot.nozzle ? m.tool : null;
    const hose = this.hoseOn(m);
    const box = cockBox(pose, pose.yaw);
    return !this.obstacles(null, false, own, new Set(hose ? [hose] : [])).some((o) => boxesOverlap(box, o));
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

  /** Where a tool's machinery sounds from: the supply station's display. */
  private machineAt(t: Tool): Vec3 {
    if (t.shape.wall) {
      const d = STATION.display;
      return onTool(t, (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, -STATION.out);
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

  /**
   * Every open top (see mouths), and what's held's own, if it's a ghost of something not yet in the lab (see
   * Held.ghost), to see where it would line up.
   */
  private mouthsWith(h: Held): Mouth[] {
    const out = this.mouths();
    if (h.kind === 'tool' && !this.inLab(h)) h.t.tanks.forEach((_, k) => h.t.isOpen(k) && out.push(tankMouth(h.t, k)));
    return out;
  }

  /** Every open top that falling fluid can land in. A flask tipped to pour has none. */
  private mouths(): Mouth[] {
    const out: Mouth[] = [];
    for (const f of this.flasks) if (f.tilt < 0.05) out.push(flaskMouth(f));
    // (the station's funnel is back in the wall through a changeover)
    for (const t of this.tools) if (!t.away) t.tanks.forEach((_, k) => t.isOpen(k) && out.push(tankMouth(t, k)));
    // a sheet of blotting paper's whole face
    for (const t of this.tools) if (isBlotter(t.kind)) out.push(paperMouth(t));
    return out;
  }

  /**
   * Where something falling from p stops, for drawing it: the first open top under it, or else the floor or counter. A
   * soaked sheet of blotting paper stops none of it (see land), so it's drawn falling on past one.
   */
  private landsAt(p: Vec3, mouths: readonly Mouth[]): number {
    let m = mouthBelow(mouths, p);
    while (m && m.v instanceof Blotter && m.v.soaked) m = mouthBelow(mouths, { x: p.x, y: m.y, z: p.z });
    return m ? m.y : groundAt(p.x, p.z);
  }

  /**
   * What fell from `from` lands in the open top m under it: `amount` of src (by volume), which isn't depleted, as a
   * stream (see stream), or, `drop`, as a drop (see fill). A sheet of blotting paper's face is no vessel's mouth: the
   * sheet takes up what it has room for (see Blotter.soak), and the rest falls on from where it struck, into the next
   * open top below, if there is one. Under a sheet lying on a counter there's none, so the rest is lost, as off the
   * bare counter; under one held in the hand there may be, so a sheet waved through a stream is wetted, and the
   * stream runs on into whatever it was filling.
   */
  private land(m: Mouth | null, from: Vec3, src: Fluid, amount = volume(src), drop = false): void {
    while (m && m.v instanceof Blotter) {
      // (it's heard striking the sheet, however much of it the sheet takes up)
      if (!drop) this.inflow.set(m.v, (this.inflow.get(m.v) ?? 0) + amount);
      if (!m.v.soaked) {
        // a packet of its own, since src isn't to be depleted, for the sheet to take its share out of
        const rest = new Vessel(Infinity);
        rest.addFrom(src, amount, true);
        m.v.soak(rest);
        if (rest.N <= 0) return;
        src = rest;
        amount = volume(rest);
      }
      m = mouthBelow(this.open, { x: from.x, y: m.y, z: from.z });
    }
    if (!m) return;
    if (drop) this.fill(m.v, src, amount);
    else this.stream(m.v, src, amount);
  }

  /**
   * Pour `amount` of src (by volume) into v, without depleting src, however full v is. Whatever no longer
   * fits overflows (see overflow). What's falling gets here through land, which knows a sheet of blotting paper's
   * face from a vessel's mouth.
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
    this.land(mouthBelow(this.open, rim), rim, out);
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
    this.stepSniff(dt, now);
    // nodding off, they stand where they are
    if (!nap || nap.waking) this.move(dt);
    if (this.wake === 'settling') this.settleIn(dt);
    if (this.held && !this.held.ghost) this.follow(this.held);
    const zoomed = this.keys.has('KeyZ') && !this.sniffing ? 1 : 0;
    this.zoom = Math.max(0, Math.min(1, this.zoom + (zoomed ? dt : -dt) / ZOOM.s));
    const g = this.gaze();
    this.view.look(g.eye, g.yaw, g.pitch, this.fov());
    // (sniffing, the crosshair stays on what it was on from where she stands)
    if (!this.turning && !this.sniffing) this.target = this.previewing ? null : this.view.pick(REACH, this.heldObject());
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
    // sniffing, she stands as she is and looks nowhere else, but what's in her hand is still held (see sniff)
    const still = !!this.sniffing;
    // the look stick turns the view at a rate, gently near its middle so small turns can be aimed
    if (!still && (look.x || look.y)) {
      p.yaw = wrapAngle(p.yaw - look.x * Math.abs(look.x) * STICK_TURN * dt);
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - look.y * Math.abs(look.y) * STICK_TILT * dt));
    }
    // shut in the pod, or in the preview of the end, they can only look
    if (inPod(this.wake) || this.previewing) return;
    const h = this.held;
    if (!still && (fwd || side)) {
      // keys walk at full speed whichever way; the move stick as far as it's pushed
      const len = Math.hypot(fwd, side);
      const sp = (WALK * dt * Math.min(1, len)) / len;
      const dx = (-Math.sin(p.yaw) * fwd + Math.cos(p.yaw) * side) * sp;
      const dz = (-Math.cos(p.yaw) * fwd - Math.sin(p.yaw) * side) * sp;
      const body = { x: p.x, z: p.z, r: PLAYER_R, y0: 0, y1: EYE + 20 };
      // (what's moved by a ghost is still where it was, in the way like anything)
      const r = walk(body, dx, dz, this.obstacles(h?.ghost ? null : h));
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
    this.placeHeld(h, this.pinned ?? this.heldAt(h));
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
   * What faucet fa lets out in a substep of h sim seconds, with its valve as it is (see faucetRate), in its own packet,
   * good only until its next: what it pours, in whole molecules.
   */
  private faucetLets(fa: LabFaucet, h: number): Vessel | null {
    const p = fa.packet;
    if (p.N) p.n.fill(0);
    p.N = 0;
    p.Q = 0;
    // as far as its valve is open, and a stopcock on it, if there is one
    p.addFrom(fa.output, faucetRate(fa.valve) * (fa.cock?.valve ?? 1) * h, true);
    return p.N > 0 ? p : null;
  }

  /**
   * Whether letting go of what's held would put it in the equipment cabinet: it's aimed at the cabinet, or at
   * something in it, and it's something the cabinet holds.
   */
  private intoCabinet(): boolean {
    const h = this.held;
    const p = this.target;
    if (!h || h.kind === 'hose' || (p?.kind !== 'cabinet' && p?.kind !== 'stock')) return false;
    return isStocked(h.kind === 'tool' ? h.t.kind : h.kind === 'cock' ? 'stopcock' : h.kind);
  }

  private heldObject(): object | null {
    const h = this.held;
    // (what's moved by a ghost isn't aimed at either: its ghost is outlined instead, see the view's GhostView)
    if (!h) return null;
    if (h.kind === 'flask') return h.f;
    if (h.kind === 'tool') return h.t;
    if (h.kind === 'scale') return h.sc;
    if (h.kind === 'cock') return h.c;
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

    // (cheap, and follows edits to the chemistry)
    for (const fa of this.faucets) fa.output = faucetOutput(fa.start, this.chem);

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
      // and what each pours into, if anything
      const targets = spouts.map((sps) => sps.map((sp) => mouthBelow(mouths, sp)));
      // and each faucet's, and what it runs into, if anything: with nothing under it, it runs away down the sink
      const taps = this.faucets.map((_, i) => this.faucetOutlet(i));
      const tapTargets = taps.map((sp) => faucetTarget(mouths, sp));
      // a fast flow streams straight into what's below (overflowing it if it's full); a slow one gathers
      // in a drop, which falls on its own time
      const pour = (drop: Vessel, out: Vessel | null, sp: Vec3, target: Mouth | null): boolean => {
        const down = drip(drop, out, step);
        if (down && down === out) this.land(target, sp, out);
        else if (down) this.falling.push({ v: down, x: sp.x, y: sp.y, z: sp.z, vy: 0 });
        return !!down && down === out;
      };
      // what leaves each outlet over the whole frame, for drawing: a single substep's can be nothing, as when a
      // wide-open valve drains its tank in the first one
      const total = () => ({ v: new Vessel(Infinity), streamed: false });
      const toolTotals = this.tools.map((t) => t.shape.spouts.map(total));
      const tapTotals = this.faucets.map(total);
      const tally = (tot: { v: Vessel; streamed: boolean }, out: Vessel | null, streamed: boolean) => {
        if (out) tot.v.addFrom(out, volume(out), true);
        tot.streamed ||= streamed;
      };
      for (let i = 0; i < sub; i++) {
        this.stepWake(step);
        if (D && this.pour) {
          const out = new Vessel(Infinity);
          transfer(D, out, POUR_RATE * step);
          this.land(this.pour.into, this.pour.from, out);
        }
        // each faucet runs as far as its valve is open, as a tool's spout does, dripping if that's slow enough
        this.faucets.forEach((fa, i) => {
          if (i === stillFaucet) return;
          const out = fa.valve > 0 && (fa.cock?.valve ?? 1) > 0 ? this.faucetLets(fa, step) : null;
          if (!out && fa.drop.N <= 0) return;
          if (quiet) {
            pour(fa.drop, out, taps[i], tapTargets[i]);
            return;
          }
          tally(tapTotals[i], out, false);
          tally(tapTotals[i], null, pour(fa.drop, out, taps[i], tapTargets[i]));
        });
        this.tools.forEach((t, j) => {
          if (t === stillTool) return;
          t.step(step).forEach((out, k) => {
            if (quiet) {
              pour(t.drops[k], out, spouts[j][k], targets[j][k]);
              return;
            }
            tally(toolTotals[j][k], out, false); // before pouring, which can gather it into a drop
            tally(toolTotals[j][k], null, pour(t.drops[k], out, spouts[j][k], targets[j][k]));
          });
        });
        // falling drops land in the first open top they pass, or go down the sink; what's left of one that struck a
        // sheet of blotting paper, which took up what it had room for, falls on
        this.falling = this.falling.filter((d) => {
          const from = d.y;
          d.vy += GRAVITY * step;
          d.y -= d.vy * step;
          const m = mouthBelow(mouths, { x: d.x, y: from, z: d.z });
          let lands = !!m && m.y >= d.y;
          if (lands) {
            this.landed.push({ x: d.x, y: m!.y, z: d.z });
            if (m!.v instanceof Blotter) {
              m!.v.soak(d.v);
              lands = d.v.N <= 0;
            } else this.fill(m!.v, d.v);
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
      if (!quiet)
        this.faucets.forEach((fa, i) => {
          const { v, streamed } = tapTotals[i];
          fa.out = v.N > 0 ? v : null;
          fa.flow = volume(v) / (MAX_FLOW * simDt);
          fa.streaming = streamed;
        });
    }
    this.spillTime = simDt;
    if (quiet) {
      // nothing's drawn, and what a tool's step handed out is its own, good only until its next step (see Tool.step)
      for (const t of this.tools) {
        t.out.fill(null);
        t.flow.fill(0);
        t.streaming.fill(false);
      }
      for (const fa of this.faucets) Object.assign(fa, { out: null, flow: 0, streaming: false });
      return;
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
    if (this.turning && 't' in this.turning && this.turning.t === st) this.endTurn();
    if (this.turning && 'cock' in this.turning && 'tool' in this.turning.cock && this.turning.cock.tool === st) this.endTurn();
    const held = this.held?.kind === 'hose' && its(this.held.h);
    this.hoses = this.hoses.filter((h) => !its(h));
    // (a stopcock on the end of one of them goes up to its spout's tip)
    this.tidyCocks();
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
      // (a sheet of blotting paper's face is landed on as a tank's open top is)
      for (const v of isBlotter(h.t.kind) ? h.t.paper : h.t.tanks) mine.add(v);
      // a spout with its hose out lets out at the hose's nozzle, which stays where it is (see below)
      h.t.shape.spouts.forEach((_, j) => {
        if (!this.hoseOn({ tool: h.t, spout: j })) outlets.push({ at: spoutAt(h.t, j), lip: false });
      });
    } else if (h.kind === 'scale') {
      for (const { f } of h.sc.load) mine.add(f);
      // (and where a flask would go on it, for a guide to show it lined up under a spout before a flask's there)
      mine.add(SCALE_PLACE);
    }
    // (one docked on an instrument's tube lets out at its tip: a stopcock on its end goes to the spout's tip, see setDown)
    else if (h.kind === 'hose') outlets.push({ at: this.isDocked(h.h.outlet) ? h.h.outlet : this.nozzleOut(h.h), lip: false });
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
          if (hose || !(h.kind === 'tool' && h.t === t)) aim(this.outletAt(t, j), 'mouth');
        });
      this.faucets.forEach((_, i) => aim(this.faucetOutlet(i), 'mouth'));
    }
    return out;
  }

  /**
   * Which way what's held faces, about the vertical, as it's turned from the player: the nearest of the four ways
   * along the room (see toCardinal), so R turns it a quarter turn; but while Alt is held (see free), just as it's held.
   */
  private facing(h: Held): number {
    const yaw = this.player.yaw + h.relYaw;
    return this.free() ? wrapAngle(yaw) : toCardinal(yaw);
  }

  /**
   * Whether Alt is held: then what's held is set down exactly where and as it's held, turned as it's held (see
   * facing) and with no magnet (see magnet). Not on a touch screen, which has no Alt.
   */
  private free(): boolean {
    return !TOUCH && (this.keys.has('AltLeft') || this.keys.has('AltRight'));
  }

  /**
   * Where what's held would be set down, at pose p: just there, but a hose's nozzle over an inline instrument's tube on
   * its top (see docked), and a flask facing the nearest of the four ways (it's round: see faceFlask).
   */
  private snapped(h: Held, p: Pose): Pose {
    if (h.kind === 'hose') {
      const d = docked(p, this.tools);
      // a nozzle with a stopcock on its end has no room for it there: it docks only if the stopcock can go on the
      // spout's tip instead, where it does the same
      if (d === p || !this.cockOn(h.h.on)?.nozzle) return d;
      const tip = { m: h.h.on, nozzle: false };
      return this.cockRoom(tip, this.cockFrame(tip)) ? d : p;
    }
    if (h.kind === 'flask') return { ...p, yaw: toCardinal(p.yaw) };
    return p;
  }

  /**
   * What, of what's held at pose p and of everything else, a magnet lines up (see magnetShift): its outlets (a tool's
   * spouts with no hose out, a hose's nozzle; not a flask's lip) and the open tops it would take fluid into (a flask's,
   * a tool's tanks', a sheet of blotting paper's face, the flasks' on a scale, or where a flask would go on a scale's
   * empty places, at a flask's mouth's height); and every other outlet (spouts, nozzles, faucets) and open top. A
   * hose following what's held goes with it, so it's neither.
   */
  private magnets(h: Held, p: Pose): { mine: Magnets; others: Magnets } {
    const at = this.objPose(h);
    const tilt = h.kind === 'flask' ? h.f.tilt : 0;
    if (h.kind === 'flask') h.f.tilt = 0;
    this.putAt(h, p);
    const vs = new Set<Vessel>();
    const mouths: Mouth[] = [];
    const outlets: Vec3[] = [];
    if (h.kind === 'flask') vs.add(h.f);
    else if (h.kind === 'tool') {
      for (const v of isBlotter(h.t.kind) ? h.t.paper : h.t.tanks) vs.add(v);
      h.t.shape.spouts.forEach((_, j) => {
        if (!this.hoseOn({ tool: h.t, spout: j })) outlets.push(spoutAt(h.t, j));
      });
    } else if (h.kind === 'scale') {
      for (const { f } of h.sc.load) vs.add(f);
      mouths.push(...this.emptyPlaces(h.sc));
    } else if (h.kind === 'hose') outlets.push({ ...this.nozzleOut(h.h) });
    const all = this.mouthsWith(h);
    mouths.push(...all.filter((m) => vs.has(m.v)));
    const theirs: Vec3[] = [];
    const following = new Set(h.follow?.map((f) => f.hose));
    const foreign = (m: HoseMount) => {
      const hose = this.hoseOn(m);
      if (hose) return !following.has(hose) && !(h.kind === 'hose' && h.h === hose) && !('tool' in m && h.kind === 'tool' && m.tool === h.t);
      return !('tool' in m && h.kind === 'tool' && m.tool === h.t);
    };
    this.faucets.forEach((_, i) => foreign({ faucet: i }) && theirs.push(this.faucetOutlet(i)));
    for (const t of this.tools)
      if (!t.away) t.shape.spouts.forEach((_, j) => foreign({ tool: t, spout: j }) && theirs.push(this.outletAt(t, j)));
    const out = { mine: { outlets, mouths }, others: { outlets: theirs, mouths: all.filter((m) => !vs.has(m.v)) } };
    this.putAt(h, at);
    if (h.kind === 'flask') h.f.tilt = tilt;
    return out;
  }

  /**
   * A scale's places for a flask with no flask on them, as open tops at a flask's mouth's height, standing in for
   * the flask that's not there yet (see SCALE_PLACE), for the magnet and the guides.
   */
  private emptyPlaces(sc: Scale): Mouth[] {
    return SCALE_SLOTS.filter((dx) => !sc.load.some((l) => l.dx === dx)).map((dx) => {
      const o = onScale(sc, dx);
      return { v: SCALE_PLACE, x: o.x, y: o.y, z: o.z, hx: FLASK_CATCH, hz: FLASK_CATCH, yaw: o.yaw };
    });
  }

  /**
   * Where what's held at pose p would be pulled to by a magnet: shifted across, no further than MAGNET, to line up the
   * most of its outlets over others' open tops and others' outlets over its open tops that it can at once (see
   * magnets and magnetShift). Null if there's nothing to line up so near.
   */
  private magnet(h: Held, p: Pose): Pose | null {
    const { mine, others } = this.magnets(h, p);
    if (!mine.outlets.length && !mine.mouths.length) return null;
    const s = magnetShift(mine, others);
    return s && { ...p, x: p.x + s.x, z: p.z + s.z };
  }

  /**
   * Where what's held would come to rest if let go now (see rest): lined up by a magnet (see magnet) if it can rest
   * there, or else where it's held (see snapped); or else the nearest spot, no more than NEAR across from there, where
   * it can, clear of the player too. With Alt held (see free), no magnet. If it can't rest anywhere near, why not
   * where it's held.
   */
  private placement(h: Held): { rest: Rest } | { why: string } {
    // a stopcock goes on an outlet near it, or nowhere
    if (h.kind === 'cock') {
      const a = this.cockAim();
      if (!a) return { why: 'Put it on a spout' };
      return a.why ? { why: a.why } : { rest: { pose: a.pose, cock: a.spot } };
    }
    // a strip or a thermometer aimed at an open top is set down standing in it
    const aim = h.kind === 'tool' && isDipper(h.t.kind) ? this.dipAim(h) : null;
    if (aim) return aim.rest;
    const p = this.heldPose(h);
    const me = this.me();
    const obstacles = [...this.obstacles(h), me];
    const solid = [...this.obstacles(h, false), me];
    const pulled = this.free() ? null : this.magnet(h, { ...p, y: this.restY(h, p, obstacles, solid) });
    let why: string | null = null;
    const at = (q: Pose): { rest: Rest } | null => {
      const r = this.rest(h, this.snapped(h, q), obstacles, solid);
      const follow = typeof r === 'string' || !h.follow?.length ? null : this.followRests(h, r);
      const out = typeof r === 'string' ? r : typeof follow === 'string' ? follow : { rest: follow ? { ...r, follow } : r };
      if (typeof out !== 'string') return out;
      if (q === p) why = out;
      return null;
    };
    const first = (pulled && at({ ...pulled, y: p.y })) || at(p);
    if (first) return first;
    // (a hose's nozzle that fits where it's held, but not its stand, has had its stand tried every way round it
    // already, see nozzleMounts: looking round for the nozzle wouldn't help, and would cost dear)
    if (h.kind === 'hose' && why !== 'No room') return { why: why! };
    // the nearest spot round where it's held, ring by ring
    for (let r = NEAR_STEP; r <= NEAR + 1e-9; r += NEAR_STEP) {
      const n = Math.ceil((2 * Math.PI * r) / NEAR_STEP);
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n;
        const got = at({ ...p, x: p.x + r * Math.cos(a), z: p.z + r * Math.sin(a) });
        if (got) return got;
      }
    }
    return { why: why! };
  }

  /**
   * How high what's held at pose p would come to rest, for a magnet to go by (see magnet): where it would (see rest),
   * or if it can't there, as if it went down onto a counter (a flask, a scale, a sheet of blotting paper) or stayed
   * as high as it's held (what's on a stand).
   */
  private restY(h: Held, p: Pose, obstacles: readonly Box[], solid: readonly Box[]): number {
    const r = this.rest(h, this.snapped(h, p), obstacles, solid);
    if (typeof r !== 'string') return r.pose.y;
    if (h.kind === 'hose' || (h.kind === 'tool' && !h.t.shape.flat)) return p.y;
    const b = this.boxAt(h, p);
    return p.y - (b.y - b.hy - (counterUnder(b) ?? LIFT));
  }

  /**
   * Where what's held, at pose p, would come to rest if let go, or why it can't. Only squarely on a counter: a flask,
   * a scale or a tool that lies on the bench (a sheet of test paper or bond paper) goes straight up or down until it's on the counter under it, which
   * its whole footprint must be over (or a flask over a scale, onto its platform); a tool or hose's nozzle on a stand
   * stays at the height it's held, no higher than its stand reaches and no lower than the top of a counter it's held
   * sunk into (or the floor of the shadow lamp's channel, if that's what its stand is on), while its stand's base goes
   * down onto the counter, which the whole base must be over (what it holds can reach out past the counter's edge). Either way, it mustn't overlap anything where it comes to rest (what's held passes through everything, so there's no way down to look
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
      // (what its stand is on, if that's higher than the counters, is under it too: the floor of the lamp's channel)
      const ground = Math.max(LIFT, ...tops.map((t) => t!));
      const sunk = ground - (box.y + dy - box.hy);
      const solidBox = h.kind === 'tool' && isDipper(h.t.kind) ? { ...box, parts: undefined } : box;
      if (sunk > 0 && (ground > LIFT || COUNTER_BOXES.some((c) => boxesOverlap({ ...solidBox, y: box.y + dy }, c)))) dy += sunk;
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
   * Where a held nozzle's stand is wanted: turned with the player like anything held (see facing: in quarter turns, so the
   * nozzle faces the way along the room nearest how it's turned from them, or with Alt held, just as it's turned; with
   * the stand behind it), as far behind as its
   * clamp's arm is slid.
   */
  private nozzleWant(h: Held & { kind: 'hose' }): NozzleMount {
    return { turn: this.facing(h), reach: snapReach(h.reach) };
  }

  /** Every stand in the lab; but none for a dipper (see DIPPERS) while it's in hand. */
  private stands(): Stand[] {
    const out: Stand[] = [];
    const held = this.held;
    for (const t of this.tools) {
      // a strip or a thermometer in hand is just itself: its stand is there once it's set down
      if (held?.kind === 'tool' && held.t === t && isDipper(t.kind)) continue;
      out.push(...toolStands(t));
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
      if (s) out.push(s);
    }
    return out;
  }

  /**
   * Guides for lining up what's held (see aims), shown only while something's held, since that's when things are
   * being lined up: gray from a held flask's lip to where it would pour; and green, as it will be once let go and set
   * down where placement says (lined up by a magnet, if one's caught it), wherever fluid would land in a mouth then. Each ends at the vessel that would take the fluid,
   * which flashes green.
   */
  private guides(pl: ReturnType<GameEngine['placement']> | null): Frame['guides'] {
    const h = this.held;
    // (nor while she sniffs: nothing's set down or poured until she's back)
    if (!h || this.sniffing) return [];
    const guide = (a: Aim, look: GuideLook): Frame['guides'][number] => {
      const { x, y, z, hx, hz, yaw = 0 } = a.m;
      // (a sheet of blotting paper's face is square, not round)
      return { from: a.from, toY: y, look, mouth: { x, y, z, hx, hz, yaw, ...(a.m.v instanceof Blotter ? { square: true } : {}) }, v: a.m.v };
    };
    const out = this.aims(h, this.open).filter((a) => a.held === 'lip').map((a) => guide(a, 'solid'));
    if (pl && 'rest' in pl) {
      // what it'll line up with once let go: put it there, upright, for a moment, to see
      const at = this.objPose(h);
      const tilt = h.kind === 'flask' ? h.f.tilt : 0;
      if (h.kind === 'flask') h.f.tilt = 0;
      this.putAt(h, pl.rest.pose);
      // (a scale's empty places too, as if flasks stood there)
      const places = h.kind === 'scale' ? this.emptyPlaces(h.sc) : [];
      for (const a of this.aims(h, [...this.mouthsWith(h), ...places])) if (a.held !== 'lip') out.push(guide(a, 'snap'));
      this.putAt(h, at);
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
    // (a stopcock is outlined where it would go on instead: see looseFrame)
    if (!h || !pl || this.sniffing || h.kind === 'cock') return [];
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
    const square = h.kind === 'tool' && !!h.t.shape.flat;
    return [{ x: b.x, y, z: b.z, hx: b.hx, hz: b.hz, yaw: b.yaw, ok, ...(square ? { square } : {}) }, ...follow];
  }

  /**
   * The ghost of what's being moved by one (see Held.ghost), for the view: where it would come to rest, with its
   * stands there, or where it's held, red, if it can't be set down.
   */
  private ghostFrame(pl: ReturnType<GameEngine['placement']> | null): Frame['ghost'] {
    const h = this.held;
    if (!h?.ghost || !pl || this.sniffing || (h.kind !== 'tool' && h.kind !== 'scale')) return null;
    const ok = 'rest' in pl;
    const pose = ok ? pl.rest.pose : this.heldPose(h);
    const stands = this.standsAt(h, pose, ok ? pl.rest : undefined).map((s) => ({
      s, y: (ok ? counterUnder(standBase(s, 0)) : null) ?? groundAt(s.x, s.z),
    }));
    return { ...(h.kind === 'tool' ? { tool: h.t } : { scale: h.sc }), pose, ok, stands };
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
    this.faucets.forEach((fa, i) => {
      if (!fa.out || !fa.streaming) return;
      const from = this.faucetOutlet(i);
      streams.push({ from, toY: this.landsAt(from, mouths), fluid: fa.out, flow: fa.flow });
    });
    const h = this.held;
    if (this.pour && h?.kind === 'flask' && h.f.N > TRACE)
      streams.push({ from: this.pour.from, toY: this.landsAt(this.pour.from, mouths), fluid: h.f, flow: POUR_RATE / CAP });
    const drops: Frame['drops'][number][] = [];
    for (const t of this.tools) t.drops.forEach((v, k) => drops.push({ at: this.outletAt(t, k), v, hanging: true }));
    this.faucets.forEach((fa, i) => drops.push({ at: this.faucetOutlet(i), v: fa.drop, hanging: true }));
    for (const d of this.falling) drops.push({ at: d, v: d.v, hanging: false });
    const pl = (this.placed = h ? this.placement(h) : null);
    // each hose from its spout or faucet to its nozzle, with what's running through it
    const hoses = this.hoses.map((hose) => {
      const on = hose.on;
      const fluid = 'tool' in on ? on.tool.out[on.spout] : this.faucets[on.faucet].out;
      const c = this.cockOn(on);
      return { h: hose, from: this.mountAt(on), fluid, cock: c?.nozzle ? c : null };
    });
    this.view.render({
      ...this.gaze(),
      flasks: this.flasks, tools: this.tools, scales: this.scales, hoses, faucets: this.faucets, stock: this.stock,
      streams, drops,
      tarePress: this.tarePress, hot: this.hot(), dt, clock: this.clock,
      energies: BOND_KEYS.map((k) => this.chem.params.bonds[k].E), alarmsOff: this.alarmsOff, blindsShut: this.blindsShut, spin: this.spin,
      airlock: this.airlockLook(),
      guides: this.guides(pl), footprints: this.footprints(pl), stands: this.stands(), ghost: this.ghostFrame(pl),
      loose: this.looseFrame(),
    });
  }

  /**
   * The stopcock in hand, for the view (see Frame.loose): where it would go on, if there's somewhere (see cockAim), or
   * else in hand.
   */
  private looseFrame(): Frame['loose'] {
    const h = this.held;
    if (h?.kind !== 'cock') return null;
    const a = this.sniffing ? null : this.cockAim();
    return a ? { cock: h.c, pose: a.pose, ok: !a.why } : { cock: h.c, pose: h.pose, ok: null };
  }

  /**
   * What's outlined: what the crosshair is on, but the whole equipment cabinet while what's held would go into it,
   * and nothing for the cabinet itself otherwise.
   */
  private hot(): Pick | null {
    // (nothing while she sniffs: her nose is in it)
    if (this.sniffing) return null;
    const p = this.target;
    if (this.held) return this.intoCabinet() ? { kind: 'cabinet' } : p?.kind === 'cabinet' || p?.kind === 'stock' ? null : p;
    return p?.kind === 'cabinet' ? null : p;
  }

  /** The vessel the info panel would show, in god mode: what's held, if it's a flask, or else the flask or tank looked at. */
  private inspectTarget(): Vessel | null {
    const h = this.held;
    if (h?.kind === 'flask') return h.f;
    const p = this.target;
    if (p?.kind === 'flask') return p.f;
    if (p?.kind === 'tool' && p.part === 'tank') return p.t.tanks[p.k];
    return null;
  }

  private inspect(now: number): void {
    // only in god mode: otherwise what's in a vessel is for the player to work out
    const f = this.locked && this.god ? this.inspectTarget() : null;
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
      add(['Mouse'], 'sweep round to turn it');
      add(['RMB'], 'let go when it’s set');
      return out;
    }
    // and so does an equipment wheel, until its key's let go
    if (this.wheel) {
      add(['Mouse'], 'point at what to take');
      add([WHEEL_KEYS[this.wheel.which]], 'let go to take it');
      return out;
    }
    // and so does a sniff, until she's back where she stood
    if (this.sniffing) {
      if (!this.sniffing.leaving) add(['F'], 'stop sniffing');
      add(['Esc'], 'let go of the mouse');
      add(['/'], 'hide this list');
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
        : h.kind === 'cock' ? 'put the stopcock on'
        : h.kind === 'tool' && isDipper(h.t.kind) && this.mouthAimed() ? 'stand it in it'
        // (what's moved by a ghost hasn't left where it was)
        : h.ghost && h.from ? 'move it here'
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
          : this.mouthAimed(true) ? 'hold to pour onto it'
          : 'hold to pour',
        );
      if (h.kind === 'hose') {
        add(['R'], 'swing its stand round');
        add(['Shift', '↑↓'], 'slide its stand out or in');
      } else if (h.kind !== 'flask' && h.kind !== 'cock') add(['R'], 'turn it');
      add(['Wheel'], 'hold it nearer or further');
      if (!TOUCH && h.kind !== 'cock') add(['Alt'], 'hold to set it down just as it’s held');
      if (h.kind === 'hose') add(['Backspace'], 'roll the hose back up');
      else if (!(h.kind === 'tool' && UNIQUE_TOOLS.includes(h.t.kind))) add(['Backspace'], 'put it back in the cabinet');
      add(['Q'], !h.from ? (h.kind === 'hose' ? 'roll the hose back up' : 'put it back in the cabinet') : h.ghost ? 'leave it where it is' : 'put it back');
    } else {
      if (this.rightWouldDo()) add(['RMB'], `hold and sweep round it to turn the ${this.valveAimed() && 'cock' in this.valveAimed()! ? 'stopcock' : 'valve'}`);
      add([WHEEL_KEYS.join(', ')], 'hold to grab equipment');
    }
    if (p?.kind === 'alarm') add(['LMB'], this.alarmsOff ? 'let the alarms sound again' : 'silence the alarms');
    else if (p?.kind === 'blinds') add(['LMB'], this.blindsShut ? 'open the blinds' : 'shut the blinds');
    else if (p?.kind === 'tool' && p.part === 'button') add(['LMB'], p.t.lit ? 'put the lamp out' : 'light the lamp');
    else if (this.pressable()) add(['LMB'], 'press it');
    const m = h ? null : this.mountAimed();
    if (!h && this.cockAimed()) add(['LMB'], 'take the stopcock off');
    else if (m) add(['LMB'], this.hoseOn(m) ? 'take hold of its hose' : 'pull out its hose');
    else if (!h && p?.kind === 'hose') add(['LMB'], 'take hold of it');
    else if (!h && p && this.grabbable(p) && !this.onButton()) {
      add(['LMB'], 'pick it up');
      if (this.hooked(p)) add(['Shift', 'LMB'], 'pick it up still hooked up');
    }
    const id = this.targetNote();
    if (id) add(['Enter'], this.god && /^(f\d+|t\d+\.\d+)$/.test(id) ? 'edit it (god mode)' : 'write a note about it');
    const nose = this.sniffAim();
    if (nose === 'sealed') add(['F'], 'sniff it: it’s sealed', true);
    else if (nose) add(['F'], h?.kind === 'flask' && nose === h.f ? 'sniff what’s in hand' : 'sniff it', this.handBusy());
    if (this.canNap()) add(['N'], 'nap');
    if (!h && this.history.canUndo) add([MOD, 'Z'], 'undo');
    if (!h && this.history.canRedo) add([MOD, 'Shift', 'Z'], 'redo');
    add(['Z'], 'hold to zoom in');
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
    return !!this.cockAimed() || !!this.mountAimed() || (!!p && this.grabbable(p));
  }

  /** Whether the crosshair is on a key or button, which takes the left button's click even with something in hand. */
  private onButton(): boolean {
    const p = this.target;
    return (
      (p?.kind === 'scale' && p.part === 'tare') || (p?.kind === 'tool' && p.part === 'button') ||
      p?.kind === 'alarm' || p?.kind === 'blinds' || p?.kind === 'wake'
    );
  }

  /** Whether the left button would press the key or button the crosshair is on. */
  private pressable(): boolean {
    const p = this.target;
    return (
      (p?.kind === 'scale' && p.part === 'tare') ||
      (p?.kind === 'tool' && p.part === 'button') ||
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
        // (and the shadow lamp's screen has that much more catching up to do; and a sheet of blotting paper that was
        // still developing goes on developing)
        for (const t of this.tools) {
          if (t.kind === 'shadowlamp') t.shine(dt);
          if (isBlotter(t.kind)) t.step(dt);
        }
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
    // nothing else held in hand (a sheet of blotting paper, a stopcock) has a use for it, and what's moved by a ghost
    // runs anyway
    if (h?.kind === 'tool' || h?.kind === 'scale' || h?.kind === 'cock') return false;
    // a faucet runs if its valve's open
    if (h?.kind === 'hose') return 'tool' in h.h.on ? this.wouldFlow(h.h.on.tool) : this.faucets[h.h.on.faucet].valve > 0 && (this.cockOn(h.h.on)?.valve ?? 1) > 0;
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
    if (t.kind === 'column') return t.soaked >= 1 && t.open(0) > 0 && t.tanks[0].N > TRACE;
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
    if (this.smelled && now > this.smelled.until) this.smelled = null;
    const p = this.target;
    const h = this.held;
    const hud: Hud = {
      locked: this.locked,
      grab: !this.held && !!p && this.grabbable(p),
      inPod: inPod(this.wake),
      holding: !!this.held,
      drop: !!this.placed && 'rest' in this.placed,
      press: !this.sniffing && this.leftWouldDo(),
      right: !this.sniffing && this.rightWouldDo(),
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
      smell: this.smelled && {
        n: this.smelled.n,
        lines: this.smelled.script.reduce<string[][]>((ls, f) => (f.line || !ls.length ? [...ls, [f.text]] : [...ls.slice(0, -1), [...ls[ls.length - 1], f.text]]), []),
        shown: this.said(now),
        out: now > this.smelled.until - SMELL_FADE_MS,
      },
      sniffing: !!this.sniffing,
    };
    const key = JSON.stringify(hud);
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.cb.onHud(hud);
  }
}

/**
 * Whether tank k of a tool lets fluid out on its own: as long as a spout it feeds isn't shut (see Tool.open); the
 * station's funnel always, through its diverter, and its reservoir while its faucet's open; a multiplexer's funnel
 * unless its selector takes only from the other.
 */
function drains(t: Tool, k: number): boolean {
  if (t.kind === 'receptacle') return k === 0 || (t.valves[0] > 0 && t.open(1) > 0);
  if (t.kind === 'multiplexer') return t.open(0) > 0 && (k ? t.valves[0] > 0 : t.valves[0] < 1);
  // a dry column's bed drinks from its funnel, open or not
  if (t.kind === 'column') return t.soaked < 1 || t.open(0) > 0;
  // (a heater's tube runs on whatever its spouts say)
  if (t.kind === 'heater') return true;
  // a tank lets out of its own spout, or one tank out of all of them, as far as any is open
  const S = t.shape.spouts.length;
  return t.tanks.length === S ? t.open(k) > 0 : t.shape.spouts.some((_, j) => t.open(j) > 0);
}

export type { ToolKind };
