import { equilibrium } from '../chem/equilibrium';
import { T_ROOM } from '../chem/params';
import type { Fluid } from '../chem/reactions';
import { ATOMS } from '../chem/atoms';
import { SPECIES, speciesNamed } from '../chem/species';

/** A faucet dispenses an unlimited supply of one fixed fluid. */
export interface Faucet {
  /**
   * What the fluid is made from, as a species name like 'R–M–B'. The faucet
   * dispenses that compound's atoms at chemical equilibrium, which may be
   * mostly something else.
   */
  name: string;
}

/**
 * Scrounged, not pure: the player has to work out what's in each one. The
 * mixes are deliberately not the six free atoms, which would give away too
 * much about how the world's chemistry works.
 */
export const FAUCETS: readonly Faucet[] = ['R–G', 'B', 'R–M–B', 'C–Y', 'G–B'].map((name) => ({ name }));

/**
 * One atom's worth of what a faucet dispenses, given the current species
 * energies U. Faucet output is always at room temperature and in chemical
 * equilibrium with itself (enforced by faucets.test.ts), so a flask filled
 * from a single faucet just sits there.
 */
export function faucetOutput(fa: Faucet, U: Float64Array): Fluid {
  const s = SPECIES[speciesNamed(fa.name)];
  const atoms = ATOMS.map((_, a) => s.atomIdx.filter((x) => x === a).length / s.size);
  return { n: equilibrium(atoms, U, T_ROOM), N: 1, T: T_ROOM };
}
