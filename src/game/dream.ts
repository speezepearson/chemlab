import { NS, SPECIES, TARGET } from '../chem/species';
import { roomFor, volume, type Vessel } from './flask';

/**
 * Fast-forwarding the lab while the player sleeps, by projection: a burst of the ordinary simulation, measured, then a
 * jump over as long as the lab can be trusted to go on as it was, then another burst, and so on (see Dream). All in
 * sim seconds.
 * - heal: how long each burst runs before it's measured, so what a jump left out of step (drops, the instruments, put-off
 *   chemistry) settles back.
 * - first, later: half the length of the measuring in a burst: the first of a run of steady bursts, and those after.
 * - every: how often the measuring samples every vessel.
 * - z: how many times its noise a rate has to be to count as moving at all.
 * - K: a jump is at most K times the time actually simulated since the lab went steady, or as long again as it's been
 *   steady, jumps and all, whichever is longer; so jumps double while it stays steady.
 * - most: the longest jump.
 * - share: in a jump, nothing changes by more than this share of the molecules in its vessel (bar the reference, which
 *   only fills), nor empties, nor fills its vessel, by more than half.
 * - curve, kink: in a jump, the change in a rate's projection from its own change stays under `curve` of its vessel,
 *   and the neglected next term under `kink`.
 * - trace: a species making up less than this share of its vessel is left as it is.
 * - slow: only a vessel that takes at least this long to turn over what it holds is moved on in a jump (see
 *   Tool.turnover); one quicker, like a funnel or a tank on a wide-open valve, settles back by itself as the next burst
 *   runs. Moving those on by their measured rates only adds their noise, and that can tip a line over the station's
 *   purity line.
 * - gap: no jump while a burst's longest wait between deliveries into the reference is more than this, well short of
 *   SUPPLY.gap, which wakes the player. A jump can't see a gap open, so it mustn't come near one.
 */
export const DREAM = {
  heal: 2,
  first: 10,
  later: 4,
  every: 0.5,
  z: 4,
  K: 4,
  most: 2000,
  share: 0.15,
  curve: 0.05,
  kink: 0.002,
  trace: 1e-6,
  slow: 200,
  gap: 1.5,
};

/** A least-squares line through each component of samples `xs` at times `ts`: its slope, and its scatter about it. */
interface Fit {
  rate: Float64Array;
  scatter: Float64Array;
  most: Float64Array;
}

function fit(xs: readonly Float64Array[], ts: readonly number[]): Fit {
  const m = ts.length;
  const D = xs[0].length;
  const tb = ts.reduce((a, b) => a + b, 0) / m;
  const stt = ts.reduce((a, t) => a + (t - tb) ** 2, 0);
  const rate = new Float64Array(D);
  const scatter = new Float64Array(D);
  const most = new Float64Array(D);
  for (let c = 0; c < D; c++) {
    let xb = 0;
    for (let i = 0; i < m; i++) xb += xs[i][c];
    xb /= m;
    let sxt = 0;
    for (let i = 0; i < m; i++) sxt += (xs[i][c] - xb) * (ts[i] - tb);
    const b = sxt / stt;
    let rss = 0;
    for (let i = 0; i < m; i++) {
      rss += (xs[i][c] - xb - b * (ts[i] - tb)) ** 2;
      most[c] = Math.max(most[c], Math.abs(xs[i][c]));
    }
    rate[c] = b;
    scatter[c] = Math.sqrt(rss / Math.max(1, m - 2));
  }
  return { rate, scatter, most };
}

/** A vessel's contents as numbers: each species' molecules, then its heat. */
function snap(v: Vessel): Float64Array {
  const x = new Float64Array(NS + 1);
  x.set(v.n);
  x[NS] = v.Q;
  return x;
}

/** What the last measured burst of a steady run found, for the next to compare against. */
interface Last {
  t: number;
  rates: Float64Array[];
  noise: Float64Array[];
  meanGap: number;
  /** How fast each rate was changing, from the burst before; absent after the first. */
  bend?: Float64Array[];
}

/**
 * The fast-forward of a sleeping lab (see DREAM): told after every substep of the ordinary simulation, it measures the
 * vessels in bursts, and when they're steady (every species and heat moving at a rate that holds from one burst to the
 * next, and within each), moves the slow ones on at once by as long as that can be trusted, projecting each rate as
 * it's been changing (and in what nothing drains, which feeds nothing back, just at its rate); the quick ones settle
 * back by themselves. It stops a burst short of the goal in the reference, so the ordinary simulation always takes it
 * the rest of the way, and the ship's checks see every substep that matters.
 *
 * Its vessels are fixed when it's made: the lab's arrangement doesn't change while the player sleeps.
 */
export class Dream {
  /** Sim seconds since it began, jumps included. */
  t = 0;
  /** How many jumps it's made, and the sim seconds they've skipped. */
  jumps = 0;
  skipped = 0;
  private phase: 'heal' | 'measure' = 'heal';
  private until = DREAM.heal;
  private half = DREAM.first;
  private nextSample = 0;
  private ts: number[] = [];
  private xs: Float64Array[][];
  /** When the target last went into the reference, and the waits between deliveries in this burst. */
  private lastDelivery = -Infinity;
  private gaps: number[] = [];
  /** The steady run so far: simulated time in it, when it began, the burst before, and the reference's pooled gain. */
  private age = 0;
  private from: number | null = null;
  private last: Last | null = null;
  private pool = { gain: 0, time: 0 };

  constructor(
    private readonly vessels: readonly Vessel[],
    /** How long each vessel takes to turn over what it holds, in sim seconds (see DREAM.slow). */
    private readonly turnover: readonly number[],
    /** The cryostabilizer reference, which only fills, and the target in it at which the player wins. */
    private readonly ref: Vessel,
    private readonly goal: number,
  ) {
    this.xs = vessels.map(() => []);
  }

  /**
   * After each substep of h sim seconds; `delivered` if the target went into the reference in it. Returns how many sim
   * seconds it's just jumped, having moved every vessel's contents on by that much (0 if it didn't), for the caller to
   * move its clocks on too.
   */
  after(h: number, delivered: boolean): number {
    this.t += h;
    if (delivered) {
      if (this.phase === 'measure' && this.lastDelivery > -Infinity) this.gaps.push(this.t - this.lastDelivery);
      this.lastDelivery = this.t;
    }
    if (this.phase === 'heal') {
      if (this.t < this.until - 1e-9) return 0;
      this.phase = 'measure';
      this.until = this.t + 2 * this.half;
      this.nextSample = this.t;
      this.ts = [];
      this.xs = this.vessels.map(() => []);
      this.gaps = [];
    }
    if (this.t >= this.nextSample - 1e-9) {
      this.ts.push(this.t);
      this.vessels.forEach((v, j) => this.xs[j].push(snap(v)));
      this.nextSample += DREAM.every;
    }
    if (this.t < this.until - 1e-9) return 0;
    const J = this.measure();
    this.phase = 'heal';
    this.until = this.t + DREAM.heal;
    return J;
  }

  /** At the end of a burst: whether the lab's steady, and if so, jump; returns how far. */
  private measure(): number {
    const { ts, xs, vessels } = this;
    const half = this.half;
    const span = ts[ts.length - 1] - ts[0];
    const mid = Math.floor(ts.length / 2);
    const gaps = [...this.gaps, this.t - this.lastDelivery];
    const longest = Math.max(...gaps);
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sdGap = gaps.length > 1 ? Math.sqrt(gaps.reduce((a, g) => a + (g - meanGap) ** 2, 0) / (gaps.length - 1)) : Infinity;
    const fits = xs.map((x) => ({ all: fit(x, ts), a: fit(x.slice(0, mid + 1), ts.slice(0, mid + 1)), b: fit(x.slice(mid), ts.slice(mid)) }));
    const z = DREAM.z * Math.SQRT2;
    // the noise in a rate over L sim seconds, from how much the fluid wobbles about its trend: its wobble is correlated
    // from sample to sample, so it's as if measured from the ends
    const noise = (scatter: number, L: number) => (z * scatter) / L;
    const noises = fits.map(({ all }) => all.scatter.map((s) => noise(s, span)));
    const last = this.last;
    let steady = true;
    let pending = false;
    const k = vessels.indexOf(this.ref);
    const moving = fits.map(({ all, a, b }, j) => {
      const on = new Uint8Array(NS + 1);
      const slow = j === k || this.turnover[j] >= DREAM.slow;
      let molecules = 0;
      for (let s = 0; s < NS; s++) molecules += all.most[s];
      for (let c = 0; c <= NS; c++) {
        const r = all.rate[c];
        if (all.most[c] === 0 || all.most[c] < DREAM.trace * (c === NS ? all.most[NS] : molecules)) continue;
        if (r === 0 || Math.abs(r) <= noise(all.scatter[c], span)) continue;
        // a drift counts once it's shown in two bursts running, alike; one alone may be the noise
        const was = last?.rates[j][c];
        const tol = 0.3 * Math.abs(r) + noise(all.scatter[c], span) + (last?.noise[j][c] ?? Infinity);
        if (was === undefined || Math.sign(was) !== Math.sign(r) || Math.abs(was - r) > tol) {
          if (slow && (Math.abs(r) > 1e-3 * molecules || !last)) pending = true;
          continue;
        }
        on[c] = slow ? 1 : 0;
        // and holds within the burst: its two halves agree
        if (Math.abs(a.rate[c] - b.rate[c]) > 2 * noise(all.scatter[c], span / 2) + 0.1 * Math.abs(r)) steady = false;
      }
      return on;
    });
    const dt = DREAM.heal + span;
    if (!steady || longest > DREAM.gap) {
      this.age = 0;
      this.from = null;
      this.last = null;
      this.pool = { gain: 0, time: 0 };
      this.half = DREAM.first;
      return 0;
    }
    this.age += dt;
    this.from ??= this.t - dt;
    this.half = DREAM.later;
    let J = Math.min(DREAM.most, Math.max(DREAM.K * this.age, this.t - this.from));
    const limit = (x: number) => {
      if (x < J) J = x;
    };
    // nothing but the reference moving: its gain is pooled over every burst of the run
    const drifting = moving.some((on, j) => j !== k && on.some((x) => x));
    const xr = xs[k];
    this.pool.gain += xr[xr.length - 1][TARGET] - xr[0][TARGET];
    this.pool.time += span;
    if (drifting) this.pool = { gain: 0, time: 0 };
    else fits[k].all.rate[TARGET] = this.pool.gain / this.pool.time;
    const since = last ? this.t - last.t : 0;
    // how each rate's been changing, from the burst before, and how that's been changing, from the one before that: only
    // where the change stands clear of the noise, else not at all
    const bend = last
      ? fits.map((f, j) => f.all.rate.map((r, c) => (Math.abs(r - last.rates[j][c]) > noises[j][c] + last.noise[j][c] ? (r - last.rates[j][c]) / since : 0)))
      : undefined;
    const lb = last?.bend;
    const kink =
      bend && lb
        ? bend.map((b, j) =>
            b.map((x, c) => (x && lb[j][c] && Math.abs(x - lb[j][c]) * since > 2 * (noises[j][c] + last!.noise[j][c]) ? (x - lb[j][c]) / since : 0)),
          )
        : undefined;
    vessels.forEach((v, j) => {
      const r = fits[j].all.rate;
      let molecules = 0;
      for (let s = 0; s < NS; s++) molecules += v.n[s];
      const scale = Math.max(molecules, 1);
      let grows = 0;
      for (let c = 0; c <= NS; c++) {
        if (!moving[j][c]) continue;
        const x = c === NS ? v.Q : v.n[c];
        if (c < NS) grows += r[c] * roomFor(c);
        // nothing much of its vessel empties by more than half (a trace may run out: it's floored at none)
        if (r[c] < 0 && x > (c === NS ? 0 : 1e-3 * scale)) limit((0.5 * x) / -r[c]);
        // the reference, and a vessel nothing drains (a flask, a tank shut), feeds nothing back into the line: it's
        // only moved on at its rate, and can't hold a jump back but by running out or over
        if (j === k || this.turnover[j] === Infinity) continue;
        if (c < NS) limit((DREAM.share * scale) / Math.abs(r[c]));
        if (bend?.[j][c]) limit(Math.sqrt((2 * DREAM.curve * scale) / Math.abs(bend[j][c])));
        if (kink?.[j][c]) limit(Math.cbrt((6 * DREAM.kink * scale) / Math.abs(kink[j][c])));
      }
      if (j !== k && grows > 0) limit((0.5 * Math.max(0, v.cap - volume(v))) / grows);
    });
    // land a burst short of the goal, for the ordinary simulation to reach it
    const gain = fits[k].all.rate[TARGET];
    if (gain > 0) limit((this.goal - this.ref.n[TARGET]) / gain - (DREAM.heal + 2 * DREAM.later));
    // and nowhere near where the waits between deliveries could reach DREAM.gap
    if (last && meanGap > last.meanGap) limit((0.5 * (DREAM.gap - (meanGap + 6 * sdGap))) / ((meanGap - last.meanGap) / since));
    this.last = { t: this.t, rates: fits.map((f) => f.all.rate), noise: noises, meanGap, bend };
    if (pending || !(J > dt)) return 0;
    this.jump(J, fits.map((f) => f.all.rate), moving, drifting ? bend : undefined, drifting ? kink : undefined, since, half);
    return J;
  }

  /**
   * Move every moving component on by J: by its rate, measured at the middle of the burst, `half` ago, and as that rate
   * has been bending (a Taylor series to the third order about that middle).
   */
  private jump(J: number, rates: Float64Array[], moving: Uint8Array[], bend: Float64Array[] | undefined, kinks: Float64Array[] | undefined, since: number, half: number): void {
    const k = this.vessels.indexOf(this.ref);
    this.vessels.forEach((v, j) => {
      let any = false;
      for (let c = 0; c <= NS; c++) {
        if (!moving[j][c]) continue;
        const r = rates[j][c];
        // the reference only fills, at the rate measured, as does whatever nothing drains: their rates' changes come of
        // the rest, already measured there
        const sink = j === k || this.turnover[j] === Infinity;
        const b = sink ? 0 : (bend?.[j][c] ?? 0);
        const kink = sink ? 0 : (kinks?.[j][c] ?? 0);
        // the bend is a backward difference, centred half the time between bursts before now
        const bc = b + (kink * since) / 2;
        const integral = (t: number) => r * t + (bc * t * t) / 2 + (kink * t * t * t) / 6;
        const d = Math.round(integral(half + J) - integral(half));
        if (!d) continue;
        any = true;
        if (c === NS) v.Q = Math.max(0, v.Q + d);
        else v.n[c] = Math.max(0, v.n[c] + d);
      }
      if (!any) return;
      let N = 0;
      for (let s = 0; s < NS; s++) N += v.n[s] * SPECIES[s].size;
      v.N = N;
    });
    this.t += J;
    this.lastDelivery += J;
    this.jumps++;
    this.skipped += J;
  }
}
