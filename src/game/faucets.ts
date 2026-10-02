import { type Atom } from '../chem/atoms';
import { THERMO, T_ROOM } from '../chem/params';
import { ReactionNetwork, heatAt, type Fluid } from '../chem/reactions';
import { NS, SPECIES, pairOf, singleOf } from '../chem/species';
import type { Point, Vessel } from './flask';
import { mouthBelow, type Mouth } from './tools';

/** A faucet dispenses an unlimited supply of one fixed fluid. */
export interface Faucet {
  /** The species it starts as, pure. It dispenses what that settles to (see faucetOutput). */
  start: number;
  /** The temperature it settles at and comes out at; room temperature if left out. */
  T?: number;
}

/** A faucet of one atom, pure. */
const pure = (a: Atom): Faucet => ({ start: singleOf(a) });
/** A faucet of a pair of atoms that can bond, as the pair settles from pure. */
const pair = (a: Atom, b: Atom): Faucet => ({ start: pairOf(a, b) });

/**
 * One faucet for each of the six atoms and each of the twelve pairs that can bond, all at room temperature.
 * A pair's faucet is what that pair, started pure, settles to: some of it may come apart, unless its bond is
 * one that never breaks, as blue bonds don't. Left to right: the pairs of primaries, then the color wheel
 * (each atom with the pairs of its neighbors between them), then the pairs of secondaries.
 */
export const FAUCETS: readonly Faucet[] = [
  pair('R', 'G'), pair('G', 'B'), pair('R', 'B'),
  pure('R'), pair('R', 'Y'), pure('Y'), pair('G', 'Y'), pure('G'), pair('G', 'C'),
  pure('C'), pair('B', 'C'), pure('B'), pair('B', 'M'), pure('M'), pair('R', 'M'),
  pair('C', 'M'), pair('M', 'Y'), pair('C', 'Y'),
];

/** A faucet as text, e.g. "R–G", or "B at T = 0.2". */
export function describeFaucet(fa: Faucet): string {
  const name = SPECIES[fa.start].name;
  return fa.T === undefined ? name : `${name} at T = ${fa.T}`;
}

/** How many molecules a faucet's start is settled as: enough that whole-molecule rounding is lost in the noise. */
const SETTLE_SCALE = 1e12;

const outputs = new WeakMap<ReactionNetwork, { version: number; out: Map<Faucet, Fluid> }>();

/**
 * One atom's worth of what a faucet dispenses: its start species, pure, held at the faucet's temperature and
 * left to react until nothing changes (see ReactionNetwork.settle). Only reactions that can actually happen
 * do, so a pair whose bond never breaks comes out whole. Faucet output is in chemical equilibrium with itself
 * at its temperature (enforced by faucets.test.ts), so a flask filled from a single faucet just sits there
 * until it's warmed, cooled or mixed. Settled once per faucet for each version of the chemistry.
 */
export function faucetOutput(fa: Faucet, net: ReactionNetwork): Fluid {
  let cache = outputs.get(net);
  if (!cache || cache.version !== net.version) outputs.set(net, (cache = { version: net.version, out: new Map() }));
  let out = cache.out.get(fa);
  if (!out) {
    const T = fa.T ?? T_ROOM;
    const n = new Float64Array(NS);
    n[fa.start] = SETTLE_SCALE;
    const N = SETTLE_SCALE * SPECIES[fa.start].size;
    const f: Fluid = { n, N, Q: heatAt(T, N) };
    net.settle(f, T);
    out = { n: n.map((v) => v / N), N: 1, Q: T * THERMO.heatCap };
    cache.out.set(fa, out);
  }
  return out;
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
