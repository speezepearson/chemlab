import { describe, expect, it } from 'vitest';
import { SPECIES, singleOf } from '../chem/species';
import { CAP } from './config';
import { heatAt, temperature } from '../chem/reactions';
import { Vessel } from './flask';
import {
  DRIP_FLOW, EXCHANGE_RATE, FUNNEL_CAP, FUNNEL_RATE, HOSE_CAP, Hose, MAX_FLOW, PUMP_RATE, TANK_CAP, Tool, counterflow,
  drip, dropRate, mouthBelow, separate, type Mouth,
} from './tools';

const R = singleOf('R');
const G = singleOf('G');
const atomTotal = (v: { n: Float64Array }) => SPECIES.reduce((t, s) => t + v.n[s.i] * s.size, 0);

function filled(v: Vessel, species: number, atoms: number, T: number): Vessel {
  v.setMolecules(species, atoms / SPECIES[species].size);
  v.setTemperature(T);
  return v;
}

describe('dispenser', () => {
  it('dispenses valve × MAX_FLOW atoms per sim second', () => {
    const d = new Tool('dispenser', 0, 0, 0, [0.5]);
    filled(d.tanks[0], R, 2 * CAP, 3);
    const out = d.step(0.1)[0]!;
    // whole molecules, so right to within a few parts per billion
    expect(out.N / (0.5 * MAX_FLOW * 0.1)).toBeCloseTo(1, 6);
    expect(temperature(out)).toBeCloseTo(3, 6);
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
    expect(total / CAP).toBeCloseTo(1, 5);
  });

  it('holds several flasks', () => {
    expect(TANK_CAP).toBeGreaterThanOrEqual(3 * CAP);
  });
});

describe('splitter', () => {
  function run(valve: number | undefined) {
    const sp = new Tool('splitter', 0, 0, 0, valve === undefined ? [] : [valve]);
    filled(sp.tanks[0], R, FUNNEL_CAP, 4);
    const [l, r] = sp.step(0.05);
    return { sp, l, r };
  }

  it('drains its funnel at FUNNEL_RATE, whatever the valve says', () => {
    for (const v of [0, 0.3, 1]) {
      const { sp, l, r } = run(v);
      const out = (l?.N ?? 0) + (r?.N ?? 0);
      expect(out / (FUNNEL_RATE * 0.05)).toBeCloseTo(1, 6);
      expect(out + sp.tanks[0].N).toBe(FUNNEL_CAP);
    }
  });

  it('sends everything left with the valve at 0, and everything right at 1', () => {
    expect(run(0).r).toBeNull();
    expect(run(1).l).toBeNull();
  });

  it('starts split evenly, and splits in proportion to the valve, heat with it', () => {
    const even = run(undefined);
    expect(even.sp.valves[0]).toBe(0.5);
    expect(even.l!.N / even.r!.N).toBeCloseTo(1, 3);
    const { l, r } = run(0.25);
    expect(r!.N / (l!.N + r!.N)).toBeCloseTo(0.25, 3);
    expect(temperature(l!)).toBeCloseTo(4, 3);
    expect(temperature(r!)).toBeCloseTo(4, 3);
  });

  it('holds only a little', () => {
    expect(new Tool('splitter', 0, 0, 0).tanks[0].cap).toBe(FUNNEL_CAP);
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
    expect(temperature(a!)).toBeLessThan(10);
    expect(temperature(b!)).toBeGreaterThan(1);
    expect((a!.N * temperature(a!) + b!.N * temperature(b!)) / (a!.N * 10 + b!.N * 1)).toBeCloseTo(1, 6);
    expect(a!.n[G]).toBe(0);
    expect(b!.n[R]).toBe(0);
  });

  it('nearly swaps the temperatures of equal slow streams, and trades less at speed', () => {
    const [slowA] = run([0.1, 0.1]);
    const [fastA] = run([1, 1]);
    // ε = NTU / (1 + NTU), NTU = EXCHANGE_RATE / flow
    const eff = (flow: number) => (EXCHANGE_RATE / flow) / (1 + EXCHANGE_RATE / flow);
    expect(temperature(slowA!)).toBeCloseTo(10 - 9 * eff(0.1 * MAX_FLOW));
    expect(temperature(fastA!)).toBeCloseTo(10 - 9 * eff(MAX_FLOW));
    expect(temperature(slowA!)).toBeLessThan(2);
    expect(temperature(fastA!)).toBeGreaterThan(temperature(slowA!));
  });

  it('brings a slow stream close to the inlet temperature of a fast one, and never overshoots', () => {
    const [a, b] = run([0.05, 1]);
    expect(temperature(a!)).toBeCloseTo(1, 1);
    expect(temperature(a!)).toBeGreaterThanOrEqual(1);
    expect(temperature(b!)).toBeLessThanOrEqual(10);
    const [a2, b2] = run([1, 0.05]);
    expect(temperature(b2!)).toBeCloseTo(10, 1);
    expect(temperature(b2!)).toBeLessThanOrEqual(10);
    expect(temperature(a2!)).toBeGreaterThanOrEqual(1);
  });

  it('passes one stream through unchanged while the other is shut', () => {
    const [a, b] = run([1, 0]);
    expect(temperature(a!)).toBeCloseTo(10, 6);
    expect(b).toBeNull();
  });
});

describe('counterflow', () => {
  it('does nothing with an empty side', () => {
    const a = { n: new Float64Array(1), N: 100, Q: heatAt(1, 100) };
    const b = { n: new Float64Array(1), N: 0, Q: 0 };
    counterflow(a, b, 1000);
    expect(temperature(a)).toBe(1);
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
    for (const s of [R, singleOf('C'), tri('△RGB'), tri('△RGY'), tri('R–M–B')]) f.n[s] = CAP;
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
    expect((l!.N + r!.N) / (0.5 * MAX_FLOW * 0.1)).toBeCloseTo(1, 6);
    expect(temperature(l!)).toBe(3);
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
    expect(hose.funnel.N / HOSE_CAP).toBeCloseTo(1, 6);
    const out = hose.step(0.01)!;
    expect(out.N / (PUMP_RATE * 0.01)).toBeCloseTo(1, 6);
    expect(temperature(out)).toBe(2);
    expect(hose.funnel.N / (HOSE_CAP - PUMP_RATE * 0.01)).toBeCloseTo(1, 6);
    expect(PUMP_RATE).toBeGreaterThan(MAX_FLOW);
  });
});

describe('dripping', () => {
  const packet = (atoms: number) => filled(new Vessel(Infinity), R, atoms, 2);
  const h = 0.02;

  it('falls at about 0 per second below 1M atoms, and about 1 above 2M', () => {
    expect(dropRate(1e6)).toBeLessThan(0.02);
    expect(dropRate(1.5e6)).toBeCloseTo(0.5);
    expect(dropRate(2e6)).toBeGreaterThan(0.98);
    expect(dropRate(5e6)).toBeGreaterThan(0.99);
  });

  it('streams a fast flow straight through, taking any hanging drop along', () => {
    const drop = packet(1e5);
    const out = packet(DRIP_FLOW * h);
    expect(drip(drop, out, h)).toBe(out);
    expect(out.N).toBe(DRIP_FLOW * h + 1e5);
    expect(drop.N).toBe(0);
  });

  it('gathers a slow flow in the drop, which falls whole when its luck runs out', () => {
    const drop = new Vessel(Infinity);
    // never falls: the drop just grows (by less than DRIP_FLOW·h a step, so it drips)
    expect(drip(drop, packet(5e4), h, () => 0.999999)).toBeNull();
    expect(drip(drop, packet(5e4), h, () => 0.999999)).toBeNull();
    expect(drop.N).toBe(1e5);
    expect(temperature(drop)).toBeCloseTo(2, 6);
    // always falls: out comes everything, this step's flow included
    const fell = drip(drop, packet(5e4), h, () => 0)!;
    expect(fell.N).toBe(1.5e5);
    expect(drop.N).toBe(0);
    // nothing hanging, nothing arriving: nothing falls
    expect(drip(drop, null, h, () => 0)).toBeNull();
  });

  it('drops about DROP_ATOMS-sized drops from a slow steady flow, conserving atoms', () => {
    const drop = new Vessel(Infinity);
    const flow = 1e6; // atoms per second: a drop takes a second or two to grow
    let fallen = 0;
    let n = 0;
    for (let i = 0; i < 20000; i++) {
      const d = drip(drop, packet(flow * h), h);
      if (d) {
        fallen += d.N;
        n++;
      }
    }
    expect(fallen + drop.N).toBe(20000 * flow * h);
    // almost none fall before 1M atoms, and past 2M they fall within a second or so: 1M more, at this flow
    expect(fallen / n).toBeGreaterThan(1.5e6);
    expect(fallen / n).toBeLessThan(3.5e6);
  });
});
