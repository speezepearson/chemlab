/*
 * Six atom colors in three complementary pairs. Each pair is a "group", and a
 * molecule holds at most one atom from each group, so it has three slots.
 */
export const ATOMS = ['R', 'C', 'G', 'M', 'B', 'Y'] as const;
export type Atom = (typeof ATOMS)[number];
export type Group = 0 | 1 | 2;

export const GROUP: Record<Atom, Group> = { R: 0, C: 0, G: 1, M: 1, B: 2, Y: 2 };
export const OPPOSITE: Record<Atom, Atom> = { R: 'C', C: 'R', G: 'M', M: 'G', B: 'Y', Y: 'B' };
export const GROUP_PRIMARY: readonly Atom[] = ['R', 'G', 'B'];

export type RGBTriple = readonly [number, number, number];
export const ATOM_RGB: Record<Atom, RGBTriple> = {
  R: [228, 58, 52],
  G: [58, 186, 96],
  B: [58, 112, 236],
  C: [42, 200, 214],
  M: [210, 64, 196],
  Y: [240, 202, 48],
};

/** Bit k of a bond mask is the bond between the two groups BIT_PAIRS[k]. */
export const BIT_PAIRS: readonly (readonly [Group, Group])[] = [
  [0, 1],
  [0, 2],
  [1, 2],
];

export function bitOf(g1: Group, g2: Group): number {
  const a = Math.min(g1, g2);
  const b = Math.max(g1, g2);
  return a === 0 ? (b === 1 ? 1 : 2) : 4;
}

export function popcount3(m: number): number {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
}

/** Bond key: the two colors in group order (R/C first, then G/M, then B/Y). */
export function pairKey(a: Atom, b: Atom): string {
  return GROUP[a] < GROUP[b] ? a + b : b + a;
}
