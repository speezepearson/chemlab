import {
  ATOMS, ATOM_RGB, BIT_PAIRS, GROUP, bitOf, pairKey, popcount3,
  type Atom, type Group,
} from './atoms';
import type { ChemParams } from './params';

/** One slot per group; null = no atom from that group. */
export type Slots = readonly (Atom | null)[];

export interface Species {
  i: number;
  atoms: Slots;
  /** Bond bitmask, see BIT_PAIRS. */
  mask: number;
  size: number;
  key: string;
  name: string;
  color: string;
  /** Indices into ATOMS of each atom present. */
  atomIdx: number[];
}

export function keyOf(atoms: Slots, mask: number): string {
  return atoms.map((a) => a ?? '.').join('') + '|' + mask;
}

function nameOf(atoms: Slots, mask: number): string {
  const list = atoms.filter((a): a is Atom => a !== null);
  if (list.length === 1) return list[0];
  if (list.length === 2) return list[0] + '–' + list[1];
  if (mask === 7) return '△' + list.join('');
  const bonds = BIT_PAIRS.filter((_, k) => mask & (1 << k));
  const mid = bonds[0].find((g) => bonds[1].includes(g))!;
  const ends = ([0, 1, 2] as const).filter((g) => g !== mid);
  return atoms[ends[0]] + '–' + atoms[mid] + '–' + atoms[ends[1]];
}

function enumerate(): Species[] {
  const out: Species[] = [];
  for (const a0 of [null, 'R', 'C'] as const)
    for (const a1 of [null, 'G', 'M'] as const)
      for (const a2 of [null, 'B', 'Y'] as const) {
        const atoms: Slots = [a0, a1, a2];
        const list = atoms.filter((a): a is Atom => a !== null);
        const size = list.length;
        if (!size) continue;
        let allowed = 0;
        BIT_PAIRS.forEach(([g1, g2], k) => {
          if (atoms[g1] && atoms[g2]) allowed |= 1 << k;
        });
        for (let mask = 0; mask < 8; mask++) {
          if (mask & ~allowed) continue;
          const pc = popcount3(mask);
          // molecules must be connected
          if (size === 1 && mask !== 0) continue;
          if (size === 2 && pc !== 1) continue;
          if (size === 3 && pc < 2) continue;
          const col = [0, 0, 0];
          for (const a of list) for (let c = 0; c < 3; c++) col[c] += ATOM_RGB[a][c] / size;
          out.push({
            i: out.length,
            atoms,
            mask,
            size,
            key: keyOf(atoms, mask),
            name: nameOf(atoms, mask),
            color: `rgb(${col.map(Math.round).join(',')})`,
            atomIdx: list.map((a) => ATOMS.indexOf(a)),
          });
        }
      }
  return out;
}

/** All 50 species: 6 singles, 12 pairs, 8 color-triples × 4 connected shapes. */
export const SPECIES: readonly Species[] = enumerate();
export const NS = SPECIES.length;

const INDEX = new Map(SPECIES.map((s) => [s.key, s.i]));

export function speciesIndex(atoms: Slots, mask: number): number {
  const i = INDEX.get(keyOf(atoms, mask));
  if (i === undefined) throw new Error(`no species ${keyOf(atoms, mask)}`);
  return i;
}

function slotsFor(atom: Atom): Slots {
  const g = GROUP[atom];
  return [0, 1, 2].map((k) => (k === g ? atom : null));
}

/** SINGLE[ATOMS.indexOf(a)] is the species index of the free atom a. */
export const SINGLE: readonly number[] = ATOMS.map((a) => speciesIndex(slotsFor(a), 0));
export function singleOf(atom: Atom): number {
  return SINGLE[ATOMS.indexOf(atom)];
}

/** The species of a and b bonded to each other (they must be from different groups). */
export function pairOf(a: Atom, b: Atom): number {
  const slots = ([0, 1, 2] as const).map((g) => (g === GROUP[a] ? a : g === GROUP[b] ? b : null));
  return speciesIndex(slots, bitOf(GROUP[a], GROUP[b]));
}

/** The target: the R–G–B triangle. */
export const TARGET = speciesIndex(['R', 'G', 'B'], 7);

export function bondParam(p: ChemParams, a: Atom, b: Atom) {
  return p.bonds[pairKey(a, b)];
}

/** Species energies U = -(sum of bond energies). */
export function speciesEnergies(p: ChemParams, out = new Float64Array(NS)): Float64Array {
  for (const sp of SPECIES) {
    let U = 0;
    BIT_PAIRS.forEach(([g1, g2]: readonly [Group, Group], k) => {
      if (sp.mask & (1 << k)) U -= bondParam(p, sp.atoms[g1]!, sp.atoms[g2]!).E;
    });
    out[sp.i] = U;
  }
  return out;
}
