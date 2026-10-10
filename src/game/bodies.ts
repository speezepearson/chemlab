import type { Flask } from './flask';
import { FLASK_H } from './flaskShape';
import { placeBox, type Box } from './physics';
import { SCALE_SHAPE, type Scale } from './scale';
import { toWorld, type Pose, type Vec3 } from './space';
import { TANK_H, tankX, type Hose, type Mouth, type Tool, type ToolKind } from './tools';

/**
 * Where the parts of everything in the lab are, in the room. Tools, flasks and scales are drawn in their own
 * frames as they were on the old flat bench, x right and y down from their origin (the top center of a tool's
 * bounding box, a flask's mouth, a scale's platform), and given depth front to back; these put those points in the
 * room (see space.ts).
 */

/** How deep each tool is front to back, all told, and how deep its tanks are inside. */
export const TOOL_DEPTH: Record<ToolKind, { body: number; tank: number }> = {
  dispenser: { body: 44, tank: 40 },
  pipette: { body: 30, tank: 10 },
  exchanger: { body: 44, tank: 40 },
  separator: { body: 44, tank: 40 },
  splitter: { body: 34, tank: 30 },
  sorter: { body: 34, tank: 30 },
  reference: { body: 44, tank: 40 },
  spectrometer: { body: 84, tank: 24 },
  heater: { body: 30, tank: 30 },
  meter: { body: 40, tank: 30 },
  tank: { body: 44, tank: 40 },
  receptacle: { body: 70, tank: 60 },
};

/** A local x on a tool as it stands: negated if it's flipped (see Tool.flipped). */
export const lx = (t: Tool, x: number) => (t.flipped ? -x : x);

/** A point in a tool's flat frame (x right, y down from its top center), `z` toward its front, in the room. */
export function onTool(t: Tool, x: number, y: number, z = 0): Vec3 {
  return toWorld(t.pose, { x: lx(t, x), y: -y, z });
}

/** The tip of spout j, where fluid leaves the tool. */
export function spoutAt(t: Tool, j: number): Vec3 {
  return onTool(t, t.shape.spouts[j], t.shape.spoutY);
}

/** How far in front of the tool's middle its valves sit: on its front face. */
export const valveZ = (t: Tool) => TOOL_DEPTH[t.kind].body / 2 + 3;

/** A valve's center, in the tool's flat frame as it stands (so mirrored if it's flipped): as its shape places it, or under tank k. */
export function valveLocal(t: Tool, k: number): { x: number; y: number } {
  const v = t.shape.valves?.[k] ?? { x: tankX(t.shape.tanks[k]), y: t.shape.valveY };
  return { x: lx(t, v.x), y: v.y };
}

/** A tank's walls, in the tool's flat frame. */
export function tankRect(t: Tool, k: number): { x0: number; x1: number; y0: number; y1: number } {
  const tk = t.shape.tanks[k];
  return { x0: tk.x0, x1: tk.x1, y0: 0, y1: t.shape.tankH ?? TANK_H };
}

/** Where fluid goes into a tank, in the tool's flat frame: its open top, or the mouth of the little funnel on top if it has one. */
export function openingOf(t: Tool, k: number): { x0: number; x1: number; y: number; hz: number } {
  const r = tankRect(t, k);
  const cup = t.shape.cup;
  if (!cup) return { x0: r.x0, x1: r.x1, y: r.y0, hz: TOOL_DEPTH[t.kind].tank / 2 };
  const cx = (r.x0 + r.x1) / 2;
  return { x0: cx - cup.w, x1: cx + cup.w, y: r.y0 - cup.h, hz: cup.w };
}

/** The open top of tank k, in the room; it spills over its right lip. */
export function tankMouth(t: Tool, k: number): Mouth {
  const o = openingOf(t, k);
  const c = onTool(t, (o.x0 + o.x1) / 2, o.y);
  // it spills over its right lip as it stands
  const rim = toWorld(t.pose, { x: lx(t, (o.x0 + o.x1) / 2) + (o.x1 - o.x0) / 2 + 3, y: -o.y, z: 0 });
  return { v: t.tanks[k], ...c, hx: (o.x1 - o.x0) / 2, hz: o.hz, yaw: t.pose.yaw, rim };
}

/** A tool's bounding box in the room, for collisions. */
export function toolBox(t: Tool): Box {
  const b = t.shape.box;
  return placeBox(t.pose, toolCenter(t), { x: (b.x1 - b.x0) / 2, y: (b.y1 - b.y0) / 2, z: TOOL_DEPTH[t.kind].body / 2 });
}

/** The middle of a tool's bounding box, in its own frame (y up), as it stands: where it's held from. */
export function toolCenter(t: Tool): Vec3 {
  const b = t.shape.box;
  return { x: lx(t, (b.x0 + b.x1) / 2), y: -(b.y0 + b.y1) / 2, z: 0 };
}

/**
 * Flip a tool left to right (see Tool.flipped), about the middle of its box, so it stays where it is. Does nothing,
 * returning false, if its shape isn't flippable.
 */
export function flip(t: Tool): boolean {
  if (!t.shape.flippable) return false;
  // the box's middle is at c now and will be at −c, so move the tool 2c along its own x to keep it put
  const c = toolCenter(t).x;
  const p = toWorld(t.pose, { x: 2 * c, y: 0, z: 0 });
  t.pose = { ...p, yaw: t.pose.yaw };
  t.flipped = !t.flipped;
  return true;
}

/* ---------------- flasks ---------------- */

/** Half-width of the part of a flask's mouth that catches what falls on it. */
export const FLASK_CATCH = 12;
/** Where a flask spills or pours from, right of its mouth's center: just outside its lip. */
export const FLASK_LIP = 12;
/** Half the width of a flask's base, for collisions. */
export const FLASK_R = 28;

/** The middle of a flask, below its mouth: where it's held from. */
export const FLASK_CENTER: Vec3 = { x: 0, y: -FLASK_H / 2, z: 0 };

/** A flask's lip on its right, where it pours from, tipped by its tilt about its mouth (see Flask.tilt). */
export function flaskLip(f: Flask): Vec3 {
  return toWorld(f.pose, { x: FLASK_LIP * Math.cos(f.tilt), y: -FLASK_LIP * Math.sin(f.tilt), z: 0 });
}

/** A flask's mouth, in the room, unless it's tipped (when it pours instead). */
export function flaskMouth(f: Flask): Mouth {
  const p = f.pose;
  return { v: f, x: p.x, y: p.y, z: p.z, hx: FLASK_CATCH, hz: FLASK_CATCH, yaw: p.yaw, rim: flaskLip(f) };
}

export function flaskBox(f: Flask): Box {
  return placeBox(f.pose, FLASK_CENTER, { x: FLASK_R, y: FLASK_H / 2, z: FLASK_R });
}

/* ---------------- scales ---------------- */

/** Where a flask standing on a scale `dx` along its platform has its mouth, facing the way the scale does. */
export function onScale(sc: Scale, dx: number): Pose {
  return { ...toWorld(sc.pose, { x: dx, y: FLASK_H, z: 0 }), yaw: sc.pose.yaw };
}

/** How far from the platform's ends a flask's middle can stand. */
export const SCALE_INSET = 24;

/**
 * A scale's body and platform in the room; with `load`, reaching up over whatever's standing on it too (as it's
 * carried). Without, flasks can be brought down onto the platform.
 */
export function scaleBox(sc: Scale, load = false): Box {
  const { platform: pl, body, depth } = SCALE_SHAPE;
  const top = load && sc.load.length ? FLASK_H : 0;
  return placeBox(
    sc.pose,
    { x: (pl.x0 + pl.x1) / 2, y: (top - body.y1) / 2, z: 0 },
    { x: (pl.x1 - pl.x0) / 2, y: (top + body.y1) / 2, z: depth },
  );
}

/** The middle of a scale (as carried, see scaleBox), in its own frame: where it's held from. */
export function scaleCenter(sc: Scale): Vec3 {
  return { x: 0, y: ((sc.load.length ? FLASK_H : 0) - SCALE_SHAPE.body.y1) / 2, z: 0 };
}

/**
 * Where a flask let go of with its mouth at `p` would stand on a scale: `dx` along the platform, if it's over the
 * platform and not far above it (nor below it). Null if it isn't.
 */
export function scaleSpot(sc: Scale, p: Vec3): number | null {
  const { platform: pl, depth } = SCALE_SHAPE;
  const c = Math.cos(sc.pose.yaw);
  const s = Math.sin(sc.pose.yaw);
  const dx = p.x - sc.pose.x;
  const dz = p.z - sc.pose.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const above = p.y - FLASK_H - sc.pose.y;
  if (lx < pl.x0 || lx > pl.x1 || Math.abs(lz) > depth || above < -10 || above > 60) return null;
  return Math.max(pl.x0 + SCALE_INSET, Math.min(pl.x1 - SCALE_INSET, lx));
}

/* ---------------- hoses ---------------- */

/** Half-width of a hose funnel's mouth. */
export const FUNNEL_R = 14;
/** How far a hose's funnel reaches below its mouth, and its nozzle above its tip. */
export const FUNNEL_H = 12;
export const NOZZLE_H = 10;

export function hoseMouth(h: Hose): Mouth {
  const e = h.inlet;
  return { v: h.funnel, ...e, hx: FUNNEL_R, hz: FUNNEL_R, rim: { x: e.x + FUNNEL_R + 1, y: e.y, z: e.z } };
}

export function hoseEndBox(h: Hose, end: 'inlet' | 'outlet'): Box {
  const e = h[end];
  const pose = { ...e, yaw: 0 };
  return end === 'inlet'
    ? placeBox(pose, { x: 0, y: -FUNNEL_H / 2, z: 0 }, { x: FUNNEL_R, y: FUNNEL_H / 2, z: FUNNEL_R })
    : placeBox(pose, { x: 0, y: NOZZLE_H / 2, z: 0 }, { x: 5, y: NOZZLE_H / 2, z: 5 });
}

/* ---------------- valves ---------------- */

/** How close to a valve, in a tool's local units, the aim can be before the lever stops following it: its round core. */
export const VALVE_DEADZONE = 6;
/** How near a valve's center, in a tool's local units, the right button grabs it: the reach of its lever, or a dial's ticks. */
export const VALVE_REACH = 15;

/** The valve nearest (x, y) in a tool's flat frame as it stands, within VALVE_REACH of its center; null if none is. */
export function valveNear(t: Tool, x: number, y: number): number | null {
  if (t.shape.noValve) return null;
  let best: number | null = null;
  let reach = VALVE_REACH;
  t.valves.forEach((_, k) => {
    const v = valveLocal(t, k);
    const d = Math.hypot(x - v.x, y - v.y);
    if (d < reach) [best, reach] = [k, d];
  });
  return best;
}

/**
 * Point valve k's lever at (x, y) in the tool's flat frame as it stands (y down): straight up from the valve is fully
 * open, straight right is closed, and in between is partly open, flipped or not. Below the valve it closes, and left
 * of it (past the down-left diagonal) it opens, so a wild swing lands at the nearer end. A splitter's lever instead
 * sweeps the upper half: straight left sends everything left, straight right everything right, and below the valve
 * it goes to the nearer side. A dial points at (x, y), turning clockwise from down-left (0) to down-right (1), and
 * straight below it goes to the nearer end. Within VALVE_DEADZONE of the valve the angle is too jumpy to mean
 * anything, so the lever stays put.
 */
export function aimValve(t: Tool, k: number, x: number, y: number): void {
  const vc = valveLocal(t, k);
  if (Math.hypot(x - vc.x, y - vc.y) < VALVE_DEADZONE) return;
  if (k === t.shape.dial) {
    const cw = Math.atan2(x - vc.x, vc.y - y); // clockwise from straight up
    t.valves[k] = Math.max(0, Math.min(1, (cw + 0.75 * Math.PI) / (1.5 * Math.PI)));
    return;
  }
  const a = Math.atan2(vc.y - y, x - vc.x); // counterclockwise from right
  if (t.kind === 'splitter') {
    t.valves[k] = a >= 0 ? 1 - a / Math.PI : a > -Math.PI / 2 ? 1 : 0;
    return;
  }
  const open = a < -0.75 * Math.PI ? 1 : a / (Math.PI / 2);
  t.valves[k] = Math.max(0, Math.min(1, open));
}
