import { type Atom } from '../chem/atoms';
import { T_ROOM } from '../chem/params';
import { SPECIES, TARGET, singleOf } from '../chem/species';
import { CAP } from './config';
import type { Vessel } from './flask';
import { BENCH, CELL, LIFT, PLANE_Z, ROOM, WALL_PANEL, type Pose } from './space';
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
 * Where a tool hangs on the wall: its top center, as fractions of the old flat bench's home area (see fromFrac): a
 * thousand world units to the unit across, and 620 to the unit down.
 */
export interface Spot {
  at: [number, number];
}

/**
 * Where the one and only spectroscope starts, unless a preset places it itself: there's always exactly one. It
 * hangs over the counter, past the supply station and the shadow lamp, its spout high enough for a flask under it.
 */
export const SPECTROSCOPE_AT: Spot = { at: [2.86, 0.5] };

/**
 * Where the station is (see STATION in tools.ts): built into the back wall at the bench's left end, just past the
 * equipment cabinet and before the first row of faucets, its block lined up with the wall's panels (the first two
 * wholly past the cabinet: the tenth and eleventh from the wall's left end), its funnel and spouts out in the plane
 * everything else is in (see PLANE_Z), and its spouts high enough for a flask under them. Every lab has it, always
 * here.
 */
export const STATION_POSE: Pose = {
  x: ROOM.x0 + Math.ceil((BENCH.x0 - ROOM.x0) / WALL_PANEL.w) * WALL_PANEL.w - STATION.block.x0,
  y: STATION.top,
  z: PLANE_Z,
  yaw: 0,
};

/**
 * Where the station and the first row of faucets were before the station moved to the bench's left end: the faucets
 * first, from 200 along the bench, and the station past them, its block on the wall's thirteenth and fourteenth
 * panels. A save from then (one on the wall without `stationLeft`) is hooked up as it was there (see
 * GameEngine.keepOutlets).
 */
export const BEFORE_LEFT = {
  station: { ...STATION_POSE, x: ROOM.x0 + 12 * WALL_PANEL.w - STATION.block.x0 } as Pose,
  faucets: [0, 1, 2, 3, 4].map((i) => BENCH.x0 + (2 + i) * CELL),
};

/** Where a preset's flasks stand, along the counter: the first one's middle, across the wall; the rest follow a CELL apart. */
export const PRESET_FLASKS_X = 3600;

/**
 * Where the shadow lamp is (see LAMP in tools.ts): built into the back wall over the counter, past the supply station
 * where the composition analyzer used to hang, its frame's foot on the counter, so the foot of its pane, which the
 * light falls through, is level with the counter's top, and a flask stood on the counter in front of it is all in
 * its light. Every lab has it, always here.
 */
export const LAMP_POSE: Pose = { x: 2620, y: LIFT + LAMP.h, z: PLANE_Z, yaw: 0 };

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
      'mixing: the red comes out cool and the green hot. Slower flows trade more. Drag a valve’s lever: up to open it, right to close it.',
    flasks: [],
    tools: [
      // over the exchanger's two tanks, half of CELL either side of its middle
      { kind: 'dispenser', at: [3.95, 0.22], valves: [0.25], tanks: [{ contents: [atomsOf(singleOf('R'), 4 * CAP)], T: 10 }] },
      { kind: 'dispenser', at: [4.05, 0.22], valves: [0.25], tanks: [{ contents: [atomsOf(singleOf('G'), 4 * CAP)], T: T_ROOM }] },
      { kind: 'exchanger', at: [4, 0.48], valves: [0.25, 0.25] },
    ],
  },
  {
    id: 'separator',
    name: 'Separator demo',
    description:
      'A separator sorts red from black: each molecule goes out the spout for the share of its atoms that are ' +
      'black, none at the far left and all at the far right. The dispensers below catch the two ends. Turn its ' +
      'sharpness down in the Chemistry panel and some leaks into the spouts beside them.',
    flasks: [],
    tools: [
      {
        kind: 'separator', at: [4.1, 0.2], valves: [0.3],
        tanks: [{ contents: [atomsOf(singleOf('R'), 2 * CAP), atomsOf(singleOf('K'), 2 * CAP)], T: T_ROOM }],
      },
      // under its end spouts, twice CELL either side of its middle
      { kind: 'dispenser', at: [3.9, 0.5] },
      { kind: 'dispenser', at: [4.3, 0.5] },
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
