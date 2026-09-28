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
  /** The temperature it comes out at; room temperature if left out. */
  T?: number;
}

/**
 * Scrounged, not pure: the player has to work out what's in each one. The
 * mixes are deliberately not the six free atoms, which would give away too
 * much about how the world's chemistry works.
 */
export const FAUCETS: readonly Faucet[] = [
  // R–G, with a little of everything else
  { atoms: { R: 0.49, G: 0.49, C: 0.005, M: 0.005, B: 0.005, Y: 0.005 } },
  // nearly pure blue, very cold
  { atoms: { B: 0.9999, R: 0.00005, G: 0.00005 }, T: 0.2 },
  // R–M–B, with the other colors as contaminants
  { atoms: { R: 0.95 / 3, M: 0.95 / 3, B: 0.95 / 3, G: 0.05 / 3, C: 0.05 / 3, Y: 0.05 / 3 } },
  { atoms: { R: 0.4, G: 0.4, B: 0.2 } },
  // C–Y, with a trace of magenta, hot
  { atoms: { C: 0.666, Y: 0.333, M: 0.001 }, T: 10 },
  { atoms: { R: 0.95, G: 0.05 } },
  { atoms: { G: 0.98, R: 0.02 } },
  { atoms: { R: 0.5, C: 0.5 } },
];

/** A faucet's recipe as text, e.g. "95% R, 5% G" or "66.6% C, 33.3% Y, 0.1% M at T = 10". */
export function describeFaucet(fa: Faucet): string {
  const recipe = Object.entries(fa.atoms)
    .map(([a, share]) => `${+(100 * share!).toPrecision(4)}% ${a}`)
    .join(', ');
  return fa.T === undefined ? recipe : `${recipe} at T = ${fa.T}`;
}

/**
 * One atom's worth of what a faucet dispenses, given the current species
 * energies U. Faucet output is at the faucet's temperature and in chemical
 * equilibrium with itself there (enforced by faucets.test.ts), so a flask
 * filled from a single faucet just sits there until it's warmed or cooled.
 */
export function faucetOutput(fa: Faucet, U: Float64Array): Fluid {
  const T = fa.T ?? T_ROOM;
  const atoms = ATOMS.map((a) => fa.atoms[a] ?? 0);
  const total = atoms.reduce((t, v) => t + v, 0);
  return { n: equilibrium(atoms.map((v) => v / total), U, T), N: 1, Q: T * THERMO.heatCap };
}
