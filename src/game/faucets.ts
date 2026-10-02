import { ATOMS, type Atom } from '../chem/atoms';
import { equilibrium } from '../chem/equilibrium';
import { THERMO, T_ROOM } from '../chem/params';
import type { Fluid } from '../chem/reactions';
import type { Point, Vessel } from './flask';
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

/** A faucet of one atom, pure. */
const pure = (a: Atom): Faucet => ({ atoms: { [a]: 1 } });
/** A faucet of a pair of atoms that can bond, as if it started as nothing but that pair and settled. */
const pair = (a: Atom, b: Atom): Faucet => ({ atoms: { [a]: 0.5, [b]: 0.5 } });

/**
 * One faucet for each of the six atoms and each of the twelve pairs that can bond, all at room temperature.
 * A pair's faucet is what that pair, started pure, settles to (see faucetOutput): some of it may come apart.
 * Left to right: the pairs of primaries, then the color wheel (each atom with the pairs of its neighbors
 * between them), then the pairs of secondaries.
 */
export const FAUCETS: readonly Faucet[] = [
  pair('R', 'G'), pair('G', 'B'), pair('R', 'B'),
  pure('R'), pair('R', 'Y'), pure('Y'), pair('G', 'Y'), pure('G'), pair('G', 'C'),
  pure('C'), pair('B', 'C'), pure('B'), pair('B', 'M'), pure('M'), pair('R', 'M'),
  pair('C', 'M'), pair('M', 'Y'), pair('C', 'Y'),
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
 * What a faucet whose spout is at `spout` fills: the first open top below it, if that's within `reach`. A
 * full one keeps filling, and overflows. Something being carried (a flask, a tool's tanks, a hose's funnel)
 * only catches the stream while the right button is held; otherwise the stream passes it by.
 */
export function faucetTarget(
  mouths: readonly Mouth[],
  spout: Point,
  reach: number,
  carried: ReadonlySet<Vessel>,
  rightHeld: boolean,
): Mouth | null {
  const m = mouthBelow(rightHeld ? mouths : mouths.filter((mo) => !carried.has(mo.v)), spout);
  return m && m.y - spout.y <= reach ? m : null;
}
