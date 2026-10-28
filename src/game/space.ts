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
export const ROOM = { x0: -700, x1: 2300, z0: 0, z1: 3000, y1: 1300 };
/**
 * How fast the ship turns, in radians per sim second: the lab is on the rim of a ring 10 km in radius, spun for 1 g,
 * √(g / r), about one turn every 200 s. It turns about an axis square to the left wall (x), so the stars wheel round
 * the middle of the porthole in it.
 */
export const SPIN = Math.sqrt(9.81 / 10_000);
/**
 * The side of a cell of the room's grid, across the floor: whatever's set down stands squarely in it, facing one of
 * the four ways along it, with every mouth and spout over the middle of a cell (see toCell). Cells' edges are at whole
 * multiples of it, so the walls, and every counter's edges, run along them.
 */
export const CELL = 100;

/** The middle of the grid cell that x (or z) is in. */
export const toCell = (v: number) => (Math.floor(v / CELL) + 0.5) * CELL;

/** The nearest of the four ways along the grid: a yaw of a whole number of quarter turns. */
export const toCardinal = (yaw: number) => wrapAngle(Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2));

/**
 * The panels the walls are lined with (see the walls' texture in surfaces.ts): this wide, and a third of the room high,
 * their seams at whole multiples of each along every wall from its left end as it faces into the room, and up from
 * the floor.
 */
export const WALL_PANEL = { w: 220, h: ROOM.y1 / 3 };

/** Height of every counter: the sink counters along the walls, and the islands. */
export const LIFT = 420;
/** How far the back wall's counter comes out from it: two grid cells. */
export const COUNTER_D = 2 * CELL;
/** How far the right wall's counter, under the faucets, comes out from it: one grid cell, so they're in easy reach. */
export const SINK_D = CELL;
/**
 * The islands' size, across and front to back, and where their grid starts and how far apart they are, all in whole
 * grid cells: each is ten cells by four.
 */
const ISLAND = { w: 10 * CELL, d: 4 * CELL, x0: -4 * CELL, z0: 6 * CELL, dx: 13 * CELL, dz: 8 * CELL, cols: 2, rows: 3 };
/** A counter: its x and z extents, and whether it's an island out in the room rather than a sink counter on a wall. */
export interface Counter {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  island?: boolean;
}
/**
 * The counters, all LIFT high, as x and z extents: one along the back wall under the old bench, one along the right
 * wall under the faucets, and a grid of islands out in the room, like an undergraduate lab's benches.
 */
export const COUNTERS: readonly Counter[] = [
  { x0: ROOM.x0, x1: ROOM.x1 - SINK_D, z0: ROOM.z0, z1: ROOM.z0 + COUNTER_D },
  { x0: ROOM.x1 - SINK_D, x1: ROOM.x1, z0: ROOM.z0, z1: ROOM.z1 },
  ...Array.from({ length: ISLAND.cols * ISLAND.rows }, (_, i) => {
    const x0 = ISLAND.x0 + (i % ISLAND.cols) * ISLAND.dx;
    const z0 = ISLAND.z0 + Math.floor(i / ISLAND.cols) * ISLAND.dz;
    return { x0, x1: x0 + ISLAND.w, z0, z1: z0 + ISLAND.d, island: true };
  }),
];

/** How high the floor or counter is under (x, z): where whatever falls there goes down the sink. */
export function groundAt(x: number, z: number): number {
  return COUNTERS.some((c) => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) ? LIFT : 0;
}
/**
 * The top of the counter a footprint (a rectangle `hx` by `hz` either side of (x, z), turned by `yaw` like a box) lies
 * wholly on, or null if it doesn't lie wholly on one: things are set down only squarely on a counter.
 */
export function counterUnder(f: { x: number; z: number; hx: number; hz: number; yaw: number }): number | null {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const corners = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => ({ x: f.x + sx * f.hx * c + sz * f.hz * s, z: f.z - sx * f.hx * s + sz * f.hz * c })),
  );
  const on = COUNTERS.find((k) => corners.every((p) => p.x >= k.x0 && p.x <= k.x1 && p.z >= k.z0 && p.z <= k.z1));
  return on ? LIFT : null;
}
/** How far out from the back wall sticky notes are, so they lie on its face. */
export const PAPER_Z = 0.6;
/**
 * How far out from the back wall things stand when nothing says otherwise: over the counter, in the middle of its
 * second row of grid cells, so a tool's stand behind it has the first.
 */
export const Z_HOME = 1.5 * CELL;
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
