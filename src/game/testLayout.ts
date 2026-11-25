import { CELL, toCardinal, toWorld, type Pose, type Vec3 } from './space';
import { tankX, type Tool } from './tools';

/*
 * For tests only: laying a scene out in whole cells (see CELL), as the presets are. Nothing in the lab keeps things on
 * cells; what's set down stays where it's let go of (see GameEngine.placement).
 */

/** The middle of the cell that x (or z) is in, counting cells from 0. */
export const toCell = (v: number) => (Math.floor(v / CELL) + 0.5) * CELL;

/**
 * A pose turned to the nearest of the four ways along the room, and slid the least way that brings `anchor`, a point
 * in its own frame, over the middle of a cell.
 */
export function onCell(p: Pose, anchor: Vec3 = { x: 0, y: 0, z: 0 }): Pose {
  const q = { ...p, yaw: toCardinal(p.yaw) };
  const a = toWorld(q, anchor);
  return { ...q, x: q.x + toCell(a.x) - a.x, z: q.z + toCell(a.z) - a.z };
}

/** A tool's first tank's opening's middle, or for a tool with no tanks, its middle: the point onCell puts on a cell. */
export const toolAnchor = (t: Tool): Vec3 => ({ x: t.shape.tanks.length ? tankX(t.shape.tanks[0]) : 0, y: 0, z: 0 });

/** Half a cell along a scale from its middle, where a flask can stand on it: the point onCell puts on a cell. */
export const SCALE_ANCHOR: Vec3 = { x: CELL / 2, y: 0, z: 0 };
