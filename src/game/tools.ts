import { GROUP_PRIMARY, type Atom } from '../chem/atoms';
import { THERMO } from '../chem/params';
import { heatAt, roundRandom, temperature, type Fluid } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
import { CAP } from './config';
import { Vessel, roomFor, transfer, volume, type Point } from './flask';

/** Capacity of each tank on a tool, in atoms. */
export const TANK_CAP = 4 * CAP;
/**
 * Spout flow with the valve fully open and the tank full, in atoms per sim second (one flask per second). A valve
 * lets out its openness times this, times how high the fluid stands, as a share of the tank's height (see
 * Tool.level), so a nearly empty tank trickles.
 */
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
/**
 * Below this flow, in atoms per sim second, an outlet drips instead of streaming: what leaves it gathers
 * in a hanging drop, which falls at random (see dropRate). 0.005 flask/s is about three drops a second.
 */
export const DRIP_FLOW = 0.005 * CAP;
/**
 * How hanging drops fall (see dropRate), editable from the Chemistry panel:
 * - atoms: the size at which a drop falls at one drop per second;
 * - spread: how many atoms more it takes to make that e times as likely.
 */
export const DRIP = { atoms: 1.5e6, spread: 0.12e6 };
const DEFAULT_DRIP = { ...DRIP };

export function restoreDefaultDrip(): void {
  Object.assign(DRIP, DEFAULT_DRIP);
}

/**
 * How often a hanging drop of `atoms` atoms falls, per sim second: a Poisson process whose rate,
 * e^((atoms − DRIP.atoms) / DRIP.spread), rises without limit as the drop grows, so a drop falls soon
 * after it passes DRIP.atoms however fast it's growing. By default that's 0.015 at 1M atoms, 1 at 1.5M
 * and 64 at 2M.
 */
export function dropRate(atoms: number): number {
  return Math.exp((atoms - DRIP.atoms) / DRIP.spread);
}

/**
 * One sim step of `h` seconds at an outlet, given what left it this step (`out`) and the drop hanging
 * there. A fast enough flow streams: it carries off any drop still hanging and is returned as is.
 * Otherwise it gathers in the drop, which falls with probability 1 − e^(−dropRate·h); then the fallen
 * drop is returned. Returns null if nothing leaves the outlet this step.
 */
export function drip(drop: Vessel, out: Vessel | null, h: number, rand = Math.random): Vessel | null {
  if (out && out.N >= DRIP_FLOW * h) {
    transfer(drop, out, volume(drop));
    return out;
  }
  if (out) transfer(out, drop, volume(out));
  if (drop.N <= 0 || rand() >= 1 - Math.exp(-dropRate(drop.N) * h)) return null;
  const fell = new Vessel(Infinity);
  transfer(drop, fell, volume(drop));
  return fell;
}

/** How much a splitter's funnel holds, in atoms: just a buffer, like a hose's. */
export const FUNNEL_CAP = CAP / 4;
/** How fast a splitter's funnel drains, in atoms per sim second, whatever its valve is set to. */
export const FUNNEL_RATE = 2 * MAX_FLOW;

/**
 * The size sorter's screens, in the order fluid meets them: per screen, the share of the species of each size
 * (1, 2, 3 atoms) still on the chute that falls through. Whatever passes both goes out the chute's end.
 */
export const SORTER_SCREENS: readonly (readonly number[])[] = [
  [0.7, 0, 0],
  [0.95, 0.7, 0],
];

/** How much the cryostabilizer reference holds, by volume: a hundred flasks. */
export const REFERENCE_CAP = 100 * CAP;
/** How much a pipette holds, by volume: a tenth of a flask. */
export const PIPETTE_CAP = CAP / 10;
/** A pipette's flow, full and fully open, in atoms per sim second: a fifth of what it holds. */
export const PIPETTE_FLOW = PIPETTE_CAP / 5;
/**
 * How high fluid filling `share` of a tank with a cup (see ToolShape.cup) stands above the tank's floor, in local
 * units. It's drawn across tube and cup together, in proportion to their area, so a full one is full to the cup's
 * brim, where it would spill.
 */
export function cupFillHeight(share: number, tubeW: number, tubeH: number, mouthW: number, cupH: number): number {
  const tube = tubeW * tubeH;
  const cup = ((tubeW + mouthW) / 2) * cupH;
  const a = Math.max(0, Math.min(1, share)) * (tube + cup);
  if (a <= tube) return a / tubeW;
  // up the cup, the width grows from tubeW to mouthW, so the area to height y is tubeW·y + k·y²
  const k = (mouthW - tubeW) / (2 * cupH);
  const rest = a - tube;
  const y = k > 0 ? (Math.sqrt(tubeW * tubeW + 4 * k * rest) - tubeW) / (2 * k) : rest / tubeW;
  return tubeH + Math.min(cupH, y);
}

/** How much a spectrometer's sample cup holds, by volume: a thousandth of a flask, 1M. */
export const SAMPLE_CAP = CAP / 1000;
/** Sim seconds into a spectrometer run at which each of its three hexagons lights up; the run ends with the last. */
export const SCAN_LIGHTS = [1, 3, 7] as const;
/**
 * A spectrometer run's phases: each lasts until its hexagon lights (see SCAN_LIGHTS), rumbling and shaking at
 * its own level, from 0 to 1, a step up from the last.
 */
export const SCAN_PHASES = [
  { end: SCAN_LIGHTS[0], level: 0.3 },
  { end: SCAN_LIGHTS[1], level: 0.6 },
  { end: SCAN_LIGHTS[2], level: 1 },
] as const;

/** How hard a spectrometer `age` seconds into its run rumbles and shakes (see SCAN_PHASES): 0 outside a run. */
export function scanLevel(age: number): number {
  if (age < 0) return 0;
  return SCAN_PHASES.find((ph) => age < ph.end)?.level ?? 0;
}

/** How many stretches the heater's tube is cut into, each holding what passes through it as one mixed packet. */
export const HEATER_CELLS = 24;
/** The stretches of the heater's tube that its three taps draw from: the ends of its first three quarters. */
export const HEATER_TAPS = [5, 11, 17] as const;
/**
 * How the resistive heater behaves, editable from the Chemistry panel:
 * - feed: how fast its funnel drains into its tube, in atoms per sim second (one flask a second);
 * - transit: how long fluid takes to run the length of the tube, in sim seconds, however much is in it;
 * - rate: how fast fluid in the tube heats toward the wire's temperature, per sim second: it closes
 *   1 − e^(−rate·t) of the gap in t seconds, so by default 31% by the first tap, 53%, 68%, and 78% by the end;
 * - maxT: the wire's temperature with the dial turned all the way up.
 */
export const HEATER = { feed: MAX_FLOW, transit: 6, rate: 0.25, maxT: 100 };
const DEFAULT_HEATER = { ...HEATER };

export function restoreDefaultHeater(): void {
  Object.assign(HEATER, DEFAULT_HEATER);
}

/** The heater's tube, in local units: from x0 to x1 (cut into HEATER_CELLS equal stretches), centered at y, of radius r. */
export const HEATER_TUBE = { x0: -144, x1: 144, y: 48, r: 7 };
/** The middle of stretch c of the heater's tube, in local units. */
export function heaterCellX(c: number): number {
  return HEATER_TUBE.x0 + ((c + 0.5) * (HEATER_TUBE.x1 - HEATER_TUBE.x0)) / HEATER_CELLS;
}
/** The heater's control box, above the right end of its tube, with the dial (see SHAPES.heater.valves) on it. */
export const HEATER_BOX = { x0: 100, x1: 140, y0: 2, y1: 36 };

/**
 * The heater's wire temperature for a dial setting from 0 to 1: off at 0 (it heats nothing), then rising
 * geometrically from room temperature to HEATER.maxT, so by default a quarter turn is about 3 and halfway is 10.
 */
export function wireTemperature(dial: number): number {
  return dial > 0 ? HEATER.maxT ** Math.min(1, dial) : 0;
}

/**
 * Heat a packet of fluid by the wire for `h` sim seconds: it closes 1 − e^(−HEATER.rate·h) of the gap to the
 * wire's temperature, in whole quanta. The wire only ever heats: fluid hotter than it is left alone.
 */
export function heatBy(f: Fluid, wireT: number, h: number): void {
  if (f.N <= 0 || wireT <= temperature(f)) return;
  f.Q += roundRandom((heatAt(wireT, f.N) - f.Q) * (1 - Math.exp(-HEATER.rate * h)));
}

/** The order of a spectrometer hexagon's sextants, clockwise from the top. */
export const SEXTANT_ATOMS: readonly Atom[] = ['G', 'C', 'B', 'M', 'R', 'Y'];

export type ToolKind =
  | 'dispenser' | 'pipette' | 'exchanger' | 'separator' | 'splitter' | 'sorter' | 'heater' | 'spectrometer' | 'reference';

/** Tools there's only ever one of: not in the palette, and never put away. */
export const UNIQUE_TOOLS: readonly ToolKind[] = ['spectrometer', 'reference'];

/**
 * A tool's geometry in local units: multiply by the stage scale and offset by
 * the tool's position, which is the top center of its bounding box.
 * Every tank is open at y = 0 and has its floor at y = tankH (TANK_H unless
 * set), and drains through its own valve, straight below its center.
 */
export interface ToolShape {
  tanks: { name: string; x0: number; x1: number }[];
  /** Depth of the tanks, if not TANK_H. */
  tankH?: number;
  /** Capacity of each tank, in atoms, if not TANK_CAP. */
  tankCap?: number;
  /** Whether the tanks are funnels, narrowing to a stem, rather than flat-bottomed. */
  funnel?: boolean;
  /**
   * A little funnel on top of each tank, which is where fluid goes in: its mouth reaches `w` either side of the
   * tank's center, `h` above the tank's top.
   */
  cup?: { w: number; h: number };
  /** Whether the tool has no valves to turn. */
  noValve?: boolean;
  /** Where the valves are, if not one under each tank's center at valveY: then there's one valve per entry. */
  valves?: Point[];
  /** Which valve, if any, is a dial instead: it turns clockwise from down-left (0) to down-right (1). */
  dial?: number;
  /** Whether the tanks are sealed on top, so nothing can be poured or fall into them. */
  sealed?: boolean;
  /** Spout flow with a valve fully open and the tank full, in atoms per sim second, if not MAX_FLOW. */
  maxFlow?: number;
  /** Text shown above the tool, one entry per line. */
  label?: string[];
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
  pipette: {
    // a narrow dispenser, filled through a little funnel on top
    tanks: [{ name: 'tube', x0: -5, x1: 5 }],
    tankCap: PIPETTE_CAP,
    cup: { w: 14, h: 14 },
    maxFlow: PIPETTE_FLOW,
    spouts: [0],
    valveY: 98,
    spoutY: 114,
    box: { x0: -18, x1: 18, y0: -20, y1: 116 },
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
  splitter: {
    tanks: [{ name: 'funnel', x0: -22, x1: 22 }],
    tankH: 30,
    tankCap: FUNNEL_CAP,
    funnel: true,
    // as far apart as the separator's
    spouts: [-36, 36],
    valveY: 42,
    spoutY: 84,
    box: { x0: -40, x1: 40, y0: -6, y1: 86 },
  },
  sorter: {
    // a funnel at the high end of the chute (see SORTER_CHUTE), which drops through two screens, then off its end
    tanks: [{ name: 'funnel', x0: -90, x1: -46 }],
    tankH: 30,
    tankCap: FUNNEL_CAP,
    funnel: true,
    noValve: true,
    // as far apart as the separator's
    spouts: [-24, 48, 120],
    valveY: 30,
    spoutY: 104,
    box: { x0: -94, x1: 126, y0: -6, y1: 106 },
  },
  heater: {
    // a funnel over the left end of a long tube (see HEATER_TUBE) with a wire down its middle; three taps
    // along it and its far end turning down are the spouts, and the dial on a box above its right end sets
    // the wire's heat
    tanks: [{ name: 'funnel', x0: -160, x1: -116 }],
    tankH: 30,
    tankCap: FUNNEL_CAP,
    funnel: true,
    valves: [...HEATER_TAPS.map((c) => ({ x: heaterCellX(c), y: 72 })), { x: 120, y: 20 }],
    dial: HEATER_TAPS.length,
    // as far apart as the separator's, with the end a little further on
    spouts: [...HEATER_TAPS.map(heaterCellX), 158],
    valveY: 72,
    spoutY: 92,
    box: { x0: -166, x1: 168, y0: -6, y1: 94 },
  },
  reference: {
    // a hundred flasks' worth, sealed, draining a trickle through its valve
    tanks: [{ name: 'reference', x0: -20, x1: 20 }],
    tankH: 70,
    tankCap: REFERENCE_CAP,
    sealed: true,
    maxFlow: 0.02 * MAX_FLOW,
    label: ['cryostabilizer', 'reference'],
    spouts: [0],
    valveY: 84,
    spoutY: 100,
    box: { x0: -40, x1: 40, y0: -26, y1: 102 },
  },
  spectrometer: {
    // a sample cup on a cabinet with a screen and a run button (see SPECTROMETER)
    tanks: [{ name: 'sample', x0: -12, x1: 12 }],
    tankH: 20,
    tankCap: SAMPLE_CAP,
    funnel: true,
    noValve: true,
    spouts: [],
    valveY: 20,
    spoutY: 20,
    box: { x0: -72, x1: 72, y0: -6, y1: 106 },
  },
};

/** The size sorter's chute, in local units: it slopes down from (x0, y0) to (x1, y1), where it turns down into the last spout. */
export const SORTER_CHUTE = { x0: -80, x1: 120, y0: 44, y1: 68 };
/** Height of the sorter's chute at x, in local units. */
export const chuteY = (x: number) =>
  SORTER_CHUTE.y0 + ((x - SORTER_CHUTE.x0) / (SORTER_CHUTE.x1 - SORTER_CHUTE.x0)) * (SORTER_CHUTE.y1 - SORTER_CHUTE.y0);

/** The spectrometer's cabinet, screen, hexagons (centers and radius) and run button, in local units. */
export const SPECTROMETER = {
  body: { x0: -70, x1: 70, y0: 26, y1: 104 },
  screen: { x0: -62, x1: 62, y0: 32, y1: 80 },
  hexes: { xs: [-40, 0, 40], y: 56, r: 17 },
  button: { x0: 28, x1: 62, y0: 84, y1: 98 },
};

/** Horizontal center of a tank, which is also where its valve is. */
export const tankX = (tk: { x0: number; x1: number }) => (tk.x0 + tk.x1) / 2;

/**
 * The exchanger's two hoses, wound around each other along the axis between
 * the tanks, in local units. Nine half-twists take each hose from the top of
 * one end to the bottom of the other, so a stream comes down from its tank,
 * winds across, and drops out the far side.
 */
export const HELIX = { x0: -35, x1: 35, y: 110, r: 6, halfTwists: 9 };

export const TOOL_NAMES: Record<ToolKind, string> = {
  dispenser: 'Dispenser',
  pipette: 'Pipette',
  exchanger: 'Heat exchanger',
  separator: 'Separator',
  splitter: 'Splitter',
  sorter: 'Size sorter',
  heater: 'Resistive heater',
  spectrometer: 'Mass spectrometer',
  reference: 'Cryostabilizer reference',
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
 * - A **dispenser** has one tank and one spout. A **pipette** is a narrow one, a tenth of a flask, filled
 *   through a little funnel on top, that lets out PIPETTE_FLOW full and fully open.
 * - A **heat exchanger** has two tanks, whose streams pass each other in
 *   counterflow on the way to their spouts, trading heat but never mixing.
 * - A **separator** has one tank and two spouts, and splits what drains
 *   between them by color (see LEFT_SHARE).
 * - A **splitter** has a small funnel that drains straight through (at
 *   FUNNEL_RATE) to two spouts. Its valve doesn't open or close: it sets the
 *   share that goes right, from 0 (all left) to 1 (all right).
 * - A **size sorter** has a funnel like the splitter's, with no valve, draining down a chute through two
 *   screens and off its end, each with a spout under it (see SORTER_SCREENS).
 * - A **resistive heater** has a funnel draining (at HEATER.feed) into one end of a long tube, which carries
 *   it to the other end in HEATER.transit and out a spout there, heating it all the way (see heatBy) with a
 *   wire whose temperature its dial sets (see wireTemperature). Three taps along the tube, each a valve over
 *   a spout, let fluid out sooner, less heated.
 * - A **cryostabilizer reference** is a sealed hundred flasks' worth of the target with a valve that lets out at most
 *   0.02 flask/s.
 * - A **mass spectrometer** has a small sample cup and no spouts. Running it (see scan) reads the sample's
 *   spectrum onto a screen, then lids the cup and drains the sample away into the cabinet over the run.
 *
 * Tools run on sim time, so a slow drip into a reacting flask gives the same
 * result at any sim speed.
 */
export class Tool {
  readonly tanks: Vessel[];
  /** A heater's tube, stretch by stretch from the funnel's end (see HEATER_CELLS); empty for any other tool. */
  readonly tube: Vessel[];
  /**
   * Per valve (one per tank unless the shape places them): 0 (closed) to 1 (MAX_FLOW). Closed by default, so a tool doesn't drip on everything it's carried
   * over. A splitter's one valve is instead the share going right, half by default.
   */
  readonly valves: number[];
  /** Per spout, what left it on the last step, for drawing the stream; null if nothing did. */
  out: (Vessel | null)[];
  /** Per spout, the drop hanging there, gathering a flow too slow to stream (see drip). */
  readonly drops: Vessel[];
  /** Per spout, whether it streamed on the last step, rather than dripped. Set by whoever runs drip. */
  streaming: boolean[];
  /** Per spout, the flow on the last step, in flasks per second. */
  flow: number[];
  /** A spectrometer's last reading (see spectrum), shown on its screen; null until it's first run. */
  reading: number[] | null = null;
  /** Sim seconds since the spectrometer was last run (see SCAN_LIGHTS); Infinity if it isn't running. */
  scanAge = Infinity;

  constructor(
    readonly kind: ToolKind,
    /** Stable across z-reordering; used to find a tank from the god-mode editor. */
    readonly id: number,
    /** Position as fractions of the home area's width and height (see HOME_W), outside [0, 1] beyond it. */
    public fx: number,
    public fy: number,
    valves: readonly number[] = [],
  ) {
    this.tanks = SHAPES[kind].tanks.map(() => new Vessel(SHAPES[kind].tankCap ?? TANK_CAP));
    this.tube = Array.from({ length: kind === 'heater' ? HEATER_CELLS : 0 }, () => new Vessel(Infinity));
    const nValves = SHAPES[kind].valves?.length ?? this.tanks.length;
    this.valves = Array.from({ length: nValves }, (_, k) => valves[k] ?? (kind === 'splitter' ? 0.5 : 0));
    this.out = this.shape.spouts.map(() => null);
    this.flow = this.shape.spouts.map(() => 0);
    this.drops = this.shape.spouts.map(() => new Vessel(Infinity));
    this.streaming = this.shape.spouts.map(() => false);
  }

  get shape(): ToolShape {
    return SHAPES[this.kind];
  }

  /** Run for `h` sim seconds. Returns, per spout, the fluid that left it, or null if none did. */
  step(h: number): (Vessel | null)[] {
    if (this.kind === 'spectrometer') {
      if (this.scanning) {
        // drained evenly, so the cup is empty just as the run ends
        const cup = this.tanks[0];
        const left = SCAN_LIGHTS[SCAN_LIGHTS.length - 1] - this.scanAge;
        transfer(cup, null, left <= h ? volume(cup) : (volume(cup) * h) / left);
        this.scanAge += h;
      }
      return (this.out = []);
    }
    if (this.kind === 'heater') return this.heat(h);
    const funnel = this.kind === 'splitter' || this.kind === 'sorter';
    let packets = this.tanks.map((tank, k) => {
      const p = new Vessel(Infinity);
      transfer(tank, p, funnel ? FUNNEL_RATE * h : this.valves[k] * (this.shape.maxFlow ?? MAX_FLOW) * this.level(k) * h);
      return p;
    });
    if (this.kind === 'exchanger') counterflow(packets[0], packets[1], EXCHANGE_RATE * h);
    if (this.kind === 'separator') packets = separate(packets[0]);
    if (this.kind === 'splitter') packets = divide(packets[0], () => 1 - this.valves[0]);
    if (this.kind === 'sorter') packets = sieve(packets[0]);
    this.out = packets.map((p) => (p.N > 0 ? p : null));
    this.flow = packets.map((p) => volume(p) / (MAX_FLOW * h));
    return this.out;
  }

  /**
   * A heater's step: each stretch of the tube passes h / (HEATER.transit / HEATER_CELLS) of itself on, the last
   * out the end, and the funnel tops up the first; then each tap lets out what its valve allows from its
   * stretch, and the wire heats what's left.
   */
  private heat(h: number): (Vessel | null)[] {
    const { tube, valves } = this;
    const packets = this.shape.spouts.map(() => new Vessel(Infinity));
    const on = Math.min(1, (h * HEATER_CELLS) / Math.max(1e-9, HEATER.transit));
    const last = tube.length - 1;
    transfer(tube[last], packets[HEATER_TAPS.length], volume(tube[last]) * on);
    for (let c = last - 1; c >= 0; c--) transfer(tube[c], tube[c + 1], volume(tube[c]) * on);
    transfer(this.tanks[0], tube[0], HEATER.feed * h);
    HEATER_TAPS.forEach((c, j) => transfer(tube[c], packets[j], valves[j] * MAX_FLOW * h));
    const wireT = wireTemperature(valves[this.shape.dial!]);
    for (const v of tube) heatBy(v, wireT, h);
    this.out = packets.map((p) => (p.N > 0 ? p : null));
    this.flow = packets.map((p) => volume(p) / (MAX_FLOW * h));
    return this.out;
  }

  /**
   * How high the fluid in tank k stands, as a share of the tank's full height, as it's drawn: in step with how full
   * it is, except in a tank with a cup on top (see cupFillHeight), whose narrow tube fills first.
   */
  level(k: number): number {
    const v = this.tanks[k];
    const share = Math.min(1, volume(v) / v.cap);
    const { cup, tanks, tankH = TANK_H } = this.shape;
    if (!cup) return share;
    const w = tanks[k].x1 - tanks[k].x0;
    return cupFillHeight(share, w, tankH, 2 * cup.w, cup.h) / (tankH + cup.h);
  }

  /** Whether a spectrometer run is under way, with hexagons still to light. */
  get scanning(): boolean {
    return this.scanAge < SCAN_LIGHTS[SCAN_LIGHTS.length - 1];
  }

  /** Whether the tanks are lidded, so nothing can be poured or fall in: always if sealed, and a spectrometer's while it runs. */
  get lidded(): boolean {
    return !!this.shape.sealed || (this.kind === 'spectrometer' && this.scanning);
  }

  /**
   * Run a spectrometer: read its sample's spectrum and start the hexagons lighting up (see SCAN_LIGHTS), while
   * step lids the cup and drains the sample away. Does nothing, returning false, while a run is under way.
   */
  scan(): boolean {
    if (this.kind !== 'spectrometer' || this.scanning) return false;
    const cup = this.tanks[0];
    this.reading = spectrum(cup, cup.cap);
    this.scanAge = 0;
    return true;
  }
}

/**
 * What a spectrometer shows for a sample in a cup holding `cap`: for each molecule size w (1–3 atoms) and
 * atom color c, in SEXTANT_ATOMS order, at index (w − 1)·6 + c, the share of the cup that molecules of size
 * w with a c atom in them fill (by volume, see VOLUME). So a full cup of R lights 1R fully, and of R–G both
 * 2R and 2G fully; a half-full cup reads half as bright.
 */
export function spectrum(f: Fluid, cap: number): number[] {
  const out = new Array<number>(18).fill(0);
  for (let s = 0; s < NS; s++) {
    if (!f.n[s]) continue;
    const sp = SPECIES[s];
    for (const a of sp.atoms) if (a) out[(sp.size - 1) * 6 + SEXTANT_ATOMS.indexOf(a)] += (f.n[s] * roomFor(s)) / cap;
  }
  return out;
}

/** Pass a fluid over the size sorter's screens (see SORTER_SCREENS): what falls through each, then what's left. */
export function sieve(f: Vessel): Vessel[] {
  const out: Vessel[] = [];
  let rest = f;
  for (const screen of SORTER_SCREENS) {
    const [through, over] = divide(rest, (s) => screen[SPECIES[s].size - 1]);
    out.push(through);
    rest = over;
  }
  return [...out, rest];
}

/** Split a fluid between the separator's left and right outlets by LEFT_SHARE, in whole molecules, heat in proportion. */
export function separate(f: Fluid): [Vessel, Vessel] {
  return divide(f, (s) => LEFT_SHARE[s]);
}

/** Split a fluid into left and right, sending `leftShare(s)` of species s left, in whole molecules, heat in proportion. */
export function divide(f: Fluid, leftShare: (s: number) => number): [Vessel, Vessel] {
  const out: [Vessel, Vessel] = [new Vessel(Infinity), new Vessel(Infinity)];
  for (let s = 0; s < NS; s++) {
    const left = Math.min(f.n[s], roundRandom(f.n[s] * leftShare(s)));
    out[0].n[s] = left;
    out[1].n[s] = f.n[s] - left;
    out[0].N += left * SPECIES[s].size;
    out[1].N += (f.n[s] - left) * SPECIES[s].size;
  }
  out[0].Q = f.N > 0 ? Math.min(f.Q, roundRandom((f.Q * out[0].N) / f.N)) : 0;
  out[1].Q = f.Q - out[0].Q;
  return out;
}

/**
 * Pass two fluids by each other in a counterflow heat exchanger that can move
 * `ua` atoms' worth of heat capacity, without mixing them. Uses the standard
 * effectiveness–NTU result: the slower stream (fewer atoms) gets a fraction ε
 * of the way to the other's inlet temperature, and the faster stream takes up
 * the heat, which is conserved exactly.
 */
export function counterflow(a: Fluid, b: Fluid, ua: number): void {
  const Ta = temperature(a);
  const Tb = temperature(b);
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
  // heat from a to b, in whole quanta, never more than the giver holds
  const q = roundRandom(THERMO.heatCap * eff * cMin * (Ta - Tb));
  const moved = q >= 0 ? Math.min(q, a.Q) : -Math.min(-q, b.Q);
  a.Q -= moved;
  b.Q += moved;
}

/** The open top of a vessel, in stage coordinates: anything falling onto [x0, x1] at height y goes in. */
export interface Mouth {
  v: Vessel;
  x0: number;
  x1: number;
  y: number;
  /** Where whatever overflows the vessel spills over its lip, to fall onto whatever's below; the sink if left out. */
  rim?: Point;
}

/** The first mouth that something falling from `p` lands in, or null if it falls to the floor. */
export function mouthBelow(mouths: readonly Mouth[], p: Point): Mouth | null {
  let best: Mouth | null = null;
  for (const m of mouths) if (m.y > p.y && p.x >= m.x0 && p.x <= m.x1 && (!best || m.y < best.y)) best = m;
  return best;
}

/** How much a hose's funnel holds, in atoms: just a buffer, so a loop can't spin forever in one step. */
export const HOSE_CAP = CAP / 4;
/** How fast a hose's pump moves fluid from its inlet to its outlet, in atoms per sim second. */
export const PUMP_RATE = 2 * MAX_FLOW;

/**
 * A hose: a funnel inlet anywhere, a spout outlet anywhere, and a magic pump
 * between them. Whatever falls into the funnel comes out of the outlet, up to
 * PUMP_RATE; anything arriving faster overflows the funnel to the sink.
 */
export class Hose {
  readonly funnel = new Vessel(HOSE_CAP);
  /** What left the outlet on the last step, for drawing; null if nothing did. */
  out: Vessel | null = null;
  /** The drop hanging at the outlet, gathering a flow too slow to stream (see drip). */
  readonly drop = new Vessel(Infinity);
  /** Whether the outlet streamed on the last step, rather than dripped. Set by whoever runs drip. */
  streaming = false;
  /** The flow on the last step, in flasks per second. */
  flow = 0;

  constructor(
    /** The funnel's mouth and the outlet's tip, as fractions of the home area's width and height (see HOME_W). */
    public inlet: Point,
    public outlet: Point,
  ) {}

  /** Run for `h` sim seconds. Returns what left the outlet, or null if nothing did. */
  step(h: number): Vessel | null {
    const p = new Vessel(Infinity);
    transfer(this.funnel, p, PUMP_RATE * h);
    this.out = p.N > 0 ? p : null;
    this.flow = volume(p) / (MAX_FLOW * h);
    return this.out;
  }
}
