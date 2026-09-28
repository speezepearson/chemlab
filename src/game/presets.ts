import type { Atom } from '../chem/atoms';
import { T_ROOM } from '../chem/params';
import { SPECIES, TARGET, singleOf } from '../chem/species';
import { CAP } from './config';
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
  /** Top center of the tool, as fractions of the stage's width and height. */
  at: [number, number];
  /** Per tank, 0 (closed) to 1 (fully open); closed if left out. */
  valves?: number[];
  /** Starting contents of each tank, in the order the tool's shape lists them. */
  tanks?: (FlaskFill | null)[];
}

/** A starting layout: one entry per shelf slot (null for an empty flask), plus any tools. */
export interface Preset {
  id: string;
  name: string;
  /** Shown under the title bar while the preset is loaded. */
  description: string;
  flasks: (FlaskFill | null)[];
  tools?: ToolSpec[];
  /** Top center of each scale's platform, as fractions of the stage's width and height. */
  scales?: [number, number][];
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
    description:
      "You're stranded. The supply flask holds the last of your nutrient slurry. Drag a flask under a faucet or " +
      'spout to fill it, over a flask or tank to pour, onto the scale to weigh it, or down to the sink to dump it. ' +
      'Drag tools anywhere, and right-click-drag a tool to turn its valve.',
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
      'mixing: the red comes out cool and the green hot. Slower flows trade more. Right-click-drag a valve to turn it.',
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
