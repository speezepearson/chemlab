export const CAP = 1e9; // flask capacity, atoms
export const POUR_RATE = (7 / 30) * CAP; // atoms/s, flask to flask
export const FILL_RATE = (11 / 30) * CAP; // atoms/s, from faucet
export const N_FLASKS = 8;
export const GOAL_ATOMS = 2 * CAP;
/** Only a vessel at least this pure in the target (by atoms) counts toward the goal. */
export const GOAL_PURITY = 0.99;
/** Amounts of fluid below this many atoms count as nothing: too little to see or pour. */
export const TRACE = CAP * 1e-6;
/**
 * The world is laid out in world units (a flask is 70 tall). Its home area, HOME_W × HOME_H at the bottom
 * left, holds the faucets, the shelf of flasks and the start of the sink, as the whole stage used to; the
 * world is WORLD_SCALE times the home area each way, so there's room above and to the right for more.
 */
export const HOME_W = 1000;
export const HOME_H = 620;
export const WORLD_SCALE = 5;
