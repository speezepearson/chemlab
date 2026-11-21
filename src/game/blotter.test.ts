import { describe, expect, it } from 'vitest';
import { TARGET, pairOf, singleOf } from '../chem/species';
import { CAP } from './config';
import { Vessel, volume } from './flask';
import { BLOTTERS, PAPER_TAU, TEST_PAPER, Tool, bondReading, paperReading, wetness } from './tools';

/*
 * What the sheets of blotting paper share: test paper and bond paper are one sheet, printed differently (see
 * testpaper.test.ts and bondpaper.test.ts for each one's print and reading).
 */

const R = singleOf('R');
const RG = pairOf('R', 'G');
const KINDS = BLOTTERS as readonly ('testpaper' | 'bondpaper')[];

/** A fluid of these species, each this share of what a sheet soaks up. */
function fluid(fill: [number, number][]): Vessel {
  const v = new Vessel(Infinity);
  for (const [s, share] of fill) v.setMolecules(s, share * CAP);
  return v;
}
/** What a sheet is to show for what it holds: how wet it is, then its reading. */
const calledFor = (t: Tool) => [
  wetness(volume(t.paper[0]), TEST_PAPER.cap, 1),
  ...(t.kind === 'testpaper' ? paperReading(t.paper[0]).flat() : bondReading(t.paper[0])),
];
/** Run a sheet for `s` sim seconds, in the sim's substeps. */
const run = (t: Tool, s: number, h = 0.02) => {
  for (let i = 0; i < Math.round(s / h); i++) t.step(h);
};
/** How far a sheet has come: the most that anything it shows is of what it's to show. */
const come = (t: Tool) => {
  const want = calledFor(t);
  return Math.max(...t.showing.map((x, i) => (want[i] > 0 ? x / want[i] : 0)));
};

describe.each(KINDS)('what a sheet of %s shows', (kind) => {
  /** A sheet with a mixture just landed on it: two thirds of what it soaks up. */
  const wetted = (id = 0) => {
    const t = new Tool(kind, id);
    t.paper[0].addFrom(fluid([[R, 0.3], [RG, 0.5], [TARGET, 0.2]]), (2 / 3) * TEST_PAPER.cap, true);
    return t;
  };

  it('is nothing, on a new sheet: dry, and its print as it came', () => {
    const t = new Tool(kind, 0);
    expect(t.showing).toHaveLength(calledFor(t).length);
    expect(t.showing.every((x) => x === 0)).toBe(true);
    expect(t.developed).toBe(true);
    run(t, 1);
    expect(t.showing.every((x) => x === 0)).toBe(true);
  });

  it('comes up over about two seconds: at once, at its fastest, and ever more gently', () => {
    const t = wetted();
    const want = calledFor(t);
    expect(want[0]).toBeCloseTo(2 / 3, 5);
    expect(want.filter((x) => x > 0).length).toBeGreaterThan(1);
    // what's landed hasn't shown yet
    expect(t.showing.every((x) => x === 0)).toBe(true);
    expect(t.developed).toBe(false);
    // no easing in: the first step is the biggest, and each after it smaller
    const steps: number[] = [];
    for (let i = 0; i < 100; i++) {
      const was = t.showing[0];
      t.step(0.02);
      steps.push(t.showing[0] - was);
    }
    expect(steps[0]).toBeGreaterThan(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
    // two seconds in, it's all but there, everything it shows having come the same share of its way
    t.showing.forEach((x, i) => expect(x).toBeCloseTo(want[i] * (1 - Math.exp(-2 / PAPER_TAU)), 9));
    expect(come(t)).toBeGreaterThan(0.97);
    expect(come(t)).toBeLessThan(1);
    expect(t.developed).toBe(false);
    // and then it's there, and stays
    run(t, 6);
    expect([...t.showing]).toEqual(want);
    expect(t.developed).toBe(true);
    run(t, 5);
    expect([...t.showing]).toEqual(want);
  });

  it('is about two thirds of the way after half a second, and seven eighths after one', () => {
    const t = wetted();
    run(t, PAPER_TAU);
    expect(come(t)).toBeCloseTo(1 - Math.exp(-1), 9);
    run(t, PAPER_TAU);
    expect(come(t)).toBeCloseTo(1 - Math.exp(-2), 9);
    expect(PAPER_TAU).toBeGreaterThanOrEqual(0.4);
    expect(PAPER_TAU).toBeLessThanOrEqual(0.7);
  });

  it('comes up the same however the time is cut into steps', () => {
    const [a, b, c] = [wetted(1), wetted(2), wetted(3)];
    // (each got its own random share of the mixture's molecules)
    run(a, 0.8, 0.02);
    run(b, 0.8, 0.005);
    c.step(0.8);
    expect(come(a)).toBeCloseTo(come(c), 9);
    expect(come(b)).toBeCloseTo(come(c), 9);
  });

  it('makes for more, from where it has got to, when more lands on it as it develops', () => {
    const t = new Tool(kind, 0);
    const mix = fluid([[RG, 1]]);
    t.paper[0].addFrom(mix, TEST_PAPER.cap / 4, true);
    run(t, 0.5);
    const was = [...t.showing];
    t.paper[0].addFrom(mix, TEST_PAPER.cap / 2, true);
    // nothing jumps as it lands
    expect([...t.showing]).toEqual(was);
    t.step(0.02);
    const want = calledFor(t);
    t.showing.forEach((x, i) => {
      expect(x).toBeGreaterThanOrEqual(was[i]);
      expect(x).toBeLessThanOrEqual(want[i]);
    });
    expect(t.showing[0]).toBeGreaterThan(was[0]);
    run(t, 8);
    expect([...t.showing]).toEqual(want);
  });

  it('is kept by a save while it is still coming up, and put back as it was', () => {
    const t = wetted();
    run(t, 0.6);
    const kept = t.memory!;
    expect(kept).toEqual([...t.showing]);
    expect(kept.every(Number.isFinite)).toBe(true);
    // (as the engine loads a tool: what it kept, then what it holds)
    const back = new Tool(kind, 0);
    back.remember(JSON.parse(JSON.stringify(kept)));
    back.paper[0].addFrom(t.paper[0], volume(t.paper[0]), true);
    expect([...back.showing]).toEqual(kept);
    expect(back.developed).toBe(false);
    // and it goes on from there
    run(back, 0.4);
    run(t, 0.4);
    back.showing.forEach((x, i) => expect(x).toBeCloseTo(t.showing[i], 9));
  });

  it('is all there, in a sheet from a save that kept none of it: one made before sheets took time, or done developing', () => {
    const t = wetted();
    run(t, 10);
    expect(t.developed).toBe(true);
    expect(t.memory).toBeUndefined();
    expect(new Tool(kind, 1).memory).toBeUndefined();
    for (const m of [undefined, [], [0.5], 'wet', [NaN, 0, 0, 0, 0, 0, 0]]) {
      const back = new Tool(kind, 0);
      back.remember(m);
      back.paper[0].addFrom(t.paper[0], volume(t.paper[0]), true);
      expect([...back.showing]).toEqual(calledFor(back));
      expect(back.developed).toBe(true);
      // and running it changes nothing
      run(back, 1);
      expect([...back.showing]).toEqual(calledFor(back));
    }
  });
});
