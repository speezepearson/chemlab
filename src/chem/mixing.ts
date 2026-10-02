import { ATOMS, type Atom } from './atoms';
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
