export const CAP = 1e9; // flask capacity, atoms
export const POUR_RATE = (7 / 30) * CAP; // atoms/s, flask to flask
export const FILL_RATE = (11 / 30) * CAP; // atoms/s, from faucet
export const N_FLASKS = 8;
/**
 * The sum in the intro: the passengers still asleep, the days left to Mu Ceti, the cryostabilizer each needs a day,
 * and what's left on board, which is the cryostabilizer reference's hundred flasks.
 */
export const VOYAGE = { passengers: 32_210, days: 4_456, mlPerPassengerDay: 0.000035, presentL: 2.811 };
/** Litres in a flask (by volume): what the reference's hundred flasks make the 2.811 L that's left. */
export const FLASK_L = VOYAGE.presentL / 100;
/** The cryostabilizer needed to reach Mu Ceti, in litres: the intro's sum, about 5.023 L. */
export const GOAL_L = (VOYAGE.passengers * VOYAGE.mlPerPassengerDay * VOYAGE.days) / 1000;
/**
 * The target to win, by volume (see VOLUME), delivered through the receptacle: GOAL_L, about 179 flasks. A single
 * good load does it: a full receptacle more than 95% target holds at least 181 flasks of it, even when what's
 * left over is all single atoms.
 */
export const GOAL_VOLUME = (GOAL_L / FLASK_L) * CAP;
/** The receptacle takes only fluid more than this pure in the target (by atoms). */
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
