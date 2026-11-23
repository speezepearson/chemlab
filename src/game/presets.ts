import { type Atom } from '../chem/atoms';
import { T_ROOM } from '../chem/params';
import { SPECIES, TARGET, singleOf } from '../chem/species';
import { CAP, HOME_W } from './config';
import { plumbZ } from './bodies';
import type { Vessel } from './flask';
import { CELL, LAMP_AREA, LAMP_Z, LIFT, ROOM, type Pose } from './space';
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
 * Where the one and only spectroscope starts, unless a preset places it itself: there's always exactly one. It stands
 * over the back counter, its spout high enough for a flask under it, and over the middle of a cell (see CELL), like
 * the presets' tools.
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
  /** Per tank, 0 (closed) to 1 (fully open); closed if left out. */
  valves?: number[];
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

/** A starting layout: one entry per shelf slot (null for an empty flask), plus any tools. */
export interface Preset {
  id: string;
  name: string;
  /** Shown under the title bar while the preset is loaded, if given. */
  description?: string;
  flasks: (FlaskFill | null)[];
  tools?: ToolSpec[];
  /** Top center of each scale's platform, as fractions of the home area's width and height (see HOME_W). */
  scales?: [number, number][];
  hoses?: HoseSpec[];
  /** Whether picking the preset from the menu restores the default chemistry. Reset leaves the chemistry alone. */
  defaultChem?: boolean;
}

/** `atoms` atoms' worth of one species. */
const atomsOf = (species: number, atoms: number) => ({ species, molecules: atoms / SPECIES[species].size });

/**
 * How far out from the back wall the demos' tools stand: over the first island, in the middle of its second row of
 * cells, so their stands behind them have its first (the back wall's end of the counter is the equipment cabinet's).
 */
const DEMO_Z = 11.5 * CELL;
/** The middle of the cell `k` cells from x = 0, across, as a fraction of the home area's width (see Spot). */
const cellX = (k: number) => ((k + 0.5) * CELL) / HOME_W;

const SHOWCASE: [Atom, number][] = [
  ['R', 0], ['G', 0.2], ['B', 0.5], ['K', 1], ['R', 3], ['G', 10], ['B', 30], ['K', 100],
];

export const PRESETS: readonly Preset[] = [
  {
    id: 'stranded',
    name: 'Stranded',
    // everything's in the equipment cabinet
    flasks: [],
  },
  {
    id: 'exchanger',
    name: 'Heat exchanger demo',
    description:
      'Hot red and room-temperature green pass each other in a counterflow heat exchanger, trading heat but not ' +
      'mixing: the red comes out cool and the green hot. Slower flows trade more. Look at a valve and hold the right button: point up to open it, right to close it.',
    flasks: [],
    tools: [
      // over the exchanger's two tanks, half a cell either side of its middle; it stands as far forward as their
      // spouts are in front of their middles (see plumbZ), so they're over its tanks' middles
      { kind: 'dispenser', at: [cellX(5), 0.22], z: DEMO_Z, valves: [0.25], tanks: [{ contents: [atomsOf(singleOf('R'), 4 * CAP)], T: 10 }] },
      { kind: 'dispenser', at: [cellX(6), 0.22], z: DEMO_Z, valves: [0.25], tanks: [{ contents: [atomsOf(singleOf('G'), 4 * CAP)], T: T_ROOM }] },
      { kind: 'exchanger', at: [cellX(5.5), 0.48], z: DEMO_Z + plumbZ('dispenser'), valves: [0.25, 0.25] },
    ],
  },
  {
    id: 'separator',
    name: 'Separator demo',
    description:
      'A separator sorts red from black: each molecule goes out the left spout if none of its atoms is black, ' +
      'and the right if any is. The dispensers below catch the two. Turn its sharpness down in the Chemistry ' +
      'panel and some of each leaks out the other spout.',
    flasks: [],
    tools: [
      {
        kind: 'separator', at: [cellX(5), 0.2], z: DEMO_Z, valves: [0.3],
        tanks: [{ contents: [atomsOf(singleOf('R'), 2 * CAP), atomsOf(singleOf('K'), 2 * CAP)], T: T_ROOM }],
      },
      // under its spouts, a cell either side of its middle, and as far forward as they are (see plumbZ)
      { kind: 'dispenser', at: [cellX(4), 0.5], z: DEMO_Z + plumbZ('separator') },
      { kind: 'dispenser', at: [cellX(6), 0.5], z: DEMO_Z + plumbZ('separator') },
    ],
  },
  {
    id: 'temperatures',
    name: 'Temperature range',
    description: 'How temperature looks: flasks from T = 0 (black) to T = 100 (blinding).',
    flasks: SHOWCASE.map(([atom, T]) => ({ contents: [atomsOf(singleOf(atom), (2 / 3) * CAP)], T, label: `T=${T}` })),
  },
];

export const DEFAULT_PRESET = PRESETS[0];

/** Atoms a fill puts in its flask. */
export function fillAtoms(fill: FlaskFill): number {
  return fill.contents.reduce((t, c) => t + c.molecules * SPECIES[c.species].size, 0);
}

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
