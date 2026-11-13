/*
 * Five atoms: four colors, red, green, blue and black, and S, a clear solvent that bonds with nothing. A molecule holds
 * at most one atom of each color, so at most four atoms, and any two of them can bond. S is last, so the four colors'
 * indices, the bonds and the species they make are as they were before it.
 */
export const ATOMS = ['R', 'G', 'B', 'K', 'S'] as const;
export type Atom = (typeof ATOMS)[number];
/** An atom with a color: any but the solvent. */
export type ColorAtom = Exclude<Atom, 'S'>;

export type RGBTriple = readonly [number, number, number];
/** Black is a near-black, a little blue, so it isn't quite the black of an empty or frozen vessel. */
export const ATOM_RGB: Record<Atom, RGBTriple> = {
  R: [228, 58, 52],
  G: [58, 186, 96],
  B: [58, 112, 236],
  K: [44, 42, 54],
  // S has no color of its own: it thins a fluid instead (see fluidHue and solventAlpha). This is how it looks alone, a
  // faint cool near-white, for species lists and the like.
  S: [222, 232, 240],
};

/** How much each atom weighs, in µg (see GRAMS_PER_WEIGHT in scale.ts), so a billion of weight w weigh w kg. No two weigh the same. */
export const ATOM_WEIGHT: Record<Atom, number> = { R: 6, G: 3, B: 4, K: 5, S: 2 };

/** The solvent: an atom that bonds with nothing, so it's in no reaction, and has no color. */
export const SOLVENT: Atom = 'S';
/** The solvent's index in ATOMS. */
export const SOLVENT_INDEX = ATOMS.indexOf(SOLVENT);
/** The atoms that bond (all but the solvent), as indices into ATOMS. */
export const BONDING: readonly number[] = ATOMS.map((_, i) => i).filter((i) => i !== SOLVENT_INDEX);
/** Whether atom i (an index into ATOMS) can bond at all. */
export const canBond = (i: number) => i !== SOLVENT_INDEX;

/** Bit k of a bond mask is the bond between the two atoms BONDS[k], as indices into ATOMS. */
export const BONDS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [1, 2],
  [0, 3],
  [1, 3],
  [2, 3],
];

/** The index in BONDS of the bond between atoms i and j (indices into ATOMS). */
export function bondIndex(i: number, j: number): number {
  const k = BONDS.findIndex(([a, b]) => (a === i && b === j) || (a === j && b === i));
  if (k < 0) throw new Error(`no bond ${i}-${j}`);
  return k;
}

/** The bit, in a bond mask, of the bond between atoms i and j (indices into ATOMS). */
export function bondBit(i: number, j: number): number {
  return 1 << bondIndex(i, j);
}

/** Bond key: the two colors in ATOMS order, e.g. "RG", "BK". */
export function pairKey(a: Atom, b: Atom): string {
  return ATOMS.indexOf(a) < ATOMS.indexOf(b) ? a + b : b + a;
}

/** Every bond's key (see pairKey), in BONDS order: RG, RB, GB, RK, GK, BK. */
export const BOND_KEYS: readonly string[] = BONDS.map(([i, j]) => ATOMS[i] + ATOMS[j]);
