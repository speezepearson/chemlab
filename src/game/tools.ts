import { BOND_KEYS, BONDS, SOLVENT, type ColorAtom } from '../chem/atoms';
import { THERMO, T_ROOM } from '../chem/params';
import { heatAt, roundRandom, temperature, type Fluid } from '../chem/reactions';
import { END_WEIGHT, LOOSE_ENDS } from '../chem/shape';
import { NS, SPECIES } from '../chem/species';
import { CAP, DELIVERY, TRACE } from './config';
import { COOLING } from './cooling';
import { Vessel, roomFor, sustenance, transfer, volume, type Point } from './flask';
import { FLASK_VOLUME } from './flaskShape';
import { CELL, LIFT, ORIGIN, WALL_PANEL, type Pose, type Vec3 } from './space';
import { CRYOSTABILIZER, SUPPLIES, nextSupply, type Supply } from './supply';

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
 * tank; a funnel narrowing to its stem; a tube with a little funnel on top; or an upright cylinder, with a narrow neck
 * on top of it if it has one.
 */
export function tankPieces(sh: ToolShape, k: number, d: number): Piece[] {
  // a tank with a neck is filled through an inlet off to one side, and is as wide as its neck says (see ToolShape.neck)
  const w = sh.neck ? sh.neck.body : sh.tanks[k].x1 - sh.tanks[k].x0;
  const h = sh.tankH ?? TANK_H;
  if (sh.round) {
    const s = sh.sump;
    const tank = { h, w0: w, d0: w, w1: w, d1: w, round: true };
    const pieces: Piece[] = s ? [{ h: s.h, w0: SUMP_TIP, d0: SUMP_TIP, w1: s.w, d1: s.w, round: true }, tank] : [tank];
    const n = sh.neck;
    if (n) pieces.push({ h: n.h, w0: n.w, d0: n.w, w1: n.w, d1: n.w, round: true });
    return pieces;
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
 * given how wide and tall they're drawn. A round tank is as deep as it's wide; a tool with no tanks has no depth inside.
 */
export function tankDepth(kind: ToolKind): number {
  let d = depths.get(kind);
  if (d !== undefined) return d;
  const sh = SHAPES[kind];
  const want = (sh.tankCap ?? TANK_CAP) * SPACE_PER_ATOM;
  // a tool with no tanks (a thermometer) has no inside
  if (!sh.tanks.length) d = 0;
  else if (sh.round) d = sh.neck ? sh.neck.body : sh.tanks[0].x1 - sh.tanks[0].x0;
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
    if (drop.N > 0) transfer(drop, out, volume(drop));
    return out;
  }
  if (out) transfer(out, drop, volume(out));
  if (drop.N <= 0 || rand() >= 1 - Math.exp(-dropRate(drop.N) * h)) return null;
  const fell = new Vessel(Infinity);
  transfer(drop, fell, volume(drop));
  return fell;
}

/** How much a splitter's or multiplexer's funnel holds, in atoms: just a buffer, like a hose's. */
export const FUNNEL_CAP = CAP / 4;
/**
 * How fast a splitter's or size sorter's funnel drains when full, in atoms per sim second, whatever a splitter's
 * valve is set to; it drains in proportion to how high its fluid stands (see Tool.level). A multiplexer's two funnels
 * drain at this rate between them, shared out by its valve. An inline instrument's tube drains at this rate however
 * full it is.
 */
export const FUNNEL_RATE = 2 * MAX_FLOW;

/**
 * How well the size sorter sorts, editable from the Chemistry panel, from 0 (every size of molecule splits evenly
 * among its four spouts) to 1, the default (singles all fall through the first screen, pairs the second, triples the
 * third, and fours go off the end). In between, each size goes 1/4 + 3/4·strength out its own spout and the rest evenly
 * out the other three, so at 0.6, 70% out its own and 10% out each of the others.
 */
export const SORTER = { strength: 1 };
const DEFAULT_SORTER = { ...SORTER };

export function restoreDefaultSorter(): void {
  Object.assign(SORTER, DEFAULT_SORTER);
}

/** How many spouts the size sorter has: one per size of molecule, from one atom to four. */
export const SORTER_OUTLETS = 4;

/** For each size of molecule, from one atom to four, the share going out each of the size sorter's spouts, in order. */
export function sorterShares(): number[][] {
  const k = Math.max(0, Math.min(1, SORTER.strength));
  const n = SORTER_OUTLETS;
  return Array.from({ length: n }, (_, own) =>
    Array.from({ length: n }, (_, j) => (j === own ? 1 / n + (1 - 1 / n) * k : (1 - k) / n)),
  );
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
 * The station, built into the right wall (see STATION_POSE in presets.ts), for topping up what the ship is short of
 * (see Supply): first the antinucleant, and once there's enough of that, its block of the wall is changed for the
 * cryostabilizer's (see CHANGEOVER), the same but for what it takes and what's printed on it. It's the ship's
 * reservoir, a tall
 * column in the wall seen through a narrow glass pane, with a faucet under it; and beside it, low down, a glass funnel
 * over a diverter, which sends what drains from the funnel up into the reservoir if it's pure enough, or else down
 * and out a waste spigot under it, with a little LCD between the funnel and the spigot showing which way it's going.
 * In its own flat frame, x runs along the wall and y down from the column's top; z = 0 is over the middle of the
 * counter's row of cells nearest the wall, where the funnel and spouts are, and the wall is `out` behind it.
 * - paneW, paneH: the reservoir's pane, across and tall; the column behind it is as tall.
 * - out: how far the funnel and spouts stand out from the wall.
 * - top: how high the column's top is, in the room.
 * - plate: how deep the plate the pane is set in goes into the wall, its face flush with the wall.
 * - block: the plate's edges, in the flat frame: a swappable block of the wall, two of the wall's panels across and one
 *   high (see WALL_PANEL), lined up with them, with a rubber seam round it.
 * - funnel: the funnel's mouth, `y` down from the column's top (within easy reach), reaching w either side of its
 *   middle; it narrows to its stem h below that.
 * - display: the diverter's LCD, on the plate between the funnel and the waste spigot.
 * - labelY: the middle of the reservoir's label, printed on the plate above its column.
 * - gauge: a stack of LCD segments just right of the reservoir, as tall as the pane, showing how far the reservoir is
 *   toward the goal (see gaugeSegments): x0..x1 across, and how many segments.
 * - screen: the readout of the litres in the reservoir, under its label.
 * - recess: how far back into the wall the block is drawn during a changeover: far enough that its funnel, spouts and
 *   valve are all behind the door that shuts over it.
 * - door: the door that shuts over the hole, sliding down from inside the wall above it: how far behind the wall's
 *   face its front is, and how thick it is.
 * - lamp: the warning lamp on the wall above the block, which flashes through a changeover: its middle, across and
 *   down (above the tape round the block), and its radius.
 */
const STATION_TOP = LIFT + 400;
export const STATION = {
  paneW: 24,
  paneH: 260,
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
  display: { x0: CELL - 28, x1: CELL + 28, y0: 222, y1: 262 },
  labelY: -31,
  gauge: { x0: 2 * CELL + 20, x1: 2 * CELL + 30, segments: 26 },
  screen: { x0: 2 * CELL - 50, x1: 2 * CELL + 50, y0: -19, y1: -4 },
  /** The screen showing how long it's been delivering steadily (see Tool.steady), left of the reservoir's. */
  steadyScreen: { x0: 2 * CELL - 160, x1: 2 * CELL - 60, y0: -19, y1: -4 },
  /** The purity needle's dial (see needleAt), on the plate left of the diverter's LCD. */
  needle: { x0: CELL - 90, x1: CELL - 38, y0: 222, y1: 262 },
  recess: 100,
  door: { back: 2, thick: 6 },
  lamp: { x: -CELL / 2 + WALL_PANEL.w, y: STATION_TOP - 2 * WALL_PANEL.h - 56, r: 11 },
};

/**
 * The station's changeover, once its reservoir holds enough of what it's fitted for and the ship is short of
 * something else (see nextSupply): how many sim seconds each part of it takes, in order.
 * - warn: a warning lamp over the block starts flashing and an alarm sounding beside it, and go on to the end; the
 *   block still works.
 * - retract: the block slides back into the wall, funnel, spouts and all (STATION.recess).
 * - shut: a metal door slides down over the hole.
 * - away: behind the door, the block is taken away, and the next one brought: halfway through, the station is the
 *   next supply's, as new (see Tool.stock).
 * - open: the door slides back up.
 * - extend: the new block slides out, flush with the wall.
 * - clear: it's in place and works, and then the lamp and the alarm stop.
 */
export const CHANGEOVER = { warn: 1.5, retract: 3, shut: 2, away: 5, open: 2, extend: 3, clear: 0.6 };
const CHANGEOVER_PARTS = Object.keys(CHANGEOVER) as (keyof typeof CHANGEOVER)[];
/** How long the whole changeover takes, in sim seconds. */
export const CHANGEOVER_S = CHANGEOVER_PARTS.reduce((t, k) => t + CHANGEOVER[k], 0);
/** How the alarm beside the block sounds through a changeover: on for `on` of every `every` sim seconds; the lamp flashes with it. */
export const CHANGEOVER_ALARM = { every: 0.9, on: 0.45 };

/** A moment in the station's changeover (see changeoverAt). */
export interface Changeover {
  /** Which part of it this is (see CHANGEOVER), and how far through that part, 0 to 1. */
  part: keyof typeof CHANGEOVER;
  through: number;
  /** How far back into the wall the block is, 0 (flush with the wall, as ever) to 1 (all the way, by STATION.recess). */
  back: number;
  /** How far shut the door over the hole is, 0 (up inside the wall, out of sight) to 1. */
  door: number;
  /** Whether the alarm is sounding and the lamp lit just now (see CHANGEOVER_ALARM). */
  alarm: boolean;
}

/**
 * Where the station's block and door are `t` sim seconds into a changeover (see Tool.swap), or with none under way,
 * null: each slides easing in and out.
 */
export function changeoverAt(t: number | null): Changeover {
  if (t === null) return { part: 'warn', through: 0, back: 0, door: 0, alarm: false };
  let from = 0;
  let part = CHANGEOVER_PARTS[0];
  for (part of CHANGEOVER_PARTS) {
    if (t < from + CHANGEOVER[part]) break;
    from += CHANGEOVER[part];
  }
  const through = Math.max(0, Math.min(1, (t - from) / CHANGEOVER[part]));
  const eased = through * through * (3 - 2 * through);
  const i = CHANGEOVER_PARTS.indexOf(part);
  return {
    part,
    through,
    back: part === 'retract' ? eased : part === 'extend' ? 1 - eased : i > 1 && i < 5 ? 1 : 0,
    door: part === 'shut' ? eased : part === 'open' ? 1 - eased : part === 'away' ? 1 : 0,
    alarm: t < CHANGEOVER_S && t % CHANGEOVER_ALARM.every < CHANGEOVER_ALARM.on,
  };
}

/**
 * How far along its dial the station's needle stands, from 0 (its left stop) to 1, for fluid that's `purity` target by
 * atoms: 1 − √(1 − purity), so it moves all the way up from nothing, and moves furthest for the last few percent, where
 * the diverter's line is. Half target is 0.29 of the way, 90% is 0.68, and 99% is 0.9.
 */
export function needleAt(purity: number): number {
  return 1 - Math.sqrt(1 - Math.max(0, Math.min(1, purity)));
}
/** How quickly the station's needle swings to its reading, in sim seconds: it closes all but 1/e of the gap in this. */
export const NEEDLE_TAU = 0.25;

/** The station's funnel's inside, as drawn (see Piece): a square funnel narrowing from its mouth to its stem. */
export const STATION_FUNNEL: Piece[] = [
  { h: STATION.funnel.h, w0: FUNNEL_TIP, d0: FUNNEL_TIP, w1: 2 * STATION.funnel.w, d1: 2 * STATION.funnel.w },
];

/**
 * What each of the station's gauge's segments shows, bottom up, with the reservoir holding `held` of `cap` and the
 * goal at `goal` (all in molecules): lit green once what's held reaches its top, or the goal if that's lower, so the
 * last red one turns green just as the goal is reached; flashing red if any of it is below the goal; dark otherwise.
 */
export function gaugeSegments(held: number, goal: number, cap: number, n = STATION.gauge.segments): ('held' | 'wanted' | 'off')[] {
  return Array.from({ length: n }, (_, i) => {
    const below = (i / n) * cap < goal;
    const top = ((i + 1) / n) * cap;
    return held >= (below ? Math.min(top, goal) : top) ? 'held' : below ? 'wanted' : 'off';
  });
}
/** How much the station's funnel holds, by volume: as much as it's drawn to hold (see SPACE_PER_ATOM), about 0.6 flask. */
export const INTAKE_CAP = Math.round(spaceOf(STATION_FUNNEL) / SPACE_PER_ATOM);
/** How far into its changeover the station becomes the next supply's (see Tool.stock): halfway through its time away, behind the door. */
const STOCKED_AT = CHANGEOVER.warn + CHANGEOVER.retract + CHANGEOVER.shut + CHANGEOVER.away / 2;
/** How fast the reservoir's faucet lets it out, fully open, in atoms per sim second: a fifth of a flask a second. */
export const REFERENCE_FLOW = 0.2 * MAX_FLOW;
/**
 * The reservoir's filter: each sim second it takes out this share of every molecule with a black atom in it, which
 * would otherwise slowly break the cryostabilizer down (see filter).
 */
export const RESERVOIR_FILTER = 0.05;
/** The species with a black atom in them, which the reservoir's filter takes out. */
const BLACK = SPECIES.filter((s) => s.atoms.includes('K')).map((s) => s.i);

/** A length of time on a screen, as a clock does: "0:42", "12:05", "1:02:03". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  const [h, m] = [Math.floor(s / 3600), Math.floor(s / 60) % 60];
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/**
 * The reservoir's filter over h sim seconds: RESERVOIR_FILTER of each species with a black atom in it each sim
 * second, smoothly, in whole molecules, with their share of the heat, gone for good.
 */
export function filter(v: Vessel, h: number): void {
  if (v.N <= 0) return;
  const share = 1 - (1 - RESERVOIR_FILTER) ** h;
  let atoms = 0;
  for (const s of BLACK) {
    if (!v.n[s]) continue;
    const m = Math.min(v.n[s], roundRandom(v.n[s] * share));
    v.n[s] -= m;
    atoms += m * SPECIES[s].size;
  }
  if (!atoms) return;
  v.Q -= Math.min(v.Q, roundRandom((v.Q * atoms) / v.N));
  v.N -= atoms;
  if (v.N <= 0) v.Q = 0;
}
/**
 * How long the diverter's LCD shows fluid going through it after the last of it went by, in sim seconds, so a drip
 * reads as a flow rather than a flicker.
 */
export const DIVERTER_HOLD = 0.4;

/**
 * The inline instruments: each is a vertical glass tube, whose top a hose's nozzle snaps onto (see INLINE_DOCK), draining
 * straight through at FUNNEL_RATE however full it is, down to a spout at its foot, past what reads what goes by: a
 * cabinet beside it (see INSTRUMENT), or the flow meter's little readout (see METER_BODY).
 */
export const INLINE_TOOLS: readonly ToolKind[] = ['analyzer', 'spectroscope', 'visualizer', 'meter'];
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
 * The composition analyzer's, spectroscope's and bond visualizer's cabinet, right of the tube, with its screen, and how high the pipe
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

/**
 * How a thermometer behaves (see Tool.warm):
 * - tau: how quickly its bulb takes the temperature of the fluid it's in, in sim seconds: it closes all but 1/e of the
 *   gap in this;
 * - roomTau: how quickly it takes the room's, in the air, in sim seconds;
 * - burst: how far past the top of its scale, as a multiple of the top, its bulb can be before it shatters; the
 *   capillary runs up that far past the top, so that's where the column stops.
 */
export const THERMOMETER = { tau: 1, roomTau: 8, burst: 1.1 };

/**
 * The two kinds of thermometer, and their scales: each reads from 0 at its scale's foot to `top` at its top, with a
 * tick every `tick`, a longer one every `long`, and a number every `num`.
 */
export const THERMOMETERS = {
  thermometer: { top: 5, tick: 0.1, long: 0.5, num: 1 },
  thermometerWide: { top: 25, tick: 0.5, long: 2.5, num: 5 },
} as const;
export type ThermometerKind = keyof typeof THERMOMETERS;

/** Whether a kind of tool is a thermometer. */
export const isThermometer = (kind: ToolKind): kind is ThermometerKind => kind in THERMOMETERS;

/**
 * How far up its scale a thermometer of a kind stands at temperature T: from 0 at the scale's foot to 1 at its top,
 * evenly; never below the foot, nor above the top of the capillary (see THERMOMETER.burst).
 */
export function thermometerAt(kind: ThermometerKind, T: number): number {
  return Math.max(0, Math.min(THERMOMETER.burst, T / THERMOMETERS[kind].top));
}

/**
 * A thermometer's rod, in its own frame (x right, y down from its top, the middle of its top end at the origin): a
 * glass rod `h` long and `r` in radius, upright; the bulb of spirit at its foot, from `bulb.y0` to `bulb.y1`, `bulb.r`
 * in radius; a white enamel backing inside the glass, `backing.w` across, from `backing.y0` to `backing.y1`, carrying
 * the scale, whose 0 is at `foot` and whose top is at `top`; the capillary up it from the bulb to
 * THERMOMETER.burst of the scale's length above its foot; and where it snaps, when it shatters, a little way up from
 * its foot.
 */
export const THERMOMETER_ROD = {
  h: 150, r: 2.5,
  bulb: { y0: 138, y1: 147, r: 1.7 },
  backing: { y0: 14, y1: 110, w: 4.2 },
  foot: 106, top: 26,
  snap: 126,
};
/** Where a thermometer's bulb is, in its own frame (as THERMOMETER_ROD's, y down): its middle, which is what's dipped. */
export const BULB_Y = (THERMOMETER_ROD.bulb.y0 + THERMOMETER_ROD.bulb.y1) / 2;

/**
 * The tools that are dipped (see Tool.bath): a wicking strip and the thermometers. They have no tanks; held with the
 * crosshair on an open top, one hovers upright over it, the right button lowers it in, and the left stands it in it.
 */
export const DIPPERS: readonly ToolKind[] = ['strip', 'thermometer', 'thermometerWide'];
export const isDipper = (kind: ToolKind): boolean => DIPPERS.includes(kind);

/**
 * A swell bulb (see SHAPES.dilatometer): a squat round bulb `w` across and `h` tall, over a little sump, under a
 * narrow neck (see ToolShape.neck). The neck holds about a fifth of what the bulb does, so fluid that fills the bulb
 * and swells by a twentieth climbs a quarter of the neck. The two bulbs stand pressed together like the letters
 * "db": their necks side by side in the middle, `gap` apart, each up from the inner edge of its bulb, with `marks`
 * graduations across both. Above the marks the necks part: each carries on as a thin tube leaning out and up,
 * `inlet.rise` higher, to a little funnel (reaching `inlet.w` either side of its middle, `inlet.h` deep) at its top,
 * the two funnels a grid cell apart, which is where each bulb is filled.
 */
export const BULB = { w: 34, h: 20, sump: { w: 10, h: 5 }, neck: { w: 7, h: 90 }, marks: 20, gap: 1, inlet: { w: 7, h: 8, rise: 32 } };
const BULB_BODY: Piece[] = [
  { h: BULB.sump.h, w0: SUMP_TIP, d0: SUMP_TIP, w1: BULB.sump.w, d1: BULB.sump.w, round: true },
  { h: BULB.h, w0: BULB.w, d0: BULB.w, w1: BULB.w, d1: BULB.w, round: true },
];
/** How much a swell bulb holds below its neck, by volume: as much as it's drawn to hold (see SPACE_PER_ATOM), about 0.29 flask. */
export const BULB_BODY_CAP = Math.round(spaceOf(BULB_BODY) / SPACE_PER_ATOM);
/** How much a swell bulb's neck holds, by volume: about 0.055 flask. */
export const BULB_NECK_CAP = Math.round((((Math.PI / 4) * BULB.neck.w ** 2 * BULB.neck.h) / SPACE_PER_ATOM));
/** How much of its neck a swell bulb holding `vol` (by volume) fills: 0 while the bulb itself isn't full, 1 at the brim. */
export function neckShare(vol: number): number {
  return Math.max(0, Math.min(1, (vol - BULB_BODY_CAP) / BULB_NECK_CAP));
}

/**
 * How a wicking strip behaves (see SHAPES.strip and Tool.wick). It's bare paper, hanging from a clip, its foot cut to
 * a point. Touched to a fluid, its foot takes a spot of it (see Tool.touch); stood in a fluid, it drinks it, the
 * carrier, up the paper, carrying what's on it along at each species' own pace (see Bed):
 * - cap: how much the paper holds wet from end to end, by volume: a hundredth of a flask. Soaking a share d of it
 *   (see Tool.soaked) draws d times this from what its foot is in;
 * - spot: what a touch puts on it, by volume, over as much of it as is in the fluid: a tenth of cap; and spots, how
 *   many spots' worth it takes in all;
 * - time: how long the paper takes to soak through, in sim seconds, with carrier enough: quickly at first and ever
 *   more slowly, as paper wicks, as the square root of the time;
 * - drag: the drag at which a molecule doesn't move at all (see STRIP_RUN);
 * - cells: how many stretches the paper is modelled as, from its foot to its top, one local unit each (see Tool.paper);
 *   the spot goes on the first of them, those in the fluid;
 * - spread: the share of a species on each stretch that's left behind each time it moves on a stretch (see Tool.wick),
 *   which is all that widens a band: after n moves it's about √(n · spread · (1 − spread)) stretches wide;
 * - ink: how strongly what's on it shows (see stripInk), and tint, how much less strongly single atoms do;
 * - scorch: the temperatures from which a fluid starts to brown the paper that's in it, and at which it chars it
 *   through;
 * - paper: the paper itself, in local units, y down from the top of its clip: reaching w either side of the middle,
 *   from `top` down `len` to its foot, the last `point` of it narrowing to a point there;
 * - clip: the clip it hangs from, at its top, reaching w either side of the middle, h down from its top, d front to
 *   back: what its stand holds.
 */
export const STRIP = {
  cap: CAP / 100, spot: CAP / 1000, spots: 3, time: 20, drag: 34, cells: 108, spread: 0.05, ink: 33, tint: 0.4,
  scorch: { from: 2, to: 6 },
  paper: { w: 6, top: 10, len: 108, point: 6 },
  clip: { w: 4.5, h: 15, d: 4 },
};

/** Where a wicking strip's foot is, in its own frame (y down from its top): the tip of its paper. */
export const STRIP_FOOT = STRIP.paper.top + STRIP.paper.len;

/**
 * Where a dipper's foot is, in its own frame (y down from its top): what's dipped, and what's in a fluid or not (see
 * bathAt): a thermometer's bulb's middle, or the middle of a wicking strip's first stretch, at the tip of its paper.
 */
export const footY = (kind: ToolKind): number => (kind === 'strip' ? STRIP_FOOT - 0.5 : BULB_Y);

/**
 * How far under a fluid's surface a dipper's foot (see footY) goes when it's dipped in by hand (see dipPoses), which is
 * no further than it takes to touch it: a wicking strip's, so that the lower half of its point is in; a thermometer's,
 * so that its bulb is just covered.
 */
export const dipUnder = (kind: ToolKind): number =>
  kind === 'strip' ? STRIP.paper.point / 2 - 0.5 : (THERMOMETER_ROD.bulb.y1 - THERMOMETER_ROD.bulb.y0) / 2 + 1;

/**
 * The dish (see SHAPES.dish): a shallow open glass tray, reaching w either side of its middle, h deep and d front to
 * back inside, on a little base `base` tall, for its stand to clamp.
 */
export const DISH = { w: 20, h: 5, d: 16, base: 13 };

/** How much the dish holds, by volume: as much as it's drawn to hold (see SPACE_PER_ATOM), about 0.05 flask. */
export const DISH_CAP = Math.round((2 * DISH.w * DISH.d * DISH.h) / SPACE_PER_ATOM);

/**
 * How freely each species runs along a wicking strip's paper or a column's bed: 1 − drag / STRIP.drag, where a
 * molecule's drag is its weight, plus the weight of its loose ends again (see LOOSE_ENDS), which snag in the paper.
 * A liquid runs at the mean of its own (see leadOf), and each species on the paper min(1, its own over the liquid's)
 * as far as the liquid does (see Bed). So light single atoms run freest, a ring runs further than a chain of the same
 * atoms, and a chain with heavy ends lags one with light ends.
 */
export const STRIP_RUN: readonly number[] = SPECIES.map((sp, s) => Math.max(0, 1 - (sp.weight + END_WEIGHT[s]) / STRIP.drag));

/**
 * How opaque n molecules of species s make one cell of a wicking strip's paper (see STRIP.cells) in that species' own
 * color: 1 − e^(−ink · v / spot), for their volume v. So a band of what's a twentieth of a full spot shows clearly at
 * its peak after a full run, while what's most of the spot is as dark as it gets: the paper shows what's there more
 * than how much. Single atoms only tint it, at STRIP.tint of that.
 */
export function stripInk(s: number, n: number): number {
  const ink = 1 - Math.exp((-STRIP.ink * n * roomFor(s)) / STRIP.spot);
  return SPECIES[s].size === 1 ? ink * STRIP.tint : ink;
}

/**
 * How fast fluid f runs along a bed as a liquid, its lead (see Bed): the mean STRIP_RUN of what's in it, weighted by
 * volume; 0 if it's empty.
 */
export function leadOf(f: Fluid): number {
  let run = 0;
  let vol = 0;
  for (let s = 0; s < NS; s++) {
    if (!f.n[s]) continue;
    run += f.n[s] * roomFor(s) * STRIP_RUN[s];
    vol += f.n[s] * roomFor(s);
  }
  return vol > 0 ? run / vol : 0;
}

/**
 * How wet a stretch of a wicking strip's paper or a column's bed looks, from 0 (dry) to 1 (wet through), holding vol
 * (by volume) when the whole of it holds `holds` wet through over `cells` stretches: what it holds over its share of
 * that, as far as 1. A liquid is its molecules, so the paper's wet where they are, and only there.
 */
export function wetness(vol: number, holds: number, cells: number): number {
  return Math.max(0, Math.min(1, (vol * cells) / holds));
}

/**
 * A bed of packing that a liquid runs through cell by cell: a wicking strip's paper, from its foot up, or a column's
 * bed, from its top down. The liquid is what's coming in, and it runs at its own pace, its lead (see leadOf); each
 * species on the bed travels min(1, STRIP_RUN / lead) of the liquid's way, so the carrier itself runs with the
 * liquid, what drags more lags it in proportion, and nothing outruns it. For each 1 − STRIP.spread of a cell a
 * species travels, all but STRIP.spread of it on each cell moves on into the next, in whole molecules with their
 * share of the heat; what's left behind moves on later. So it moves a whole cell at a time, and it spreads only by
 * what's left behind, into a band √(n · spread · (1 − spread)) cells wide (its standard deviation) after n moves.
 * Moving a little of each cell at every step instead would smear it far wider.
 */
export class Bed {
  /**
   * Per species, how far it has travelled along the bed, in cells, since it last moved on one (see carry). Not saved:
   * a bed loaded mid-run loses less than a cell of it.
   */
  private readonly drift = new Float64Array(NS);

  constructor(readonly cells: readonly Vessel[]) {}

  /**
   * The liquid, running at `lead` (see leadOf), running `dist` cells along the bed, at most half a cell: each species
   * travels min(1, STRIP_RUN / lead) of that, and what moves on, moves from each cell from `last` back to the first
   * into the next, last first, so nothing moves twice; what moves on from the bed's last cell goes into `out`.
   */
  carry(dist: number, last: number, lead: number, out: Vessel | null = null): void {
    const { cells } = this;
    if (lead <= 0) return;
    for (let s = 0; s < NS; s++) {
      this.drift[s] += Math.min(1, STRIP_RUN[s] / lead) * dist;
      // what's left behind makes it lag, so it moves on a cell for each 1 − spread it travels
      if (this.drift[s] < 1 - STRIP.spread) continue;
      this.drift[s] -= 1 - STRIP.spread;
      const size = SPECIES[s].size;
      for (let c = last; c >= 0; c--) {
        const a = cells[c];
        const b = c + 1 < cells.length ? cells[c + 1] : out!;
        const m = a.n[s] && a.n[s] - roundRandom(a.n[s] * STRIP.spread);
        if (!m) continue;
        if (a.Q > 0) {
          const q = Math.min(a.Q, roundRandom((a.Q * m * size) / a.N));
          a.Q -= q;
          b.Q += q;
        }
        a.n[s] -= m;
        b.n[s] += m;
        a.N -= m * size;
        b.N += m * size;
      }
    }
  }
}

/**
 * How a column behaves (see SHAPES.column and Tool.elute). A small funnel on top drains into a glass tube packed with
 * the strips' blotting stuff, its bed, over a tap and a spout. A dry bed drinks from the funnel, tap open or not; once
 * it's wet through, what's poured in runs through it only while the tap's open, carrying each species down at its own
 * pace, as on a strip's paper (see Bed), and out the spout:
 * - cells: how many stretches the bed is modelled as, from its top to its foot (see Tool.bed);
 * - cap: how much the bed holds wet through, by volume: a fifth of a flask;
 * - soak: how fast a dry bed drinks from the funnel, by volume per sim second, the tap open or not: it's wet through
 *   in 4 sim s;
 * - flow: how fast liquid runs through a wet bed with the tap fully open, by volume per sim second: a fiftieth of a
 *   flask, a bed's worth in 10 sim s; in proportion to how far the tap's open;
 * - funnel: the funnel, reaching w either side of its middle, h deep, holding cap (by volume) as drawn;
 * - tube: the glass tube under the funnel's stem, w across, from y0 to y1 down from the funnel's mouth, its bed
 *   filling it.
 */
export const COLUMN = {
  cells: 80, cap: CAP / 5, soak: CAP / 20, flow: CAP / 50,
  funnel: { w: 11, h: 20, cap: 0.06 * CAP },
  tube: { w: 16, y0: 26, y1: 186 },
};

/**
 * How opaque n molecules of species s make one cell of a column's bed (see COLUMN.cells), in that species' own color:
 * as stripInk says, for what would take up as much of a cell of a strip's paper as they take up of one of the
 * bed's. So single atoms only tint it, and a clear carrier leaves it pale.
 */
export function columnInk(s: number, n: number): number {
  return stripInk(s, (n * STRIP.cap * COLUMN.cells) / (COLUMN.cap * STRIP.cells));
}

/** How scorched fluid at temperature T leaves the paper of a wicking strip that's in it, from 0 (not at all) to 1 (charred through). */
export function scorchAt(T: number): number {
  const { from, to } = STRIP.scorch;
  return Math.max(0, Math.min(1, (T - from) / (to - from)));
}

/**
 * How a sleeper culture behaves (see SHAPES.culture and Tool.sicken):
 * - rate: how fast its cells die, per sim second, in fluid that does them one unit of harm (see harm): each cell in
 *   the fluid dies at random, at this times the fluid's harm, whatever the others do. So half of those in fluid of
 *   harm 0.1 are dead in 30 sim s, and in fluid of harm 1, in 3;
 * - heat: fluid hotter than `from` harms them too, as `per` of a loose end per molecule for each unit of temperature
 *   above it;
 * - pitch: how far apart the cells are, in local units, in rows half a step out of line with each other;
 * - drain: how fast its plate drains, full and with its valve fully open, by volume per sim second: a fifth of a
 *   flask, so it's empty in a few seconds, leaving its cells as they are.
 */
export const CULTURE = { rate: Math.LN2 / 3, heat: { from: 2, per: 0.2 }, pitch: 3.2, drain: CAP / 5 };

/**
 * How loose a molecule of each species is, to a sleeper culture: its loose ends (see LOOSE_ENDS), or 1 for a lone atom,
 * but none for the solvent, which does the cells no harm.
 */
const LOOSENESS: readonly number[] = SPECIES.map((sp, s) =>
  sp.size === 1 ? +(sp.atoms[0] !== SOLVENT) : LOOSE_ENDS[s].length,
);

/**
 * What a fluid does to a sleeper culture: its loose ends per molecule (a lone atom counting as one), plus, if it's
 * hotter than CULTURE.heat.from, CULTURE.heat.per for each unit of temperature above that. Nothing, if there's none.
 */
export function harm(f: Fluid): number {
  let ends = 0;
  let molecules = 0;
  for (let s = 0; s < NS; s++) {
    if (!f.n[s]) continue;
    ends += f.n[s] * LOOSENESS[s];
    molecules += f.n[s];
  }
  if (molecules <= 0) return 0;
  return ends / molecules + CULTURE.heat.per * Math.max(0, temperature(f) - CULTURE.heat.from);
}

let cultureLayout: { x: number; y: number }[] | null = null;

/**
 * Where a sleeper culture's cells are on its plate, in local units, top row first: in rows CULTURE.pitch apart, each
 * row half a step out of line with the last. The same on every plate.
 */
export function cultureCells(): readonly { x: number; y: number }[] {
  if (cultureLayout) return cultureLayout;
  const tk = SHAPES.culture.tanks[0];
  const H = SHAPES.culture.tankH ?? TANK_H;
  const p = CULTURE.pitch;
  const cells: { x: number; y: number }[] = [];
  const dy = (p * Math.sqrt(3)) / 2;
  const rows = Math.floor((H - p) / dy) + 1;
  const y0 = (H - (rows - 1) * dy) / 2;
  const across = Math.floor((tk.x1 - tk.x0 - p) / p) + 1;
  for (let r = 0; r < rows; r++) {
    // every other row has one fewer, so, centered, it's half a step out of line
    const cols = across - (r % 2);
    const x0 = (tk.x0 + tk.x1) / 2 - ((cols - 1) * p) / 2;
    for (let c = 0; c < cols; c++) cells.push({ x: x0 + c * p, y: y0 + r * dy });
  }
  return (cultureLayout = cells);
}

let cultureInside: Piece[] | null = null;

/**
 * How high above the floor of a sleeper culture's plate fluid filling `share` of it stands, as it's drawn (see
 * tankPieces): a cell is in the fluid if it's below that.
 */
export function cultureLevel(share: number): number {
  cultureInside ??= tankPieces(SHAPES.culture, 0, tankDepth('culture'));
  return levelIn(cultureInside, share);
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

/**
 * The order of an analyzer triangle's sectors in its reading, and of the bond visualizer's points: the four colors.
 * There's none for the solvent, which the instruments are blind to.
 */
export const SECTOR_ATOMS: readonly ColorAtom[] = ['R', 'G', 'B', 'K'];

/**
 * Where each atom is on the instruments' screens, the composition analyzer's and the bond visualizer's alike: a
 * triangle standing on its base, G at the top, R at the bottom left, B at the bottom right, and K in the middle. As
 * offsets from the triangle's middle, x right and y down, its corners 1 away.
 */
export const ATOM_PLACE: Record<ColorAtom, readonly [number, number]> = {
  G: [0, -1],
  R: [-Math.sqrt(3) / 2, 0.5],
  B: [Math.sqrt(3) / 2, 0.5],
  K: [0, 0],
};

/**
 * An atom's sector of an analyzer triangle, as its three corners (offsets as ATOM_PLACE's): the triangle is cut into
 * four through the middles of its sides, so each corner's atom has the small triangle at that corner, and K the
 * upside-down one in the middle.
 */
export function analyzerSector(atom: ColorAtom): (readonly [number, number])[] {
  const corners = (['G', 'B', 'R'] as const).map((a) => ATOM_PLACE[a]);
  const mid = (p: readonly [number, number], q: readonly [number, number]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const;
  if (atom === 'K') return corners.map((p, i) => mid(p, corners[(i + 1) % 3]));
  const own = ATOM_PLACE[atom];
  return [own, ...corners.filter((p) => p !== own).map((p) => mid(own, p))];
}

export type ToolKind =
  | 'dispenser' | 'pipette' | 'exchanger' | 'separator' | 'splitter' | 'multiplexer' | 'sorter' | 'heater' | 'analyzer'
  | 'spectroscope' | 'visualizer' | 'meter' | 'thermometer' | 'thermometerWide' | 'dilatometer' | 'strip' | 'dish' | 'column' | 'culture' | 'tank'
  | 'receptacle';

/**
 * Tools there's only ever one of: not on an equipment wheel, and never put away. The receptacle is the whole cryostabilizer
 * station (see STATION), reservoir included.
 */
export const UNIQUE_TOOLS: readonly ToolKind[] = ['analyzer', 'spectroscope', 'visualizer', 'receptacle'];

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
  /**
   * A narrow neck on top of each tank (a round one, `body` across), `w` across and `h` tall. The tank fills first,
   * then its neck, so a small change in how much it holds shows as a big change in how high it stands. Such a tank
   * isn't under its opening: `bodies` and `necks` are where each tank's middle and its neck's are, across, and the
   * tank's own x0 and x1 are its inlet's, a little funnel `inlet.h` deep with its mouth at height `inlet.y`, above the
   * neck's top, which a thin tube leans down and in to: that's where fluid goes in, and where what no longer fits
   * spills from.
   */
  neck?: { w: number; h: number; body: number; bodies: number[]; necks: number[]; inlet: { h: number; y: number } };
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
  /** Whether it's built into a wall, with no stand: only the supply station (see STATION). */
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

/** A thermometer's shape: no tanks, spouts or valves, just its rod's box (see THERMOMETER_ROD). */
const THERMOMETER_SHAPE: ToolShape = {
  tanks: [],
  noValve: true,
  spouts: [],
  valveY: 0,
  spoutY: THERMOMETER_ROD.h,
  box: { x0: -THERMOMETER_ROD.r - 0.5, x1: THERMOMETER_ROD.r + 0.5, y0: -0.5, y1: THERMOMETER_ROD.h + 0.5 },
};

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
    // one outlet per share of black (see SEPARATOR_OUTLET), a grid cell apart (see CELL), so a flask
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
  multiplexer: {
    // the splitter turned upside down: a funnel a grid cell either side of its one spout, their stems joining over the
    // valve, which picks how much of each goes through
    tanks: [
      { name: 'A', x0: -CELL - 22, x1: -CELL + 22 },
      { name: 'B', x0: CELL - 22, x1: CELL + 22 },
    ],
    tankH: 30,
    tankCap: FUNNEL_CAP,
    funnel: true,
    valves: [{ x: 0, y: 64 }],
    spouts: [0],
    valveY: 64,
    spoutY: 88,
    box: { x0: -126, x1: 126, y0: -6, y1: 90 },
  },
  sorter: {
    // a funnel at the high end of the chute (see SORTER_CHUTE), which drops through three screens, then off its end
    tanks: [{ name: 'funnel', x0: -CELL - 22, x1: -CELL + 22 }],
    tankH: 30,
    tankCap: FUNNEL_CAP,
    funnel: true,
    noValve: true,
    // a grid cell apart, like the separator's, the first a cell on from the funnel
    spouts: [0, CELL, 2 * CELL, 3 * CELL],
    valveY: 30,
    spoutY: 104,
    box: { x0: -126, x1: 306, y0: -6, y1: 106 },
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
    // the station: a funnel, and the reservoir's column in the wall, behind a pane (see STATION); a waste
    // spigot under the funnel and a faucet under the reservoir, a grid cell apart (see CELL)
    tanks: [
      { name: 'funnel', x0: CELL - STATION.funnel.w, x1: CELL + STATION.funnel.w, cap: INTAKE_CAP },
      {
        // its name, its label and how much it holds go by what the station is fitted for (see Tool.supply)
        name: 'reservoir', x0: 2 * CELL - STATION.paneW / 2, x1: 2 * CELL + STATION.paneW / 2, cap: CRYOSTABILIZER.cap, sealed: true,
        label: ['reservoir'],
      },
    ],
    tankH: STATION.paneH,
    // the reservoir's faucet's; the funnel drains through the diverter, which only the station works
    valves: [{ x: 2 * CELL, y: STATION.paneH + 24 }],
    maxFlow: REFERENCE_FLOW,
    fixed: true,
    wall: true,
    spouts: [CELL, 2 * CELL],
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
  dilatometer: {
    // two swell bulbs (see BULB) pressed together like "db", necks side by side in the middle; each filled through a
    // funnel at the top of its neck, where the necks lean apart, a grid cell from the other, and draining slowly
    // through its own valve to a spout under that; one wire wound round both, from a box under them whose dial sets
    // its heat
    tanks: [
      { name: 'A', x0: -CELL / 2 - BULB.inlet.w, x1: -CELL / 2 + BULB.inlet.w },
      { name: 'B', x0: CELL / 2 - BULB.inlet.w, x1: CELL / 2 + BULB.inlet.w },
    ],
    tankH: BULB.h,
    tankCap: BULB_BODY_CAP + BULB_NECK_CAP,
    round: true,
    sump: BULB.sump,
    neck: {
      ...BULB.neck,
      body: BULB.w,
      bodies: [-(BULB.gap + BULB.w) / 2, (BULB.gap + BULB.w) / 2],
      necks: [-(BULB.gap + BULB.neck.w) / 2, (BULB.gap + BULB.neck.w) / 2],
      inlet: { h: BULB.inlet.h, y: -(BULB.neck.h + BULB.inlet.rise + BULB.inlet.h) },
    },
    valves: [{ x: -CELL / 2, y: 42 }, { x: CELL / 2, y: 42 }, { x: 0, y: 46 }],
    dial: 2,
    maxFlow: PIPETTE_FLOW,
    spouts: [-CELL / 2, CELL / 2],
    valveY: 42,
    spoutY: 58,
    box: { x0: -CELL / 2 - 14, x1: CELL / 2 + 14, y0: -(BULB.neck.h + BULB.inlet.rise + BULB.inlet.h) - 6, y1: 62 },
  },
  strip: {
    // bare paper hanging from a clip (see STRIP.paper), its foot cut to a point, with no tanks, spouts or valves
    tanks: [],
    noValve: true,
    spouts: [],
    valveY: 0,
    spoutY: STRIP_FOOT,
    box: { x0: -STRIP.paper.w - 0.5, x1: STRIP.paper.w + 0.5, y0: -0.5, y1: STRIP_FOOT + 0.5 },
  },
  dish: {
    // a shallow open glass tray (see DISH) on a little base for its stand to clamp; nothing drains from it
    tanks: [{ name: 'dish', x0: -DISH.w, x1: DISH.w }],
    tankH: DISH.h,
    tankCap: DISH_CAP,
    noValve: true,
    spouts: [],
    valveY: DISH.h,
    spoutY: DISH.h + DISH.base,
    box: { x0: -DISH.w - 2, x1: DISH.w + 2, y0: -6, y1: DISH.h + DISH.base },
  },
  column: {
    // a small glass funnel over a tall glass tube, packed (see COLUMN), over a tap and a spout, all on one line
    tanks: [{ name: 'funnel', x0: -COLUMN.funnel.w, x1: COLUMN.funnel.w }],
    tankH: COLUMN.funnel.h,
    tankCap: COLUMN.funnel.cap,
    funnel: true,
    spouts: [0],
    valveY: COLUMN.tube.y1 + 12,
    spoutY: COLUMN.tube.y1 + 28,
    box: { x0: -COLUMN.funnel.w - 2, x1: COLUMN.funnel.w + 2, y0: -6, y1: COLUMN.tube.y1 + 30 },
  },
  culture: {
    // a flat glass cell, the plate, filled through a funnel on top and drained through a valve under it; the cells
    // stand on the inside of its front (see cultureCells)
    tanks: [{ name: 'plate', x0: -20, x1: 20 }],
    tankH: 46,
    tankCap: CAP / 10,
    cup: { w: 10, h: 8 },
    maxFlow: CULTURE.drain,
    spouts: [0],
    valveY: 58,
    spoutY: 74,
    box: { x0: -24, x1: 24, y0: -14, y1: 76 },
  },
  // the thermometers: a glass rod each (see THERMOMETER_ROD), with no tanks, spouts or valves
  thermometer: THERMOMETER_SHAPE,
  thermometerWide: THERMOMETER_SHAPE,
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
  visualizer: {
    // the spectroscope's tube and cabinet, its screen showing the bonds going by between four points (see BOND_TRIANGLE)
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
export const SORTER_CHUTE = { x0: -112, x1: 300, y0: 44, y1: 76 };
/** Height of the sorter's chute at x, in local units. */
export const chuteY = (x: number) =>
  SORTER_CHUTE.y0 + ((x - SORTER_CHUTE.x0) / (SORTER_CHUTE.x1 - SORTER_CHUTE.x0)) * (SORTER_CHUTE.y1 - SORTER_CHUTE.y0);

/**
 * The composition analyzer's triangles on its screen (their middles, and the distance from a middle to a corner), one
 * per molecule size, and how high the pipe out of its cabinet to its waste spout runs, in local units. A triangle on
 * its base reaches r above its middle and half that below, so the middles are a quarter of r below the screen's.
 */
export const ANALYZER = {
  triangles: { xs: [43, 81, 119, 157], y: 54.75, r: 19 },
  wasteY: 84,
};

/**
 * The spectroscope's graph (see spectroscopeAt): its x axis runs from lnE0 to lnE1, and each bond's line is a Gaussian
 * `width` wide (its standard deviation), in lnE. Its y axis, f, is logarithmic and ranges itself to what's passing
 * (see spectroscopeTop and spectroscopeY): its top is `headroom` times the tallest line, and it shows `decades` powers
 * of ten below that, so a line that much weaker than the strongest still shows. It reads f in S, `perS` bonds a sim
 * second each, with an SI prefix to suit the range shown (see spectroscopeUnit).
 */
export const SPECTROSCOPE = { lnE0: -0.5, lnE1: 3.5, width: 0.02, decades: 4, headroom: 10 ** 0.5, perS: 1e6 };

/** Every bond there can be, by its key (see pairKey): the six pairs of atoms. */
export { BOND_KEYS };

/** For each species, its bonds, by their place in BOND_KEYS. */
const SPECIES_BONDS: readonly (readonly number[])[] = SPECIES.map((sp) => BONDS.flatMap((_, k) => (sp.mask & (1 << k) ? [k] : [])));

/** How many of each bond (in BOND_KEYS order) a fluid's molecules have between them. */
export function bondCounts(f: Fluid): number[] {
  const out = BOND_KEYS.map(() => 0);
  for (let s = 0; s < NS; s++) if (f.n[s]) for (const b of SPECIES_BONDS[s]) out[b] += f.n[s];
  return out;
}

/**
 * The spectroscope's lines at x = lnE: each bond's count, `counts` (in BOND_KEYS order, per sim second), spread as a
 * Gaussian SPECTROSCOPE.width wide about the log of the size of its energy, `energies`, all added up, separately for
 * stable bonds (E > 0, which absorb, so they peak above the baseline) and uphill ones (E < 0, which give energy back,
 * so they dip below it, at their size). A bond with no energy shows nowhere.
 */
export function spectroscopeAt(x: number, counts: readonly number[], energies: readonly number[]): { up: number; down: number } {
  const w = SPECTROSCOPE.width;
  let up = 0;
  let down = 0;
  counts.forEach((c, i) => {
    const e = energies[i];
    if (!(c > 0) || e === 0) return;
    const f = c * Math.exp(-((x - Math.log(Math.abs(e))) ** 2) / (2 * w * w));
    if (e > 0) up += f;
    else down += f;
  });
  return { up, down };
}

/**
 * The top of the spectroscope's f axis, in bonds a sim second, for lines whose tallest (peak or dip) is `tallest`:
 * SPECTROSCOPE.headroom times it, so the axis slides with the flow; 0 if there's nothing.
 */
export function spectroscopeTop(tallest: number): number {
  return tallest > 0 ? tallest * SPECTROSCOPE.headroom : 0;
}

/**
 * How high f (bonds a sim second) stands on the spectroscope's axis topped at `top` (see spectroscopeTop), as a share
 * of the half screen above the baseline: ln(1 + f / floor) over ln(1 + top / floor), where floor is SPECTROSCOPE.decades
 * powers of ten under the top. Well above the floor that's a plain log scale; it eases to 0 at f = 0, so a line meets
 * the baseline smoothly. A dip of f stands as far below.
 */
export function spectroscopeY(f: number, top: number): number {
  if (!(top > 0)) return 0;
  const floor = top / 10 ** SPECTROSCOPE.decades;
  return Math.log1p(f / floor) / Math.log1p(top / floor);
}

/** The SI prefixes the spectroscope's f axis can take, by power of ten (see spectroscopeUnit). */
const SI_PREFIXES: Record<number, string> = { [-9]: 'n', [-6]: 'u', [-3]: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' };

/**
 * The unit the spectroscope's f axis is numbered in, for an axis topped at `top` bonds a sim second (see
 * spectroscopeTop): S with the SI prefix whose power of ten, `exp`, is a multiple of three as near as can be to the
 * middle of the powers of ten the axis shows, so their numbers stay short (1, 10, 100; .1, .01). `name` is the unit,
 * as "mS"; a power of ten 10^d S on the axis is numbered 10^(d − exp). With nothing to show, plain S.
 */
export function spectroscopeUnit(top: number): { name: string; exp: number } {
  if (!(top > 0)) return { name: 'S', exp: 0 };
  const { perS, decades } = SPECTROSCOPE;
  const hi = Math.floor(Math.log10(top / perS) + 1e-9);
  const lo = Math.ceil(Math.log10(top / perS) - decades - 1e-9);
  const exp = Math.max(-9, Math.min(9, 3 * Math.round((lo + hi) / 6)));
  return { name: SI_PREFIXES[exp] + 'S', exp };
}

/**
 * The bond visualizer's triangle on its screen, standing on its base: its middle, and the distance from there to a
 * corner, in local units. The four atoms are its corners and its middle, placed as in the composition analyzer's
 * triangles (see ATOM_PLACE), and a line joins two of them for each bond between them going by (see bondShares): one
 * of its sides, or from the middle out to a corner.
 */
export const BOND_TRIANGLE = { x: 100, y: 58, r: 32 };

/** The bond visualizer's point for SECTOR_ATOMS[i] (see BOND_TRIANGLE), in local units. */
export function bondPoint(i: number): { x: number; y: number } {
  const [dx, dy] = ATOM_PLACE[SECTOR_ATOMS[i]];
  return { x: BOND_TRIANGLE.x + BOND_TRIANGLE.r * dx, y: BOND_TRIANGLE.y + BOND_TRIANGLE.r * dy };
}

/** For each bond (in BOND_KEYS order), its two atoms' places in SECTOR_ATOMS, the ends of the line it lights. */
export const BOND_ENDS: readonly (readonly [number, number])[] = BOND_KEYS.map(
  (k) => [SECTOR_ATOMS.indexOf(k[0] as ColorAtom), SECTOR_ATOMS.indexOf(k[1] as ColorAtom)] as const,
);

/**
 * What the bond visualizer shows for a fluid, against `cap`: for each bond (in BOND_KEYS order), how much of `cap`
 * molecules with that bond in them make up (by volume, see VOLUME), as the composition analyzer reads its sectors. So
 * against the fluid's own volume, R–G lights its line fully, △RGB all three of its, and half R, half R–G its one line
 * half as bright.
 */
export function bondShares(f: Fluid, cap: number): number[] {
  const out = BOND_KEYS.map(() => 0);
  for (let s = 0; s < NS; s++) if (f.n[s]) for (const b of SPECIES_BONDS[s]) out[b] += (f.n[s] * roomFor(s)) / cap;
  return out;
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

/** The inside of a tank with a neck, by kind of tool (see Tool.level): every tank of a kind is alike. */
const necked = new Map<ToolKind, Piece[]>();

export const TOOL_NAMES: Record<ToolKind, string> = {
  dispenser: 'Dispenser',
  pipette: 'Pipette',
  exchanger: 'Heat exchanger',
  separator: 'Separator',
  splitter: 'Splitter',
  multiplexer: 'Multiplexer',
  sorter: 'Size sorter',
  heater: 'Resistive heater',
  meter: 'Flow meter',
  thermometer: 'Fine thermometer',
  thermometerWide: 'Wide thermometer',
  dilatometer: 'Swell bulbs',
  strip: 'Wicking strip',
  dish: 'Dish',
  column: 'Column',
  culture: 'Sleeper culture',
  tank: 'Tank',
  receptacle: 'Cryostabilizer',
  analyzer: 'Composition analyzer',
  spectroscope: 'Spectroscope',
  visualizer: 'Bond visualizer',
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

/** How many outlets the separator has, one per share of black atoms a molecule can have. */
export const SEPARATOR_OUTLETS = 5;

/**
 * Each species' own outlet on the separator, left to right, by the share of its atoms that are black (K): none (0),
 * one in four (1), one in three (2), half (3), all (4).
 */
export const SEPARATOR_OUTLET: Uint8Array = Uint8Array.from(SPECIES, (sp) => {
  if (!sp.atoms.includes('K')) return 0;
  return sp.size === 1 ? 4 : 5 - sp.size;
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
 *   among them by the share of its atoms that are black (see separate).
 * - A **splitter** has a small funnel that drains straight through (at
 *   FUNNEL_RATE) to two spouts. Its valve doesn't open or close: it sets the
 *   share that goes right, from 0 (all left) to 1 (all right).
 * - A **multiplexer** is a splitter the other way up: two funnels, each draining (at FUNNEL_RATE times how high
 *   its fluid stands) into one spout between them. Its valve picks which: the share of FUNNEL_RATE the right funnel
 *   gets, from 0 (only the left drains) to 1 (only the right), the left getting the rest.
 * - A **size sorter** has a funnel like the splitter's, with no valve, draining down a chute through three
 *   screens and off its end, each with a spout under it (see sieve).
 * - A **resistive heater** has a funnel draining (at HEATER.feed) into one end of a long tube, which carries
 *   it to the other end in HEATER.transit and out a spout there, heating it all the way (see heatBy) with a
 *   wire whose temperature its dial sets (see wireTemperature). Three taps along the tube, each a valve over
 *   a spout, let fluid out sooner, less heated.
 * - A **tank** is a dispenser holding a hundred flasks, drawn as big as a hundred flasks, with ten faint
 *   graduations across it.
 * - A **receptacle** is the station, built into the wall (see STATION): a funnel and the ship's
 *   reservoir of whatever it's fitted for (see Supply). The funnel drains straight through (at FUNNEL_RATE) into a
 *   diverter, which sends what's more than
 *   GOAL_PURITY target into the reservoir, and the rest out the waste spigot, the first spout. The reservoir lets out
 *   a trickle through its faucet, the second spout, as far as its one valve is open. With enough in its reservoir,
 *   it's changed for the next supply's (see CHANGEOVER).
 * - A **flow meter** is an inline instrument (see INLINE_TOOLS): its tube drains straight through to one spout, and
 *   it shows what flows out, averaged over the recent past (see INSTRUMENT_TAU, rate and meterText).
 * - **Swell bulbs** are two little round tanks with narrow necks (see BULB), pressed together so the necks stand
 *   side by side, each draining at up to PIPETTE_FLOW, heated alike by one wire whose temperature a dial sets (see
 *   wireTemperature and heatBy), so how much each swells shows side by side.
 * - A **wicking strip** is bare paper, with no tanks. Its foot touched to a fluid takes a spot of it (see touch), and
 *   stood in a fluid, it drinks it up (see bath), carrying each species of the spot along at its own pace (see wick
 *   and STRIP_RUN), to leave it as a band once the paper's dry. It's used once.
 * - A **dish** is a shallow open tray with no valve or spout, to stand a strip in.
 * - A **column** is a small funnel over a tall tube packed with the strips' paper, its bed, over a tap and a spout. A
 *   dry bed drinks from the funnel until it's wet through; then what's poured in runs through it as far as the tap's
 *   open, carrying each species down it at its own pace, as on a strip, and out the spout (see elute).
 * - A **sleeper culture** is a flat glass plate of living cells, filled through a funnel on top. What's in it harms
 *   those of them it covers, by its loose ends and its heat (see harm): each dies at random, for good, the sooner the
 *   more harmful the fluid (see sicken). It drains through a valve under it, leaving its cells as they are, as a
 *   record of what was tried on them.
 * - A **thermometer** (fine or wide, see THERMOMETERS) has no tanks at all: it's a glass rod whose bulb takes the
 *   temperature of whatever fluid it's dipped in, or the room's (see warm and bath), and which shatters, for good, if
 *   that's too hot for it.
 * - A **composition analyzer** is an inline instrument too, and it draws off ANALYZER_SAMPLE of what passes, out its waste spout, reading that (see
 *   composition) onto a screen, averaged over the recent past (see INSTRUMENT_TAU).
 * - A **spectroscope** is an inline instrument too, which lets everything through, counting the bonds that pass over
 *   the recent past (see INSTRUMENT_TAU and bondCounts) and showing them by energy as a graph (see spectroscopeAt).
 * - A **bond visualizer** is an inline instrument too, which lets everything through, showing which atoms are bonded
 *   in what passed over the recent past (see INSTRUMENT_TAU and bondShares) as lines between the corners and middle of a triangle (see BOND_TRIANGLE).
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
   * over. A splitter's one valve is instead the share going right, and a multiplexer's the share taken from the right,
   * half by default.
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
  /** What step hands out, emptied and reused from step to step, so stepping allocates no fluid (see packet). */
  private scratch: Vessel[] = [];
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
   * A bond visualizer's reading (see bondShares), shown on its screen: for each bond, in BOND_KEYS order, the share of
   * what passed through it in the recent past (see INSTRUMENT_TAU) that has that bond, by volume; null once that's
   * down to less than TRACE a sim second.
   */
  links: number[] | null = null;
  /**
   * A meter's reading: what's flowed out of it, by volume per sim second, in the recent past (see INSTRUMENT_TAU); 0
   * once that's down to less than TRACE a sim second.
   */
  rate = 0;
  /**
   * A wicking strip's paper, stretch by stretch from its foot to its top (see STRIP.cells), each holding what's on
   * that stretch; it doesn't react or cool, having lost its heat as the paper took it up (see scorch). Empty for any
   * other tool.
   */
  readonly paper: Vessel[];
  /**
   * A column's bed, stretch by stretch from its top to its foot (see COLUMN.cells), each holding what's on that
   * stretch; it doesn't react or cool. Empty for any other tool.
   */
  readonly bed: Vessel[];
  /**
   * How much a wicking strip's paper or a column's bed has drunk, as a share of what it holds wet through (STRIP.cap,
   * COLUMN.cap), from 0 to 1. It sets how fast more is drawn in, and nothing on it moves past that share of its length
   * (see Bed); but it isn't a waterline, and nothing is drawn from it: how wet each stretch looks is what's on it (see
   * wetness).
   */
  soaked = 0;
  /** What a wicking strip's foot was in when it was last told (see dipIn), if anything: it touches what it comes into. */
  private wasIn: Vessel | null = null;
  /** How what's on a wicking strip's paper or a column's bed is carried along it (see Bed); null for any other tool. */
  private readonly packing: Bed | null;
  /**
   * How scorched each stretch of a wicking strip's paper is, from its foot (see scorchAt): by the hottest fluid that
   * stretch has been in. Only what's in the fluid scorches (see dipIn), since what the paper takes up cools at once.
   * Empty for any other tool.
   */
  readonly scorch: Float32Array;
  /** How many of a wicking strip's stretches, from its foot, are in what it's in, as it was last told (see dipIn). */
  private under = 1;
  /** Which of a sleeper culture's cells are dead, 1 for each that is, in cultureCells' order; null for any other tool. */
  readonly dead: Uint8Array | null;
  /** A thermometer's bulb's temperature (see warm), which its column shows; the room's to start with. */
  temp = COOLING.ambient;
  /**
   * The vessel a dipper's foot is in (see footY), if any, which whoever runs it sets before each step: the fluid a
   * thermometer's bulb is in (see warm), or what a wicking strip drinks from, only while it may (see wick).
   */
  bath: Vessel | null = null;
  /** Whether a thermometer has shattered (see warm): for good, reading nothing. */
  broken = false;
  /** An inline instrument's exponentially weighted average of what it's measured, per sim second (see smooth). */
  private smoothed: number[] | null = null;
  /**
   * The player's note about the whole tool, written above it; empty for none. Only a tool with no tank, or more than
   * one, has one: on a tool with one tank, its tank's label (Vessel.label) does the job.
   */
  note = '';
  /**
   * Where a receptacle's diverter sends what drains from its funnel: into the reservoir, or out the waste spigot. It
   * stays where it last sent anything, and starts on the waste.
   */
  gate: 'reservoir' | 'waste' = 'waste';
  /** Sim seconds since anything last went through a receptacle's diverter; Infinity if nothing has. */
  sinceFlow = Infinity;
  /** Sim seconds since a receptacle's diverter last let anything into the reservoir; Infinity if it never has. */
  sinceDelivery = Infinity;
  /**
   * Sim seconds a receptacle has been delivering steadily, letting cryostabilizer into the reservoir at least every
   * DELIVERY.gap sim seconds; 0 while it isn't. Shown on its screen (see clockText); long enough, and the player can
   * nap (see DELIVERY.nap), and the cryostabilizer's opens the airlock (see Supply.airlock).
   */
  steady = 0;
  /**
   * A receptacle's needle's reading: the share, by atoms, of what went through its diverter in the recent past (see
   * INSTRUMENT_TAU) that was the target. It stays where it was once nothing's going through; null until anything has.
   */
  purity: number | null = null;
  /** Where a receptacle's needle stands on its dial, from 0 to 1: it swings toward its reading (see needleAt) over NEEDLE_TAU. */
  needle = 0;
  /**
   * What a receptacle is fitted for (see Supply): what its diverter lets into its reservoir, and what's wanted there.
   * It's the cryostabilizer unless it's stocked with something else (see stock), as a new lab's is.
   */
  supply: Supply = CRYOSTABILIZER;
  /**
   * How many sim seconds into its changeover a receptacle is (see CHANGEOVER), or null while none is under way: it
   * starts when its reservoir holds enough of what it's fitted for, if the ship is short of something else.
   */
  swap: number | null = null;

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
    this.paper = Array.from({ length: kind === 'strip' ? STRIP.cells : 0 }, () => new Vessel(Infinity));
    this.scorch = new Float32Array(this.paper.length);
    this.bed = Array.from({ length: kind === 'column' ? COLUMN.cells : 0 }, () => new Vessel(Infinity));
    this.packing = kind === 'strip' ? new Bed(this.paper) : kind === 'column' ? new Bed(this.bed) : null;
    this.dead = kind === 'culture' ? new Uint8Array(cultureCells().length) : null;
    const nValves = SHAPES[kind].valves?.length ?? this.tanks.length;
    this.valves = Array.from({ length: nValves }, (_, k) => valves[k] ?? (kind === 'splitter' || kind === 'multiplexer' ? 0.5 : 0));
    this.out = this.shape.spouts.map(() => null);
    this.flow = this.shape.spouts.map(() => 0);
    this.drops = this.shape.spouts.map(() => new Vessel(Infinity));
    this.streaming = this.shape.spouts.map(() => false);
  }

  get shape(): ToolShape {
    return SHAPES[this.kind];
  }

  /**
   * Run for `h` sim seconds. Returns, per spout, the fluid that left it, or null if none did. What it returns is the
   * tool's own, and good only until its next step: move it or copy it, don't keep it.
   */
  step(h: number): (Vessel | null)[] {
    if (this.kind === 'heater') return this.heat(h);
    if (this.kind === 'receptacle') return this.receive(h);
    if (this.kind === 'strip') return this.wick(h);
    if (isThermometer(this.kind)) {
      this.warm(h);
      return this.none();
    }
    if (this.kind === 'column') return this.elute(h);
    // a culture's cells sicken in what's in the plate, which then drains like any tank
    if (this.kind === 'culture') this.sicken(h);
    // nothing drains from a tool with no spouts (a dish)
    if (!this.shape.spouts.length) return this.none();
    // with nothing in it and its readings faded to nothing, a step would do nothing; an instrument's smoothing starts
    // again from nothing measured, as it would have to within less than TRACE
    if (this.tanks.every((tk) => tk.N <= 0) && this.rate === 0 && !this.reading && !this.links && this.bonds.every((b) => b === 0)) {
      this.smoothed = null;
      return this.none();
    }
    const T = this.tanks.length;
    const parts = (n: number) => Array.from({ length: n }, (_, j) => this.packet(T + j));
    if (this.kind === 'dilatometer') {
      const wireT = wireTemperature(this.valves[this.shape.dial!]);
      for (const v of this.tanks) heatBy(v, wireT, h);
    }
    let packets = this.tanks.map((tank, k) => {
      const p = this.packet(k);
      // a valve, or a funnel without one, lets out in proportion to how high the fluid stands; an instrument's tube
      // drains at a fixed rate, so what it reads is just what's arriving; a multiplexer's valve shares its rate out
      // between its funnels
      const rate =
        INLINE_TOOLS.includes(this.kind) ? FUNNEL_RATE
        : this.kind === 'splitter' || this.kind === 'sorter' ? FUNNEL_RATE * this.level(k)
        : this.kind === 'multiplexer' ? FUNNEL_RATE * this.level(k) * (k ? this.valves[0] : 1 - this.valves[0])
        : this.valves[k] * (this.shape.maxFlow ?? MAX_FLOW) * this.level(k);
      transfer(tank, p, rate * h);
      return p;
    });
    if (this.kind === 'exchanger') counterflow(packets[0], packets[1], EXCHANGE_RATE * h);
    if (this.kind === 'separator') packets = separate(packets[0], parts(SEPARATOR_OUTLETS));
    if (this.kind === 'splitter') packets = divide(packets[0], () => 1 - this.valves[0], parts(2));
    if (this.kind === 'multiplexer') {
      transfer(packets[1], packets[0], volume(packets[1]));
      packets = [packets[0]];
    }
    if (this.kind === 'sorter') packets = sieve(packets[0], parts(SORTER_OUTLETS));
    if (this.kind === 'analyzer') packets = divide(packets[0], () => 1 - ANALYZER_SAMPLE, parts(2));
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
    if (this.kind === 'visualizer') {
      const [v, ...shares] = this.smooth(h, [volume(packets[0]), ...bondShares(packets[0], 1)]);
      this.links = v >= TRACE ? shares.map((x) => x / v) : null;
    }
    return this.out;
  }

  /**
   * A sleeper culture's step: each living cell that the fluid in the plate covers dies with probability
   * 1 − e^(−CULTURE.rate · harm · h), whatever the others do, and stays dead. How many do in a step is their number
   * times that, rounded at random, and which is drawn evenly from among them. Cells above the fluid are untouched.
   */
  private sicken(h: number): void {
    const plate = this.tanks[0];
    const dead = this.dead!;
    const rate = CULTURE.rate * harm(plate);
    if (rate > 0) {
      const H = this.shape.tankH ?? TANK_H;
      const surface = cultureLevel(Math.min(1, volume(plate) / plate.cap));
      const at: number[] = [];
      cultureCells().forEach((c, i) => {
        if (!dead[i] && H - c.y < surface) at.push(i);
      });
      for (let n = Math.min(at.length, roundRandom(at.length * (1 - Math.exp(-rate * h)))); n > 0; n--) {
        const j = Math.floor(Math.random() * at.length);
        dead[at[j]] = 1;
        at[j] = at[at.length - 1];
        at.pop();
      }
    }
  }

  /**
   * Tell a wicking strip what its foot is in now, if it counts as in anything (null if not), whether it may drink it,
   * and how far under its surface the foot is (see footY), in stretches, before it's stepped (whoever runs it decides
   * all three): the stretches under the surface are in the fluid, the first at least, and scorch if it's hot (see
   * char); coming into a fluid from none, they touch it (see touch); and it drinks from it (see bath and wick) only
   * while it may.
   */
  dipIn(v: Vessel | null, soak: boolean, depth = 0): void {
    this.under = Math.max(1, Math.min(this.paper.length, Math.ceil(depth)));
    if (v) this.char(v);
    if (v && !this.wasIn) this.touch(v);
    this.wasIn = v;
    this.bath = v && soak ? v : null;
  }

  /** The stretches of a wicking strip's paper that are in v's fluid (see dipIn), scorched by it if it's hot (see scorchAt). */
  private char(v: Vessel): void {
    if (v.N <= 0) return;
    const by = scorchAt(temperature(v));
    if (by > 0) for (let c = 0; c < this.under; c++) this.scorch[c] = Math.max(this.scorch[c], by);
  }

  /**
   * A wicking strip touched to v, as its foot comes into v's fluid: unused paper, nothing yet drunk up it, takes a spot
   * of it, STRIP.spot, or what v has if that's less, spread evenly over the stretches that are in the fluid (see
   * dipIn), so the spot's top is where the surface was; up to STRIP.spots spots' worth in all. Returns the atoms it
   * took.
   */
  touch(v: Vessel): number {
    if (this.kind !== 'strip' || this.soaked > 0 || v.N <= 0) return 0;
    const on = this.paper.reduce((a, p) => a + volume(p), 0);
    const room = Math.min(STRIP.spot, STRIP.spots * STRIP.spot - on);
    if (room <= 0) return 0;
    let moved = 0;
    for (let c = 0; c < this.under; c++) {
      moved += transfer(v, this.paper[c], room / this.under);
      this.paper[c].Q = 0;
    }
    return moved;
  }

  /**
   * A wicking strip's step. While it may drink from what its foot is in (see bath), and the paper hasn't soaked
   * through, the paper draws it up: what it's drunk grows as the square root of the time (its square grows steadily),
   * all it holds in STRIP.time, but only as far as the vessel can supply, since soaking a share d takes d · STRIP.cap
   * from it. What it draws goes into the foot of the paper, and what's in the fluid scorches if that's hot (see char). As it soaks a
   * share d, the liquid, at the pace of what it drew (see leadOf), carries what's on the paper d · STRIP.cells
   * stretches' worth up it (see Bed), never past that share of its length. Lifted out, it stops where it is, and put
   * back, it goes on. Once it's soaked through, it's done: it takes up nothing more, and stays as it is, wet, for
   * good. Nothing leaves it.
   */
  private wick(h: number): (Vessel | null)[] {
    const bath = this.bath;
    const { paper } = this;
    if (this.soaked >= 1 || !bath || bath.N <= 0) return this.none();
    const C = STRIP.cells;
    const d = Math.min(Math.min(1, Math.sqrt(this.soaked ** 2 + h / STRIP.time)) - this.soaked, volume(bath) / STRIP.cap);
    if (d <= 0) return this.none();
    this.char(bath);
    // what it draws this step, which runs at its own pace
    const drawn = this.packet(0);
    transfer(bath, drawn, d * STRIP.cap);
    const lead = leadOf(drawn);
    // in passes of at most a twentieth of a stretch, so that what comes in lands evenly between moves, and the
    // paper's evenly wet (see wetness)
    const passes = Math.ceil(20 * d * C);
    const from = this.soaked;
    for (let k = 1; k <= passes; k++) {
      transfer(drawn, paper[0], k === passes ? volume(drawn) : (d / passes) * STRIP.cap);
      paper[0].Q = 0;
      this.soaked = Math.min(1, from + (d * k) / passes);
      // from the stretch under the soaked one's at most into it
      this.packing!.carry((d / passes) * C, Math.min(C, Math.ceil(this.soaked * C)) - 2, lead);
    }
    if (this.soaked > 1 - 1e-9) this.soaked = 1;
    return this.none();
  }

  /**
   * A column's step. Until its bed is wet through, it drinks from the funnel at COLUMN.soak, tap open or not, until
   * it's drunk COLUMN.cap; nothing leaves it till then. Once it's wet through, liquid runs from the funnel into it at
   * COLUMN.flow, as far as the tap's open. Either way only while the funnel has any: what comes in goes into the bed's
   * top stretch, and as a share d of COLUMN.cap does, the liquid, at the pace of what came in (see leadOf), carries
   * what's on the bed d · COLUMN.cells stretches' worth down it (see Bed), while it's soaking never past the share of
   * its length it's drunk, and once it's wet through, out the spout. With the funnel empty or the tap shut, everything on the bed stays where it is.
   */
  private elute(h: number): (Vessel | null)[] {
    const funnel = this.tanks[0];
    const soaking = this.soaked < 1;
    const rate = soaking ? COLUMN.soak : this.valves[0] * COLUMN.flow;
    if (funnel.N <= 0 || rate <= 0) return this.none();
    const C = COLUMN.cells;
    const amount = Math.min(rate * h, volume(funnel), soaking ? (1 - this.soaked) * COLUMN.cap : Infinity);
    const d = amount / COLUMN.cap;
    if (d <= 0) return this.none();
    const out = soaking ? null : this.packet(0);
    // what runs in this step, which runs at its own pace
    const poured = this.packet(1);
    transfer(funnel, poured, amount);
    const lead = leadOf(poured);
    // in passes of at most a twentieth of a stretch, as on a strip (see wick)
    const passes = Math.ceil(20 * d * C);
    const from = this.soaked;
    for (let k = 1; k <= passes; k++) {
      transfer(poured, this.bed[0], k === passes ? volume(poured) : amount / passes);
      if (soaking) this.soaked = Math.min(1, from + (d * k) / passes);
      this.packing!.carry((d / passes) * C, soaking ? Math.ceil(this.soaked * C) - 2 : C - 1, lead, out);
    }
    if (this.soaked > 1 - 1e-9) this.soaked = 1;
    this.out[0] = out && out.N > 0 ? out : null;
    this.flow[0] = out ? volume(out) / (MAX_FLOW * h) : 0;
    return this.out;
  }

  /**
   * A thermometer's bulb over a step of h sim seconds: it closes on the temperature of the fluid it's in (see bath)
   * over THERMOMETER.tau, or in the air, on the room's over THERMOMETER.roomTau. Once it's past THERMOMETER.burst times
   * the top of its scale, the spirit has nowhere left to go, and it shatters, for good. A broken one does nothing.
   */
  private warm(h: number): void {
    if (this.broken) return;
    const f = this.bath && this.bath.N > 0 ? this.bath : null;
    const T = f ? temperature(f) : COOLING.ambient;
    if (this.temp === T) return;
    this.temp += (T - this.temp) * (1 - Math.exp(-h / (f ? THERMOMETER.tau : THERMOMETER.roomTau)));
    // once it's as good as there, it's there, so a thermometer standing in the air comes to rest
    if (Math.abs(this.temp - T) < 1e-6) this.temp = T;
    if (this.temp > THERMOMETER.burst * THERMOMETERS[this.kind as ThermometerKind].top) this.broken = true;
  }

  /** What a thermometer reads: its bulb's temperature, or null once it's broken (or for any other tool). */
  get reads(): number | null {
    return isThermometer(this.kind) && !this.broken ? this.temp : null;
  }

  /**
   * What a save keeps of an instrument's own state, as numbers, or undefined if it has none: a thermometer's bulb's
   * temperature, and 1 if it's broken or 0 if not; how much a wicking strip's paper has drunk, a 0 where how dry it
   * was used to be, when strips dried, and how scorched each stretch is (what's on its paper is saved as vessels, see paper); how much a column's bed has drunk (what's on it is
   * saved as vessels, see bed); which of a sleeper culture's cells are dead (see dead); which supply a receptacle is
   * fitted for (its place in SUPPLIES), and how far into its changeover it is, or −1 if none is under way.
   */
  get memory(): number[] | undefined {
    if (this.kind === 'strip') return [this.soaked, 0, ...this.scorch];
    if (this.kind === 'column') return [this.soaked];
    if (this.kind === 'culture') return Array.from(this.dead!);
    if (this.kind === 'receptacle') return [SUPPLIES.indexOf(this.supply), this.swap ?? -1];
    return isThermometer(this.kind) ? [this.temp, +this.broken] : undefined;
  }

  /**
   * Put back what a save kept (see memory), wherever it's the right length and all finite numbers. An older save's
   * strip kept one number for how scorched it was, all over: that goes for as much of it as it had soaked.
   */
  remember(m: unknown): void {
    const want = this.memory?.length;
    const old = this.kind === 'strip' && Array.isArray(m) && m.length === 3;
    if (!Array.isArray(m) || (m.length !== want && !old) || !m.every((x) => typeof x === 'number' && Number.isFinite(x))) return;
    if (isThermometer(this.kind)) [this.temp, this.broken] = [m[0] as number, (m[1] as number) > 0];
    if (this.kind === 'strip') {
      // the second was how dry it was, when strips dried
      const [soaked, , ...scorch] = (m as number[]).map((x) => Math.max(0, Math.min(1, x)));
      this.soaked = soaked;
      if (old) this.scorch.fill(scorch[0], 0, Math.ceil(soaked * STRIP.cells));
      else this.scorch.set(scorch);
    }
    if (this.kind === 'column') this.soaked = Math.max(0, Math.min(1, (m as number[])[0]));
    if (this.kind === 'culture') this.dead!.set((m as number[]).map((x) => +(x > 0)));
    if (this.kind === 'receptacle') {
      const [supply, swap] = m as number[];
      this.supply = SUPPLIES[supply] ?? CRYOSTABILIZER;
      this.tanks[1].cap = this.supply.cap;
      // from halfway through a changeover, it's already the next supply's, and only has to come out
      this.swap = swap >= 0 && swap < CHANGEOVER_S && (swap >= STOCKED_AT || nextSupply(this.supply)) ? swap : null;
    }
  }

  /**
   * Fit a receptacle for a supply, as new: its reservoir holding what's on board of it to start with, at room
   * temperature, and as big as that supply's is; its funnel and spouts empty; its faucet shut; its diverter, needle
   * and screens as if nothing had ever come through.
   */
  stock(supply: Supply): void {
    const [funnel, ref] = this.tanks;
    for (const v of [funnel, ref, ...this.drops]) {
      v.n.fill(0);
      v.N = v.Q = 0;
    }
    this.supply = supply;
    this.valves[0] = 0;
    ref.cap = supply.cap;
    ref.n[supply.species] = supply.start;
    ref.N = supply.start * SPECIES[supply.species].size;
    ref.setTemperature(T_ROOM);
    this.gate = 'waste';
    this.sinceFlow = this.sinceDelivery = Infinity;
    this.steady = 0;
    this.purity = null;
    this.needle = 0;
    this.smoothed = null;
  }

  /**
   * Whether a receptacle's block is away from where it works, during a changeover (see CHANGEOVER): from when it
   * starts back into the wall until the next one is all the way out. Nothing goes into its funnel or comes out of its
   * spouts, and nothing on it can be worked.
   */
  get away(): boolean {
    return this.swap !== null && this.swap >= CHANGEOVER.warn && this.swap < CHANGEOVER_S - CHANGEOVER.clear;
  }

  /** Scratch fluid i (see scratch), emptied. */
  private packet(i: number): Vessel {
    const p = (this.scratch[i] ??= new Vessel(Infinity));
    if (p.N) p.n.fill(0);
    p.N = 0;
    p.Q = 0;
    return p;
  }

  /** A step that lets nothing out. */
  private none(): (Vessel | null)[] {
    this.out.fill(null);
    this.flow.fill(0);
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
    if (this.tanks[0].N <= 0 && tube.every((v) => v.N <= 0)) return this.none();
    const packets = this.shape.spouts.map((_, j) => this.packet(j));
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
   * as the game has always drained, not by how it's drawn in the room (see tankPieces), so flows stay as they were;
   * but a tank with a neck goes by how it's drawn, from its sump's tip to its neck's top.
   */
  level(k: number): number {
    const v = this.tanks[k];
    const share = Math.min(1, volume(v) / v.cap);
    const { cup, sump, neck, tanks, tankH = TANK_H } = this.shape;
    const w = tanks[k].x1 - tanks[k].x0;
    if (neck) {
      // a newer shape, with no flows to keep as they were: by how it's drawn (its outline worked out once per kind)
      let pieces = necked.get(this.kind);
      if (!pieces) necked.set(this.kind, (pieces = tankPieces(this.shape, k, w)));
      return levelIn(pieces, share) / heightOf(pieces);
    }
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
   * A receptacle's step. Its reservoir's faucet lets out as far as its valve is open, at REFERENCE_FLOW. Its funnel
   * drains straight through at FUNNEL_RATE, however full it is, into the diverter, which judges what comes through: more
   * than GOAL_PURITY target (see sustenance), and it goes into the reservoir (as much as fits), else out the waste
   * spigot. Its needle reads how much of what's come through lately was the target (see purity). The reservoir's
   * filter takes out what has a black atom in it (see filter). The target is whatever it's fitted for (see supply), and
   * once the reservoir holds enough of that, if the ship is short of something else, its changeover starts (see
   * CHANGEOVER): its faucet is shut, and while its block is away (see away) nothing moves in it; halfway through, behind
   * the door, it's the next supply's (see stock).
   */
  private receive(h: number): (Vessel | null)[] {
    const [funnel, ref] = this.tanks;
    if (this.swap !== null) {
      const from = this.swap;
      this.swap += h;
      const next = nextSupply(this.supply);
      if (from < STOCKED_AT && this.swap >= STOCKED_AT && next) this.stock(next);
      if (this.swap >= CHANGEOVER_S) this.swap = null;
    }
    if (this.away) {
      this.steady = 0;
      return this.none();
    }
    const { species } = this.supply;
    const out: (Vessel | null)[] = [null, null];
    const tap = this.packet(0);
    transfer(ref, tap, this.valves[0] * REFERENCE_FLOW * h);
    if (tap.N > 0) out[1] = tap;
    const p = this.packet(1);
    transfer(funnel, p, FUNNEL_RATE * h);
    this.sinceFlow += h;
    this.sinceDelivery += h;
    // the needle reads what the diverter is judging, before it goes either way
    const [passed, target] = this.smooth(h, [p.N, p.n[species] * SPECIES[species].size]);
    if (passed >= TRACE) this.purity = target / passed;
    this.needle += (needleAt(this.purity ?? 0) - this.needle) * (1 - Math.exp(-h / NEEDLE_TAU));
    if (p.N > 0) {
      this.sinceFlow = 0;
      this.gate = sustenance(p, species) > 0 ? 'reservoir' : 'waste';
      if (this.gate === 'reservoir' && transfer(p, ref, volume(p)) > 0) this.sinceDelivery = 0;
      if (p.N > 0) out[0] = p;
    }
    this.steady = this.sinceDelivery <= DELIVERY.gap ? this.steady + h : 0;
    filter(ref, h);
    if (this.swap === null && nextSupply(this.supply) && ref.n[species] >= this.supply.goal) {
      this.swap = 0;
      this.valves[0] = 0;
    }
    this.out = out;
    this.flow = out.map((p) => (p ? volume(p) / (MAX_FLOW * h) : 0));
    return out;
  }
}

/**
 * What an analyzer shows for a sample, against `cap`: for each molecule size w (1–4 atoms) and atom color c, in
 * SECTOR_ATOMS order, at index (w − 1)·4 + c, how much of `cap` molecules of size w with a c atom in them make up
 * (by volume, see VOLUME). So against the sample's own volume, R lights 1R fully, and R–G both 2R and 2G fully; and
 * half R, half G lights 1R and 1G half as bright. It has no sector for the solvent, which lights nothing, but takes up
 * room all the same, so half R, half S lights 1R half as bright too.
 */
export function composition(f: Fluid, cap: number): number[] {
  const n = SECTOR_ATOMS.length;
  const out = new Array<number>(4 * n).fill(0);
  for (let s = 0; s < NS; s++) {
    if (!f.n[s]) continue;
    const sp = SPECIES[s];
    for (const a of sp.atoms) {
      const c = SECTOR_ATOMS.indexOf(a as ColorAtom);
      if (c >= 0) out[(sp.size - 1) * n + c] += (f.n[s] * roomFor(s)) / cap;
    }
  }
  return out;
}

/**
 * Pass a fluid over the size sorter's screens (see sorterShares): what falls through the first (singles), the second
 * (pairs) and the third (triples), and what goes off the end (fours), in whole molecules, with heat in proportion.
 */
export function sieve(f: Fluid, into?: Vessel[]): Vessel[] {
  const shares = sorterShares();
  return split(f, SORTER_OUTLETS, (s) => shares[SPECIES[s].size - 1], into);
}

/** Split a fluid among the separator's outlets, left to right (see separatorShares), in whole molecules, heat in proportion. */
export function separate(f: Fluid, into?: Vessel[]): Vessel[] {
  const shares = separatorShares();
  return split(f, SEPARATOR_OUTLETS, (s) => shares[SEPARATOR_OUTLET[s]], into);
}

/**
 * Split a fluid `n` ways, sending `shares(s)[j]` of species s to the j-th, in whole molecules (the last takes
 * whatever rounding leaves), with heat in proportion to atoms. The parts go into `out`, empty vessels, if it's given.
 */
export function split(
  f: Fluid,
  n: number,
  shares: (s: number) => readonly number[],
  out = Array.from({ length: n }, () => new Vessel(Infinity)),
): Vessel[] {
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

/**
 * Split a fluid into left and right, sending `leftShare(s)` of species s left, in whole molecules, heat in
 * proportion. The parts go into `out`, empty vessels, if it's given.
 */
export function divide(
  f: Fluid,
  leftShare: (s: number) => number,
  out: Vessel[] = [new Vessel(Infinity), new Vessel(Infinity)],
): [Vessel, Vessel] {
  for (let s = 0; s < NS; s++) {
    if (!f.n[s]) continue;
    const left = Math.min(f.n[s], roundRandom(f.n[s] * leftShare(s)));
    out[0].n[s] = left;
    out[1].n[s] = f.n[s] - left;
    out[0].N += left * SPECIES[s].size;
    out[1].N += (f.n[s] - left) * SPECIES[s].size;
  }
  out[0].Q = f.N > 0 ? Math.min(f.Q, roundRandom((f.Q * out[0].N) / f.N)) : 0;
  out[1].Q = f.Q - out[0].Q;
  return [out[0], out[1]];
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
