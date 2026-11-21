import { describe, expect, it } from 'vitest';
import { DEGREES, END_WEIGHT, LOOSE_ENDS, RINGED } from './shape';
import { SOLVENT_SPECIES, SPECIES, TARGET, bondMask, pairOf, singleOf, speciesIndex } from './species';

describe('molecular shape', () => {
  const chain = speciesIndex(['R', 'G', 'B'], bondMask(['R', 'G'], ['G', 'B']));
  const star = speciesIndex(['R', 'G', 'B', 'K'], bondMask(['R', 'G'], ['R', 'B'], ['R', 'K']));
  const all = speciesIndex(['R', 'G', 'B', 'K'], bondMask(['R', 'G'], ['R', 'B'], ['G', 'B'], ['R', 'K'], ['G', 'K'], ['B', 'K']));

  it('counts each atom\'s bonds', () => {
    expect(DEGREES[singleOf('R')]).toEqual([0]);
    expect(DEGREES[pairOf('R', 'G')]).toEqual([1, 1]);
    expect(DEGREES[chain]).toEqual([1, 2, 1]);
    expect(DEGREES[TARGET]).toEqual([2, 2, 2]);
    expect(DEGREES[star]).toEqual([3, 1, 1, 1]);
    expect(DEGREES[all]).toEqual([3, 3, 3, 3]);
    // every bond has two ends
    SPECIES.forEach((sp, s) => {
      let bonds = 0;
      for (let m = sp.mask; m; m &= m - 1) bonds++;
      expect(DEGREES[s].reduce((a, b) => a + b, 0)).toBe(2 * bonds);
    });
  });

  it('finds the loose ends: none on a ring or a lone atom, two on a chain, three on a star', () => {
    expect(LOOSE_ENDS[singleOf('K')]).toEqual([]);
    expect(LOOSE_ENDS[TARGET]).toEqual([]);
    expect(LOOSE_ENDS[all]).toEqual([]);
    expect(LOOSE_ENDS[pairOf('R', 'G')]).toEqual(['R', 'G']);
    expect(LOOSE_ENDS[chain]).toEqual(['R', 'B']);
    expect(LOOSE_ENDS[star]).toEqual(['G', 'B', 'K']);
    expect(END_WEIGHT[TARGET]).toBe(0);
    expect(END_WEIGHT[chain]).toBe(SPECIES[singleOf('R')].weight + SPECIES[singleOf('B')].weight);
  });

  it('finds the rings: a triangle, alone or with a tail, and every four-atom molecule with four bonds or more', () => {
    const tailed = speciesIndex(['R', 'G', 'B', 'K'], bondMask(['R', 'G'], ['R', 'B'], ['G', 'B'], ['B', 'K']));
    const square = speciesIndex(['R', 'G', 'B', 'K'], bondMask(['R', 'G'], ['G', 'B'], ['B', 'K'], ['R', 'K']));
    const chain4 = speciesIndex(['R', 'G', 'B', 'K'], bondMask(['R', 'G'], ['G', 'B'], ['B', 'K']));
    for (const s of [TARGET, tailed, square, all]) expect(RINGED[s], SPECIES[s].name).toBe(true);
    for (const s of [singleOf('R'), SOLVENT_SPECIES, pairOf('R', 'G'), chain, star, chain4]) expect(RINGED[s], SPECIES[s].name).toBe(false);
    // the four triangles, one to each three colors, and 22 of the 38 four-atom shapes: all but the 16 trees
    expect(RINGED.filter(Boolean)).toHaveLength(4 + 22);
  });
});
