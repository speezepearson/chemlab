/**
 * Where a sound in the lab is heard from, given where it is relative to the player's head: full volume nearby,
 * fading with distance, a little quieter behind; and panned toward whichever ear it's on.
 */
export interface Placement {
  /** 0 (silent) to 1 (close by). */
  gain: number;
  /** −1 (hard left) to 1 (hard right). */
  pan: number;
}

/** Where every sound is heard from when nothing places it: close by, straight ahead. */
export const CENTER: Placement = { gain: 1, pan: 0 };

/** Within this far, in world units (a flask is 70 tall), a sound is at full volume; it halves every doubling beyond. */
const NEAR = 400;
/** Beyond this far it's silent. */
const FAR = 6000;
/** How quiet a sound straight behind is, relative to the same sound ahead. */
const BEHIND = 0.6;
/** How far the pan swings for a sound straight off to one side. */
const SIDE_PAN = 0.8;

/**
 * A sound at (x, y, z) relative to the head: x to the right, y up, and z behind (so −z is where the player
 * looks).
 */
export function placement(x: number, y: number, z: number): Placement {
  const d = Math.hypot(x, y, z);
  if (!(d > 0)) return CENTER;
  const near = d <= NEAR ? 1 : NEAR / d;
  const fade = Math.max(0, Math.min(1, (FAR - d) / (FAR / 2)));
  // ahead (z < 0) is full, behind fades toward BEHIND
  const back = 1 - ((1 - BEHIND) * (1 + z / d)) / 2;
  const gain = near * fade * back;
  const pan = Math.max(-1, Math.min(1, (SIDE_PAN * x) / d));
  return { gain, pan };
}
