import type { ChemParams } from './params';

/**
 * A fixed chemistry for tests, written out in full, so tests of how the chemistry works don't break whenever the
 * game's default chemistry (defaultChemParams) is tuned. It has what those tests need: an R–G bond that's strong and
 * quick; blue bonds that are uphill and never form or break directly (A = 0); yellow bonds that are weak and quick;
 * and R, M and Y all binding each other.
 */
export function testChemParams(): ChemParams {
  const b = (E: number, Ea: number, A = 1) => ({ E, Ea, A });
  return {
    bonds: {
      RG: b(100, 2), RM: b(3, 3), CG: b(2, 4), CM: b(5, 2),
      RY: b(4, 1), CY: b(1, 2), GY: b(4, 1), MY: b(2, 2),
      RB: b(-1, 1, 0), CB: b(-1, 1, 0), GB: b(-1, 1, 0), MB: b(-1, 1, 0),
    },
    swapA: 1,
  };
}
