import { ATOMS, type Atom } from '../chem/atoms';
import { equilibrium } from '../chem/equilibrium';
import { T_ROOM, defaultChemParams } from '../chem/params';
import { SPECIES, TARGET, singleOf, speciesEnergies } from '../chem/species';
import { CAP, HOME_W } from './config';
import { FAUCETS } from './faucets';
import type { Vessel } from './flask';
import type { ToolKind } from './tools';

/** Starting contents of one shelf slot. */
export interface FlaskFill {
  /** Molecule counts by species index. */
  contents: { species: number; molecules: number }[];
  T: number;
  label?: string;
}

/** A tool on the bench at the start. */
export interface ToolSpec {
  kind: ToolKind;
  /** Top center of the tool, as fractions of the home area's width and height (see HOME_W). */
  at: [number, number];
  /** Per tank, 0 (closed) to 1 (fully open); closed if left out. */
  valves?: number[];
  /** Starting contents of each tank, in the order the tool's shape lists them. */
  tanks?: (FlaskFill | null)[];
}

/**
 * A hose on the bench at the start, running from just under one tool's spout to just above one of a
 * tool's tanks (the same tool's, to loop it back on itself). Tools are indexed in the preset's list.
 */
export interface HoseSpec {
  from: { tool: number; spout: number };
  /** `dx` shifts the outlet sideways from the tank's center, in the tool's local units. */
  to: { tool: number; tank?: number; dx?: number };
}

/** A starting layout: one entry per shelf slot (null for an empty flask), plus any tools. */
export interface Preset {
  id: string;
  name: string;
  /** Shown under the title bar while the preset is loaded. */
  description: string;
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
 * A mix of faucets left to settle at temperature T: faucet i's recipe weighted by `mix[i]` flasks,
 * at chemical equilibrium under the default chemistry.
 */
function settled(mix: Record<number, number>, T: number): { species: number; molecules: number }[] {
  const atoms = ATOMS.map((a) => Object.entries(mix).reduce((t, [i, fl]) => t + fl * (FAUCETS[+i].atoms[a] ?? 0), 0));
  const n = equilibrium(atoms, speciesEnergies(defaultChemParams()), T);
  return SPECIES.filter((s) => n[s.i] * CAP >= 1).map((s) => ({ species: s.i, molecules: n[s.i] * CAP }));
}

/** Where the wash route's separator stands; its feed and catch tanks are placed relative to it. */
const WASH_AT: [number, number] = [0.36, 0.4];
const WASH_T = 12;

/** The wash route's starting bench. route.test.ts runs the same thing without the UI. */
export const WASH_PRESET: Preset = {
  id: 'wash',
  name: 'Wash route (sandbox)',
  description:
    'Midway through the intended route, to tinker with: the separator holds △RGY (from ½ flask of the R–G faucet ' +
    'and 1½ of the hot C–Y one, settled at T = 1) plus 1½ flasks of blue, heated to T = 12. Its left spout is ' +
    'hosed back into its own tank, so each pass strips out yellow, and hot blue drips in from the tank above. ' +
    'Whatever goes right collects in the catch tank below. Picking this preset also restores the default chemistry.',
  flasks: [],
  tools: [
    {
      kind: 'separator', at: WASH_AT, valves: [0.02],
      tanks: [{ contents: [...settled({ 0: 0.5, 4: 1.5 }, 1), atomsOf(singleOf('B'), 1.5 * CAP)], T: WASH_T }],
    },
    {
      kind: 'dispenser', at: [WASH_AT[0], 0.14], valves: [0.003],
      tanks: [{ contents: [atomsOf(singleOf('B'), 4 * CAP)], T: WASH_T }],
    },
    // under the separator's right spout, 36 local units right of its center
    { kind: 'dispenser', at: [WASH_AT[0] + 36 / HOME_W, WASH_AT[1] + 0.25] },
  ],
  hoses: [{ from: { tool: 0, spout: 0 }, to: { tool: 0, dx: -20 } }],
  defaultChem: true,
};

const SHOWCASE: [Atom, number][] = [
  ['R', 0], ['G', 0.2], ['B', 0.5], ['Y', 1], ['C', 3], ['M', 10], ['R', 30], ['G', 100],
];

export const PRESETS: readonly Preset[] = [
  {
    id: 'stranded',
    name: 'Stranded',
    description:
      "You're stranded. The supply flask holds the last of your nutrient slurry. Drag a flask under a spout to fill it, " +
      'or onto the scale to weigh it. Hold the right button too while dragging to fill from a faucet, pour into a flask ' +
      'or tank, or dump in the sink. ' +
      'Drag tools anywhere, and right-click a tool and point up (open) or right (closed) to set its valve.',
    flasks: [{ contents: [atomsOf(TARGET, 0.4 * CAP)], T: T_ROOM, label: 'supply' }],
    tools: [
      { kind: 'separator', at: [0.1, 0.3] },
      { kind: 'dispenser', at: [0.3, 0.3] },
      { kind: 'exchanger', at: [0.62, 0.3] },
    ],
    scales: [[0.86, 0.62]],
  },
  {
    id: 'exchanger',
    name: 'Heat exchanger demo',
    description:
      'Hot red and room-temperature green pass each other in a counterflow heat exchanger, trading heat but not ' +
      'mixing: the red comes out cool and the green hot. Slower flows trade more. Right-click a valve and point up to open it, right to close it.',
    flasks: [],
    tools: [
      { kind: 'dispenser', at: [0.5625, 0.22], valves: [0.25], tanks: [{ contents: [atomsOf(singleOf('R'), 4 * CAP)], T: 10 }] },
      { kind: 'dispenser', at: [0.6545, 0.22], valves: [0.25], tanks: [{ contents: [atomsOf(singleOf('G'), 4 * CAP)], T: T_ROOM }] },
      { kind: 'exchanger', at: [0.5625 + 0.046, 0.48], valves: [0.25, 0.25] },
    ],
  },
  {
    id: 'separator',
    name: 'Separator demo',
    description:
      'A separator splits red and cyan into two dispensers below: each molecule leaves left : right as ' +
      'e^(primary atoms) : e^(secondary atoms). Pour a result back through for a purer cut.',
    flasks: [],
    tools: [
      {
        kind: 'separator', at: [0.3, 0.2], valves: [0.3],
        tanks: [{ contents: [atomsOf(singleOf('R'), 2 * CAP), atomsOf(singleOf('C'), 2 * CAP)], T: T_ROOM }],
      },
      { kind: 'dispenser', at: [0.3 - 0.047, 0.5] },
      { kind: 'dispenser', at: [0.3 + 0.047, 0.5] },
    ],
  },
  WASH_PRESET,
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
