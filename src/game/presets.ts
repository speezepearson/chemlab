import type { Atom } from '../chem/atoms';
import { T_ROOM } from '../chem/params';
import { SPECIES, TARGET, singleOf } from '../chem/species';
import type { Flask } from './flask';

/** Starting contents of one shelf slot. */
export interface FlaskFill {
  /** Molecule counts by species index. */
  contents: { species: number; molecules: number }[];
  T: number;
  label?: string;
}

/** A starting layout for the shelf: one entry per slot, null for an empty flask. */
export interface Preset {
  id: string;
  name: string;
  /** Shown under the title bar while the preset is loaded. */
  description: string;
  flasks: (FlaskFill | null)[];
}

const freeAtoms = (atom: Atom, count: number) => ({ species: singleOf(atom), molecules: count });

const SHOWCASE: [Atom, number][] = [
  ['R', 0], ['G', 0.2], ['B', 0.5], ['Y', 1], ['C', 3], ['M', 10], ['R', 30], ['G', 100],
];

export const PRESETS: readonly Preset[] = [
  {
    id: 'stranded',
    name: 'Stranded',
    description:
      "You're stranded. The supply flask holds the last of your nutrient slurry. Drag a flask under a faucet to " +
      'fill it, over another flask to pour, or over the sink to dump it.',
    flasks: [{ contents: [{ species: TARGET, molecules: 40 }], T: T_ROOM, label: 'supply' }],
  },
  {
    id: 'temperatures',
    name: 'Temperature range',
    description: 'How temperature looks: flasks from T = 0 (black) to T = 100 (blinding).',
    flasks: SHOWCASE.map(([atom, T]) => ({ contents: [freeAtoms(atom, 200)], T, label: `T=${T}` })),
  },
];

export const DEFAULT_PRESET = PRESETS[0];

/** Atoms a fill puts in its flask. */
export function fillAtoms(fill: FlaskFill): number {
  return fill.contents.reduce((t, c) => t + c.molecules * SPECIES[c.species].size, 0);
}

/** Replace a flask's contents with a fill (or empty it). */
export function applyFill(f: Flask, fill: FlaskFill | null): void {
  f.n.fill(0);
  f.N = 0;
  f.T = fill?.T ?? T_ROOM;
  f.label = fill?.label ?? '';
  if (!fill) return;
  for (const { species, molecules } of fill.contents) f.n[species] += molecules;
  f.N = fillAtoms(fill);
}
