import { HOME_H, HOME_W } from './config';
import type { Point } from './flask';

/**
 * The lab, in world units (a flask is 70 tall), with y up. It's drawn flat, square on to the back wall, and worked
 * in two dimensions: all the equipment hangs or stands in one upright plane a little way out from the back wall (see
 * PLANE_Z), facing out from it, and is moved only across the wall and up and down it. x runs along the wall, y is
 * height above the floor, and z comes out of the wall into the room, as it did when the lab was a room to walk round
 * (see flatten.ts).
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where something is: a point, and how far it's turned about the vertical (counterclockwise seen from above).
 * Everything in the lab faces out from the wall, a yaw of 0; only saves from when the lab was walked round have any
 * other (see flatten.ts).
 */
export interface Pose extends Vec3 {
  yaw: number;
}

export const ORIGIN: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

/**
 * The room's walls, floor and ceiling: a long gallery. The back wall, at z = 0, is the one the lab is on; the wall
 * opposite, behind the player, is at z1.
 */
export const ROOM = { x0: -700, x1: 8300, z0: 0, z1: 3000, y1: 1300 };
/**
 * How far apart a tool's mouths and spouts are along it, or a whole number of times this: so a row of flasks, or of
 * tanks, this far apart can stand under a row of spouts.
 */
export const CELL = 100;

/**
 * The panels the back wall is lined with (see drawWall in flatRoom.ts): this wide, and a third of the room high, their
 * seams at whole multiples of each along it from its left end, and up from the floor.
 */
export const WALL_PANEL = { w: 220, h: ROOM.y1 / 3 };

/** Height of the counter along the foot of the back wall. */
export const LIFT = 420;
/**
 * How far out from the back wall everything in the lab is: tools, flasks, scales, hoses' nozzles, spouts and streams
 * are all in the upright plane this far out, so whatever leaves a spout falls into whatever's under it.
 */
export const PLANE_Z = 120;
/** How far the counter comes out from the back wall: twice as far as what stands on it. */
export const COUNTER_D = 2 * PLANE_Z;
/**
 * Where the equipment cabinet stands (see cabinet.ts): against the back wall from its left end, 1800 along it and
 * 300 out from it, and as tall as its shelves need. The counter runs on from its end.
 */
export const CABINET_AREA = { x0: ROOM.x0, x1: ROOM.x0 + 18 * CELL, z0: ROOM.z0, z1: ROOM.z0 + 3 * CELL };
/**
 * The bench: the stretch of the back wall equipment can be left on, from the cabinet's end to the wall's, and from
 * the counter's top to the ceiling.
 */
export const BENCH = { x0: CABINET_AREA.x1, x1: ROOM.x1, y0: LIFT, y1: ROOM.y1 };
/** A counter: its x and z extents. */
export interface Counter {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
/** The counters, all LIFT high, as x and z extents: the one along the back wall under the bench, from the cabinet on. */
export const COUNTERS: readonly Counter[] = [{ x0: BENCH.x0, x1: BENCH.x1, z0: ROOM.z0, z1: ROOM.z0 + COUNTER_D }];

/** How high the floor or counter is under (x, z): where whatever falls there goes down the sink. */
export function groundAt(x: number, z: number): number {
  return COUNTERS.some((c) => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) ? LIFT : 0;
}
/** Where the old flat bench's sink was, in its own units, down from the top of its home area. */
const SINK_2D = HOME_H - 16;

/**
 * A position stored as fractions of the old flat bench's home area (see HOME_W), as presets and saves keep tools,
 * scales and hose ends, on the wall: a thousand to the unit across, and up from the counter.
 */
export function fromFrac(f: Point, z = PLANE_Z): Vec3 {
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

export const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
