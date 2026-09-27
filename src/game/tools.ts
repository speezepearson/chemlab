import type { Fluid } from '../chem/reactions';
import { CAP } from './config';
import { Vessel, transfer, type Point } from './flask';

/** Capacity of each tank on a tool, in atoms. */
export const TANK_CAP = 4 * CAP;
/** Spout flow with the valve fully open, in atoms per sim second (one flask per second). */
export const MAX_FLOW = CAP;
/** Height of every tank, in local units. */
export const TANK_H = 84;

export type ToolKind = 'dispenser' | 'exchanger';

/**
 * A tool's geometry in local units: multiply by the stage scale and offset by
 * the tool's position, which is the top center of its bounding box.
 * Every tank is open at y = 0 and has its floor at y = TANK_H.
 */
export interface ToolShape {
  tanks: { name: string; x0: number; x1: number }[];
  valve: Point;
  /** Where fluid leaves the tool. */
  spout: Point;
  box: { x0: number; x1: number; y0: number; y1: number };
}

export const SHAPES: Record<ToolKind, ToolShape> = {
  dispenser: {
    tanks: [{ name: 'tank', x0: -30, x1: 30 }],
    valve: { x: 0, y: 98 },
    spout: { x: 0, y: 114 },
    box: { x0: -34, x1: 34, y0: -6, y1: 116 },
  },
  exchanger: {
    tanks: [
      { name: 'feed', x0: -64, x1: -6 },
      { name: 'bath', x0: 6, x1: 64 },
    ],
    valve: { x: 35, y: 98 },
    spout: { x: 35, y: 114 },
    box: { x0: -68, x1: 68, y0: -6, y1: 116 },
  },
};

export const TOOL_NAMES: Record<ToolKind, string> = { dispenser: 'Dispenser', exchanger: 'Heat exchanger' };

/**
 * Something with tanks on top and a valved spout on the bottom.
 *
 * - A **dispenser** drains its one tank through the spout.
 * - A **heat exchanger** drains its feed tank through a coil immersed in its
 *   bath tank. The fluid in the coil reaches the bath's temperature on its
 *   way through, and the bath absorbs the difference. The bath never drains.
 *
 * Tools run on sim time, so a slow drip into a reacting flask gives the same
 * result at any sim speed.
 */
export class Tool {
  readonly tanks: Vessel[];
  /** What left the spout on the last step, for drawing the stream; null if nothing did. */
  out: Fluid | null = null;

  constructor(
    readonly kind: ToolKind,
    /** Stable across z-reordering; used to find a tank from the god-mode editor. */
    readonly id: number,
    /** Position as a fraction of the stage's width and height, so it survives resizes. */
    public fx: number,
    public fy: number,
    /** 0 (closed) to 1 (MAX_FLOW). Closed by default, so a tool doesn't drip on everything it's carried over. */
    public valve = 0,
  ) {
    this.tanks = SHAPES[kind].tanks.map(() => new Vessel(TANK_CAP));
  }

  get shape(): ToolShape {
    return SHAPES[this.kind];
  }

  /** Run for `h` sim seconds. Returns the fluid that left the spout, or null if none did. */
  step(h: number): Fluid | null {
    const packet = new Vessel(Infinity);
    transfer(this.tanks[0], packet, this.valve * MAX_FLOW * h);
    if (this.kind === 'exchanger') equilibrate(packet, this.tanks[1]);
    this.out = packet.N > 0 ? packet : null;
    return this.out;
  }
}

/** Bring two fluids to a common temperature without mixing them. Heat capacity is per atom. */
export function equilibrate(a: Fluid, b: Fluid): void {
  if (a.N + b.N <= 0) return;
  a.T = b.T = (a.N * a.T + b.N * b.T) / (a.N + b.N);
}

/** The open top of a vessel, in stage coordinates: anything falling onto [x0, x1] at height y goes in. */
export interface Mouth {
  v: Vessel;
  x0: number;
  x1: number;
  y: number;
}

/** The first mouth that something falling from `p` lands in, or null if it falls to the floor. */
export function mouthBelow(mouths: readonly Mouth[], p: Point): Mouth | null {
  let best: Mouth | null = null;
  for (const m of mouths) if (m.y > p.y && p.x >= m.x0 && p.x <= m.x1 && (!best || m.y < best.y)) best = m;
  return best;
}
