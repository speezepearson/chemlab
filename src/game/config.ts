export const CAP = 1e9; // flask capacity, atoms
export const POUR_RATE = (7 / 30) * CAP; // atoms/s, flask to flask
export const FILL_RATE = (11 / 30) * CAP; // atoms/s, from faucet
export const N_FLASKS = 8;
/**
 * The sum in the intro: the passengers still asleep, the days left to Mu Ceti, the cryostabilizer each needs a day,
 * and what's left on board, which is the cryostabilizer reference's hundred flasks.
 */
export const VOYAGE = { passengers: 32_210, days: 4_456, mlPerPassengerDay: 0.0003499, presentL: 28.101 };
/** Litres in a flask (a billion molecules): what the reference's hundred flasks make the 28.101 L that's left, about 281 mL. */
export const FLASK_L = VOYAGE.presentL / 100;
/** The cryostabilizer needed to reach Mu Ceti, in litres: the intro's sum, about 50.22 L. */
export const GOAL_L = (VOYAGE.passengers * VOYAGE.mlPerPassengerDay * VOYAGE.days) / 1000;
/**
 * The target to win, in molecules: GOAL_L, about 179 flasks of it, in the cryostabilizer reference, which starts with
 * a hundred (see REFERENCE_START).
 */
export const GOAL_TARGET = (GOAL_L / FLASK_L) * CAP;
/** The station's diverter sends only fluid more than this pure in the target (by atoms) into the reference. */
export const GOAL_PURITY = 0.95;
/** Amounts of fluid below this many atoms count as nothing: too little to see or pour. */
export const TRACE = CAP * 1e-6;
/**
 * The world is laid out in world units (a flask is 70 tall). It runs on forever left, right and up, above a
 * floor (the sink). Its home area, HOME_W × HOME_H on the floor with its left edge at x = 0, holds the shelf
 * of flasks and, to start with, the faucets along its top; it's where the view starts.
 */
export const HOME_W = 1000;
export const HOME_H = 620;
