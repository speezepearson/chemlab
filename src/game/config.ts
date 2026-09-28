export const CAP = 1e9; // flask capacity, atoms
/** A carried flask above its target fullness pours this many flasks per second per flask of excess. */
export const POUR_GAIN = 2;
export const FILL_RATE = (11 / 30) * CAP; // atoms/s, from faucet
export const N_FLASKS = 8;
export const GOAL_ATOMS = 2 * CAP;
/** Amounts of fluid below this many atoms count as nothing: too little to see or pour. */
export const TRACE = CAP * 1e-6;

/** Live-tunable controls (see the Appearance panel). */
export const CONTROLS = {
  /** How fast holding right-click lowers a carried flask's target fullness: 1 is 100% per second. */
  pourTargetRate: 1,
};
