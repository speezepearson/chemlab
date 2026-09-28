/*
 * CHEMISTRY PARAMETERS
 * Energies in units of k_B * T_room. Barrier convention:
 * Ea is measured above the HIGHER of the two states, so
 *   downhill rate = A * exp(-Ea/T)
 *   uphill rate   = A * exp(-(Ea + |dU|)/T)
 * Species energy U = -(sum of bond energies); lower is more stable.
 */
export const T_ROOM = 1.0;
const A_DEFAULT = 1.0; // default bond prefactor, events/s

export interface BondParams {
  /** Bond energy (depth of the well). */
  E: number;
  /** Activation energy above the higher of the two states. */
  Ea: number;
  /** Arrhenius prefactor, events/s. */
  A: number;
}

export interface ChemParams {
  /** Keyed by color pair in group order, e.g. "RG", "CY". */
  bonds: Record<string, BondParams>;
  /** Prefactor for swaps (Ea = 0). */
  swapA: number;
  /** Heat capacity per atom. */
  heatCap: number;
}

export function defaultChemParams(): ChemParams {
  const bonds: Record<string, Omit<BondParams, 'A'> & { A?: number }> = {
    RG: { E: 100, Ea: 2 }, RM: { E: 3, Ea: 3 }, CG: { E: 2, Ea: 4 }, CM: { E: 5, Ea: 2 },
    RY: { E: 4, Ea: 1 }, CY: { E: 1, Ea: 2 }, GY: { E: 4, Ea: 1 }, MY: { E: 2, Ea: 2 },
    // blue: strong bonds that essentially never form directly
    RB: { E: 9, Ea: 1, A: 0.002 }, CB: { E: 7, Ea: 1, A: 0.002 },
    GB: { E: 9, Ea: 1, A: 0.002 }, MB: { E: 6, Ea: 1, A: 0.002 },
  };
  return {
    bonds: Object.fromEntries(
      Object.entries(bonds).map(([k, b]) => [k, { E: b.E, Ea: b.Ea, A: b.A ?? A_DEFAULT }]),
    ),
    swapA: 1.0,
    heatCap: 3.0,
  };
}
