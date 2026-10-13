import type { Flask } from './flask';
import { FLASK_H } from './flaskShape';
import { placeBox, type Box, type Part } from './physics';
import { SCALE_SHAPE, type Scale } from './scale';
import { CELL, groundAt, toCardinal, toCell, toWorld, type Pose, type Vec3 } from './space';
import {
  ANALYZER, HELIX, INLINE_DOCK, INLINE_TOOLS, INSTRUMENT, SHAPES, STATION, TANK_H, tankDepth, tankX, overMouth, type Hose, type Mouth, type Tool,
  type ToolKind,
} from './tools';

/**
 * Where the parts of everything in the lab are, in the room. Tools, flasks and scales are drawn in their own
 * frames as they were on the old flat bench, x right and y down from their origin (the top center of a tool's
 * bounding box, a flask's mouth, a scale's platform), and given depth front to back; these put those points in the
 * room (see space.ts).
 */

/** How deep a tool's cabinet is front to back, for the tools that have one deeper than their tanks. */
const CABINET_DEPTH: Partial<Record<ToolKind, number>> = { analyzer: 50, spectroscope: 50, meter: 40 };

/**
 * How deep each tool is front to back, all told, and how deep its tanks are inside: as deep as they need to be to
 * hold what they hold (see tankDepth), and the tool a little deeper, or as deep as its cabinet or its tank's cup. The
 * cryostabilizer station's columns are inside the wall, whatever they hold; it reaches from the wall as far out again
 * in front of its funnel and spouts.
 */
export const TOOL_DEPTH = Object.fromEntries(
  (Object.keys(SHAPES) as ToolKind[]).map((kind) => {
    if (SHAPES[kind].wall) return [kind, { tank: STATION.plate - 3, body: 2 * STATION.out }];
    const tank = tankDepth(kind);
    const cup = SHAPES[kind].cup;
    return [kind, { tank, body: Math.max(CABINET_DEPTH[kind] ?? 0, tank + 4, cup ? 2 * cup.w + 2 : 0) }];
  }),
) as Record<ToolKind, { body: number; tank: number }>;

/**
 * A pose on the grid (see CELL): turned to the nearest of the four ways along it, and slid the least way that brings
 * `anchor`, a point in its own frame, over the middle of a cell.
 */
export function onGrid(p: Pose, anchor: Vec3 = { x: 0, y: 0, z: 0 }): Pose {
  const q = { ...p, yaw: toCardinal(p.yaw) };
  const a = toWorld(q, anchor);
  return { ...q, x: q.x + toCell(a.x) - a.x, z: q.z + toCell(a.z) - a.z };
}

/**
 * The point of a tool that goes over the middle of a grid cell: the middle of its first tank's mouth. Its other mouths
 * and its spouts are a whole number of cells from it along the tool, so once it's on the grid, they are too.
 */
export const toolAnchor = (t: Tool): Vec3 => ({ x: tankX(t.shape.tanks[0]), y: 0, z: 0 });


/** A point in a tool's flat frame (x right, y down from its top center), `z` toward its front, in the room. */
export function onTool(t: Tool, x: number, y: number, z = 0): Vec3 {
  return toWorld(t.pose, { x, y: -y, z });
}

/** The tip of spout j, where fluid leaves the tool. */
export function spoutAt(t: Tool, j: number): Vec3 {
  return onTool(t, t.shape.spouts[j], t.shape.spoutY);
}

/**
 * How far in front of the tool's middle its valves sit: on its front face, where they're easy to see and reach; for a
 * round tank, out in front of the tank on a stem from the pipe under it, so the tank's lower edge doesn't hide it.
 */
export const valveZ = (t: Tool) => (t.shape.wall ? 7 : TOOL_DEPTH[t.kind].body / 2 + 3);

/** A valve's center, in the tool's flat frame: as its shape places it, or under tank k. */
export function valveLocal(t: Tool, k: number): { x: number; y: number } {
  const v = t.shape.valves?.[k] ?? { x: tankX(t.shape.tanks[k]), y: t.shape.valveY };
  return { x: v.x, y: v.y };
}

/** A tank's walls, in the tool's flat frame. */
export function tankRect(t: Tool, k: number): { x0: number; x1: number; y0: number; y1: number } {
  const tk = t.shape.tanks[k];
  return { x0: tk.x0, x1: tk.x1, y0: 0, y1: t.shape.tankH ?? TANK_H };
}

/**
 * Where fluid goes into a tank, in the tool's flat frame: its open top, or the mouth of the little funnel on top if it
 * has one, or the cryostabilizer station's funnel (see STATION).
 */
export function openingOf(t: Tool, k: number): { x0: number; x1: number; y: number; hz: number } {
  const r = tankRect(t, k);
  if (t.shape.wall) {
    const { w, y } = STATION.funnel;
    const cx = tankX(t.shape.tanks[k]);
    return { x0: cx - w, x1: cx + w, y, hz: w };
  }
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
  const rim = toWorld(t.pose, { x: o.x1 + 3, y: -o.y, z: 0 });
  return { v: t.tanks[k], ...c, hx: (o.x1 - o.x0) / 2, hz: o.hz, yaw: t.pose.yaw, rim };
}

/** The tools whose bodies are a cabinet as wide as they are, under their tanks, rather than pipes and valves. */
const CABINETS: readonly ToolKind[] = ['meter'];

/**
 * Where, in a tool's flat frame, the player's note about tank k is written (its middle's height): above the tank's
 * opening and the tool's label, or the tank's own (the most lines of any of the tool's tanks', so they line up); on
 * the cryostabilizer station, just above its block.
 */
export function tankNoteY(t: Tool, k: number): number {
  const lines = Math.max(t.shape.label?.length ?? 0, ...t.shape.tanks.map((tk) => tk.label?.length ?? 0));
  if (t.shape.wall) return STATION.block.y0 - 14;
  return openingOf(t, k).y - (lines ? 11 * lines + 10 : 9);
}

/**
 * A tool's solid parts, in its flat frame (x right, y down from its top center), each
 * reaching `hz` either side of `z` (its middle, if left out) front to back: its tanks (round, for a round tank), and
 * under them its cabinet, or else the pipes, valves and spouts there, across only as far as they reach. The
 * cryostabilizer station's are its funnel, the plate in the wall, and its spouts' pipes out from it.
 * An inline instrument's are its tube and the pipe down from it, the cabinet beside them, and any pipe on to a
 * spout past the cabinet; the tube's top is flush with its opening, for a nozzle to snap onto (see INLINE_DOCK).
 */
export function toolParts(t: Tool): { x0: number; x1: number; y0: number; y1: number; hz: number; z?: number; round?: boolean }[] {
  const sh = t.shape;
  const b = sh.box;
  if (sh.wall) {
    const { funnel: f, out, plate } = STATION;
    const H = sh.tankH ?? TANK_H;
    // the plate is flush with the wall, its rubber seam a little proud of it
    const face = -out;
    return [
      { x0: -f.w - 2, x1: f.w + 2, y0: f.y - 2, y1: H + 26, hz: f.w + 1 },
      { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, hz: plate / 2 + 1.5, z: face - plate / 2 + 1.5 },
      ...sh.spouts.map((x) => ({ x0: x - 8, x1: x + 8, y0: H + 10, y1: sh.spoutY, hz: (out + 8) / 2, z: (8 - out) / 2 })),
    ];
  }
  const D = TOOL_DEPTH[t.kind];
  const bottom = (sh.tankH ?? TANK_H) + (sh.sump?.h ?? 0);
  if (INLINE_TOOLS.includes(t.kind)) {
    const c = INSTRUMENT.body;
    const r = D.tank / 2 + 2;
    const past = sh.spouts.filter((x) => x > c.x1);
    return [
      { x0: -r, x1: r, y0: 0, y1: bottom, hz: r, round: true },
      { x0: -6, x1: 6, y0: bottom, y1: b.y1, hz: 6 },
      { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, hz: D.body / 2 },
      ...past.map((x) => ({ x0: c.x1, x1: x + 6, y0: ANALYZER.wasteY - 6, y1: b.y1, hz: 6 })),
    ];
  }
  const x0s = sh.tanks.map((k) => (sh.cup ? tankX(k) - sh.cup.w : k.x0));
  const x1s = sh.tanks.map((k) => (sh.cup ? tankX(k) + sh.cup.w : k.x1));
  const tanks = {
    x0: Math.min(...x0s) - 2, x1: Math.max(...x1s) + 2, y0: (sh.cup ? -sh.cup.h : 0) - 6, y1: bottom,
    hz: Math.max(D.tank / 2 + 2, sh.cup ? sh.cup.w + 1 : 0), round: sh.round,
  };
  if (sh.round) tanks.hz = (tanks.x1 - tanks.x0) / 2;
  if (bottom >= b.y1) return [tanks];
  if (CABINETS.includes(t.kind)) return [tanks, { x0: b.x0, x1: b.x1, y0: bottom, y1: b.y1, hz: D.body / 2 }];
  const valves = sh.noValve ? [] : (sh.valves ?? sh.tanks.map((k) => ({ x: tankX(k), y: sh.valveY })));
  const xs = [...sh.spouts, ...valves.map((v) => v.x), ...sh.tanks.map(tankX)];
  if (t.kind === 'exchanger') xs.push(HELIX.x0, HELIX.x1);
  const below = {
    x0: Math.max(b.x0, Math.min(...xs) - 12), x1: Math.min(b.x1, Math.max(...xs) + 12),
    y0: Math.min(bottom, ...valves.map((v) => v.y - 10)), y1: b.y1, hz: D.body / 2,
  };
  return [tanks, below];
}

/** A tool's box in the room, for collisions: its bounding box, solid only in its parts (see toolParts). */
export function toolBox(t: Tool): Box {
  const b = t.shape.box;
  const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const parts: Part[] = toolParts(t).map((p) => ({
    x: (p.x0 + p.x1) / 2 - c.x, y: -((p.y0 + p.y1) / 2 - c.y), z: p.z ?? 0,
    hx: (p.x1 - p.x0) / 2, hy: (p.y1 - p.y0) / 2, hz: p.hz, round: p.round,
  }));
  const hz = Math.max(TOOL_DEPTH[t.kind].body / 2, ...parts.map((p) => p.hz));
  return { ...placeBox(t.pose, toolCenter(t), { x: (b.x1 - b.x0) / 2, y: (b.y1 - b.y0) / 2, z: hz }), parts };
}

/** The middle of a tool's bounding box, in its own frame (y up), as it stands: where it's held from. */
export function toolCenter(t: Tool): Vec3 {
  const b = t.shape.box;
  return { x: (b.x0 + b.x1) / 2, y: -(b.y0 + b.y1) / 2, z: 0 };
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

/** A flask's lip on its right, where it pours from, tipped by its tilt (or `tilt`) about its mouth (see Flask.tilt). */
export function flaskLip(f: Flask, tilt = f.tilt): Vec3 {
  return toWorld(f.pose, { x: FLASK_LIP * Math.cos(tilt), y: -FLASK_LIP * Math.sin(tilt), z: 0 });
}

/** A flask's mouth, in the room, unless it's tipped (when it pours instead). */
export function flaskMouth(f: Flask): Mouth {
  const p = f.pose;
  return { v: f, x: p.x, y: p.y, z: p.z, hx: FLASK_CATCH, hz: FLASK_CATCH, yaw: p.yaw, rim: flaskLip(f) };
}

/**
 * A flask's solid parts, as slices of its outline down from its mouth, each a cylinder as wide as its widest part
 * (glass included): its neck, two bands of its sloping shoulders, and its base.
 */
const FLASK_PARTS: readonly Part[] = [
  [0, 22, 12],
  [22, 36, 15.5],
  [36, 50, 21],
  [50, FLASK_H, FLASK_R],
].map(([a, b, r]) => ({ x: 0, y: FLASK_H / 2 - (a + b) / 2, z: 0, hx: r, hy: (b - a) / 2, hz: r, round: true }));

/** A flask's box: an upright cylinder, solid in the slices of its outline (see FLASK_PARTS). It doesn't turn. */
export function flaskBox(f: Flask): Box {
  return { ...placeBox({ ...f.pose, yaw: 0 }, FLASK_CENTER, { x: FLASK_R, y: FLASK_H / 2, z: FLASK_R }), round: true, parts: FLASK_PARTS };
}

/* ---------------- scales ---------------- */

/** Where a flask standing on a scale `dx` along its platform has its mouth, facing the way the scale does. */
export function onScale(sc: Scale, dx: number): Pose {
  return { ...toWorld(sc.pose, { x: dx, y: FLASK_H, z: 0 }), yaw: sc.pose.yaw };
}

/** Where along its platform a scale stands flasks: half a grid cell either side of its middle, a cell apart. */
export const SCALE_SLOTS = [-CELL / 2, CELL / 2];
/** The point of a scale that goes over the middle of a grid cell: one of its places for a flask, so both are. */
export const SCALE_ANCHOR: Vec3 = { x: SCALE_SLOTS[1], y: 0, z: 0 };

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
 * Where a flask let go of with its mouth at `p` would stand on a scale: `dx` along the platform, at the nearer of its
 * places for a flask (see SCALE_SLOTS), if it's over the platform, above it but no more than `reach` above it. Null if
 * it isn't.
 */
export function scaleSpot(sc: Scale, p: Vec3, reach = 60): number | null {
  const { platform: pl, depth } = SCALE_SHAPE;
  const c = Math.cos(sc.pose.yaw);
  const s = Math.sin(sc.pose.yaw);
  const dx = p.x - sc.pose.x;
  const dz = p.z - sc.pose.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const above = p.y - FLASK_H - sc.pose.y;
  if (lx < pl.x0 || lx > pl.x1 || Math.abs(lz) > depth || above < -10 || above > reach) return null;
  return lx < 0 ? SCALE_SLOTS[0] : SCALE_SLOTS[1];
}

/* ---------------- hoses ---------------- */

/**
 * A hose's nozzle at p, snapped down onto the top of the tube of the inline instrument among `tools` it's over (see
 * INLINE_TOOLS), if it's over one, no more than INLINE_DOCK above it; otherwise just p.
 */
export function docked(p: Pose, tools: readonly Tool[]): Pose {
  for (const t of tools) {
    if (!INLINE_TOOLS.includes(t.kind)) continue;
    const m = tankMouth(t, 0);
    if (overMouth(m, p.x, p.z) && p.y >= m.y && p.y - m.y <= INLINE_DOCK) return { ...p, y: m.y + 1 };
  }
  return p;
}

/** How tall a hose's nozzle is, up from its tip, and how far it reaches either side of its middle. */
export const NOZZLE_H = 10;
export const NOZZLE_R = 5;

/** A hose's nozzle's box: a little upright cylinder up from its tip. */
export function nozzleBox(h: Hose): Box {
  const box = placeBox({ ...h.outlet, yaw: 0 }, { x: 0, y: NOZZLE_H / 2, z: 0 }, { x: NOZZLE_R, y: NOZZLE_H / 2, z: NOZZLE_R });
  return { ...box, round: true };
}

/**
 * How near a spout's tip, across and up, in a tool's flat frame, the crosshair can be on the tool and still be on
 * the spout: its tip, and the pipe just above it.
 */
export const SPOUT_REACH = { x: 12, up: 30, down: 4 };

/** The spout of a tool nearest (x, y) in its flat frame as it stands, if that's within SPOUT_REACH of its tip; null if none is. */
export function spoutNear(t: Tool, x: number, y: number): number | null {
  let best: number | null = null;
  let reach = SPOUT_REACH.x;
  t.shape.spouts.forEach((sx, j) => {
    const dx = Math.abs(x - sx);
    const dy = t.shape.spoutY - y;
    if (dx <= reach && dy <= SPOUT_REACH.up && dy >= -SPOUT_REACH.down) [best, reach] = [j, dx];
  });
  return best;
}

/* ---------------- stands ---------------- */

/**
 * A clamp stand, holding up a tool or a hose's nozzle: a base plate on whatever's below, a rod straight up from it, and a
 * clamp at the rod's top reaching out to what it holds. Its rod stands at (x, z), behind what it holds as that faces,
 * the clamp is `clampY` high, and its arm reaches what it holds at `to`.
 */
export interface Stand {
  x: number;
  z: number;
  clampY: number;
  to: Vec3;
  yaw: number;
}

/** A stand's base plate: how far it reaches either side of its rod, across and front to back, and how thick it is. */
export const STAND_BASE = { hx: 30, hz: 16, h: 6 };
/** How high a stand's rod reaches above the counter, whatever it holds: its clamp slides up and down it. */
export const STAND_ROD = 570;
/** How high a stand's clamp can be above the counter: just short of the top of its rod. */
export const STAND_MAX = STAND_ROD - 10;
/** A tool wider than this is held by two stands, one near each end, rather than one in the middle. */
const TWO_STANDS = 300;
/**
 * How far behind the middle of what it holds a stand's rod is: far enough that its base clears a flask standing
 * under what it holds (or under the tool's spouts, which are along its middle), by this much.
 */
const STAND_CLEAR = 6;
const rodBack = (body: number) => Math.max(body / 2, FLASK_R) + STAND_CLEAR + STAND_BASE.hz;

/** The stands holding up a tool, unless it's built into a wall: clamped near its top, behind it. */
export function toolStands(t: Tool, pose = t.pose): Stand[] {
  if (t.shape.wall) return [];
  const at = (x: number, y: number, z: number) => toWorld(pose, { x, y: -y, z });
  const b = t.shape.box;
  const body = TOOL_DEPTH[t.kind].body;
  const xs = b.x1 - b.x0 > TWO_STANDS ? [b.x0 + 60, b.x1 - 60] : [(b.x0 + b.x1) / 2];
  const y = Math.max(b.y0, 0) + 12;
  return xs.map((x) => {
    const rod = at(x, y, -rodBack(body));
    return { x: rod.x, z: rod.z, clampY: rod.y, to: at(x, y, -body / 2), yaw: pose.yaw };
  });
}

/**
 * How far behind a hose's nozzle its stand's rod can be, its clamp's arm slid in or out: from just far enough for its
 * base to clear a flask under the nozzle, out to three cells, in steps of `step`.
 */
export const NOZZLE_REACH = { min: rodBack(2 * NOZZLE_R), max: 3 * CELL, step: CELL / 4 };

/** A reach for a nozzle's stand (see NOZZLE_REACH): the nearest step to `r`, within its range. */
export function snapReach(r: number): number {
  const { min, max, step } = NOZZLE_REACH;
  const k = Math.round((Math.min(max, Math.max(min, r)) - min) / step);
  return Math.min(max, min + k * step);
}

/** The stand holding up a hose's nozzle, with its tip at `e`, facing `yaw`: `reach` behind it, clamped round it. */
export function nozzleStand(e: Vec3, yaw: number, reach: number = NOZZLE_REACH.min): Stand {
  const y = e.y + NOZZLE_H / 2;
  const pose = { ...e, yaw };
  const rod = toWorld(pose, { x: 0, y: 0, z: -reach });
  return { x: rod.x, z: rod.z, clampY: y, to: { ...toWorld(pose, { x: 0, y: 0, z: -NOZZLE_R }), y }, yaw };
}

/** Where a nozzle's stand can be: which way the nozzle faces, with the stand behind it, and how far behind. */
export interface NozzleMount {
  turn: number;
  reach: number;
}

/**
 * Where else a nozzle's stand could go than `want`, best first, for when that's blocked: the same way at every
 * other reach, nearest first (the longer of two as near), then each quarter turn either side the same way, and last
 * the way opposite. `want` itself comes first.
 */
export function nozzleMounts(want: NozzleMount): NozzleMount[] {
  const { min, max, step } = NOZZLE_REACH;
  const reach = snapReach(want.reach);
  const reaches: number[] = [];
  for (let r = min; r <= max + 1e-9; r += step) reaches.push(r);
  reaches.sort((a, b) => Math.abs(a - reach) - Math.abs(b - reach) || b - a);
  const turns = [0, -1, 1, 2].map((k) => toCardinal(want.turn + (k * Math.PI) / 2));
  return turns.flatMap((turn) => reaches.map((r) => ({ turn, reach: r })));
}

/** A stand's base plate, standing at height `y` (the counter's top, or the floor's under it if left out). */
export function standBase(s: Stand, y = groundAt(s.x, s.z)): Box {
  const { hx, hz, h } = STAND_BASE;
  return { x: s.x, y: y + h / 2, z: s.z, yaw: s.yaw, hx, hy: h / 2, hz };
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
 * open, straight right is closed, and in between is partly open. Below the valve it closes, and left
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
