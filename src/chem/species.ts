import { ATOMS, ATOM_RGB, ATOM_WEIGHT, BONDS, BOND_KEYS, SOLVENT_INDEX, bondBit, type Atom } from './atoms';
import type { ChemParams } from './params';

export interface Species {
  i: number;
  /** Its atoms, one of each color it has, in ATOMS order. */
  atoms: readonly Atom[];
  /** Which colors it has: bit i for ATOMS[i]. */
  has: number;
  /** Bond bitmask, see BONDS. */
  mask: number;
  size: number;
  /** The sum of its atoms' weights (see ATOM_WEIGHT). */
  weight: number;
  key: string;
  name: string;
  color: string;
  /** Indices into ATOMS of each atom present. */
  atomIdx: number[];
}

/** The bonds in a mask, as pairs of indices into ATOMS. */
export function bondsOf(mask: number): (readonly [number, number])[] {
  return BONDS.filter((_, k) => mask & (1 << k));
}

/** The colors (a bitmask over ATOMS) reachable from atom `from` along the bonds in `mask`. */
export function reach(from: number, mask: number): number {
  let seen = 1 << from;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [i, j] of bondsOf(mask))
      if ((seen >> i) & 1 && !((seen >> j) & 1)) (seen |= 1 << j), (grew = true);
      else if ((seen >> j) & 1 && !((seen >> i) & 1)) (seen |= 1 << i), (grew = true);
  }
  return seen;
}

/** The mask of every bond there can be between the colors `has` (a bitmask over ATOMS). */
export function within(has: number): number {
  let m = 0;
  BONDS.forEach(([i, j], k) => {
    if ((has >> i) & 1 && (has >> j) & 1) m |= 1 << k;
  });
  return m;
}

function colorsOf(has: number): number[] {
  return ATOMS.map((_, i) => i).filter((i) => (has >> i) & 1);
}

export function keyOf(has: number, mask: number): string {
  return has + '|' + mask;
}

/**
 * A species' name, which saves store, so it must be unique and stable. The forms, with atoms always in ATOMS order
 * (R, G, B, K) where nothing else sets the order:
 * - one atom: `R`, or `S` for the solvent;
 * - two: `R–G`;
 * - three in a chain: `R–G–B`, the middle atom in the middle;
 * - three in a ring: `△RGB`;
 * - four in a chain: `R–G–B–K`, along it, the end earlier in ATOMS order first;
 * - four with one bonded to the other three: `R(G,B,K)`, that one, then the three;
 * - a ring of three with the fourth hanging off it: `△GBR–K`, the ring with the atom the fourth hangs from last, then
 *   the fourth, so a dash always joins two bonded atoms, as in a chain;
 * - a ring of four: `□RGBK`, round it from R, toward the earlier of R's neighbors;
 * - a ring of four with one bond across it: `□RGBK+R–B`, the ring, then the bond across it;
 * - all six bonds: `⊠RGBK`.
 */
function nameOf(has: number, mask: number): string {
  const c = colorsOf(has);
  const A = (i: number) => ATOMS[i];
  const bonds = bondsOf(mask);
  const deg = (i: number) => bonds.filter(([a, b]) => a === i || b === i).length;
  const nbrs = (i: number) => bonds.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : [])).sort((x, y) => x - y);
  if (c.length === 1) return A(c[0]);
  if (c.length === 2) return A(c[0]) + '–' + A(c[1]);
  if (c.length === 3) {
    if (bonds.length === 3) return '△' + c.map(A).join('');
    const mid = c.find((i) => deg(i) === 2)!;
    const ends = c.filter((i) => i !== mid);
    return [ends[0], mid, ends[1]].map(A).join('–');
  }
  // four atoms
  if (bonds.length === 6) return '⊠' + c.map(A).join('');
  if (bonds.length === 3) {
    const hub = c.find((i) => deg(i) === 3);
    if (hub !== undefined) return A(hub) + '(' + nbrs(hub).map(A).join(',') + ')';
    // a chain: walk it from the end earlier in ATOMS order
    const path = [c.find((i) => deg(i) === 1)!];
    while (path.length < 4) path.push(nbrs(path[path.length - 1]).find((j) => !path.includes(j))!);
    return path.map(A).join('–');
  }
  if (bonds.length === 4 && c.every((i) => deg(i) === 2)) return '□' + ring(c, bonds).map(A).join('');
  if (bonds.length === 4) {
    const tail = c.find((i) => deg(i) === 1)!;
    const foot = nbrs(tail)[0];
    const tri = c.filter((i) => i !== tail && i !== foot);
    return '△' + [...tri, foot].map(A).join('') + '–' + A(tail);
  }
  // five bonds: a ring of four round the two atoms with three bonds each, and the bond across between those two
  const [p, q] = c.filter((i) => deg(i) === 3);
  const across = bondBit(p, q);
  const r = ring(
    c,
    bonds.filter(([a, b]) => bondBit(a, b) !== across),
  );
  return '□' + r.map(A).join('') + '+' + A(p) + '–' + A(q);
}

/** The atoms of a ring of four (`bonds`, each atom in two), round it from the first of `c` toward its earlier neighbor. */
function ring(c: number[], bonds: (readonly [number, number])[]): number[] {
  const nb = (i: number) => bonds.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : [])).sort((x, y) => x - y);
  const out = [c[0], nb(c[0])[0]];
  while (out.length < 4) out.push(nb(out[out.length - 1]).find((j) => !out.includes(j))!);
  return out;
}

function enumerate(): Species[] {
  const out: Species[] = [];
  for (let has = 1; has < 1 << ATOMS.length; has++) {
    const c = colorsOf(has);
    const allowed = within(has);
    for (let mask = 0; mask < 1 << BONDS.length; mask++) {
      if (mask & ~allowed) continue;
      // molecules must be connected
      if (reach(c[0], mask) !== has) continue;
      const list = c.map((i) => ATOMS[i]);
      const size = list.length;
      const col = [0, 0, 0];
      for (const a of list) for (let k = 0; k < 3; k++) col[k] += ATOM_RGB[a][k] / size;
      out.push({
        i: out.length,
        atoms: list,
        has,
        mask,
        size,
        weight: list.reduce((w, a) => w + ATOM_WEIGHT[a], 0),
        key: keyOf(has, mask),
        name: nameOf(has, mask),
        color: `rgb(${col.map(Math.round).join(',')})`,
        atomIdx: c,
      });
    }
  }
  return out;
}

/**
 * All 65 species: the 64 of the four colors, 4 singles, 6 pairs, 4 color-triples × 4 connected shapes (3 chains and a
 * ring), and the 38 connected graphs on all four colors; then the solvent, S, alone, last, since it bonds with
 * nothing (it's the highest bit of `has`, so it comes last and every other species' index is as before).
 */
export const SPECIES: readonly Species[] = enumerate();
export const NS = SPECIES.length;

const INDEX = new Map(SPECIES.map((s) => [s.key, s.i]));

/** A bitmask over ATOMS of these atoms. */
export function colorMask(atoms: readonly Atom[]): number {
  return atoms.reduce((m, a) => m | (1 << ATOMS.indexOf(a)), 0);
}

/** The bond mask (see BONDS) of these bonds, each as two atoms, e.g. bondMask(['R', 'G'], ['G', 'B']). */
export function bondMask(...bonds: (readonly [Atom, Atom])[]): number {
  return bonds.reduce((m, [a, b]) => m | bondBit(ATOMS.indexOf(a), ATOMS.indexOf(b)), 0);
}

/** The species with these atoms (a list, or a bitmask over ATOMS) and these bonds (a mask over BONDS). */
export function speciesIndex(atoms: readonly Atom[] | number, mask: number): number {
  const has = typeof atoms === 'number' ? atoms : colorMask(atoms);
  const i = INDEX.get(keyOf(has, mask));
  if (i === undefined) throw new Error(`no species ${keyOf(has, mask)}`);
  return i;
}

/** SINGLE[ATOMS.indexOf(a)] is the species index of the free atom a. */
export const SINGLE: readonly number[] = ATOMS.map((_, i) => speciesIndex(1 << i, 0));
export function singleOf(atom: Atom): number {
  return SINGLE[ATOMS.indexOf(atom)];
}

/** The solvent's species: a lone S atom, the last species. */
export const SOLVENT_SPECIES = SINGLE[SOLVENT_INDEX];

/** The species of a and b bonded to each other. */
export function pairOf(a: Atom, b: Atom): number {
  return speciesIndex([a, b], bondMask([a, b]));
}

/** The target: the R–G–B triangle. */
export const TARGET = speciesIndex(['R', 'G', 'B'], bondMask(['R', 'G'], ['R', 'B'], ['G', 'B']));

/** The parameters of bond k (see BONDS). */
export function bondParam(p: ChemParams, k: number) {
  return p.bonds[BOND_KEYS[k]];
}

/** Species energies U = -(sum of bond energies). */
export function speciesEnergies(p: ChemParams, out = new Float64Array(NS)): Float64Array {
  const E = BOND_KEYS.map((k) => p.bonds[k].E);
  for (const sp of SPECIES) {
    let U = 0;
    for (let k = 0; k < BONDS.length; k++) if (sp.mask & (1 << k)) U -= E[k];
    out[sp.i] = U;
  }
  return out;
}
