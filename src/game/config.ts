export const CAP = 1e9; // flask capacity, atoms
export const POUR_RATE = (7 / 30) * CAP; // atoms/s, flask to flask
export const FILL_RATE = (11 / 30) * CAP; // atoms/s, from faucet
export const N_FLASKS = 8;
export const GOAL_ATOMS = 2 * CAP;
/** Only a vessel at least this pure in the target (by atoms) counts toward the goal. */
export const GOAL_PURITY = 0.99;
/** Amounts of fluid below this many atoms count as nothing: too little to see or pour. */
export const TRACE = CAP * 1e-6;
