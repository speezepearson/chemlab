import type { ChemParams } from './params';

/**
 * A fixed chemistry for tests, written out in full, so tests of how the chemistry works don't break whenever the
 * game's default chemistry (defaultChemParams) is tuned. It has what those tests need: an R–G bond that's strong and
 * quick; blue bonds that are uphill and never form or break directly (A = 0); and black bonds that are weak, R–K quick and G–K slow.
 */
export function testChemParams(): ChemParams {
  const b = (E: number, Ea: number, A = 1) => ({ E, Ea, A });
  return {
    bonds: {
      RG: b(100, 2), RB: b(-1, 1, 0), GB: b(-1, 1, 0),
      RK: b(4, 1), GK: b(3, 4), BK: b(-1, 1, 0),
    },
    swapA: 1,
  };
}
