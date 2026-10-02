import { ATOMS, GROUP_PRIMARY, popcount3, type Atom } from './atoms';
import type { Fluid } from './reactions';
import { NS, SPECIES } from './species';

/**
 * Each atom's mass, averaging 1, so a fluid weighs about what it did when every atom weighed the same. Primaries
 * are lighter than secondaries, and no two colors weigh the same, so fluids of different colors differ in density.
 */
export const ATOM_MASS: Record<Atom, number> = { R: 0.75, G: 0.85, B: 0.95, C: 1.05, M: 1.15, Y: 1.25 };
const DEFAULT_ATOM_MASS = { ...ATOM_MASS };

/** Each species' mass: the sum of its atoms'. Kept up to date by updateMasses. */
export const SPECIES_MASS = new Float64Array(NS);

/** Recompute SPECIES_MASS, after editing ATOM_MASS. */
export function updateMasses(): void {
  for (const sp of SPECIES) SPECIES_MASS[sp.i] = sp.atomIdx.reduce((m, a) => m + ATOM_MASS[ATOMS[a]], 0);
}
updateMasses();

export function restoreDefaultMasses(): void {
  Object.assign(ATOM_MASS, DEFAULT_ATOM_MASS);
  updateMasses();
}

/** A fluid's mass: the sum of its molecules'. */
export function massOf(f: Fluid): number {
  let m = 0;
  for (let s = 0; s < NS; s++) if (f.n[s] > 0) m += f.n[s] * SPECIES_MASS[s];
  return m;
}

/**
 * How fluids mix, as a regular solution: each species has a character (see CHARACTER), and a molecule's escaping
 * tendency from a fluid is e^(|its character − the fluid's mean character|² / T), weighted per component. So unlike
 * molecules shun each other, two fluids separate below a critical temperature (half their weighted mismatch), and
 * heat mixes them. Editable from the Chemistry panel:
 * - color, open: the weights of a mismatch in color and in openness;
 * - rate: how fast neighboring layers trade molecules, per sim second, as a share of the smaller layer;
 * - gravity: how much a species' density biases that trade, light up and heavy down;
 * - calm: sim seconds for stirring to die down by a factor e;
 * - churn: how hard landing fluid stirs the layers it falls through, per its volume over theirs;
 * - slosh: how hard moving a vessel stirs all of it, per world unit per second of change in its velocity.
 */
export const MIXING = { color: 0.8, open: 0.8, rate: 10, gravity: 0.05, calm: 1, churn: 1, slosh: 0.0015 };
const DEFAULT_MIXING = { ...MIXING };

export function restoreDefaultMixing(): void {
  Object.assign(MIXING, DEFAULT_MIXING);
  restoreDefaultMasses();
}

/** Components of a character: a color direction in three dimensions, and openness. */
export const CHAR_DIMS = 4;

/**
 * Each species' character, CHAR_DIMS numbers per species:
 * - its color: the mean of its atoms' directions, one axis per group, primaries positive (R +x, C −x, G +y,
 *   M −y, B +z, Y −z), so opposite colors are as unlike as can be;
 * - its openness: free bonding capacity per atom, 2 − 2 · bonds / atoms, so 2 for a single atom, 1 for a pair,
 *   ⅔ for a chain and 0 for a ring.
 */
export const CHARACTER: Float64Array = (() => {
  const out = new Float64Array(NS * CHAR_DIMS);
  for (const sp of SPECIES) {
    sp.atoms.forEach((a, g) => {
      if (a) out[sp.i * CHAR_DIMS + g] = (GROUP_PRIMARY.includes(a) ? 1 : -1) / sp.size;
    });
    out[sp.i * CHAR_DIMS + 3] = 2 - (2 * popcount3(sp.mask)) / sp.size;
  }
  return out;
})();
