import { T_ROOM } from '../chem/params';
import { SPECIES, TARGET } from '../chem/species';
import type { Vessel } from './flask';
import { LAMP_AREA, LAMP_Z, LIFT, ROOM, type Pose } from './space';
import type { SaveState } from './save';
import { START_LAB } from './start';
import { CRYOSTABILIZER } from './supply';
import { LAMP, STATION, type ToolKind } from './tools';

/** Starting contents of one shelf slot. */
export interface FlaskFill {
  /** Molecule counts by species index. */
  contents: { species: number; molecules: number }[];
  T: number;
  label?: string;
}

/**
 * Where a tool stands: its top center, as fractions of the home area's width and height (see HOME_W); how far out
 * from the back wall, if not Z_HOME; and which way it faces (see Pose), if not out from the back wall.
 */
export interface Spot {
  at: [number, number];
  z?: number;
  yaw?: number;
}

/**
 * Where the one and only spectroscope goes in a lab that hasn't one (an older save, the bench's scenes, the tests'
 * empty lab): there's always exactly one. It stands over the back counter, its spout high enough for a flask under it,
 * and over the middle of a cell (see CELL).
 */
export const SPECTROSCOPE_AT: Spot = { at: [1.47, 0.5] };

/**
 * Where the station is (see STATION in tools.ts): built into the right wall, past the faucets, facing
 * into the room, its funnel and spouts out over the counter in line with the faucets, and its
 * spouts high enough for a flask under them. Every lab has it, always here.
 */
export const STATION_POSE: Pose = { x: ROOM.x1 - STATION.out, y: STATION.top, z: STATION.along, yaw: -Math.PI / 2 };

/**
 * Where the shadow lamp is (see LAMP in tools.ts): on its own bench in the front left corner, along its edge toward
 * the room, its top LAMP.h above the bench and its front to the room. Its channel runs along the bench's second row of
 * cells from the room (see LAMP_Z), so it can be reached into and seen down into from there (its near wall stands on
 * the bench, a little in from its edge); its enclosure is at the bench's end away from the left wall, and it shines
 * along the bench toward that wall, at its end wall, two cells short of it. Every lab has it, always here.
 */
export const LAMP_POSE: Pose = { x: LAMP_AREA.x1 + LAMP.box.x0, y: LIFT + LAMP.h, z: LAMP_Z, yaw: Math.PI };

/**
 * What the cryostabilizer's reservoir starts with: the hundred flasks of the target left on board (see VOYAGE). It's
 * what a save from before the station was a funnel over a diverter gets, if it had no reservoir (see oldStation).
 */
export const REFERENCE_FILL: FlaskFill = { contents: [{ species: TARGET, molecules: CRYOSTABILIZER.start }], T: T_ROOM };

/** A tool on the bench at the start. */
export interface ToolSpec extends Spot {
  kind: ToolKind;
  /** Its built-in valves (see ToolShape.valves), from 0 to 1; each at 0, or a selector at half, if left out. */
  valves?: number[];
  /**
   * Per spout, the stopcock fitted at its tip, set from 0 (shut) to 1 (fully open), or null for none; as it comes out
   * of the cabinet (see ToolShape.fitted), if left out.
   */
  cocks?: (number | null)[];
  /** Starting contents of each tank, in the order the tool's shape lists them. */
  tanks?: (FlaskFill | null)[];
}

/**
 * A hose on the bench at the start, pulled out of one tool's spout with its nozzle over one of a tool's tanks (the
 * same tool's, to loop it back on itself). Tools are indexed in the preset's list.
 */
export interface HoseSpec {
  from: { tool: number; spout: number };
  /** `up` is how far above the tank's mouth the nozzle is, if not 24: two over one tank go at different heights. */
  to: { tool: number; tank?: number; up?: number };
}

/**
 * A starting layout: one entry per shelf slot (null for an empty flask), plus any tools; or a whole lab (see lab). The
 * game has only the one (DEFAULT_PRESET); the others are the bench's scenes and the tests' empty lab.
 */
export interface Preset {
  id: string;
  name: string;
  flasks: (FlaskFill | null)[];
  tools?: ToolSpec[];
  /** Top center of each scale's platform, as fractions of the home area's width and height (see HOME_W). */
  scales?: [number, number][];
  hoses?: HoseSpec[];
  /**
   * The whole lab, laid out as a save keeps it, if the preset is one, in place of its flasks, tools, scales and hoses:
   * everything in it is as the save has it (see GameEngine.restore) but the chemistry, the player, and the alarms,
   * blinds and nap, which a preset leaves alone.
   */
  lab?: SaveState;
}

/**
 * The game: the one preset there is, which a new game starts in and Reset goes back to, the lab laid out as in
 * START_LAB (see start.ts).
 */
export const DEFAULT_PRESET: Preset = { id: 'stranded', name: 'Stranded', flasks: [], lab: START_LAB };

/** Replace a vessel's contents with a fill (or empty it). */
export function applyFill(f: Vessel, fill: FlaskFill | null): void {
  f.n.fill(0);
  f.N = 0;
  f.Q = 0;
  f.label = fill?.label ?? '';
  if (!fill) return;
  for (const { species, molecules } of fill.contents) {
    const m = Math.round(molecules); // whole molecules only
    f.n[species] += m;
    f.N += m * SPECIES[species].size;
  }
  f.setTemperature(fill.T);
}
