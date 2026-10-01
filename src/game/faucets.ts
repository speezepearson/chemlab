import { ATOMS, type Atom } from '../chem/atoms';
import { equilibrium } from '../chem/equilibrium';
import { THERMO, T_ROOM } from '../chem/params';
import type { Fluid } from '../chem/reactions';
import { TRACE } from './config';
import { volume, type Point, type Vessel } from './flask';
import { mouthBelow, type Mouth } from './tools';

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
  // R–G, with a little of everything else, hot
  { atoms: { R: 0.49, G: 0.49, C: 0.005, M: 0.005, B: 0.005, Y: 0.005 }, T: 20 },
  // nearly pure blue, very cold
  { atoms: { B: 0.9999, R: 0.00005, G: 0.00005 }, T: 0.2 },
  // R–M–B, with the other colors as contaminants
  { atoms: { R: 0.95 / 3, M: 0.95 / 3, B: 0.95 / 3, G: 0.05 / 3, C: 0.05 / 3, Y: 0.05 / 3 } },
  { atoms: { R: 0.4, G: 0.4, B: 0.2 } },
  // C–Y, with a trace of magenta
  { atoms: { C: 0.666, Y: 0.333, M: 0.001 } },
  { atoms: { R: 0.95, G: 0.05 } },
  { atoms: { G: 0.98, R: 0.02 } },
  { atoms: { R: 0.5, C: 0.5 } },
];

/** A faucet's recipe as text, e.g. "95% R, 5% G" or "49% R, 49% G, 0.5% C, 0.5% M, 0.5% B, 0.5% Y at T = 20". */
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

/**
 * What a faucet whose spout is at `spout` fills: the first open top below it,
 * if that's within `reach` and not already full. Something being carried (a
 * flask, a tool's tanks, a hose's funnel) only catches the stream while the
 * right button is held; otherwise the stream passes it by.
 */
export function faucetTarget(
  mouths: readonly Mouth[],
  spout: Point,
  reach: number,
  carried: ReadonlySet<Vessel>,
  rightHeld: boolean,
): Mouth | null {
  const m = mouthBelow(rightHeld ? mouths : mouths.filter((mo) => !carried.has(mo.v)), spout);
  return m && m.y - spout.y <= reach && volume(m.v) <= m.v.cap - TRACE ? m : null;
}
