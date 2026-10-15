import { ATOMS } from '../chem/atoms';
import { THERMO } from '../chem/params';
import { roundRandom } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { DELIVERY, GOAL_TARGET } from './config';
import { roomFor, type Vessel } from './flask';
import type { Tool } from './tools';

/*
 * Sleeping in the cryopod while a steady line fills the ship's reservoir (see the README's The airlock), much faster
 * than the lab can be run substep by substep. The lab is run as ever, as a black box, for a window; how every
 * vessel's contents changed through it is measured; and if they're changing steadily, the lab jumps ahead by applying
 * those changes for a stretch Δ, as long as nothing would happen within it that the window couldn't have seen (a
 * vessel reaching its brim, a supply running low), and the lab's clock moves on by Δ. Then it settles, is measured
 * again, and so on. Everything in a window is the lab as it always runs, so a line that stops delivering, or turns
 * impure, does so in a window, and wakes the sleeper.
 *
 * Each vessel's state is its molecule counts n[s] and its heat Q. Over a window of W sim seconds it's sampled K + 1
 * times, giving K increments per component, from which come its rate (their mean) and that rate's standard error
 * (drops and random rounding make the increments noisy).
 *
 * A vessel that something drains (a tank with its valve open, a funnel, the heater's tube) feeds what's downstream,
 * so its rates are applied whole or not at all, which keeps atoms where the plain lab would put them: whole, if any of
 * its element totals (atoms of each color) or its heat is drifting, judged in this window (and confirmed by the one
 * before) or over the last few windows pooled, at its species' rates in this window (not pooled: a vessel draining
 * away drains slower after each jump); otherwise
 * species by species, where a species' drift shows clearly in this window and the one before (internal chemistry
 * with every element in balance); and the rest is left as it is, steady.
 *
 * A vessel that nothing drains (a flask, the reservoir, a tank with its valve shut) feeds nothing back, so each of its
 * components with a clear drift, confirmed, is applied on its own, at its rate pooled over every window since it last
 * changed course: its rate is what's extrapolated furthest (the reservoir's, all the way to the goal), so it has to be
 * known to within `precision` before a long jump.
 *
 * A rate that's clearly changing from one window to the next (a supply draining away, and what it feeds) is taken
 * to go on changing as fast through the jump, so it's extrapolated along a parabola, not a line.
 *
 * Δ is short enough that:
 *  - no component of a drained vessel changes by more than `drain` of itself (or of a floor, for traces), since what
 *    drains depends on what's there (a tank draining through a valve decays exponentially, which the parabola
 *    follows only so far), or `blind` of itself while how its rate is changing isn't yet clear: then it's taken
 *    as steady, though whatever it feeds slows as it drains, and what they let out over the jump comes out about
 *    blind / 2 too much;
 *  - in a vessel that nothing drains, no species' share (or the temperature) changes by more than eps of itself (or
 *    of a floor), so it may fill from near empty in one jump;
 *  - no applied rate changes by more than eps of itself, as seen between the window's halves or since the window
 *    before (across the last jump): a rate that's changing may be relaxing exponentially, which going straight
 *    would overshoot;
 *  - a vessel nothing drains gains no more uncertainty than `precision` of what it holds, until its rate is known;
 *  - no vessel reaches its brim within it, nor within half a window after;
 *  - the reservoir goes no further than the goal.
 * After a jump, the lab runs `settle` sim seconds unmeasured, for whatever the jump knocked out of balance (fast
 * reactions and their reverses) to settle, so the next window doesn't mistake its relaxing for a drift. Anything
 * significant but unconfirmed means no jump yet.
 */
export const SLEEP = {
  /** The window, in sim seconds, and how many increments it's measured in. */
  window: 20,
  samples: 16,
  /** The most sim seconds the lab is run at a time (see Sleeper.advance), between which the sleeper can pause. */
  piece: 0.25,
  /** How far a jump may move a component, or its rate, as a share of it (see above). */
  eps: 0.2,
  /** How far a jump may move a component of a vessel something drains, as a share of it (see above). */
  drain: 0.1,
  /** The same, while how fast its rate is changing isn't clear. */
  blind: 0.02,
  /** How many standard errors make a rate significant, and how many in the window before confirm it. */
  z: 5,
  zConfirm: 3,
  /** A component smaller than this share of its vessel's molecules is a trace: limited only by this share. */
  floor: 1e-3,
  /**
   * For a vessel nothing drains, a share of its makeup smaller than this is limited only by this: its contents feed
   * nothing back, so a trace's share drifting from 0.1% to 1% in a jump matters no more than one drifting by 1%.
   */
  shareFloor: 0.05,
  /** How much each window before counts in the pooled history, relative to the one after it. */
  memory: 0.7,
  /**
   * How well, as a share of itself, a rate into a vessel nothing drains must be known before it's extrapolated as far
   * as it likes; until then a jump adds no more uncertainty than this share of what the vessel holds.
   */
  precision: 0.01,
  /** Sim seconds run, unmeasured, after a jump before the next window, for what the jump knocked off balance to settle. */
  settle: 5,
  /** Jumps shorter than this many windows aren't worth it: just run on. */
  minJump: 1,
};

/** What the sleeper runs: the lab (see GameEngine.sleeper). */
export interface Sleeper {
  /** Every vessel the lab moves fluid between, and whether anything drains it, as the lab stands now. */
  vessels(): { v: Vessel; terminal: boolean }[];
  /** The cryostabilizer station. */
  station: Tool;
  /** The lab's sim clock. */
  clock(): number;
  /** Run the lab for dt sim seconds, as ever, with nothing drawn or heard. */
  advance(dt: number): void;
  /** Move the lab's clocks on by dt sim seconds, after a jump. */
  skip(dt: number): void;
}

/** Why a sleep ended: the reservoir holds enough to reach Mu Ceti, or the station stopped delivering. */
export type Woke = 'goal' | 'stopped';

/** How a sleep went, in sim seconds: run as ever (windows and settling), and jumped. */
export interface SleepStats {
  plain: number;
  jumped: number;
  jumps: number;
}

/** Components per vessel: its species, its heat (at NS), and its atoms of each color (from NS + 1), all as counts. */
const HEAT = NS;
const ELEMENT = NS + 1;
const COMPONENTS = NS + 1 + ATOMS.length;

/** One vessel's samples through a window: per sample, its components. */
interface Track {
  v: Vessel;
  /** Whether nothing drains it (see above). */
  terminal: boolean;
  xs: Float64Array[];
}

/**
 * What a vessel's windows showed, per component: the last window's rate and standard error, and the windows so far
 * pooled, weighting each by SLEEP.memory to the power of its age: the weighted count of increments, the sum of the
 * squared weights, and the weighted sum and sum of squares of the increments. Plus the sim time of the last
 * window's middle.
 */
interface Seen {
  t: number;
  r: Float64Array;
  se: Float64Array;
  n: Float64Array;
  n2: Float64Array;
  sum: Float64Array;
  sq: Float64Array;
}

function sample(v: Vessel): Float64Array {
  const x = new Float64Array(COMPONENTS);
  x.set(v.n);
  x[HEAT] = v.Q;
  for (let s = 0; s < NS; s++) if (v.n[s]) for (const a of SPECIES[s].atomIdx) x[ELEMENT + a] += v.n[s];
  return x;
}

const molecules = (x: Float64Array) => {
  let m = 0;
  for (let s = 0; s < NS; s++) m += x[s];
  return m;
};
const atoms = (x: Float64Array) => {
  let a = 0;
  for (let e = 0; e < ATOMS.length; e++) a += x[ELEMENT + e];
  return a;
};
const vol = (x: Float64Array) => {
  let a = 0;
  for (let s = 0; s < NS; s++) if (x[s]) a += x[s] * roomFor(s);
  return a;
};

/** A component's rate per sim second over the window, its standard error, and how much it changed between halves. */
function rate(ys: readonly number[], W: number): { r: number; se: number; dr: number } {
  const K = ys.length - 1;
  const w = W / K;
  let mean = 0;
  for (let k = 0; k < K; k++) mean += ys[k + 1] - ys[k];
  mean /= K;
  let v = 0;
  for (let k = 0; k < K; k++) v += (ys[k + 1] - ys[k] - mean) ** 2;
  const sd = Math.sqrt(v / Math.max(1, K - 1));
  const h = K >> 1;
  const r1 = (ys[h] - ys[0]) / (h * w);
  const r2 = (ys[K] - ys[h]) / ((K - h) * w);
  return { r: mean / w, se: sd / (w * Math.sqrt(K)), dr: r2 - r1 };
}

/** The pooled rate of component c and its standard error, from a vessel's history, per sim second. */
function pooled(s: Seen, c: number, w: number): { r: number; se: number } {
  const mean = s.sum[c] / s.n[c];
  const neff = (s.n[c] * s.n[c]) / s.n2[c];
  const sd = Math.sqrt(Math.max(0, s.sq[c] / s.n[c] - mean * mean) * (neff / Math.max(1, neff - 1)));
  return { r: mean / w, se: sd / (w * Math.sqrt(neff)) };
}

const significant = (q: { r: number; se: number }, z: number) => q.r !== 0 && Math.abs(q.r) > z * q.se;

/** Where a vessel's components' rates of change start, in what plan gives jump for it: each after its rate. */
const ACC = NS + 1;

/**
 * How long a jump may be, from a window's tracks, and per vessel the rates to apply (0 where it's steady), as at the
 * window's middle, followed by how fast each is changing (see ACC). Infinity if nothing limits it. `reservoir` is the
 * station's, which stops at the goal.
 */
function plan(
  tracks: Track[],
  W: number,
  prev: Map<Vessel, Seen>,
  t: number,
  reservoir: Vessel,
): { dt: number; rates: Float64Array[]; seen: Map<Vessel, Seen> } {
  const { eps, z, zConfirm, floor, memory } = SLEEP;
  const seen = new Map<Vessel, Seen>();
  let dt = Infinity;
  const limit = (d: number) => (dt = Math.min(dt, d));
  const rates = tracks.map((tr) => {
    const out = new Float64Array(2 * ACC);
    const was = prev.get(tr.v);
    const K = tr.xs.length - 1;
    const w = W / K;
    // a vessel nothing drains pools every window since it changed course: what reaches it should be steady, and its
    // rate is what's extrapolated furthest (see precision)
    const mem = tr.terminal ? 1 : memory;
    const now: Seen = {
      t,
      r: new Float64Array(COMPONENTS),
      se: new Float64Array(COMPONENTS),
      n: new Float64Array(COMPONENTS),
      n2: new Float64Array(COMPONENTS),
      sum: new Float64Array(COMPONENTS),
      sq: new Float64Array(COMPONENTS),
    };
    seen.set(tr.v, now);
    const stats = [] as { r: number; se: number; dr: number }[];
    for (let c = 0; c < COMPONENTS; c++) {
      const ys = tr.xs.map((x) => x[c]);
      const q = rate(ys, W);
      stats.push(q);
      now.r[c] = q.r;
      now.se[c] = q.se;
      now.n[c] = (was?.n[c] ?? 0) * mem + K;
      now.n2[c] = (was?.n2[c] ?? 0) * mem * mem + K;
      now.sum[c] = (was?.sum[c] ?? 0) * mem;
      now.sq[c] = (was?.sq[c] ?? 0) * mem;
      for (let k = 0; k < K; k++) {
        const d = ys[k + 1] - ys[k];
        now.sum[c] += d;
        now.sq[c] += d * d;
      }
    }
    const last = tr.xs[K];
    const M = molecules(last);
    const N = atoms(last);
    const scaleOf = (c: number) => Math.max(last[c], c === HEAT ? floor * THERMO.heatCap * N : floor * M, 1000);
    // a drift seen in this window, confirmed by the one before (its own, or all of them pooled), the same way
    const confirmed = (c: number) =>
      !!was &&
      (significant({ r: was.r[c], se: was.se[c] }, zConfirm) || significant(pooled(was, c, w), zConfirm)) &&
      Math.sign(was.r[c]) === Math.sign(stats[c].r);
    // how fast the rate is changing since the last window, if clearly
    const trend = (c: number) =>
      was && Math.abs(stats[c].r - was.r[c]) > z * Math.hypot(stats[c].se, was.se[c])
        ? (stats[c].r - was.r[c]) / Math.max(1e-9, t - was.t)
        : 0;
    // how fast the rate is changing, within the window or since the last: it mustn't change by more than eps of itself
    const steadyRate = (c: number, r: number) => {
      const q = stats[c];
      if (Math.abs(q.dr) > 2 * z * q.se) limit((eps * Math.abs(r) * (W / 2)) / Math.abs(q.dr));
      if (was && Math.abs(q.r - was.r[c]) > z * Math.hypot(q.se, was.se[c]))
        limit((eps * Math.abs(r) * Math.max(1e-9, t - was.t)) / Math.abs(q.r - was.r[c]));
    };

    if (!tr.terminal) {
      // drained: whole, if its atoms or heat are drifting
      let whole = false;
      for (let c = HEAT; c < COMPONENTS && !whole; c++) {
        if (significant(stats[c], z)) {
          if (!confirmed(c)) limit(0);
          else whole = true;
        } else if (now.n[c] >= 2 * K && significant(pooled(now, c, w), z)) whole = true;
      }
      if (whole) {
        for (let c = 0; c <= HEAT; c++) {
          const r = stats[c].r;
          if (!r) continue;
          out[c] = r;
          out[ACC + c] = trend(c);
          limit(((out[ACC + c] ? SLEEP.drain : SLEEP.blind) * scaleOf(c)) / Math.abs(r));
        }
        for (let c = HEAT; c < COMPONENTS; c++) {
          const p = pooled(now, c, w);
          if (significant(p, z)) steadyRate(c, p.r);
        }
      } else
        // or species by species, where it's clear: internal chemistry
        for (let c = 0; c < NS; c++) {
          if (!significant(stats[c], z)) continue;
          if (!confirmed(c)) {
            limit(0);
            continue;
          }
          out[c] = stats[c].r;
          out[ACC + c] = trend(c);
          limit(((out[ACC + c] ? SLEEP.drain : SLEEP.blind) * scaleOf(c)) / Math.abs(stats[c].r));
          steadyRate(c, stats[c].r);
        }
    } else {
      // nothing drains it: each component on its own, limited by its share of the makeup
      const shares = tr.xs.every((x) => molecules(x) > 0);
      for (let c = 0; c <= HEAT; c++) {
        if (!significant(stats[c], z)) continue;
        if (!confirmed(c)) {
          limit(0);
          continue;
        }
        steadyRate(c, stats[c].r);
        // the rate pooled over every window since it changed course; and until it's known to within `precision` of
        // itself, no further than leaves what's added uncertain by more than that share of what's there then (but if
        // it's clearly changing since the last window, or this window disagrees with them, the rate's moving: start
        // the pool again from this window)
        let p = pooled(now, c, w);
        out[ACC + c] = trend(c);
        if (out[ACC + c] || Math.abs(stats[c].r - p.r) > z * Math.hypot(stats[c].se, p.se)) {
          let sq = 0;
          for (let k = 0; k < K; k++) sq += (tr.xs[k + 1][c] - tr.xs[k][c]) ** 2;
          now.sum[c] = stats[c].r * W;
          now.sq[c] = sq;
          now.n[c] = now.n2[c] = K;
          p = { r: stats[c].r, se: stats[c].se };
        }
        const r = p.r;
        out[c] = r;
        const slack = p.se - SLEEP.precision * Math.abs(r);
        if (slack > 0) limit((SLEEP.precision * scaleOf(c)) / slack);
        if (!shares) {
          limit((eps * scaleOf(c)) / Math.abs(r));
          continue;
        }
        // shares of molecules, or for heat, the temperature
        const ss = tr.xs.map((x) => (c === HEAT ? x[c] / (THERMO.heatCap * atoms(x)) : x[c] / molecules(x)));
        const q = rate(ss, W);
        if (!significant(q, z)) continue;
        const scale = c === HEAT ? Math.max(ss[K], 0.05) : Math.max(ss[K], SLEEP.shareFloor);
        limit((eps * scale) / Math.abs(q.r));
      }
    }

    // its brim: stop half a window short of it, so it's reached in a window (one already at its brim is overflowing
    // steadily, as one under a faucet does)
    let [vr, va] = [0, 0];
    for (let s = 0; s < NS; s++) {
      vr += startRate(out, s, W) * roomFor(s);
      va += out[ACC + s] * roomFor(s);
    }
    const room = tr.v.cap - vol(last);
    if (room > 1e-6 * tr.v.cap) limit(reach(room, vr, va) - W / 2);
    // the reservoir, no further than the goal
    if (tr.v === reservoir) limit(reach(Math.max(0, GOAL_TARGET - last[TARGET]), startRate(out, TARGET, W), out[ACC + TARGET]));
    return out;
  });
  return { dt, rates, seen };
}

/** Component c's rate as a jump starts, at the window's end, from plan's rates at its middle (see ACC). */
const startRate = (r: Float64Array, c: number, W: number) => r[c] + (r[ACC + c] * W) / 2;

/** How far component c moves over a jump of dt (see plan). */
const moved = (r: Float64Array, c: number, W: number, dt: number) => startRate(r, c, W) * dt + (r[ACC + c] * dt * dt) / 2;

/** How long something going at rate r, changing at a, takes to go x; Infinity if it never gets there. */
function reach(x: number, r: number, a: number): number {
  if (x <= 0) return 0;
  const disc = r * r + 2 * a * x;
  return disc < 0 || r + Math.sqrt(disc) <= 0 ? Infinity : (2 * x) / (r + Math.sqrt(disc));
}

/** Apply rates for dt sim seconds to each vessel (see plan), in whole molecules and quanta, none below 0. */
function jump(tracks: Track[], rates: Float64Array[], dt: number, W: number): void {
  tracks.forEach((tr, i) => {
    const r = rates[i];
    const v = tr.v;
    for (let s = 0; s < NS; s++) {
      if (!r[s]) continue;
      const m = Math.max(0, v.n[s] + roundRandom(moved(r, s, W, dt)));
      v.N += (m - v.n[s]) * SPECIES[s].size;
      v.n[s] = m;
    }
    if (r[HEAT]) v.Q = Math.max(0, v.Q + roundRandom(moved(r, HEAT, W, dt)));
    if (v.N <= 0) {
      v.N = 0;
      v.Q = 0;
    }
  });
}

/**
 * Sleep: windows and jumps as above, until the reservoir holds the goal, or the station stops delivering (lets
 * nothing into the reservoir for DELIVERY.gap sim seconds). It yields every SLEEP.piece sim seconds of the lab run as
 * ever, and after every jump, so it can be run a little each frame; it returns why it woke. `stats`, if given, is
 * kept up to date.
 */
export function* sleep(lab: Sleeper, stats: SleepStats = { plain: 0, jumped: 0, jumps: 0 }): Generator<void, Woke> {
  const { window: W, samples: K, piece } = SLEEP;
  const reservoir = lab.station.tanks[1];
  const woke = (): Woke | null =>
    reservoir.n[TARGET] >= GOAL_TARGET ? 'goal' : lab.station.sinceDelivery > DELIVERY.gap ? 'stopped' : null;
  // run the lab as ever for dt, a piece at a time
  function* run(dt: number): Generator<void, Woke | null> {
    for (let s = 0; s < dt - 1e-9; s += piece) {
      lab.advance(Math.min(piece, dt - s));
      stats.plain += Math.min(piece, dt - s);
      const why = woke();
      if (why) return why;
      yield;
    }
    return null;
  }
  let seen = new Map<Vessel, Seen>();
  for (;;) {
    const tracks: Track[] = lab.vessels().map((t) => ({ ...t, xs: [sample(t.v)] }));
    for (let k = 0; k < K; k++) {
      const why = yield* run(W / K);
      if (why) return why;
      tracks.forEach((tr) => tr.xs.push(sample(tr.v)));
    }
    const p = plan(tracks, W, seen, lab.clock() - W / 2, reservoir);
    seen = p.seen;
    // (nothing limits a jump only if nothing's changing, so nothing's being delivered either: wait for it to stop)
    if (p.dt < SLEEP.minJump * W || !Number.isFinite(p.dt)) continue;
    jump(tracks, p.rates, p.dt, W);
    lab.skip(p.dt);
    stats.jumped += p.dt;
    stats.jumps++;
    const why = woke();
    if (why) return why;
    yield;
    // a jump moves each species by its own rate, so whatever was in balance within a vessel (a fast reaction and its
    // reverse) is a little out of it: let that settle before measuring again
    const settled = yield* run(SLEEP.settle);
    if (settled) return settled;
  }
}

/** How long a sleep has gone on, for the player: "45 s", "12 min", "3 h 12 min", "1 day 4 h". */
export function sleptFor(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const [d, h, m] = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60];
  if (d > 0) return `${d} day${d === 1 ? '' : 's'}${h ? ` ${h} h` : ''}`;
  if (h > 0) return `${h} h${m ? ` ${m} min` : ''}`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}
