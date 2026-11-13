import { describe, expect, it } from 'vitest';
import { SOLVENT_SPECIES, SPECIES, TARGET, bondMask, pairOf, singleOf, speciesIndex } from '../chem/species';
import { CAP, DELIVERY, GOAL_PURITY, GOAL_TARGET, TRACE } from './config';
import { ReactionNetwork, heatAt, temperature } from '../chem/reactions';
import { testChemParams } from '../chem/testChem';
import { COOLING } from './cooling';
import { Vessel, roomFor, transfer, volume } from './flask';
import { FLASK_VOLUME, flaskRadius } from './flaskShape';
import { STATION_POSE } from './presets';
import { CRYOSTABILIZER, FIRST_SUPPLY, SUPPLIES, nextSupply } from './supply';
import { CELL, WALL_PANEL } from './space';
import { tankMouth } from './bodies';
import { loadVessel, saveVessel } from './save';
import { TILES } from './surfaces';
import {
  DRIP_FLOW, EXCHANGE_RATE, HEATER, HEATER_CELLS, HEATER_TAPS, INLINE_TOOLS, UNIQUE_TOOLS, METER_DIGITS, heatBy, heaterCellX, meterText, wireTemperature, FUNNEL_CAP, FUNNEL_RATE, Hose, MAX_FLOW, PIPETTE_FLOW, ANALYZER_SAMPLE, ATOM_PLACE, analyzerSector, BOND_ENDS, BOND_TRIANGLE, BOND_KEYS, SPECTROSCOPE, bondPoint, bondShares, bondCounts, spectroscopeAt, spectroscopeTop, spectroscopeUnit, spectroscopeY, INSTRUMENT_TAU, TUBE_CAP,
  clockText, needleAt, CULTURE, harm, cultureLevel, cultureCells, STRIP, STRIP_FOOT, STRIP_RUN, DISH, DISH_CAP, footY, isDipper, stripInk, COLUMN, columnInk, wetness, leadOf, scorchAt, tankX, sieve, THERMOMETER, THERMOMETERS, isThermometer, type ThermometerKind, thermometerAt, BULB, BULB_BODY_CAP, BULB_NECK_CAP, neckShare, heightOf, INTAKE_CAP, REFERENCE_FLOW, CHANGEOVER, CHANGEOVER_S, CHANGEOVER_ALARM, changeoverAt, RESERVOIR_FILTER, SEPARATOR, STATION, gaugeSegments, SEPARATOR_PERFECT, SORTER, STATION_FUNNEL, SPACE_PER_ATOM, SEPARATOR_OUTLET, SEPARATOR_OUTLETS, SORTER_OUTLETS, SECTOR_ATOMS, TANK_CAP, Tool, counterflow, cupFillHeight, levelIn, spaceOf, tankDepth, tankPieces, SHAPES, type ToolKind, drip, dropRate, mouthBelow, sameMount, separate, composition, type Mouth,
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

describe('supply station', () => {
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
    expect(r.tanks.map((v) => v.cap)).toEqual([INTAKE_CAP, CRYOSTABILIZER.cap]);
    expect(INTAKE_CAP * SPACE_PER_ATOM).toBeCloseTo(spaceOf(STATION_FUNNEL), -2);
    expect(r.shape.fixed).toBe(true);
    expect(r.shape.wall).toBe(true);
    // the funnel is open, and the reservoir sealed
    expect(r.isOpen(0)).toBe(true);
    expect(r.isOpen(1)).toBe(false);
    expect(CRYOSTABILIZER.start).toBeLessThan(GOAL_TARGET);
    expect(CRYOSTABILIZER.cap / GOAL_TARGET).toBeCloseTo(3, 1);
    // even if all it's ever let in is only just pure enough, and the rest single atoms
    const target = GOAL_TARGET * roomFor(TARGET);
    expect(target + (GOAL_TARGET * 3 * (1 / GOAL_PURITY - 1)) * roomFor(R)).toBeLessThan(CRYOSTABILIZER.cap);
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
    ref.setMolecules(TARGET, CRYOSTABILIZER.start);
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
    // the goal's own segment stays red until the goal is reached, and turns green just as it is
    expect(gaugeSegments(71.9, 72, 100, 10)[7]).toBe('wanted');
    expect(gaugeSegments(72, 72, 100, 10)).toEqual([...Array(8).fill('held'), 'off', 'off']);
    // past the goal, nothing's wanted, and segments above it are green only when wholly held
    expect(gaugeSegments(85, 72, 100, 10)).toEqual([...Array(8).fill('held'), 'off', 'off']);
    expect(gaugeSegments(90, 72, 100, 10)).toEqual([...Array(9).fill('held'), 'off']);
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

describe("the station's supplies and changeover", () => {
  const RB = pairOf('R', 'B');
  /** A station fitted for the first supply, as a new lab's is. */
  const first = () => {
    const r = new Tool('receptacle', 0);
    r.stock(FIRST_SUPPLY);
    return r;
  };
  /** Run it for t sim seconds, in substeps. */
  const run = (r: Tool, t: number) => {
    for (let s = 0; s < t - 1e-9; s += 0.02) r.step(0.02);
  };

  it('is fitted first for a little antinucleant, R–B, and then for the cryostabilizer, which is the last', () => {
    expect(SUPPLIES.map((s) => s.name)).toEqual(['antinucleant', 'cryostabilizer']);
    expect(FIRST_SUPPLY.species).toBe(RB);
    expect(nextSupply(FIRST_SUPPLY)).toBe(CRYOSTABILIZER);
    expect(nextSupply(CRYOSTABILIZER)).toBeNull();
    expect(CRYOSTABILIZER.species).toBe(TARGET);
    // 8.30 L of the 9.20 L needed; a reservoir about three times the goal, as the cryostabilizer's is
    expect(FIRST_SUPPLY.startL.toFixed(2)).toBe('8.30');
    expect(FIRST_SUPPLY.goalL.toFixed(2)).toBe('9.20');
    for (const s of SUPPLIES) {
      expect(Number.isInteger(s.start)).toBe(true);
      expect(s.start).toBeLessThan(s.goal);
      expect(s.start / s.goal).toBeCloseTo(s.startL / s.goalL, 6);
      expect(s.cap / s.goal).toBeCloseTo(3, 0);
    }
    // only the cryostabilizer, which takes years to make enough of, opens the airlock
    expect(SUPPLIES.map((s) => s.airlock)).toEqual([false, true]);
  });

  it('stocked for a supply, holds what is on board of it, in a reservoir as big as that supply needs', () => {
    const r = first();
    const [funnel, ref] = r.tanks;
    expect(r.supply).toBe(FIRST_SUPPLY);
    expect(ref.cap).toBe(FIRST_SUPPLY.cap);
    expect(ref.n[RB]).toBe(FIRST_SUPPLY.start);
    expect(ref.N).toBe(2 * FIRST_SUPPLY.start);
    expect(temperature(ref)).toBeCloseTo(1, 6);
    expect(funnel.N).toBe(0);
    expect(new Tool('receptacle', 0).supply).toBe(CRYOSTABILIZER);
  });

  it('takes only what it is fitted for', () => {
    const r = first();
    const [funnel, ref] = r.tanks;
    funnel.setMolecules(RB, 1000);
    run(r, 0.1);
    expect(r.gate).toBe('reservoir');
    expect(ref.n[RB]).toBe(FIRST_SUPPLY.start + 1000);
    expect(r.purity).toBeCloseTo(1, 6);
    // the cryostabilizer is no good to it
    funnel.setMolecules(TARGET, 1000);
    let wasted = 0;
    for (let i = 0; i < 5; i++) wasted += r.step(0.02)[0]?.n[TARGET] ?? 0;
    expect(r.gate).toBe('waste');
    expect(wasted).toBe(1000);
    expect(ref.n[TARGET]).toBe(0);
  });

  it('counts steady delivery whatever it is fitted for', () => {
    const r = first();
    for (let t = 0; t < 10; t++) {
      r.tanks[0].setMolecules(RB, 1000);
      run(r, 1);
    }
    expect(r.steady).toBeCloseTo(10, 6);
  });

  it('is changed for the next once its reservoir holds enough, and not before', () => {
    const r = first();
    const [funnel, ref] = r.tanks;
    ref.setMolecules(RB, FIRST_SUPPLY.goal - 1e6);
    run(r, 1);
    expect(r.swap).toBeNull();
    // a little more than its open faucet lets out
    r.valves[0] = 0.5;
    funnel.setMolecules(RB, 1e7);
    r.step(0.02);
    // it starts at once, and shuts its faucet
    expect(r.swap).toBe(0);
    expect(r.valves[0]).toBe(0);
    expect(r.away).toBe(false);
    // it still works through the warning
    funnel.setMolecules(RB, 1000);
    const held = ref.n[RB];
    run(r, CHANGEOVER.warn - 0.1);
    expect(ref.n[RB]).toBe(held + 1000);
    // then its block is away: nothing in its funnel moves, and nothing leaves its spouts, even with its valve open
    run(r, 0.2);
    expect(r.away).toBe(true);
    funnel.setMolecules(RB, 1000);
    r.valves[0] = 1;
    expect(r.step(0.02)).toEqual([null, null]);
    expect(funnel.n[RB]).toBe(1000);
    expect(r.supply).toBe(FIRST_SUPPLY);
    // halfway through its time away it's the next supply's, as new
    run(r, CHANGEOVER.retract + CHANGEOVER.shut + CHANGEOVER.away / 2);
    expect(r.supply).toBe(CRYOSTABILIZER);
    expect(ref.cap).toBe(CRYOSTABILIZER.cap);
    expect(ref.n[TARGET]).toBe(CRYOSTABILIZER.start);
    expect(ref.n[RB]).toBe(0);
    expect(funnel.N).toBe(0);
    expect(r.away).toBe(true);
    // and once it's out again it works, the changeover over a moment later
    run(r, CHANGEOVER.away / 2 + CHANGEOVER.open + CHANGEOVER.extend);
    expect(r.away).toBe(false);
    expect(r.swap).not.toBeNull();
    funnel.setMolecules(TARGET, 1000);
    run(r, CHANGEOVER.clear + 0.1);
    expect(r.swap).toBeNull();
    expect(ref.n[TARGET]).toBe(CRYOSTABILIZER.start + 1000);
  });

  it('has nothing to be changed for once it has enough cryostabilizer', () => {
    const r = new Tool('receptacle', 0);
    r.tanks[1].setMolecules(TARGET, GOAL_TARGET + 1e6);
    run(r, 1);
    expect(r.swap).toBeNull();
  });

  it('slides its block back, shuts a door over it, and brings the next out the same way, alarm sounding', () => {
    expect(CHANGEOVER_S).toBeCloseTo(Object.values(CHANGEOVER).reduce((a, b) => a + b, 0), 9);
    expect(changeoverAt(null)).toMatchObject({ back: 0, door: 0, alarm: false });
    const { warn, retract, shut, away, open, extend } = CHANGEOVER;
    expect(changeoverAt(warn / 2)).toMatchObject({ part: 'warn', back: 0, door: 0 });
    expect(changeoverAt(warn + retract / 2)).toMatchObject({ part: 'retract', back: 0.5, door: 0 });
    // the door shuts only once the block is all the way back, and the block comes out only once it's open again
    expect(changeoverAt(warn + retract + shut / 2)).toMatchObject({ part: 'shut', back: 1, door: 0.5 });
    expect(changeoverAt(warn + retract + shut + away / 2)).toMatchObject({ part: 'away', back: 1, door: 1 });
    expect(changeoverAt(warn + retract + shut + away + open / 2)).toMatchObject({ part: 'open', back: 1, door: 0.5 });
    expect(changeoverAt(warn + retract + shut + away + open + extend / 2)).toMatchObject({ part: 'extend', back: 0.5, door: 0 });
    expect(changeoverAt(CHANGEOVER_S - 0.01)).toMatchObject({ part: 'clear', back: 0, door: 0 });
    // the alarm sounds on and off from the start to the end
    expect(changeoverAt(0.01).alarm).toBe(true);
    expect(changeoverAt(CHANGEOVER_ALARM.on + 0.01).alarm).toBe(false);
    expect(changeoverAt(CHANGEOVER_ALARM.every + 0.01).alarm).toBe(true);
    // far enough back that nothing of it sticks out past the door
    expect(STATION.recess - STATION.door.back - STATION.door.thick).toBeGreaterThan(STATION.out + STATION.funnel.w);
  });

  it('keeps what it is fitted for, and how far through a changeover it is, in a save', () => {
    const r = first();
    expect(r.memory).toEqual([0, -1]);
    const back = new Tool('receptacle', 1);
    back.remember(r.memory);
    expect(back.supply).toBe(FIRST_SUPPLY);
    expect(back.tanks[1].cap).toBe(FIRST_SUPPLY.cap);
    expect(back.swap).toBeNull();
    // mid-changeover, before and after it's the next supply's
    for (const [supply, swap] of [[0, 3], [1, CHANGEOVER_S - 2]]) {
      const t = new Tool('receptacle', 2);
      t.remember([supply, swap]);
      expect(t.supply).toBe(SUPPLIES[supply]);
      expect(t.swap).toBe(swap);
      expect(t.memory).toEqual([supply, swap]);
    }
    // a save from before there was any supply but the cryostabilizer has no memory, and nonsense is ignored
    const old = new Tool('receptacle', 3);
    old.remember(undefined);
    expect(old.supply).toBe(CRYOSTABILIZER);
    old.remember([7, 3]);
    expect(old.supply).toBe(CRYOSTABILIZER);
    expect(old.swap).toBeNull();
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
  const run = (t: Tool, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / 0.02); i++) t.step(0.02);
  };
  const C = STRIP.cells;
  /** A vessel holding `total` molecules, in the given shares, at temperature T. */
  const mix = (parts: [number, number][], total = 3 * STRIP.spot, T = 1) => {
    const v = new Vessel(Infinity);
    for (const [s, share] of parts) v.setMolecules(s, share * total);
    v.setTemperature(T);
    return v;
  };
  /** A vessel holding `amount` molecules of `carrier`, to stand a strip in: three paperfuls unless said. */
  const carrierOf = (carrier: number, amount = 3 * STRIP.cap, T = 1) => filled(new Vessel(Infinity), carrier, amount * SPECIES[carrier].size, T);
  /** A strip touched to a spot of `parts`, then stood in `carrier`, single green atoms unless said. */
  const spotted = (parts: [number, number][], carrier = G) => {
    const t = new Tool('strip', 0);
    t.dipIn(mix(parts), false);
    t.dipIn(null, false);
    const bath = carrierOf(carrier);
    t.dipIn(bath, true);
    return { t, bath };
  };
  /** Where species s's band ends up with a pure carrier, in stretches from the foot: as far as it runs with it. */
  const want = (s: number, carrier: number) => Math.min(1, STRIP_RUN[s] / STRIP_RUN[carrier]) * C;
  /** Where species s is on the paper, on average, in stretches from its foot. */
  const centre = (t: Tool, s: number) => {
    const total = t.paper.reduce((a, v) => a + v.n[s], 0);
    return t.paper.reduce((a, v, c) => a + v.n[s] * (c + 0.5), 0) / total;
  };
  const peak = (t: Tool, s: number) => Math.max(...t.paper.map((v) => stripInk(s, v.n[s], t.dryness)));
  const onPaper = (t: Tool) => t.paper.reduce((a, v) => a + atomTotal(v), 0);

  it('is bare paper: no tanks, spouts or valves, and a dipper, its foot at the tip of its paper', () => {
    const t = new Tool('strip', 0);
    expect(t.tanks).toEqual([]);
    expect(t.shape.spouts).toEqual([]);
    expect(t.shape.noValve).toBe(true);
    expect(isDipper('strip')).toBe(true);
    expect(footY('strip')).toBeCloseTo(STRIP_FOOT - 0.5, 9);
    expect(STRIP_FOOT).toBeLessThanOrEqual(t.shape.box.y1);
    // and narrow enough to go down a flask's neck, with room to spare
    expect(2 * STRIP.paper.w).toBeLessThan(2 * flaskRadius(22) - 4);
  });

  it('runs each species some way along it: lighter further, and a ring further than a chain of the same atoms', () => {
    for (const r of STRIP_RUN) {
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
    }
    // single atoms, lightest first, ahead of everything else
    const singles = SPECIES.filter((sp) => sp.size === 1).sort((a, b) => a.weight - b.weight);
    for (let i = 1; i < singles.length; i++) expect(STRIP_RUN[singles[i].i]).toBeLessThan(STRIP_RUN[singles[i - 1].i]);
    for (const sp of SPECIES) if (sp.size > 1) expect(STRIP_RUN[sp.i]).toBeLessThan(STRIP_RUN[singles[singles.length - 1].i]);
    // the triangle, with no loose ends, well ahead of all three chains of its atoms, which each end up somewhere of
    // their own, more than a stretch of the paper apart after a full run
    const cells = (r: number) => r * C;
    const chains = [chain('R', 'G', 'B'), chain('G', 'R', 'B'), chain('R', 'B', 'G')];
    for (const c of chains) expect(cells(STRIP_RUN[TARGET] - STRIP_RUN[c])).toBeGreaterThan(16);
    const at = chains.map((c) => STRIP_RUN[c]).sort((a, b) => a - b);
    expect(cells(at[1] - at[0])).toBeGreaterThan(2);
    expect(cells(at[2] - at[1])).toBeGreaterThan(2);
  });

  it('takes one spot from what its foot comes into onto its foot, up to three in all', () => {
    const t = new Tool('strip', 0);
    const v = mix([[TARGET, 1]], 10 * STRIP.spot);
    const atoms = atomTotal(v);
    t.dipIn(v, false);
    expect(volume(t.paper[0])).toBe(STRIP.spot);
    expect(atomTotal(v) + onPaper(t)).toBe(atoms);
    t.paper.forEach((p, c) => c > 0 && expect(p.N).toBe(0));
    // only as it comes into it: staying in, it takes no more
    t.dipIn(v, false);
    run(t, 1);
    t.dipIn(v, false);
    expect(volume(t.paper[0])).toBe(STRIP.spot);
    // lifted out and touched again, it takes another, and a third, and then no more
    for (let k = 2; k <= 4; k++) {
      t.dipIn(null, false);
      t.dipIn(v, false);
      expect(volume(t.paper[0])).toBe(Math.min(k, STRIP.spots) * STRIP.spot);
    }
    expect(STRIP.spots).toBe(3);
    expect(atomTotal(v) + onPaper(t)).toBe(atoms);
    // a little vessel gives what it has
    const u = new Tool('strip', 0);
    const small = mix([[TARGET, 1]], STRIP.spot / 2);
    u.dipIn(small, false);
    expect(small.N).toBe(0);
    expect(volume(u.paper[0])).toBe(STRIP.spot / 2);
  });

  it('takes its spot over as much of it as is in the fluid, evenly, so its top is where the surface was', () => {
    const t = new Tool('strip', 0);
    const v = mix([[TARGET, 1]], 10 * STRIP.spot);
    const atoms = atomTotal(v);
    // its foot, the middle of its first stretch, 2.5 under: its first three stretches' middles are under
    t.dipIn(v, false, 2.5);
    for (let c = 0; c < 3; c++) expect(Math.abs(volume(t.paper[c]) - STRIP.spot / 3)).toBeLessThanOrEqual(1);
    t.paper.forEach((p, c) => c >= 3 && expect(p.N).toBe(0));
    expect(atomTotal(v) + onPaper(t)).toBe(atoms);
    // a second touch, no deeper, goes over the same stretches, and it's still at most three spots in all
    for (let k = 2; k <= 4; k++) {
      t.dipIn(null, false);
      t.dipIn(v, false, 2.5);
    }
    expect(Math.abs(t.paper.reduce((a, p) => a + volume(p), 0) - STRIP.spots * STRIP.spot)).toBeLessThanOrEqual(STRIP.spots * 3);
    t.paper.forEach((p, c) => c >= 3 && expect(p.N).toBe(0));
    // barely in, it's its first stretch; and however deep, no more of it than there is
    const u = new Tool('strip', 1);
    u.dipIn(mix([[TARGET, 1]]), false, 0.01);
    expect(volume(u.paper[0])).toBe(STRIP.spot);
    const w = new Tool('strip', 2);
    w.dipIn(mix([[TARGET, 1]]), false, 10 * C);
    expect(w.paper.every((p) => p.N > 0)).toBe(true);
  });

  it('takes no spot once it has begun to drink', () => {
    const t = new Tool('strip', 0);
    t.dipIn(carrierOf(G), true);
    run(t, 0.1);
    expect(t.soaked).toBeGreaterThan(0);
    t.dipIn(null, false);
    const v = mix([[TARGET, 1]]);
    const n = v.N;
    t.dipIn(v, false);
    expect(v.N).toBe(n);
    expect(t.touch(v)).toBe(0);
    expect(t.paper.every((p) => p.n[TARGET] === 0)).toBe(true);
  });

  it('drinks nothing while it may not (a tap), only its spot', () => {
    const t = new Tool('strip', 0);
    const bath = carrierOf(G);
    t.dipIn(bath, false);
    const n = bath.N;
    const before = t.paper.map((v) => [...v.n]);
    run(t, 5);
    expect(t.soaked).toBe(0);
    expect(bath.N).toBe(n);
    expect(t.paper.map((v) => [...v.n])).toEqual(before);
  });

  it('drinks from what its foot is in as the square root of the time, stops when out of it, and goes on when back', () => {
    const t = new Tool('strip', 0);
    const bath = carrierOf(G);
    t.dipIn(bath, true);
    const atoms = bath.N + onPaper(t);
    run(t, STRIP.time / 4);
    expect(t.soaked).toBeCloseTo(0.5, 2);
    // what it's drunk is what it's soaked, all on the paper, and none lost
    expect(volume(bath)).toBeCloseTo(3 * STRIP.cap - STRIP.spot - 0.5 * STRIP.cap, -4);
    expect(Math.abs(bath.N + onPaper(t) - atoms)).toBeLessThanOrEqual(TRACE);
    run(t, STRIP.time / 4);
    expect(t.soaked).toBeCloseTo(Math.SQRT1_2, 2);
    // lifted out, it stops where it is
    t.dipIn(null, false);
    const paper = t.paper.map((v) => [...v.n]);
    run(t, 5);
    expect(t.soaked).toBeCloseTo(Math.SQRT1_2, 2);
    expect(t.paper.map((v) => [...v.n])).toEqual(paper);
    // and put back, it goes on, taking no new spot
    const n = bath.N;
    t.dipIn(bath, true);
    expect(bath.N).toBe(n);
    run(t, STRIP.time / 2 + 0.1);
    expect(t.soaked).toBe(1);
    expect(Math.abs(bath.N + onPaper(t) - atoms)).toBeLessThanOrEqual(TRACE);
    run(t, STRIP.dry + 0.1);
    expect(t.dryness).toBe(1);
  });

  it('stops where it is when what it stands in runs dry, and goes on when there is more', () => {
    const t = new Tool('strip', 0);
    const bath = carrierOf(G, 0.3 * STRIP.cap);
    t.dipIn(bath, true);
    run(t, 5);
    expect(bath.N).toBe(0);
    // its touch took a spot's worth of it first
    expect(t.soaked).toBeCloseTo(0.3 - STRIP.spot / STRIP.cap, 3);
    run(t, 5);
    expect(t.soaked).toBeCloseTo(0.3 - STRIP.spot / STRIP.cap, 3);
    filled(bath, G, STRIP.cap, 1);
    run(t, STRIP.time);
    expect(t.soaked).toBe(1);
  });

  it('separates what a spot holds into bands, each where its species runs to from the foot beside the carrier', () => {
    const chainRGB = chain('R', 'G', 'B');
    for (const carrier of [G, R, SOLVENT_SPECIES]) {
      const { t, bath } = spotted([[TARGET, 0.5], [chainRGB, 0.5]], carrier);
      const atoms = bath.N + onPaper(t);
      run(t, STRIP.time + 1);
      expect(t.soaked).toBe(1);
      expect(Math.abs(bath.N + onPaper(t) - atoms)).toBeLessThanOrEqual(TRACE);
      for (const s of [TARGET, chainRGB]) expect(Math.abs(centre(t, s) - want(s, carrier))).toBeLessThan(1.5);
      expect(centre(t, TARGET) - centre(t, chainRGB)).toBeGreaterThan(16);
      // as bands, nearly all of each within eight stretches of its middle
      for (const s of [TARGET, chainRGB]) {
        const m = Math.floor(centre(t, s));
        const near = t.paper.slice(m - 8, m + 9).reduce((a, v) => a + v.n[s], 0);
        expect(near / t.paper.reduce((a, v) => a + v.n[s], 0)).toBeGreaterThan(0.95);
      }
    }
  });

  it('carries a pure carrier at the pace it is drawn up, so it is wet where the carrier is, and only there', () => {
    for (const carrier of [R, SOLVENT_SPECIES]) {
      const t = new Tool('strip', 0);
      const bath = carrierOf(carrier);
      t.dipIn(bath, true);
      const atoms = bath.N + onPaper(t);
      const cell = STRIP.cap / C;
      for (const seconds of [STRIP.time / 16, STRIP.time / 4, STRIP.time / 2]) {
        run(t, seconds - STRIP.time * (t.soaked ** 2));
        expect(t.soaked).toBeLessThan(1);
        // the carrier's on every stretch up to nearly as far as the paper's soaked, about a stretch's worth on each,
        // so it's wet there (but the foot, which fills as it's drawn up and empties each time what's on it moves on)
        const reach = Math.floor(0.95 * t.soaked * C);
        for (let c = 1; c <= reach; c++) expect(volume(t.paper[c])).toBeGreaterThan(0.5 * cell);
        expect(wetness(volume(t.paper[reach]), STRIP.cap, C)).toBeGreaterThan(0.5);
        // and there's nothing past that share of its length, so it's dry there
        t.paper.forEach((v, c) => c >= Math.ceil(t.soaked * C) && expect(wetness(volume(v), STRIP.cap, C)).toBe(0));
        expect(Math.abs(bath.N + onPaper(t) - atoms)).toBeLessThanOrEqual(TRACE);
      }
    }
  });

  it('carries what is faster than its carrier with the liquid, never ahead of it', () => {
    // green runs more freely than red
    expect(STRIP_RUN[G]).toBeGreaterThan(STRIP_RUN[R]);
    const { t } = spotted([[G, 1]], R);
    const top = (s: number) => t.paper.reduce((a, v, c) => (v.n[s] > 0 ? c : a), -1);
    for (let i = 0; i < (STRIP.time + 1) / 0.02; i++) {
      t.step(0.02);
      expect(top(G)).toBeLessThanOrEqual(Math.max(top(R), 0));
      if (top(G) > 0) expect(t.paper[top(G)].n[R]).toBeGreaterThan(0);
    }
    // so it ends up at the top, with the carrier's leading edge
    expect(t.soaked).toBe(1);
    expect(want(G, R)).toBe(C);
    expect(centre(t, G)).toBeGreaterThan(C - 3);
  });

  it('shows how wet a stretch is by how much is on it, as a share of its part of what the whole holds wet through', () => {
    expect(wetness(0, 100, 10)).toBe(0);
    expect(wetness(5, 100, 10)).toBeCloseTo(0.5, 12);
    expect(wetness(10, 100, 10)).toBe(1);
    expect(wetness(30, 100, 10)).toBe(1);
  });

  it('shows a twentieth of the spot clearly, as bands apart with only its carrier between them, and most of it dark only near its middle, whatever single atom carries it', () => {
    const minor = [chain('R', 'G', 'B'), chain('G', 'R', 'B'), pairOf('R', 'G')];
    for (const carrier of [G, R, SOLVENT_SPECIES]) {
      const { t } = spotted([[TARGET, 0.85], ...minor.map((s): [number, number] => [s, 0.05])], carrier);
      run(t, STRIP.time + STRIP.dry + 1);
      expect(t.dryness).toBe(1);
      for (const s of [TARGET, ...minor]) expect(Math.abs(centre(t, s) - want(s, carrier))).toBeLessThan(1.5);
      // each of the others shows clearly at its peak
      for (const s of minor) {
        expect(peak(t, s)).toBeGreaterThan(0.3);
        expect(peak(t, s)).toBeLessThan(0.6);
      }
      // the triangle is as dark as it gets, but only over a few stretches round its middle
      expect(peak(t, TARGET)).toBeGreaterThan(0.99);
      expect(t.paper.filter((v) => stripInk(TARGET, v.n[TARGET], 1) > 0.9).length).toBeLessThan(8);
      // and midway between its band and the nearest below it, there's nothing on the paper but its carrier: clean,
      // if that's the solvent, which has dried off, and tinted by it if not
      const below = Math.max(...minor.map((s) => centre(t, s)));
      expect(below).toBeLessThan(centre(t, TARGET));
      const mid = t.paper[Math.floor((below + centre(t, TARGET)) / 2)];
      expect(stripInk(TARGET, mid.n[TARGET], 1)).toBeLessThan(0.05);
      const clear = SPECIES.reduce((a, sp) => (sp.i === carrier ? a : a * (1 - stripInk(sp.i, mid.n[sp.i], 1))), 1);
      expect(1 - clear).toBeLessThan(0.1);
      if (carrier === SOLVENT_SPECIES) expect(mid.n[carrier]).toBe(0);
      else expect(stripInk(carrier, mid.n[carrier], 1)).toBeGreaterThan(0.5 * STRIP.tint);
    }
    expect(stripInk(TARGET, 0, 0)).toBe(0);
  });

  it('dries clean of the solvent and of nothing else: other single atoms stay where they ran to, tinting it', () => {
    const count = (t: Tool, s: number) => t.paper.reduce((a, v) => a + v.n[s], 0);
    for (const carrier of [SOLVENT_SPECIES, G]) {
      const { t } = spotted([[TARGET, 1]], carrier);
      run(t, STRIP.time / 2);
      // wet, the carrier tints it
      const tint = peak(t, carrier);
      expect(tint).toBeGreaterThan(0.5 * STRIP.tint);
      expect(tint).toBeLessThanOrEqual(STRIP.tint);
      while (t.soaked < 1) t.step(0.02);
      const [carried, target] = [count(t, carrier), count(t, TARGET)];
      const wet = peak(t, carrier);
      // drying, the solvent's tint fades, and nothing else's does
      run(t, STRIP.dry / 2);
      if (carrier === SOLVENT_SPECIES) expect(peak(t, carrier)).toBeLessThanOrEqual(0.5 * STRIP.tint + 0.01);
      else expect(peak(t, carrier)).toBe(wet);
      run(t, STRIP.dry);
      expect(t.dryness).toBe(1);
      // dry, the solvent's gone, and everything else is as it was
      expect(count(t, TARGET)).toBe(target);
      expect(count(t, carrier)).toBe(carrier === SOLVENT_SPECIES ? 0 : carried);
      expect(peak(t, carrier)).toBe(carrier === SOLVENT_SPECIES ? 0 : wet);
      // and done, it takes up nothing more, stood in anything
      const before = t.paper.map((v) => [...v.n]);
      t.dipIn(null, false);
      t.dipIn(carrierOf(R), true);
      run(t, 5);
      expect(t.paper.map((v) => [...v.n])).toEqual(before);
      expect(t.step(0.02)).toEqual([]);
    }
    expect(stripInk(SOLVENT_SPECIES, STRIP.spot, 1)).toBe(0);
    expect(stripInk(G, STRIP.spot, 1)).toBe(stripInk(G, STRIP.spot, 0));
    expect(stripInk(G, STRIP.spot, 1)).toBeGreaterThan(0);
  });

  it('keeps a sample of nothing but single atoms: soaked through and dried, their bands are still on it', () => {
    // as much of each as of the other, in the solvent
    const bath = new Vessel(Infinity);
    for (const [s, share] of [[R, 0.1], [G, 0.1], [SOLVENT_SPECIES, 0.8]]) bath.setMolecules(s, share * 3 * STRIP.cap);
    bath.setTemperature(1);
    const t = new Tool('strip', 0);
    t.dipIn(bath, true);
    run(t, STRIP.time + STRIP.dry + 1);
    expect(t.dryness).toBe(1);
    for (const s of [R, G]) {
      expect(t.paper.reduce((a, v) => a + v.n[s], 0)).toBeGreaterThan(0);
      expect(peak(t, s)).toBeGreaterThan(0.1);
    }
    expect(t.paper.every((v) => v.n[SOLVENT_SPECIES] === 0)).toBe(true);
  });

  it('gives a staircase of fronts, not bands, stood fresh in the sample itself', () => {
    const chainRGB = chain('R', 'G', 'B');
    const t = new Tool('strip', 0);
    const sample = mix([[TARGET, 0.5], [chainRGB, 0.5]], 3 * STRIP.cap);
    // the liquid runs at the mean of the two, the triangle with it and the chain behind
    const lead = leadOf(sample);
    t.dipIn(sample, true);
    run(t, STRIP.time + 1);
    expect(t.soaked).toBe(1);
    for (const s of [TARGET, chainRGB]) {
      const reach = Math.floor(Math.min(1, STRIP_RUN[s] / lead) * C) - 3;
      for (let c = 0; c < reach; c++) expect(t.paper[c].n[s]).toBeGreaterThan(0);
    }
  });

  it('is scorched where it has been in hot fluid, and nowhere else', () => {
    const { from, to } = STRIP.scorch;
    expect(scorchAt(from)).toBe(0);
    expect(scorchAt((from + to) / 2)).toBeCloseTo(0.5, 9);
    expect(scorchAt(2 * to)).toBe(1);
    const scorched = (t: Tool) => [...t.scorch].map((x) => +x.toFixed(2));
    const upTo = (n: number, by: number) => Array.from({ length: C }, (_, c) => (c < n ? by : 0));
    // by a hot fluid it's touched to, as far up as it's in it: the same stretches as its spot
    const t = new Tool('strip', 0);
    t.dipIn(mix([[TARGET, 1]], STRIP.spot, (from + to) / 2), false, 2.5);
    expect(scorched(t)).toEqual(upTo(3, 0.5));
    expect(t.paper.map((p) => p.N > 0)).toEqual(upTo(3, 1).map(Boolean));
    // and no further, though a cool carrier then wets it to its top, deeper in than it was
    t.dipIn(null, false);
    t.dipIn(carrierOf(R, 2 * STRIP.cap, from), true, 5.5);
    run(t, STRIP.time + 1);
    expect(t.soaked).toBe(1);
    expect(scorched(t)).toEqual(upTo(3, 0.5));
    // a hot carrier chars what stands in it, and only that, however far it's drawn up
    const u = new Tool('strip', 0);
    u.dipIn(carrierOf(R, 2 * STRIP.cap, to), true, 5.5);
    run(u, STRIP.time / 2);
    expect(u.soaked).toBeGreaterThan(0.5);
    expect(scorched(u)).toEqual(upTo(6, 1));
    // even paper that's done, or that isn't let drink, scorches in hot fluid; in none, nothing does
    const w = new Tool('strip', 0);
    w.dipIn(carrierOf(R, STRIP.cap, to), false);
    expect(scorched(w)).toEqual(upTo(1, 1));
    const x = new Tool('strip', 0);
    x.dipIn(null, true, 5.5);
    run(x, 1);
    expect(scorched(x)).toEqual(upTo(0, 0));
  });

  it('keeps how far it has run, how dry it is and how scorched in a save, and what is on its paper', () => {
    const t = new Tool('strip', 0);
    const upTo = (n: number, by: number) => Array.from({ length: C }, (_, c) => (c < n ? by : 0));
    t.remember([0.4, 0.2, ...upTo(3, 0.25)]);
    expect(t.memory).toEqual([0.4, 0.2, ...upTo(3, 0.25)]);
    t.remember([7, -3, ...upTo(C, 0.5)]);
    expect(t.memory).toEqual([1, 0, ...upTo(C, 0.5)]);
    // what was saved before, of the pad's paper, isn't
    t.remember([0.3, 0.1]);
    expect(t.memory).toEqual([1, 0, ...upTo(C, 0.5)]);
    // an older save's strip, scorched alike all over what was wet: as far as it had soaked
    const o = new Tool('strip', 2);
    o.remember([0.5, 0, 0.25]);
    expect(o.memory).toEqual([0.5, 0, ...upTo(C / 2, 0.25)]);
    // and its paper, stretch by stretch
    const { t: u } = spotted([[TARGET, 1]], R);
    run(u, STRIP.time / 2);
    const v = new Tool('strip', 1);
    v.remember(u.memory);
    u.paper.forEach((p, c) => loadVessel(v.paper[c], saveVessel(p)));
    expect(v.memory).toEqual(u.memory);
    expect(v.paper.map((p) => [...p.n])).toEqual(u.paper.map((p) => [...p.n]));
  });
});

describe('dish', () => {
  it('is a shallow open tray, holding as much as it is drawn to, with no valve or spout', () => {
    const t = new Tool('dish', 0);
    expect(t.tanks.length).toBe(1);
    expect(t.isOpen(0)).toBe(true);
    expect(t.shape.spouts).toEqual([]);
    expect(t.shape.noValve).toBe(true);
    expect(t.shape.tankH).toBe(DISH.h);
    expect(t.tanks[0].cap * SPACE_PER_ATOM).toBeCloseTo(2 * DISH.w * DISH.d * DISH.h, -1);
    expect(tankDepth('dish')).toBeCloseTo(DISH.d, 0);
    expect(DISH_CAP / CAP).toBeCloseTo(0.05, 2);
    // room for a strip to drink its fill from it, several times over
    expect(DISH_CAP).toBeGreaterThan(4 * STRIP.cap);
    expect(t.memory).toBeUndefined();
  });

  it('keeps what is in it: nothing drains from it', () => {
    const t = new Tool('dish', 0);
    filled(t.tanks[0], SOLVENT_SPECIES, t.tanks[0].cap, 1);
    const n = [...t.tanks[0].n];
    for (let i = 0; i < 100; i++) expect(t.step(0.02)).toEqual([]);
    expect([...t.tanks[0].n]).toEqual(n);
  });
});

describe('column', () => {
  const triangle = speciesIndex(['R', 'G', 'B'], bondMask(['R', 'G'], ['G', 'B'], ['R', 'B']));
  const chainRGB = speciesIndex(['R', 'G', 'B'], bondMask(['R', 'G'], ['G', 'B']));
  const C = COLUMN.cells;
  const H = 0.02;
  /** Run a column for `seconds`, catching what comes out of its spout in `into`, if given. */
  const run = (t: Tool, seconds: number, into?: Vessel) => {
    let out = false;
    for (let i = 0; i < Math.round(seconds / H); i++) {
      const [o] = t.step(H);
      if (!o) continue;
      out = true;
      if (into) transfer(o, into, volume(o));
    }
    return out;
  };
  const onBed = (t: Tool) => t.bed.reduce((a, v) => a + atomTotal(v), 0);
  /** A column whose bed has soaked through with single green atoms, its funnel empty and its tap shut. */
  const wet = () => {
    const t = new Tool('column', 0);
    while (t.soaked < 1) {
      filled(t.tanks[0], G, t.tanks[0].cap, 1);
      run(t, 0.5);
    }
    t.tanks[0].setMolecules(G, 0);
    return t;
  };
  /** Top a column's funnel up with the given shares (by molecules) of the given species. */
  const topUp = (t: Tool, parts: [number, number][], share = 1) => {
    const f = t.tanks[0];
    for (const [s, sh] of parts) f.setMolecules(s, f.n[s] + (sh * share * (f.cap - volume(f))) / roomFor(s));
    f.setTemperature(1);
  };

  it('stands on one line, its funnel holding a little', () => {
    const sh = SHAPES.column;
    expect(sh.spouts).toEqual([0]);
    expect(tankX(sh.tanks[0])).toBe(0);
    expect(sh.tankCap! / CAP).toBeGreaterThan(0.04);
    expect(sh.tankCap! / CAP).toBeLessThan(0.08);
    const t = new Tool('column', 0);
    expect(t.bed.length).toBe(C);
    expect(t.isOpen(0)).toBe(true);
  });

  it('soaks a dry bed whether its tap is open or not, letting nothing out until it is wet through', () => {
    const t = new Tool('column', 0);
    const [funnel] = t.tanks;
    filled(funnel, G, funnel.cap, 1);
    const atoms = funnel.N;
    expect(run(t, 0.5)).toBe(false);
    expect(t.soaked).toBeCloseTo((0.5 * COLUMN.soak) / COLUMN.cap, 3);
    expect(Math.abs(volume(funnel) - (funnel.cap - 0.5 * COLUMN.soak))).toBeLessThanOrEqual(TRACE);
    // what it's drunk is on its bed, behind the front
    expect(funnel.N + onBed(t)).toBe(atoms);
    t.bed.forEach((v, c) => c >= Math.ceil(t.soaked * C) && expect(v.N).toBe(0));
    // it stops when the funnel's dry, and goes on when there's more
    expect(run(t, 5)).toBe(false);
    expect(funnel.N).toBe(0);
    expect(t.soaked).toBeCloseTo(funnel.cap / COLUMN.cap, 3);
    for (let i = 0; i < 20 && t.soaked < 1; i++) {
      filled(funnel, G, funnel.cap, 1);
      expect(run(t, 1)).toBe(false);
    }
    expect(t.soaked).toBe(1);
    expect(Math.abs(onBed(t) - COLUMN.cap)).toBeLessThanOrEqual(TRACE);
  });

  it('holds everything where it is with its tap shut once wet', () => {
    const t = wet();
    topUp(t, [[triangle, 1]]);
    const funnel = [...t.tanks[0].n];
    const bed = t.bed.map((v) => [...v.n]);
    expect(run(t, 5)).toBe(false);
    expect([...t.tanks[0].n]).toEqual(funnel);
    expect(t.bed.map((v) => [...v.n])).toEqual(bed);
  });

  it('lets liquid through as far as its tap is open, and stops when its funnel is empty', () => {
    for (const open of [1, 0.5]) {
      const t = wet();
      t.valves[0] = open;
      filled(t.tanks[0], G, t.tanks[0].cap, 1);
      const before = volume(t.tanks[0]);
      run(t, 1);
      expect((before - volume(t.tanks[0])) / (open * COLUMN.flow)).toBeCloseTo(1, 3);
    }
    const t = wet();
    t.valves[0] = 1;
    filled(t.tanks[0], R, 0.01 * CAP, 1);
    run(t, 2);
    expect(t.tanks[0].N).toBe(0);
    // with the funnel empty, everything stays where it is, a band parked partway down
    const bed = t.bed.map((v) => [...v.n]);
    expect(run(t, 5)).toBe(false);
    expect(t.bed.map((v) => [...v.n])).toEqual(bed);
    expect(t.bed.slice(0, C / 2).some((v) => v.n[R] > 0)).toBe(true);
  });

  it('lets a pure carrier through a bed wet with it as fast as it goes in, from the moment its tap opens', () => {
    for (const carrier of [G, SOLVENT_SPECIES]) {
      for (const open of [1, 0.5]) {
        const t = new Tool('column', 0);
        while (t.soaked < 1) {
          filled(t.tanks[0], carrier, t.tanks[0].cap, 1);
          run(t, 0.5);
        }
        t.valves[0] = open;
        // what goes in and what comes out over each second, with the funnel kept topped up
        let fed = 0;
        let out = 0;
        for (let s = 0; s < 4 / open; s++) {
          filled(t.tanks[0], carrier, t.tanks[0].cap, 1);
          const before = volume(t.tanks[0]);
          const caught = new Vessel(Infinity);
          run(t, 1, caught);
          fed += before - volume(t.tanks[0]);
          out += volume(caught);
          // fully open, the first second's as much as went in, give or take what's on a stretch or so of the bed
          if (s === 0 && open === 1) expect(Math.abs(out / fed - 1)).toBeLessThan(0.05);
        }
        // and all told, it's as much as went in
        expect(Math.abs(out / fed - 1)).toBeLessThan(0.02);
      }
    }
  });

  /**
   * A wet column fed a slug of `slug` of the bed's volume of the triangle and a chain of the same atoms, half and
   * half by molecules, then carrier, with its tap open, catching what comes out in slices of `slice` sim seconds.
   */
  const fractions = (slug: number, seconds: number, slice = 0.5) => {
    const t = wet();
    t.valves[0] = 1;
    topUp(t, [[triangle, 0.5], [chainRGB, 0.5]], (slug * COLUMN.cap) / t.tanks[0].cap);
    const fed = { tri: t.tanks[0].n[triangle], chain: t.tanks[0].n[chainRGB] };
    const atoms = atomTotal(t.tanks[0]) + onBed(t);
    const slices: Vessel[] = [];
    const caught = new Vessel(Infinity);
    let poured = 0;
    for (let s = 0; s < seconds / slice; s++) {
      // the carrier goes in once the sample's gone in
      if (t.tanks[0].N === 0 || t.tanks[0].n[G] > 0) {
        const before = atomTotal(t.tanks[0]);
        filled(t.tanks[0], G, t.tanks[0].cap, 1);
        poured += atomTotal(t.tanks[0]) - before;
      }
      const v = new Vessel(Infinity);
      run(t, slice, v);
      slices.push(v);
      caught.addFrom(v, volume(v), true);
    }
    return { t, fed, slices, caught, atoms: atoms + poured };
  };

  it('keeps every atom: in its funnel, on its bed, or out its spout', () => {
    const { t, caught, atoms } = fractions(0.1, 20);
    expect(caught.N).toBeGreaterThan(0);
    expect(atomTotal(t.tanks[0]) + onBed(t) + atomTotal(caught)).toBe(atoms);
  });

  it('lets a slug of the triangle out ahead of a chain of the same atoms, the first of it pure, and in the end all of both', () => {
    expect(STRIP_RUN[triangle]).toBeGreaterThan(STRIP_RUN[chainRGB]);
    const { fed, slices, caught } = fractions(0.1, 120);
    const tri = slices.map((v) => v.n[triangle]);
    const chain = slices.map((v) => v.n[chainRGB]);
    // where the chain's main part comes out: the slice by which half of it has
    let sum = 0;
    const chainMid = chain.findIndex((n) => (sum += n) >= fed.chain / 2);
    // most of the triangle has come out before then, in slices that are, of the two, all triangle
    const pure = tri.reduce((a, n, i) => (i < chainMid && n > 0 && chain[i] <= 0.001 * n ? a + n : a), 0);
    expect(pure / fed.tri).toBeGreaterThan(0.5);
    // and both come out in full, give or take a few molecules
    expect(caught.n[triangle] / fed.tri).toBeGreaterThan(0.9999);
    expect(caught.n[chainRGB] / fed.chain).toBeGreaterThan(0.9999);
  });

  it('fed the mixture continuously, lets the triangle out alone first', () => {
    const t = wet();
    t.valves[0] = 1;
    const slices: Vessel[] = [];
    for (let s = 0; s < 120; s++) {
      topUp(t, [[triangle, 0.5], [chainRGB, 0.5]]);
      const v = new Vessel(Infinity);
      run(t, 0.5, v);
      slices.push(v);
    }
    const first = (s: number) => slices.findIndex((v) => v.n[s] > 0);
    expect(first(triangle)).toBeGreaterThanOrEqual(0);
    expect(first(chainRGB)).toBeGreaterThan(first(triangle) + 4);
    expect(slices.slice(first(triangle), first(chainRGB)).every((v) => v.n[chainRGB] === 0 && v.n[triangle] > 0)).toBe(true);
  });

  it('keeps how far its bed has soaked, and what is on it, in a save', () => {
    const t = new Tool('column', 0);
    t.remember([0.4]);
    expect(t.memory).toEqual([0.4]);
    t.remember([7]);
    expect(t.memory).toEqual([1]);
    t.remember([0.3, 0.1]);
    t.remember(['x']);
    expect(t.memory).toEqual([1]);
    const u = wet();
    topUp(u, [[triangle, 1]], 0.5);
    u.valves[0] = 1;
    run(u, 2);
    const v = new Tool('column', 1);
    u.bed.forEach((c, k) => loadVessel(v.bed[k], saveVessel(c)));
    v.remember(u.memory);
    expect(v.soaked).toBe(1);
    expect(v.bed.map((c) => [...c.n])).toEqual(u.bed.map((c) => [...c.n]));
    expect(v.bed.map((c) => c.Q)).toEqual(u.bed.map((c) => c.Q));
  });

  it('shows what is on its bed as the strip would, wet: a clear carrier only tints it', () => {
    expect(columnInk(triangle, 0)).toBe(0);
    const cell = COLUMN.cap / C;
    expect(columnInk(G, cell / roomFor(G))).toBeLessThanOrEqual(STRIP.tint);
    expect(columnInk(triangle, (0.1 * cell) / roomFor(triangle))).toBeGreaterThan(0.2);
    expect(columnInk(triangle, cell / roomFor(triangle))).toBeGreaterThan(0.9);
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

  it('is not harmed by the solvent, which dilutes what does harm it', () => {
    const v = new Vessel(Infinity);
    v.setMolecules(SOLVENT_SPECIES, 1000);
    v.setTemperature(1);
    expect(harm(v)).toBe(0);
    // a pair's two loose ends, among as many molecules again of solvent, are one per molecule
    v.setMolecules(pairOf('R', 'G'), 1000);
    expect(harm(v)).toBe(1);
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

describe('thermometers', () => {
  const KINDS = Object.keys(THERMOMETERS) as ThermometerKind[];
  /** Run `t` for `seconds` with its bulb in `bath` (null for the air). */
  function soak(t: Tool, seconds: number, bath: Vessel | null): void {
    t.bath = bath;
    for (let i = 0; i < Math.round(seconds / 0.02); i++) t.step(0.02);
  }
  const bath = (T: number) => filled(new Vessel(CAP), R, CAP / 2, T);

  it('are glass rods, with no tanks, spouts or valves', () => {
    for (const kind of KINDS) {
      const t = new Tool(kind, 0);
      expect(isThermometer(kind)).toBe(true);
      expect([t.tanks.length, t.shape.spouts.length, t.valves.length]).toEqual([0, 0, 0]);
      expect(INLINE_TOOLS).not.toContain(kind);
      expect(t.step(0.02)).toEqual([]);
    }
    expect(isThermometer('meter')).toBe(false);
  });

  it("start at the room's temperature, and take that of the fluid their bulb is in, with a lag", () => {
    for (const kind of KINDS) {
      const t = new Tool(kind, 0);
      expect(t.temp).toBe(COOLING.ambient);
      expect(t.reads).toBe(COOLING.ambient);
      const b = bath(0.8 * THERMOMETERS[kind].top);
      const T = temperature(b);
      soak(t, THERMOMETER.tau, b);
      // all but 1/e of the way there after tau
      expect((t.temp - COOLING.ambient) / (T - COOLING.ambient)).toBeCloseTo(1 - 1 / Math.E, 3);
      soak(t, 20 * THERMOMETER.tau, b);
      expect(t.temp).toBeCloseTo(T, 6);
      expect(t.reads).toBe(t.temp);
    }
  });

  it("drift back to the room's temperature in the air, or in an empty vessel, more slowly", () => {
    const t = new Tool('thermometerWide', 0);
    const T = temperature(bath(0.8 * THERMOMETERS.thermometerWide.top));
    soak(t, 30 * THERMOMETER.tau, bath(T));
    soak(t, THERMOMETER.roomTau, null);
    expect((t.temp - COOLING.ambient) / (T - COOLING.ambient)).toBeCloseTo(1 / Math.E, 3);
    soak(t, 40 * THERMOMETER.roomTau, new Vessel(CAP));
    expect(t.temp).toBe(COOLING.ambient);
  });

  it('have linear scales, from 0 at the foot to their top, the column stopping at the top of the capillary', () => {
    for (const kind of KINDS) {
      const { top } = THERMOMETERS[kind];
      expect(thermometerAt(kind, 0)).toBe(0);
      expect(thermometerAt(kind, -1)).toBe(0);
      expect(thermometerAt(kind, top / 4)).toBeCloseTo(0.25, 12);
      expect(thermometerAt(kind, top / 2)).toBeCloseTo(0.5, 12);
      expect(thermometerAt(kind, top)).toBeCloseTo(1, 12);
      expect(thermometerAt(kind, 10 * top)).toBe(THERMOMETER.burst);
    }
    // the wide one's scale is the wider
    expect(THERMOMETERS.thermometerWide.top).toBeGreaterThan(THERMOMETERS.thermometer.top);
  });

  it('shatter for good once the bulb passes THERMOMETER.burst times their top, and read nothing after', () => {
    for (const kind of KINDS) {
      const { top } = THERMOMETERS[kind];
      const t = new Tool(kind, 0);
      const hot = bath(2 * top);
      t.bath = hot;
      while (!t.broken) {
        const before = t.temp;
        t.step(0.02);
        // whole, it never read more than the burst
        if (!t.broken) expect(t.temp).toBeLessThanOrEqual(THERMOMETER.burst * top);
        else expect(before).toBeLessThanOrEqual(THERMOMETER.burst * top);
      }
      expect(t.temp).toBeGreaterThan(THERMOMETER.burst * top);
      expect(t.reads).toBeNull();
      const at = t.temp;
      soak(t, 20 * THERMOMETER.tau, bath(top / 2));
      soak(t, 20 * THERMOMETER.roomTau, null);
      expect(t.broken).toBe(true);
      expect(t.reads).toBeNull();
      expect(t.temp).toBe(at);
    }
  });

  it('survive a dip in something too hot for them, shorter than their bulb takes to get that hot', () => {
    for (const kind of KINDS) {
      const { top } = THERMOMETERS[kind];
      const hot = bath(2 * top);
      const T = temperature(hot);
      // how long the bulb takes to pass the burst, from the room's temperature
      const burst = THERMOMETER.tau * Math.log((T - COOLING.ambient) / (T - THERMOMETER.burst * top));
      const t = new Tool(kind, 0);
      soak(t, burst / 2, hot);
      soak(t, 30 * THERMOMETER.roomTau, null);
      expect(t.broken).toBe(false);
      expect(t.reads).toBe(COOLING.ambient);
      // but not one twice as long
      const u = new Tool(kind, 1);
      soak(u, 2 * burst, hot);
      expect(u.broken).toBe(true);
    }
  });

  it('keep their bulb\'s temperature and whether they\'re broken in a save, and ignore a bad one', () => {
    for (const kind of KINDS) {
      const t = new Tool(kind, 0);
      expect(t.memory).toEqual([COOLING.ambient, 0]);
      t.remember([3, 0]);
      expect(t.memory).toEqual([3, 0]);
      expect(t.reads).toBe(3);
      const u = new Tool(kind, 1);
      u.remember(t.memory);
      expect(u.memory).toEqual([3, 0]);
      t.remember([2.5, 1]);
      expect(t.broken).toBe(true);
      expect(t.reads).toBeNull();
      expect(t.memory).toEqual([2.5, 1]);
      // the wrong length (as an old inline thermometer's reading and markers), not a list, or not all numbers
      t.remember([1, 2, 3]);
      t.remember('x');
      t.remember([1, NaN]);
      expect(t.memory).toEqual([2.5, 1]);
    }
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

  it('sorts the solvent as it does any single atom', () => {
    const f = new Vessel(Infinity);
    f.setMolecules(R, 1e9);
    f.setMolecules(SOLVENT_SPECIES, 1e9);
    f.setTemperature(1);
    for (const v of sieve(f)) expect(v.n[SOLVENT_SPECIES] / 1e9).toBeCloseTo(v.n[R] / 1e9, 3);
  });

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

  it('has no sector for the solvent, but counts the room it takes', () => {
    const S = SOLVENT_SPECIES;
    expect(read([[S, CUP]]).every((x) => x === 0)).toBe(true);
    // half R, half S: R's sector half lit, against the whole sample, as for half R, half G
    const r = read([[R, 0.5 * CUP], [S, 0.5 * CUP]]);
    expect(r[at(1, 'R')]).toBeCloseTo(0.5, 9);
    expect(r.reduce((t, x) => t + x, 0)).toBeCloseTo(0.5, 9);
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
    expect(SEPARATOR_OUTLET[SOLVENT_SPECIES]).toBe(0);
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
