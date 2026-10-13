import { ATOMS, BIT_PAIRS, GROUP, GROUP_PRIMARY, pairKey, type Atom } from '../chem/atoms';
import { THERMO } from '../chem/params';
import { heatAt, roundRandom, temperature, type Fluid } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { CAP, PRESENT_FLASKS, TRACE } from './config';
import { Vessel, roomFor, sustenance, transfer, volume, type Point } from './flask';
import { FLASK_VOLUME } from './flaskShape';
import { CELL, LIFT, ORIGIN, WALL_PANEL, type Pose, type Vec3 } from './space';
import { Supply } from './supply';

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
 * How much room fluid takes up as it's drawn, in world units cubed per atom a vessel holds: a flask's inside over
 * what it holds. Every vessel is drawn big enough inside to hold just what it holds at this, so how much fluid each
 * looks to have agrees with how much it has, from one vessel to the next.
 */
export const SPACE_PER_ATOM = FLASK_VOLUME / CAP;

/**
 * Part of a vessel's inside, as a stack of these, bottom up: `h` tall, a rectangle `w0` by `d0` (across, and front to
 * back) at its bottom widening or narrowing evenly to `w1` by `d1` at its top; or, if `round`, circles that wide.
 */
export interface Piece {
  h: number;
  w0: number;
  d0: number;
  w1: number;
  d1: number;
  round?: boolean;
}

/** The room inside the bottom `t` of a piece, in world units cubed. */
function pieceSpace(p: Piece, t = p.h): number {
  const a = (p.w1 - p.w0) / p.h;
  const b = (p.d1 - p.d0) / p.h;
  const s = p.w0 * p.d0 * t + ((p.w0 * b + p.d0 * a) * t * t) / 2 + (a * b * t * t * t) / 3;
  return p.round ? (s * Math.PI) / 4 : s;
}

/** The room inside a stack of pieces, in world units cubed. */
export const spaceOf = (ps: readonly Piece[]) => ps.reduce((t, p) => t + pieceSpace(p), 0);
/** How tall a stack of pieces is. */
export const heightOf = (ps: readonly Piece[]) => ps.reduce((t, p) => t + p.h, 0);

/** How high above its bottom fluid filling `share` of a stack of pieces stands, as it settles into them. */
export function levelIn(ps: readonly Piece[], share: number): number {
  let left = Math.max(0, Math.min(1, share)) * spaceOf(ps);
  let y = 0;
  for (const p of ps) {
    const s = pieceSpace(p);
    if (left >= s) {
      left -= s;
      y += p.h;
      continue;
    }
    let lo = 0;
    let hi = p.h;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (pieceSpace(p, mid) < left) lo = mid;
      else hi = mid;
    }
    return y + (lo + hi) / 2;
  }
  return y;
}

/** How wide a sump narrows to at its tip, where its valve is, in local units (see ToolShape.sump). */
export const SUMP_TIP = 4;
/** How wide a funnel-shaped tank narrows to at the bottom of its stem, across and front to back. */
export const FUNNEL_TIP = 6;

/**
 * Tank k of a shape's inside, `d` deep front to back, as it's drawn, bottom up: a sump under its floor, then the
 * tank; a funnel narrowing to its stem; a tube with a little funnel on top; or an upright cylinder.
 */
export function tankPieces(sh: ToolShape, k: number, d: number): Piece[] {
  const w = sh.tanks[k].x1 - sh.tanks[k].x0;
  const h = sh.tankH ?? TANK_H;
  if (sh.round) {
    const s = sh.sump;
    const tank = { h, w0: w, d0: w, w1: w, d1: w, round: true };
    return s ? [{ h: s.h, w0: SUMP_TIP, d0: SUMP_TIP, w1: s.w, d1: s.w, round: true }, tank] : [tank];
  }
  if (sh.funnel) return [{ h, w0: FUNNEL_TIP, d0: FUNNEL_TIP, w1: w, d1: d }];
  const box = { h, w0: w, d0: d, w1: w, d1: d };
  if (sh.cup) return [box, { h: sh.cup.h, w0: w, d0: d, w1: 2 * sh.cup.w, d1: 2 * sh.cup.w }];
  const sump = sh.sump;
  if (sump) return [{ h: sump.h, w0: SUMP_TIP, d0: SUMP_TIP, w1: sump.w, d1: Math.min(d, sump.w) }, box];
  return [box];
}

const depths = new Map<ToolKind, number>();

/**
 * How deep front to back a kind of tool's tanks are inside: deep enough to hold what they hold (see SPACE_PER_ATOM),
 * given how wide and tall they're drawn. A round tank is as deep as it's wide.
 */
export function tankDepth(kind: ToolKind): number {
  let d = depths.get(kind);
  if (d !== undefined) return d;
  const sh = SHAPES[kind];
  const want = (sh.tankCap ?? TANK_CAP) * SPACE_PER_ATOM;
  if (sh.round) d = sh.tanks[0].x1 - sh.tanks[0].x0;
  else {
    let [lo, hi] = [0.1, 5000];
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (spaceOf(tankPieces(sh, 0, mid)) < want) lo = mid;
      else hi = mid;
    }
    d = (lo + hi) / 2;
  }
  depths.set(kind, d);
  return d;
}
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
/**
 * How fast a splitter's or size sorter's funnel drains when full, in atoms per sim second, whatever a splitter's
 * valve is set to; it drains in proportion to how high its fluid stands (see Tool.level). An inline instrument's tube
 * drains at this rate however full it is.
 */
export const FUNNEL_RATE = 2 * MAX_FLOW;

/**
 * How well the size sorter sorts, editable from the Chemistry panel, from 0 (every size of molecule splits evenly
 * among its three spouts) to 1, the default (singles all fall through the first screen, pairs the second, and
 * triples go off the end). In between, each size goes 1/3 + 2/3·strength out its own spout and the rest evenly out
 * the other two, so at 0.55, 70% out its own and 15% out each of the others.
 */
export const SORTER = { strength: 1 };
const DEFAULT_SORTER = { ...SORTER };

export function restoreDefaultSorter(): void {
  Object.assign(SORTER, DEFAULT_SORTER);
}

/** For molecules of each size (1, 2, 3 atoms), the share going out each of the size sorter's spouts, in order. */
export function sorterShares(): number[][] {
  const k = Math.max(0, Math.min(1, SORTER.strength));
  return [0, 1, 2].map((own) => [0, 1, 2].map((j) => (j === own ? 1 / 3 + (2 / 3) * k : (1 - k) / 3)));
}

/** How much the big tank holds, by volume: a hundred flasks. */
export const BIG_TANK_CAP = 100 * CAP;
/** The big tank's inside: an upright cylinder this wide, over a round sump this wide and deep. */
export const BIG_TANK_W = 200;
const BIG_TANK_SUMP = { w: 30, h: 20 };
/** The big tank's inside height, in local units: enough, with its sump, to hold a hundred flasks. */
export const BIG_TANK_H =
  (BIG_TANK_CAP * SPACE_PER_ATOM -
    spaceOf([{ h: BIG_TANK_SUMP.h, w0: SUMP_TIP, d0: SUMP_TIP, w1: BIG_TANK_SUMP.w, d1: BIG_TANK_SUMP.w, round: true }])) /
  ((Math.PI / 4) * BIG_TANK_W ** 2);

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


/**
 * How high fluid filling `share` of a `w`-wide, `h`-deep tank with a sump under its floor (see ToolShape.sump) stands
 * above the sump's tip, in local units. It's measured by area as drawn: the sump fills first, then the tank, so a
 * full one stands h + sump.h high.
 */
export function sumpFillHeight(share: number, w: number, h: number, sump: { w: number; h: number }): number {
  const sumpArea = ((sump.w + SUMP_TIP) / 2) * sump.h;
  const a = Math.max(0, Math.min(1, share)) * (w * h + sumpArea);
  if (a > sumpArea) return sump.h + Math.min(h, (a - sumpArea) / w);
  // up the sump, the width grows from SUMP_TIP to sump.w, so the area to height y is SUMP_TIP·y + k·y²
  const k = (sump.w - SUMP_TIP) / (2 * sump.h);
  return k > 0 ? (Math.sqrt(SUMP_TIP * SUMP_TIP + 4 * k * a) - SUMP_TIP) / (2 * k) : a / SUMP_TIP;
}

/**
 * The cryostabilizer station, built into the right wall (see STATION_POSE in presets.ts): a glass funnel low on it,
 * draining into the wall, where a diverter sends what comes through either up into the reference, a tall column in the
 * wall seen through a narrow glass pane, or out a waste nozzle, by how pure it is (see Tool.receive); a faucet under
 * the reference; a diagram of the fork on the plate, lit along the way the flow is going, with a lamp that lights
 * green while it's going into the reference; and a screen. In its own flat frame, x runs along the wall and y down
 * from the column's top; z = 0 is over the middle of the counter's row of cells nearest the wall, where the funnel
 * and spouts are, and the wall is `out` behind it.
 * - paneW, paneH: the reference's pane, across and tall; the column behind it is as tall.
 * - out: how far the funnel and spouts stand out from the wall.
 * - top: how high the column's top is, in the room.
 * - plate: how deep the plate the pane is set in goes into the wall, its face flush with the wall.
 * - block: the plate's edges, in the flat frame: a swappable block of the wall, two of the wall's panels across and one
 *   high (see WALL_PANEL), lined up with them, with a rubber seam round it.
 * - funnel: the funnel's mouth, `y` down from the column's top (within easy reach), reaching w either side of its
 *   middle; it narrows to its stem h below that, which runs down and back into the wall at `inlet`.
 * - labelY: the middle of the label printed on the plate above the column.
 * - gauge: a stack of LCD segments just right of the reference, as tall as the pane, showing how far the reference is
 *   toward the goal (see gaugeSegments): x0..x1 across, and how many segments.
 * - fork: the diagram of the flow on the plate, as lines through points: in, from the inlet up to the diverter;
 *   keep, from the diverter up into the reference's column; and waste, from the diverter down to the waste nozzle.
 *   The diverter is a disc `r` across at the fork, and every line is `w` wide.
 * - lamp: the lamp that lights green while the flow goes into the reference.
 * - screen: the readout of the litres in the reference, under its label.
 * - status: the readout of how the supply stands (see supplyText), along the top left of the plate.
 */
const STATION_TOP = LIFT + 400;
const STATION_PANE_H = 260;
const FORK = { x: 1.5 * CELL, y: 110 };
export const STATION = {
  paneW: 24,
  paneH: STATION_PANE_H,
  top: STATION_TOP,
  out: CELL / 2,
  plate: 12,
  block: {
    x0: -CELL / 2,
    x1: -CELL / 2 + 2 * WALL_PANEL.w,
    y0: STATION_TOP - 2 * WALL_PANEL.h,
    y1: STATION_TOP - WALL_PANEL.h,
  },
  funnel: { y: 180, w: 30, h: 30 },
  inlet: { x: 0, y: STATION_PANE_H + 14 },
  labelY: -31,
  gauge: { x0: 3 * CELL + 20, x1: 3 * CELL + 30, segments: 26 },
  fork: {
    at: FORK,
    r: 7,
    w: 3,
    in: [[0, STATION_PANE_H + 4], [0, FORK.y], [FORK.x, FORK.y]],
    keep: [[FORK.x, FORK.y], [FORK.x, 50], [3 * CELL - 12, 50]],
    waste: [[FORK.x, FORK.y], [FORK.x, 225], [CELL, 225], [CELL, STATION_PANE_H + 4]],
  },
  lamp: { x: FORK.x + 62, y: FORK.y, r: 9 },
  screen: { x0: 3 * CELL - 50, x1: 3 * CELL + 50, y0: -19, y1: -4 },
  status: { x0: -30, x1: 2 * CELL + 20, y0: -19, y1: -4 },
};

/** The inside of the station's funnel, bottom up (see Piece): from its stem's tip up to its mouth. */
export const STATION_FUNNEL: readonly Piece[] = [
  { h: STATION.funnel.h, w0: FUNNEL_TIP, d0: FUNNEL_TIP, w1: 2 * STATION.funnel.w, d1: 2 * STATION.funnel.w },
];

/**
 * What each of the station's gauge's segments shows, bottom up, with the reference holding `held` of `cap` and the
 * goal at `goal` (all in molecules): lit green if it's wholly below what's held, flashing red if any of it is below
 * the goal, and dark otherwise.
 */
export function gaugeSegments(held: number, goal: number, cap: number, n = STATION.gauge.segments): ('held' | 'wanted' | 'off')[] {
  return Array.from({ length: n }, (_, i) =>
    ((i + 1) / n) * cap <= held ? 'held' : (i / n) * cap < goal ? 'wanted' : 'off',
  );
}
/** How much the station's funnel holds, by volume: as much as it's drawn to (see SPACE_PER_ATOM), over half a flask. */
export const RECEPTACLE_CAP = Math.round(spaceOf(STATION_FUNNEL) / SPACE_PER_ATOM);
/**
 * How much the cryostabilizer reference holds, by volume: about three times the goal (see GOAL_TARGET), so the goal is
 * a third of the way up its gauge, and there's room for it even if everything that goes into it is only just pure
 * enough, and the rest of it single atoms.
 */
export const REFERENCE_CAP = 540 * CAP;
/** The target the reference starts with, in molecules: what's left on board (see PRESENT_FLASKS and VOYAGE). */
export const REFERENCE_START = PRESENT_FLASKS * CAP;
/** How fast the reference's faucet lets it out, fully open, in atoms per sim second: a fifth of a flask a second. */
export const REFERENCE_FLOW = 0.2 * MAX_FLOW;
/**
 * How long the station's diagram stays lit along the way the flow last went, in sim seconds after the last of it
 * went through: long enough that a steady drip keeps it lit.
 */
export const DIVERT_HOLD = 2;

/**
 * The inline instruments: each is a vertical glass tube, whose top a hose's nozzle snaps onto (see INLINE_DOCK), draining
 * straight through at FUNNEL_RATE however full it is, down to a spout at its foot, past what reads what goes by: a
 * cabinet beside it (see INSTRUMENT), or the flow meter's little readout (see METER_BODY).
 */
export const INLINE_TOOLS: readonly ToolKind[] = ['analyzer', 'spectroscope', 'meter'];
/** How much an inline instrument's tube holds, by volume: a twentieth of a flask, just a buffer. */
export const TUBE_CAP = CAP / 20;
/** How wide an inline instrument's tube is inside, in local units. */
export const TUBE_W = 10;
/** How tall an inline instrument's tube is inside, in local units: enough to hold TUBE_CAP (see SPACE_PER_ATOM). */
export const TUBE_H = (TUBE_CAP * SPACE_PER_ATOM) / ((Math.PI / 4) * TUBE_W ** 2);
/**
 * How far above an inline instrument's tube, in world units, a hose's nozzle let go of over it snaps down onto its
 * top.
 */
export const INLINE_DOCK = 150;
/**
 * How quickly an inline instrument's reading follows what passes through it, in sim seconds: it reads an exponentially
 * weighted average of the flow, each moment counting e^(−age / INSTRUMENT_TAU) as much as the newest, so a change
 * starts to show at once and fades in, and out, smoothly, rather than appearing and vanishing a fixed time later. (On
 * average it lags as much as a flat window twice as long would.)
 */
export const INSTRUMENT_TAU = 0.5;
/**
 * The composition analyzer's and spectroscope's cabinet, right of the tube, with its screen, and how high the pipe
 * from the tube into it runs, in local units. The flow meter has none, just a little readout (see METER_BODY).
 */
export const INSTRUMENT = {
  body: { x0: 14, x1: 186, y0: 4, y1: 96 },
  screen: { x0: 24, x1: 176, y0: 14, y1: 86 },
  inY: 70,
};

/** How loud the composition analyzer hums while it has something to read, from 0 to 1 (see rumble.ts). */
export const ANALYZER_HUM = 0.3;
/** The share of what passes through the composition analyzer that it draws off into its cabinet, to read, and out its waste spout. */
export const ANALYZER_SAMPLE = 0.01;

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

/**
 * The heater's tube, in local units: from x0 to x1 (cut into HEATER_CELLS equal stretches), centered at y, of radius r.
 * Its taps' stretches, and its last, are a grid cell apart (see CELL), so each tap's spout and the end's can be over one.
 */
export const HEATER_TUBE = { x0: -11.5 * (CELL / 6), x1: 12.5 * (CELL / 6), y: 48, r: 7 };
/** The middle of stretch c of the heater's tube, in local units. */
export function heaterCellX(c: number): number {
  return HEATER_TUBE.x0 + ((c + 0.5) * (HEATER_TUBE.x1 - HEATER_TUBE.x0)) / HEATER_CELLS;
}
/** The heater's control box, above the right end of its tube, with the dial (see SHAPES.heater.valves) on it. */
export const HEATER_BOX = { x0: 150, x1: 190, y0: 2, y1: 36 };

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

/** How many digits the meter's display has. */
export const METER_DIGITS = 4;

/**
 * What the meter's display shows for a flow of `rate` (by volume, see VOLUME) per sim second: millions per second,
 * to as many decimal places as its four digits leave room for, so 0.012, 1.234, 56.78, 999.9, 2000.
 */
export function meterText(rate: number): string {
  const m = Math.max(0, rate) / 1e6;
  for (let dp = METER_DIGITS - 1; dp >= 0; dp--) {
    const t = m.toFixed(dp);
    if (t.replace('.', '').length <= METER_DIGITS) return t;
  }
  return '9'.repeat(METER_DIGITS);
}

/** The order of an analyzer hexagon's sextants, clockwise from the top. */
export const SEXTANT_ATOMS: readonly Atom[] = ['G', 'C', 'B', 'M', 'R', 'Y'];

export type ToolKind =
  | 'dispenser' | 'pipette' | 'exchanger' | 'separator' | 'splitter' | 'sorter' | 'heater' | 'analyzer' | 'spectroscope'
  | 'meter' | 'tank' | 'receptacle';

/**
 * Tools there's only ever one of: not in the palette, and never put away. The receptacle is the whole cryostabilizer
 * station (see STATION), its funnel and reference included.
 */
export const UNIQUE_TOOLS: readonly ToolKind[] = ['analyzer', 'spectroscope', 'receptacle'];

/**
 * A tool's geometry in local units: multiply by the stage scale and offset by
 * the tool's position, which is the top center of its bounding box.
 * Every tank is open at y = 0 and has its floor at y = tankH (TANK_H unless
 * set), and drains through its own valve, straight below its center.
 */
export interface ToolShape {
  /**
   * Each tank: its name, its walls, and if they differ from the shape's, its capacity, whether it's sealed on top, and
   * the text shown above it.
   */
  tanks: { name: string; x0: number; x1: number; cap?: number; sealed?: boolean; label?: string[] }[];
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
  /**
   * A narrow point under each tank's flat floor, `w` wide at the floor and `h` deep, narrowing to SUMP_TIP, which its
   * valve drains from. A valve pours by how high the fluid stands above the tip (see Tool.level), so with a sump the
   * last of it, down in the narrow point, still drains quickly, rather than a thin layer across the whole floor
   * trickling out ever more slowly.
   */
  sump?: { w: number; h: number };
  /** Whether the tool has no valves to turn. */
  noValve?: boolean;
  /** Where the valves are, if not one under each tank's center at valveY: then there's one valve per entry. */
  valves?: Point[];
  /** Which valve, if any, is a dial instead: it turns clockwise from down-left (0) to down-right (1). */
  dial?: number;
  /** Whether its tanks are upright cylinders, as wide front to back as across, rather than boxes; a sump too. */
  round?: boolean;
  /** Whether it stays where it is: it can't be picked up and carried. */
  fixed?: boolean;
  /** Whether it's built into a wall, with no stand: only the cryostabilizer station (see STATION). */
  wall?: boolean;
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
    sump: { w: 14, h: 7 },
    spouts: [0],
    valveY: 98,
    spoutY: 114,
    box: { x0: -34, x1: 34, y0: -6, y1: 116 },
  },
  pipette: {
    // a narrow dispenser, filled through a little funnel on top
    tanks: [{ name: 'tube', x0: -5, x1: 5 }],
    tankCap: PIPETTE_CAP,
    cup: { w: 10, h: 8 },
    maxFlow: PIPETTE_FLOW,
    spouts: [0],
    valveY: 98,
    spoutY: 114,
    box: { x0: -18, x1: 18, y0: -20, y1: 116 },
  },
  exchanger: {
    tanks: [
      { name: 'A', x0: -79, x1: -21 },
      { name: 'B', x0: 21, x1: 79 },
    ],
    sump: { w: 14, h: 7 },
    // the streams cross over in the exchanger, so each leaves on the other side, a grid cell apart (see CELL)
    spouts: [CELL / 2, -CELL / 2],
    valveY: 97,
    spoutY: 136,
    box: { x0: -83, x1: 83, y0: -6, y1: 138 },
  },
  separator: {
    tanks: [{ name: 'tank', x0: -30, x1: 30 }],
    // one outlet per mix of primary and secondary (see SEPARATOR_OUTLET), a grid cell apart (see CELL), so a flask
    // or a tool's tank fits under each
    spouts: [-2 * CELL, -CELL, 0, CELL, 2 * CELL],
    sump: { w: 14, h: 7 },
    valveY: 96,
    spoutY: 126,
    // the manifold under it (see the engine's SEP_BODY), with a handle on its left end
    box: { x0: -220, x1: 214, y0: -6, y1: 128 },
  },
  splitter: {
    tanks: [{ name: 'funnel', x0: -22, x1: 22 }],
    tankH: 30,
    tankCap: FUNNEL_CAP,
    funnel: true,
    // a grid cell either side of its funnel, like the separator's
    spouts: [-CELL, CELL],
    valveY: 42,
    spoutY: 84,
    box: { x0: -116, x1: 116, y0: -6, y1: 86 },
  },
  sorter: {
    // a funnel at the high end of the chute (see SORTER_CHUTE), which drops through two screens, then off its end
    tanks: [{ name: 'funnel', x0: -CELL - 22, x1: -CELL + 22 }],
    tankH: 30,
    tankCap: FUNNEL_CAP,
    funnel: true,
    noValve: true,
    // a grid cell apart, like the separator's, the first a cell on from the funnel
    spouts: [0, CELL, 2 * CELL],
    valveY: 30,
    spoutY: 104,
    box: { x0: -126, x1: 206, y0: -6, y1: 106 },
  },
  heater: {
    // a funnel over the left end of a long tube (see HEATER_TUBE) with a wire down its middle; three taps
    // along it and its far end turning down are the spouts, and the dial on a box above its right end sets
    // the wire's heat
    tanks: [{ name: 'funnel', x0: -2 * CELL - 22, x1: -2 * CELL + 22 }],
    tankH: 30,
    tankCap: FUNNEL_CAP,
    funnel: true,
    valves: [...HEATER_TAPS.map((_, j) => ({ x: (j - 1) * CELL, y: 72 })), { x: 170, y: 20 }],
    dial: HEATER_TAPS.length,
    // a grid cell apart, like the separator's, under the taps' stretches (see heaterCellX) and then the last
    spouts: [-CELL, 0, CELL, 2 * CELL],
    valveY: 72,
    spoutY: 92,
    box: { x0: -228, x1: 216, y0: -6, y1: 94 },
  },
  tank: {
    // a hundred flasks' worth, drawn as big as a hundred flasks, with ten faint graduations across it
    tanks: [{ name: 'tank', x0: -BIG_TANK_W / 2, x1: BIG_TANK_W / 2 }],
    tankH: BIG_TANK_H,
    tankCap: BIG_TANK_CAP,
    round: true,
    sump: BIG_TANK_SUMP,
    spouts: [0],
    valveY: BIG_TANK_H + 28,
    spoutY: BIG_TANK_H + 44,
    box: { x0: -BIG_TANK_W / 2 - 4, x1: BIG_TANK_W / 2 + 4, y0: -6, y1: BIG_TANK_H + 46 },
  },
  receptacle: {
    // the cryostabilizer station: a funnel into the wall, a waste nozzle a grid cell along, and the reference, a
    // column in the wall behind a pane, with a faucet under it, two more along (see STATION and CELL)
    tanks: [
      { name: 'funnel', x0: -STATION.funnel.w, x1: STATION.funnel.w, cap: RECEPTACLE_CAP },
      {
        name: 'ship reservoir', x0: 3 * CELL - STATION.paneW / 2, x1: 3 * CELL + STATION.paneW / 2, cap: REFERENCE_CAP, sealed: true,
        label: ['ship reservoir'],
      },
    ],
    tankH: STATION.paneH,
    // the reference's faucet's; the waste nozzle has no valve, since the diverter works it
    valves: [{ x: 3 * CELL, y: STATION.paneH + 24 }],
    maxFlow: REFERENCE_FLOW,
    fixed: true,
    wall: true,
    spouts: [CELL, 3 * CELL],
    valveY: STATION.paneH + 24,
    spoutY: STATION.paneH + 44,
    box: { x0: STATION.block.x0 - 6, x1: STATION.block.x1 + 6, y0: STATION.block.y0 - 6, y1: STATION.block.y1 + 6 },
  },
  meter: {
    // a glass tube straight down to a spout, with a little readout (see METER_BODY) clipped round the pipe under it
    tanks: [{ name: 'tube', x0: -TUBE_W / 2, x1: TUBE_W / 2 }],
    tankH: TUBE_H,
    tankCap: TUBE_CAP,
    round: true,
    noValve: true,
    spouts: [0],
    valveY: TUBE_H,
    spoutY: TUBE_H + 32,
    box: { x0: -15, x1: 15, y0: -6, y1: TUBE_H + 34 },
  },
  analyzer: {
    // a glass tube straight down to a spout, and a cabinet beside it with a screen (see ANALYZER), which takes its
    // sample from the tube's foot and lets it out a waste spout on its far side, two grid cells along
    tanks: [{ name: 'tube', x0: -TUBE_W / 2, x1: TUBE_W / 2 }],
    tankH: TUBE_H,
    tankCap: TUBE_CAP,
    round: true,
    noValve: true,
    spouts: [0, 2 * CELL],
    valveY: TUBE_H,
    spoutY: 116,
    box: { x0: -10, x1: 2 * CELL + 6, y0: -6, y1: 118 },
  },
  spectroscope: {
    // a glass tube straight down to a spout, past a cabinet beside it with a screen showing a graph (see SPECTROSCOPE)
    tanks: [{ name: 'tube', x0: -TUBE_W / 2, x1: TUBE_W / 2 }],
    tankH: TUBE_H,
    tankCap: TUBE_CAP,
    round: true,
    noValve: true,
    spouts: [0],
    valveY: TUBE_H,
    spoutY: 116,
    box: { x0: -10, x1: INSTRUMENT.body.x1 + 4, y0: -6, y1: 118 },
  },
};

/** The size sorter's chute, in local units: it slopes down from (x0, y0) to (x1, y1), where it turns down into the last spout. */
export const SORTER_CHUTE = { x0: -112, x1: 200, y0: 44, y1: 68 };
/** Height of the sorter's chute at x, in local units. */
export const chuteY = (x: number) =>
  SORTER_CHUTE.y0 + ((x - SORTER_CHUTE.x0) / (SORTER_CHUTE.x1 - SORTER_CHUTE.x0)) * (SORTER_CHUTE.y1 - SORTER_CHUTE.y0);

/**
 * The composition analyzer's hexagons on its screen (centers and radius), and how high the pipe out of its cabinet to
 * its waste spout runs, in local units.
 */
export const ANALYZER = {
  hexes: { xs: [50, 100, 150], y: 50, r: 21 },
  wasteY: 84,
};

/**
 * The spectroscope's graph (see spectroscopeAt): its x axis runs from lnE0 to lnE1, and each bond's line is a Gaussian
 * `width` wide (its standard deviation), in lnE.
 */
export const SPECTROSCOPE = { lnE0: -0.5, lnE1: 3.5, width: 0.02 };

/** Every bond there can be, by its key (see pairKey): the twelve pairs of atoms from different groups. */
export const BOND_KEYS: readonly string[] = [
  ...new Set(ATOMS.flatMap((a) => ATOMS.filter((b) => GROUP[a] !== GROUP[b]).map((b) => pairKey(a, b)))),
];

/** For each species, its bonds, by their place in BOND_KEYS. */
const SPECIES_BONDS: readonly (readonly number[])[] = SPECIES.map((sp) =>
  BIT_PAIRS.flatMap(([g1, g2], k) => (sp.mask & (1 << k) ? [BOND_KEYS.indexOf(pairKey(sp.atoms[g1]!, sp.atoms[g2]!))] : [])),
);

/** How many of each bond (in BOND_KEYS order) a fluid's molecules have between them. */
export function bondCounts(f: Fluid): number[] {
  const out = BOND_KEYS.map(() => 0);
  for (let s = 0; s < NS; s++) if (f.n[s]) for (const b of SPECIES_BONDS[s]) out[b] += f.n[s];
  return out;
}

/**
 * The height of the spectroscope's graph at x = lnE: each bond's count, `counts` (in BOND_KEYS order), spread as a
 * Gaussian SPECTROSCOPE.width wide about the log of the size of its energy, `energies` (so an uphill bond shows at its
 * size too), peaking at its count, all added up. A bond with no energy shows nowhere.
 */
export function spectroscopeAt(x: number, counts: readonly number[], energies: readonly number[]): number {
  const w = SPECTROSCOPE.width;
  let y = 0;
  counts.forEach((c, i) => {
    const e = Math.abs(energies[i]);
    if (c > 0 && e > 0) y += c * Math.exp(-((x - Math.log(e)) ** 2) / (2 * w * w));
  });
  return y;
}

/**
 * The flow meter's readout, clipped round the pipe just under its tube, reaching `hz` either side of it front to back,
 * and the display on its front, in local units.
 */
export const METER_BODY = {
  x0: -13, x1: 13, y0: TUBE_H + 6, y1: TUBE_H + 18, hz: 5,
  display: { x0: -12, x1: 12, y0: TUBE_H + 7, y1: TUBE_H + 17 },
};

/** Horizontal center of a tank, which is also where its valve is. */
export const tankX = (tk: { x0: number; x1: number }) => (tk.x0 + tk.x1) / 2;

/**
 * The exchanger's two hoses, wound around each other along the axis between
 * the tanks, in local units. Nine half-twists take each hose from the top of
 * one end to the bottom of the other, so a stream comes down from its tank,
 * winds across, and drops out the far side.
 */
export const HELIX = { x0: -CELL / 2, x1: CELL / 2, y: 110, r: 6, halfTwists: 9 };

export const TOOL_NAMES: Record<ToolKind, string> = {
  dispenser: 'Dispenser',
  pipette: 'Pipette',
  exchanger: 'Heat exchanger',
  separator: 'Separator',
  splitter: 'Splitter',
  sorter: 'Size sorter',
  heater: 'Resistive heater',
  meter: 'Flow meter',
  tank: 'Tank',
  receptacle: 'Cryostabilizer',
  analyzer: 'Composition analyzer',
  spectroscope: 'Spectroscope',
};

/**
 * How sharply the separator sorts, editable from the Chemistry panel: each molecule goes to outlet j in proportion
 * to e^(−sharpness·(j − its own outlet)²) (see SEPARATOR_OUTLET). At 0 everything splits evenly five ways; at 3 a
 * molecule goes 91% to its own outlet if it's one of the middle three, 95% if it's at an end, and the rest mostly to
 * the next outlet over; and from SEPARATOR_PERFECT up, which is the default, every molecule goes out its own.
 */
export const SEPARATOR = { sharpness: 10 };
const DEFAULT_SEPARATOR = { ...SEPARATOR };

export function restoreDefaultSeparator(): void {
  Object.assign(SEPARATOR, DEFAULT_SEPARATOR);
}

/** The sharpness from which the separator sorts perfectly: the top of its slider. */
export const SEPARATOR_PERFECT = 10;

/** How many outlets the separator has, one per mix of primary and secondary atoms a molecule can have. */
export const SEPARATOR_OUTLETS = 5;

/**
 * Each species' own outlet on the separator, left to right, by the share of its atoms that are primary (R, G, B):
 * all of them (0), two in three (1), half (2), one in three (3), none (4).
 */
export const SEPARATOR_OUTLET: Uint8Array = Uint8Array.from(SPECIES, (sp) => {
  const p = sp.atoms.filter((a) => a && GROUP_PRIMARY.includes(a)).length;
  if (p === sp.size) return 0;
  if (p === 0) return 4;
  if (2 * p === sp.size) return 2;
  return 3 * p === 2 * sp.size ? 1 : 3;
});

let shareCache = { sharpness: NaN, shares: [] as number[][] };

/** For each of its own outlets, the shares a molecule sends to each outlet, at the current SEPARATOR.sharpness. */
export function separatorShares(): number[][] {
  const k = SEPARATOR.sharpness;
  if (shareCache.sharpness !== k) {
    const shares = Array.from({ length: SEPARATOR_OUTLETS }, (_, own) => {
      const w = Array.from({ length: SEPARATOR_OUTLETS }, (_, j) =>
        k >= SEPARATOR_PERFECT ? +(j === own) : Math.exp(-k * (j - own) ** 2),
      );
      const total = w.reduce((a, b) => a + b, 0);
      return w.map((x) => x / total);
    });
    shareCache = { sharpness: k, shares };
  }
  return shareCache.shares;
}

/**
 * Something with tanks on top, each draining through its own valve, and
 * spouts on the bottom.
 *
 * - A **dispenser** has one tank and one spout. A **pipette** is a narrow one, a tenth of a flask, filled
 *   through a little funnel on top, that lets out PIPETTE_FLOW full and fully open.
 * - A **heat exchanger** has two tanks, whose streams pass each other in
 *   counterflow on the way to their spouts, trading heat but never mixing.
 * - A **separator** has one tank and five spouts, and sorts what drains
 *   among them by its mix of primary and secondary colors (see separate).
 * - A **splitter** has a small funnel that drains straight through (at
 *   FUNNEL_RATE) to two spouts. Its valve doesn't open or close: it sets the
 *   share that goes right, from 0 (all left) to 1 (all right).
 * - A **size sorter** has a funnel like the splitter's, with no valve, draining down a chute through two
 *   screens and off its end, each with a spout under it (see SORTER_SCREENS).
 * - A **resistive heater** has a funnel draining (at HEATER.feed) into one end of a long tube, which carries
 *   it to the other end in HEATER.transit and out a spout there, heating it all the way (see heatBy) with a
 *   wire whose temperature its dial sets (see wireTemperature). Three taps along the tube, each a valve over
 *   a spout, let fluid out sooner, less heated.
 * - A **tank** is a dispenser holding a hundred flasks, drawn as big as a hundred flasks, with ten faint
 *   graduations across it.
 * - A **receptacle** is the cryostabilizer station, built into the wall (see STATION): a funnel draining straight
 *   into the wall at FUNNEL_RATE, where a diverter sends what's more than GOAL_PURITY target into the cryostabilizer
 *   reference, and anything else out its waste nozzle, the first spout (see receive). The reference lets out a
 *   trickle through its faucet, the second spout, as far as its one valve is open.
 * - A **flow meter** is an inline instrument (see INLINE_TOOLS): its tube drains straight through to one spout, and
 *   it shows what flows out, averaged over the recent past (see INSTRUMENT_TAU, rate and meterText).
 * - A **composition analyzer** is an inline instrument too, and it draws off ANALYZER_SAMPLE of what passes, out its waste spout, reading that (see
 *   composition) onto a screen, averaged over the recent past (see INSTRUMENT_TAU).
 * - A **spectroscope** is an inline instrument too, which lets everything through, counting the bonds that pass over
 *   the recent past (see INSTRUMENT_TAU and bondCounts) and showing them by energy as a graph (see spectroscopeAt).
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
  /**
   * An analyzer's reading (see composition), shown on its screen: what it drew off in the recent past (see
   * INSTRUMENT_TAU), as shares of its volume; null once that's down to less than TRACE a sim second.
   */
  reading: number[] | null = null;
  /**
   * A spectroscope's reading: how many of each bond (in BOND_KEYS order) have passed through it per sim second, in
   * the recent past (see INSTRUMENT_TAU); all 0 once they're down to less than TRACE a sim second in all.
   */
  bonds: number[] = BOND_KEYS.map(() => 0);
  /**
   * A meter's reading: what's flowed out of it, by volume per sim second, in the recent past (see INSTRUMENT_TAU); 0
   * once that's down to less than TRACE a sim second.
   */
  rate = 0;
  /** An inline instrument's exponentially weighted average of what it's measured, per sim second (see smooth). */
  private smoothed: number[] | null = null;
  /**
   * The player's note about the whole tool, written above it; empty for none. Only a tool with more than one tank
   * has one: on a tool with one tank, its tank's label (Vessel.label) does the job.
   */
  note = '';
  /** Which way a receptacle's diverter last sent what came through it: into the reference, or out as waste. */
  private diverted: 'keep' | 'waste' | null = null;
  /** Sim seconds since anything last came through a receptacle's diverter. */
  private sinceDiverted = Infinity;
  /** A receptacle's flow of the target into its reference, for the ship to judge (see Supply); null on other tools. */
  readonly supply: Supply | null;

  constructor(
    readonly kind: ToolKind,
    /** Stable across saves; used to find a tank from the god-mode editor. */
    readonly id: number,
    /** Where the top center of its bounding box is in the room, and which way it faces (see space.ts). */
    public pose: Pose = { ...ORIGIN },
    valves: readonly number[] = [],
  ) {
    this.tanks = SHAPES[kind].tanks.map((tk) => new Vessel(tk.cap ?? SHAPES[kind].tankCap ?? TANK_CAP));
    this.tube = Array.from({ length: kind === 'heater' ? HEATER_CELLS : 0 }, () => new Vessel(Infinity));
    const nValves = SHAPES[kind].valves?.length ?? this.tanks.length;
    this.valves = Array.from({ length: nValves }, (_, k) => valves[k] ?? (kind === 'splitter' ? 0.5 : 0));
    this.out = this.shape.spouts.map(() => null);
    this.flow = this.shape.spouts.map(() => 0);
    this.drops = this.shape.spouts.map(() => new Vessel(Infinity));
    this.streaming = this.shape.spouts.map(() => false);
    this.supply = kind === 'receptacle' ? new Supply() : null;
  }

  get shape(): ToolShape {
    return SHAPES[this.kind];
  }

  /** Run for `h` sim seconds. Returns, per spout, the fluid that left it, or null if none did. */
  step(h: number): (Vessel | null)[] {
    if (this.kind === 'heater') return this.heat(h);
    if (this.kind === 'receptacle') return this.receive(h);
    let packets = this.tanks.map((tank, k) => {
      const p = new Vessel(Infinity);
      // a valve, or a funnel without one, lets out in proportion to how high the fluid stands; an instrument's tube
      // drains at a fixed rate, so what it reads is just what's arriving
      const rate =
        INLINE_TOOLS.includes(this.kind) ? FUNNEL_RATE
        : this.kind === 'splitter' || this.kind === 'sorter' ? FUNNEL_RATE * this.level(k)
        : this.valves[k] * (this.shape.maxFlow ?? MAX_FLOW) * this.level(k);
      transfer(tank, p, rate * h);
      return p;
    });
    if (this.kind === 'exchanger') counterflow(packets[0], packets[1], EXCHANGE_RATE * h);
    if (this.kind === 'separator') packets = separate(packets[0]);
    if (this.kind === 'splitter') packets = divide(packets[0], () => 1 - this.valves[0]);
    if (this.kind === 'sorter') packets = sieve(packets[0]);
    if (this.kind === 'analyzer') packets = divide(packets[0], () => 1 - ANALYZER_SAMPLE);
    this.out = packets.map((p) => (p.N > 0 ? p : null));
    this.flow = packets.map((p) => volume(p) / (MAX_FLOW * h));
    if (this.kind === 'meter') {
      const [v] = this.smooth(h, [volume(packets[0])]);
      this.rate = v >= TRACE ? v : 0;
    }
    if (this.kind === 'analyzer') {
      const [v, ...spec] = this.smooth(h, [volume(packets[1]), ...composition(packets[1], 1)]);
      this.reading = v >= TRACE ? spec.map((x) => x / v) : null;
    }
    if (this.kind === 'spectroscope') {
      const bonds = this.smooth(h, bondCounts(packets[0]));
      this.bonds = bonds.reduce((a, b) => a + b, 0) >= TRACE ? [...bonds] : bonds.map(() => 0);
    }
    return this.out;
  }

  /**
   * An inline instrument's reading after a step of h sim seconds in which it measured x: the exponentially weighted
   * average (see INSTRUMENT_TAU) of what it's measured, per sim second, entry by entry. It's exact for whatever passed
   * evenly through each step, so it comes out the same at any sim speed. It starts from nothing measured.
   */
  private smooth(h: number, x: number[]): number[] {
    const keep = Math.exp(-h / INSTRUMENT_TAU);
    const s = (this.smoothed ??= x.map(() => 0));
    x.forEach((v, i) => (s[i] = s[i] * keep + (v / h) * (1 - keep)));
    return s;
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
    transfer(this.tanks[0], tube[0], HEATER.feed * this.level(0) * h);
    HEATER_TAPS.forEach((c, j) => transfer(tube[c], packets[j], valves[j] * MAX_FLOW * h));
    const wireT = wireTemperature(valves[this.shape.dial!]);
    for (const v of tube) heatBy(v, wireT, h);
    this.out = packets.map((p) => (p.N > 0 ? p : null));
    this.flow = packets.map((p) => volume(p) / (MAX_FLOW * h));
    return this.out;
  }

  /**
   * How high the fluid in tank k stands, as a share of the tank's full height, for how fast it drains: in step with
   * how full it is, except in a tank with a cup on top (see cupFillHeight), whose narrow tube fills first, or a sump
   * below (see sumpFillHeight), which fills first and is measured from its tip. This goes by the tank's flat outline,
   * as the game has always drained, not by how it's drawn in the room (see tankPieces), so flows stay as they were.
   */
  level(k: number): number {
    const v = this.tanks[k];
    const share = Math.min(1, volume(v) / v.cap);
    const { cup, sump, tanks, tankH = TANK_H } = this.shape;
    const w = tanks[k].x1 - tanks[k].x0;
    if (sump) return sumpFillHeight(share, w, tankH, sump) / (tankH + sump.h);
    if (cup) return cupFillHeight(share, w, tankH, 2 * cup.w, cup.h) / (tankH + cup.h);
    return share;
  }

  /** Whether the tanks are lidded, so nothing can be poured or fall in: if they're sealed. */
  get lidded(): boolean {
    return !!this.shape.sealed;
  }

  /** Whether tank k is open on top, to pour into: not if the tool's lidded, or the tank's sealed. */
  isOpen(k: number): boolean {
    return !this.lidded && !this.shape.tanks[k].sealed;
  }

  /**
   * Which way a receptacle's diverter is sending what comes through it, for its diagram, its lamp and its sound: the
   * way it last went, if anything has in the last DIVERT_HOLD; null if nothing has.
   */
  get diverting(): 'keep' | 'waste' | null {
    return this.sinceDiverted <= DIVERT_HOLD ? this.diverted : null;
  }

  /**
   * A receptacle's step. Its reference's faucet lets out as far as its valve is open, at REFERENCE_FLOW. Its funnel
   * drains into the wall at FUNNEL_RATE however full it is, so it only fills (and spills) if more arrives than that,
   * past the diverter, which judges what's in the funnel: more than GOAL_PURITY target, and it goes into the
   * reference, as far as there's room, and otherwise out the waste nozzle. It records the target going into the
   * reference, and out its faucet, in its supply.
   */
  private receive(h: number): (Vessel | null)[] {
    const [funnel, ref] = this.tanks;
    const out: (Vessel | null)[] = [null, null];
    const tap = new Vessel(Infinity);
    transfer(ref, tap, this.valves[0] * REFERENCE_FLOW * h);
    if (tap.N > 0) out[1] = tap;
    const held = ref.n[TARGET];
    this.sinceDiverted += h;
    if (funnel.N > 0) {
      const keep = sustenance(funnel) > 0;
      const waste = new Vessel(Infinity);
      if (keep ? transfer(funnel, ref, FUNNEL_RATE * h) > 0 : transfer(funnel, waste, FUNNEL_RATE * h) > 0) {
        this.diverted = keep ? 'keep' : 'waste';
        this.sinceDiverted = 0;
      }
      if (waste.N > 0) out[0] = waste;
    }
    this.supply!.record(h, ref.n[TARGET] - held, tap.n[TARGET]);
    this.out = out;
    this.flow = out.map((p) => (p ? volume(p) / (MAX_FLOW * h) : 0));
    return out;
  }
}

/**
 * What an analyzer shows for a sample, against `cap`: for each molecule size w (1–3 atoms) and atom color c, in
 * SEXTANT_ATOMS order, at index (w − 1)·6 + c, how much of `cap` molecules of size w with a c atom in them make up
 * (by volume, see VOLUME). So against the sample's own volume, R lights 1R fully, and R–G both 2R and 2G fully; and
 * half R, half G lights 1R and 1G half as bright.
 */
export function composition(f: Fluid, cap: number): number[] {
  const out = new Array<number>(18).fill(0);
  for (let s = 0; s < NS; s++) {
    if (!f.n[s]) continue;
    const sp = SPECIES[s];
    for (const a of sp.atoms) if (a) out[(sp.size - 1) * 6 + SEXTANT_ATOMS.indexOf(a)] += (f.n[s] * roomFor(s)) / cap;
  }
  return out;
}

/**
 * Pass a fluid over the size sorter's screens (see sorterShares): what falls through the first, what falls through
 * the second, and what goes off the end, in whole molecules, with heat in proportion.
 */
export function sieve(f: Fluid): Vessel[] {
  const shares = sorterShares();
  return split(f, 3, (s) => shares[SPECIES[s].size - 1]);
}

/** Split a fluid among the separator's outlets, left to right (see separatorShares), in whole molecules, heat in proportion. */
export function separate(f: Fluid): Vessel[] {
  const shares = separatorShares();
  return split(f, SEPARATOR_OUTLETS, (s) => shares[SEPARATOR_OUTLET[s]]);
}

/**
 * Split a fluid `n` ways, sending `shares(s)[j]` of species s to the j-th, in whole molecules (the last takes
 * whatever rounding leaves), with heat in proportion to atoms.
 */
export function split(f: Fluid, n: number, shares: (s: number) => readonly number[]): Vessel[] {
  const out = Array.from({ length: n }, () => new Vessel(Infinity));
  for (let s = 0; s < NS; s++) {
    if (!f.n[s]) continue;
    const sh = shares(s);
    let left = f.n[s];
    for (let j = 0; j < n; j++) {
      const m = j === n - 1 ? left : Math.min(left, roundRandom(f.n[s] * sh[j]));
      left -= m;
      out[j].n[s] += m;
      out[j].N += m * SPECIES[s].size;
    }
  }
  let Q = f.Q;
  for (let j = 0; j < n; j++) {
    out[j].Q = j === n - 1 ? Q : f.N > 0 ? Math.min(Q, roundRandom((f.Q * out[j].N) / f.N)) : 0;
    Q -= out[j].Q;
  }
  return out;
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

/**
 * The open top of a vessel, in the room: anything falling onto it goes in. It's a rectangle `hx` by `hz` either
 * side of its center (x, y, z), along the vessel's own axes, turned by `yaw` about the vertical (see toWorld).
 */
export interface Mouth {
  v: Vessel;
  x: number;
  y: number;
  z: number;
  hx: number;
  hz: number;
  yaw?: number;
  /** Where whatever overflows the vessel spills over its lip, to fall onto whatever's below; the sink if left out. */
  rim?: Vec3;
}

/** Whether something falling straight down at (x, z) lands in a mouth (if it's below it). */
export function overMouth(m: Mouth, x: number, z: number): boolean {
  const c = Math.cos(m.yaw ?? 0);
  const s = Math.sin(m.yaw ?? 0);
  const dx = x - m.x;
  const dz = z - m.z;
  return Math.abs(dx * c - dz * s) <= m.hx && Math.abs(dx * s + dz * c) <= m.hz;
}

/** The first mouth that something falling from `p` lands in, or null if it falls to the sink. */
export function mouthBelow(mouths: readonly Mouth[], p: Vec3): Mouth | null {
  let best: Mouth | null = null;
  for (const m of mouths) if (m.y < p.y && overMouth(m, p.x, p.z) && (!best || m.y > best.y)) best = m;
  return best;
}

/** What a hose runs from: a tool's spout, or a faucet (by its place in the lab's list). */
export type HoseMount = { tool: Tool; spout: number } | { faucet: number };

/** Whether two mounts are the same spout or faucet. */
export const sameMount = (a: HoseMount, b: HoseMount) =>
  'tool' in a ? 'tool' in b && a.tool === b.tool && a.spout === b.spout : 'faucet' in b && a.faucet === b.faucet;

/**
 * A hose pulled out of a spout or a faucet: whatever would leave the spout comes out of the hose's nozzle instead,
 * wherever that's been set down, and falls from there. Every spout and faucet has one, rolled up inside it until it's
 * pulled out.
 */
export class Hose {
  /** Which way its nozzle faces, about the vertical (see Pose), with the stand holding it up behind it. */
  turn = 0;

  constructor(
    /** The spout or faucet it runs from. */
    readonly on: HoseMount,
    /** Its nozzle's tip, in the room. */
    public outlet: Vec3,
    /** How far behind the nozzle its stand's rod is (see NOZZLE_REACH in bodies.ts). */
    public reach: number,
  ) {}
}
