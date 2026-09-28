import { ATOMS, type Atom } from '../chem/atoms';
import { equilibrium } from '../chem/equilibrium';
import { THERMO, T_ROOM } from '../chem/params';
import type { Fluid } from '../chem/reactions';

/** A faucet dispenses an unlimited supply of one fixed fluid. */
export interface Faucet {
  /**
   * What the fluid is made of, as a share of its atoms by color. The faucet
   * dispenses those atoms at chemical equilibrium, which may be mostly bonded.
   */
  atoms: Partial<Record<Atom, number>>;
}

/**
 * Scrounged, not pure: the player has to work out what's in each one. The
 * mixes are deliberately not the six free atoms, which would give away too
 * much about how the world's chemistry works.
 */
export const FAUCETS: readonly Faucet[] = [
  { atoms: { R: 1 / 2, G: 1 / 2 } }, // R–G
  { atoms: { B: 1 } },
  { atoms: { R: 1 / 3, M: 1 / 3, B: 1 / 3 } }, // R–M–B
  { atoms: { C: 1 / 2, Y: 1 / 2 } }, // C–Y
  { atoms: { G: 1 / 2, B: 1 / 2 } }, // G–B
  { atoms: { R: 0.95, G: 0.05 } },
  { atoms: { G: 0.98, R: 0.02 } },
];

/** A faucet's recipe as text, e.g. "95% R, 5% G". */
export function describeFaucet(fa: Faucet): string {
  return Object.entries(fa.atoms)
    .map(([a, share]) => `${+(100 * share!).toPrecision(3)}% ${a}`)
    .join(', ');
}

/**
 * One atom's worth of what a faucet dispenses, given the current species
 * energies U. Faucet output is always at room temperature and in chemical
 * equilibrium with itself (enforced by faucets.test.ts), so a flask filled
 * from a single faucet just sits there.
 */
export function faucetOutput(fa: Faucet, U: Float64Array): Fluid {
  const atoms = ATOMS.map((a) => fa.atoms[a] ?? 0);
  const total = atoms.reduce((t, v) => t + v, 0);
  return { n: equilibrium(atoms.map((v) => v / total), U, T_ROOM), N: 1, Q: T_ROOM * THERMO.heatCap };
}
