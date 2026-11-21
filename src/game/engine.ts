import { equilibrate } from '../chem/equilibrium';
import { Lag, temperature, type Fluid, type NetReaction, type ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { AIRLOCK, BLINDED_S, EMERGE_S, POD, RISE_S, SETTLE_S, WAKE_S, ease, inPod, outOfAirlock, type Wake } from './airlock';
import { hushAlarms } from './ambience';
import type { ViewMode } from './mode';
import {
  FLASK_CENTER, NOZZLE_H, SCALE_SLOTS, aimValve, dippedIn, docked, faucetBox, faucetPipes, flaskArm, flaskBox, flaskLip, flaskMouth, footAt, insideVessel, isDocked,
  nozzleArm, nozzleBox, onScale, onTool, scaleArm, scaleBox, scaleCenter, scaleSpot, spoutAt, spoutNear, tankMouth, tankNoteY, toolArms, toolBox, toolCenter, valveNear, valveZ,
} from './bodies';
import { CABINET, endless, isStocked, putIn, stockWith, takeFrom, takeSlot, type Stock, type Stocked } from './cabinet';
import { changeover, type ChangeoverSound } from './changeover';
import { chime } from './chime';
import { diverter, type Diverter } from './diverter';
import { CAP, DELIVERY, FILL_RATE, HOME_H, HOME_W, POUR_RATE, TRACE } from './config';
import { cool, exposure, taper } from './cooling';
import { FAUCETS, faucetIndex, faucetOutput, faucetTarget } from './faucets';
import { flatten } from './flatten';
import { FLASK_H, FLASK_OUTLINE, areaBelow, fillLevel } from './flaskShape';
import { Flask, Vessel, roomFor, sustenance, transfer, volume, volumeUnit } from './flask';
import { History, arrange, arrangement, type Arrangement } from './history';
import { boxesOverlap, type Box } from './physics';
import { CENTER, placement, type Placement } from './place';
import { PORT_WALL } from './porthole';
import { ANALYZER_AT, DEFAULT_PRESET, PRESET_FLASKS_X, REFERENCE_FILL, SPECTROSCOPE_AT, STATION_POSE, VISUALIZER_AT, applyFill, type Preset, type Spot } from './presets';
import { rumble, type Rumble } from './rumble';
import { CRYOSTABILIZER, FIRST_SUPPLY, litresOf, type Supply } from './supply';
import { shatter } from './shatter';
import { WHEEL, WHEELS, wheelMove, wheelPick, type WheelAim } from './wheel';
import { loadChem, loadVessel, saveChem, saveVessel, type SaveState } from './save';
import { SCALE_SHAPE, Scale, glassGrams } from './scale';
import { axes, onPlaneZ, sightAt } from './sight';
import { sleep, type Sleeper, type SleepStats, type Woke } from './sleep';
import { BENCH, CELL, LIFT, PLANE_Z, ROOM, SPIN, dist3, fromFrac, groundAt, toFrac, toLocal, toWorld, wrapAngle, type Pose, type Vec3 } from './space';
import {
  changeoverAt, ANALYZER_HUM, BOND_KEYS, INSTRUMENT, HEATER, HEATER_CELLS, HEATER_TUBE, DIVERTER_HOLD, Hose, INLINE_TOOLS, MAX_FLOW, SHAPES, STATION, STRIP_FOOT, SUMP_TIP,
  TANK_H, TOOL_NAMES, dipUnder, isDipper, isThermometer, Tool, UNIQUE_TOOLS, cupFillHeight, type HoseMount, drip, mouthBelow, sameMount, sumpFillHeight, levelIn, spaceOf, tankPieces, tankX,
  type Mouth, type ToolKind,
} from './tools';
import { typingIn } from './typing';
import { ARRIVAL, View, type AirlockLook, type Camera, type FaucetSpot, type Frame, type GuideLook, type Icons, type LabView, type Pick } from './view';
import { FlatView } from './view2d';
import { catches, stillness, type Stillness } from './still';
import { canStand, walk, type Stand } from './walk';
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

/** What the heads-up display shows, over the view. */
export interface Hud {
  /** Whether the player is still shut in the cryopod, waking (see Wake), where the message inside it says what to do. */
  inPod: boolean;
  /** Whether something is being held. */
  holding: boolean;
  /** Whether what's held could be left where it is (see placement). */
  drop: boolean;
  /**
   * Whether the right button would do something: pour from the flask held, let fluid out of the hose held, or turn
   * the valve pointed at.
   */
  right: boolean;
  /** Whether Enter would write a note about what the pointer is on (see GameEngine.note). */
  label: boolean;
  /** What the right button does now, in a word, for the touch screen's button that stands in for it. */
  hand: 'Pour' | 'Flow';
  /** A brief note, like there being no room for something. */
  note: string | null;
  /** Whether the note is a tip, something the player can now do, not something they can't. */
  tip: boolean;
  /** Everything the player can do just now besides moving the view, with how (see Action), for a reminder. */
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
   * While an equipment wheel is held open (see wheel.ts): where its middle is on the view, in CSS pixels, what's on
   * it, in order, where its pointer is from its middle, which of them it picks, if any, and which of them there are
   * none left of in the cabinet. Otherwise null.
   */
  wheel: (WheelAim & { cx: number; cy: number; items: readonly Stocked[]; pick: number | null; none: boolean[] }) | null;
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
  /** Whether the view is turned round to the wall behind the bench (see GameEngine.turnRound). */
  away: boolean;
  /** Whether the airlock stands open, and the player could get into the cryopod (see GameEngine.board). */
  pod: boolean;
  /**
   * Whether to draw the crosshair in the middle of the view: in the walk mode, while the mouse is captured, out of the
   * pod, with no equipment wheel open (whose own pointer stands in for it).
   */
  cross: boolean;
  /**
   * Whether a click on the view would capture the mouse, to look around: in the walk mode, while it's free, out of
   * the pod and the preview of the end.
   */
  capture: boolean;
}

/**
 * Something the player can do just now: the keys or buttons that do it, pressed together, and what it does, in a few
 * words. Keys are named as on the keyboard; 'LMB' and 'RMB' are the mouse's left and right buttons, 'Wheel' its
 * wheel, and 'Drag' moving it with the left button down. `off` if it can't be done here, though it could elsewhere.
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

/** Where something let go of stays (see GameEngine.placement): its pose, and for a flask, the scale it stands on. */
interface Rest {
  pose: Pose;
  scale?: { sc: Scale; dx: number };
  /** Where each hose following what's held would be left with it, its nozzle's tip, in Held.follow's order (see followRests). */
  follow?: Vec3[];
}

/**
 * Where what's held is, and whether it could be left there: the pose it's shown at, and where it would stay if let go
 * (see Rest), or null, with why, if it can't be left there.
 */
interface Placed {
  pose: Pose;
  rest: Rest | null;
  why: string | null;
}

/**
 * A hose whose nozzle pours into something being carried, and so goes along with it (see gather): the vessel it pours
 * into, where its tip is from what's carried; and where it was before, to put it back, or null if it was pulled out
 * for this.
 */
interface Follower {
  hose: Hose;
  into: Vessel;
  off: { x: number; y: number };
  was: Vec3 | null;
}

/** What the player is holding. A hose is held by its nozzle. */
type Held = (
  | { kind: 'flask'; f: Flask }
  | { kind: 'tool'; t: Tool }
  | { kind: 'scale'; sc: Scale }
  | { kind: 'hose'; h: Hose }
) & {
  /**
   * Where it is from the point of the bench the pointer is on, across and up: it's carried by where it was taken hold
   * of, so it doesn't jump as it's picked up.
   */
  grip: { x: number; y: number };
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
 * A hose following what's carried (see followRests) is left over the same spot of it, as high over it as it was if
 * there's room, or else from NOZZLE_GAP above the mouth it pours into up to POUR_RISE above it.
 */
const NOZZLE_GAP = 15;
const POUR_RISE = 300;
/**
 * How long a wicking strip has to be held dipped in a fluid, in real seconds from its foot touching it, before it
 * drinks it: a shorter touch only takes a spot (see Tool.touch).
 */
const DIP_SOAK = 0.35;
/** How fast a falling drop speeds up, in world units per sim second squared: a 500-unit fall takes 0.7 s. */
const GRAVITY = 2000;
/** How high the player's eyes are, standing in the cryopod. */
const EYE = 620;
/** The view's field of view, top to bottom, in degrees: at the bench, and in the cryopod, whose message is close up. */
const FOV = 45;
const POD_FOV = 90;
/** The view from in the pod: out at the lab, eyes a little down. */
const POD_VIEW: Camera = { x: POD.x, y: EYE, z: POD.z, yaw: 0, pitch: -0.12, fov: POD_FOV };
/** In the walk mode (see ViewMode), the field of view, top to bottom, in degrees: wide, as it was when the lab was walked round. */
const WALK_FOV = 90;
/** How fast the player walks, in world units per real second (it's their own movement). */
const WALK = 840;
/** Radians the view turns per pixel the captured mouse moves, in the walk mode. */
const LOOK_SENS = 0.0022;
/** How far up or down the player can look, in radians from level. */
const PITCH_MAX = 1.45;
/**
 * Where the player stands in the walk mode as they come out of the airlock (see emerge), and in a lab saved without
 * them: just outside its doorway, a few hundred units into the room, facing the bench, level.
 */
const WALK_START: Player = { x: AIRLOCK.x, z: ROOM.z1 - 400, yaw: 0, pitch: 0 };
/**
 * How far back along its line of sight, from the middle of the stretch of wall it sees, a view with no perspective
 * is from: it makes no odds to what it sees, so long as everything on the wall is in front of it.
 */
const ORTHO_BACK = 2000;
/**
 * Where the view starts at the bench: straight out of the airlock, square on to the faucets, the supply station and
 * the instruments, far enough back to take them all in.
 */
const START_VIEW = { x: AIRLOCK.x, y: 700, z: 1560 };
/**
 * How near the view can come to the bench's plane, and to the wall behind; and how near the ends of the room, the
 * floor and the ceiling its middle can go.
 */
const VIEW_NEAR = 170;
const VIEW_BOUNDS = { x: 250, y0: 200, y1: 150 };
/**
 * How fast the keys move the view across the wall: this many times its distance from the wall, in world units per
 * real second, so it crosses what's in view in about the same time however far back it is.
 */
const PAN_RATE = 1.1;
/** How much the view's distance from the wall changes per pixel the mouse's wheel is turned: by e to this. */
const ZOOM_RATE = 0.0012;
/** Real seconds the view takes to turn round to the wall behind the bench, or back. */
const TURN_S = 0.9;
/**
 * Where the view goes when it's turned round to the wall behind: back by the bench, far enough from that wall to take
 * in the airlock, the alarms' button and the porthole at once.
 */
const BEHIND_VIEW = { x: (AIRLOCK.x + PORT_WALL.x) / 2 + 150, y: 650, z: 560 };
/** How far, in CSS pixels, the pointer has to move with the left button down before it's a drag and not a click. */
const DRAG_PX = 5;
/** With something in hand, the pointer this near the view's edge, in CSS pixels, moves the view that way. */
const EDGE_PX = 40;
/**
 * A flask or a scale let go of no more than this far above the counter settles down onto it, and a flask this far
 * above a scale's platform onto that.
 */
const SETTLE = 30;
/**
 * What's held is drawn to line up with what it would pour into, or what would pour into it: a spout no more than this
 * far, across, from being over the middle of a mouth goes over its middle.
 */
const MAGNET = 7;
/**
 * Real milliseconds the sleeping lab runs for at a time (see pump), between which the page gets on with anything
 * else, so it stays responsive.
 */
const SLEEP_SLICE_MS = 12;
/** The equipment cabinet, solid all through: nothing's left in front of it but by putting it away. */
const CABINET_BOX: Box = {
  x: (CABINET.x0 + CABINET.x1) / 2, y: CABINET.y1 / 2, z: (CABINET.z0 + CABINET.z1) / 2, yaw: 0,
  hx: (CABINET.x1 - CABINET.x0) / 2, hy: CABINET.y1 / 2, hz: (CABINET.z1 - CABINET.z0) / 2,
};
/** The key held for undo and redo: Command on a Mac, Control elsewhere. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
/** Whether the screen is mainly touched, rather than pointed at with a mouse: then on-screen buttons stand in for the keys. */
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
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

/** Where a tool hangs on the wall, from a preset's spot for it. */
const spotPose = (s: Spot): Pose => ({ ...fromFrac({ x: s.at[0], y: s.at[1] }), yaw: 0 });

/**
 * In the walk mode (see ViewMode), where the player stands (see walk.ts), and which way they look: a yaw of 0 is
 * square at the back wall, and pitch is up, in radians. Their eyes are EYE above the floor.
 */
interface Player extends Stand {
  yaw: number;
  pitch: number;
}

/** A pose on the bench's plane (see PLANE_Z), at (x, y). */
const onPlane = (x: number, y: number): Pose => ({ x, y, z: PLANE_Z, yaw: 0 });

/** Between a and b, t of the way. */
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Where a view gliding from one place to another is, `u` of the way there in time (0 to 1): easing out and in. If
 * it's by way of the airlock's `door`, between the pod and the lab, it goes straight in or out along the doorway's
 * middle for the stretch nearest the pod, and only crosses the room over the rest.
 */
function glideAt(from: Camera, to: Camera, u: number, door: boolean): Camera {
  const t = ease(u);
  const turn: { yaw: number; pitch: number; fov: number; ortho?: number } = { yaw: mix(from.yaw, to.yaw, t), pitch: mix(from.pitch, to.pitch, t), fov: mix(from.fov, to.fov, t) };
  // (one with no perspective at either end has none on the way)
  if (from.ortho !== undefined && to.ortho !== undefined) turn.ortho = mix(from.ortho, to.ortho, t);
  if (!door) return { x: mix(from.x, to.x, t), y: mix(from.y, to.y, t), z: mix(from.z, to.z, t), ...turn };
  // s of the way from the pod's end of it to the lab's
  const out = from.z > to.z;
  const [pod, lab] = out ? [from, to] : [to, from];
  const s = out ? t : 1 - t;
  const across = ease((s - 0.25) / 0.75);
  return { x: mix(pod.x, lab.x, across), y: mix(pod.y, lab.y, across), z: mix(pod.z, lab.z, s), ...turn };
}

/** Owns the lab: what's in it, the view of it, input, the simulation loop, and the View that draws it. */
export class GameEngine {
  speed = 1;
  god = true;

  private view: LabView;
  private flasks: Flask[] = [];
  private tools: Tool[] = [];
  private scales: Scale[] = [];
  private hoses: Hose[] = [];
  private faucets: (FaucetSpot & { start: (typeof FAUCETS)[number] })[];
  /** What's in the equipment cabinet (see cabinet.ts): what the equipment wheels make comes out of it, and goes back in. */
  private stock: Stock = stockWith({});
  /**
   * Where the view is on the wall it's on (see facing), as a view square on to that wall with perspective would have
   * it: across, up, and out from the back wall. Whatever the mode (see ViewMode), the camera is worked out from this
   * (see camOf), so that the view keeps to the same bounds, and a save's view means the same, in all of them; but
   * the walk mode, whose camera is the player's eyes (see player).
   */
  private at = { ...START_VIEW };
  /** In the walk mode, where the player stands and looks: out of the pod, the camera is their eyes (see aim). */
  private player: Player = { ...WALK_START };
  /**
   * In the walk mode, whether the mouse is captured (pointer lock): only then does the lab respond to it, or to the
   * keys, the pointer being always the crosshair in the middle of the view (see crosshair), and moving the mouse
   * turning the view (see look). A click on the view captures it, and Esc lets it go, as browsers do.
   */
  private locked = false;
  /** Where the view is from, and which way it looks (see Camera): worked out from `at`, but while it glides or is in the pod. */
  private cam: Camera = { ...START_VIEW, yaw: 0, pitch: 0, fov: FOV };
  /**
   * What the view is on: the bench, where the lab is worked; the wall behind it, turned round (see turnRound); or
   * what's seen from in the cryopod, which can't be moved.
   */
  private facing: 'bench' | 'away' | 'pod' = 'bench';
  /** Where the view was at the bench, last it was there: where it goes back to from the wall behind, or from the pod. */
  private bench = { ...START_VIEW };
  /**
   * The view moving on its own, from one place to another over `s` real seconds, `t` of them gone: turning round,
   * or gliding between the pod and the bench, when it keeps to the middle of the airlock's doorway on its way
   * through it (`door`). Nothing can be done until it's there.
   */
  private glide: { from: Camera; to: Camera; t: number; s: number; door: boolean } | null = null;
  private keys = new Set<string>();
  /** Where the pointer is on the view, in CSS pixels from its top left; null while it's off it. */
  private pointer: { x: number; y: number } | null = null;
  /**
   * The left button, while it's down: where it went down (in the walk mode, where that spot of the view has gone as
   * the view turned since, so that looking away from it is a drag), whether the pointer has moved far enough since for it to
   * be a drag, the valve it went down on, if any (a drag turns it; a click picks its tool up), and whether it picked
   * something up, which a drag then leaves where the button's let go.
   */
  private press: { x: number; y: number; moved: boolean; valve: { t: Tool; k: number } | null; took: boolean; shift: boolean } | null = null;
  /** While the view is being dragged across the wall: the point of the wall the pointer took hold of. */
  private panning: Vec3 | null = null;
  /** The fingers on the view, on a touch screen, by pointer id; and while two are down, how they stood, to pinch by. */
  private fingers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; x: number; y: number } | null = null;
  private held: Held | null = null;
  /** Whether the right button is held: a held flask tips and pours, and a held hose lets fluid out, only while it is. */
  private rightHeld = false;
  /** A valve being turned: its lever points at the pointer for as long as the button that took hold of it is down. */
  private turning: { t: Tool; k: number } | null = null;
  /**
   * While an equipment wheel is held open, which of WHEELS it is, where its middle is on the view, in CSS pixels,
   * where its pointer is from there, and where the mouse's pointer last was: the wheel's pointer moves as the mouse
   * does, from its middle, no further than it reaches (see wheelMove).
   */
  private wheel: (WheelAim & { which: number; cx: number; cy: number; last: { x: number; y: number } }) | null = null;
  /** The scale whose tare key is held down, to draw it pressed. */
  private tarePress: Scale | null = null;
  /** Open tops, as of the latest look this frame (see mouths). */
  private open: Mouth[] = [];
  /** Those falling fluid lands in, as of then: all of them but what's in hand's, until it's been held still (see catching). */
  private catch: Mouth[] = [];
  /** How still what's in hand has been held, in real time (see still.ts): it catches falling fluid only once it's been still long enough. */
  private still: Stillness | null = null;
  /** What overflowed each vessel this frame, and where it spilled from, for drawing (see fill). */
  private spills = new Map<Vessel, { at: Vec3; v: Vessel }>();
  private spillTime = 1;
  /** Drops that have let go of an outlet and are on their way down. */
  private falling: { v: Vessel; x: number; y: number; z: number; vy: number; trail: boolean }[] = [];
  /** The faucets pouring into something this frame: where from (the faucet, or its hose's nozzle), and into what. */
  private faucetFlows: { fa: FaucetSpot; from: Vec3; m: Mouth }[] = [];
  /**
   * The vessel the held dipper's foot has gone down into through its mouth (see heldDip), and where its foot was a
   * frame ago: held, it's in a vessel's fluid only if it went in by the top.
   */
  private entered: Vessel | null = null;
  private lastFoot: Vec3 | null = null;
  /** Real seconds the held wicking strip has been dipped in a fluid since its foot touched it (see DIP_SOAK). */
  private dipFor = 0;
  /** Where the held flask poured this frame, if it did: its lip, and what it poured into (null: the sink). */
  private pour: { from: Vec3; into: Mouth | null } | null = null;
  /** Where what's held is, and whether it could be left there, as of this frame (see placement). */
  private placed: Placed | null = null;
  /** What the pointer is on. */
  private target: (Pick & { point: Vec3; distance: number }) | null = null;
  /** The cursor the view's canvas shows, as last set (see cursor). */
  private cursorNow = '';
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
   * While previewing the end's white void (see previewArrival), where the view was before, to put it back; null
   * otherwise.
   */
  private previewing: { cam: Camera; facing: GameEngine['facing'] } | null = null;
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
    /** How the lab is seen and worked (see ViewMode). */
    readonly mode: ViewMode = 'wall',
  ) {
    // the colors' in a row along the wall, then the solvent's, along the bench (see FAUCET_X)
    const pipes = faucetPipes();
    this.faucets = FAUCETS.map((start, i) => ({ start, output: faucetOutput(start, chem), note: '', ...pipes[i] }));
    this.view = mode === 'flat' ? new FlatView(canvas, this.faucets, EYE) : new View(canvas, this.faucets, EYE);
    this.aim();
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
    this.reopen();
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
    // a preset's flasks in a row along the counter
    this.flasks = preset.flasks.map((fill, i) => {
      const f = new Flask(CAP);
      f.pose = onPlane(PRESET_FLASKS_X + i * CELL, LIFT + FLASK_H);
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
      return new Hose({ tool: this.tools[from.tool], spout: from.spout }, { x: m.x, y: m.y + (to.up ?? 24), z: m.z });
    });
    this.settle();
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

  private afterLoad(): void {
    // a lab loads with the airlock shut, until its station has been delivering steadily again, and anyone in it or
    // asleep in the pod wakes in the lab, at the bench
    if (this.wake === 'open' || this.wake === 'settling' || this.wake === 'boarding' || this.wake === 'asleep' || this.arrival) {
      this.arrival = false;
      this.riseT = null;
      this.wake = 'closed';
      this.wakeT = Infinity;
      this.sleeping = null;
      if (this.facing === 'pod') this.toBench();
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
    this.held = this.turning = this.tarePress = this.press = this.panning = null;
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
    this.reopen();
  }

  /** A valve being turned is let go of: that's a step to undo, if it moved. */
  private endTurn(): void {
    if (!this.turning) return;
    this.turning = null;
    this.commit();
  }

  /** Everything in the lab, plus the chemistry parameters, for saving. */
  snapshot(): SaveState {
    const view = this.facing === 'bench' && !this.glide ? this.at : this.bench;
    return {
      v: 1,
      wall: true,
      preset: this.preset.id,
      flasks: this.flasks.map((f) => ({ ...saveVessel(f), x: f.pose.x / HOME_W, up: f.pose.y - LIFT, glass: f.glass })),
      tools: this.tools.map((t) => ({
        kind: t.kind, id: t.id, ...this.frac(t.pose), valves: [...t.valves], tanks: t.tanks.map(saveVessel),
        drops: t.drops.map(saveVessel),
        ...(t.tube.length ? { tube: t.tube.map(saveVessel) } : {}),
        ...(t.note ? { note: t.note } : {}),
        ...(t.memory ? { memory: t.memory } : {}),
        ...(t.paper.length ? { paper: t.paper.map(saveVessel) } : {}),
        ...(t.bed.length ? { bed: t.bed.map(saveVessel) } : {}),
      })),
      scales: this.scales.map((sc) => ({
        ...this.frac(sc.pose), tare: sc.tare,
        load: sc.load.map(({ f, dx }) => ({ f: this.flasks.indexOf(f), dx })).filter((l) => l.f >= 0),
        ...(sc.note ? { note: sc.note } : {}),
      })),
      hoses: this.hoses.map((h) => ({
        outlet: toFrac(h.outlet),
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
      view: { x: view.x, y: view.y, z: view.z },
      // (kept whatever the mode, so that switching from the walk mode and back keeps it)
      player: { ...this.player },
      chem: saveChem(this.chem.params),
    };
  }

  private frac(p: Vec3): { fx: number; fy: number } {
    const f = toFrac(p);
    return { fx: f.x, fy: f.y };
  }

  /**
   * Replace the lab with a saved one. `preset` is what Reset will go back to afterwards. A save from when the lab was
   * a room to walk round is laid out along the wall first, hooked up as it was (see flatten).
   */
  restore(saved: SaveState, preset: Preset): void {
    const s = flatten(saved);
    this.preset = preset;
    loadChem(this.chem.params, s.chem);
    this.chem.rebuild();
    const num = (x: unknown, d: number) => (Number.isFinite(x) ? (x as number) : d);
    const pose = (p: { x: number; y: number }): Pose => this.inRoom(onPlane(num(p.x, BENCH.x0 + CELL), num(p.y, LIFT + 2 * CELL)));
    this.flasks = s.flasks.map((sf, i) => {
      const f = new Flask(CAP);
      f.pose = pose({ x: sf.x * HOME_W, y: LIFT + sf.up });
      f.glass = Number.isFinite(sf.glass) ? sf.glass : glassGrams(i);
      loadVessel(f, sf);
      return f;
    });
    this.tools = s.tools
      .filter((st) => st.kind in SHAPES)
      .map((st) => {
        const t = new Tool(st.kind, st.id, pose(fromFrac({ x: st.fx, y: st.fy })), st.valves ?? []);
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
    // the scales and hoses before the tools a save lacks, which keep clear of them (see roomy)
    this.scales = s.scales.map((ss) => {
      const sc = new Scale(pose(fromFrac({ x: ss.fx, y: ss.fy })));
      sc.tare = ss.tare ?? 0;
      if (typeof ss.note === 'string') sc.note = ss.note;
      for (const { f, dx } of ss.load ?? []) if (this.flasks[f]) sc.put(this.flasks[f], dx < 0 ? SCALE_SLOTS[0] : SCALE_SLOTS[1]);
      return sc;
    });
    this.settle();
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
      const at = pose(fromFrac(sh.outlet));
      this.hoses.push(new Hose(mount, { x: at.x, y: at.y, z: at.z }));
    }
    this.uniqueTools();
    this.oldStation(s);
    for (const fa of this.faucets) fa.note = '';
    fs.forEach((f, i) => {
      const j = faucetIndex(i, fs.length);
      if (j !== null && typeof f?.note === 'string') this.faucets[j].note = f.note;
    });
    this.setAlarmsOff(!!s.alarmsOff);
    this.blindsShut = !!s.blindsShut;
    this.napKnown = !!s.nap;
    const v = s.view;
    this.bench = v && [v.x, v.y, v.z].every(Number.isFinite) ? this.inView({ x: v.x, y: v.y, z: v.z }) : { ...START_VIEW };
    // where the player stood in the walk mode; not where they stood in the room a save from before the wall had
    const pl = saved.wall ? s.player : undefined;
    this.player =
      pl && [pl.x, pl.z, pl.yaw, pl.pitch].every(Number.isFinite) && canStand(pl)
        ? { x: pl.x, z: pl.z, yaw: wrapAngle(pl.yaw), pitch: Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pl.pitch)) }
        : { ...WALK_START };
    if (this.facing !== 'pod') this.toBench();
    // the cabinet as saved; or for a save from before it, full but for what's out
    if (s.cabinet) {
      this.stock = stockWith({});
      for (const k of Object.keys(this.stock) as Stocked[]) {
        if (endless(k) || !Array.isArray(s.cabinet[k])) continue;
        const filled = new Set(s.cabinet[k]);
        this.stock[k] = this.stock[k].map((_, i) => filled.has(i));
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
   * station is built into the wall, so it's always where it is, whatever a save says.
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
   * Where a tool new to the lab (see uniqueTools) can go: where it is, if there's room for it there, or else the
   * nearest place along the wall at that height where there is, or failing that, higher up or lower down. An older
   * save can have something where a tool it lacked starts. Where it is, if there's room nowhere.
   */
  private roomy(t: Tool): Pose {
    const h: Held = { kind: 'tool', t, grip: { x: 0, y: 0 } };
    const at = t.pose;
    for (const dy of [0, 150, -150, 300, 450])
      for (let d = 0; d <= BENCH.x1 - BENCH.x0; d += 20)
        for (const dx of d ? [d, -d] : [0]) {
          const p = this.onBench(h, { ...at, x: at.x + dx, y: at.y + dy });
          if (Math.abs(p.x - at.x - dx) < 1 && !this.blocked(h, p)) return p;
        }
    return at;
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
   * Take a flask, tool or scale out of the equipment cabinet into the player's hand, its middle where the pointer is,
   * if their hands are free (what's held passes through everything, so there's always room) and there's one left.
   * Returns whether it did.
   */
  spawn(kind: Stocked): boolean {
    if (inPod(this.wake) || this.dozing() || this.glide || this.facing !== 'bench') return false;
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
    const mid = this.anchor(held);
    held.grip = { x: -mid.x, y: -mid.y };
    this.enter(held);
    this.hold(held);
    return true;
  }

  /** A little picture of each kind of thing the equipment wheels make, as it's drawn in the lab (see the view's IconStudio). */
  icons(): Readonly<Icons> {
    return this.view.icons();
  }

  /**
   * Open one of the equipment wheels round where the pointer is (or as near as it fits on the view), its own pointer
   * in its middle, if there'd be any use in it: at the bench, with hands free, and the mouse not busy turning a valve or
   * moving the view. With the other wheel open, it takes its place, where it is.
   */
  private openWheel(which: number): void {
    if (this.turning || this.panning || this.glide || this.facing !== 'bench') return;
    if (this.held) {
      this.say('Hands full');
      return;
    }
    if (this.wheel) {
      this.wheel = { ...this.wheel, which };
      return;
    }
    const at = this.pointer ?? { x: this.viewW / 2, y: this.viewH / 2 };
    // (it's drawn a little bigger than its rim)
    const r = WHEEL.rim + 6;
    const fit = (v: number, size: number) => (size < 2 * r ? size / 2 : Math.max(r, Math.min(size - r, v)));
    this.wheel = { which, cx: fit(at.x, this.viewW), cy: fit(at.y, this.viewH), last: { ...at }, x: 0, y: 0 };
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

  /**
   * Take the one in a slot of the cabinet out of it, into the player's hand: held by its middle, where the pointer
   * is, since it comes forward out of the cabinet to the bench's plane.
   */
  private takeOut(kind: Stocked, slot: number): void {
    if (!this.stock[kind][slot]) return;
    this.mark();
    takeSlot(this.stock, kind, slot);
    const held = this.fresh(kind, slot);
    const mid = this.anchor(held);
    held.grip = { x: -mid.x, y: -mid.y };
    held.follow = [];
    this.enter(held);
    this.hold(held);
  }

  /** A new one of a kind, empty, as it comes out of the cabinet's `slot`, held but not yet in the lab (see enter). */
  private fresh(kind: Stocked, slot: number): Held {
    const grip = { x: 0, y: 0 };
    if (kind === 'flask') {
      const f = new Flask(CAP);
      // each of the cabinet's flasks its own weight
      f.glass = glassGrams(slot);
      return { kind: 'flask', f, grip };
    }
    if (kind === 'scale') return { kind: 'scale', sc: new Scale(), grip };
    return { kind: 'tool', t: new Tool(kind, this.nextToolId++, undefined), grip };
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
    this.commit();
  }

  private say(text: string): void {
    this.flash = { text, until: performance.now() + NOTE_MS };
  }

  /* ---------------- bodies ---------------- */

  /**
   * The middle of what's held, in its own frame: where it's held from when it's made in hand, and where its box is
   * centered. A hose's nozzle's is straight up from its tip.
   */
  private anchor(h: Held): Vec3 {
    if (h.kind === 'flask') return FLASK_CENTER;
    if (h.kind === 'tool') return toolCenter(h.t);
    if (h.kind === 'scale') return scaleCenter(h.sc);
    return { x: 0, y: NOZZLE_H / 2, z: 0 };
  }

  /** Where it's held from: its own pose, or for a hose, its nozzle's tip. */
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
    return { ...this.heldBox(h), ...c, yaw: 0 };
  }

  /**
   * Everything on the bench but what's held (and what rides on it), and what's built into it: the faucets, the
   * supply station and the cabinet. A held tool's own hoses' nozzles don't get in its way, since one left at its
   * spout (see keepPouring) is rolled back up if it's left there again (see setDown), nor do the hoses following it
   * (see gather). Nor are the tool `away`, about to be picked up, and the hoses `skip`.
   */
  private obstacles(h: Held | null, away: Tool | null = null, skip: ReadonlySet<Hose> = new Set()): Box[] {
    const riders = h?.kind === 'scale' ? new Set(h.sc.load.map((l) => l.f)) : new Set<Flask>();
    const out: Box[] = [CABINET_BOX, ...this.faucets.map((fa) => faucetBox(fa.spout))];
    for (const f of this.flasks) if (!(h?.kind === 'flask' && h.f === f) && !riders.has(f)) out.push(flaskBox(f));
    const gone = (t: Tool) => (h?.kind === 'tool' && h.t === t) || t === away;
    for (const t of this.tools) if (!gone(t)) out.push(toolBox(t));
    for (const sc of this.scales) if (!(h?.kind === 'scale' && h.sc === sc)) out.push(scaleBox(sc));
    const following = new Set(h?.follow?.map((f) => f.hose));
    for (const hose of this.hoses) {
      if ((h?.kind === 'hose' && h.h === hose) || following.has(hose) || skip.has(hose)) continue;
      if (!(h?.kind === 'tool' && 'tool' in hose.on && hose.on.tool === h.t)) out.push(nozzleBox(hose));
    }
    return out;
  }

  /* ---------------- the view ---------------- */

  /** A place for the view kept where it can be: clear of the room's ends, floor and ceiling, the bench and the wall behind. */
  private inView<P extends Vec3>(p: P): P {
    const b = VIEW_BOUNDS;
    return {
      ...p,
      x: Math.max(ROOM.x0 + b.x, Math.min(ROOM.x1 - b.x, p.x)),
      y: Math.max(b.y0, Math.min(ROOM.y1 - b.y1, p.y)),
      z: Math.max(PLANE_Z + VIEW_NEAR, Math.min(ROOM.z1 - VIEW_NEAR, p.z)),
    };
  }

  /** Whether the view has no perspective (see ViewMode): the wall seen square on without it, or drawn flat. */
  private ortho(): boolean {
    return this.mode === 'ortho' || this.mode === 'flat';
  }

  /**
   * The camera for a view at `at` (see GameEngine.at), on the bench, or on the wall behind if `away`: square on to
   * the wall. With perspective, it's just there. Without, it sees as much of the wall, top to bottom, as that would,
   * from ORTHO_BACK straight out from the middle of it.
   */
  private camOf(at: Vec3, away = false): Camera {
    const turn = away ? Math.PI : 0;
    if (!this.ortho()) return { x: at.x, y: at.y, z: at.z, yaw: turn, pitch: 0, fov: FOV };
    const wall = away ? ROOM.z1 : PLANE_Z;
    const ortho = Math.abs(at.z - wall) * Math.tan((FOV * Math.PI) / 360);
    return { x: at.x, y: at.y, z: away ? wall - ORTHO_BACK : wall + ORTHO_BACK, yaw: turn, pitch: 0, fov: FOV, ortho };
  }

  /**
   * A camera with perspective that sees, as near as one can, what `cam` sees without: the same way, the same stretch
   * of the wall. The view glides to and from the pod with perspective, whatever the mode.
   */
  private standIn(cam: Camera): Camera {
    if (cam.ortho === undefined) return cam;
    const { ahead } = axes(cam);
    const on = ORTHO_BACK - cam.ortho / Math.tan((FOV * Math.PI) / 360);
    return { x: cam.x + ahead.x * on, y: cam.y + ahead.y * on, z: cam.z + ahead.z * on, yaw: cam.yaw, pitch: cam.pitch, fov: FOV };
  }

  /** Put the camera where the view is (see GameEngine.at), on the wall it's on; in the walk mode, at the player's eyes. */
  private aim(): void {
    if (this.facing === 'pod') return;
    this.cam = this.mode === 'walk' ? this.eyes() : this.camOf(this.at, this.facing === 'away');
  }

  /** The camera at the player's eyes, in the walk mode (see player). */
  private eyes(): Camera {
    const { x, z, yaw, pitch } = this.player;
    return { x, y: EYE, z, yaw, pitch, fov: WALK_FOV };
  }

  /**
   * The captured mouse moved (dx, dy) pixels, in the walk mode: an equipment wheel's pointer moves, if one's open
   * (see wheelMove); or else the view turns, which, with the left button down, may make a drag of it (see moved).
   */
  private look(dx: number, dy: number): void {
    const w = this.wheel;
    if (w) {
      this.wheel = { ...w, ...wheelMove(w, dx, dy) };
      return;
    }
    if (this.glide || this.facing === 'pod' || this.dozing() || this.previewing) return;
    const p = this.player;
    p.yaw = wrapAngle(p.yaw - dx * LOOK_SENS);
    p.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p.pitch - dy * LOOK_SENS));
    this.aim();
    // what was under the crosshair as the button went down goes the other way across the view
    const pr = this.press;
    if (pr) {
      pr.x -= dx;
      pr.y -= dy;
    }
    this.moved();
  }

  /**
   * In the walk mode, the pointer is the crosshair, in the middle of the view, while the mouse is captured, and off
   * it while it isn't; but in the pod, where the free pointer can press OK, it's wherever that is.
   */
  private crosshair(): void {
    if (this.mode !== 'walk') return;
    if (this.locked) this.pointer = { x: this.viewW / 2, y: this.viewH / 2 };
    else if (!inPod(this.wake)) this.pointer = null;
  }

  /** In the walk mode, let go of the mouse, if it's captured: to type a note, or in the pod, to press OK with it. */
  private unlock(): void {
    if (!this.locked) return;
    this.locked = false;
    this.uncaptured();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /**
   * The mouse has been let go of, in the walk mode: no key or button is held any longer, as far as the lab knows,
   * so a press under way ends as if its button came up, and an equipment wheel open closes making nothing. The
   * pointer is off the view until the free mouse moves over it.
   */
  private uncaptured(): void {
    this.keys.clear();
    this.wheel = null;
    this.rightUp();
    this.leftUp(false);
    this.pointer = null;
  }

  /** Put the view at the bench, where it last was there, at once. */
  private toBench(): void {
    this.at = { ...this.bench };
    this.facing = 'bench';
    this.glide = null;
    this.aim();
  }

  /** The upright plane the view is on: the bench's, or the wall's behind it. */
  private wallZ(): number {
    return this.facing === 'away' ? ROOM.z1 : PLANE_Z;
  }

  /** The pointer at (x, y) on the view, in CSS pixels, as the view's own coordinates: −1 to 1 across and up. */
  private ndc(x: number, y: number): [number, number] {
    return [(x / Math.max(1, this.viewW)) * 2 - 1, 1 - (y / Math.max(1, this.viewH)) * 2];
  }

  /**
   * The point of the upright plane `z` out from the back wall that (x, y) on the view is on; null if it's on none of
   * it. It's worked out from where the view is now (see sightAt), not from the frame last drawn, so that it's right
   * however many times the view moves between frames.
   */
  private planeAt(x: number, y: number, z = this.wallZ()): Vec3 | null {
    return onPlaneZ(sightAt(this.cam, ...this.ndc(x, y), this.viewW / Math.max(1, this.viewH)), z);
  }

  /**
   * Space: turn the view round to the wall behind the bench, where the airlock, the porthole and the alarms' button
   * are, from far enough back to see them all (see BEHIND_VIEW); or back to the bench, where it was. With something
   * in hand it stays put. The flat view has no wall behind, and in the walk mode the player just looks behind them.
   */
  turnRound(): void {
    if (this.mode === 'flat' || this.mode === 'walk') return;
    if (this.glide || inPod(this.wake) || this.dozing() || this.previewing || this.wheel || this.turning) return;
    if (this.held) {
      this.say('Hands full');
      return;
    }
    const from = { ...this.cam };
    if (this.facing === 'bench') {
      this.bench = { ...this.at };
      this.at = { ...BEHIND_VIEW };
      this.facing = 'away';
    } else if (this.facing === 'away') {
      this.at = { ...this.bench };
      this.facing = 'bench';
    } else return;
    this.glide = { from, to: this.camOf(this.at, this.facing === 'away'), t: 0, s: TURN_S, door: false };
    this.press = this.panning = null;
  }

  /**
   * Move the view for a frame of dt real seconds (it's the player's own doing, like carrying): on along a glide, if
   * it's on one; or else across the wall with the keys, with a drag of the wall itself, or, with something in hand,
   * with the pointer at the view's edge. In the walk mode, the keys walk the player instead (see stroll).
   */
  private steer(dt: number): void {
    const g = this.glide;
    if (g) {
      g.t = Math.min(g.s, g.t + dt);
      this.cam = glideAt(g.from, g.to, g.t / g.s, g.door);
      if (g.t >= g.s) {
        this.glide = null;
        this.aim();
        // settled into the pod, its door shuts
        if (this.wake === 'settling') {
          this.wake = 'boarding';
          this.wakeT = 0;
        }
      }
      return;
    }
    if (this.facing === 'pod' || this.wheel) return;
    if (this.mode === 'walk') return this.stroll(dt);
    const k = this.keys;
    let across = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let up = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const at = this.pointer;
    if (this.held && at && !this.fingers.size) {
      const edge = (v: number, size: number) => (v < EDGE_PX ? (v - EDGE_PX) / EDGE_PX : v > size - EDGE_PX ? (v - size + EDGE_PX) / EDGE_PX : 0);
      across += Math.max(-1, Math.min(1, edge(at.x, this.viewW)));
      up -= Math.max(-1, Math.min(1, edge(at.y, this.viewH)));
    }
    // screen right is +x facing the bench, and −x facing the wall behind
    const side = this.facing === 'away' ? -1 : 1;
    const step = PAN_RATE * Math.abs(this.at.z - this.wallZ()) * dt;
    this.at = this.inView({ ...this.at, x: this.at.x + side * across * step, y: this.at.y + up * step });
    this.aim();
    this.dragView();
  }

  /**
   * In the walk mode, walk for dt real seconds (it's the player's own movement) as the keys say, at WALK, whichever
   * way: W and S (or up and down) ahead and back, A and D (or left and right) to the sides, as they look, as far as
   * they can go (see walk.ts).
   */
  private stroll(dt: number): void {
    const k = this.keys;
    const ahead = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (!this.locked || (!ahead && !side)) return;
    const p = this.player;
    const step = (WALK * dt) / Math.hypot(ahead, side);
    const [sin, cos] = [Math.sin(p.yaw), Math.cos(p.yaw)];
    Object.assign(p, walk(p, (-sin * ahead + cos * side) * step, (-cos * ahead - sin * side) * step));
    this.aim();
  }

  /** While the wall is being dragged (see panning), move the view so that the point of it taken hold of is under the pointer. */
  private dragView(): void {
    const drag = this.panning;
    const at = this.pointer;
    const now = drag && at && this.canSteer() ? this.planeAt(at.x, at.y) : null;
    if (drag && now) this.slide(drag.x - now.x, drag.y - now.y);
  }

  /** Move the view (dx, dy) across the wall it's on, as far as it can go. */
  private slide(dx: number, dy: number): void {
    this.at = this.inView({ ...this.at, x: this.at.x + dx, y: this.at.y + dy });
    this.aim();
  }

  /**
   * The wheel turned by `px` pixels (down is positive), or two fingers pinched: move the view in toward the point of
   * the wall the pointer is on, or back out from it, so that point stays under the pointer. (Without perspective,
   * nearer is only seeing less of the wall, bigger.)
   */
  private zoom(px: number): void {
    // (in the walk mode, the player walks nearer)
    if (this.mode === 'walk' || this.glide || this.facing === 'pod' || this.wheel || this.dozing()) return;
    const at = this.pointer ?? { x: this.viewW / 2, y: this.viewH / 2 };
    const p = this.planeAt(at.x, at.y);
    if (!p) return;
    const wall = this.wallZ();
    this.at = this.inView({ ...this.at, z: wall + (this.at.z - wall) * Math.exp(px * ZOOM_RATE) });
    this.aim();
    const q = this.planeAt(at.x, at.y);
    if (q) this.slide(p.x - q.x, p.y - q.y);
  }

  /* ---------------- input ---------------- */

  /* On a touch screen, on-screen buttons stand in for the keys and the right button (see TouchControls). */

  /** Enter: write a note about what the pointer was last on. */
  touchNote(): void {
    this.writeNote();
  }

  /** N: nap, or wake from one. */
  touchNap(): void {
    if (this.dozing()) this.wakeNap();
    else this.nap();
  }

  /** Backspace: put away what's held. */
  touchPutAway(): void {
    this.putAway();
  }

  /** The right button, pressed or let go: it pours from a held flask, or lets fluid out of a held hose. */
  hand(down: boolean): void {
    if (down) this.rightDown();
    else this.rightUp();
  }

  private bindInput(): void {
    const c = this.canvas;
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener));
    };
    /** Where an event is on the view, in CSS pixels from its top left. */
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // in the walk mode, the mouse is captured to look around, and the pointer is always the crosshair (see locked)
    const walking = this.mode === 'walk';
    if (walking) {
      const onLock = () => {
        const now = document.pointerLockElement === c;
        if (now === this.locked) return;
        this.locked = now;
        if (now) this.crosshair();
        else this.uncaptured();
      };
      document.addEventListener('pointerlockchange', onLock);
      this.cleanups.push(() => document.removeEventListener('pointerlockchange', onLock));
    }
    on(c, 'pointerdown', (e) => {
      e.preventDefault();
      if (walking && !this.locked) {
        // the mouse is free: in the pod, it can press OK where it points; out of it, a click captures it
        if (inPod(this.wake)) {
          this.pointer = at(e);
          this.retarget();
          if (e.button === 0 && this.target?.kind === 'wake') this.pressOk();
        } else if (e.button === 0) c.requestPointerLock?.()?.catch?.(() => {});
        return;
      }
      if (walking) {
        this.crosshair();
        this.retarget();
        if (e.button === 0) this.leftDown(e.shiftKey);
        if (e.button === 2) this.rightDown();
        return;
      }
      c.setPointerCapture?.(e.pointerId);
      this.pointer = at(e);
      if (e.pointerType === 'touch') {
        this.fingerDown(e.pointerId);
        return;
      }
      // what it's on now, not as of the last frame
      this.retarget();
      if (e.button === 0) this.leftDown(e.shiftKey);
      if (e.button === 1 && this.canSteer()) this.panning = this.planeAt(this.pointer.x, this.pointer.y);
      if (e.button === 2) this.rightDown();
    });
    on(c, 'pointermove', (e) => {
      if (walking) {
        if (this.locked) this.look(e.movementX, e.movementY);
        else if (inPod(this.wake)) this.pointer = at(e);
        return;
      }
      if (e.pointerType === 'touch') {
        if (this.fingers.has(e.pointerId)) this.fingerMove(e.pointerId, at(e));
        return;
      }
      this.pointer = at(e);
      this.moved();
    });
    const up = (e: PointerEvent) => {
      if (walking) {
        if (e.button === 0) this.leftUp(false);
        if (e.button === 2) this.rightUp();
        return;
      }
      if (e.pointerType === 'touch') {
        this.fingerUp(e.pointerId);
        return;
      }
      if (e.button === 0) this.leftUp(false);
      if (e.button === 1) this.panning = null;
      if (e.button === 2) this.rightUp();
    };
    on(c, 'pointerup', up);
    on(c, 'pointercancel', up);
    on(c, 'pointerleave', (e) => {
      // off the view, it's on nothing; a button held keeps the pointer, wherever it goes
      if (walking ? !this.locked : e.pointerType !== 'touch' && !e.buttons) this.pointer = null;
    });
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'wheel', (e) => {
      e.preventDefault();
      // (the walk mode has no zooming: see zoom)
      this.zoom(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1));
    });
    on(window, 'keydown', (e) => {
      if (typingIn(e.target)) return;
      // the usual keys for undo and redo
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault();
        this.undo(e.code === 'KeyY' || e.shiftKey);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Enter is OK on the message inside the cryopod, as it was on the notice it replaced
      if (e.code === 'Enter' && this.wake === 'pod') this.pressOk();
      // napping, or nodding off, N wakes them, and nothing else does anything
      if (this.dozing()) {
        if (e.code === 'KeyN' && !e.repeat) this.wakeNap();
        return;
      }
      // in god mode, = shows the end's white void, or puts the lab back
      if (e.code === 'Equal' && (this.god || this.previewing)) {
        if (!e.repeat) this.previewArrival(!this.previewing);
        return;
      }
      // in the walk mode, with the mouse free, the lab doesn't respond to the keys
      if (walking && !this.locked) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat || inPod(this.wake) || this.previewing || this.glide) return;
      if (e.code === 'Space') this.turnRound();
      if (e.code === 'KeyP') this.board();
      if (e.code === 'KeyN') this.nap();
      if (this.facing !== 'bench') return;
      // E is a click of the left button, where the pointer is
      if (e.code === 'KeyE') {
        this.retarget();
        this.leftDown(e.shiftKey);
        this.leftUp(false);
      }
      // (in the walk mode, Esc lets go of the mouse instead)
      if (e.code === 'KeyQ' || (e.code === 'Escape' && this.mode !== 'walk')) this.putBack();
      if (e.code === 'Enter') {
        // the note's text box opens at once, and this Enter mustn't be taken as finishing it
        e.preventDefault();
        this.writeNote();
      }
      const wheel = WHEEL_CODES.indexOf(e.code);
      if (wheel >= 0) {
        this.openWheel(wheel);
        e.preventDefault();
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        this.putAway();
        e.preventDefault();
      }
    });
    on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      const wheel = WHEEL_CODES.indexOf(e.code);
      if (wheel >= 0) this.closeWheel(wheel);
    });
    on(window, 'blur', () => {
      this.keys.clear();
      this.wheel = null;
      this.rightUp();
      this.leftUp(true);
    });
  }

  /**
   * Whether the view can be moved by hand just now: at the bench or the wall behind, and not on its way anywhere. In
   * the walk mode it never can, but by walking and looking.
   */
  private canSteer(): boolean {
    return this.mode !== 'walk' && !this.glide && this.facing !== 'pod' && !this.dozing() && !this.wheel;
  }

  /** What the pointer is on, as of now (see View.pick); what a valve being turned is on stays as it was. */
  private retarget(): void {
    if (this.turning) return;
    const at = this.pointer;
    this.target = !at || this.previewing || this.wheel ? null : this.view.pick(...this.ndc(at.x, at.y), this.heldObject());
  }

  /** The pointer moved: a press that's gone far enough is a drag, which turns the valve it went down on, if any. */
  private moved(): void {
    const at = this.pointer;
    // an open wheel's pointer moves as the mouse does
    const w = this.wheel;
    if (w && at) this.wheel = { ...w, ...wheelMove(w, at.x - w.last.x, at.y - w.last.y), last: { ...at } };
    const pr = this.press;
    if (at && pr && !pr.moved && Math.hypot(at.x - pr.x, at.y - pr.y) > DRAG_PX) {
      pr.moved = true;
      if (pr.valve && !this.turning) {
        this.mark();
        this.turning = pr.valve;
      }
    }
    if (this.turning) this.aimTurning();
    this.dragView();
  }

  /**
   * The left button went down (or a finger did). A button it's on takes it, whatever's in hand. Otherwise, at the
   * bench: what's held is left where it is, or put in the cabinet if it's held over that; with empty hands, a valve
   * waits to see if it's a drag (which turns it) or a click (which picks its tool up), a spout or faucet's hose is
   * pulled out, or its nozzle taken hold of, anything else that can be is picked up, and the bare wall is taken hold
   * of, to drag the view across it.
   */
  private leftDown(shift: boolean): void {
    if (this.dozing() || !this.pointer) return;
    const p = this.target;
    if (p?.kind === 'wake') {
      this.pressOk();
      return;
    }
    if (inPod(this.wake) || this.glide || this.previewing || this.wheel) return;
    this.press = { ...this.pointer, moved: false, valve: null, took: false, shift };
    if (p?.kind === 'alarm') {
      this.change(() => this.setAlarmsOff(!this.alarmsOff));
      return;
    }
    if (p?.kind === 'blinds') {
      this.change(() => (this.blindsShut = !this.blindsShut));
      return;
    }
    if (p?.kind === 'airlock') {
      if (this.wake === 'open') this.board();
      else this.say('The airlock is shut');
      return;
    }
    if (p?.kind === 'scale' && p.part === 'tare') {
      this.change(() => p.sc.zero());
      this.tarePress = p.sc;
      return;
    }
    if (this.facing === 'bench') {
      if (this.held) {
        if (this.intoCabinet()) this.putAway();
        else this.release();
        return;
      }
      const v = this.valveGrabbed();
      if (v) {
        this.press.valve = v;
        return;
      }
      const m = this.mountAimed();
      if (m) {
        this.pullHose(m);
        this.press.took = true;
        return;
      }
      if (p && this.grabbable(p)) {
        this.grab(shift);
        this.press.took = !!this.held;
        return;
      }
    }
    // the bare wall: a drag moves the view across it
    if (this.canSteer()) this.panning = this.planeAt(this.pointer.x, this.pointer.y);
  }

  /**
   * The left button came up (or a finger did, `touch`). A drag that picked something up leaves it where it is now, if
   * it can be left there (a finger, which can't carry on holding it, puts it back if it can't); a click on a valve
   * picks its tool up.
   */
  private leftUp(touch: boolean): void {
    this.tarePress = null;
    this.panning = null;
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    if (this.turning) {
      this.endTurn();
      return;
    }
    if (pr.valve && !pr.moved && !touch) {
      this.retarget();
      const p = this.target;
      if (p?.kind === 'tool' && p.t === pr.valve.t && this.grabbable(p)) this.grab(pr.shift);
      return;
    }
    if (!pr.took || !this.held || !(pr.moved || touch)) return;
    this.carry();
    if (this.placed?.rest || this.intoCabinet() || !touch) {
      if (this.intoCabinet()) this.putAway();
      else this.release();
    } else this.putBack();
  }

  /** A finger came down on the view: the first acts as the left button; a second, with it, pinches the view. */
  private fingerDown(id: number): void {
    const at = this.pointer!;
    this.fingers.set(id, at);
    if (this.fingers.size === 1) {
      this.retarget();
      this.leftDown(false);
      return;
    }
    // two fingers move the view; whatever the first one did is called off
    if (this.press?.took && this.held) this.putBack();
    this.endTurn();
    this.press = this.panning = null;
    this.pinch = this.pinched();
  }

  /** A finger on the view moved: it carries, turns or drags as the mouse does; two pinch the view in or out, and drag it. */
  private fingerMove(id: number, at: { x: number; y: number }): void {
    this.fingers.set(id, at);
    if (this.fingers.size === 1) {
      this.pointer = at;
      this.moved();
      return;
    }
    const was = this.pinch;
    const now = this.pinched();
    if (!was || !now || !this.canSteer()) return;
    this.pointer = { x: now.x, y: now.y };
    // the wall under the fingers' middle stays under it, and as they spread, comes nearer
    const grabbed = this.planeAt(was.x, was.y);
    const under = this.planeAt(now.x, now.y);
    if (grabbed && under) this.slide(grabbed.x - under.x, grabbed.y - under.y);
    if (was.d > 0 && now.d > 0) this.zoom(Math.log(was.d / now.d) / ZOOM_RATE);
    this.pinch = now;
  }

  /** A finger left the view. */
  private fingerUp(id: number): void {
    if (!this.fingers.delete(id)) return;
    if (this.fingers.size === 0) {
      // (the pointer stays where the finger was, on what it last touched, for the buttons that act on that)
      if (!this.pinch) this.leftUp(true);
      this.pinch = null;
      this.press = this.panning = null;
    } else this.pinch = this.fingers.size >= 2 ? this.pinched() : this.pinch;
  }

  /** How far apart the first two fingers on the view are, and their middle, in CSS pixels. */
  private pinched(): { d: number; x: number; y: number } | null {
    const [a, b] = [...this.fingers.values()];
    return a && b ? { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  }

  /** Point the lever of the valve being turned at where the pointer is, on the tool's front face. */
  private aimTurning(): void {
    const tr = this.turning;
    const at = this.pointer;
    if (!tr || !at) return;
    const { t, k } = tr;
    const p = this.planeAt(at.x, at.y, onTool(t, 0, 0, valveZ(t)).z);
    if (!p) return;
    const l = toLocal(t.pose, p);
    aimValve(t, k, l.x, -l.y);
  }

  /**
   * Set how what's held is gripped (see Held.grip) from where it is and where the pointer is, so that it stays where
   * it is as it's taken hold of.
   */
  private grip(h: Held): void {
    const at = this.pointer && this.planeAt(this.pointer.x, this.pointer.y, PLANE_Z);
    const p = this.heldPose(h);
    h.grip = at ? { x: p.x - at.x, y: p.y - at.y } : { x: 0, y: 0 };
  }

  /** Take what's been picked up or made in hand: it's held from now on, and goes where the pointer does. */
  private hold(h: Held): void {
    this.held = h;
    // a strip or a thermometer picked up out of a vessel is still in it
    const dipper = h.kind === 'tool' && isDipper(h.t.kind);
    this.lastFoot = dipper ? footAt(h.t) : null;
    this.entered = dipper ? insideVessel(this.lastFoot!, this.flasks, this.tools) : null;
    this.dipFor = 0;
    // just taken in hand, it's moving (see still.ts)
    this.still = null;
    this.carry();
  }

  /**
   * Pick up what the pointer is on. Picked up `linked` (with Shift), it stays hooked up to what it pours into and
   * what pours into it (see keepPouring and gather); otherwise it's moved alone.
   */
  private grab(linked: boolean): void {
    if (this.dozing() || inPod(this.wake) || this.held) return;
    const p = this.target;
    if (!p) return;
    let h: Held;
    const grip = { x: 0, y: 0 };
    if (p.kind === 'stock') {
      this.takeOut(p.item, p.slot);
      return;
    }
    if (p.kind === 'faucet' || p.kind === 'alarm' || p.kind === 'blinds' || p.kind === 'wake' || p.kind === 'cabinet' || p.kind === 'airlock') return;
    if (p.kind === 'tool' && p.t.shape.fixed) {
      this.say('That stays where it is');
      return;
    }
    if (p.kind === 'hose') {
      this.holdHose(p.h);
      return;
    }
    // picking something up starts a step to undo, done once it's left somewhere (see setDown)
    this.mark();
    if (p.kind === 'flask') {
      const sc = this.scales.find((x) => x.load.some((l) => l.f === p.f));
      const scale = sc && { sc, dx: sc.load.find((l) => l.f === p.f)!.dx };
      // before it's off the scale, what pours into it there
      const follow = linked ? this.gather({ kind: 'flask', f: p.f, grip }) : [];
      for (const x of this.scales) x.remove(p.f);
      h = { kind: 'flask', f: p.f, grip, from: { pose: { ...p.f.pose }, ...(scale ? { scale } : {}) }, follow };
    } else if (p.kind === 'tool') {
      h = { kind: 'tool', t: p.t, grip, from: { pose: { ...p.t.pose } }, made: linked ? this.keepPouring(p.t) : [] };
      h.follow = linked ? this.gather(h) : [];
    } else {
      h = { kind: 'scale', sc: p.sc, grip, from: { pose: { ...p.sc.pose } } };
      h.follow = linked ? this.gather(h) : [];
    }
    this.grip(h);
    this.hold(h);
  }

  /**
   * Keep a tool about to be picked up pouring into whatever it pours into: each of its spouts with no hose out letting
   * something out (see flowing) over an open top (but its own) gets its hose pulled out, the nozzle left just where
   * the spout is. Returns those hoses.
   */
  private keepPouring(t: Tool): Hose[] {
    const made: Hose[] = [];
    for (const j of this.pouringOut(t)) {
      const hose = new Hose({ tool: t, spout: j }, spoutAt(t, j));
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
    const grip = { x: 0, y: 0 };
    const h: Held | null =
      p.kind === 'flask' ? { kind: 'flask', f: p.f, grip }
      : p.kind === 'tool' ? { kind: 'tool', t: p.t, grip }
      : p.kind === 'scale' ? { kind: 'scale', sc: p.sc, grip }
      : null;
    return !!h && this.feeders(h).length > 0;
  }

  /**
   * Whatever pours into what's about to be carried keeps pouring into it: each faucet, nozzle, or spout letting
   * something out (see flowing), whose stream lands in it (a flask, a tool's open tanks, or the flasks on a scale), has
   * its hose, pulled out if it isn't, go along with it (see follow) until it's left somewhere, when they're left over
   * it too (see followRests). An idle spout that happens to be over it is left be.
   */
  private gather(h: Held): Follower[] {
    const at = this.heldPose(h);
    return this.feeders(h).map(({ m, at: from, into }) => {
      let hose = this.hoseOn(m);
      const was = hose ? { ...hose.outlet } : null;
      if (!hose) {
        hose = new Hose(m, from);
        this.hoses.push(hose);
      }
      return { hose, into, off: { x: hose.outlet.x - at.x, y: hose.outlet.y - at.y }, was };
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

  /** Bring the hoses following what's held (see gather) along with it, where it now is. */
  private follow(h: Held): void {
    const at = this.heldPose(h);
    for (const f of h.follow ?? []) f.hose.outlet = { x: at.x + f.off.x, y: at.y + f.off.y, z: PLANE_Z };
  }

  /**
   * Where the hoses following what's held (see gather) would be left if it were left at `pose`: each over the same
   * spot of it, still pouring into it; as high over it as it was if there's room, or else as low as there is, from
   * NOZZLE_GAP over the mouth up to POUR_RISE. Or why not.
   */
  private followRests(h: Held, pose: Pose): Vec3[] | string {
    const fs = h.follow ?? [];
    if (!fs.length) return [];
    const at = this.heldPose(h);
    const tilt = h.kind === 'flask' ? h.f.tilt : 0;
    const saved = fs.map((f) => f.hose.outlet);
    // put it there, upright, for a moment, to see; and each hose there in turn, for the next to go round
    if (h.kind === 'flask') h.f.tilt = 0;
    this.placeHeld(h, pose);
    const mouths = this.mouths();
    const unplaced = new Set(fs.map((f) => f.hose));
    const out: Vec3[] = [];
    let why: string | null = null;
    for (const f of fs) {
      unplaced.delete(f.hose);
      const tip = { x: pose.x + f.off.x, y: pose.y + f.off.y, z: PLANE_Z };
      const mouthY = mouths.find((m) => m.v === f.into)?.y ?? tip.y;
      const ys = [tip.y];
      for (let up = NOZZLE_GAP; up <= POUR_RISE; up += 10) ys.push(mouthY + up);
      const fh: Held = { kind: 'hose', h: f.hose, grip: { x: 0, y: 0 } };
      const obstacles = this.obstacles(fh, null, unplaced);
      const res = ys.map((y) => ({ ...tip, y })).find((q) => {
        const box = this.boxAt(fh, { ...q, yaw: 0 });
        return !obstacles.some((o) => boxesOverlap(box, o)) && mouthBelow(mouths, q)?.v === f.into;
      });
      if (!res) {
        why = 'No room for a hose following it';
        break;
      }
      out.push(res);
      f.hose.outlet = res;
    }
    fs.forEach((f, i) => (f.hose.outlet = saved[i]));
    this.placeHeld(h, at);
    if (h.kind === 'flask') h.f.tilt = tilt;
    return why ?? out;
  }

  /** Put the hoses following what's held back where they were before, rolling up any pulled out for it (see gather). */
  private unfollow(h: Held): void {
    for (const f of h.follow ?? []) {
      if (f.was) f.hose.outlet = f.was;
      else this.hoses.splice(this.hoses.indexOf(f.hose), 1);
    }
    h.follow = [];
  }

  /**
   * Take hold of a hose's nozzle, where it is. Q puts it back `from` where it was, by default where it is now; a hose
   * fresh out of its spout has nowhere to be put back to (null), so Q rolls it back up.
   */
  private holdHose(hose: Hose, from: Rest | null = { pose: { ...hose.outlet, yaw: 0 } }): void {
    this.mark();
    const h: Held = { kind: 'hose', h: hose, grip: { x: 0, y: 0 }, from: from ?? undefined };
    this.grip(h);
    this.hold(h);
  }

  /**
   * The spout or faucet the pointer is on, to pull a hose out of: a faucet's spout or the pipe down to it (not its
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
    const hose = old ?? new Hose(m, this.mountAt(m));
    const from: Rest | null = old ? { pose: { ...old.outlet, yaw: 0 } } : null;
    hose.outlet = this.mountAt(m);
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
   * Let go of what's held, if it can be left where it is (see placement): it stays there. If it can't, a note says
   * why, and it stays in hand.
   */
  private release(): void {
    const h = this.held;
    if (!h) return;
    const pl = this.placed ?? this.placement(h, this.heldPose(h));
    if (!pl.rest) {
      this.say(pl.why ?? 'No room');
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

  /** Let go of what's held, where it stays (see Rest): standing on a scale, for a flask. */
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
    h.follow?.forEach((f, i) => {
      const at = rest.follow?.[i];
      if (at) f.hose.outlet = at;
    });
    this.held = null;
    this.commit();
  }

  /**
   * Write a note about what the pointer is on, if it can have one (see targetNote). In god mode a flask or tank opens
   * the editor instead, which has a field for its label.
   */
  private writeNote(): void {
    if (this.dozing()) return;
    // what the pointer's on now, not as of the last frame
    this.retarget();
    const id = this.targetNote();
    if (!id || inPod(this.wake)) return;
    // in the walk mode, the mouse is let go of, to type it
    this.unlock();
    if (this.god && /^(f\d+|t\d+\.\d+)$/.test(id)) this.cb.onEdit(id);
    else this.cb.onLabel(id);
  }

  /**
   * The id of the note (see note) for what the pointer is on: a tool, by the tank pointed at, or the one tank it has,
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
   * The right button went down. At the bench, a held flask tips to pour and a held hose lets fluid out for as long as
   * it's down; with empty hands, on a valve, it turns it, the lever pointing at the pointer until it's let go. With
   * nothing else to do, it takes hold of the wall where the pointer is, and drags the view across it, whatever the
   * pointer is on.
   */
  private rightDown(): void {
    if (this.dozing() || inPod(this.wake) || this.glide || this.previewing || !this.pointer) return;
    if (this.facing === 'bench') {
      this.rightHeld = true;
      if (this.held || this.turning) return;
      this.retarget();
      const k = this.valveAimed();
      if (k) {
        this.mark();
        this.turning = k;
        this.aimTurning();
        return;
      }
    }
    if (this.canSteer()) this.panning = this.planeAt(this.pointer.x, this.pointer.y);
  }

  /** The right button came up. */
  private rightUp(): void {
    this.rightHeld = false;
    // (a drag of the view, or a turn of a valve, with the left button goes on)
    if (!this.press) this.panning = null;
    if (!this.press?.valve) this.endTurn();
  }

  /**
   * The valve the pointer is on, or within VALVE_REACH of on its tool's front face (see valveNear), if any. Where
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

  /**
   * The valve the left button would take hold of, to turn with a drag: the one the pointer is on (see valveAimed),
   * if it's on the valve itself (its core or its lever), or on nothing of a spout, whose hose the left button pulls
   * out instead (see mountAimed): a valve sits on the pipe just above its spout.
   */
  private valveGrabbed(): { t: Tool; k: number } | null {
    const v = this.valveAimed();
    const p = this.target;
    if (!v || p?.kind !== 'tool') return null;
    return p.part === 'valve' || !this.mountAimed() ? v : null;
  }

  /**
   * For checks in a browser: put the view somewhere (see Camera), at the bench. The mouse works as ever, so there's
   * nothing else to stand in for. In the walk mode, stand the player somewhere instead, looking some way (see Player;
   * `y` is ignored), and with `locked`, act as if the mouse were captured, or let go of, since a browser without a
   * screen can't capture it.
   */
  debug(p: Partial<{ x: number; y: number; z: number; yaw: number; pitch: number; locked: boolean }>): void {
    // (only what's given)
    const given = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
    const { x, y, z, yaw, pitch, locked } = p;
    if (this.mode === 'walk') {
      Object.assign(this.player, given({ x, z, yaw, pitch }));
      if (locked === false) this.unlock();
      else if (locked) this.locked = true;
      this.crosshair();
    } else this.bench = this.inView({ ...this.bench, ...given({ x, y, z }) });
    this.toBench();
    this.view.look(this.cam);
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

  /** Look afresh at the open tops (see open) and at those falling fluid lands in (see catch). */
  private reopen(): Mouth[] {
    this.open = this.mouths();
    this.catch = this.catching(this.open);
    return this.open;
  }

  /**
   * Of `mouths`, those falling fluid lands in: all of them but what's in hand's (a flask's, a tool's tanks', those of
   * the flasks on a scale) until it's been held still for CATCH_REST_S (see still.ts), so fluid falls past what's
   * being carried onto whatever's below. Fluid from a hose following it (see gather) lands in it all the same.
   */
  private catching(mouths: Mouth[]): Mouth[] {
    const h = this.held;
    if (!h || catches(this.still)) return mouths;
    const mine = new Set<Vessel>(h.kind === 'flask' ? [h.f] : h.kind === 'tool' ? h.t.tanks : h.kind === 'scale' ? h.sc.load.map((l) => l.f) : []);
    return mine.size ? mouths.filter((m) => !mine.has(m.v)) : mouths;
  }

  /** Whether the hose of a spout or faucet goes along with what's held (see gather): what it lets out lands in that, still or not. */
  private trails(m: HoseMount): boolean {
    return !!this.held?.follow?.some((f) => sameMount(f.hose.on, m));
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
    const below = mouthBelow(this.catch, rim);
    if (below) this.stream(below.v, out);
  }

  /* ---------------- main loop ---------------- */

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // in the walk mode, the mouse is let go of in the pod, to press OK with it, or carry on from the end
    if (inPod(this.wake)) this.unlock();
    this.crosshair();
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
    // nodding off, the view stays where it is
    if (!nap || nap.waking) this.steer(dt);
    this.view.look(this.cam);
    this.retarget();
    if (this.turning) this.aimTurning();
    this.tip(dt);
    this.carry(dt);
    this.simulate(dt);
    // the end stands the lab still as it was when there was enough, so it goes on in real time
    if (this.arrival && this.wake !== 'pod') this.stepWake(dt);
    if (this.riseT !== null) this.riseT = this.riseT + dt >= RISE_S ? null : this.riseT + dt;
    this.render(dt);
    this.inspect(now);
    this.hud(now);
    this.cursor();
    this.raf = requestAnimationFrame(this.frame);
  };

  /**
   * A held flask tips to pour while the right button's down, and stands back up when it's let go, over TIP_S real
   * seconds either way (it's the player's own doing).
   */
  private tip(dt: number): void {
    const h = this.held;
    if (h?.kind !== 'flask') return;
    const goal = this.rightHeld ? POUR_ANG : 0;
    const step = (POUR_ANG * dt) / TIP_S;
    h.f.tilt = h.f.tilt < goal ? Math.min(goal, h.f.tilt + step) : Math.max(goal, h.f.tilt - step);
  }

  /**
   * Carry: what's held goes where the pointer is on the bench, by where it was taken hold of (see Held.grip), through
   * anything in its way, and is shown just where it would stay if let go (see placement): settled onto the counter
   * or a scale it's near, and lined up with what it's nearly lined up with. A flask tipping to pour stays where it's
   * held instead, so it pours from where the player has it.
   */
  private carry(dt = 0): void {
    const h = this.held;
    if (!h) {
      this.placed = this.still = null;
      this.entered = this.lastFoot = null;
      return;
    }
    const was = this.heldPose(h);
    const at = this.facing === 'bench' && this.pointer ? this.planeAt(this.pointer.x, this.pointer.y, PLANE_Z) : null;
    const want = this.inRoom(at ? onPlane(at.x + h.grip.x, at.y + h.grip.y) : onPlane(was.x, was.y));
    const pl = (this.placed = this.placement(h, want));
    // by where it would be left, which tipping it to pour doesn't move
    this.still = stillness(this.still, pl.pose.x, pl.pose.y, dt);
    const pouring = h.kind === 'flask' && (this.rightHeld || h.f.tilt > 0);
    this.placeHeld(h, pouring ? want : pl.pose);
    this.follow(h);
  }

  /**
   * Whether spout j of tool t is a held tool's with no hose out: what leaves it goes straight down the drain, so
   * nothing it's carried over catches it.
   */
  private loose(t: Tool, j: number): boolean {
    return this.held?.kind === 'tool' && this.held.t === t && !this.hoseOn({ tool: t, spout: j });
  }

  /** Whether the pointer is over the equipment cabinet's stretch of the wall. */
  private overCabinet(): boolean {
    const at = this.facing === 'bench' && this.pointer ? this.planeAt(this.pointer.x, this.pointer.y, PLANE_Z) : null;
    return !!at && at.x < BENCH.x0;
  }

  /**
   * Whether letting go of what's held would put it in the equipment cabinet: it's held over the cabinet, and it's
   * something the cabinet holds.
   */
  private intoCabinet(): boolean {
    const h = this.held;
    if (!h || h.kind === 'hose' || !this.overCabinet()) return false;
    return isStocked(h.kind === 'tool' ? h.t.kind : h.kind);
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
    const mouths = this.reopen();
    const catching = this.catch;
    const h = this.held;

    // the held flask, tipped all the way, pours from its lip into whatever's below
    const D = h?.kind === 'flask' && this.rightHeld && h.f.tilt >= POUR_ANG * 0.97 ? h.f : null;
    if (D && simDt > 0) {
      const from = flaskLip(D);
      this.pour = { from, into: mouthBelow(catching, from) };
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
      const m = faucetTarget(this.trails({ faucet: i }) ? mouths : catching, from);
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
      const trailing = this.tools.map((t) => t.shape.spouts.map((_, j) => this.trails({ tool: t, spout: j })));
      const targets = this.tools.map((t, i) =>
        spouts[i].map((sp, j) => (this.loose(t, j) ? null : mouthBelow(trailing[i][j] ? mouths : catching, sp))),
      );
      // a fast flow streams straight into what's below (overflowing it if it's full); a slow one gathers
      // in a drop, which falls on its own time
      const pour = (drop: Vessel, out: Vessel | null, sp: Vec3, target: Mouth | null, loose: boolean, trail: boolean): boolean => {
        const down = drip(drop, out, step);
        if (down && down === out) {
          if (target) this.stream(target.v, out);
        } else if (down && !loose) this.falling.push({ v: down, x: sp.x, y: sp.y, z: sp.z, vy: 0, trail });
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
              pour(t.drops[k], out, spouts[j][k], targets[j][k], this.loose(t, k), trailing[j][k]);
              return;
            }
            tally(toolTotals[j][k], out, false); // before pouring, which can gather it into a drop
            tally(toolTotals[j][k], null, pour(t.drops[k], out, spouts[j][k], targets[j][k], this.loose(t, k), trailing[j][k]));
          });
        });
        // falling drops land in the first open top they pass, or go down the sink
        this.falling = this.falling.filter((d) => {
          const from = d.y;
          d.vy += GRAVITY * step;
          d.y -= d.vy * step;
          const m = mouthBelow(d.trail ? mouths : catching, { x: d.x, y: from, z: d.z });
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
   * Where what's held, wanted at pose p, is shown, and whether it could be left there (see Placed). Over the
   * equipment cabinet, it's where it's wanted, and can't be left, only put away. Otherwise it's on the bench (see
   * onBench); a flask near enough above a scale's platform is stood on it, at the nearer of its places, and a flask
   * or a scale near enough above the counter is stood on that (see SETTLE); a hose's nozzle over an inline
   * instrument's tube is snapped onto it (see docked); and whatever it is, it's slid across to line up with what
   * it's nearly lined up with (see magnet). Left there it mustn't overlap anything (what's held passes through
   * everything, so there's no way in to look at), and a strip or a thermometer can't be left in a vessel it didn't
   * go into by the top. If it can't be left there, it's shown where it's wanted.
   */
  private placement(h: Held, p: Pose): Placed {
    if (this.overCabinet()) return { pose: p, rest: null, why: this.intoCabinet() ? null : 'That doesn’t go in the cabinet' };
    let q = this.onBench(h, p);
    let scale: Rest['scale'];
    if (h.kind === 'flask')
      for (const sc of this.scales) {
        const dx = scaleSpot(sc, q, SETTLE);
        if (dx === null) continue;
        q = onScale(sc, dx);
        scale = { sc, dx };
        break;
      }
    if (!scale && (h.kind === 'flask' || h.kind === 'scale')) {
      const b = this.boxAt(h, q);
      const gap = b.y - b.hy - LIFT;
      if (gap < SETTLE) q = { ...q, y: q.y - gap };
    }
    if (h.kind === 'hose') q = docked(q, this.tools.filter((t) => !('tool' in h.h.on && h.h.on.tool === t)));
    if (!scale) q = this.magnet(h, q);
    const why = this.blocked(h, q);
    if (why) return { pose: p, rest: null, why };
    const follow = this.followRests(h, q);
    if (typeof follow === 'string') return { pose: p, rest: null, why: follow };
    return { pose: q, rest: { pose: q, ...(scale ? { scale } : {}), ...(follow.length ? { follow } : {}) }, why: null };
  }

  /**
   * Pose p moved the least way that puts what's held on the bench: all of it between the cabinet's end and the
   * wall's, under the ceiling, and no lower than standing on the counter.
   */
  private onBench(h: Held, p: Pose): Pose {
    const b = this.boxAt(h, p);
    const m = 2;
    const dx = Math.max(0, BENCH.x0 + m - (b.x - b.hx)) - Math.max(0, b.x + b.hx - (BENCH.x1 - m));
    const dy = Math.max(0, BENCH.y0 - (b.y - b.hy)) - Math.max(0, b.y + b.hy - (BENCH.y1 - m));
    return dx || dy ? { ...p, x: p.x + dx, y: p.y + dy } : p;
  }

  /**
   * Why what's held couldn't be left at pose p, if it couldn't: it would overlap something, or it's a strip or a
   * thermometer whose foot would be inside a vessel it hasn't gone down into through its mouth (see heldDip).
   */
  private blocked(h: Held, p: Pose): string | null {
    const box = this.boxAt(h, p);
    if (this.obstacles(h).some((o) => boxesOverlap(box, o))) return 'No room';
    if (h.kind === 'tool' && isDipper(h.t.kind) && h === this.held) {
      const foot = { x: p.x, y: p.y - (h.t.pose.y - footAt(h.t).y), z: p.z };
      const v = insideVessel(foot, this.flasks, this.tools);
      if (v && v !== this.entered) return 'It goes in through the top';
    }
    return null;
  }

  /**
   * Pose p slid across, by no more than MAGNET, to line what's held up with what it's nearly lined up with there: one
   * of its spouts (or its nozzle) over the middle of the mouth it would pour into, or one of its mouths under a spout,
   * nozzle or faucet that would pour into it; or a strip or a thermometer over the middle of a mouth it's over, or
   * down in. The nearest, if there are several.
   */
  private magnet(h: Held, p: Pose): Pose {
    const at = this.heldPose(h);
    const tilt = h.kind === 'flask' ? h.f.tilt : 0;
    // put it there, upright, for a moment, to see
    if (h.kind === 'flask') h.f.tilt = 0;
    this.placeHeld(h, p);
    const mouths = this.mouths();
    let best = 0;
    const pull = (d: number) => {
      if (Math.abs(d) > 1e-6 && Math.abs(d) <= MAGNET && (!best || Math.abs(d) < Math.abs(best))) best = d;
    };
    for (const a of this.aims(h, mouths)) if (a.held !== 'lip') pull(a.held === 'mouth' ? a.from.x - a.m.x : a.m.x - a.from.x);
    if (h.kind === 'tool' && isDipper(h.t.kind)) {
      const top = h.t.pose.y;
      for (const m of mouths) if (m.y < top) pull(m.x - p.x);
    }
    this.placeHeld(h, at);
    if (h.kind === 'flask') h.f.tilt = tilt;
    return best ? { ...p, x: p.x + best } : p;
  }

  /**
   * Every arm out of the back wall, with what it holds up: each tool's, and those of the flasks, scales and hoses'
   * nozzles left in the air; but none for what's in hand, nor for a nozzle snapped onto an instrument's tube.
   */
  private arms(): Frame['arms'] {
    const out: { at: Vec3; of: Pick }[] = [];
    const held = this.heldObject();
    const riders = this.standing();
    const following = new Set(this.held?.follow?.map((f) => f.hose));
    for (const f of this.flasks)
      if (f !== held && !riders.has(f) && f.pose.y - FLASK_H > LIFT + 0.5) out.push({ at: flaskArm(f), of: { kind: 'flask', f } });
    for (const t of this.tools) if (t !== held) for (const at of toolArms(t)) out.push({ at, of: { kind: 'tool', t, part: 'body', k: 0 } });
    for (const sc of this.scales)
      if (sc !== held && sc.pose.y - SCALE_SHAPE.body.y1 > LIFT + 0.5) out.push({ at: scaleArm(sc), of: { kind: 'scale', sc, part: 'body' } });
    for (const h of this.hoses)
      if (h !== held && !following.has(h) && !isDocked(h, this.tools)) out.push({ at: nozzleArm(h), of: { kind: 'hose', h } });
    return out;
  }

  /**
   * Guides for lining up what's held (see aims), shown only while something's held where it could be left, since
   * that's when things are being lined up: gray from a held flask's lip, tipped as it would be to pour, to where it
   * would pour; and green wherever fluid would land in a mouth with it left where it is. Each ends at the vessel
   * that would take the fluid, which flashes green.
   */
  private guides(pl: Placed | null): Frame['guides'] {
    const h = this.held;
    if (!h || !pl?.rest) return [];
    return this.aims(h, this.mouths()).map((a) => {
      const { x, y, z, hx, hz, yaw = 0 } = a.m;
      const look: GuideLook = a.held === 'lip' ? 'solid' : 'snap';
      return { from: a.from, toY: y, look, mouth: { x, y, z, hx, hz, yaw }, v: a.m.v };
    });
  }

  private render(dt: number): void {
    // each falls to where it lands, past what's in hand if that doesn't catch it yet (see catching)
    const mouths = this.catch;
    const streams: Frame['streams'][number][] = [];
    for (const t of this.tools)
      t.out.forEach((out, k) => {
        if (!out || !t.streaming[k]) return;
        const sp = this.outletAt(t, k);
        const into = this.trails({ tool: t, spout: k }) ? this.open : mouths;
        streams.push({ from: sp, toY: this.loose(t, k) ? groundAt(sp.x, sp.z) : this.landsAt(sp, into), fluid: out, flow: t.flow[k] });
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
    const pl = this.placed;
    // each hose from its spout or faucet to its nozzle, with what's running through it
    const hoses = this.hoses.map((hose) => {
      const on = hose.on;
      const fluid = 'tool' in on ? on.tool.out[on.spout] : (this.faucetFlows.find((f) => f.fa === this.faucets[on.faucet])?.fa.output ?? null);
      return { h: hose, from: this.mountAt(on), fluid };
    });
    this.view.render({
      cam: this.cam,
      flasks: this.flasks, tools: this.tools, scales: this.scales, hoses, faucets: this.faucets, stock: this.stock,
      streams, drops,
      tarePress: this.tarePress, hot: this.hot(), bad: !!h && !pl?.rest && !this.intoCabinet(), dt, clock: this.clock,
      energies: BOND_KEYS.map((k) => this.chem.params.bonds[k].E), alarmsOff: this.alarmsOff, blindsShut: this.blindsShut, spin: this.spin,
      airlock: this.airlockLook(),
      guides: this.guides(pl), arms: this.arms(),
    });
  }

  /**
   * What's outlined: what's held, or with empty hands, what the pointer is on; but the whole equipment cabinet while
   * what's held would go into it, nothing for the cabinet itself otherwise, and the airlock's doorway only while its
   * doors stand open.
   */
  private hot(): Pick | null {
    const h = this.held;
    if (h) {
      if (this.intoCabinet()) return { kind: 'cabinet' };
      if (h.kind === 'flask') return { kind: 'flask', f: h.f };
      if (h.kind === 'tool') return { kind: 'tool', t: h.t, part: 'body', k: 0 };
      if (h.kind === 'scale') return { kind: 'scale', sc: h.sc, part: 'body' };
      return { kind: 'hose', h: h.h };
    }
    const p = this.target;
    if (this.glide || p?.kind === 'cabinet' || (p?.kind === 'airlock' && this.wake !== 'open')) return null;
    return p;
  }

  /** The vessel the info panel would show, in god mode: what's held, if it's a flask, or else the flask or tank pointed at. */
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
    const at = this.pointer;
    const f = at && this.god ? this.inspectTarget() : null;
    if (!f || !at) {
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
      // beside the pointer
      x0: at.x - 40, x1: at.x + 40, y: at.y - 30, stageW: this.viewW, stageH: this.viewH,
    });
  }

  /** Everything the player can do just now besides moving the view (see Hud.actions). */
  private actions(): Action[] {
    const out: Action[] = [];
    const add = (keys: string[], does: string, off = false) => out.push(off ? { keys, does, off } : { keys, does });
    // turning a valve goes on until the button's let go
    if (this.turning) {
      add(['Mouse'], 'point the lever');
      add(['LMB'], 'let go when it’s set');
      return out;
    }
    // and an equipment wheel is open until its key's let go
    if (this.wheel) {
      add(['Mouse'], 'point at what to take');
      add([WHEEL_KEYS[this.wheel.which]], 'let go to take it');
      return out;
    }
    const p = this.target;
    const h = this.held;
    if (inPod(this.wake) || this.previewing) {
      if (this.wake === 'pod') add(['LMB'], 'OK', p?.kind !== 'wake');
      add(['/'], 'hide this list');
      return out;
    }
    const walking = this.mode === 'walk';
    // in the walk mode, nothing's done with the mouse free, but capturing it
    if (walking && !this.locked) {
      add(['LMB'], 'look around');
      add(['/'], 'hide this list');
      return out;
    }
    const view = () => {
      if (walking) {
        add(['WASD'], 'walk');
        add(['Esc'], 'let go of the mouse');
        return;
      }
      add(['WASD'], 'move the view');
      add(['Wheel'], 'move nearer or further');
    };
    if (this.facing === 'away') {
      if (p?.kind === 'alarm') add(['LMB'], this.alarmsOff ? 'let the alarms sound again' : 'silence the alarms');
      if (p?.kind === 'blinds') add(['LMB'], this.blindsShut ? 'open the blinds' : 'shut the blinds');
      if (this.wake === 'open') add(p?.kind === 'airlock' ? ['LMB'] : ['P'], 'get into the cryopod');
      add(['Space'], 'turn back to the bench');
      view();
      add(['/'], 'hide this list');
      return out;
    }
    if (h) {
      const ok = !!this.placed?.rest;
      const how = h.kind === 'hose' ? 'leave the hose’s end here' : 'leave it here';
      // a button pointed at takes the click
      if (this.intoCabinet()) add(['LMB'], 'put it in the cabinet');
      else if (!this.onButton()) add(['LMB'], ok ? how : `${how}: ${(this.placed?.why ?? 'no room').toLowerCase()}`, !ok);
      if (this.rightWouldDo()) add(['RMB'], h.kind === 'flask' ? 'hold to pour' : 'hold to let it flow');
      if (h.kind === 'hose') add(['Backspace'], 'roll the hose back up');
      else if (!(h.kind === 'tool' && UNIQUE_TOOLS.includes(h.t.kind))) add(['Backspace'], 'put it back in the cabinet');
      add(['Q'], !h.from ? (h.kind === 'hose' ? 'roll the hose back up' : 'put it back in the cabinet') : 'put it back');
    } else {
      if (this.valveGrabbed()) {
        // (a captured mouse doesn't drag: the button's held as the player looks round)
        if (walking) add(['LMB', 'Mouse'], 'hold and look to turn the valve');
        else add(['Drag'], 'turn the valve');
      }
      add([WHEEL_KEYS.join(', ')], 'hold to grab equipment');
    }
    if (this.pressable()) add(['LMB'], 'press it');
    const m = h || this.valveGrabbed() ? null : this.mountAimed();
    if (m) add(['LMB'], this.hoseOn(m) ? 'take hold of its hose' : 'pull out its hose');
    else if (!h && p?.kind === 'hose') add(['LMB'], 'take hold of it');
    else if (!h && p && this.grabbable(p) && !this.onButton()) {
      add(['LMB'], 'pick it up');
      if (this.hooked(p)) add(['Shift', 'LMB'], 'pick it up still hooked up');
    }
    const id = this.targetNote();
    if (id) add(['Enter'], this.god && /^(f\d+|t\d+\.\d+)$/.test(id) ? 'edit it (god mode)' : 'write a note about it');
    if (this.canNap()) add(['N'], 'nap');
    if (this.wake === 'open' && !h) add(['P'], 'get into the cryopod');
    if (!h && this.history.canUndo) add([MOD, 'Z'], 'undo');
    if (!h && this.history.canRedo) add([MOD, 'Shift', 'Z'], 'redo');
    view();
    if (!h && this.mode !== 'flat' && !walking) add(['Space'], 'look behind you');
    add(['/'], 'hide this list');
    return out;
  }

  private setAlarmsOff(off: boolean): void {
    this.alarmsOff = off;
    hushAlarms(off);
  }

  /** Whether the pointer is on a key or button, which takes the left button's click even with something in hand. */
  private onButton(): boolean {
    const p = this.target;
    return (
      (p?.kind === 'scale' && p.part === 'tare') ||
      p?.kind === 'alarm' || p?.kind === 'blinds' || p?.kind === 'wake' || (p?.kind === 'airlock' && this.wake === 'open')
    );
  }

  /** Whether the left button would press the key or button the pointer is on. */
  private pressable(): boolean {
    return this.onButton();
  }

  /** Whether `p` can be picked up: anything but what's fixed in place. */
  private grabbable(p: Pick): boolean {
    return (
      p.kind !== 'faucet' && p.kind !== 'alarm' && p.kind !== 'blinds' && p.kind !== 'wake' && p.kind !== 'cabinet' && p.kind !== 'airlock' &&
      !(p.kind === 'tool' && p.t.shape.fixed)
    );
  }

  /**
   * Show the cursor that says what the left button would do where the pointer is: a pointing hand on a button, an
   * open hand on what can be picked up, pulled out or turned, a closed one while something's held, turned or
   * dragged, none while an equipment wheel is open, and the plain arrow otherwise.
   */
  private cursor(): void {
    const p = this.target;
    const busy = !!this.glide || this.dozing() || !!this.previewing;
    const want =
      busy ? 'default'
      // the wheel has a pointer of its own
      : this.wheel ? 'none'
      : this.held || this.turning || this.panning ? 'grabbing'
      : this.onButton() ? 'pointer'
      : inPod(this.wake) || this.facing !== 'bench' ? 'default'
      : this.mountAimed() || (p && this.grabbable(p)) ? 'grab'
      : 'default';
    if (want === this.cursorNow) return;
    this.cursorNow = want;
    if (this.canvas.style) this.canvas.style.cursor = want;
  }

  /* ---------------- waking in the airlock ---------------- */

  /**
   * Put the player in the cryopod in the airlock, facing the lab through its open doors, with the message on the
   * inside of its door: the intro's last part, the first time and on a replay. Nothing can be done until they press
   * OK (see pressOk). Whatever they held is left where it is if it can be, or else put away.
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

  /** Put the view in the pod, facing the lab, empty-handed (see emptyHanded); it goes back to where it was at the bench. */
  private intoPod(): void {
    this.emptyHanded();
    this.leaveBench();
    // (the flat view has no pod to see out of: it shows the pod's message over the bench)
    if (this.mode !== 'flat') this.cam = { ...POD_VIEW };
    this.facing = 'pod';
    this.glide = null;
  }

  /** The view is leaving the bench for the pod: remember where it was there, to go back to. */
  private leaveBench(): void {
    if (this.facing === 'bench' && !this.glide) this.bench = { ...this.at };
  }

  /** Leave the player empty-handed: whatever they held is left where it is if it can be, or else put away. */
  private emptyHanded(): void {
    if (this.held) this.release();
    if (this.held && !(this.held.kind === 'tool' && UNIQUE_TOOLS.includes(this.held.t.kind))) this.putAway();
    this.held = null;
    this.endTurn();
    this.rightHeld = false;
    this.press = this.panning = this.wheel = null;
  }

  /**
   * P, or a click on the airlock's doorway: get into the cryopod, while the airlock stands open. The view glides back
   * across the lab and into the pod, turning to face out if it was turned round, over SETTLE_S real seconds (it's the
   * player's own movement); then the pod closes on them, and they fall asleep (see Wake).
   */
  board(): void {
    if (this.wake !== 'open' || this.glide || this.dozing() || this.previewing) return;
    this.emptyHanded();
    this.leaveBench();
    this.wake = 'settling';
    this.wakeT = 0;
    // the flat view has no pod to glide into: its door shuts at once
    if (this.mode === 'flat') this.wake = 'boarding';
    else this.glide = { from: this.standIn(this.cam), to: { ...POD_VIEW }, t: 0, s: SETTLE_S, door: true };
    this.facing = 'pod';
  }

  /**
   * The pod's door has swung open: the view glides out of it and across the lab to the bench, where it was last; in
   * the walk mode, to where the player first stands (see WALK_START).
   */
  private emerge(): void {
    const from = { ...this.cam };
    // in the walk mode, to just outside the airlock's doorway, from where they walk
    if (this.mode === 'walk') this.player = { ...WALK_START };
    this.toBench();
    if (this.mode === 'flat') return;
    this.glide = { from, to: this.standIn(this.cam), t: 0, s: EMERGE_S, door: true };
    // (it's still in the pod until the glide moves it)
    this.cam = from;
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
      this.napKnown && !this.napping && !inPod(this.wake) && !this.previewing && !this.held && !this.turning && !this.glide &&
      this.station().swap === null
    );
  }

  /**
   * N: nap at the bench. Their eyes close, over NAP_S.close real seconds (it's their own doing, like
   * carrying), and then the lab runs on as fast as it can, as while they sleep in the pod (see fallAsleep), whether or
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
   * the view is back at the bench, where it was, with the airlock's doors shut.
   */
  continueTinkering(): void {
    if (this.wake !== 'arrived') return;
    this.arrival = false;
    this.wake = 'closed';
    this.wakeT = Infinity;
    this.toBench();
  }

  /** OK, on the message inside the pod: it flickers out, the pod's door swings open, and the view glides out to the bench. */
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
    else if (this.wake === 'opening' && t >= WAKE_S.open) {
      next('out');
      this.emerge();
    }
    else if (this.wake === 'arriving' && t >= WAKE_S.arrive) next('arrived');
    else if (this.wake === 'boarding' && t >= WAKE_S.open + WAKE_S.fade) next('asleep');
    else if (this.wake === 'out' && outOfAirlock(this.cam.z)) next('closed');
    // steady delivery of cryostabilizer opens the doors again, and once it stops they close
    else if (this.wake === 'closed' && this.station().supply.airlock && this.station().steady >= DELIVERY.streak) next('open');
    else if (this.wake === 'open' && this.station().steady === 0) next('closed');
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
   * looks. The view is from in the pod, facing out; the pod's door stands as far open as ARRIVAL.open says. The lab
   * runs on as ever, unseen.
   */
  previewArrival(on: boolean): void {
    // (the flat view has no pod to see it from)
    if (on === !!this.previewing || (on && (inPod(this.wake) || this.glide || this.mode === 'flat'))) return;
    if (on) {
      this.emptyHanded();
      this.previewing = { cam: { ...this.cam }, facing: this.facing };
      this.cam = { ...POD_VIEW };
      this.facing = 'pod';
    } else if (this.previewing) {
      ({ cam: this.cam, facing: this.facing } = this.previewing);
      this.previewing = null;
    }
  }

  /** Whether the right button would do something now (see Hud.right). */
  private rightWouldDo(): boolean {
    if (this.rightHeld || this.facing !== 'bench') return false;
    const h = this.held;
    if (h?.kind === 'flask') return h.f.N > TRACE;
    // a faucet always runs
    if (h?.kind === 'hose') return 'tool' in h.h.on ? this.wouldFlow(h.h.on.tool) : true;
    // a held tool runs anyway
    if (h) return false;
    return !!this.valveAimed();
  }

  /**
   * What each dipper's foot is in (see footAt and dippedIn), from where it is now, held or left; it doesn't change
   * much in a frame. One left somewhere is in whatever fluid its foot is in. One in hand is carried through
   * everything, so it counts as in a vessel's fluid only if it went down into that vessel through its mouth (see
   * heldDip). A thermometer's bulb reads what it's in. A wicking strip's paper takes a spot as its foot comes into a
   * fluid, and drinks it while it's left standing in it, or once it's been held dipped DIP_SOAK real seconds (`dt`,
   * as the player's own movements go), so a quick touch only spots it (see Tool.dipIn).
   */
  private dipping(dt: number): void {
    const h = this.held;
    let dipped = false;
    for (const t of this.tools) {
      if (!isDipper(t.kind)) continue;
      const held = h?.kind === 'tool' && h.t === t;
      const d = held ? this.heldDip(t) : dippedIn(footAt(t), this.flasks, this.tools);
      if (isThermometer(t.kind)) {
        t.bath = d?.v ?? null;
        continue;
      }
      if (held && d) {
        dipped = true;
        this.dipFor += dt;
      }
      // one touched to a fluid by hand takes its spot as deep as one dipped in it would be
      t.dipIn(d?.v ?? null, !held || this.dipFor > DIP_SOAK, d && held ? Math.max(d.depth, dipUnder(t.kind)) : d?.depth);
    }
    if (!dipped) this.dipFor = 0;
  }

  /**
   * The vessel whose fluid the held dipper's foot is in, and how far under its surface, if it's in one by rights: it
   * goes into a vessel only by its foot coming down through the vessel's mouth, and it's in it until its foot leaves
   * the vessel's inside. So carrying it across the bench, through flasks and tanks, touches nothing.
   */
  private heldDip(t: Tool): { v: Vessel; depth: number } | null {
    const foot = footAt(t);
    const was = this.lastFoot ?? foot;
    this.lastFoot = foot;
    for (const m of this.open) {
      if (was.y < m.y || foot.y >= m.y) continue;
      const across = was.x + ((foot.x - was.x) * (was.y - m.y)) / (was.y - foot.y);
      if (Math.abs(across - m.x) <= m.hx) this.entered = m.v;
    }
    if (this.entered && insideVessel(foot, this.flasks, this.tools) !== this.entered) this.entered = null;
    if (!this.entered) return null;
    const d = dippedIn(foot, this.flasks, this.tools);
    return d && d.v === this.entered ? d : null;
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
    const h = this.held;
    const hud: Hud = {
      inPod: inPod(this.wake),
      holding: !!this.held,
      drop: !!this.placed?.rest,
      right: this.rightWouldDo(),
      label: !inPod(this.wake) && !!this.targetNote(),
      hand: h?.kind === 'hose' ? 'Flow' : 'Pour',
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
        cx: this.wheel.cx,
        cy: this.wheel.cy,
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
      away: this.facing === 'away',
      pod: this.wake === 'open',
      cross: this.mode === 'walk' && this.locked && !inPod(this.wake) && !this.previewing && !this.wheel,
      capture: this.mode === 'walk' && !this.locked && !inPod(this.wake) && !this.previewing,
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
