import { describe, expect, it } from 'vitest';
import { SPECIES, singleOf } from '../chem/species';
import { CAP } from './config';
import { Vessel } from './flask';
import { MAX_FLOW, TANK_CAP, Tool, equilibrate, mouthBelow, type Mouth } from './tools';

const R = singleOf('R');
const G = singleOf('G');
const atomTotal = (v: { n: Float64Array }) => SPECIES.reduce((t, s) => t + v.n[s.i] * s.size, 0);

function filled(v: Vessel, species: number, atoms: number, T: number): Vessel {
  v.setMolecules(species, atoms / SPECIES[species].size);
  v.T = T;
  return v;
}

describe('dispenser', () => {
  it('dispenses valve × MAX_FLOW atoms per sim second', () => {
    const d = new Tool('dispenser', 0, 0, 0, 0.5);
    filled(d.tanks[0], R, 2 * CAP, 3);
    const out = d.step(0.1)!;
    expect(out.N).toBeCloseTo(0.5 * MAX_FLOW * 0.1);
    expect(out.T).toBe(3);
    expect(d.tanks[0].N).toBeCloseTo(2 * CAP - out.N);
    expect(atomTotal(out) + atomTotal(d.tanks[0])).toBeCloseTo(2 * CAP);
  });

  it('dispenses nothing when closed or empty', () => {
    const d = new Tool('dispenser', 0, 0, 0, 0);
    filled(d.tanks[0], R, CAP, 1);
    expect(d.step(0.1)).toBeNull();
    expect(d.tanks[0].N).toBe(CAP);
    d.valve = 1;
    d.tanks[0].setMolecules(R, 0);
    expect(d.step(0.1)).toBeNull();
  });

  it('empties completely rather than leaving a trace behind', () => {
    const d = new Tool('dispenser', 0, 0, 0, 1);
    filled(d.tanks[0], R, CAP, 1);
    let total = 0;
    for (let i = 0; i < 200; i++) total += d.step(0.01)?.N ?? 0;
    expect(d.tanks[0].N).toBe(0);
    expect(total).toBeCloseTo(CAP);
  });

  it('holds several flasks', () => {
    expect(TANK_CAP).toBeGreaterThanOrEqual(3 * CAP);
  });
});

describe('heat exchanger', () => {
  it('sends feed out at the bath temperature, conserving heat and keeping the fluids apart', () => {
    const x = new Tool('exchanger', 0, 0, 0, 1);
    const [feed, bath] = x.tanks;
    filled(feed, R, CAP, 10);
    filled(bath, G, 3 * CAP, 1);
    const out = x.step(0.05)!;
    expect(out.T).toBeCloseTo(bath.T);
    // heat is conserved: what the feed lost, the bath gained
    expect(out.N * out.T + bath.N * bath.T).toBeCloseTo(out.N * 10 + 3 * CAP * 1, 0);
    expect(out.n[G]).toBe(0);
    expect(bath.n[R]).toBe(0);
    expect(bath.N).toBe(3 * CAP);
  });

  it('warms the bath toward the feed temperature as it runs', () => {
    const x = new Tool('exchanger', 0, 0, 0, 0.5);
    const [feed, bath] = x.tanks;
    filled(feed, R, CAP, 10);
    filled(bath, G, CAP, 1);
    const temps: number[] = [];
    for (let i = 0; i < 400 && feed.N > 0; i++) temps.push(x.step(0.01)!.T);
    // continuous exchange: bath T = T_feed + (T_bath0 − T_feed)·e^(−passed / bath size)
    expect(bath.T).toBeCloseTo(10 - 9 * Math.exp(-1), 1);
    for (let i = 1; i < temps.length; i++) expect(temps[i]).toBeGreaterThan(temps[i - 1]);
  });

  it('passes feed through unchanged with an empty bath', () => {
    const x = new Tool('exchanger', 0, 0, 0, 1);
    filled(x.tanks[0], R, CAP, 7);
    expect(x.step(0.05)!.T).toBe(7);
  });
});

describe('equilibrate', () => {
  it('meets at the atom-weighted mean temperature', () => {
    const a = { n: new Float64Array(1), N: 100, T: 1 };
    const b = { n: new Float64Array(1), N: 300, T: 5 };
    equilibrate(a, b);
    expect(a.T).toBe(4);
    expect(b.T).toBe(4);
  });
});

describe('mouthBelow', () => {
  const v = new Vessel(CAP);
  const mouths: Mouth[] = [
    { v, x0: 0, x1: 10, y: 100 },
    { v, x0: 0, x1: 10, y: 50 },
    { v, x0: 20, x1: 30, y: 40 },
  ];

  it('finds the highest mouth below the point', () => {
    expect(mouthBelow(mouths, { x: 5, y: 0 })).toBe(mouths[1]);
    expect(mouthBelow(mouths, { x: 5, y: 60 })).toBe(mouths[0]);
  });

  it('ignores mouths above or to the side', () => {
    expect(mouthBelow(mouths, { x: 5, y: 120 })).toBeNull();
    expect(mouthBelow(mouths, { x: 15, y: 0 })).toBeNull();
  });
});
