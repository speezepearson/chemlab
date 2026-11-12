import { describe, expect, it } from 'vitest';
import { ATOM_WEIGHT } from './atoms';
import { modes, ringOf } from './modes';
import type { Fluid } from './reactions';
import { NS, SPECIES, TARGET, bondMask, pairOf, singleOf, speciesIndex } from './species';
import { testChemParams } from './testChem';

const fluid = (...parts: [number, number][]): Fluid => {
  const n = new Float64Array(NS);
  let N = 0;
  for (const [s, count] of parts) {
    n[s] = count;
    N += count * SPECIES[s].size;
  }
  return { n, N, Q: 0 };
};

describe('how molecules ring', () => {
  const params = testChemParams();
  const chain = speciesIndex(['R', 'G', 'B'], bondMask(['R', 'G'], ['G', 'B']));

  it('gives a lone atom no note, a pair one, and every other molecule one fewer than it has atoms', () => {
    expect(modes(singleOf('R'), params)).toEqual([]);
    for (const sp of SPECIES) if (sp.size > 1) expect(modes(sp.i, params)).toHaveLength(sp.size - 1);
  });

  it('rings a pair at the square root of its bond\'s stiffness over its reduced weight', () => {
    const [w] = modes(pairOf('R', 'G'), params);
    const reduced = (ATOM_WEIGHT.R * ATOM_WEIGHT.G) / (ATOM_WEIGHT.R + ATOM_WEIGHT.G);
    expect(w).toBeCloseTo(Math.sqrt(Math.abs(params.bonds.RG.E) / reduced), 9);
    // an uphill bond is as much a spring as a stable one of the same size
    const [u] = modes(pairOf('R', 'B'), params);
    const r2 = (ATOM_WEIGHT.R * ATOM_WEIGHT.B) / (ATOM_WEIGHT.R + ATOM_WEIGHT.B);
    expect(u).toBeCloseTo(Math.sqrt(Math.abs(params.bonds.RB.E) / r2), 9);
  });

  it('rings a ring apart from a chain of the same atoms', () => {
    const [triLow, triHigh] = modes(TARGET, params);
    const [chainLow, chainHigh] = modes(chain, params);
    // the chain's blue hangs by one bond where the triangle's hangs by two, so its low note is well below
    expect(chainLow).toBeLessThan(0.85 * triLow);
    // and both have the strong bond's high note, nearly the same
    expect(chainHigh / triHigh).toBeGreaterThan(0.95);
    expect(chainHigh / triHigh).toBeLessThan(1.05);
  });

  it('follows the bond energies', () => {
    const stiffer = testChemParams();
    stiffer.bonds.RG.E *= 4;
    expect(modes(pairOf('R', 'G'), stiffer)[0]).toBeCloseTo(2 * modes(pairOf('R', 'G'), params)[0], 9);
    const none = testChemParams();
    none.bonds.RG.E = 0;
    expect(modes(pairOf('R', 'G'), none)).toEqual([]);
  });

  it('makes a fluid ring with all its species\' notes, a little of one heard well under a lot of another', () => {
    expect(ringOf(fluid(), params)).toEqual([]);
    expect(ringOf(fluid([singleOf('R'), 1000]), params)).toEqual([]);
    const pure = ringOf(fluid([TARGET, 1000]), params);
    expect(pure.map((p) => p.w).sort((a, b) => a - b)).toEqual(modes(TARGET, params));
    for (const p of pure) expect(p.a).toBeCloseTo(Math.sqrt(1 / 2), 9);
    // a tenth chains: their notes are there too, about a third as loud as the triangle's
    const mixed = ringOf(fluid([TARGET, 900], [chain, 100]), params);
    expect(mixed).toHaveLength(4);
    const low = mixed.find((p) => Math.abs(p.w - modes(chain, params)[0]) < 1e-9)!;
    expect(low.a / mixed[0].a).toBeCloseTo(1 / 3, 9);
    // only the loudest are kept
    expect(ringOf(fluid([TARGET, 900], [chain, 100]), params, 2).every((p) => p.a > 0.6)).toBe(true);
  });
});
