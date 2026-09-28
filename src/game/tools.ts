import { GROUP_PRIMARY } from '../chem/atoms';
import type { Fluid } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
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

export type ToolKind = 'dispenser' | 'exchanger' | 'separator';

/**
 * A tool's geometry in local units: multiply by the stage scale and offset by
 * the tool's position, which is the top center of its bounding box.
 * Every tank is open at y = 0 and has its floor at y = TANK_H, and drains
 * through its own valve, straight below its center.
 */
export interface ToolShape {
  tanks: { name: string; x0: number; x1: number }[];
  /** Where fluid leaves the tool, in the order Tool.step returns it. */
  spouts: number[];
  /** Height of the valves, and of the tips of the spouts. */
  valveY: number;
  spoutY: number;
  box: { x0: number; x1: number; y0: number; y1: number };
}

export const SHAPES: Record<ToolKind, ToolShape> = {
  dispenser: {
    tanks: [{ name: 'tank', x0: -30, x1: 30 }],
    spouts: [0],
    valveY: 98,
    spoutY: 114,
    box: { x0: -34, x1: 34, y0: -6, y1: 116 },
  },
  exchanger: {
    tanks: [
      { name: 'A', x0: -64, x1: -6 },
      { name: 'B', x0: 6, x1: 64 },
    ],
    // the streams cross over in the exchanger, so each leaves on the other side
    spouts: [35, -35],
    valveY: 94,
    spoutY: 136,
    box: { x0: -68, x1: 68, y0: -6, y1: 138 },
  },
  separator: {
    tanks: [{ name: 'tank', x0: -30, x1: 30 }],
    // far enough apart for a flask, or a tool's tank, under each
    spouts: [-36, 36],
    valveY: 93,
    spoutY: 126,
    box: { x0: -44, x1: 44, y0: -6, y1: 128 },
  },
};

/** Horizontal center of a tank, which is also where its valve is. */
export const tankX = (tk: { x0: number; x1: number }) => (tk.x0 + tk.x1) / 2;

/**
 * The exchanger's two hoses, wound around each other along the axis between
 * the tanks, in local units. Three half-twists take each hose from the top of
 * one end to the bottom of the other, so a stream comes down from its tank,
 * winds across, and drops out the far side.
 */
export const HELIX = { x0: -35, x1: 35, y: 110, r: 6, halfTwists: 3 };

export const TOOL_NAMES: Record<ToolKind, string> = {
  dispenser: 'Dispenser',
  exchanger: 'Heat exchanger',
  separator: 'Separator',
};

/**
 * The separator splits each species between its outlets by color: a molecule
 * with p primary atoms (R, G, B) and s secondary ones (C, M, Y) leaves
 * left : right in the ratio e^p : e^s. LEFT_SHARE[species] is its left fraction.
 */
export const LEFT_SHARE: Float64Array = Float64Array.from(SPECIES, (sp) => {
  const p = sp.atoms.filter((a) => a && GROUP_PRIMARY.includes(a)).length;
  return Math.exp(p) / (Math.exp(p) + Math.exp(sp.size - p));
});

/**
 * Something with tanks on top, each draining through its own valve, and
 * spouts on the bottom.
 *
 * - A **dispenser** has one tank and one spout.
 * - A **heat exchanger** has two tanks, whose streams pass each other in
 *   counterflow on the way to their spouts, trading heat but never mixing.
 * - A **separator** has one tank and two spouts, and splits what drains
 *   between them by color (see LEFT_SHARE).
 *
 * Tools run on sim time, so a slow drip into a reacting flask gives the same
 * result at any sim speed.
 */
export class Tool {
  readonly tanks: Vessel[];
  /** Per tank: 0 (closed) to 1 (MAX_FLOW). Closed by default, so a tool doesn't drip on everything it's carried over. */
  readonly valves: number[];
  /** Per spout, what left it on the last step, for drawing the stream; null if nothing did. */
  out: (Fluid | null)[];
  /** Per spout, the flow on the last step, in flasks per second. */
  flow: number[];

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
    this.out = this.shape.spouts.map(() => null);
    this.flow = this.shape.spouts.map(() => 0);
  }

  get shape(): ToolShape {
    return SHAPES[this.kind];
  }

  /** Run for `h` sim seconds. Returns, per spout, the fluid that left it, or null if none did. */
  step(h: number): (Fluid | null)[] {
    let packets = this.tanks.map((tank, k) => {
      const p = new Vessel(Infinity);
      transfer(tank, p, this.valves[k] * MAX_FLOW * h);
      return p;
    });
    if (this.kind === 'exchanger') counterflow(packets[0], packets[1], EXCHANGE_RATE * h);
    if (this.kind === 'separator') packets = separate(packets[0]);
    this.out = packets.map((p) => (p.N > 0 ? p : null));
    this.flow = packets.map((p) => p.N / (MAX_FLOW * h));
    return this.out;
  }
}

/** Split a fluid between the separator's left and right outlets, by LEFT_SHARE. */
export function separate(f: Fluid): [Vessel, Vessel] {
  const out: [Vessel, Vessel] = [new Vessel(Infinity), new Vessel(Infinity)];
  for (let s = 0; s < NS; s++) {
    const left = f.n[s] * LEFT_SHARE[s];
    out[0].n[s] = left;
    out[1].n[s] = f.n[s] - left;
    out[0].N += left * SPECIES[s].size;
    out[1].N += (f.n[s] - left) * SPECIES[s].size;
  }
  out[0].T = out[1].T = f.T;
  return out;
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
