import type { Fluid } from '../chem/reactions';
import { CAP } from './config';
import { Vessel, transfer, type Point } from './flask';

/** Capacity of each tank on a tool, in atoms. */
export const TANK_CAP = 4 * CAP;
/** Spout flow with the valve fully open, in atoms per sim second (one flask per second). */
export const MAX_FLOW = CAP;
/** Height of every tank, in local units. */
export const TANK_H = 84;
/**
 * How much heat a heat exchanger can move, as a heat-capacity flow in atoms
 * per sim second (heat capacity is per atom). The ratio of this to the
 * slower stream's flow is the exchanger's NTU: two streams at 1 flask/s
 * each get ε = 2/3, and at 0.25 flask/s each, ε = 8/9.
 */
export const EXCHANGE_RATE = 2 * MAX_FLOW;

export type ToolKind = 'dispenser' | 'exchanger';

/**
 * A tool's geometry in local units: multiply by the stage scale and offset by
 * the tool's position, which is the top center of its bounding box.
 * Every tank is open at y = 0 and has its floor at y = TANK_H, and drains
 * through its own valve and out its own spout, straight below its center.
 */
export interface ToolShape {
  tanks: { name: string; x0: number; x1: number }[];
  /** Height of each tank's valve and of the tip of its spout, where fluid leaves the tool. */
  valveY: number;
  spoutY: number;
  box: { x0: number; x1: number; y0: number; y1: number };
}

export const SHAPES: Record<ToolKind, ToolShape> = {
  dispenser: {
    tanks: [{ name: 'tank', x0: -30, x1: 30 }],
    valveY: 98,
    spoutY: 114,
    box: { x0: -34, x1: 34, y0: -6, y1: 116 },
  },
  exchanger: {
    tanks: [
      { name: 'A', x0: -64, x1: -6 },
      { name: 'B', x0: 6, x1: 64 },
    ],
    valveY: 122,
    spoutY: 138,
    box: { x0: -68, x1: 68, y0: -6, y1: 140 },
  },
};

/** Horizontal center of a tank, which is also where its valve and spout are. */
export const tankX = (tk: { x0: number; x1: number }) => (tk.x0 + tk.x1) / 2;

export const TOOL_NAMES: Record<ToolKind, string> = { dispenser: 'Dispenser', exchanger: 'Heat exchanger' };

/**
 * Something with tanks on top, each draining through its own valved spout.
 *
 * - A **dispenser** has one tank.
 * - A **heat exchanger** has two, whose streams pass each other in
 *   counterflow on the way to their spouts, trading heat but never mixing.
 *
 * Tools run on sim time, so a slow drip into a reacting flask gives the same
 * result at any sim speed.
 */
export class Tool {
  readonly tanks: Vessel[];
  /** Per tank: 0 (closed) to 1 (MAX_FLOW). Closed by default, so a tool doesn't drip on everything it's carried over. */
  readonly valves: number[];
  /** Per tank, what left its spout on the last step, for drawing the stream; null if nothing did. */
  out: (Fluid | null)[];

  constructor(
    readonly kind: ToolKind,
    /** Stable across z-reordering; used to find a tank from the god-mode editor. */
    readonly id: number,
    /** Position as a fraction of the stage's width and height, so it survives resizes. */
    public fx: number,
    public fy: number,
    valves: readonly number[] = [],
  ) {
    this.tanks = SHAPES[kind].tanks.map(() => new Vessel(TANK_CAP));
    this.valves = this.tanks.map((_, k) => valves[k] ?? 0);
    this.out = this.tanks.map(() => null);
  }

  get shape(): ToolShape {
    return SHAPES[this.kind];
  }

  /** Run for `h` sim seconds. Returns, per tank, the fluid that left its spout, or null if none did. */
  step(h: number): (Fluid | null)[] {
    const packets = this.tanks.map((tank, k) => {
      const p = new Vessel(Infinity);
      transfer(tank, p, this.valves[k] * MAX_FLOW * h);
      return p;
    });
    if (this.kind === 'exchanger') counterflow(packets[0], packets[1], EXCHANGE_RATE * h);
    this.out = packets.map((p) => (p.N > 0 ? p : null));
    return this.out;
  }
}

/**
 * Pass two fluids by each other in a counterflow heat exchanger that can move
 * `ua` atoms' worth of heat capacity, without mixing them. Uses the standard
 * effectiveness–NTU result: the slower stream (fewer atoms) gets a fraction ε
 * of the way to the other's inlet temperature, and the faster stream takes up
 * the heat. Heat capacity is per atom, so heat is conserved as ΣN·T.
 */
export function counterflow(a: Fluid, b: Fluid, ua: number): void {
  const cMin = Math.min(a.N, b.N);
  const cMax = Math.max(a.N, b.N);
  if (cMin <= 0) return;
  const ntu = ua / cMin;
  const cr = cMin / cMax;
  let eff: number;
  if (cr > 1 - 1e-9) eff = ntu / (1 + ntu);
  else {
    const e = Math.exp(-ntu * (1 - cr));
    eff = (1 - e) / (1 - cr * e);
  }
  const q = eff * cMin * (a.T - b.T); // heat from a to b
  a.T -= q / a.N;
  b.T += q / b.N;
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
