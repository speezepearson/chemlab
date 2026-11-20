import { CABINET_AREA, COUNTERS, ROOM } from './space';

/**
 * Where the player can stand, walking round the room (the walk mode, see ViewMode), seen from above: x along the back
 * wall and z out from it. The player is a round body BODY_R across the middle, kept inside the room and out of what
 * stands on the floor along the back wall, the counter under the bench and the equipment cabinet at its end. Those
 * run the whole length of the back wall, so nobody reaches the bench's plane: everything there is worked from a
 * distance. The airlock's doorway is in the wall opposite, which holds them in like the others: they can't walk into
 * the airlock (the view only glides in and out of it, see GameEngine.board and emerge).
 */

/** Where the player stands, seen from above. */
export interface Stand {
  x: number;
  z: number;
}

/** A stretch of the floor nobody can stand on, as x and z extents. */
export interface Solid {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The player's body's radius, in world units. */
export const BODY_R = 45;

/** What stands on the floor: the counter along the back wall, and the equipment cabinet at its end. */
export const SOLIDS: readonly Solid[] = [...COUNTERS, CABINET_AREA];

/**
 * How far, at most, a walk is taken in one go (see walk): less than anything solid is deep, so nothing is walked
 * through in one step, however long a frame is.
 */
const STEP = BODY_R;

/** How many halvings a step that would run into something is cut down by, to come up close against it. */
const HALVINGS = 12;

/** Whether a body of radius `r` standing at `p` overlaps a solid: the nearest point of the solid is nearer than r. */
function hits(p: Stand, s: Solid, r: number): boolean {
  const dx = Math.max(s.x0 - p.x, 0, p.x - s.x1);
  const dz = Math.max(s.z0 - p.z, 0, p.z - s.z1);
  return dx * dx + dz * dz < r * r;
}

/** A place kept inside the room, as far from its walls as the body's radius. */
function inRoom(p: Stand): Stand {
  return {
    x: Math.max(ROOM.x0 + BODY_R, Math.min(ROOM.x1 - BODY_R, p.x)),
    z: Math.max(ROOM.z0 + BODY_R, Math.min(ROOM.z1 - BODY_R, p.z)),
  };
}

/** Whether the player could stand at `p`: inside the room, clear of its walls and of everything solid. */
export function canStand(p: Stand): boolean {
  const q = inRoom(p);
  return q.x === p.x && q.z === p.z && !SOLIDS.some((s) => hits(p, s, BODY_R));
}

/**
 * Where the player ends up, walking (dx, dz) from `from`: as far as they get, sliding along whatever they walk into.
 * The walk is taken a STEP at a time, along each axis on its own, so a step blocked across still goes on along; and
 * a step that would run into something goes as far as it can before it does. The room's walls hold them in the
 * same way. Anything they already stand in (which they shouldn't) doesn't hold them, so they can walk out of it.
 */
export function walk(from: Stand, dx: number, dz: number): Stand {
  const live = SOLIDS.filter((s) => !hits(from, s, BODY_R));
  const free = (p: Stand) => !live.some((s) => hits(p, s, BODY_R));
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / STEP));
  let p = inRoom(from);
  for (let i = 0; i < n; i++)
    for (const [ax, az] of [[dx / n, 0], [0, dz / n]]) {
      if (!ax && !az) continue;
      const to = (u: number) => inRoom({ x: p.x + ax * u, z: p.z + az * u });
      if (free(to(1))) {
        p = to(1);
        continue;
      }
      // the furthest it gets toward there without running into anything
      let [lo, hi] = [0, 1];
      for (let k = 0; k < HALVINGS; k++) {
        const mid = (lo + hi) / 2;
        if (free(to(mid))) lo = mid;
        else hi = mid;
      }
      p = to(lo);
    }
  return p;
}
