import { HOME_H, HOME_W } from './config';
import type { Point } from './flask';

/**
 * The lab in three dimensions, in world units (a flask is 70 tall), with y up. The old flat bench is its back
 * wall: x runs along the wall as it did across the bench, height comes from the bench's height above its sink,
 * and z comes out of the wall into the room.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where something is: a point, and how far it's turned about the vertical (counterclockwise seen from above). */
export interface Pose extends Vec3 {
  yaw: number;
}

export const ORIGIN: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

/** The room's walls, floor and ceiling. The back wall, at z = 0, is the old bench. */
export const ROOM = { x0: -600, x1: 1600, z0: 0, z1: 1700, y1: 1300 };
/** Height of the sink counter along the back wall: the old bench's sink. */
export const LIFT = 300;
/** How far the counters come out from the walls. */
export const COUNTER_D = 130;
/**
 * The sink counters, LIFT high, as x and z extents: one along the back wall under the old bench, and one along the
 * right wall under the faucets.
 */
export const COUNTERS = [
  { x0: ROOM.x0, x1: ROOM.x1 - COUNTER_D, z0: ROOM.z0, z1: ROOM.z0 + COUNTER_D },
  { x0: ROOM.x1 - COUNTER_D, x1: ROOM.x1, z0: ROOM.z0, z1: ROOM.z1 },
];

/** How high the floor or counter is under (x, z): where whatever falls there goes down the sink. */
export function groundAt(x: number, z: number): number {
  return COUNTERS.some((c) => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) ? LIFT : 0;
}
/** How far out from the back wall things stand when nothing says otherwise: over the counter. */
export const Z_HOME = 70;
/** Where the old bench's sink was, in its own units, down from the top of its home area. */
const SINK_2D = HOME_H - 16;

/**
 * A position stored as fractions of the old bench's home area (see HOME_W), as presets and saves keep tools,
 * scales and hose ends, in the room: across stays across, and up is up from the counter.
 */
export function fromFrac(f: Point, z = Z_HOME): Vec3 {
  return { x: f.x * HOME_W, y: LIFT + SINK_2D - f.y * HOME_H, z };
}

export function toFrac(p: Vec3): Point {
  return { x: p.x / HOME_W, y: (LIFT + SINK_2D - p.y) / HOME_H };
}

/** A point in something's own frame (x right, y up, z toward its front), in the room. */
export function toWorld(pose: Pose, l: Vec3): Vec3 {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  return { x: pose.x + l.x * c + l.z * s, y: pose.y + l.y, z: pose.z - l.x * s + l.z * c };
}

/** A point in the room, in something's own frame (see toWorld). */
export function toLocal(pose: Pose, p: Vec3): Vec3 {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  const dx = p.x - pose.x;
  const dz = p.z - pose.z;
  return { x: dx * c - dz * s, y: p.y - pose.y, z: dx * s + dz * c };
}

/** An angle wrapped into (−π, π]. */
export function wrapAngle(a: number): number {
  a %= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

export const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
