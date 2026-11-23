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
export const ROOM = { x0: -720, x1: 2280, z0: 0, z1: 3000, y1: 1300 };
/**
 * How fast the ship turns, in radians per sim second: the lab is on the rim of a ring 10 km in radius, spun for 1 g,
 * √(g / r), about one turn every 200 s. It turns about an axis square to the left wall (x), so the stars wheel round
 * the middle of the porthole in it.
 */
export const SPIN = Math.sqrt(9.81 / 10_000);
/**
 * The room's unit of length across the floor, a cell: the walls and every counter's edges are whole numbers of cells
 * from its corner, the presets lay things out in cells, and most tools' tanks and spouts are a whole number of cells
 * apart, so that a row of tools lines up under another. Nothing keeps what's set down on cells: it stays where it's let
 * go of, or is pulled a little to line an outlet up over a mouth (see MAGNET in bodies.ts).
 */
export const CELL = 60;

/** The nearest of the four ways along the room's walls: a yaw of a whole number of quarter turns. */
export const toCardinal = (yaw: number) => wrapAngle(Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2));

/**
 * The panels the walls are lined with (see the walls' texture in surfaces.ts): this wide, and a third of the room high,
 * their seams at whole multiples of each along every wall from its left end as it faces into the room, and up from
 * the floor.
 */
export const WALL_PANEL = { w: 220, h: ROOM.y1 / 3 };

/** Height of every counter: the sink counters along the walls, and the islands. */
export const LIFT = 420;
/** How far the back wall's counter comes out from it: three cells. */
export const COUNTER_D = 3 * CELL;
/**
 * How far the right wall's counter, under the faucets, comes out from it: two cells, so they're in easy reach, over
 * its outer row, the inner row free bench.
 */
export const SINK_D = 2 * CELL;
/**
 * The islands' size, across and front to back, and where their grid starts and how far apart they are, all in whole
 * cells: each is sixteen cells by six.
 */
const ISLAND = { w: 16 * CELL, d: 6 * CELL, x0: -7 * CELL, z0: 10 * CELL, dx: 22 * CELL, dz: 13 * CELL, cols: 2, rows: 3 };
/**
 * Where the equipment cabinet stands (see cabinet.ts): against the back wall from the left wall, thirty cells
 * along it and five out from it, two cells further than the counter, and as tall as its shelves need. The back
 * counter runs on from its end.
 */
export const CABINET_AREA = { x0: ROOM.x0, x1: ROOM.x0 + 30 * CELL, z0: ROOM.z0, z1: ROOM.z0 + 5 * CELL };
/**
 * Where the shadow lamp stands (see LAMP in tools.ts): on a bench of its own in the room's front left corner, nine
 * cells along the front wall and five out from it, as high as the counters. Nothing could be set down there
 * before it was, so no save has anything standing in its way. The lamp's trough lies along its edge toward the room,
 * over its second row of cells; the two rows of cells behind it are free bench, long enough for the longest tools on
 * their stands. It stops short of the airlock's doorway.
 */
export const LAMP_AREA = { x0: ROOM.x0, x1: ROOM.x0 + 9 * CELL, z0: ROOM.z1 - 5 * CELL, z1: ROOM.z1 };
/**
 * The middle line of the shadow lamp's channel, across the room (see LAMP in tools.ts): over the middle of its bench's
 * second row of cells from the room, so its near wall stands on the bench.
 */
export const LAMP_Z = LAMP_AREA.z0 + 1.5 * CELL;
/**
 * The floor of the shadow lamp's channel (see LAMP in tools.ts): a plate lying on its bench, over the five cells
 * along the middle of the channel, from the enclosure (two cells in from the bench's end) to the end wall (two cells
 * in from the left wall), as wide as the channel (100, a little more than a cell), and its top `y` high, a little
 * above the bench's (10, as far as the lamp's beam is above the floor, see LAMP.window). What's set down in the
 * channel stands on it (see counterUnder), and what falls there lands on it (see groundAt).
 */
export const LAMP_FLOOR = {
  x0: LAMP_AREA.x0 + 2 * CELL, x1: LAMP_AREA.x1 - 2 * CELL, z0: LAMP_Z - 50, z1: LAMP_Z + 50, y: LIFT + 10,
};
/**
 * A counter: its x and z extents, and whether it's an island out in the room rather than a sink counter on a wall, or
 * the shadow lamp's own bench.
 */
export interface Counter {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  island?: boolean;
  lamp?: boolean;
}
/**
 * The counters, all LIFT high (but for the floor of the shadow lamp's channel on its bench, see LAMP_FLOOR), as x and z extents: one along the back wall under the old bench, from the equipment
 * cabinet on, one along the right wall under the faucets, a grid of islands out in the room, like an
 * undergraduate lab's benches, and last the shadow lamp's bench in the front left corner.
 */
export const COUNTERS: readonly Counter[] = [
  { x0: CABINET_AREA.x1, x1: ROOM.x1 - SINK_D, z0: ROOM.z0, z1: ROOM.z0 + COUNTER_D },
  { x0: ROOM.x1 - SINK_D, x1: ROOM.x1, z0: ROOM.z0, z1: ROOM.z1 },
  ...Array.from({ length: ISLAND.cols * ISLAND.rows }, (_, i) => {
    const x0 = ISLAND.x0 + (i % ISLAND.cols) * ISLAND.dx;
    const z0 = ISLAND.z0 + Math.floor(i / ISLAND.cols) * ISLAND.dz;
    return { x0, x1: x0 + ISLAND.w, z0, z1: z0 + ISLAND.d, island: true };
  }),
  { ...LAMP_AREA, lamp: true },
];

/**
 * How high the floor or counter is under (x, z), or the floor of the shadow lamp's channel (see LAMP_FLOOR): where
 * whatever falls there goes down the sink.
 */
export function groundAt(x: number, z: number): number {
  const within = (c: { x0: number; x1: number; z0: number; z1: number }) => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1;
  return within(LAMP_FLOOR) ? LAMP_FLOOR.y : COUNTERS.some(within) ? LIFT : 0;
}
/**
 * The top of the counter a footprint (a rectangle `hx` by `hz` either side of (x, z), turned by `yaw` like a box) lies
 * wholly on, or null if it doesn't lie wholly on one: things are set down only squarely on a counter. One wholly on
 * the floor of the shadow lamp's channel (see LAMP_FLOOR) is on that, which is a little higher than its bench.
 */
export function counterUnder(f: { x: number; z: number; hx: number; hz: number; yaw: number }): number | null {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const corners = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => ({ x: f.x + sx * f.hx * c + sz * f.hz * s, z: f.z - sx * f.hx * s + sz * f.hz * c })),
  );
  const on = (k: { x0: number; x1: number; z0: number; z1: number }) => corners.every((p) => p.x >= k.x0 && p.x <= k.x1 && p.z >= k.z0 && p.z <= k.z1);
  return on(LAMP_FLOOR) ? LAMP_FLOOR.y : COUNTERS.some(on) ? LIFT : null;
}
/**
 * How far out from the back wall things stand when nothing says otherwise: over the counter, in the middle of its
 * third row of cells, so a tool's stand behind it has the first two.
 */
export const Z_HOME = 2.5 * CELL;
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
