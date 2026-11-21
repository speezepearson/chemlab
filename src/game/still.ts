/**
 * Whether what's in hand has been held still: falling fluid lands in something carried only once it has been, for
 * CATCH_REST_S, so sweeping an empty flask under a stream doesn't catch any of it. It's the player's hand, not the
 * sim, so it goes by real seconds, paused or not.
 */

/** How long, in real seconds, something in hand has to be held still before falling fluid lands in it. */
export const CATCH_REST_S = 0.5;

/** How far, in world units, what's held can drift from where it came to rest and still count as still. */
export const STILL_TOL = 0.5;

/** Where what's held came to rest, across and up the wall, and for how many real seconds it's been there since. */
export interface Stillness {
  x: number;
  y: number;
  s: number;
}

/**
 * How still what's held is, now at (x, y), dt real seconds after it was as `was` says (null: it's just been taken
 * in hand, which counts as moving): still for dt longer if it's no further than STILL_TOL from where it came to
 * rest, or else coming to rest here, from now.
 */
export function stillness(was: Stillness | null, x: number, y: number, dt: number): Stillness {
  if (!was || Math.hypot(x - was.x, y - was.y) > STILL_TOL) return { x, y, s: 0 };
  return { x: was.x, y: was.y, s: was.s + dt };
}

/** Whether what's held has been still long enough to catch falling fluid. */
export const catches = (st: Stillness | null): boolean => !!st && st.s >= CATCH_REST_S;
