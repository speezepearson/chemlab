import { describe, expect, it } from 'vitest';
import { defaultChemParams } from './params';
import { ReactionNetwork, atomCounts, type Fluid } from './reactions';
import { NS, SPECIES, TARGET, singleOf, speciesIndex } from './species';
import type { Atom } from './atoms';

function fluid(contents: [number, number][], T = 1): Fluid {
  const n = new Float64Array(NS);
  let N = 0;
  for (const [s, count] of contents) {
    n[s] += count;
    N += count * SPECIES[s].size;
  }
  return { n, N, T };
}

function mix(a: Fluid, b: Fluid): Fluid {
  const n = new Float64Array(NS);
  for (let s = 0; s < NS; s++) n[s] = a.n[s] + b.n[s];
  return { n, N: a.N + b.N, T: (a.N * a.T + b.N * b.T) / (a.N + b.N) };
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
    atomCounts(f).forEach((c, i) => expect(c).toBeCloseTo(before[i], 6));
  });

  it('heats up from exothermic bonding', () => {
    const f = fluid([single('R', 50), single('G', 50)]);
    run(net, f, 30);
    expect(f.T).toBeGreaterThan(1.3);
  });

  it('makes the target by building △RGY and washing it with room-temperature blue', () => {
    const f = fluid([single('R', 50), single('G', 50)]);
    run(net, f, 60);
    const withY = mix(f, fluid([single('Y', 50)]));
    run(net, withY, 120);
    const RGY = speciesIndex(['R', 'G', 'Y'], 7);
    expect(withY.n[RGY]).toBeGreaterThan(20);

    const washed = mix(withY, fluid([single('B', 150)]));
    run(net, washed, 120);
    expect(washed.n[TARGET]).toBeGreaterThan(30);
    // nearly all of the yellow has been displaced from molecules
    const boundY = SPECIES.filter((s) => s.size > 1 && s.atoms[2] === 'Y').reduce((t, s) => t + washed.n[s.i], 0);
    expect(boundY).toBeLessThan(5);
  });
});
