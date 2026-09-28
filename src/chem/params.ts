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
}

/**
 * Heat capacity per atom, in energy per unit temperature. A fluid stores heat
 * as whole quanta of energy (Fluid.Q), and its temperature is derived from
 * that, so this one number turns every fluid's heat into a temperature.
 */
export const THERMO = { heatCap: 3.0 };
const DEFAULT_HEAT_CAP = THERMO.heatCap;

export function defaultChemParams(): ChemParams {
  const bonds: Record<string, Omit<BondParams, 'A'> & { A?: number }> = {
    RG: { E: 100, Ea: 2 }, RM: { E: 3, Ea: 3 }, CG: { E: 2, Ea: 4 }, CM: { E: 5, Ea: 2 },
    RY: { E: 4, Ea: 1 }, CY: { E: 1, Ea: 2 }, GY: { E: 4, Ea: 1 }, MY: { E: 2, Ea: 2 },
    // blue: uphill (E < 0), and never formed or broken directly (A = 0), so
    // blue only enters or leaves a molecule by swapping places with yellow
    RB: { E: -10, Ea: 1, A: 0 }, CB: { E: -10, Ea: 1, A: 0 },
    GB: { E: -10, Ea: 1, A: 0 }, MB: { E: -10, Ea: 1, A: 0 },
  };
  return {
    bonds: Object.fromEntries(
      Object.entries(bonds).map(([k, b]) => [k, { E: b.E, Ea: b.Ea, A: b.A ?? A_DEFAULT }]),
    ),
    swapA: 1.0,
  };
}

/** Put the default chemistry back in place: every bond, the swap prefactor, and the heat capacity. */
export function restoreDefaultChem(params: ChemParams): void {
  const d = defaultChemParams();
  params.bonds = d.bonds;
  params.swapA = d.swapA;
  THERMO.heatCap = DEFAULT_HEAT_CAP;
}
