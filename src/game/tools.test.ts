import { describe, expect, it } from 'vitest';
import { SPECIES, TARGET, singleOf, speciesIndex } from '../chem/species';
import { CAP, GOAL_PURITY, GOAL_VOLUME } from './config';
import { heatAt, temperature } from '../chem/reactions';
import { Vessel, roomFor, volume } from './flask';
import { FLASK_OUTLINE, areaBelow } from './flaskShape';
import {
  DRIP_FLOW, EXCHANGE_RATE, HEATER, HEATER_CELLS, HEATER_TAPS, METER, METER_DIGITS, heatBy, meterText, wireTemperature, FUNNEL_CAP, FUNNEL_RATE, HOSE_CAP, Hose, MAX_FLOW, PIPETTE_FLOW, PUMP_RATE, SAMPLE_CAP, SCAN_LIGHTS,
  RECEPTACLE_CAP, RECEPTACLE_TIMES, REFERENCE_CAP, SEPARATOR, SORTER, beepPattern, SEPARATOR_OUTLET, SEPARATOR_OUTLETS, SEXTANT_ATOMS, TANK_CAP, Tool, counterflow, cupFillHeight, drip, dropRate, mouthBelow, scanLevel, separate, spectrum, type Mouth,
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

  it('holds a tenth of a flask, and lets out a fifth of that a second when full and fully open', () => {
    const p = new Tool('pipette', 0, 0, 0, [1]);
    expect(p.tanks[0].cap).toBe(CAP / 10);
    expect(p.shape.cup).toBeDefined();
    p.tanks[0].setMolecules(R, CAP / 10);
    expect(p.level(0)).toBe(1);
    expect(volume(p.step(0.02)[0]!) / (0.02 * PIPETTE_FLOW)).toBeCloseTo(1, 6);
  });

  it('flows with the height of its fluid, measured up its narrow tube once the cup has drained', () => {
    const p = new Tool('pipette', 0, 0, 0, [1]);
    p.tanks[0].setMolecules(R, CAP / 10);
    const full = p.shape.tankH ?? 84;
    const cupH = p.shape.cup!.h;
    // the cup holds the top quarter of it, but only the top fraction cupH / (full + cupH) of its height
    p.tanks[0].setMolecules(R, (0.75 * CAP) / 10);
    expect(p.level(0)).toBeCloseTo(full / (full + cupH), 1);
    const level = p.level(0);
    // a few hundred thousand whole molecules, so right to within parts per million
    expect(volume(p.step(0.02)[0]!) / (0.02 * level * PIPETTE_FLOW)).toBeCloseTo(1, 5);
  });

  it('flows in proportion to its valve, and not at all closed', () => {
    const p = new Tool('pipette', 0, 0, 0, [0.5]);
    p.tanks[0].setMolecules(R, CAP / 10);
    expect(volume(p.step(1)[0]!) / (CAP / 10 / 5 / 2)).toBeCloseTo(1, 4);
    p.valves[0] = 0;
    expect(p.step(1)[0]).toBeNull();
  });
});

describe('resistive heater', () => {
  /** A heater fed a steady room-temperature stream of R for `t` sim seconds, catching what leaves each spout. */
  function run(valves: number[], t = 3 * HEATER.transit, feed = 0.25 * CAP) {
    const ht = new Tool('heater', 0, 0, 0, valves);
    const out = ht.shape.spouts.map(() => new Vessel(Infinity));
    const src = filled(new Vessel(Infinity), R, CAP, 1);
    let fed = 0;
    for (let i = 0; i < t / 0.02; i++) {
      fed += ht.tanks[0].addFrom(src, feed * 0.02);
      ht.step(0.02).forEach((p, k) => p && out[k].addFrom(p, volume(p), true));
    }
    return { ht, out, fed };
  }
  const dial = (d: number, taps = [0, 0, 0]) => [...taps, d];
  const held = (ht: Tool) => [...ht.tanks, ...ht.tube].reduce((n, v) => n + v.N, 0);

  it('has three taps and a dial, all starting at 0', () => {
    const ht = new Tool('heater', 0, 0, 0);
    expect(ht.valves).toEqual([0, 0, 0, 0]);
    expect(ht.shape.dial).toBe(3);
    expect(ht.shape.spouts.length).toBe(4);
    expect(ht.tube.length).toBe(HEATER_CELLS);
  });

  it('carries fluid the length of its tube in about HEATER.transit, and out the end', () => {
    const ht = new Tool('heater', 0, 0, 0);
    ht.tanks[0].setMolecules(R, CAP / 100);
    // the first of it gets out a little early, as the stretches mix; most takes about the transit
    let t = 0;
    let out = 0;
    for (; out < CAP / 200 && t < 20; t += 0.02) out += ht.step(0.02)[3]?.N ?? 0;
    expect(t).toBeGreaterThan(0.8 * HEATER.transit);
    expect(t).toBeLessThan(1.2 * HEATER.transit);
  });

  it('loses nothing but traces, and with the taps shut lets it all out the end', () => {
    const { ht, out, fed } = run(dial(0.5));
    expect(out[0].N + out[1].N + out[2].N).toBe(0);
    // transfer drops a trace left behind (see TRACE), as the front of the stream spreads along the tube
    expect(1 - (out[3].N + held(ht)) / fed).toBeLessThan(1e-4);
  });

  it("doesn't heat with the dial at 0", () => {
    const { out } = run(dial(0));
    expect(temperature(out[3])).toBeCloseTo(1, 6);
  });

  it('heats more with the dial further up', () => {
    const T = [0.2, 0.5, 0.8].map((d) => temperature(run(dial(d)).out[3]));
    expect(T[0]).toBeGreaterThan(1.05);
    expect(T[1]).toBeGreaterThan(T[0]);
    expect(T[2]).toBeGreaterThan(T[1]);
    // but never past the wire
    expect(T[2]).toBeLessThan(wireTemperature(0.8));
  });

  it('heats fluid more the longer it has been along the tube, so each tap runs hotter than the last', () => {
    const { out } = run(dial(0.5, [0.05, 0.05, 0.05]));
    const T = out.map((v) => temperature(v));
    for (let k = 1; k < 4; k++) expect(T[k]).toBeGreaterThan(T[k - 1]);
    // roughly as far toward the wire as its time in the tube says
    const wire = wireTemperature(0.5);
    HEATER_TAPS.forEach((c, k) => {
      const share = 1 - Math.exp((-HEATER.rate * HEATER.transit * (c + 1)) / HEATER_CELLS);
      const ratio = (T[k] - 1) / (wire - 1) / share;
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.15);
    });
  });

  it('lets everything out of a wide-open tap, so none goes further', () => {
    const { out } = run(dial(0.5, [0, 1, 0]));
    expect(out[0].N).toBe(0);
    expect(out[1].N).toBeGreaterThan(0);
    expect(out[2].N + out[3].N).toBe(0);
  });

  it('feeds its tube from its funnel in proportion to how high the fluid stands in it', () => {
    const ht = new Tool('heater', 0, 0, 0);
    filled(ht.tanks[0], R, ht.tanks[0].cap / 4, 1);
    ht.step(0.01);
    expect(ht.tube.reduce((n, v) => n + v.N, 0) / (0.01 * HEATER.feed * 0.25)).toBeCloseTo(1, 4);
  });

  it('feeds its tube at most HEATER.feed', () => {
    const ht = new Tool('heater', 0, 0, 0);
    filled(ht.tanks[0], R, ht.tanks[0].cap, 1);
    ht.step(0.01);
    expect(ht.tube.reduce((n, v) => n + v.N, 0) / (0.01 * HEATER.feed)).toBeCloseTo(1, 6);
  });

  it('has a wire that is off at 0, about room temperature just above, and HEATER.maxT at 1', () => {
    expect(wireTemperature(0)).toBe(0);
    expect(wireTemperature(1e-6)).toBeCloseTo(1, 3);
    expect(wireTemperature(0.5)).toBeCloseTo(Math.sqrt(HEATER.maxT));
    expect(wireTemperature(1)).toBe(HEATER.maxT);
  });

  it('only heats: fluid hotter than the wire stays as hot', () => {
    const v = filled(new Vessel(Infinity), R, CAP, 20);
    heatBy(v, 10, 1);
    expect(temperature(v)).toBeCloseTo(20, 6);
    heatBy(v, 40, 1);
    expect(temperature(v)).toBeCloseTo(20 + 20 * (1 - Math.exp(-HEATER.rate)), 3);
  });
});

describe('flow meter', () => {
  it('drains its funnel straight through at FUNNEL_RATE, with no valve', () => {
    const m = new Tool('meter', 0, 0, 0);
    expect(m.shape.noValve).toBe(true);
    filled(m.tanks[0], R, FUNNEL_CAP, 2);
    const out = m.step(0.02)[0]!;
    expect(out.N / (FUNNEL_RATE * 0.02)).toBeCloseTo(1, 6);
    expect(temperature(out)).toBeCloseTo(2, 6);
  });

  it('reads what flows through it, averaged over about METER.tau', () => {
    const m = new Tool('meter', 0, 0, 0);
    const feed = 0.25 * CAP; // per sim second
    const src = filled(new Vessel(Infinity), R, CAP, 1);
    for (let t = 0; t < METER.tau; t += 0.02) {
      m.tanks[0].addFrom(src, feed * 0.02);
      m.step(0.02);
    }
    // a time constant in: about 1 − 1/e of the way there
    expect(m.rate / feed).toBeCloseTo(1 - Math.exp(-1), 1);
    for (let t = 0; t < 10 * METER.tau; t += 0.02) {
      m.tanks[0].addFrom(src, feed * 0.02);
      m.step(0.02);
    }
    expect(m.rate / feed).toBeCloseTo(1, 3);
    // and back down when it stops
    for (let t = 0; t < 10 * METER.tau; t += 0.02) m.step(0.02);
    expect(m.rate / feed).toBeLessThan(1e-3);
  });

  it(`shows millions per second in ${METER_DIGITS} digits, to as many decimals as fit`, () => {
    expect(meterText(0)).toBe('0.000');
    expect(meterText(12_345)).toBe('0.012');
    expect(meterText(1_234_500)).toBe('1.234');
    expect(meterText(56_784_000)).toBe('56.78');
    expect(meterText(999_960_000)).toBe('1000');
    expect(meterText(2e9)).toBe('2000');
    expect(meterText(5e10)).toBe('9999');
  });
});

describe('tank', () => {
  it('holds a hundred flasks, and is drawn as big as a hundred flasks', () => {
    const tk = new Tool('tank', 0, 0, 0);
    expect(tk.tanks[0].cap).toBe(100 * CAP);
    const { x0, x1 } = tk.shape.tanks[0];
    expect(((x1 - x0) * tk.shape.tankH!) / areaBelow(FLASK_OUTLINE, 0)).toBeCloseTo(100, 6);
  });

  it('pours through its valve like any tank, by how high its fluid stands', () => {
    const tk = new Tool('tank', 0, 0, 0, [1]);
    filled(tk.tanks[0], R, 50 * CAP, 1);
    const level = tk.level(0);
    expect(tk.step(0.01)[0]!.N / (MAX_FLOW * level * 0.01)).toBeCloseTo(1, 5);
  });
});

describe('receptacle', () => {
  /** A receptacle holding `atoms` of the target and `impurity` atoms of R, pressed and run to the end of its cycle. */
  function run(atoms: number, impurity: number) {
    const r = new Tool('receptacle', 0, 0, 0);
    r.tanks[0].setMolecules(TARGET, atoms / 3);
    r.tanks[0].setMolecules(R, impurity);
    const before = r.tanks[0].N;
    expect(r.press()).toBe(true);
    let flushed = 0;
    let poured = 0;
    let t = 0;
    const phases = new Set<string>();
    for (; r.cycle && t < 20; t += 0.02) {
      phases.add(r.cycle.phase);
      expect(r.lidded).toBe(true);
      poured += r.step(0.02)[0]?.N ?? 0;
      flushed += r.flushed;
      r.flushed = 0;
    }
    return { r, before, flushed, poured, t, phases };
  }

  it('holds a little over twice the reference, and stays put', () => {
    const r = new Tool('receptacle', 0, 0, 0);
    expect(r.tanks[0].cap).toBe(RECEPTACLE_CAP);
    expect(RECEPTACLE_CAP / REFERENCE_CAP).toBeGreaterThan(2);
    expect(RECEPTACLE_CAP / REFERENCE_CAP).toBeLessThan(2.5);
    expect(r.shape.fixed).toBe(true);
    expect(r.lidded).toBe(false);
  });

  it(`flushes what's more than ${100 * GOAL_PURITY}% target down its hose, counting the target, then opens`, () => {
    const atoms = 3 * CAP;
    const impurity = Math.floor(atoms * (1 / GOAL_PURITY - 1)) - 1000;
    const { r, flushed, poured, t, phases } = run(atoms, impurity);
    expect(r.verdict).toBe('pass');
    expect([...phases]).toEqual(['think', 'flush']);
    // by volume: molecules, or atoms if VOLUME says so
    expect(flushed).toBeCloseTo((atoms / 3) * roomFor(TARGET), -3);
    expect(poured).toBe(0);
    expect(r.tanks[0].N).toBe(0);
    expect(t).toBeCloseTo(RECEPTACLE_TIMES.think + RECEPTACLE_TIMES.flush, 1);
    expect(r.lidded).toBe(false);
  });

  it(`pours out anything else through its spout, counting nothing, then opens`, () => {
    const atoms = 3 * CAP;
    const impurity = Math.ceil(atoms * (1 / GOAL_PURITY - 1)) + 1000;
    const { r, before, flushed, poured, t, phases } = run(atoms, impurity);
    expect(r.verdict).toBe('fail');
    expect([...phases]).toEqual(['think', 'reject']);
    expect(flushed).toBe(0);
    expect(poured).toBe(before);
    expect(t).toBeCloseTo(RECEPTACLE_TIMES.think + RECEPTACLE_TIMES.reject, 1);
    expect(r.lidded).toBe(false);
  });

  it('wins in one good load, full, even if what it holds besides the target is all single atoms', () => {
    // fill it by volume with as many R atoms as a pass allows
    const room = RECEPTACLE_CAP;
    const t = Math.ceil(room / (roomFor(TARGET) + roomFor(R) * 3 * (1 / GOAL_PURITY - 1)));
    const { r, flushed } = run(3 * t, Math.floor((room - t * roomFor(TARGET)) / roomFor(R)));
    expect(r.verdict).toBe('pass');
    expect(flushed).toBeGreaterThanOrEqual(GOAL_VOLUME);
  });

  it("can't be filled to the goal from the cryostabilizer reference alone", () => {
    expect(REFERENCE_CAP).toBeLessThan(GOAL_VOLUME);
  });

  it('refuses an empty vessel, and ignores its button mid-cycle', () => {
    const r = new Tool('receptacle', 0, 0, 0);
    expect(r.press()).toBe(true);
    expect(r.press()).toBe(false);
    for (let t = 0; t < RECEPTACLE_TIMES.think + 0.1; t += 0.02) r.step(0.02);
    expect(r.verdict).toBe('fail');
  });

  it('beeps in a random pattern through its thinking, a few times a second', () => {
    const beeps = beepPattern();
    expect(beeps.length).toBeGreaterThan(5);
    for (const b of beeps) expect(b.t).toBeLessThan(RECEPTACLE_TIMES.think);
    expect(new Set(beeps.map((b) => b.lamp)).size).toBeGreaterThan(1);
  });
});

describe('dispenser', () => {
  it('dispenses valve × MAX_FLOW × how high its fluid stands, per sim second', () => {
    const d = new Tool('dispenser', 0, 0, 0, [0.5]);
    filled(d.tanks[0], R, 2 * CAP, 3);
    // half full, it stands a little over half as high, measured from the tip of its sump
    const level = d.level(0);
    expect(level).toBeGreaterThan(0.5);
    expect(level).toBeLessThan(0.55);
    const out = d.step(0.1)[0]!;
    // whole molecules, so right to within a few parts per billion
    expect(out.N / (0.5 * MAX_FLOW * level * 0.1)).toBeCloseTo(1, 6);
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

  it('measures its fluid from the tip of its sump, so a thin layer across the floor still drains steadily', () => {
    const d = new Tool('dispenser', 0, 0, 0, [1]);
    const { sump, tankH = 84 } = d.shape;
    // a little more than the sump holds: a thin layer across the floor
    filled(d.tanks[0], R, 0.02 * TANK_CAP, 1);
    expect(d.level(0)).toBeGreaterThan(sump!.h / (tankH + sump!.h));
    expect(d.level(0)).toBeLessThan((sump!.h + 3) / (tankH + sump!.h));
    // down in the narrow sump, it stands far higher for how little there is than it would in a flat tank, so the
    // last of it still drains quickly, and empties in a finite time
    d.tanks[0].setMolecules(R, 0.001 * TANK_CAP);
    expect(d.level(0)).toBeGreaterThan(5 * 0.001);
  });

  it('empties a full tank fully open in well under a minute, not trickling on', () => {
    const d = new Tool('dispenser', 0, 0, 0, [1]);
    filled(d.tanks[0], R, TANK_CAP, 1);
    let t = 0;
    for (; d.tanks[0].N > 0 && t < 120; t += 0.02) d.step(0.02);
    expect(d.tanks[0].N).toBe(0);
    expect(t).toBeLessThan(30);
  });

  it('empties completely in the end, rather than leaving a trace behind', () => {
    const d = new Tool('dispenser', 0, 0, 0, [1]);
    filled(d.tanks[0], R, CAP, 1);
    let total = 0;
    for (let i = 0; i < 10000; i++) total += d.step(0.01)[0]?.N ?? 0;
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

  it('drains its funnel at FUNNEL_RATE times how high the fluid stands, so half full at half the rate', () => {
    const sp = new Tool('splitter', 0, 0, 0);
    filled(sp.tanks[0], R, FUNNEL_CAP / 2, 1);
    expect(sp.level(0)).toBe(0.5);
    const [l, r] = sp.step(0.01);
    expect(((l?.N ?? 0) + (r?.N ?? 0)) / (FUNNEL_RATE * 0.5 * 0.01)).toBeCloseTo(1, 5);
  });

  it('drains a full funnel at FUNNEL_RATE, whatever the valve says', () => {
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
  it('holds a hundred flasks, and lets out at most 0.02 flask/s through its valve, when full', () => {
    const ref = new Tool('reference', 0, 0, 0, [1]);
    expect(ref.tanks[0].cap).toBe(100 * CAP);
    expect(ref.shape.sealed).toBe(true);
    filled(ref.tanks[0], TARGET, 3 * REFERENCE_CAP, 1); // full: a hundred flasks of triangles
    const out = ref.step(0.5)[0]!;
    expect(volume(out) / (0.02 * MAX_FLOW * 0.5)).toBeCloseTo(1, 3);
    ref.valves[0] = 0.5;
    expect(volume(ref.step(0.5)[0]!) / (0.01 * MAX_FLOW * 0.5)).toBeCloseTo(1, 3);
  });
});

describe('size sorter', () => {
  const RG = speciesIndex(['R', 'G', null], 1);

  const withStrength = (k: number, fn: () => void) => {
    const before = SORTER.strength;
    SORTER.strength = k;
    try {
      fn();
    } finally {
      SORTER.strength = before;
    }
  };
  /** Each size's shares out the three spouts, sorting singles, pairs and triples at the current strength. */
  function sort() {
    const so = new Tool('sorter', 0, 0, 0);
    const f = so.tanks[0];
    f.setMolecules(R, 6e7);
    f.setMolecules(RG, 3e7);
    f.setMolecules(TARGET, 2e7);
    f.setTemperature(3);
    const before = { N: f.N, Q: f.Q };
    const outs = so.step(0.02).map((v) => v ?? new Vessel(Infinity));
    expect(outs).toHaveLength(3);
    // nothing made or lost, and the heat goes with the atoms
    expect(outs.reduce((t, v) => t + v.N, 0) + f.N).toBe(before.N);
    expect(outs.reduce((t, v) => t + v.Q, 0) + f.Q).toBe(before.Q);
    return [R, RG, TARGET].map((sp) => {
      const total = outs.reduce((t, v) => t + v.n[sp], 0);
      return outs.map((v) => v.n[sp] / total);
    });
  }

  it('sends each size out its own spout, 1/3 + 2/3·strength of it, and the rest evenly out the others', () => {
    for (const k of [0.2, 0.55, 0.9]) {
      withStrength(k, () => {
        sort().forEach((shares, own) =>
          shares.forEach((x, j) => expect(x).toBeCloseTo(j === own ? 1 / 3 + (2 / 3) * k : (1 - k) / 3, 2)),
        );
      });
    }
  });

  it('splits every size evenly at strength 0, and sorts perfectly at 1', () => {
    withStrength(0, () => sort().forEach((shares) => shares.forEach((x) => expect(x).toBeCloseTo(1 / 3, 2))));
    withStrength(1, () => expect(sort()).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]));
  });

  it('keeps the temperature of what it sorts', () => {
    const so = new Tool('sorter', 0, 0, 0);
    filled(so.tanks[0], R, FUNNEL_CAP, 3);
    for (const v of so.step(0.02)) if (v) expect(temperature(v)).toBeCloseTo(3, 2);
  });

  it('drains its funnel at FUNNEL_RATE times how high the fluid stands, with no valve', () => {
    for (const share of [1, 0.25]) {
      const so = new Tool('sorter', 0, 0, 0);
      filled(so.tanks[0], R, FUNNEL_CAP * share, 4);
      const out = so.step(0.01).reduce((t, v) => t + (v?.N ?? 0), 0);
      expect(out / (FUNNEL_RATE * share * 0.01)).toBeCloseTo(1, 5);
      expect(so.shape.noValve).toBe(true);
    }
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
    // full, so each valve lets out its whole rate
    filled(x.tanks[0], R, TANK_CAP, TA);
    filled(x.tanks[1], G, TANK_CAP, TB);
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
  const C = singleOf('C');
  const tri = (name: string) => SPECIES.find((s) => s.name === name)!.i;
  const pair = (name: string) => SPECIES.find((s) => s.name === name)!.i;
  const withSharpness = (k: number, fn: () => void) => {
    const before = SEPARATOR.sharpness;
    SEPARATOR.sharpness = k;
    try {
      fn();
    } finally {
      SEPARATOR.sharpness = before;
    }
  };

  it('gives each molecule its own outlet by its share of primary atoms: all, ⅔, ½, ⅓, none', () => {
    expect(SEPARATOR_OUTLET[R]).toBe(0);
    expect(SEPARATOR_OUTLET[tri('△RGB')]).toBe(0);
    expect(SEPARATOR_OUTLET[pair('R–G')]).toBe(0);
    expect(SEPARATOR_OUTLET[tri('△RGY')]).toBe(1);
    expect(SEPARATOR_OUTLET[pair('R–Y')]).toBe(2);
    expect(SEPARATOR_OUTLET[tri('△RMY')]).toBe(3);
    expect(SEPARATOR_OUTLET[C]).toBe(4);
    expect(SEPARATOR_OUTLET[pair('C–M')]).toBe(4);
  });

  it('sends most of each molecule out its own outlet, the rest mostly next door, and more so the sharper it is', () => {
    const f = new Vessel(Infinity);
    for (const sp of [R, tri('△RGY'), pair('R–Y'), tri('△RMY'), C]) f.n[sp] = CAP;
    f.N = atomTotal(f);
    let last = 0;
    for (const k of [1, 3, 6]) {
      withSharpness(k, () => {
        const out = separate(f);
        expect(out).toHaveLength(SEPARATOR_OUTLETS);
        const ownShare = out[2].n[pair('R–Y')] / CAP;
        expect(ownShare).toBeGreaterThan(last);
        last = ownShare;
        [R, tri('△RGY'), pair('R–Y'), tri('△RMY'), C].forEach((sp, own) => {
          const shares = out.map((v) => v.n[sp] / CAP);
          expect(Math.max(...shares)).toBe(shares[own]);
          for (let j = 0; j < SEPARATOR_OUTLETS; j++)
            if (Math.abs(j - own) > 1) expect(shares[j]).toBeLessThan(shares[own - Math.sign(own - j)] + 1e-9);
          expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        });
      });
    }
  });

  it('splits everything evenly five ways at sharpness 0', () => {
    withSharpness(0, () => {
      const f = filled(new Vessel(Infinity), R, CAP, 1);
      for (const v of separate(f)) expect(v.n[R] / CAP).toBeCloseTo(1 / SEPARATOR_OUTLETS, 4);
    });
  });

  it('conserves molecules and heat, which goes with the atoms', () => {
    const f = filled(new Vessel(Infinity), R, CAP, 3);
    f.setMolecules(Y, CAP / 3);
    const out = separate(f);
    expect(out.reduce((t, v) => t + v.N, 0)).toBe(f.N);
    expect(out.reduce((t, v) => t + v.Q, 0)).toBe(f.Q);
    for (const v of out) if (v.N > 1e6) expect(temperature(v)).toBeCloseTo(temperature(f), 3);
  });

  it('drains its tank at the valve rate times its level, out of all five spouts', () => {
    const x = new Tool('separator', 0, 0, 0, [0.5]);
    filled(x.tanks[0], B, CAP, 3);
    x.tanks[0].setMolecules(Y, CAP);
    const level = x.level(0);
    const out = x.step(0.1);
    expect(out).toHaveLength(SEPARATOR_OUTLETS);
    expect(out.reduce((t, v) => t + (v?.N ?? 0), 0) / (0.5 * MAX_FLOW * level * 0.1)).toBeCloseTo(1, 6);
    expect(x.flow.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5 * level);
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
