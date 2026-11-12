import { describe, expect, it } from 'vitest';
import { SPECIES, TARGET, bondMask, pairOf, singleOf, speciesIndex } from '../chem/species';
import { CAP, DELIVERY, GOAL_PURITY, GOAL_TARGET, TRACE } from './config';
import { ReactionNetwork, heatAt, temperature } from '../chem/reactions';
import { testChemParams } from '../chem/testChem';
import { COOLING } from './cooling';
import { Vessel, roomFor, volume } from './flask';
import { FLASK_VOLUME } from './flaskShape';
import { STATION_POSE } from './presets';
import { CELL, WALL_PANEL } from './space';
import { tankMouth } from './bodies';
import { TILES } from './surfaces';
import {
  DRIP_FLOW, EXCHANGE_RATE, HEATER, HEATER_CELLS, HEATER_TAPS, INLINE_TOOLS, UNIQUE_TOOLS, METER_DIGITS, heatBy, heaterCellX, meterText, wireTemperature, FUNNEL_CAP, FUNNEL_RATE, Hose, MAX_FLOW, PIPETTE_FLOW, ANALYZER_SAMPLE, ATOM_PLACE, analyzerSector, BOND_ENDS, BOND_TRIANGLE, BOND_KEYS, SPECTROSCOPE, bondPoint, bondShares, bondCounts, spectroscopeAt, spectroscopeTop, spectroscopeUnit, spectroscopeY, INSTRUMENT_TAU, TUBE_CAP,
  clockText, needleAt, CULTURE, harm, cultureLevel, cultureCells, STRIP, STRIP_RUN, stripBands, scorchAt, THERMOMETER, thermometerAt, BULB, BULB_BODY_CAP, BULB_NECK_CAP, neckShare, heightOf, INTAKE_CAP, REFERENCE_CAP, REFERENCE_FLOW, REFERENCE_START, RESERVOIR_FILTER, SEPARATOR, STATION, gaugeSegments, SEPARATOR_PERFECT, SORTER, STATION_FUNNEL, SPACE_PER_ATOM, SEPARATOR_OUTLET, SEPARATOR_OUTLETS, SORTER_OUTLETS, SECTOR_ATOMS, TANK_CAP, Tool, counterflow, cupFillHeight, levelIn, spaceOf, tankDepth, tankPieces, SHAPES, type ToolKind, drip, dropRate, mouthBelow, sameMount, separate, composition, type Mouth,
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
    const p = new Tool('pipette', 0, undefined, [1]);
    expect(p.tanks[0].cap).toBe(CAP / 10);
    expect(p.shape.cup).toBeDefined();
    p.tanks[0].setMolecules(R, CAP / 10);
    expect(p.level(0)).toBe(1);
    expect(volume(p.step(0.02)[0]!) / (0.02 * PIPETTE_FLOW)).toBeCloseTo(1, 6);
  });

  it('flows with the height of its fluid, measured up its narrow tube once the cup has drained', () => {
    const p = new Tool('pipette', 0, undefined, [1]);
    p.tanks[0].setMolecules(R, CAP / 10);
    const full = p.shape.tankH ?? 84;
    const { w, h: cupH } = p.shape.cup!;
    const tubeW = p.shape.tanks[0].x1 - p.shape.tanks[0].x0;
    // filled just to the top of its tube, it's the tube's share of the outline's area full, and the cup's empty
    const tube = tubeW * full;
    const share = tube / (tube + ((tubeW + 2 * w) / 2) * cupH);
    p.tanks[0].setMolecules(R, (share * CAP) / 10);
    expect(p.level(0)).toBeCloseTo(full / (full + cupH), 4);
    const level = p.level(0);
    // a few hundred thousand whole molecules, so right to within parts per million
    expect(volume(p.step(0.02)[0]!) / (0.02 * level * PIPETTE_FLOW)).toBeCloseTo(1, 5);
  });

  it('flows in proportion to its valve, and not at all closed', () => {
    const p = new Tool('pipette', 0, undefined, [0.5]);
    p.tanks[0].setMolecules(R, CAP / 10);
    expect(volume(p.step(1)[0]!) / (CAP / 10 / 5 / 2)).toBeCloseTo(1, 4);
    p.valves[0] = 0;
    expect(p.step(1)[0]).toBeNull();
  });
});

describe('resistive heater', () => {
  it("has its taps' spouts, and the end's, under the stretches they draw from", () => {
    const sp = SHAPES.heater.spouts;
    [...HEATER_TAPS, HEATER_CELLS - 1].forEach((c, j) => expect(heaterCellX(c)).toBeCloseTo(sp[j], 9));
  });

  /** A heater fed a steady room-temperature stream of R for `t` sim seconds, catching what leaves each spout. */
  function run(valves: number[], t = 3 * HEATER.transit, feed = 0.25 * CAP) {
    const ht = new Tool('heater', 0, undefined, valves);
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
    const ht = new Tool('heater', 0);
    expect(ht.valves).toEqual([0, 0, 0, 0]);
    expect(ht.shape.dial).toBe(3);
    expect(ht.shape.spouts.length).toBe(4);
    expect(ht.tube.length).toBe(HEATER_CELLS);
  });

  it('carries fluid the length of its tube in about HEATER.transit, and out the end', () => {
    const ht = new Tool('heater', 0);
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
    const ht = new Tool('heater', 0);
    filled(ht.tanks[0], R, ht.tanks[0].cap / 4, 1);
    ht.step(0.01);
    expect(ht.tube.reduce((n, v) => n + v.N, 0) / (0.01 * HEATER.feed * 0.25)).toBeCloseTo(1, 4);
  });

  it('feeds its tube at most HEATER.feed', () => {
    const ht = new Tool('heater', 0);
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
  it('is an inline instrument, and there can be any number of them', () => {
    expect(INLINE_TOOLS).toContain('meter');
    expect(UNIQUE_TOOLS).not.toContain('meter');
  });

  it('drains its tube straight through at FUNNEL_RATE, with no valve', () => {
    const m = new Tool('meter', 0);
    expect(m.shape.noValve).toBe(true);
    filled(m.tanks[0], R, TUBE_CAP, 2);
    const out = m.step(0.02)[0]!;
    expect(out.N / (FUNNEL_RATE * 0.02)).toBeCloseTo(1, 6);
    expect(temperature(out)).toBeCloseTo(2, 6);
  });

  it('reads what flows through it, fading the past smoothly over INSTRUMENT_TAU', () => {
    const m = new Tool('meter', 0);
    const feed = 0.25 * CAP; // per sim second
    const src = filled(new Vessel(Infinity), R, CAP, 1);
    const run = (secs: number, on: boolean) => {
      for (let i = 0; i < Math.round(secs / 0.02); i++) {
        if (on) m.tanks[0].addFrom(src, feed * 0.02);
        m.step(0.02);
      }
    };
    // a step up shows at once, and comes in fully: about 1 − e^-1 of it after INSTRUMENT_TAU
    run(0.02, true);
    expect(m.rate).toBeGreaterThan(0);
    run(INSTRUMENT_TAU - 0.02, true);
    expect(m.rate / feed).toBeCloseTo(1 - Math.exp(-1), 1);
    run(20 * INSTRUMENT_TAU, true);
    expect(m.rate / feed).toBeCloseTo(1, 3);
    // a step down fades, about e^-1 of it left after INSTRUMENT_TAU, and in the end it reads nothing
    run(INSTRUMENT_TAU, false);
    expect(m.rate / feed).toBeCloseTo(Math.exp(-1), 1);
    run(40 * INSTRUMENT_TAU, false);
    expect(m.rate).toBe(0);
    // and starts again from nothing: an idle meter isn't stepped, but nothing it read is left over
    run(INSTRUMENT_TAU, true);
    expect(m.rate / feed).toBeCloseTo(1 - Math.exp(-1), 1);
  });

  it('lets nothing out while empty', () => {
    const t = new Tool('splitter', 0);
    expect(t.step(0.02)).toEqual([null, null]);
    expect(t.flow).toEqual([0, 0]);
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
    const tk = new Tool('tank', 0);
    expect(tk.tanks[0].cap).toBe(100 * CAP);
    expect(spaceOf(tankPieces(tk.shape, 0, tankDepth('tank'))) / FLASK_VOLUME).toBeCloseTo(100, 6);
  });

  it('pours through its valve like any tank, by how high its fluid stands', () => {
    const tk = new Tool('tank', 0, undefined, [1]);
    filled(tk.tanks[0], R, 50 * CAP, 1);
    const level = tk.level(0);
    expect(tk.step(0.01)[0]!.N / (MAX_FLOW * level * 0.01)).toBeCloseTo(1, 5);
  });
});

describe('cryostabilizer station', () => {
  /**
   * A station whose funnel holds `atoms` of the target and `impurity` atoms of R, run until its funnel is empty: what
   * came out its waste spigot, and how long it took.
   */
  function run(atoms: number, impurity: number) {
    const r = new Tool('receptacle', 0);
    const [funnel, ref] = r.tanks;
    funnel.setMolecules(TARGET, atoms / 3);
    funnel.setMolecules(R, impurity);
    const before = funnel.N;
    let wasted = 0;
    let t = 0;
    for (; funnel.N > 0 && t < 20; t += 0.02) wasted += r.step(0.02)[0]?.N ?? 0;
    return { r, funnel, ref, before, wasted, t };
  }

  it('is built into the wall, with a funnel holding what it is drawn to, and a reservoir about three times the goal', () => {
    const r = new Tool('receptacle', 0);
    expect(r.tanks.map((v) => v.cap)).toEqual([INTAKE_CAP, REFERENCE_CAP]);
    expect(INTAKE_CAP * SPACE_PER_ATOM).toBeCloseTo(spaceOf(STATION_FUNNEL), -2);
    expect(r.shape.fixed).toBe(true);
    expect(r.shape.wall).toBe(true);
    // the funnel is open, and the reservoir sealed
    expect(r.isOpen(0)).toBe(true);
    expect(r.isOpen(1)).toBe(false);
    expect(REFERENCE_START).toBeLessThan(GOAL_TARGET);
    expect(REFERENCE_CAP / GOAL_TARGET).toBeCloseTo(3, 1);
    // even if all it's ever let in is only just pure enough, and the rest single atoms
    const target = GOAL_TARGET * roomFor(TARGET);
    expect(target + (GOAL_TARGET * 3 * (1 / GOAL_PURITY - 1)) * roomFor(R)).toBeLessThan(REFERENCE_CAP);
  });

  it(`lets what's more than ${100 * GOAL_PURITY}% target into the reservoir, as fast as the funnel drains`, () => {
    const atoms = 0.6 * CAP;
    const impurity = Math.floor(atoms * (1 / GOAL_PURITY - 1)) - 1000;
    const { r, ref, before, wasted, t } = run(atoms, impurity);
    expect(r.gate).toBe('reservoir');
    expect(ref.N).toBe(before);
    expect(ref.n[TARGET]).toBe(atoms / 3);
    expect(wasted).toBe(0);
    expect(t).toBeCloseTo(volume(ref) / FUNNEL_RATE, 1);
  });

  it('sends anything else out its waste spigot', () => {
    const atoms = 0.6 * CAP;
    const impurity = Math.ceil(atoms * (1 / GOAL_PURITY - 1)) + 1000;
    const { r, ref, before, wasted } = run(atoms, impurity);
    expect(r.gate).toBe('waste');
    expect(wasted).toBe(before);
    expect(ref.N).toBe(0);
  });

  it('judges what comes through as it comes, and stays where it last sent anything', () => {
    const r = new Tool('receptacle', 0);
    const [funnel, ref] = r.tanks;
    expect(r.gate).toBe('waste');
    expect(r.sinceFlow).toBe(Infinity);
    funnel.setMolecules(TARGET, 1000);
    r.step(0.02);
    expect(r.gate).toBe('reservoir');
    expect(r.sinceFlow).toBe(0);
    expect(ref.n[TARGET]).toBe(1000);
    funnel.setMolecules(R, 1000);
    expect(r.step(0.02)[0]?.N).toBe(1000);
    expect(r.gate).toBe('waste');
    r.step(0.02);
    expect(r.gate).toBe('waste');
    expect(r.sinceFlow).toBeCloseTo(0.02, 9);
  });

  it('reads how much of what went through lately was the target on its needle, which stays there afterwards', () => {
    const r = new Tool('receptacle', 0);
    const [funnel] = r.tanks;
    expect(r.purity).toBeNull();
    // 80% target by atoms: turned away, but the needle says how near it was
    funnel.setMolecules(TARGET, 0.08 * CAP);
    funnel.setMolecules(R, 0.06 * CAP);
    for (let t = 0; funnel.N > 0 && t < 5; t += 0.02) r.step(0.02);
    expect(r.gate).toBe('waste');
    expect(r.purity).toBeCloseTo(0.8, 3);
    // with nothing going through, it stays where it was, and the needle has swung there from its left stop
    for (let t = 0; t < 30; t += 0.02) r.step(0.02);
    expect(r.purity).toBeCloseTo(0.8, 3);
    expect(r.needle).toBeCloseTo(needleAt(0.8), 3);
    // and the needle swings on to what goes through next, not all at once
    funnel.setMolecules(TARGET, 0.2 * CAP);
    r.step(0.02);
    expect(r.purity).toBe(1);
    expect(r.needle).toBeGreaterThan(needleAt(0.8));
    expect(r.needle).toBeLessThan(0.7);
    for (let t = 0; t < 5; t += 0.02) r.step(0.02);
    expect(r.needle).toBeCloseTo(1, 3);
  });

  it('swings its needle from its left stop to its right, furthest for the last few percent', () => {
    expect(needleAt(0)).toBe(0);
    expect(needleAt(1)).toBe(1);
    expect(needleAt(0.75)).toBeCloseTo(0.5);
    for (let p = 0; p < 1; p += 0.05) expect(needleAt(p + 0.05)).toBeGreaterThan(needleAt(p));
    // the last five percent swing it further than the first thirty
    expect(1 - needleAt(0.95)).toBeGreaterThan(needleAt(0.3));
    // the dial is on the plate, clear of the diverter's display and the funnel
    const { needle: n, display: d, block } = STATION;
    expect(n.x1).toBeLessThan(d.x0);
    expect(n.x0).toBeGreaterThan(block.x0);
  });

  it(`keeps time it's been delivering steadily, at least every ${DELIVERY.gap} sim s`, () => {
    const r = new Tool('receptacle', 0);
    const funnel = r.tanks[0];
    // a dribble every 2 sim s
    for (let t = 0; t < 10; t++) {
      if (t % 2 === 0) funnel.setMolecules(TARGET, 1000);
      r.step(1);
    }
    expect(r.steady).toBeCloseTo(10, 9);
    // and a gap longer than DELIVERY.gap starts it again
    for (let t = 0; t < DELIVERY.gap + 1; t++) r.step(1);
    expect(r.steady).toBe(0);
  });

  it('shows lengths of time as a clock does', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(42.9)).toBe('0:42');
    expect(clockText(12 * 60 + 5)).toBe('12:05');
    expect(clockText(3723)).toBe('1:02:03');
  });

  it('keeps time since it last let anything into the reservoir', () => {
    const r = new Tool('receptacle', 0);
    const funnel = r.tanks[0];
    expect(r.sinceDelivery).toBe(Infinity);
    funnel.setMolecules(TARGET, 1000);
    r.step(0.02);
    expect(r.sinceDelivery).toBe(0);
    // what it turns away doesn't count
    funnel.setMolecules(R, 1000);
    r.step(0.02);
    expect(r.sinceDelivery).toBeCloseTo(0.02, 9);
    r.step(0.02);
    expect(r.sinceDelivery).toBeCloseTo(0.04, 9);
  });

  it(`filters ${100 * RESERVOIR_FILTER}% of what has a black atom in it out of the reservoir each sim second`, () => {
    const r = new Tool('receptacle', 0);
    const ref = r.tanks[1];
    const Y = singleOf('K');
    const YR = pairOf('R', 'K');
    ref.setMolecules(TARGET, 1e9);
    ref.setMolecules(Y, 1e8);
    ref.setMolecules(YR, 1e8);
    ref.setMolecules(R, 1e8);
    ref.setTemperature(2);
    for (let t = 0; t < 50; t++) r.step(0.02);
    expect(ref.n[Y] / 1e8).toBeCloseTo(1 - RESERVOIR_FILTER, 3);
    expect(ref.n[YR] / 1e8).toBeCloseTo(1 - RESERVOIR_FILTER, 3);
    // the rest is left as it was, and the heat goes with what's taken
    expect(ref.n[TARGET]).toBe(1e9);
    expect(ref.n[R]).toBe(1e8);
    expect(atomTotal(ref)).toBe(ref.N);
    expect(temperature(ref)).toBeCloseTo(2, 4);
  });

  it("lets the reservoir out its faucet, as far as its valve is open, and slower than a tank at most", () => {
    const r = new Tool('receptacle', 0, undefined, [1]);
    const ref = r.tanks[1];
    ref.setMolecules(TARGET, REFERENCE_START);
    expect(REFERENCE_FLOW).toBeLessThan(MAX_FLOW);
    expect(volume(r.step(0.5)[1]!) / (REFERENCE_FLOW * 0.5)).toBeCloseTo(1, 3);
    r.valves[0] = 0.5;
    expect(volume(r.step(0.5)[1]!) / (0.5 * REFERENCE_FLOW * 0.5)).toBeCloseTo(1, 3);
    r.valves[0] = 0;
    expect(r.step(0.5)[1]).toBe(null);
  });

  it('gauges the reservoir: green for what it holds, red for what the goal still wants, dark above', () => {
    // ten segments of 10 each; 34 held of a goal of 72
    expect(gaugeSegments(34, 72, 100, 10)).toEqual(['held', 'held', 'held', 'wanted', 'wanted', 'wanted', 'wanted', 'wanted', 'off', 'off']);
    // past the goal, nothing's wanted
    expect(gaugeSegments(80, 72, 100, 10).filter((g) => g === 'wanted')).toEqual([]);
  });

  it("is a block of the wall lined up with the wall's panels", () => {
    const { block, top } = STATION;
    const pose = STATION_POSE;
    // the right wall's panels run along it from z = 0, and up from the floor
    for (const z of [pose.z + block.x0, pose.z + block.x1]) expect(z / WALL_PANEL.w).toBeCloseTo(Math.round(z / WALL_PANEL.w), 9);
    for (const y of [top - block.y0, top - block.y1]) expect(y / WALL_PANEL.h).toBeCloseTo(Math.round(y / WALL_PANEL.h), 9);
    expect(TILES.walls.u / 2).toBe(WALL_PANEL.w);
    expect(TILES.walls.v / 3).toBeCloseTo(WALL_PANEL.h, 9);
    expect(pose.y).toBe(top);
    // everything on it is inside it
    const r = new Tool('receptacle', 0);
    for (const tk of r.shape.tanks) {
      expect(tk.x0).toBeGreaterThan(block.x0);
      expect(tk.x1).toBeLessThan(block.x1);
    }
    expect(block.y0).toBeLessThan(STATION.labelY - 5);
    expect(block.y1).toBeGreaterThan(r.shape.valveY);
    // the diverter's display is between the funnel and its waste spigot, right under it
    const { display: d, funnel: f } = STATION;
    expect((d.x0 + d.x1) / 2).toBe(r.shape.spouts[0]);
    expect((d.x0 + d.x1) / 2).toBe((r.shape.tanks[0].x0 + r.shape.tanks[0].x1) / 2);
    expect(d.y0).toBeGreaterThan(f.y + f.h);
    expect(d.y1).toBeLessThan(r.shape.spoutY);
  });
});

describe('swell bulbs', () => {
  const chain = (...atoms: ('R' | 'G' | 'B')[]) =>
    speciesIndex(atoms, bondMask([atoms[0], atoms[1]], [atoms[1], atoms[2]]));

  it('are two bulbs with narrow necks, drawn as big as what they hold', () => {
    const d = new Tool('dilatometer', 0);
    expect(d.tanks.map((v) => v.cap)).toEqual([BULB_BODY_CAP + BULB_NECK_CAP, BULB_BODY_CAP + BULB_NECK_CAP]);
    const pieces = tankPieces(d.shape, 0, tankDepth('dilatometer'));
    expect(spaceOf(pieces) / SPACE_PER_ATOM / d.tanks[0].cap).toBeCloseTo(1, 6);
    expect(heightOf(pieces)).toBe(BULB.sump.h + BULB.h + BULB.neck.h);
    // the neck is narrow next to the bulb, so a little more fluid stands a lot higher in it
    expect(BULB_NECK_CAP / BULB_BODY_CAP).toBeGreaterThan(1 / 8);
    expect(BULB_NECK_CAP / BULB_BODY_CAP).toBeLessThan(1 / 4);
    expect(BULB.neck.h / BULB.h).toBeGreaterThan(3);
  });

  it('stand pressed together, their necks side by side, each filled through a funnel a grid cell from the other', () => {
    const d = new Tool('dilatometer', 0);
    const { neck, tanks, spouts } = d.shape;
    // the necks are a hair apart in the middle, each up from the inner edge of its bulb, and the bulbs don't overlap
    expect(neck!.necks[1] - neck!.necks[0]).toBeCloseTo(neck!.w + BULB.gap, 9);
    expect(neck!.necks[0]).toBe(-neck!.necks[1]);
    neck!.bodies.forEach((bx, k) => {
      expect(Math.abs(neck!.necks[k] - bx) + neck!.w / 2).toBeCloseTo(neck!.body / 2, 9);
      expect(Math.abs(neck!.necks[k])).toBeLessThan(Math.abs(bx));
    });
    expect(neck!.bodies[1] - neck!.bodies[0]).toBeGreaterThanOrEqual(neck!.body);
    // its inlets and spouts are a grid cell apart, outside the bulbs, and each spout is under its inlet
    const inlets = tanks.map((tk) => (tk.x0 + tk.x1) / 2);
    expect(inlets[1] - inlets[0]).toBe(CELL);
    expect(spouts).toEqual(inlets);
    inlets.forEach((x, k) => expect(Math.abs(x)).toBeGreaterThan(Math.abs(neck!.bodies[k]) + neck!.body / 2));
    // each inlet is at the top of its neck, wholly above it, so nothing stands in a funnel below the fluid's level;
    // fluid goes in there, and what no longer fits spills over its lip
    expect(-(neck!.inlet.y + neck!.inlet.h)).toBeGreaterThan(neck!.h);
    const m = tankMouth(d, 0);
    expect(m.x).toBeCloseTo(inlets[0], 9);
    expect(m.y).toBeCloseTo(-neck!.inlet.y, 9);
    expect(m.rim!.y).toBeCloseTo(m.y, 9);
  });

  it('show how much each holds by how far up its neck it stands', () => {
    expect(neckShare(0)).toBe(0);
    expect(neckShare(BULB_BODY_CAP)).toBe(0);
    expect(neckShare(BULB_BODY_CAP + BULB_NECK_CAP / 4)).toBeCloseTo(0.25, 9);
    expect(neckShare(BULB_BODY_CAP + BULB_NECK_CAP)).toBe(1);
    expect(neckShare(2 * (BULB_BODY_CAP + BULB_NECK_CAP))).toBe(1);
    // a bulb that's just full, swelling by a twentieth, climbs its neck by that much of the bulb over the neck
    expect(neckShare(1.05 * BULB_BODY_CAP)).toBeCloseTo((0.05 * BULB_BODY_CAP) / BULB_NECK_CAP, 9);
    // and its level, for how fast it drains, follows it up the neck
    const d = new Tool('dilatometer', 0);
    filled(d.tanks[0], R, BULB_BODY_CAP, 1);
    const foot = d.level(0);
    expect(foot).toBeCloseTo((BULB.sump.h + BULB.h) / (BULB.sump.h + BULB.h + BULB.neck.h), 3);
    filled(d.tanks[0], R, BULB_BODY_CAP + BULB_NECK_CAP / 2, 1);
    expect(d.level(0)).toBeCloseTo(foot + (1 - foot) / 2, 3);
  });

  it('heat both bulbs alike toward the wire, as far as the dial is turned, and not at all with it off', () => {
    const d = new Tool('dilatometer', 0);
    for (const v of d.tanks) filled(v, R, BULB_BODY_CAP, 1);
    for (let i = 0; i < 500; i++) d.step(0.02);
    expect(d.tanks.map(temperature)).toEqual([1, 1]);
    d.valves[d.shape.dial!] = 0.5;
    const wire = wireTemperature(0.5);
    for (let i = 0; i < 5000; i++) d.step(0.02);
    for (const v of d.tanks) expect(temperature(v) / wire).toBeCloseTo(1, 3);
    // nothing leaves with its valves shut
    expect(d.tanks.map((v) => v.N)).toEqual([BULB_BODY_CAP, BULB_BODY_CAP]);
  });

  it('drain slowly, each through its own valve', () => {
    const d = new Tool('dilatometer', 0, undefined, [1, 0, 0]);
    for (const v of d.tanks) filled(v, R, BULB_BODY_CAP + BULB_NECK_CAP, 1);
    const out = d.step(0.1);
    expect(out[0]!.N / (PIPETTE_FLOW * 0.1)).toBeCloseTo(1, 6);
    expect(out[1]).toBeNull();
  });

  it('show chains among triangles: heated, a chain splits in two, and a triangle only opens', () => {
    // the fixed test chemistry: its R–G bond breaks at the wire's hottest, and its blue bonds never do
    const net = new ReactionNetwork(testChemParams());
    const d = new Tool('dilatometer', 0);
    const [pure, mixed] = d.tanks;
    pure.setMolecules(TARGET, BULB_BODY_CAP);
    mixed.setMolecules(TARGET, 0.8 * BULB_BODY_CAP);
    mixed.setMolecules(chain('R', 'G', 'B'), 0.1 * BULB_BODY_CAP);
    mixed.setMolecules(chain('G', 'R', 'B'), 0.1 * BULB_BODY_CAP);
    for (const v of d.tanks) v.setTemperature(1);
    d.valves[d.shape.dial!] = 1;
    for (let i = 0; i < 2000; i++) {
      d.step(0.01);
      for (const v of d.tanks) net.step(v, 0.01);
    }
    expect(volume(pure)).toBe(BULB_BODY_CAP);
    expect(neckShare(volume(pure))).toBe(0);
    expect(volume(mixed)).toBeGreaterThan(BULB_BODY_CAP);
    expect(neckShare(volume(mixed))).toBeGreaterThan(0);
  });
});

describe('wicking strip', () => {
  const chain = (...atoms: ('R' | 'G' | 'B')[]) =>
    speciesIndex(atoms, bondMask([atoms[0], atoms[1]], [atoms[1], atoms[2]]));
  const B = singleOf('B');
  const run = (t: Tool, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / 0.02); i++) t.step(0.02);
  };

  it('runs each species some way along it: lighter further, and a ring further than a chain of the same atoms', () => {
    for (const r of STRIP_RUN) {
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
    }
    // single atoms, lightest first, ahead of everything else
    const singles = SPECIES.filter((sp) => sp.size === 1).sort((a, b) => a.weight - b.weight);
    for (let i = 1; i < singles.length; i++) expect(STRIP_RUN[singles[i].i]).toBeLessThan(STRIP_RUN[singles[i - 1].i]);
    for (const sp of SPECIES) if (sp.size > 1) expect(STRIP_RUN[sp.i]).toBeLessThan(STRIP_RUN[singles[singles.length - 1].i]);
    // the triangle, with no loose ends, ahead of all three chains of its atoms, which are each somewhere of their own
    const chains = [chain('R', 'G', 'B'), chain('G', 'R', 'B'), chain('R', 'B', 'G')];
    for (const c of chains) expect(STRIP_RUN[TARGET] - STRIP_RUN[c]).toBeGreaterThan(10 * STRIP.width);
    const at = chains.map((c) => STRIP_RUN[c]).sort((a, b) => a - b);
    expect(at[1] - at[0]).toBeGreaterThan(2 * STRIP.width);
    expect(at[2] - at[1]).toBeGreaterThan(2 * STRIP.width);
  });

  it('shows a little of something nearly as darkly as a lot of it', () => {
    const v = new Vessel(Infinity);
    v.setMolecules(TARGET, 0.95 * STRIP.cap);
    v.setMolecules(chain('R', 'G', 'B'), 0.05 * STRIP.cap);
    const bands = stripBands(v);
    expect(bands.map((b) => b.s)).toEqual([TARGET, chain('R', 'G', 'B')]);
    expect(bands[0].ink).toBeGreaterThan(0.99);
    expect(bands[1].ink).toBeGreaterThan(0.4);
    expect(bands[1].ink).toBeLessThan(bands[0].ink);
    // too little on the paper, and every band is fainter
    const drop = new Vessel(Infinity);
    drop.setMolecules(TARGET, (STRIP.faint * STRIP.cap) / 4);
    expect(stripBands(drop)[0].ink).toBeCloseTo(0.5, 3);
    expect(stripBands(new Vessel(Infinity))).toEqual([]);
  });

  it('takes up a little of what lands in its pad, and draws it along itself once, then is done', () => {
    const t = new Tool('strip', 0);
    const [pad] = t.tanks;
    expect(t.shape.spouts).toEqual([]);
    expect(t.isOpen(0)).toBe(true);
    run(t, 5);
    expect(t.wet).toBe(0);
    filled(pad, R, pad.cap, 1);
    run(t, STRIP.time / 4);
    // the paper has all it can hold, and the rest stays in the pad; the front is halfway in a quarter of the time,
    // since it goes as the square root of it
    expect(volume(t.sample!)).toBe(STRIP.cap);
    expect(pad.N).toBe(pad.cap - STRIP.cap);
    expect(t.wet).toBeCloseTo(0.5, 2);
    expect(t.isOpen(0)).toBe(true);
    run(t, STRIP.time / 4);
    expect(t.wet).toBeCloseTo(Math.SQRT1_2, 2);
    run(t, STRIP.time / 2 + 0.1);
    expect(t.wet).toBe(1);
    expect(t.scorch).toBe(0);
    // dry, it's lidded, and takes up nothing more
    expect(t.isOpen(0)).toBe(false);
    const before = [...t.sample!.n];
    filled(pad, B, pad.cap, 1);
    run(t, 5);
    expect([...t.sample!.n]).toEqual(before);
    expect(t.step(0.02)).toEqual([]);
  });

  it('is scorched by what it takes up hot', () => {
    const { from, to } = STRIP.scorch;
    expect(scorchAt(from)).toBe(0);
    expect(scorchAt((from + to) / 2)).toBeCloseTo(0.5, 9);
    expect(scorchAt(2 * to)).toBe(1);
    const t = new Tool('strip', 0);
    filled(t.tanks[0], R, STRIP.cap / 2, (from + to) / 2);
    run(t, 1);
    expect(t.scorch).toBeCloseTo(0.5, 2);
    // and stays as scorched as it's been, whatever it takes up after
    filled(t.tanks[0], R, STRIP.cap / 4, from);
    run(t, 1);
    expect(t.scorch).toBeCloseTo(0.5, 2);
  });

  it('keeps how far it has run and how scorched it is in a save', () => {
    const t = new Tool('strip', 0);
    t.remember([0.4, 0.25]);
    expect(t.memory).toEqual([0.4, 0.25]);
    t.remember([7, -3]);
    expect(t.memory).toEqual([1, 0]);
  });
});

describe('sleeper culture', () => {
  const chain = speciesIndex(['R', 'G', 'B'], bondMask(['R', 'G'], ['G', 'B']));
  const ring4 = speciesIndex(['R', 'G', 'B', 'K'], bondMask(['R', 'G'], ['G', 'B'], ['B', 'K'], ['R', 'K']));
  const run = (t: Tool, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / 0.02); i++) t.step(0.02);
  };
  const count = (t: Tool) => t.dead!.reduce((n, d) => n + d, 0);
  /** A plate holding `share` of what it can, all of species `s`, at room temperature. */
  const plate = (s: number, share = 1) => {
    const t = new Tool('culture', 0);
    t.tanks[0].setMolecules(s, share * t.tanks[0].cap);
    t.tanks[0].setTemperature(1);
    return t;
  };

  it('is harmed by loose ends and lone atoms, not by rings', () => {
    const v = new Vessel(Infinity);
    expect(harm(v)).toBe(0);
    v.setMolecules(TARGET, 950);
    v.setMolecules(ring4, 50);
    v.setTemperature(1);
    expect(harm(v)).toBe(0);
    // a chain has two loose ends: a twentieth of the molecules chains is a tenth of a loose end each
    v.setMolecules(ring4, 0);
    v.setMolecules(chain, 50);
    expect(harm(v)).toBeCloseTo(0.1, 12);
    const pair = new Vessel(Infinity);
    pair.setMolecules(pairOf('R', 'G'), 1000);
    expect(harm(pair)).toBe(2);
    const atoms = new Vessel(Infinity);
    atoms.setMolecules(R, 1000);
    expect(harm(atoms)).toBe(1);
  });

  it('is harmed by heat too', () => {
    const v = new Vessel(Infinity);
    v.setMolecules(TARGET, 1000);
    const { from, per } = CULTURE.heat;
    v.setTemperature(from);
    expect(harm(v)).toBe(0);
    v.setTemperature(from + 3);
    expect(harm(v)).toBeCloseTo(3 * per, 6);
  });

  it('has its cells in rows on the plate, each row half a step out of line with the next', () => {
    const cells = cultureCells();
    const tk = SHAPES.culture.tanks[0];
    expect(cells.length).toBeGreaterThan(100);
    for (const c of cells) {
      expect(c.x).toBeGreaterThan(tk.x0);
      expect(c.x).toBeLessThan(tk.x1);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(SHAPES.culture.tankH!);
    }
    const rows = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
    const firstX = (y: number) => Math.min(...cells.filter((c) => c.y === y).map((c) => c.x));
    expect(Math.abs(firstX(rows[1]) - firstX(rows[0]))).toBeCloseTo(CULTURE.pitch / 2, 9);
    expect(new Tool('culture', 0).dead).toHaveLength(cells.length);
    expect(new Tool('dispenser', 0).dead).toBeNull();
  });

  it('is never harmed by the target, however long it stands in it', () => {
    const t = plate(TARGET);
    run(t, 600);
    expect(count(t)).toBe(0);
  });

  it('drains through its valve, keeping its cells as they are, for a record', () => {
    const t = plate(R);
    expect(t.shape.spouts).toEqual([0]);
    // shut, nothing leaves
    expect(t.step(0.02)[0]).toBeNull();
    run(t, Math.LN2 / CULTURE.rate);
    // open, it's empty in a few seconds, and what was in it came out its spout
    const held = t.tanks[0].N;
    t.valves[0] = 1;
    let out = 0;
    for (let i = 0; i < 1500 && t.tanks[0].N > 0; i++) out += t.step(0.02)[0]?.N ?? 0;
    expect(t.tanks[0].N).toBe(0);
    // but for the last trace of it, which counts as nothing
    expect(held - out).toBeLessThan(TRACE);
    // some died while it stood and drained, not all; and dry, the plate stays as it is
    const dead = Array.from(t.dead!);
    expect(count(t)).toBeGreaterThan(0);
    expect(count(t)).toBeLessThan(dead.length);
    run(t, 600);
    expect(Array.from(t.dead!)).toEqual(dead);
  });

  it('loses its cells at random, half of them in the time its rate and the harm give', () => {
    // lone atoms do one unit of harm
    const halfLife = Math.LN2 / (CULTURE.rate * 1);
    let dead = 0;
    let all = 0;
    for (let i = 0; i < 8; i++) {
      const t = plate(R);
      run(t, halfLife);
      dead += count(t);
      all += t.dead!.length;
    }
    // over a thousand cells: within a few percent of half
    expect(dead / all).toBeGreaterThan(0.43);
    expect(dead / all).toBeLessThan(0.57);
    // and in the end, all of them, for good
    const t = plate(R);
    run(t, 40 * halfLife);
    expect(count(t)).toBe(t.dead!.length);
    t.tanks[0].setMolecules(R, 0);
    run(t, 10);
    expect(count(t)).toBe(t.dead!.length);
  });

  it('loses them sooner the more harmful the fluid', () => {
    const after = (s: number, seconds: number) => {
      let n = 0;
      for (let i = 0; i < 6; i++) {
        const t = plate(s);
        run(t, seconds);
        n += count(t);
      }
      return n;
    };
    const seconds = 1 / CULTURE.rate;
    // a pair has two loose ends to a lone atom's one
    expect(after(pairOf('R', 'G'), seconds)).toBeGreaterThan(after(R, seconds));
  });

  it('only loses the cells the fluid covers', () => {
    // a third full, the fluid stands partway up the plate, and no cell above it dies
    const t = plate(R, 1 / 3);
    const H = SHAPES.culture.tankH!;
    const surface = cultureLevel(1 / 3);
    expect(surface).toBeGreaterThan(0.2 * H);
    expect(surface).toBeLessThan(0.8 * H);
    run(t, 60 / CULTURE.rate);
    const cells = cultureCells();
    const under = cells.map((c) => H - c.y < surface);
    expect(under.some((u) => u)).toBe(true);
    expect(under.some((u) => !u)).toBe(true);
    cells.forEach((_, i) => expect(t.dead![i]).toBe(under[i] ? 1 : 0));
    // and an empty plate loses none
    const dry = new Tool('culture', 0);
    run(dry, 60);
    expect(count(dry)).toBe(0);
  });

  it('keeps which cells are dead in a save', () => {
    const t = new Tool('culture', 0);
    const m = Array.from(t.dead!, (_, i) => +(i % 3 === 0));
    t.remember(m);
    expect(t.memory).toEqual(m);
    // a list of another length isn't its cells
    t.remember([1, 1]);
    expect(t.memory).toEqual(m);
  });
});

describe('thermometer', () => {
  /** Run `t` for `seconds`, with `flow` (by volume per sim second) of R at temperature T streaming through it. */
  function stream(t: Tool, seconds: number, flow: number, T: number): void {
    for (let i = 0; i < Math.round(seconds / 0.02); i++) {
      if (flow > 0) filled(t.tanks[0], R, flow * 0.02, T);
      t.step(0.02);
    }
  }

  it('is an inline instrument that lets everything through', () => {
    const t = new Tool('thermometer', 0);
    expect(INLINE_TOOLS).toContain('thermometer');
    filled(t.tanks[0], R, 1e7, 3);
    expect(t.step(0.02)[0]?.N).toBe(1e7);
    expect(t.tanks[0].N).toBe(0);
  });

  it('starts at the room\'s temperature, and takes that of what streams past it, with a lag', () => {
    const t = new Tool('thermometer', 0);
    expect(t.temp).toBe(COOLING.ambient);
    const hot = COOLING.ambient + 4;
    stream(t, THERMOMETER.tau, THERMOMETER.flow, hot);
    // all but 1/e of the way there after tau
    expect((t.temp - COOLING.ambient) / (hot - COOLING.ambient)).toBeCloseTo(1 - 1 / Math.E, 2);
    stream(t, 10 * THERMOMETER.tau, 5 * THERMOMETER.flow, hot);
    expect(t.temp).toBeCloseTo(hot, 3);
  });

  it('reads between a trickle and the room', () => {
    const t = new Tool('thermometer', 0);
    const hot = COOLING.ambient + 4;
    stream(t, 60 * THERMOMETER.roomTau, THERMOMETER.flow / 4, hot);
    expect(t.temp).toBeGreaterThan(COOLING.ambient + 0.5);
    expect(t.temp).toBeLessThan(hot - 0.5);
  });

  it('drifts back to the room\'s temperature with nothing passing, leaving its markers at the extremes', () => {
    const t = new Tool('thermometer', 0);
    const hot = COOLING.ambient + 4;
    stream(t, 12 * THERMOMETER.tau, THERMOMETER.flow, hot);
    stream(t, 40 * THERMOMETER.roomTau, 0, 0);
    expect(t.temp).toBe(COOLING.ambient);
    expect(t.hi).toBeCloseTo(hot, 3);
    expect(t.lo).toBe(COOLING.ambient);
    const cold = COOLING.ambient / 2;
    stream(t, 12 * THERMOMETER.tau, THERMOMETER.flow, cold);
    expect(t.lo).toBeCloseTo(cold, 3);
    expect(t.hi).toBeCloseTo(hot, 3);
    // shaking it brings both markers back to what it reads
    t.shake();
    expect([t.hi, t.lo]).toEqual([t.temp, t.temp]);
  });

  it('has a logarithmic scale', () => {
    const { T0, T1 } = THERMOMETER;
    expect(thermometerAt(T0)).toBe(0);
    expect(thermometerAt(T0 / 10)).toBe(0);
    expect(thermometerAt(T1)).toBeCloseTo(1, 12);
    expect(thermometerAt(10 * T1)).toBe(1);
    expect(thermometerAt(Math.sqrt(T0 * T1))).toBeCloseTo(0.5, 12);
  });

  it('keeps its reading and markers in a save, and ignores a bad one', () => {
    const t = new Tool('thermometer', 0);
    t.remember([3, 7, 0.5]);
    expect(t.memory).toEqual([3, 7, 0.5]);
    t.remember([1, 2]);
    t.remember('x');
    t.remember([1, NaN, 2]);
    expect(t.memory).toEqual([3, 7, 0.5]);
    expect(new Tool('dispenser', 1).memory).toBeUndefined();
  });
});

describe('dispenser', () => {
  it('dispenses valve × MAX_FLOW × how high its fluid stands, per sim second', () => {
    const d = new Tool('dispenser', 0, undefined, [0.5]);
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
    const d = new Tool('dispenser', 0);
    filled(d.tanks[0], R, CAP, 1);
    expect(d.step(0.1)).toEqual([null]);
    expect(d.tanks[0].N).toBe(CAP);
    d.valves[0] = 1;
    d.tanks[0].setMolecules(R, 0);
    expect(d.step(0.1)).toEqual([null]);
  });

  it('measures its fluid from the tip of its sump, so a thin layer across the floor still drains steadily', () => {
    const d = new Tool('dispenser', 0, undefined, [1]);
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
    const d = new Tool('dispenser', 0, undefined, [1]);
    filled(d.tanks[0], R, TANK_CAP, 1);
    let t = 0;
    for (; d.tanks[0].N > 0 && t < 120; t += 0.02) d.step(0.02);
    expect(d.tanks[0].N).toBe(0);
    expect(t).toBeLessThan(30);
  });

  it('empties completely in the end, rather than leaving a trace behind', () => {
    const d = new Tool('dispenser', 0, undefined, [1]);
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
    const sp = new Tool('splitter', 0, undefined, valve === undefined ? [] : [valve]);
    filled(sp.tanks[0], R, FUNNEL_CAP, 4);
    const [l, r] = sp.step(0.05);
    return { sp, l, r };
  }

  it('drains its funnel at FUNNEL_RATE times how high the fluid stands, so half full at half the rate', () => {
    const sp = new Tool('splitter', 0);
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
    expect(new Tool('splitter', 0).tanks[0].cap).toBe(FUNNEL_CAP);
  });
});

describe('multiplexer', () => {
  /** A step of a multiplexer with its valve at `valve`, its left funnel full of R at T 2 and its right full of G at T 6. */
  function run(valve: number | undefined, h = 0.01) {
    const mx = new Tool('multiplexer', 0, undefined, valve === undefined ? [] : [valve]);
    filled(mx.tanks[0], R, FUNNEL_CAP, 2);
    filled(mx.tanks[1], G, FUNNEL_CAP, 6);
    const [out] = mx.step(h);
    return { mx, out };
  }

  it('has two funnels, holding only a little, and one spout', () => {
    const mx = new Tool('multiplexer', 0);
    expect(mx.tanks.map((v) => v.cap)).toEqual([FUNNEL_CAP, FUNNEL_CAP]);
    expect(mx.shape.spouts).toHaveLength(1);
    expect(mx.valves).toEqual([0.5]);
  });

  it('takes only from the left with the valve at 0, and only from the right at 1, at FUNNEL_RATE', () => {
    for (const [v, from, other] of [[0, R, G], [1, G, R]] as const) {
      const { out } = run(v);
      expect(out!.n[other]).toBe(0);
      expect(out!.N / (FUNNEL_RATE * 0.01)).toBeCloseTo(1, 6);
      expect(out!.n[from]).toBe(out!.N);
    }
  });

  it('shares FUNNEL_RATE out between its funnels by the valve, mixing them, heat and all', () => {
    const { mx, out } = run(0.25);
    expect(out!.N / (FUNNEL_RATE * 0.01)).toBeCloseTo(1, 6);
    expect(out!.n[G] / out!.N).toBeCloseTo(0.25, 3);
    expect(temperature(out!)).toBeCloseTo(0.75 * 2 + 0.25 * 6, 2);
    expect(out!.N + mx.tanks[0].N + mx.tanks[1].N).toBe(2 * FUNNEL_CAP);
  });

  it('drains each funnel in proportion to how high its fluid stands', () => {
    const mx = new Tool('multiplexer', 0, undefined, [0]);
    filled(mx.tanks[0], R, FUNNEL_CAP / 2, 1);
    const [out] = mx.step(0.01);
    expect(out!.N / (FUNNEL_RATE * 0.5 * 0.01)).toBeCloseTo(1, 5);
  });

  it('lets nothing out of an empty funnel the valve picks, however full the other', () => {
    const mx = new Tool('multiplexer', 0, undefined, [1]);
    filled(mx.tanks[0], R, FUNNEL_CAP, 1);
    expect(mx.step(0.01)).toEqual([null]);
    expect(mx.tanks[0].N).toBe(FUNNEL_CAP);
  });
});

describe('size sorter', () => {
  const RG = pairOf('R', 'G');

  const withStrength = (k: number, fn: () => void) => {
    const before = SORTER.strength;
    SORTER.strength = k;
    try {
      fn();
    } finally {
      SORTER.strength = before;
    }
  };
  const FOUR = speciesIndex(['R', 'G', 'B', 'K'], 63);
  /** Each size's shares out the four spouts, sorting singles, pairs, triples and fours at the current strength. */
  function sort() {
    const so = new Tool('sorter', 0);
    const f = so.tanks[0];
    f.setMolecules(R, 4e7);
    f.setMolecules(RG, 3e7);
    f.setMolecules(TARGET, 2e7);
    f.setMolecules(FOUR, 1e7);
    f.setTemperature(3);
    const before = { N: f.N, Q: f.Q };
    const outs = so.step(0.02).map((v) => v ?? new Vessel(Infinity));
    expect(outs).toHaveLength(SORTER_OUTLETS);
    expect(so.shape.spouts).toHaveLength(SORTER_OUTLETS);
    // nothing made or lost, and the heat goes with the atoms
    expect(outs.reduce((t, v) => t + v.N, 0) + f.N).toBe(before.N);
    expect(outs.reduce((t, v) => t + v.Q, 0) + f.Q).toBe(before.Q);
    return [R, RG, TARGET, FOUR].map((sp) => {
      const total = outs.reduce((t, v) => t + v.n[sp], 0);
      return outs.map((v) => v.n[sp] / total);
    });
  }

  it('sends each size out its own spout, 1/4 + 3/4·strength of it, and the rest evenly out the others', () => {
    for (const k of [0.2, 0.6, 0.9]) {
      withStrength(k, () => {
        sort().forEach((shares, own) =>
          shares.forEach((x, j) => expect(x).toBeCloseTo(j === own ? 1 / 4 + (3 / 4) * k : (1 - k) / 4, 2)),
        );
      });
    }
  });

  it('splits every size evenly at strength 0, and sorts perfectly at 1', () => {
    withStrength(0, () => sort().forEach((shares) => shares.forEach((x) => expect(x).toBeCloseTo(1 / 4, 2))));
    withStrength(1, () => expect(sort()).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]));
  });

  it('sends triples through the third screen and fours off the end, apart', () => {
    withStrength(1, () => {
      const so = new Tool('sorter', 0);
      filled(so.tanks[0], FOUR, FUNNEL_CAP / 2, 1);
      so.tanks[0].setMolecules(TARGET, so.tanks[0].n[FOUR]);
      const outs = so.step(0.02);
      expect(outs[0]?.N ?? 0).toBe(0);
      expect(outs[1]?.N ?? 0).toBe(0);
      expect(outs[2]!.n[TARGET]).toBeGreaterThan(0);
      expect(outs[2]!.n[FOUR]).toBe(0);
      expect(outs[3]!.n[FOUR]).toBeGreaterThan(0);
      expect(outs[3]!.n[TARGET]).toBe(0);
    });
  });

  it('keeps the temperature of what it sorts', () => {
    const so = new Tool('sorter', 0);
    filled(so.tanks[0], R, FUNNEL_CAP, 3);
    for (const v of so.step(0.02)) if (v) expect(temperature(v)).toBeCloseTo(3, 2);
  });

  it('drains its funnel at FUNNEL_RATE times how high the fluid stands, with no valve', () => {
    for (const share of [1, 0.25]) {
      const so = new Tool('sorter', 0);
      filled(so.tanks[0], R, FUNNEL_CAP * share, 4);
      const out = so.step(0.01).reduce((t, v) => t + (v?.N ?? 0), 0);
      expect(out / (FUNNEL_RATE * share * 0.01)).toBeCloseTo(1, 5);
      expect(so.shape.noValve).toBe(true);
    }
  });
});

describe('composition analyzer', () => {
  const RG = pairOf('R', 'G');
  const B = singleOf('B');
  const at = (size: number, atom: 'R' | 'G' | 'B' | 'K') => (size - 1) * 4 + SECTOR_ATOMS.indexOf(atom);

  const CUP = 1e7;
  /** A sample's reading against CUP, filled with each species by volume. */
  const read = (fill: [number, number][]) => {
    const v = new Vessel(CUP);
    for (const [s, room] of fill) v.setMolecules(s, room / roomFor(s));
    return composition(v, CUP);
  };

  it("reads the share of the sample each size's molecules with each color make up", () => {
    // 20% R, 20% G, 30% B and 30% R–G
    const r = read([[R, 0.2 * CUP], [G, 0.2 * CUP], [B, 0.3 * CUP], [RG, 0.3 * CUP]]);
    const want = new Array(16).fill(0);
    want[at(1, 'R')] = 0.2;
    want[at(1, 'G')] = 0.2;
    want[at(1, 'B')] = 0.3;
    want[at(2, 'R')] = 0.3;
    want[at(2, 'G')] = 0.3;
    r.forEach((x, i) => expect(x).toBeCloseTo(want[i], 9));
  });

  it('lights a sample of one species fully in each of its sectors', () => {
    expect(read([[R, CUP]])[at(1, 'R')]).toBe(1);
    const rg = read([[RG, CUP]]);
    expect([rg[at(2, 'R')], rg[at(2, 'G')]]).toEqual([1, 1]);
    const t = read([[TARGET, CUP]]);
    // as near full as whole triangles get
    for (const a of ['R', 'G', 'B'] as const) expect(t[at(3, a)]).toBeCloseTo(1, 6);
    const four = read([[speciesIndex(['R', 'G', 'B', 'K'], 63), CUP]]);
    for (const a of ['R', 'G', 'B', 'K'] as const) expect(four[at(4, a)]).toBeCloseTo(1, 6);
  });

  it('reads a half share half as bright, and nothing dark', () => {
    expect(read([[R, CUP]])[at(1, 'R')]).toBe(2 * read([[R, 0.5 * CUP], [G, 0.1 * CUP]])[at(1, 'R')]);
    expect(composition(new Vessel(CUP), CUP).every((x) => x === 0)).toBe(true);
  });

  it('drains its tube straight through, drawing off a share out its waste spout', () => {
    const a = new Tool('analyzer', 0);
    expect(a.shape.noValve).toBe(true);
    expect(a.tanks[0].cap).toBe(TUBE_CAP);
    filled(a.tanks[0], R, TUBE_CAP, 3);
    const [main, waste] = a.step(0.01);
    const out = main!.N + waste!.N;
    expect(out / (FUNNEL_RATE * 0.01)).toBeCloseTo(1, 6);
    expect(waste!.N / out).toBeCloseTo(ANALYZER_SAMPLE, 3);
    expect(temperature(main!)).toBeCloseTo(3, 6);
    expect(temperature(waste!)).toBeCloseTo(3, 2);
  });

  it("reads what it drew off lately, as shares of it, fading out smoothly once nothing passes, then dark", () => {
    const a = new Tool('analyzer', 0);
    expect(a.reading).toBeNull();
    const src = new Vessel(Infinity);
    src.setMolecules(R, CAP);
    src.setMolecules(RG, CAP);
    const run = (secs: number, on: boolean) => {
      for (let i = 0; i < Math.round(secs / 0.02); i++) {
        if (on) a.tanks[0].addFrom(src, 0.25 * CAP * 0.02);
        a.step(0.02);
      }
    };
    run(4 * INSTRUMENT_TAU, true);
    // by volume, half R and half R–G
    expect(a.reading![at(1, 'R')]).toBeCloseTo(0.5, 1);
    expect(a.reading![at(2, 'R')]).toBeCloseTo(0.5, 1);
    expect(a.reading![at(2, 'G')]).toBeCloseTo(0.5, 1);
    expect(a.reading![at(3, 'R')]).toBe(0);
    // as it fades it still reads the same mix
    run(2 * INSTRUMENT_TAU, false);
    expect(a.reading![at(1, 'R')]).toBeCloseTo(0.5, 1);
    run(30 * INSTRUMENT_TAU, false);
    expect(a.reading).toBeNull();
  });
});

describe('spectroscope', () => {
  const bond = (k: string) => BOND_KEYS.indexOf(k);

  it('knows every bond the chemistry has, once each', () => {
    expect([...BOND_KEYS].sort()).toEqual(Object.keys(testChemParams().bonds).sort());
  });

  it("counts each molecule's bonds", () => {
    const v = new Vessel(Infinity);
    v.setMolecules(R, 5);
    v.setMolecules(TARGET, 7);
    v.setMolecules(speciesIndex(['R', 'G', 'K'], bondMask(['R', 'G'], ['R', 'K'])), 2); // G–R–K
    const c = bondCounts(v);
    expect(c[bond('RG')]).toBe(9);
    expect(c[bond('RB')]).toBe(7);
    expect(c[bond('GB')]).toBe(7);
    expect(c[bond('RK')]).toBe(2);
    expect(c.reduce((a, b) => a + b, 0)).toBe(25);
  });

  it("draws each bond as a Gaussian at the log of its energy's size, up if it's stable and down if it's uphill", () => {
    const { width: w } = SPECTROSCOPE;
    const energies = BOND_KEYS.map((_, i) => (i === 0 ? 8 : i === 1 ? -3 : 0));
    const counts = BOND_KEYS.map((_, i) => (i === 0 ? 1000 : i === 1 ? 300 : i === 2 ? 1e9 : 0));
    expect(spectroscopeAt(Math.log(8), counts, energies).up).toBeCloseTo(1000, 6);
    expect(spectroscopeAt(Math.log(3), counts, energies)).toEqual({ up: expect.closeTo(0, 6), down: expect.closeTo(300, 6) });
    expect(spectroscopeAt(Math.log(8) + w, counts, energies).up).toBeCloseTo(1000 * Math.exp(-0.5), 6);
    // far from both, nothing; and the bond with no energy shows nowhere
    const far = spectroscopeAt(Math.log(5), counts, energies);
    expect(far.up + far.down).toBeLessThan(1e-6);
    // two bonds at one energy add up
    expect(spectroscopeAt(Math.log(2), BOND_KEYS.map(() => 5), BOND_KEYS.map(() => 2)).up).toBeCloseTo(5 * BOND_KEYS.length, 6);
  });

  it('ranges its f axis to the tallest line, on a log scale', () => {
    const { decades, headroom } = SPECTROSCOPE;
    expect(spectroscopeTop(0)).toBe(0);
    expect(spectroscopeY(5, 0)).toBe(0);
    for (const tallest of [1e3, 1e6, 1e9]) {
      const top = spectroscopeTop(tallest);
      expect(top).toBeCloseTo(tallest * headroom, 6);
      expect(spectroscopeY(top, top)).toBeCloseTo(1, 9);
      expect(spectroscopeY(0, top)).toBe(0);
      // the tallest line stands at the same height whatever the flow, so the scale, not the line, moves
      expect(spectroscopeY(tallest, top)).toBeCloseTo(spectroscopeY(1, spectroscopeTop(1)), 9);
      // well above the floor, each tenfold stands the same step taller
      const step = (f: number) => spectroscopeY(10 * f, top) - spectroscopeY(f, top);
      expect(step(top / 100)).toBeCloseTo(step(top / 10), 2);
      expect(step(top / 100)).toBeCloseTo(1 / decades, 2);
      // and it rises the whole way up
      expect(spectroscopeY(top / 10 ** decades, top)).toBeGreaterThan(0);
      expect(spectroscopeY(top / 10 ** decades, top)).toBeLessThan(spectroscopeY(top / 10 ** (decades - 1), top));
    }
  });

  it('numbers its f axis in S with the SI prefix that keeps the numbers short', () => {
    const { perS, decades, headroom } = SPECTROSCOPE;
    expect(spectroscopeUnit(0)).toEqual({ name: 'S', exp: 0 });
    for (let d = -6; d <= 6; d++) {
      const top = spectroscopeTop(10 ** d * perS);
      const { name, exp } = spectroscopeUnit(top);
      expect(Math.abs(exp % 3)).toBe(0);
      expect(name).toMatch(/^[num]?S$|^[kMG]S$/);
      // every power of ten the axis shows is numbered within a thousandfold of 1 in that unit
      const hi = Math.floor(Math.log10(top / perS));
      const lo = Math.ceil(Math.log10(top / perS) - decades);
      expect(hi - exp).toBeLessThanOrEqual(3);
      expect(lo - exp).toBeGreaterThanOrEqual(-3);
      // ten times the flow never moves the prefix down
      expect(spectroscopeUnit(top * 10).exp).toBeGreaterThanOrEqual(exp);
    }
    // the prefix follows the flow: a thousandfold more, one prefix up
    expect(spectroscopeUnit(1e3 * headroom * perS).exp).toBe(spectroscopeUnit(headroom * perS).exp + 3);
  });

  it('lets everything through, reading the bonds passing lately, per sim second, rising and falling smoothly', () => {
    const sc = new Tool('spectroscope', 0);
    expect(sc.shape.spouts).toHaveLength(1);
    const src = new Vessel(Infinity);
    src.setMolecules(TARGET, CAP);
    const feed = 0.1 * CAP; // molecules per sim second
    let through = 0;
    const run = (secs: number, on: boolean) => {
      for (let i = 0; i < Math.round(secs / 0.02); i++) {
        if (on) sc.tanks[0].addFrom(src, feed * 0.02);
        through += sc.step(0.02)[0]?.n[TARGET] ?? 0;
      }
    };
    // a step up shows at once, but only in part
    run(0.1, true);
    expect(sc.bonds[bond('RG')]).toBeGreaterThan(0);
    expect(sc.bonds[bond('RG')]).toBeLessThan(0.5 * feed);
    run(20 * INSTRUMENT_TAU, true);
    expect(through / ((0.1 + 20 * INSTRUMENT_TAU) * feed)).toBeCloseTo(1, 2);
    for (const k of ['RG', 'RB', 'GB']) expect(sc.bonds[bond(k)] / feed).toBeCloseTo(1, 2);
    expect(sc.bonds[bond('BK')]).toBe(0);
    // and a step down fades: about e^-1 of it is left after INSTRUMENT_TAU
    run(INSTRUMENT_TAU, false);
    expect(sc.bonds[bond('RG')] / feed).toBeGreaterThan(0.25);
    expect(sc.bonds[bond('RG')] / feed).toBeLessThan(0.45);
    run(40 * INSTRUMENT_TAU, false);
    expect(sc.bonds.every((c) => c === 0)).toBe(true);
  });
});

describe('bond visualizer', () => {
  const bond = (k: string) => BOND_KEYS.indexOf(k);
  const RG = pairOf('R', 'G');

  it('is a one-of-a-kind inline instrument with one spout', () => {
    expect(INLINE_TOOLS).toContain('visualizer');
    expect(UNIQUE_TOOLS).toContain('visualizer');
    expect(new Tool('visualizer', 0).shape.spouts).toHaveLength(1);
  });

  it('puts G at the top of a triangle, R at its bottom left, B at its bottom right and K in its middle', () => {
    const { x, y, r } = BOND_TRIANGLE;
    const at = (a: 'R' | 'G' | 'B' | 'K') => bondPoint(SECTOR_ATOMS.indexOf(a));
    expect(at('G').x).toBeCloseTo(x, 9);
    expect(at('G').y).toBeCloseTo(y - r, 9);
    expect(at('R').x).toBeCloseTo(x - (r * Math.sqrt(3)) / 2, 9);
    expect(at('B').x).toBeCloseTo(x + (r * Math.sqrt(3)) / 2, 9);
    expect(at('R').y).toBeCloseTo(y + r / 2, 9);
    expect(at('B').y).toBeCloseTo(y + r / 2, 9);
    expect(at('K')).toEqual({ x, y });
    // equilateral: every corner as far from each other corner
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
    expect(d(at('G'), at('R'))).toBeCloseTo(d(at('R'), at('B')), 9);
    expect(d(at('G'), at('B'))).toBeCloseTo(d(at('R'), at('B')), 9);
  });

  it("cuts the analyzer's triangle into four equal ones, each corner's atom at its corner and K upside down in the middle", () => {
    const area = (ps: (readonly [number, number])[]) =>
      Math.abs((ps[1][0] - ps[0][0]) * (ps[2][1] - ps[0][1]) - (ps[2][0] - ps[0][0]) * (ps[1][1] - ps[0][1])) / 2;
    const whole = area((['G', 'B', 'R'] as const).map((a) => ATOM_PLACE[a]));
    for (const a of SECTOR_ATOMS) {
      const s = analyzerSector(a);
      expect(s).toHaveLength(3);
      expect(area(s)).toBeCloseTo(whole / 4, 9);
      // each sector is centered on its atom's place, between the corner and the middle for a corner's
      const mid = [0, 1].map((k) => (s[0][k] + s[1][k] + s[2][k]) / 3);
      const want = a === 'K' ? [0, 0] : ATOM_PLACE[a].map((v) => v / 2);
      expect(mid[0]).toBeCloseTo(want[0], 9);
      expect(mid[1]).toBeCloseTo(want[1], 9);
    }
    // the middle one points down: one corner at the bottom, two level above it
    const ys = analyzerSector('K').map((p) => p[1]).sort((p, q) => p - q);
    expect(ys[0]).toBeCloseTo(ys[1], 9);
    expect(ys[2]).toBeGreaterThan(ys[1]);
  });

  it("joins each bond's own two atoms, one line for each of the six", () => {
    expect(BOND_ENDS).toHaveLength(6);
    expect(new Set(BOND_ENDS.map(([i, j]) => [i, j].sort().join())).size).toBe(6);
    BOND_ENDS.forEach(([i, j], b) => {
      expect([SECTOR_ATOMS[i], SECTOR_ATOMS[j]].sort().join('')).toBe(BOND_KEYS[b].split('').sort().join(''));
    });
  });

  it('reads the share, by volume, of molecules with each bond in them', () => {
    const v = new Vessel(Infinity);
    v.setMolecules(R, 30);
    v.setMolecules(RG, 50);
    v.setMolecules(TARGET, 20);
    const sh = bondShares(v, volume(v));
    const w = (n: number, s: number) => (n * roomFor(s)) / volume(v);
    expect(sh[bond('RG')]).toBeCloseTo(w(50, RG) + w(20, TARGET), 9);
    expect(sh[bond('RB')]).toBeCloseTo(w(20, TARGET), 9);
    expect(sh[bond('GB')]).toBeCloseTo(w(20, TARGET), 9);
    expect(sh[bond('BK')]).toBe(0);
    // one species with a bond lights its line fully
    const pure = new Vessel(Infinity);
    pure.setMolecules(RG, 7);
    expect(bondShares(pure, volume(pure))[bond('RG')]).toBeCloseTo(1, 12);
  });

  it('lets everything through, reading what passed lately, fading out smoothly once nothing passes, then dark', () => {
    const bv = new Tool('visualizer', 0);
    expect(bv.links).toBeNull();
    const src = new Vessel(Infinity);
    src.setMolecules(R, CAP);
    src.setMolecules(RG, CAP);
    let [added, through] = [0, 0];
    const run = (secs: number, on: boolean) => {
      for (let i = 0; i < Math.round(secs / 0.02); i++) {
        if (on) added += bv.tanks[0].addFrom(src, 0.25 * CAP * 0.02);
        through += bv.step(0.02)[0]?.N ?? 0;
      }
    };
    run(20 * INSTRUMENT_TAU, true);
    expect(through + bv.tanks[0].N).toBe(added);
    const half = bondShares(src, volume(src))[bond('RG')];
    expect(bv.links![bond('RG')]).toBeCloseTo(half, 2);
    expect(bv.links![bond('RB')]).toBe(0);
    // as it fades it still reads the same mix
    run(2 * INSTRUMENT_TAU, false);
    expect(bv.links![bond('RG')]).toBeCloseTo(half, 2);
    run(30 * INSTRUMENT_TAU, false);
    expect(bv.links).toBeNull();
  });
});

describe('heat exchanger', () => {
  function run(valves: number[], TA = 10, TB = 1) {
    const x = new Tool('exchanger', 0, undefined, valves);
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
    { v, x: 5, y: -100, z: 0, hx: 5, hz: 5 },
    { v, x: 5, y: -50, z: 0, hx: 5, hz: 5 },
    { v, x: 25, y: -40, z: 0, hx: 5, hz: 5 },
  ];

  it('finds the highest mouth below the point', () => {
    expect(mouthBelow(mouths, { x: 5, y: 0, z: 0 })).toBe(mouths[1]);
    expect(mouthBelow(mouths, { x: 5, y: -60, z: 0 })).toBe(mouths[0]);
  });

  it('ignores mouths above or to the side', () => {
    expect(mouthBelow(mouths, { x: 5, y: -120, z: 0 })).toBeNull();
    expect(mouthBelow(mouths, { x: 15, y: 0, z: 0 })).toBeNull();
    expect(mouthBelow(mouths, { x: 5, y: 0, z: 8 })).toBeNull();
  });

  it('turns a mouth by its yaw', () => {
    const long: Mouth = { v, x: 0, y: -10, z: 0, hx: 30, hz: 3 };
    expect(mouthBelow([long], { x: 20, y: 0, z: 0 })).toBe(long);
    expect(mouthBelow([{ ...long, yaw: Math.PI / 2 }], { x: 20, y: 0, z: 0 })).toBeNull();
    expect(mouthBelow([{ ...long, yaw: Math.PI / 2 }], { x: 0, y: 0, z: 20 })).not.toBeNull();
  });
});

describe('separator', () => {
  const K = singleOf('K');
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

  it('gives each molecule its own outlet by its share of black atoms: none, ¼, ⅓, ½, all', () => {
    expect(SEPARATOR_OUTLET[R]).toBe(0);
    expect(SEPARATOR_OUTLET[tri('△RGB')]).toBe(0);
    expect(SEPARATOR_OUTLET[pair('R–G')]).toBe(0);
    expect(SEPARATOR_OUTLET[tri('⊠RGBK')]).toBe(1);
    expect(SEPARATOR_OUTLET[tri('R–G–B–K')]).toBe(1);
    expect(SEPARATOR_OUTLET[tri('△RGK')]).toBe(2);
    expect(SEPARATOR_OUTLET[pair('R–K')]).toBe(3);
    expect(SEPARATOR_OUTLET[K]).toBe(4);
  });

  it('sends most of each molecule out its own outlet, the rest mostly next door, and more so the sharper it is', () => {
    const f = new Vessel(Infinity);
    for (const sp of [R, tri('⊠RGBK'), tri('△RGK'), pair('R–K'), K]) f.n[sp] = CAP;
    f.N = atomTotal(f);
    let last = 0;
    for (const k of [1, 3, 6]) {
      withSharpness(k, () => {
        const out = separate(f);
        expect(out).toHaveLength(SEPARATOR_OUTLETS);
        const ownShare = out[2].n[tri('△RGK')] / CAP;
        expect(ownShare).toBeGreaterThan(last);
        last = ownShare;
        [R, tri('⊠RGBK'), tri('△RGK'), pair('R–K'), K].forEach((sp, own) => {
          const shares = out.map((v) => v.n[sp] / CAP);
          expect(Math.max(...shares)).toBe(shares[own]);
          for (let j = 0; j < SEPARATOR_OUTLETS; j++)
            if (Math.abs(j - own) > 1) expect(shares[j]).toBeLessThan(shares[own - Math.sign(own - j)] + 1e-9);
          expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        });
      });
    }
  });

  it('sorts perfectly from SEPARATOR_PERFECT up', () => {
    withSharpness(SEPARATOR_PERFECT, () => {
      const f = new Vessel(Infinity);
      for (const sp of [R, tri('⊠RGBK'), tri('△RGK'), pair('R–K'), K]) f.n[sp] = CAP;
      f.N = atomTotal(f);
      const out = separate(f);
      [R, tri('⊠RGBK'), tri('△RGK'), pair('R–K'), K].forEach((sp, own) =>
        out.forEach((v, j) => expect(v.n[sp]).toBe(j === own ? CAP : 0)),
      );
    });
  });

  it('splits everything evenly five ways at sharpness 0', () => {
    withSharpness(0, () => {
      const f = filled(new Vessel(Infinity), R, CAP, 1);
      for (const v of separate(f)) expect(v.n[R] / CAP).toBeCloseTo(1 / SEPARATOR_OUTLETS, 4);
    });
  });

  it('conserves molecules and heat, which goes with the atoms', () => {
    const f = filled(new Vessel(Infinity), R, CAP, 3);
    f.setMolecules(K, CAP / 3);
    const out = separate(f);
    expect(out.reduce((t, v) => t + v.N, 0)).toBe(f.N);
    expect(out.reduce((t, v) => t + v.Q, 0)).toBe(f.Q);
    for (const v of out) if (v.N > 1e6) expect(temperature(v)).toBeCloseTo(temperature(f), 3);
  });

  it('drains its tank at the valve rate times its level, out of all five spouts', () => {
    const x = new Tool('separator', 0, undefined, [0.5]);
    filled(x.tanks[0], singleOf('B'), CAP, 3);
    x.tanks[0].setMolecules(K, CAP);
    const level = x.level(0);
    const out = x.step(0.1);
    expect(out).toHaveLength(SEPARATOR_OUTLETS);
    expect(out.reduce((t, v) => t + (v?.N ?? 0), 0) / (0.5 * MAX_FLOW * level * 0.1)).toBeCloseTo(1, 6);
    expect(x.flow.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5 * level);
  });
});

describe('hose', () => {
  it('tells whether two hoses are on the same spout or faucet', () => {
    const t = new Tool('separator', 0);
    const u = new Tool('separator', 1);
    expect(sameMount({ tool: t, spout: 2 }, { tool: t, spout: 2 })).toBe(true);
    expect(sameMount({ tool: t, spout: 2 }, { tool: t, spout: 1 })).toBe(false);
    expect(sameMount({ tool: t, spout: 2 }, { tool: u, spout: 2 })).toBe(false);
    expect(sameMount({ faucet: 3 }, { faucet: 3 })).toBe(true);
    expect(sameMount({ faucet: 0 }, { tool: t, spout: 0 })).toBe(false);
    expect(new Hose({ faucet: 3 }, { x: 1, y: 2, z: 3 }, 50).outlet).toEqual({ x: 1, y: 2, z: 3 });
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

describe('how big vessels are drawn', () => {
  it('is just big enough inside to hold what each holds, as a flask is, but for what is hidden in the wall', () => {
    for (const kind of Object.keys(SHAPES) as ToolKind[]) {
      if (SHAPES[kind].wall) continue;
      const t = new Tool(kind, 0);
      t.tanks.forEach((v, k) => {
        expect(spaceOf(tankPieces(t.shape, k, tankDepth(kind))) / FLASK_VOLUME).toBeCloseTo(v.cap / CAP, 6);
      });
    }
  });

  it('fills a stack of pieces from the bottom up, narrow parts quickly', () => {
    const box = { h: 10, w0: 4, d0: 5, w1: 4, d1: 5 };
    expect(levelIn([box], 0.5)).toBeCloseTo(5);
    // a funnel, point down: half of it by volume is most of the way up
    const cone = { h: 10, w0: 0, d0: 0, w1: 10, d1: 10 };
    expect(levelIn([cone], 0.5)).toBeCloseTo(10 * Math.cbrt(0.5));
    expect(levelIn([cone, box], 1)).toBeCloseTo(20);
    expect(spaceOf([{ ...box, round: true }])).toBeCloseTo((Math.PI / 4) * 200);
  });
});
