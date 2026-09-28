import { describe, expect, it } from 'vitest';
import { defaultChemParams } from './params';
import { ReactionNetwork, atomCounts, heatAt, temperature, type Fluid } from './reactions';
import { NS, SPECIES, TARGET, singleOf, speciesIndex } from './species';
import { ATOMS, type Atom } from './atoms';
import { equilibrium } from './equilibrium';

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

function mix(a: Fluid, b: Fluid): Fluid {
  const n = new Float64Array(NS);
  for (let s = 0; s < NS; s++) n[s] = a.n[s] + b.n[s];
  return { n, N: a.N + b.N, Q: a.Q + b.Q };
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
  const net = new ReactionNetwork(defaultChemParams());

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

  it('heats up from exothermic bonding', () => {
    const f = fluid([single('R', 50), single('G', 50)]);
    run(net, f, 30);
    expect(temperature(f)).toBeGreaterThan(1.3);
  });

  it('makes the target by building △RGY and washing it with room-temperature blue', () => {
    const f = fluid([single('R', 50), single('G', 50)]);
    run(net, f, 60);
    // forming R–G is very exothermic, so cool it back down (in the game, with the heat exchanger)
    expect(temperature(f)).toBeGreaterThan(10);
    f.Q = heatAt(1, f.N);
    const withY = mix(f, fluid([single('Y', 50)]));
    run(net, withY, 120);
    const RGY = speciesIndex(['R', 'G', 'Y'], 7);
    expect(withY.n[RGY]).toBeGreaterThan(20 * M);

    const washed = mix(withY, fluid([single('B', 150)]));
    run(net, washed, 120);
    expect(washed.n[TARGET]).toBeGreaterThan(30 * M);
    // nearly all of the yellow has been displaced from molecules
    const boundY = SPECIES.filter((s) => s.size > 1 && s.atoms[2] === 'Y').reduce((t, s) => t + washed.n[s.i], 0);
    expect(boundY).toBeLessThan(5 * M);
  });
});

describe('equilibrium', () => {
  const net = new ReactionNetwork(defaultChemParams());
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
    expect(n[TARGET]).toBeCloseTo(0.00005, 7); // a few parts per billion stay as R–B and G–B
  });

  it('satisfies detailed balance for bond formation', () => {
    const n = equilibrium(atoms({ R: 1, G: 1 }), net.U, 1);
    const [R, G, RG] = [singleOf('R'), singleOf('G'), speciesIndex(['R', 'G', null], 1)];
    // formation rate ∝ n_R·n_G/N, breaking rate ∝ n_RG·e^(−E/T), with N = 2 atoms
    const E = net.params.bonds.RG.E;
    expect((n[R] * n[G]) / 2 / (n[RG] * Math.exp(-E))).toBeCloseTo(1, 9);
  });

  it('favors the most stable shape of a triple', () => {
    // △RMB has all three bonds; every other arrangement of R, M and B has fewer
    const n = equilibrium(atoms({ R: 1, M: 1, B: 1 }), net.U, 1);
    const ring = speciesIndex(['R', 'M', 'B'], 7);
    expect(n[ring]).toBeGreaterThan(0.5);
  });
});
