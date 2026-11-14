import { describe, expect, it } from 'vitest';
import { testChemParams } from './testChem';
import { Lag, QUIET, REACTION_KINDS, ReactionNetwork, atomCounts, heatAt, temperature, type Fluid } from './reactions';
import { NS, SOLVENT_SPECIES, SPECIES, TARGET, bondMask, pairOf, singleOf, speciesIndex } from './species';
import { ATOMS, ATOM_WEIGHT, BONDS, SOLVENT_INDEX, type Atom } from './atoms';
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

/** The species with these atoms bonded like this, e.g. sp(['R', 'G'], ['G', 'B']) for R–G–B. */
const sp = (...bonds: [Atom, Atom][]) => speciesIndex([...new Set(bonds.flat())], bondMask(...bonds));
const tri = (a: Atom, b: Atom, c: Atom) => sp([a, b], [a, c], [b, c]);

describe('species', () => {
  it('enumerates 4 singles, 6 pairs, 4 × 4 triples and 38 connected graphs on the four colors, then the solvent', () => {
    expect(NS).toBe(65);
    expect(SPECIES.filter((s) => s.size === 1)).toHaveLength(5);
    expect(SPECIES.filter((s) => s.size === 2)).toHaveLength(6);
    expect(SPECIES.filter((s) => s.size === 3)).toHaveLength(16);
    expect(SPECIES.filter((s) => s.size === 4)).toHaveLength(38);
    // the four-atom graphs: 16 trees, 15 with four bonds, 6 with five, and the one with all six
    const fours = SPECIES.filter((s) => s.size === 4).map((s) => BONDS.filter((_, k) => s.mask & (1 << k)).length);
    expect([3, 4, 5, 6].map((b) => fours.filter((x) => x === b).length)).toEqual([16, 15, 6, 1]);
  });

  it('has the solvent last, a lone S atom, in no bond, weighing 2', () => {
    expect(ATOMS).toEqual(['R', 'G', 'B', 'K', 'S']);
    expect(SOLVENT_SPECIES).toBe(64);
    const S = SPECIES[SOLVENT_SPECIES];
    expect(S).toMatchObject({ name: 'S', size: 1, mask: 0, atoms: ['S'], weight: 2 });
    expect(singleOf('S')).toBe(SOLVENT_SPECIES);
    expect(BONDS.some(([i, j]) => i === SOLVENT_INDEX || j === SOLVENT_INDEX)).toBe(false);
    expect(SPECIES.filter((s) => s.atoms.includes('S'))).toEqual([S]);
    expect(new Set(Object.values(ATOM_WEIGHT)).size).toBe(ATOMS.length);
  });

  it('keeps every other species where it was, by index and name', () => {
    const known: [number, string][] = [
      [0, 'R'], [3, 'B'], [4, 'R–B'], [9, '△RGB'], [10, 'K'], [25, '△GBK'], [26, 'R(G,B,K)'], [40, 'G–R–B–K'], [63, '⊠RGBK'],
    ];
    for (const [i, name] of known) expect(SPECIES[i].name).toBe(name);
    expect(TARGET).toBe(9);
  });

  it('holds at most one atom of each color', () => {
    for (const s of SPECIES) expect(new Set(s.atoms).size).toBe(s.size);
  });

  it('names every species uniquely, keeping the old names of what survives', () => {
    expect(new Set(SPECIES.map((s) => s.name)).size).toBe(NS);
    expect(SPECIES[TARGET].name).toBe('△RGB');
    expect(SPECIES[singleOf('K')].name).toBe('K');
    expect(SPECIES[pairOf('R', 'K')].name).toBe('R–K');
    expect(SPECIES[sp(['R', 'G'], ['R', 'B'])].name).toBe('G–R–B');
    expect(SPECIES[sp(['K', 'G'], ['G', 'B'], ['B', 'R'])].name).toBe('R–B–G–K');
    expect(SPECIES[sp(['K', 'R'], ['K', 'G'], ['K', 'B'])].name).toBe('K(R,G,B)');
    expect(SPECIES[sp(['R', 'G'], ['R', 'B'], ['G', 'B'], ['R', 'K'])].name).toBe('△GBR–K');
    expect(SPECIES[sp(['R', 'G'], ['G', 'K'], ['K', 'B'], ['B', 'R'])].name).toBe('□RGKB');
    expect(SPECIES[sp(['R', 'G'], ['G', 'K'], ['K', 'B'], ['B', 'R'], ['R', 'K'])].name).toBe('□RGKB+R–K');
    expect(SPECIES.find((s) => s.size === 4 && s.mask === 63)!.name).toBe('⊠RGBK');
  });
});

describe('reactions', () => {
  const net = new ReactionNetwork(testChemParams());
  const RK = pairOf('R', 'K');
  const RG = pairOf('R', 'G');

  it('builds the full network, with the solvent in none of it', () => {
    expect(net.count).toBe(408);
    const f = fluid([[SOLVENT_SPECIES, 10], ...SPECIES.slice(0, -1).map((s) => [s.i, 1] as [number, number])], 30);
    for (const r of net.netRates(f)) expect([...r.from, ...r.to]).not.toContain(SOLVENT_SPECIES);
  });

  it('keeps the solvent exactly as it is', () => {
    const f = fluid([single('R', 60), single('G', 60), single('K', 40), [RK, 10], single('S', 100)], 3);
    run(net, f, 10);
    expect(f.n[SOLVENT_SPECIES]).toBe(100 * M);
    expect(atomCounts(f)[SOLVENT_INDEX]).toBe(100 * M);
  });

  it('slows what two molecules do by diluting them, and leaves what one does alone', () => {
    // the same reactants, at the same temperature, with and without as many atoms again of solvent
    const rate = (f: Fluid, from: number[]) =>
      net.netRates(f).find((r) => r.from.join() === [...from].sort((a, b) => a - b).join())!.rate;
    const R = singleOf('R');
    const G = singleOf('G');
    const pairs = fluid([single('R', 50), single('G', 50)]);
    const thinned = fluid([single('R', 50), single('G', 50), single('S', 100)]);
    expect(temperature(thinned)).toBeCloseTo(temperature(pairs), 9);
    expect(rate(thinned, [R, G]) / rate(pairs, [R, G])).toBeCloseTo(0.5, 9);
    // R–G breaking, hot enough to go
    const hot = fluid([[RG, 50]], 200);
    const hotThinned = fluid([[RG, 50], single('S', 100)], 200);
    expect(rate(hotThinned, [RG]) / rate(hot, [RG])).toBeCloseTo(1, 9);
    // and so with steps, too: R and G bond more slowly among the solvent (enough of them bond in a step, at room
    // temperature, that rounding each to a whole number of molecules doesn't show)
    const [a, b] = [fluid([single('R', 50), single('G', 50)]), fluid([single('R', 50), single('G', 50), single('S', 100)])];
    net.step(a, 0.001);
    net.step(b, 0.001);
    expect(b.n[RG] / a.n[RG]).toBeCloseTo(0.5, 2);
  });

  it('conserves atoms of every color', () => {
    const f = fluid([single('R', 60), single('G', 60), single('K', 40), single('B', 20), [RK, 10]]);
    const before = atomCounts(f);
    run(net, f, 30);
    expect(atomCounts(f)).toEqual(before);
  });

  it('keeps every count and the heat whole', () => {
    const f = fluid([single('R', 60), single('G', 60), single('K', 40), single('B', 20)]);
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

  it('conserves energy through displacements as well', () => {
    const f = fluid([[RK, 50], [tri('R', 'G', 'K'), 20], single('G', 30), single('B', 40)], 5);
    const energy = () => SPECIES.reduce((t, s) => t + f.n[s.i] * net.U[s.i], 0) + f.Q;
    const E0 = energy();
    run(net, f, 10);
    expect(Math.abs(energy() - E0)).toBeLessThan(1e-4 * Math.abs(E0));
  });

  it('never forms or breaks a blue bond directly, even white-hot', () => {
    const f = fluid([[RG, 50], single('B', 50), [TARGET, 10]], 50);
    const blue = BONDS.flatMap(([i, j], k) => (ATOMS[i] === 'B' || ATOMS[j] === 'B' ? [k] : []));
    const blueBonds = () => SPECIES.reduce((t, s) => t + f.n[s.i] * blue.filter((k) => s.mask & (1 << k)).length, 0);
    run(net, f, 10);
    // the target's R–G bond can break at this heat, but with no black around, blue can't move
    expect(blueBonds()).toBe(20 * M);
    expect(f.n[singleOf('B')]).toBe(50 * M);
  });

  it('displaces black with a free atom, keeping the shape: R–K + G gives R–G + K', () => {
    const f = fluid([[RK, 50], single('G', 50)]);
    const [r] = net.netRates(f);
    expect(r.from).toEqual([RK, singleOf('G')].sort((a, b) => a - b));
    expect(r.to).toEqual([RG, singleOf('K')].sort((a, b) => a - b));
  });

  it('displaces with free black too, uphill as well as down', () => {
    // R–G + K → R–K + G is all but impossibly uphill in this chemistry, but it exists
    const f = fluid([[RG, 50], single('K', 50)]);
    const rates = net.netRates(f);
    const back = rates.find((r) => r.to.length === 2 && r.to.includes(RK));
    expect(back?.from).toEqual([RG, singleOf('K')].sort((a, b) => a - b));
    expect(back!.rate).toBeGreaterThan(0);
  });

  it('swaps blue into △RGK in place of its black, uphill', () => {
    const f = fluid([[tri('R', 'G', 'K'), 50], single('B', 150)], 10);
    run(net, f, 30);
    expect(f.n[TARGET]).toBeGreaterThan(0.1 * M);
    expect(f.n[singleOf('K')]).toBeGreaterThan(0.1 * M);
  });

  it('gives the target back to any black it meets, downhill', () => {
    const f = fluid([[TARGET, 50], single('K', 10)]);
    run(net, f, 30);
    // most of the black frees a blue, though some instead bonds onto a target, where it's no longer free to
    expect(f.n[singleOf('B')]).toBeGreaterThan(5 * M);
    expect(f.n[TARGET]).toBeLessThanOrEqual(50 * M - f.n[singleOf('B')]);
  });

  it('displaces only a free atom, of a color not already in the molecule, with black on one side', () => {
    // everything at once, hot, so every reaction there is shows
    const f = fluid(SPECIES.map((s) => [s.i, 1] as [number, number]), 30);
    const singles = new Set(ATOMS.map(singleOf));
    const K = singleOf('K');
    for (const r of net.netRates(f)) {
      if (r.from.length !== 2 || r.to.length !== 2) continue;
      // a molecule and a free atom on each side, black free on one side and not the other
      for (const side of [r.from, r.to]) expect(side.filter((s) => singles.has(s))).toHaveLength(1);
      expect(r.from.includes(K) !== r.to.includes(K)).toBe(true);
      const [m, x] = singles.has(r.from[0]) ? [r.from[1], r.from[0]] : r.from;
      expect(SPECIES[m].atoms).not.toContain(SPECIES[x].atoms[0]);
      expect(SPECIES[m].size).toBeGreaterThan(1);
    }
    // a free atom whose color the molecule has does nothing to it
    expect(net.netRates(fluid([[RK, 10], single('R', 10)], 0.01)).filter((r) => r.from.length === 2)).toEqual([]);
    expect(net.netRates(fluid([[RK, 10], single('K', 10)], 0.01)).filter((r) => r.from.length === 2)).toEqual([]);
    // two molecules never trade bound atoms, only join
    const two = net.netRates(fluid([[RK, 10], [pairOf('G', 'B'), 10]], 30)).filter((r) => r.from.length === 2);
    for (const r of two) expect(r.to).toHaveLength(1);
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
    // G and K bind slowly, far slower than a substep
    const start = fluid([single('G', 500), single('K', 500)]);
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
    const RG = pairOf('R', 'G');
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
    const atoms = ATOMS.map((a) => ({ R: 2, G: 1, B: 1, K: 3 } as Partial<Record<Atom, number>>)[a] ?? 0);
    const N = 1e9;
    const n = equilibrium(atoms.map((v) => (v / 7) * N), net.U, 1.5);
    const f: Fluid = { n, N, Q: heatAt(1.5, N) };
    for (const r of net.netRates(f)) expect(r.rate).toBeLessThan(N * 1e-6);
  });
});

describe('activity', () => {
  const net = new ReactionNetwork(testChemParams());
  const [FORMATION, CLOSURE, BREAKING, DISPLACEMENT] = REACTION_KINDS.map((_, k) => k);

  it('knows each reaction by its kind', () => {
    const kinds = REACTION_KINDS.map(() => 0);
    let n = 0;
    net.forEach((r) => {
      n++;
      kinds[r.kind]++;
      // two molecules join into one, one changes or splits on its own, or a free atom and a molecule trade
      if (r.kind === FORMATION) expect([r.rb >= 0, r.p2 < 0]).toEqual([true, true]);
      if (r.kind === CLOSURE) expect([r.rb < 0, r.p2 < 0, SPECIES[r.p1].has === SPECIES[r.ra].has]).toEqual([true, true, true]);
      if (r.kind === BREAKING) expect(r.rb).toBe(-1);
      if (r.kind === DISPLACEMENT) expect([r.rb >= 0, r.p2 >= 0, SPECIES[r.rb].size, SPECIES[r.p2].size]).toEqual([true, true, 1, 1]);
    });
    expect(n).toBe(net.count);
    for (const k of kinds) expect(k).toBeGreaterThan(0);
    // every bond that can form can break again, between molecules or within one
    expect(kinds[FORMATION] + kinds[CLOSURE]).toBe(kinds[BREAKING]);
  });

  it('is nothing in an empty fluid, or one that cannot react', () => {
    expect(net.activity(fluid([]))).toEqual([0, 0, 0, 0]);
    expect(net.activity(fluid([single('R', 3)]))).toEqual([0, 0, 0, 0]);
    expect(net.activity(fluid([single('G', 1), single('B', 1), [SOLVENT_SPECIES, 5]]))).toEqual([0, 0, 0, 0]);
  });

  it('counts the events of each kind a sim second, per molecule, at the rates as they are', () => {
    // red and green only bond: half a million pairs' worth of meetings, over two million molecules
    const a = net.activity(fluid([single('R', 1), single('G', 1)]));
    expect(a[FORMATION]).toBeCloseTo(0.25 * Math.exp(-2), 12);
    expect([a[CLOSURE], a[BREAKING], a[DISPLACEMENT]]).toEqual([0, 0, 0]);
    // hotter, more; and the same whatever the amount
    const hot = net.activity(fluid([single('R', 1), single('G', 1)], 2));
    expect(hot[FORMATION]).toBeCloseTo(0.25 * Math.exp(-1), 12);
    expect(net.activity(fluid([single('R', 7), single('G', 7)]))[FORMATION]).toBeCloseTo(a[FORMATION], 12);
    // R–K with free blue: blue displaces black (uphill by 5), and R–K breaks on its own (a barrier of 1 over its 4)
    const b = net.activity(fluid([[pairOf('R', 'K'), 1], single('B', 1)]));
    expect(b[DISPLACEMENT]).toBeCloseTo(Math.exp(-5) / 3 / 2, 12);
    expect(b[BREAKING]).toBeCloseTo(Math.exp(-5) / 2, 12);
    expect([b[FORMATION], b[CLOSURE]]).toEqual([0, 0]);
    // a chain that can close its ring: R–K–G, closing R–G
    const chain = sp(['R', 'K'], ['K', 'G']);
    expect(net.activity(fluid([[chain, 1]]))[CLOSURE]).toBeCloseTo(Math.exp(-2), 12);
  });

  it('is gross: a fluid at equilibrium is as busy as its exchange, though nothing changes on the whole', () => {
    const f = fluid([[pairOf('R', 'K'), 2], single('G', 1), single('B', 2)]);
    equilibrate(f, net.U, 1);
    const net0 = net.netRates(f).reduce((s, r) => s + r.rate, 0);
    const busy = net.activity(f).reduce((s, x) => s + x, 0) * f.n.reduce((s, x) => s + x, 0);
    expect(busy).toBeGreaterThan(0);
    expect(net0).toBeLessThan(1e-3 * busy);
  });

  it('fills the array it is given', () => {
    const out = [9, 9, 9, 9];
    expect(net.activity(fluid([single('R', 1), single('G', 1)]), out)).toBe(out);
    expect(out[BREAKING]).toBe(0);
    expect(out[FORMATION]).toBeGreaterThan(0);
  });
});

describe('equilibrium', () => {
  const net = new ReactionNetwork(testChemParams());
  const atoms = (counts: Partial<Record<Atom, number>>) => ATOMS.map((a) => counts[a] ?? 0);

  it('conserves atoms', () => {
    const want = atoms({ R: 2, G: 1, K: 3 });
    const n = equilibrium(want, net.U, 2);
    expect(atomCounts({ n, N: 6, Q: 0 })).toEqual(want.map((v) => expect.closeTo(v, 10)));
  });

  it('carries the solvent through, conserved and alone, and dilutes the rest by it', () => {
    const T = 3;
    const want = atoms({ R: 1, G: 1, S: 2 });
    const n = equilibrium(want, net.U, T);
    expect(n[SOLVENT_SPECIES]).toBeCloseTo(2, 10);
    expect(atomCounts({ n, N: 4, Q: 0 })).toEqual(want.map((v) => expect.closeTo(v, 10)));
    // R + G ⇌ R–G balances with mole fractions over every atom, the solvent's included: n_R·n_G/N = n_RG·e^(−E/T)
    const [R, G, RG] = [singleOf('R'), singleOf('G'), pairOf('R', 'G')];
    const E = net.params.bonds.RG.E;
    expect((n[R] * n[G]) / 4 / (n[RG] * Math.exp(-E / T))).toBeCloseTo(1, 6);
    // so diluting shifts it toward the free atoms
    const neat = equilibrium(atoms({ R: 1, G: 1 }), net.U, T);
    expect(n[RG]).toBeLessThan(neat[RG]);
  });

  it('equilibrates a fluid with solvent in it, keeping every atom', () => {
    const f = fluid([single('R', 3), single('G', 2), single('K', 1), single('S', 4)], 0.7);
    const before = atomCounts(f);
    equilibrate(f, net.U, 0.7);
    expect(atomCounts(f)).toEqual(before);
    expect(f.n[SOLVENT_SPECIES]).toBe(4 * M);
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
    const [R, G, RG] = [singleOf('R'), singleOf('G'), pairOf('R', 'G')];
    // formation rate ∝ n_R·n_G/N, breaking rate ∝ n_RG·e^(−E/T), with N = 2 atoms
    const E = net.params.bonds.RG.E;
    expect((n[R] * n[G]) / 2 / (n[RG] * Math.exp(-E))).toBeCloseTo(1, 9);
  });

  it('satisfies detailed balance for displacement', () => {
    const T = 20;
    const n = equilibrium(atoms({ R: 1, G: 1, K: 1 }), net.U, T);
    const [RK, G, RG, K] = [pairOf('R', 'K'), singleOf('G'), pairOf('R', 'G'), singleOf('K')];
    // R–K + G ⇌ R–G + K, with no barrier: forward ∝ n_RK·n_G·e^(−max(0, ΔU)/T), back ∝ n_RG·n_K·e^(−max(0, −ΔU)/T)
    const dU = net.U[RG] - net.U[RK];
    expect((n[RK] * n[G]) / (n[RG] * n[K]) / Math.exp(dU / T)).toBeCloseTo(1, 9);
  });

  it('equilibrates a fluid in whole molecules, keeping every atom and its temperature', () => {
    // blue bonds never form by the kinetics, but equilibrate goes all the way regardless
    const f = fluid([single('R', 3), single('G', 2), single('B', 1), single('K', 1)], 0.7);
    const before = atomCounts(f);
    equilibrate(f, net.U, 0.7);
    expect(atomCounts(f)).toEqual(before);
    expect(f.n.every(Number.isInteger)).toBe(true);
    expect(temperature(f)).toBeCloseTo(0.7, 6);
    const want = equilibrium(before, net.U, 0.7);
    for (let s = 0; s < NS; s++) expect(Math.abs(f.n[s] - want[s])).toBeLessThan(Math.max(10, want[s] * 1e-6));
  });

  it('favors the most stable shape of a triple', () => {
    // △RGK has all three bonds; every other arrangement of R, G and K has fewer
    const n = equilibrium(atoms({ R: 1, G: 1, K: 1 }), net.U, 1);
    const ring = tri('R', 'G', 'K');
    expect(n[ring]).toBeGreaterThan(0.5);
  });
});
