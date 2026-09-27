import type { Atom } from '../chem/atoms';
import { T_ROOM } from '../chem/params';
import type { Fluid } from '../chem/reactions';
import { NS, singleOf } from '../chem/species';

/** A faucet dispenses an unlimited supply of one fixed fluid. */
export interface Faucet {
  atom: Atom;
}

export const FAUCETS: readonly Faucet[] = (['R', 'G', 'B', 'Y', 'C', 'M'] as const).map((atom) => ({ atom }));

/**
 * One atom's worth of what a faucet dispenses. Faucet output is always at
 * room temperature and in chemical equilibrium with itself (enforced by
 * faucets.test.ts), so a flask filled from a single faucet just sits there.
 */
export function faucetOutput(fa: Faucet): Fluid {
  const n = new Float64Array(NS);
  n[singleOf(fa.atom)] = 1;
  return { n, N: 1, T: T_ROOM };
}
