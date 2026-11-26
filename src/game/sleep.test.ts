import { describe, expect, it } from 'vitest';
import { roundRandom } from '../chem/reactions';
import { SPECIES, TARGET, singleOf } from '../chem/species';
import { CAP, DELIVERY, GOAL_TARGET, SUSTAIN } from './config';
import { Vessel } from './flask';
import { SLEEP, sleep, sleptFor, type SleepStats, type Sleeper, type Woke } from './sleep';
import { FIRST_SUPPLY } from './supply';
import { Tool } from './tools';

/**
 * A stand-in for the lab: a supply tank draining into the station's reservoir, as the station would let it in,
 * keeping the station's time since it last delivered. Over dt it lets out about drain(what it holds, dt), and never
 * more than it holds.
 */
function lab(supply: number, drain: (n: number, dt: number) => number, reservoir: number) {
  const station = new Tool('receptacle', 0);
  const tank = new Vessel(Infinity);
  tank.setMolecules(TARGET, supply);
  station.tanks[1].setMolecules(TARGET, reservoir);
  let clock = 0;
  const l: Sleeper = {
    vessels: () => [
      { v: tank, terminal: false },
      { v: station.tanks[1], terminal: true },
    ],
    station,
    clock: () => clock,
    advance(dt) {
      clock += dt;
      const m = Math.min(tank.n[TARGET], roundRandom(drain(tank.n[TARGET], dt)));
      tank.setMolecules(TARGET, tank.n[TARGET] - m);
      station.tanks[1].setMolecules(TARGET, station.tanks[1].n[TARGET] + m);
      station.sinceDelivery = m > 0 ? 0 : station.sinceDelivery + dt;
    },
    skip(dt) {
      clock += dt;
    },
  };
  return { l, tank, station, now: () => clock };
}

/** A share k of what it holds each sim second, as a tank drains through a valve. */
const share = (k: number) => (n: number, dt: number) => n * k * dt;

function run(l: Sleeper, nap = false): { woke: Woke; stats: SleepStats } {
  const stats = { plain: 0, jumped: 0, jumps: 0 };
  const it = sleep(l, stats, nap);
  for (let i = 0; i < 1e7; i++) {
    const r = it.next();
    if (r.done) return { woke: r.value, stats };
  }
  throw new Error('never woke');
}

describe('sleep', () => {
  it('jumps through a steady delivery to the goal, at the time it would have got there', () => {
    // a supply far bigger than what's delivered, so it's delivered at a near-constant rate
    const k = 1e-6;
    const supply = 1000 * CAP;
    const start = GOAL_TARGET - 50 * CAP;
    const { l, station, now } = lab(supply, share(k), start);
    const { woke, stats } = run(l);
    expect(woke).toBe('goal');
    expect(station.tanks[1].n[TARGET]).toBeGreaterThanOrEqual(GOAL_TARGET);
    // when it got there: Δ = −ln(1 − 50/1000) / k
    expect(Math.abs(now() / (-Math.log(1 - 50 / 1000) / k) - 1)).toBeLessThan(0.015);
    // nearly all of it jumped
    expect(stats.plain).toBeLessThan(0.02 * now());
  });

  it('wakes once a supply running down delivers less than the passengers use', () => {
    // a supply draining away with a time constant of 1000 sim s, which falls short once it holds less than SUSTAIN / k
    const k = 1e-3;
    const { l, tank, station, now } = lab(CAP, share(k), 0);
    const { woke, stats } = run(l);
    expect(woke).toBe('stopped');
    // over the last SLEEP.sustain, it delivered less than SUSTAIN a sim second, on average
    const short = SUSTAIN / k;
    expect(tank.n[TARGET]).toBeLessThan(short);
    expect(tank.n[TARGET]).toBeGreaterThan(short * Math.exp(-k * SLEEP.sustain) * 0.8);
    // and no more reached the reservoir than the supply held
    expect(station.tanks[1].n[TARGET] + tank.n[TARGET]).toBeLessThanOrEqual(CAP * (1 + 1e-6));
    // when the plain sim would have: ln(1e9 / short) time constants, give or take the minute it's averaged over
    const when = Math.log(CAP / short) / k;
    expect(now()).toBeGreaterThan(when);
    expect(now()).toBeLessThan(when + 2 * SLEEP.sustain);
    expect(stats.jumped).toBeGreaterThan(stats.plain);
  });

  it(`wakes once it's delivered less than the passengers use over ${SLEEP.sustain} sim s, however often`, () => {
    // something every substep, so never a gap, but half what's used up
    const { l, now } = lab(1e15, (_, dt) => (SUSTAIN / 2) * dt, 0);
    expect(run(l).woke).toBe('stopped');
    expect(now()).toBeGreaterThanOrEqual(SLEEP.sustain);
    expect(now()).toBeLessThan(SLEEP.sustain + 1);
  });

  it('sleeps on to the goal while it delivers more than the passengers use', () => {
    const { l } = lab(1e15, (_, dt) => 2 * SUSTAIN * dt, GOAL_TARGET - 1e9);
    expect(run(l).woke).toBe('goal');
  });

  it("doesn't overshoot a supply that drains steadily until it suddenly runs out", () => {
    // a tank letting out a fixed rate however full it is, so nothing about it changes until the moment it's empty,
    // 1e5 sim s in
    const rate = 1e5;
    const supply = 1e5 * rate;
    const { l, tank, station, now } = lab(supply, (_, dt) => rate * dt, 0);
    const { woke, stats } = run(l);
    expect(woke).toBe('stopped');
    expect(tank.n[TARGET]).toBe(0);
    // what reached the reservoir is what the tank held, give or take the rounding of whole molecules
    expect(Math.abs(station.tanks[1].n[TARGET] / supply - 1)).toBeLessThan(1e-6);
    // it woke when it ran out, not before or long after: no jump went past it, and the running out was seen in a
    // window, run as ever, within DELIVERY.gap of it
    expect(now()).toBeGreaterThan(supply / rate);
    expect(now()).toBeLessThan(supply / rate + DELIVERY.gap + 1);
    // and still, most of the way there was jumped
    expect(stats.jumped).toBeGreaterThan(0.8 * now());
  });

  it('wakes at once if nothing is being delivered', () => {
    const { l, now } = lab(0, share(1e-3), 0);
    expect(run(l).woke).toBe('stopped');
    expect(now()).toBeLessThanOrEqual(DELIVERY.gap + 0.5);
  });

  it("sleeps to the goal of whatever the station is fitted for", () => {
    const { l, station, tank } = lab(0, share(1e-3), 0);
    station.stock(FIRST_SUPPLY);
    const { species, goal, start } = FIRST_SUPPLY;
    const supply = 2 * (goal - start);
    tank.setMolecules(species, supply);
    // the stand-in lab moves the cryostabilizer: have it move what the station's fitted for instead
    l.advance = (dt) => {
      const m = Math.min(tank.n[species], roundRandom(tank.n[species] * 1e-3 * dt));
      tank.n[species] -= m;
      tank.N -= 2 * m;
      station.tanks[1].n[species] += m;
      station.tanks[1].N += 2 * m;
      station.sinceDelivery = m > 0 ? 0 : station.sinceDelivery + dt;
      l.skip(dt);
    };
    expect(run(l).woke).toBe('goal');
    expect(station.tanks[1].n[species]).toBeGreaterThanOrEqual(goal);
    expect(station.tanks[1].n[species]).toBeLessThan(goal + 0.01 * supply);
  });

  it('naps on though nothing is being delivered, until the goal', () => {
    // nothing for long past DELIVERY.gap and SLEEP.sustain, and then all at once enough
    let clock = 0;
    const { l, station } = lab(0, share(1e-3), GOAL_TARGET - 1e9);
    l.advance = (dt) => {
      clock += dt;
      if (clock > 3 * SLEEP.sustain) station.tanks[1].setMolecules(TARGET, GOAL_TARGET + 1);
    };
    l.clock = () => clock;
    expect(run(l, true).woke).toBe('goal');
    expect(clock).toBeGreaterThan(3 * SLEEP.sustain);
  });

  it('naps on past a goal that was already met, jumping ahead while a line runs', () => {
    const { l, station, now } = lab(1e15, (_, dt) => 1e6 * dt, GOAL_TARGET + 1e9);
    const stats = { plain: 0, jumped: 0, jumps: 0 };
    const it = sleep(l, stats, true);
    for (let i = 0; i < 2000 && !stats.jumps; i++) expect(it.next().done).toBe(false);
    // it jumps as soon as the delivery is seen to be steady, a long way, and doesn't wake
    expect(stats.jumps).toBe(1);
    expect(stats.jumped).toBeGreaterThan(10 * stats.plain);
    expect(it.next().done).toBe(false);
    // what it jumped through reached the reservoir as it would have
    expect(Math.abs((station.tanks[1].n[TARGET] - GOAL_TARGET - 1e9) / (1e6 * now()) - 1)).toBeLessThan(0.01);
  });

  it("doesn't follow what the station's fitted for slowly breaking down in its reservoir", () => {
    // nothing delivered: the reservoir's own supply comes apart into its atoms, a hundred-billionth of it a sim
    // second, as it does on its way to equilibrium, which is far too slow to matter
    const { l, station, now } = lab(0, share(1e-3), 0);
    station.stock(FIRST_SUPPLY);
    const { species, start } = FIRST_SUPPLY;
    const ref = station.tanks[1];
    const parts = SPECIES[species].atoms.map(singleOf);
    const k = 1.4e-10;
    l.advance = (dt) => {
      const m = roundRandom(ref.n[species] * k * dt);
      ref.n[species] -= m;
      for (const s of parts) ref.n[s] += m;
      l.skip(dt);
    };
    const it = sleep(l, { plain: 0, jumped: 0, jumps: 0 }, true);
    for (let i = 0; i < 4000; i++) expect(it.next().done).toBe(false);
    // no more of it is gone than came apart, and all of that is still there as atoms
    expect(start - ref.n[species]).toBeLessThan(2 * k * start * now());
    for (const s of parts) expect(ref.n[species] + ref.n[s]).toBe(start);
  });

  it("doesn't take a stray drop for a delivery still coming in", () => {
    // nothing's delivered, and what's in the reservoir is coming apart, a clump at a time, fast enough to follow; and
    // in the middle of a window (after `at` sim s run as ever, jumps aside), one big drop of it lands, as the last
    // one hanging from a spout does
    const [k, clump, drop, at] = [1.4e-6, 100, 1e7, 80];
    const { l, station, now } = lab(0, share(1e-3), 0);
    const ref = station.tanks[1];
    ref.setMolecules(TARGET, 1.4e9);
    const parts = SPECIES[TARGET].atoms.map(singleOf);
    // how many clumps, of a mean: Poisson's
    const clumps = (mean: number) => {
      let [n, p] = [0, Math.random()];
      for (const floor = Math.exp(-mean); p > floor; p *= Math.random()) n++;
      return n;
    };
    let [fell, ran] = [0, 0];
    l.advance = (dt) => {
      l.skip(dt);
      ran += dt;
      const m = clump * clumps((ref.n[TARGET] * k * dt) / clump);
      ref.n[TARGET] -= m;
      for (const s of parts) ref.n[s] += m;
      if (!fell && ran >= at) {
        ref.setMolecules(TARGET, ref.n[TARGET] + drop);
        fell = ref.n[TARGET];
      }
    };
    const it = sleep(l, { plain: 0, jumped: 0, jumps: 0 }, true);
    let most = 0;
    while (now() < 20_000) {
      expect(it.next().done).toBe(false);
      most = Math.max(most, ref.n[TARGET]);
    }
    // there's never more of it than once the drop had landed: no jump went on as if more were coming
    expect(fell).toBeGreaterThan(0);
    expect(most).toBe(fell);
  });

  it('says how long it has gone on', () => {
    expect(sleptFor(45.9)).toBe('00:00:00:45');
    expect(sleptFor(12 * 60 + 5)).toBe('00:00:12:05');
    expect(sleptFor(3 * 3600 + 12 * 60)).toBe('00:03:12:00');
    expect(sleptFor(86400 + 4 * 3600 + 59)).toBe('01:04:00:59');
    expect(sleptFor(123 * 86400)).toBe('123:00:00:00');
  });
});
