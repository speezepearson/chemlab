import { equilibriumFluid } from '../chem/equilibrium';
import { T_ROOM, type ChemParams } from '../chem/params';
import { ReactionNetwork, heatAt, temperature, type Fluid } from '../chem/reactions';
import { SPECIES, TARGET, speciesIndex } from '../chem/species';
import { CAP } from './config';
import { Vessel, transfer, volume } from './flask';
import type { Recipe } from './presets';
import { MAX_FLOW, separate } from './tools';

/*
 * A route harness: runs a synthesis on the game's own pieces (faucets,
 * vessels, the separator, the reaction network, the same 0.02 s step) and
 * reports what's in the pot after every stage, so tuning the chemistry is
 * editing numbers and re-running. See route.test.ts, and `npm run route`.
 */

/** Sim step, matching the engine's. */
const H = 0.02;

/** The three open chains of R, G and B: dead ends, and no separator tells them from the target. */
export const BLUE_CHAINS = [
  speciesIndex(['R', 'G', 'B'], 1 | 4), // R–G–B
  speciesIndex(['R', 'G', 'B'], 1 | 2), // G–R–B
  speciesIndex(['R', 'G', 'B'], 2 | 4), // R–B–G
];

export interface StageReport {
  stage: string;
  /** Sim seconds since the route started. */
  t: number;
  T: number;
  /** Atoms in the vessel. */
  atoms: number;
  /** Atoms of the target. */
  target: number;
  /** Share of atoms that are target. */
  purity: number;
  /** Share of atoms in blue chains. */
  chains: number;
  /** Heat a thermostat has added so far in this stage (negative if it took heat out), in quanta per atom. */
  heat: number;
  /** The biggest species by share of atoms. */
  top: [string, number][];
}

/** Share of a fluid's atoms in the given species. */
export function share(f: Fluid, species: readonly number[]): number {
  return f.N > 0 ? species.reduce((t, s) => t + f.n[s] * SPECIES[s].size, 0) / f.N : 0;
}

export class Route {
  readonly net: ReactionNetwork;
  readonly log: StageReport[] = [];
  t = 0;

  constructor(params: ChemParams) {
    this.net = new ReactionNetwork(params);
  }

  /** `atoms` atoms of a recipe, at full equilibrium at its temperature, in an unbounded vessel. */
  recipe(r: Recipe, atoms: number): Vessel {
    const v = new Vessel(Infinity);
    v.addFrom(equilibriumFluid(r.atoms, this.net.U, r.T ?? T_ROOM), atoms);
    return v;
  }

  /** Everything poured into one unbounded vessel. The sources are emptied. */
  mix(...vs: Vessel[]): Vessel {
    const out = new Vessel(Infinity);
    for (const v of vs) transfer(v, out, v.N);
    return out;
  }

  /** Pour about `atoms` atoms of v into a new unbounded vessel. */
  take(v: Vessel, atoms: number): Vessel {
    const out = new Vessel(Infinity);
    transfer(v, out, atoms);
    return out;
  }

  /** Let fluids react for `seconds`, holding them at T if given. Returns the heat added per atom. */
  hold(vs: Vessel[], seconds: number, T?: number): number {
    let heat = 0;
    const N = vs.reduce((t, v) => t + v.N, 0);
    for (let s = 0; s < seconds; s += H) {
      for (const v of vs) {
        this.net.step(v, H);
        if (T !== undefined) {
          const Q = heatAt(T, v.N);
          heat += Q - v.Q;
          v.Q = Q;
        }
      }
      this.t += H;
    }
    return N > 0 ? heat / N : 0;
  }

  /**
   * A separator whose left spout is hosed back into its own tank, so each pass
   * strips out what goes right (mostly secondary colors) and keeps the rest.
   * The tank drains at `valve` flasks per second times how full it is, as a
   * tool's tank does, and `feed`, if given, drips into it the same way at
   * `feedValve`. What leaves the right spout goes
   * into `into` (a new unbounded vessel if left out), which is returned along
   * with the heat a thermostat at T added per atom, if T is given.
   */
  strip(
    tank: Vessel,
    o: { seconds: number; valve: number; feed?: Vessel; feedValve?: number; into?: Vessel; T?: number },
  ): { right: Vessel; heat: number } {
    const right = o.into ?? new Vessel(Infinity);
    let heat = 0;
    const N0 = tank.N;
    for (let s = 0; s < o.seconds; s += H) {
      if (o.feed && o.feedValve) transfer(o.feed, tank, o.feedValve * MAX_FLOW * Math.min(1, volume(o.feed) / o.feed.cap) * H);
      const out = new Vessel(Infinity);
      transfer(tank, out, o.valve * MAX_FLOW * Math.min(1, volume(tank) / tank.cap) * H);
      const [l, r] = separate(out);
      transfer(l, tank, l.N);
      transfer(r, right, r.N);
      this.net.step(tank, H);
      this.net.step(right, H);
      if (o.T !== undefined) {
        const Q = heatAt(o.T, tank.N);
        heat += Q - tank.Q;
        tank.Q = Q;
      }
      this.t += H;
    }
    return { right, heat: N0 > 0 ? heat / N0 : 0 };
  }

  report(stage: string, v: Fluid, heat = 0): StageReport {
    const top = SPECIES.map((s) => [s.name, share(v, [s.i])] as [string, number])
      .filter(([, x]) => x > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const r: StageReport = {
      stage,
      t: this.t,
      T: temperature(v),
      atoms: v.N,
      target: v.n[TARGET] * 3,
      purity: share(v, [TARGET]),
      chains: share(v, BLUE_CHAINS),
      heat,
      top,
    };
    this.log.push(r);
    return r;
  }
}

const pct = (x: number) => (x >= 0.001 || x === 0 ? `${(100 * x).toFixed(1)}%` : `${(100 * x).toExponential(0)}%`);

/** The log as a fixed-width table. */
export function formatLog(log: readonly StageReport[]): string {
  return log
    .map(
      (r) =>
        `${r.stage.padEnd(28)} t=${r.t.toFixed(0).padStart(5)}s  T=${r.T.toFixed(2).padStart(6)}  ` +
        `${(r.atoms / CAP).toFixed(2).padStart(5)} flasks  target ${(r.target / CAP).toFixed(3)} flasks (${pct(r.purity)})  ` +
        `chains ${pct(r.chains)}${r.heat ? `  heat ${r.heat.toFixed(1)}/atom` : ''}\n` +
        `${' '.repeat(30)}${r.top.map(([n, x]) => `${n} ${pct(x)}`).join(', ')}`,
    )
    .join('\n');
}
