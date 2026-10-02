import { describe, expect, it } from 'vitest';
import { SPECIES, TARGET, singleOf, speciesIndex } from '../chem/species';
import { CAP } from './config';
import { heatAt, temperature } from '../chem/reactions';
import { Vessel, roomFor, volume } from './flask';
import {
  DRIP_FLOW, EXCHANGE_RATE, FUNNEL_CAP, FUNNEL_RATE, HOSE_CAP, Hose, MAX_FLOW, PUMP_RATE, SAMPLE_CAP, SCAN_LIGHTS,
  SEXTANT_ATOMS, TANK_CAP, Tool, counterflow, cupFillHeight, drip, dropRate, mouthBelow, scanLevel, separate, spectrum, type Mouth,
} from './tools';

const R = singleOf('R');
const G = singleOf('G');
const atomTotal = (v: { n: Float64Array }) => SPECIES.reduce((t, s) => t + v.n[s.i] * s.size, 0);

function filled(v: Vessel, species: number, atoms: number, T: number): Vessel {
  v.setMolecules(species, atoms / SPECIES[species].size);
  v.setTemperature(T);
  return v;
}

describe('pipette', () => {
  it('is drawn filling its tube first, then its cup by area, to the brim when full', () => {
    // a 10 × 84 tube under a cup 28 wide at the mouth, 14 tall: 840 + 266 of area
    expect(cupFillHeight(0, 10, 84, 28, 14)).toBe(0);
    expect(cupFillHeight(420 / 1106, 10, 84, 28, 14)).toBeCloseTo(42);
    expect(cupFillHeight(840 / 1106, 10, 84, 28, 14)).toBeCloseTo(84);
    expect(cupFillHeight(1, 10, 84, 28, 14)).toBeCloseTo(98);
    expect(cupFillHeight(2, 10, 84, 28, 14)).toBeCloseTo(98);
    // halfway up the cup it's 19 wide, so (10 + 19) / 2 · 7 of the cup's area is below
    expect(cupFillHeight((840 + 101.5) / 1106, 10, 84, 28, 14)).toBeCloseTo(91);
  });

  it('holds a tenth of a flask, and empties it in five sim seconds fully open', () => {
    const p = new Tool('pipette', 0, 0, 0, [1]);
    expect(p.tanks[0].cap).toBe(CAP / 10);
    expect(p.shape.cup).toBeDefined();
    p.tanks[0].setMolecules(R, CAP / 10);
    let t = 0;
    for (; volume(p.tanks[0]) > 0 && t < 10; t += 0.02) p.step(0.02);
    expect(t).toBeCloseTo(5, 1);
  });

  it('flows in proportion to its valve, and not at all closed', () => {
    const p = new Tool('pipette', 0, 0, 0, [0.5]);
    p.tanks[0].setMolecules(R, CAP / 10);
    expect(volume(p.step(1)[0]!) / (CAP / 10 / 5 / 2)).toBeCloseTo(1, 4);
    p.valves[0] = 0;
    expect(p.step(1)[0]).toBeNull();
  });
});

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

describe('mixer', () => {
  it('keeps its tank stirred, so what it holds never separates, and dispenses like a dispenser', () => {
    const m = new Tool('mixer', 0, 0, 0, [1]);
    m.tanks[0].setMolecules(R, CAP);
    m.tanks[0].setMolecules(singleOf('C'), CAP);
    for (let i = 0; i < 500; i++) m.tanks[0].settle(0.02);
    const out = m.step(0.1)[0]!;
    expect(out.n[R] / volume(out)).toBeCloseTo(0.5, 1);
    expect(out.N / (MAX_FLOW * 0.1)).toBeCloseTo(1, 6);
  });

  it('turns its stir bar on sim time', () => {
    const m = new Tool('mixer', 0, 0, 0);
    m.step(1 / 12);
    expect(m.spin).toBeCloseTo(Math.PI / 2);
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

describe('cryostabilizer reference', () => {
  it('holds a hundred flasks, and lets out at most 0.02 flask/s through its valve', () => {
    const ref = new Tool('reference', 0, 0, 0, [1]);
    expect(ref.tanks[0].cap).toBe(100 * CAP);
    expect(ref.shape.sealed).toBe(true);
    filled(ref.tanks[0], TARGET, 0.4 * CAP, 1);
    const out = ref.step(0.5)[0]!;
    expect(volume(out) / (0.02 * MAX_FLOW * 0.5)).toBeCloseTo(1, 3);
    ref.valves[0] = 0.5;
    expect(volume(ref.step(0.5)[0]!) / (0.01 * MAX_FLOW * 0.5)).toBeCloseTo(1, 3);
  });
});

describe('size sorter', () => {
  const RG = speciesIndex(['R', 'G', null], 1);

  it('takes 70% of singles through the first screen, 95% of the rest and 70% of pairs through the second', () => {
    const so = new Tool('sorter', 0, 0, 0);
    const f = so.tanks[0];
    f.setMolecules(R, 6e7);
    f.setMolecules(RG, 3e7);
    f.setMolecules(TARGET, 2e7);
    f.setTemperature(3);
    const before = { N: f.N, Q: f.Q };
    const outs = so.step(0.02);
    expect(outs).toHaveLength(3);
    const [a, b, c] = outs.map((v) => v!);
    const drained = { R: a.n[R] + b.n[R] + c.n[R], RG: a.n[RG] + b.n[RG] + c.n[RG] };
    expect(a.n[R] / drained.R).toBeCloseTo(0.7, 3);
    expect(b.n[R] / drained.R).toBeCloseTo(0.3 * 0.95, 3);
    expect(c.n[R] / drained.R).toBeCloseTo(0.3 * 0.05, 3);
    expect([a.n[RG], b.n[RG] / drained.RG, c.n[RG] / drained.RG].map((x) => +x.toFixed(3))).toEqual([0, 0.7, 0.3]);
    expect([a.n[TARGET], b.n[TARGET]]).toEqual([0, 0]);
    expect(c.n[TARGET]).toBeGreaterThan(0);
    // nothing made or lost, and the heat goes with the atoms
    expect(a.N + b.N + c.N + f.N).toBe(before.N);
    expect(a.Q + b.Q + c.Q + f.Q).toBe(before.Q);
    for (const v of [a, b, c]) expect(temperature(v)).toBeCloseTo(3, 2);
  });

  it('drains its funnel at FUNNEL_RATE, with no valve', () => {
    const so = new Tool('sorter', 0, 0, 0);
    filled(so.tanks[0], R, FUNNEL_CAP, 4);
    const out = so.step(0.05).reduce((t, v) => t + (v?.N ?? 0), 0);
    expect(out / (FUNNEL_RATE * 0.05)).toBeCloseTo(1, 6);
    expect(so.shape.noValve).toBe(true);
  });
});

describe('mass spectrometer', () => {
  const RG = speciesIndex(['R', 'G', null], 1);
  const B = singleOf('B');
  const at = (size: number, atom: 'R' | 'G' | 'B' | 'C' | 'M' | 'Y') => (size - 1) * 6 + SEXTANT_ATOMS.indexOf(atom);

  const CUP = 1e7;
  /** A cup's reading, filled with each species by volume. */
  const read = (fill: [number, number][]) => {
    const v = new Vessel(CUP);
    for (const [s, room] of fill) v.setMolecules(s, room / roomFor(s));
    return spectrum(v, CUP);
  };

  it("reads the share of the cup each size's molecules with each color fill", () => {
    // a full cup: 20% R, 20% G, 30% B and 30% R–G
    const r = read([[R, 0.2 * CUP], [G, 0.2 * CUP], [B, 0.3 * CUP], [RG, 0.3 * CUP]]);
    const want = new Array(18).fill(0);
    want[at(1, 'R')] = 0.2;
    want[at(1, 'G')] = 0.2;
    want[at(1, 'B')] = 0.3;
    want[at(2, 'R')] = 0.3;
    want[at(2, 'G')] = 0.3;
    r.forEach((x, i) => expect(x).toBeCloseTo(want[i], 9));
  });

  it('lights a full cup of one species fully in each of its sextants', () => {
    expect(read([[R, CUP]])[at(1, 'R')]).toBe(1);
    const rg = read([[RG, CUP]]);
    expect([rg[at(2, 'R')], rg[at(2, 'G')]]).toEqual([1, 1]);
    const t = read([[TARGET, CUP]]);
    // as near full as whole triangles get
    for (const a of ['R', 'G', 'B'] as const) expect(t[at(3, a)]).toBeCloseTo(1, 6);
  });

  it('reads a half-full cup half as bright, and an empty one dark', () => {
    expect(read([[R, CUP]])[at(1, 'R')]).toBe(2 * read([[R, 0.5 * CUP], [G, 0.1 * CUP]])[at(1, 'R')]);
    expect(spectrum(new Vessel(CUP), CUP).every((x) => x === 0)).toBe(true);
  });

  it('reads its sample when run, lids it and drains it evenly over the run, ignoring the button until the end', () => {
    const sp = new Tool('spectrometer', 0, 0, 0);
    const cup = sp.tanks[0];
    expect(cup.cap).toBe(SAMPLE_CAP);
    expect(sp.step(0.1)).toEqual([]);
    expect(sp.lidded).toBe(false);
    cup.setMolecules(TARGET, SAMPLE_CAP / 2 / roomFor(TARGET));
    cup.setTemperature(5);
    const full = volume(cup);
    expect(sp.scan()).toBe(true);
    // half full of the triangle
    expect(sp.reading![2 * 6 + SEXTANT_ATOMS.indexOf('R')]).toBeCloseTo(0.5, 6);
    expect(sp.lidded).toBe(true);
    const end = SCAN_LIGHTS[2];
    let t = 0;
    for (; t < end / 2 - 1e-9; t += 0.02) sp.step(0.02);
    expect(volume(cup) / full).toBeCloseTo(0.5, 2);
    expect(temperature(cup)).toBeCloseTo(5, 2);
    expect(sp.scan()).toBe(false);
    for (; sp.scanning; t += 0.02) sp.step(0.02);
    expect(Math.abs(t - end)).toBeLessThanOrEqual(0.02 + 1e-9);
    expect([cup.N, cup.Q]).toEqual([0, 0]);
    expect(sp.lidded).toBe(false);
    expect(sp.scan()).toBe(true);
    expect(sp.reading!.every((x) => x === 0)).toBe(true);
  });

  it('rumbles a step harder each phase, steady within one, then stops', () => {
    const [a, b, c] = SCAN_LIGHTS;
    const levels = [0, a - 0.01, a, b - 0.01, b, c - 0.01].map(scanLevel);
    expect(levels[1]).toBe(levels[0]);
    expect(levels[3]).toBe(levels[2]);
    expect(levels[5]).toBe(levels[4]);
    expect(levels[2]).toBeGreaterThan(levels[1]);
    expect(levels[4]).toBeGreaterThan(levels[3]);
    expect(scanLevel(SCAN_LIGHTS[2])).toBe(0);
    expect(scanLevel(Infinity)).toBe(0);
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

  it('falls at about 0 per second below 1M atoms, once a second at 1.5M, and ever faster beyond', () => {
    expect(dropRate(1e6)).toBeLessThan(0.02);
    expect(dropRate(1.5e6)).toBeCloseTo(1);
    expect(dropRate(2e6)).toBeGreaterThan(50);
    expect(dropRate(5e6)).toBeGreaterThan(1e9);
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

  it('drops about DRIP.atoms-sized drops from a steady flow, slow or fast, conserving atoms', () => {
    // a drop falls about when the rate times how long it takes to grow by `spread` reaches 1:
    // at size + spread·ln(flow / spread), so a faster flow makes only slightly bigger drops
    for (const [flow, lo, hi] of [
      [1e6, 1.6e6, 1.9e6],
      [4e6, 1.8e6, 2.1e6],
    ]) {
      const drop = new Vessel(Infinity);
      let fallen = 0;
      let n = 0;
      let biggest = 0;
      for (let i = 0; i < 20000; i++) {
        const d = drip(drop, packet(flow * h), h);
        if (d) {
          fallen += d.N;
          n++;
          biggest = Math.max(biggest, d.N);
        }
      }
      expect(fallen + drop.N).toBe(20000 * flow * h);
      expect(fallen / n).toBeGreaterThan(lo);
      expect(fallen / n).toBeLessThan(hi);
      // no long tail of drops that hang on and on
      expect(biggest).toBeLessThan(2.6e6);
    }
  });
});
