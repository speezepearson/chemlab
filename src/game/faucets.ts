import { type Atom } from '../chem/atoms';
import { THERMO, T_ROOM } from '../chem/params';
import { ReactionNetwork, heatAt, type Fluid } from '../chem/reactions';
import { NS, SPECIES, singleOf } from '../chem/species';
import { BENCH, CELL, type Vec3 } from './space';
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

/** How many of the faucets are the four colors'; the rest are the solvent's. */
export const COLOR_FAUCETS = 4;
/** How many faucets the solvent has: one beside the colors', and the rest spread along the bench. */
const SOLVENT_FAUCETS = 6;
const SOLVENT: Faucet = pure('S');

/**
 * The faucets, all pure, at room temperature: first the four colors', left to right along the wall, then the clear
 * solvent's, S, the first beside them and the rest along the bench. Every pair has to be made by mixing.
 */
export const FAUCETS: readonly Faucet[] = [
  pure('R'), pure('G'), pure('B'), pure('K'),
  ...Array.from({ length: SOLVENT_FAUCETS }, () => SOLVENT),
];

/**
 * Where each faucet's spout is along the wall (see FAUCETS): the colors' and the first of the solvent's in a row a
 * CELL apart, just past the supply station, which is at the bench's left end, by the cabinet (see STATION_POSE); and
 * the solvent's others every 900 along the rest of it, past where the one-of-a-kind instruments start.
 */
export const FAUCET_X: readonly number[] = FAUCETS.map((_, i) =>
  i <= COLOR_FAUCETS ? BENCH.x0 + (8 + i) * CELL : BENCH.x0 + 2600 + (i - COLOR_FAUCETS - 1) * 900,
);

/**
 * Older saves' faucets, by how many there were, as places among the new ones (null for one that's gone): from when
 * the solvent had only the one, a fifth in the colors' row; from before the solvent, when there
 * were the four colors' alone, in the same order; from when there were six atoms, R, Y, G, C, B and M; and from before
 * that, when the twelve pairs that could bond had faucets too, 18, with the six atoms' at 3, 5, 7, 9, 11 and 13 (see
 * faucetIndex).
 */
const OLD: Record<number, readonly (number | null)[]> = {
  5: [0, 1, 2, 3, 4],
  4: [0, 1, 2, 3],
  6: [0, null, 1, null, 2, null],
  18: Array.from({ length: 18 }, (_, i) => ({ 3: 0, 7: 1, 11: 2 } as Record<number, number>)[i] ?? null),
};

/**
 * Which faucet a save's faucet `i` is, out of the `count` it had, as their notes and hoses refer to them: the same
 * one, or for an older save (see OLD), the same atom's. Null for one that's gone (an atom that's no more, or a pair's),
 * or out of any other number, whose order isn't known.
 */
export function faucetIndex(i: number, count: number): number | null {
  const j = count === FAUCETS.length ? i : (OLD[count]?.[i] ?? null);
  return Number.isInteger(j) && j !== null && j >= 0 && j < FAUCETS.length ? j : null;
}

/** A faucet as text, e.g. "R", or "B at T = 0.2". */
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
 * What a faucet whose spout is at `spout` fills: the first open top below it, however far down, as a spout's stream
 * would. A full one keeps filling, and overflows. That includes something the player is holding there.
 */
export function faucetTarget(mouths: readonly Mouth[], spout: Vec3): Mouth | null {
  return mouthBelow(mouths, spout);
}
