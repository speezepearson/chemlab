import { describe, expect, it } from 'vitest';
import { SPECIES, singleOf } from '../chem/species';
import { CAP } from './config';
import { Vessel } from './flask';
import { EXCHANGE_RATE, HOSE_CAP, Hose, MAX_FLOW, PUMP_RATE, TANK_CAP, Tool, counterflow, mouthBelow, separate, type Mouth } from './tools';

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
    const d = new Tool('dispenser', 0, 0, 0, [0.5]);
    filled(d.tanks[0], R, 2 * CAP, 3);
    const out = d.step(0.1)[0]!;
    expect(out.N).toBeCloseTo(0.5 * MAX_FLOW * 0.1);
    expect(out.T).toBe(3);
    expect(d.tanks[0].N).toBeCloseTo(2 * CAP - out.N);
    expect(atomTotal(out) + atomTotal(d.tanks[0])).toBeCloseTo(2 * CAP);
  });

  it('starts closed, and dispenses nothing when closed or empty', () => {
    const d = new Tool('dispenser', 0, 0, 0);
    filled(d.tanks[0], R, CAP, 1);
    expect(d.step(0.1)).toEqual([null]);
    expect(d.tanks[0].N).toBe(CAP);
    d.valves[0] = 1;
    d.tanks[0].setMolecules(R, 0);
    expect(d.step(0.1)).toEqual([null]);
  });

  it('empties completely rather than leaving a trace behind', () => {
    const d = new Tool('dispenser', 0, 0, 0, [1]);
    filled(d.tanks[0], R, CAP, 1);
    let total = 0;
    for (let i = 0; i < 200; i++) total += d.step(0.01)[0]?.N ?? 0;
    expect(d.tanks[0].N).toBe(0);
    expect(total).toBeCloseTo(CAP);
  });

  it('holds several flasks', () => {
    expect(TANK_CAP).toBeGreaterThanOrEqual(3 * CAP);
  });
});

describe('heat exchanger', () => {
  function run(valves: number[], TA = 10, TB = 1) {
    const x = new Tool('exchanger', 0, 0, 0, valves);
    filled(x.tanks[0], R, CAP, TA);
    filled(x.tanks[1], G, CAP, TB);
    return x.step(0.05);
  }

  it('trades heat between the streams without mixing them, conserving heat', () => {
    const [a, b] = run([0.5, 0.5]);
    expect(a!.T).toBeLessThan(10);
    expect(b!.T).toBeGreaterThan(1);
    expect(a!.N * a!.T + b!.N * b!.T).toBeCloseTo(a!.N * 10 + b!.N * 1);
    expect(a!.n[G]).toBe(0);
    expect(b!.n[R]).toBe(0);
  });

  it('nearly swaps the temperatures of equal slow streams, and trades less at speed', () => {
    const [slowA] = run([0.1, 0.1]);
    const [fastA] = run([1, 1]);
    // ε = NTU / (1 + NTU), NTU = EXCHANGE_RATE / flow
    const eff = (flow: number) => (EXCHANGE_RATE / flow) / (1 + EXCHANGE_RATE / flow);
    expect(slowA!.T).toBeCloseTo(10 - 9 * eff(0.1 * MAX_FLOW));
    expect(fastA!.T).toBeCloseTo(10 - 9 * eff(MAX_FLOW));
    expect(slowA!.T).toBeLessThan(2);
    expect(fastA!.T).toBeGreaterThan(slowA!.T);
  });

  it('brings a slow stream close to the inlet temperature of a fast one, and never overshoots', () => {
    const [a, b] = run([0.05, 1]);
    expect(a!.T).toBeCloseTo(1, 1);
    expect(a!.T).toBeGreaterThanOrEqual(1);
    expect(b!.T).toBeLessThanOrEqual(10);
    const [a2, b2] = run([1, 0.05]);
    expect(b2!.T).toBeCloseTo(10, 1);
    expect(b2!.T).toBeLessThanOrEqual(10);
    expect(a2!.T).toBeGreaterThanOrEqual(1);
  });

  it('passes one stream through unchanged while the other is shut', () => {
    const [a, b] = run([1, 0]);
    expect(a!.T).toBe(10);
    expect(b).toBeNull();
  });
});

describe('counterflow', () => {
  it('does nothing with an empty side', () => {
    const a = { n: new Float64Array(1), N: 100, T: 1 };
    const b = { n: new Float64Array(1), N: 0, T: 5 };
    counterflow(a, b, 1000);
    expect(a.T).toBe(1);
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

describe('separator', () => {
  const B = singleOf('B');
  const Y = singleOf('Y');
  const tri = (name: string) => SPECIES.find((s) => s.name === name)!.i;

  it('splits each species left : right as e^primaries : e^secondaries', () => {
    const f = new Vessel(Infinity);
    for (const s of [R, singleOf('C'), tri('△RGB'), tri('△RGY'), tri('R–M–B')]) f.n[s] = 1;
    f.N = atomTotal(f);
    const [l, r] = separate(f);
    expect(l.n[R] / r.n[R]).toBeCloseTo(Math.E);
    expect(l.n[singleOf('C')] / r.n[singleOf('C')]).toBeCloseTo(1 / Math.E);
    expect(l.n[tri('△RGB')] / r.n[tri('△RGB')]).toBeCloseTo(Math.exp(3));
    expect(l.n[tri('△RGY')] / r.n[tri('△RGY')]).toBeCloseTo(Math.exp(2 - 1));
    expect(l.n[tri('R–M–B')] / r.n[tri('R–M–B')]).toBeCloseTo(Math.exp(2 - 1));
    expect(l.N + r.N).toBeCloseTo(f.N);
    expect(l.N).toBeCloseTo(atomTotal(l));
  });

  it('drains its tank at the valve rate, out of both spouts, keeping the temperature', () => {
    const x = new Tool('separator', 0, 0, 0, [0.5]);
    filled(x.tanks[0], B, CAP, 3);
    x.tanks[0].setMolecules(Y, CAP);
    const [l, r] = x.step(0.1);
    expect(l!.N + r!.N).toBeCloseTo(0.5 * MAX_FLOW * 0.1);
    expect(l!.T).toBe(3);
    // B leaves left e : 1, Y leaves left 1 : e, so from equal amounts the left outlet is e : 1 B to Y
    expect(l!.n[B] / l!.n[Y]).toBeCloseTo(Math.E);
    expect(r!.n[Y] / r!.n[B]).toBeCloseTo(Math.E);
    expect(x.flow[0] + x.flow[1]).toBeCloseTo(0.5);
  });
});

describe('hose', () => {
  it('pumps what falls in its funnel out of its outlet, up to PUMP_RATE', () => {
    const hose = new Hose({ x: 0, y: 0 }, { x: 1, y: 1 });
    const src = filled(new Vessel(CAP), R, CAP, 2);
    hose.funnel.addFrom(src, HOSE_CAP * 2); // more than it holds: the rest overflows
    expect(hose.funnel.N).toBe(HOSE_CAP);
    const out = hose.step(0.01)!;
    expect(out.N).toBeCloseTo(PUMP_RATE * 0.01);
    expect(out.T).toBe(2);
    expect(hose.funnel.N).toBeCloseTo(HOSE_CAP - PUMP_RATE * 0.01);
    expect(PUMP_RATE).toBeGreaterThan(MAX_FLOW);
  });
});
