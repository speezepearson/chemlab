import { type Atom } from '../chem/atoms';
import { T_ROOM } from '../chem/params';
import { SPECIES, TARGET, singleOf } from '../chem/species';
import { CAP } from './config';
import type { Vessel } from './flask';
import { CELL, ROOM, type Pose } from './space';
import { REFERENCE_START, STATION, type ToolKind } from './tools';

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
 * Where the one and only composition analyzer starts, unless a preset places it itself: there's always exactly one. It
 * stands over the back counter, its spouts high enough for a flask under them.
 */
export const ANALYZER_AT: Spot = { at: [1.15, 0.5] };

/** Where the one and only spectroscope starts, the same way: past the composition analyzer. */
export const SPECTROSCOPE_AT: Spot = { at: [1.45, 0.5] };

/** Where the one and only bond visualizer starts, the same way: past the spectroscope. */
export const VISUALIZER_AT: Spot = { at: [1.75, 0.5] };

/**
 * Where the cryostabilizer station is (see STATION in tools.ts): built into the right wall, past the faucets, facing
 * into the room, its funnel and spouts over the middles of the cells of the counter's row nearest the wall, and its
 * spouts high enough for a flask under them. Every lab has it, always here.
 */
export const STATION_POSE: Pose = { x: ROOM.x1 - CELL / 2, y: STATION.top, z: 11.5 * CELL, yaw: -Math.PI / 2 };

/** What the ship's reservoir starts with: the hundred flasks of the target left on board (see VOYAGE). */
export const REFERENCE_FILL: FlaskFill = { contents: [{ species: TARGET, molecules: REFERENCE_START }], T: T_ROOM };

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
  ['R', 0], ['G', 0.2], ['B', 0.5], ['Y', 1], ['C', 3], ['M', 10], ['R', 30], ['G', 100],
];

export const PRESETS: readonly Preset[] = [
  {
    id: 'stranded',
    name: 'Stranded',
    flasks: [],
    tools: [
      { kind: 'separator', at: [0.25, 0.3] },
      { kind: 'dispenser', at: [0.55, 0.3] },
      // its tanks half a grid cell either side of its middle
      { kind: 'exchanger', at: [0.7, 0.3] },
    ],
    // its two places for flasks half a grid cell either side of its middle
    scales: [[1.4, 0.62]],
  },
  {
    id: 'exchanger',
    name: 'Heat exchanger demo',
    description:
      'Hot red and room-temperature green pass each other in a counterflow heat exchanger, trading heat but not ' +
      'mixing: the red comes out cool and the green hot. Slower flows trade more. Look at a valve and hold the right button: point up to open it, right to close it.',
    flasks: [],
    tools: [
      // over the exchanger's two tanks, half a grid cell either side of its middle
      { kind: 'dispenser', at: [0.65, 0.22], valves: [0.25], tanks: [{ contents: [atomsOf(singleOf('R'), 4 * CAP)], T: 10 }] },
      { kind: 'dispenser', at: [0.75, 0.22], valves: [0.25], tanks: [{ contents: [atomsOf(singleOf('G'), 4 * CAP)], T: T_ROOM }] },
      { kind: 'exchanger', at: [0.7, 0.48], valves: [0.25, 0.25] },
    ],
  },
  {
    id: 'separator',
    name: 'Separator demo',
    description:
      'A separator sorts red from cyan: each molecule goes out the spout for its mix of primary and secondary ' +
      'atoms, all primary at the far left and all secondary at the far right. The dispensers below catch the two ' +
      'ends. Turn its sharpness down in the Chemistry panel and some leaks into the spouts beside them.',
    flasks: [],
    tools: [
      {
        kind: 'separator', at: [0.35, 0.2], valves: [0.3],
        tanks: [{ contents: [atomsOf(singleOf('R'), 2 * CAP), atomsOf(singleOf('C'), 2 * CAP)], T: T_ROOM }],
      },
      // under its end spouts, two grid cells either side of its middle
      { kind: 'dispenser', at: [0.15, 0.5] },
      { kind: 'dispenser', at: [0.55, 0.5] },
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
