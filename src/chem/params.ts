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
  /** Keyed by color pair in ATOMS order (see BOND_KEYS): "RG", "RB", "GB", "RK", "GK", "BK". */
  bonds: Record<string, BondParams>;
  /** Prefactor for displacements (Ea = 0), where a free atom and a bound one trade places, black on one side. */
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
  // each bond energy is a round number times a random factor from 0.8 to 1.2, drawn once (and redrawn until no two
  // were within 5% of each other), so no two bonds sit on the same line in the spectroscope
  const bonds: Record<string, Omit<BondParams, 'A'> & { A?: number }> = {
    RG: { E: 20.72, Ea: 2 },
    // blue: uphill (E < 0), and never formed or broken directly (A = 0), so
    // blue only enters or leaves a molecule by displacing black, or being displaced by it
    RB: { E: -0.92, Ea: 1, A: 0 }, GB: { E: -0.97, Ea: 1, A: 0 },
    // black: a high barrier, so it hardly bonds or unbonds at room temperature
    RK: { E: 4.28, Ea: 10 }, GK: { E: 4.64, Ea: 10 },
    BK: { E: -1.13, Ea: 1, A: 0 },
  };
  return {
    bonds: Object.fromEntries(
      Object.entries(bonds).map(([k, b]) => [k, { E: b.E, Ea: b.Ea, A: b.A ?? A_DEFAULT }]),
    ),
    swapA: 1.0,
  };
}

/** Put the default chemistry back in place: every bond, the displacement prefactor, and the heat capacity. */
export function restoreDefaultChem(params: ChemParams): void {
  const d = defaultChemParams();
  params.bonds = d.bonds;
  params.swapA = d.swapA;
  THERMO.heatCap = DEFAULT_HEAT_CAP;
}
