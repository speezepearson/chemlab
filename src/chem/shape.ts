import { ATOM_WEIGHT, BONDS, type Atom } from './atoms';
import { SPECIES } from './species';

/*
 * What follows from a molecule's shape alone: how many bonds each of its atoms has, and which of them are loose ends.
 * Instruments that tell molecules of the same atoms apart go by these.
 */

/** For each species, how many bonds each of its atoms has, in the order of its atoms. */
export const DEGREES: readonly (readonly number[])[] = SPECIES.map((sp) =>
  sp.atomIdx.map((a) => BONDS.filter(([i, j], k) => sp.mask & (1 << k) && (i === a || j === a)).length),
);

/**
 * For each species, its loose ends: the atoms held by exactly one bond. Both atoms of a pair are; a chain has two, and
 * a star three; a ring has none, nor has a lone atom, which has no bond at all.
 */
export const LOOSE_ENDS: readonly (readonly Atom[])[] = SPECIES.map((sp, s) => sp.atoms.filter((_, k) => DEGREES[s][k] === 1));

/** For each species, the weight of its loose ends together (see ATOM_WEIGHT). */
export const END_WEIGHT: readonly number[] = LOOSE_ENDS.map((ends) => ends.reduce((w, a) => w + ATOM_WEIGHT[a], 0));
