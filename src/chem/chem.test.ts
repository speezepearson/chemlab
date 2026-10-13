import { describe, expect, it } from 'vitest';
import { testChemParams } from './testChem';
import { Lag, QUIET, ReactionNetwork, atomCounts, heatAt, temperature, type Fluid } from './reactions';
import { NS, SPECIES, TARGET, singleOf, speciesIndex } from './species';
import { ATOMS, type Atom } from './atoms';
import { equilibrate, equilibrium } from './equilibrium';

/** Counts in these tests are in millions of molecules, so the whole-number dynamics are smooth. */
const M = 1e6;

function fluid(contents: [number, number][], T = 1): Fluid {
  const n = new Float64Array(NS);
  let N = 0;
  for (const [s, count] of contents) {
    n[s] += count * M;
    N += count * M * SPECIES[s].size;
  }
  return { n, N, Q: heatAt(T, N) };
}

const single = (a: Atom, count: number): [number, number] => [singleOf(a), count];

function run(net: ReactionNetwork, f: Fluid, seconds: number) {
  const h = 0.02;
  for (let t = 0; t < seconds; t += h) net.step(f, h);
}

describe('species', () => {
  it('enumerates 6 singles, 12 pairs and 8 × 4 triples', () => {
    expect(NS).toBe(50);
    expect(SPECIES.filter((s) => s.size === 1)).toHaveLength(6);
    expect(SPECIES.filter((s) => s.size === 2)).toHaveLength(12);
    expect(SPECIES.filter((s) => s.size === 3)).toHaveLength(32);
  });

  it('targets the R–G–B triangle', () => {
    expect(SPECIES[TARGET].name).toBe('△RGB');
  });
});

describe('reactions', () => {
  const net = new ReactionNetwork(testChemParams());

  it('builds the full network', () => {
    expect(net.count).toBe(1428);
  });

  it('conserves atoms of every color', () => {
    const f = fluid([single('R', 60), single('G', 60), single('Y', 40), single('C', 20), single('B', 20)]);
    const before = atomCounts(f);
    run(net, f, 30);
    expect(atomCounts(f)).toEqual(before);
  });

  it('keeps every count and the heat whole', () => {
    const f = fluid([single('R', 60), single('G', 60), single('Y', 40), single('C', 20), single('B', 20)]);
    run(net, f, 10);
    expect(f.n.every(Number.isInteger)).toBe(true);
    expect(Number.isInteger(f.Q)).toBe(true);
  });

  it('turns the energy that bonding releases into heat', () => {
    const f = fluid([single('R', 50), single('G', 50)]);
    const energy = () => SPECIES.reduce((t, s) => t + f.n[s.i] * net.U[s.i], 0);
    const [U0, Q0] = [energy(), f.Q];
    run(net, f, 30);
    expect(energy()).toBeLessThan(U0);
    // whole quanta, rounded at random, so right to within a little
    expect((f.Q - Q0) / (U0 - energy())).toBeCloseTo(1, 3);
    expect(temperature(f)).toBeGreaterThan(1);
  });

  it('never forms or breaks a blue bond directly, even white-hot', () => {
    const f = fluid([[speciesIndex(['R', 'G', null], 1), 50], single('B', 50), [TARGET, 10]], 50);
    const blueBonds = () =>
      SPECIES.reduce((t, s) => t + f.n[s.i] * [2, 4].filter((b) => s.mask & b && s.atoms[2] === 'B').length, 0);
    run(net, f, 10);
    // the target's R–G bond can break at this heat, but with no yellow around, blue can't move
    expect(blueBonds()).toBe(20 * M);
    expect(f.n[singleOf('B')]).toBe(50 * M);
  });

  it('swaps blue into △RGY in place of its yellow, uphill', () => {
    const RGY = speciesIndex(['R', 'G', 'Y'], 7);
    const f = fluid([[RGY, 50], single('B', 150)], 10);
    run(net, f, 30);
    expect(f.n[TARGET]).toBeGreaterThan(0.1 * M);
    expect(f.n[singleOf('Y')]).toBeGreaterThan(0.1 * M);
  });

  it('gives the target back to any yellow it meets, downhill', () => {
    const f = fluid([[TARGET, 50], single('Y', 10)]);
    run(net, f, 30);
    // each yellow undoes at least one; the heat that releases can free more yellow from the △RGY it makes
    expect(f.n[TARGET]).toBeLessThanOrEqual(40 * M);
    expect(f.n[singleOf('B')]).toBeGreaterThanOrEqual(10 * M);
  });
});

describe('quiet stepping', () => {
  /** A network that notes the length of every step it takes. */
  class Counting extends ReactionNetwork {
    dts: number[] = [];
    step(f: Fluid, dt: number): number {
      this.dts.push(dt);
      return super.step(f, dt);
    }
  }
  const clone = (f: Fluid): Fluid => ({ n: f.n.slice(), N: f.N, Q: f.Q });
  const h = 0.02;

  it('follows the kinetics as closely as stepping every substep, in fewer steps', () => {
    // C and G bind slowly, and a little M swaps in and out of what they make, all far slower than a substep
    const start = fluid([single('C', 500), single('G', 500), single('M', 50)]);
    const every = clone(start);
    run(new ReactionNetwork(testChemParams()), every, 30);
    const net = new Counting(testChemParams());
    const lazy = clone(start);
    const lag = new Lag();
    for (let t = 0; t < 30; t += h) net.tick(lazy, h, lag);
    const steps = net.dts.length;
    net.step(lazy, lag.owed); // what it's still owed
    expect(steps).toBeLessThan(30 / h / 5);
    for (let s = 0; s < NS; s++) {
      const want = every.n[s];
      // within a percent of how far it's gone
      if (want > M) expect(Math.abs(lazy.n[s] - want)).toBeLessThan(0.01 * Math.abs(want - start.n[s]) + 1e-4 * want);
    }
    expect(Math.abs(temperature(lazy) - temperature(every))).toBeLessThan(0.005);
  });

  it('steps every substep a fluid that changes faster than that', () => {
    const f = fluid([single('R', 50), single('G', 50)], 3);
    const tau = new ReactionNetwork(testChemParams()).step(clone(f), 1e-9);
    const net = new Counting(testChemParams());
    const lag = new Lag();
    const sub = 2 * QUIET.share * tau;
    for (let i = 0; i < 3; i++) net.tick(f, sub, lag);
    expect(net.dts).toEqual([sub, sub, sub]);
  });

  it('steps at once when something runs in, and loses no time', () => {
    const net = new Counting(testChemParams());
    const f = fluid([single('R', 500)]); // nothing to react with
    const lag = new Lag();
    for (let i = 0; i < 5; i++) net.tick(f, h, lag);
    expect(net.dts).toHaveLength(1);
    // G arrives, which binds R
    f.n[singleOf('G')] += 500 * M;
    f.N += 500 * M;
    f.Q = heatAt(1, f.N);
    net.tick(f, h, lag);
    // its first step is a substep long, whatever the fluid was owed
    expect(net.dts.length).toBeGreaterThan(1);
    expect(net.dts[1]).toBe(h);
    expect(net.dts.reduce((t, dt) => t + dt, 0) + lag.owed).toBeCloseTo(6 * h, 12);
  });

  it('waits no longer than it may, even with nothing reacting', () => {
    const net = new Counting(testChemParams());
    const f = fluid([single('R', 500)]);
    const lag = new Lag();
    for (let i = 0; i < 100; i++) net.tick(f, h, lag);
    expect(Math.max(...net.dts)).toBeLessThanOrEqual(QUIET.most + h);
  });

  it('steps at once when the chemistry is edited', () => {
    const net = new Counting(testChemParams());
    const f = fluid([single('R', 500)]);
    const lag = new Lag();
    net.tick(f, h, lag);
    net.tick(f, h, lag);
    expect(net.dts).toHaveLength(1);
    net.rebuild();
    net.tick(f, h, lag);
    expect(net.dts.length).toBeGreaterThan(1);
  });
});

describe('net rates', () => {
  const net = new ReactionNetwork(testChemParams());

  it('lists what is reacting, busiest first, each the way it is going on net', () => {
    const f = fluid([single('R', 3), single('G', 2)]);
    const rates = net.netRates(f);
    const RG = speciesIndex(['R', 'G', null], 1);
    expect(rates[0]).toMatchObject({ from: [singleOf('R'), singleOf('G')].sort((a, b) => a - b), to: [RG] });
    for (let i = 0; i < rates.length; i++) {
      expect(rates[i].rate).toBeGreaterThan(0);
      if (i) expect(rates[i].rate).toBeLessThanOrEqual(rates[i - 1].rate);
    }
    // with the bond formed, the same reaction runs the other way when it's hot enough to break it
    const hot = fluid([[RG, 2]], 200);
    expect(net.netRates(hot)[0]).toMatchObject({ from: [RG], to: [singleOf('R'), singleOf('G')].sort((a, b) => a - b) });
  });

  it('nets every reaction against its reverse, so nothing is going on at equilibrium', () => {
    const atoms = ATOMS.map((a) => ({ R: 2, G: 1, C: 1, Y: 3 } as Partial<Record<Atom, number>>)[a] ?? 0);
    const N = 1e9;
    const n = equilibrium(atoms.map((v) => (v / 7) * N), net.U, 1.5);
    const f: Fluid = { n, N, Q: heatAt(1.5, N) };
    for (const r of net.netRates(f)) expect(r.rate).toBeLessThan(N * 1e-6);
  });
});

describe('equilibrium', () => {
  const net = new ReactionNetwork(testChemParams());
  const atoms = (counts: Partial<Record<Atom, number>>) => ATOMS.map((a) => counts[a] ?? 0);

  it('conserves atoms', () => {
    const want = atoms({ R: 2, G: 1, Y: 3 });
    const n = equilibrium(want, net.U, 2);
    expect(atomCounts({ n, N: 6, Q: 0 })).toEqual(want.map((v) => expect.closeTo(v, 10)));
  });

  it('converges when traces bind into one dominant species in the cold', () => {
    const want = atoms({ B: 0.9999, R: 0.00005, G: 0.00005 });
    const n = equilibrium(want, net.U, 0.2);
    expect(n.every(Number.isFinite)).toBe(true);
    atomCounts({ n, N: 1, Q: 0 }).forEach((v, a) => expect(v).toBeCloseTo(want[a], 12));
    expect(n[TARGET]).toBeLessThan(1e-8); // blue bonds are uphill, so the traces stay almost all unbound
  });

  it('satisfies detailed balance for bond formation', () => {
    const n = equilibrium(atoms({ R: 1, G: 1 }), net.U, 1);
    const [R, G, RG] = [singleOf('R'), singleOf('G'), speciesIndex(['R', 'G', null], 1)];
    // formation rate ∝ n_R·n_G/N, breaking rate ∝ n_RG·e^(−E/T), with N = 2 atoms
    const E = net.params.bonds.RG.E;
    expect((n[R] * n[G]) / 2 / (n[RG] * Math.exp(-E))).toBeCloseTo(1, 9);
  });

  it('equilibrates a fluid in whole molecules, keeping every atom and its temperature', () => {
    // blue bonds never form by the kinetics, but equilibrate goes all the way regardless
    const f = fluid([single('R', 3), single('G', 2), single('B', 1), single('Y', 1)], 0.7);
    const before = atomCounts(f);
    equilibrate(f, net.U, 0.7);
    expect(atomCounts(f)).toEqual(before);
    expect(f.n.every(Number.isInteger)).toBe(true);
    expect(temperature(f)).toBeCloseTo(0.7, 6);
    const want = equilibrium(before, net.U, 0.7);
    for (let s = 0; s < NS; s++) expect(Math.abs(f.n[s] - want[s])).toBeLessThan(Math.max(10, want[s] * 1e-6));
  });

  it('favors the most stable shape of a triple', () => {
    // △RMY has all three bonds; every other arrangement of R, M and Y has fewer
    const n = equilibrium(atoms({ R: 1, M: 1, Y: 1 }), net.U, 1);
    const ring = speciesIndex(['R', 'M', 'Y'], 7);
    expect(n[ring]).toBeGreaterThan(0.5);
  });
});
