export const CAP = 1e9; // flask capacity, atoms
export const POUR_RATE = (7 / 30) * CAP; // atoms/s, flask to flask
export const FILL_RATE = (11 / 30) * CAP; // atoms/s, from faucet
export const N_FLASKS = 8;
/**
 * Target atoms to win: five times what the cryostabilizer reference starts with (a hundred flasks of triangles),
 * so the reference is a fifth of the way there.
 */
export const GOAL_ATOMS = 1500 * CAP;
/** Only a vessel at least this pure in the target (by atoms) counts toward the goal. */
export const GOAL_PURITY = 0.99;
/** Amounts of fluid below this many atoms count as nothing: too little to see or pour. */
export const TRACE = CAP * 1e-6;
/**
 * The world is laid out in world units (a flask is 70 tall). It runs on forever left, right and up, above a
 * floor (the sink). Its home area, HOME_W × HOME_H on the floor with its left edge at x = 0, holds the shelf
 * of flasks and, to start with, the faucets along its top; it's where the view starts.
 */
export const HOME_W = 1000;
export const HOME_H = 620;
