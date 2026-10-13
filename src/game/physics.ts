import { toWorld, type Pose, type Vec3 } from './space';

/**
 * Collisions in the lab. Nothing falls (whatever the player lets go of is set down on a counter, or on a stand), and
 * nothing turns except about the vertical, so every body is a box turned by some yaw, or an upright cylinder, or
 * made of several such parts, and the player is an upright cylinder. The only things that move are the player and what they're carrying, so the physics is all
 * about stopping those short of whatever they'd run into, and letting them slide along it.
 */

/**
 * A box turned by `yaw` about the vertical: its center, and its half-size along its own axes. Or, if `round`, an
 * upright cylinder `hx` (which is `hz`) in radius. If it has `parts`, it's solid only in them, and it bounds them all.
 */
export interface Box extends Pose {
  hx: number;
  hy: number;
  hz: number;
  round?: boolean;
  parts?: readonly Part[];
}

/** One solid part of a box (see Box.parts): a box, or a cylinder if round, its middle offset from the box's, in the box's own frame. */
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
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return b.parts.map((p) => ({
    x: b.x + p.x * c + p.z * s, y: b.y + p.y, z: b.z - p.x * s + p.z * c, yaw: b.yaw, hx: p.hx, hy: p.hy, hz: p.hz, round: p.round,
  }));
}

/** How far a point (x, z) on the floor is from a box's footprint, across: 0 inside it. */
function footprintGap(b: Box, x: number, z: number): number {
  const cs = Math.cos(b.yaw);
  const sn = Math.sin(b.yaw);
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = dx * cs - dz * sn;
  const lz = dx * sn + dz * cs;
  return Math.hypot(lx - Math.max(-b.hx, Math.min(b.hx, lx)), lz - Math.max(-b.hz, Math.min(b.hz, lz)));
}

/** A body's box, given in its own frame (center and half-size), placed at a pose. */
export function placeBox(pose: Pose, center: Vec3, half: Vec3): Box {
  const c = toWorld(pose, center);
  return { ...c, yaw: pose.yaw, hx: half.x, hy: half.y, hz: half.z };
}

/** The box's corners' x and z on the floor, for separating-axis tests. */
function footprint(b: Box): { ax: [number, number]; az: [number, number] } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  // the box's own x axis, and its own z axis, in the room (see toWorld)
  return { ax: [c, -s], az: [s, c] };
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
  const fa = footprint(a);
  const fb = footprint(b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [ux, uz] of [fa.ax, fa.az, fb.ax, fb.az]) {
    const ra = a.hx * Math.abs(fa.ax[0] * ux + fa.ax[1] * uz) + a.hz * Math.abs(fa.az[0] * ux + fa.az[1] * uz);
    const rb = b.hx * Math.abs(fb.ax[0] * ux + fb.ax[1] * uz) + b.hz * Math.abs(fb.az[0] * ux + fb.az[1] * uz);
    if (Math.abs(dx * ux + dz * uz) >= ra + rb - slop) return false;
  }
  return true;
}

/** An upright cylinder: the player. */
export interface Cylinder {
  x: number;
  z: number;
  r: number;
  /** Its bottom and top. */
  y0: number;
  y1: number;
}

/** Whether a cylinder and a box overlap by more than `slop`: in its solid parts, if it has any. */
export function cylinderHitsBox(c: Cylinder, b: Box, slop = 0.01): boolean {
  return solids(b).some((p) => {
    if (c.y1 <= p.y - p.hy + slop || c.y0 >= p.y + p.hy - slop) return false;
    if (p.round) return Math.hypot(c.x - p.x, c.z - p.z) < c.r + p.hx - slop;
    return footprintGap(p, c.x, c.z) < c.r - slop;
  });
}

const free = (b: Box, obstacles: readonly Box[]) => !obstacles.some((o) => boxesOverlap(b, o));

/** Whether the straight line from a to b passes through a box, taken as solid all through (its parts aren't looked at). */
export function segmentHitsBox(a: Vec3, b: Vec3, box: Box): boolean {
  // in the box's own frame (see footprint), where it's square to the axes
  const c = Math.cos(box.yaw);
  const s = Math.sin(box.yaw);
  const local = (p: Vec3) => ({ x: (p.x - box.x) * c - (p.z - box.z) * s, y: p.y - box.y, z: (p.x - box.x) * s + (p.z - box.z) * c });
  const p = local(a);
  const q = local(b);
  let t0 = 0;
  let t1 = 1;
  for (const [k, h] of [['x', box.hx], ['y', box.hy], ['z', box.hz]] as const) {
    const d = q[k] - p[k];
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(p[k]) >= h) return false;
      continue;
    }
    const u = (-h - p[k]) / d;
    const v = (h - p[k]) / d;
    t0 = Math.max(t0, Math.min(u, v));
    t1 = Math.min(t1, Math.max(u, v));
    if (t0 >= t1) return false;
  }
  return true;
}

/** How finely a move is stepped, so nothing thinner than this is passed through: in world units, and radians. */
const STEP = 3;
const TURN_STEP = 0.04;

/**
 * Move a box toward `to`, stopping short of anything in its way and sliding along it: each step goes as far
 * toward `to` as it can, and if the whole step is blocked, takes whichever parts of it (along x, y, z, or the
 * turn) aren't. Obstacles it already overlaps are ignored, so something stuck can always be pulled free.
 */
export function moveBox(from: Box, to: Pose, obstacles: readonly Box[]): Box {
  const live = obstacles.filter((o) => !boxesOverlap(from, o));
  const dyaw = to.yaw - from.yaw;
  const n = Math.min(
    400,
    Math.max(1, Math.ceil(Math.max(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / STEP, Math.abs(dyaw) / TURN_STEP))),
  );
  const step = { x: (to.x - from.x) / n, y: (to.y - from.y) / n, z: (to.z - from.z) / n, yaw: dyaw / n };
  let cur = from;
  for (let i = 0; i < n; i++) {
    const next = { ...cur, x: cur.x + step.x, y: cur.y + step.y, z: cur.z + step.z, yaw: cur.yaw + step.yaw };
    if (free(next, live)) {
      cur = next;
      continue;
    }
    for (const k of ['x', 'y', 'z', 'yaw'] as const) {
      if (!step[k]) continue;
      const cand = { ...cur, [k]: cur[k] + step[k] };
      if (free(cand, live)) cur = cand;
    }
  }
  return cur;
}

/**
 * Walk the player (and whatever they carry, which moves with them) by (dx, dz), sliding along whatever's in
 * the way: each axis goes only if neither the player nor the load would run into anything. Obstacles the
 * player or the load already overlaps are ignored for that one, so neither gets stuck.
 */
export function walk(
  player: Cylinder,
  load: Box | null,
  dx: number,
  dz: number,
  obstacles: readonly Box[],
): { player: Cylinder; load: Box | null } {
  const forPlayer = obstacles.filter((o) => !cylinderHitsBox(player, o));
  const forLoad = load ? obstacles.filter((o) => !boxesOverlap(load, o)) : [];
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / STEP));
  let p = player;
  let l = load;
  for (let i = 0; i < n; i++)
    for (const [ax, az] of [[dx / n, 0], [0, dz / n]]) {
      if (!ax && !az) continue;
      const np = { ...p, x: p.x + ax, z: p.z + az };
      const nl = l && { ...l, x: l.x + ax, z: l.z + az };
      if (forPlayer.some((o) => cylinderHitsBox(np, o))) continue;
      if (nl && !free(nl, forLoad)) continue;
      p = np;
      l = nl;
    }
  return { player: p, load: l };
}

/**
 * The room's walls, floor and ceiling as boxes, thick enough that nothing passes through them in one step; without
 * the front wall if `front` is false (the airlock's doorway is in it: see airlock.airlockBoxes).
 */
export function roomBoxes(r: { x0: number; x1: number; z0: number; z1: number; y1: number }, front = true): Box[] {
  const T = 200;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const w = (r.x1 - r.x0) / 2 + T;
  const d = (r.z1 - r.z0) / 2 + T;
  const h = r.y1 / 2 + T;
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): Box => ({ x, y, z, yaw: 0, hx, hy, hz });
  return [
    box(cx, -T / 2, cz, w, T / 2, d), // floor
    box(cx, r.y1 + T / 2, cz, w, T / 2, d), // ceiling
    box(r.x0 - T / 2, r.y1 / 2, cz, T / 2, h, d),
    box(r.x1 + T / 2, r.y1 / 2, cz, T / 2, h, d),
    box(cx, r.y1 / 2, r.z0 - T / 2, w, h, T / 2),
    ...(front ? [box(cx, r.y1 / 2, r.z1 + T / 2, w, h, T / 2)] : []),
  ];
}
