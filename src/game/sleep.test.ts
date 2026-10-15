import { describe, expect, it } from 'vitest';
import { roundRandom } from '../chem/reactions';
import { TARGET } from '../chem/species';
import { CAP, DELIVERY, GOAL_TARGET, SUSTAIN } from './config';
import { Vessel } from './flask';
import { SLEEP, sleep, sleptFor, type SleepStats, type Sleeper, type Woke } from './sleep';
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

function run(l: Sleeper): { woke: Woke; stats: SleepStats } {
  const stats = { plain: 0, jumped: 0, jumps: 0 };
  const it = sleep(l, stats);
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

  it('says how long it has gone on', () => {
    expect(sleptFor(45.9)).toBe('45 s');
    expect(sleptFor(12 * 60 + 5)).toBe('12 min');
    expect(sleptFor(3 * 3600)).toBe('3 h');
    expect(sleptFor(3 * 3600 + 12 * 60)).toBe('3 h 12 min');
    expect(sleptFor(86400 + 4 * 3600 + 59)).toBe('1 day 4 h');
    expect(sleptFor(2 * 86400)).toBe('2 days');
  });
});
