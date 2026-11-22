import { toWorld, type Pose, type Vec3 } from './space';

/**
 * Collisions in the lab. Nothing falls (whatever the player lets go of stays where it's left, on the counter or held
 * up by a clamp stand), nothing turns, and everything is in one upright plane (see PLANE_Z), so every body is
 * a box square to the room, or an upright cylinder, or made of several such parts. What the player holds passes
 * through everything, and is only checked for room where it's let go, so there's nothing to this but whether two
 * bodies overlap.
 */

/**
 * A box, square to the room: its center, and its half-size along x, y and z. Or, if `round`, an upright cylinder `hx`
 * (which is `hz`) in radius. If it has `parts`, it's solid only in them, and it bounds them all. (Its yaw, which a
 * pose has, is always 0.)
 */
export interface Box extends Pose {
  hx: number;
  hy: number;
  hz: number;
  round?: boolean;
  parts?: readonly Part[];
}

/** One solid part of a box (see Box.parts): a box, or a cylinder if round, its middle offset from the box's. */
export interface Part {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  round?: boolean;
}

/** The solid parts of a box, in the room: itself, if it's solid all through. */
export function solids(b: Box): Box[] {
  if (!b.parts) return [b];
  return b.parts.map((p) => ({ x: b.x + p.x, y: b.y + p.y, z: b.z + p.z, yaw: 0, hx: p.hx, hy: p.hy, hz: p.hz, round: p.round }));
}

/** How far a point (x, z) on the floor is from a box's footprint, across: 0 inside it. */
function footprintGap(b: Box, x: number, z: number): number {
  const lx = x - b.x;
  const lz = z - b.z;
  return Math.hypot(lx - Math.max(-b.hx, Math.min(b.hx, lx)), lz - Math.max(-b.hz, Math.min(b.hz, lz)));
}

/** A body's box, given in its own frame (center and half-size), placed at a pose. */
export function placeBox(pose: Pose, center: Vec3, half: Vec3): Box {
  const c = toWorld(pose, center);
  return { ...c, yaw: 0, hx: half.x, hy: half.y, hz: half.z };
}

/** Whether two boxes overlap by more than `slop` (so boxes merely touching don't count): in their solid parts, if they have any. */
export function boxesOverlap(a: Box, b: Box, slop = 0.01): boolean {
  if (!a.parts && !b.parts) return solidsOverlap(a, b, slop);
  if (!solidsOverlap({ ...a, parts: undefined }, { ...b, parts: undefined }, slop)) return false;
  const bs = solids(b);
  return solids(a).some((p) => bs.some((q) => solidsOverlap(p, q, slop)));
}

/** Whether two solid boxes or cylinders (with no parts) overlap by more than `slop`. */
function solidsOverlap(a: Box, b: Box, slop: number): boolean {
  if (Math.abs(a.y - b.y) >= a.hy + b.hy - slop) return false;
  if (a.round && b.round) return Math.hypot(a.x - b.x, a.z - b.z) < a.hx + b.hx - slop;
  if (a.round) return footprintGap(b, a.x, a.z) < a.hx - slop;
  if (b.round) return footprintGap(a, b.x, b.z) < b.hx - slop;
  return Math.abs(a.x - b.x) < a.hx + b.hx - slop && Math.abs(a.z - b.z) < a.hz + b.hz - slop;
}
