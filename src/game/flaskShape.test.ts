import { describe, expect, it } from 'vitest';
import { FLASK_H, fillLevel, flaskRadius } from './flaskShape';

const POUR = Math.PI * 0.61;

/** The upright flask's volume up to h below the mouth, as a sum of thin discs. */
function volumeBelow(depth: number): number {
  let v = 0;
  const dd = 0.01;
  for (let d = FLASK_H - dd / 2; d > depth; d -= dd) v += Math.PI * flaskRadius(d) ** 2 * dd;
  return v;
}

describe('flaskRadius', () => {
  it('follows the outline: a narrow neck over a wide base', () => {
    expect(flaskRadius(0)).toBeCloseTo(11, 6);
    expect(flaskRadius(22)).toBeCloseTo(9, 6);
    expect(flaskRadius(64)).toBeCloseTo(26, 6);
    expect(flaskRadius(80)).toBe(0);
  });
});

describe('flask fill level', () => {
  it('is at the bottom when empty and the top when full', () => {
    expect(Math.abs(fillLevel(0, 0) + FLASK_H)).toBeLessThan(1);
    expect(Math.abs(fillLevel(0, 1))).toBeLessThan(1);
  });

  it('leaves the volume under the surface in proportion to the fill, upright', () => {
    const full = volumeBelow(0);
    // to within the thickness of a slab
    for (const frac of [0.1, 0.5, 0.9]) expect(Math.abs(volumeBelow(-fillLevel(0, frac)) / full - frac)).toBeLessThan(0.01);
  });

  it('rises slowly through the wide base and fast up the narrow neck', () => {
    const rise = (a: number, b: number) => fillLevel(0, b) - fillLevel(0, a);
    expect(rise(0.9, 1)).toBeGreaterThan(2 * rise(0.1, 0.2));
  });

  it('rises with the fill at any tilt', () => {
    for (const tilt of [0, 0.3, Math.PI / 2, POUR, Math.PI]) {
      const levels = [0, 0.1, 0.5, 0.9, 1].map((f) => fillLevel(tilt, f));
      for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    }
  });

  it('is exactly at the floor when empty and the mouth when full, upright', () => {
    expect(fillLevel(0, 0)).toBeCloseTo(-FLASK_H, 9);
    expect(fillLevel(0, 1)).toBeCloseTo(0, 9);
  });

  it('rises smoothly from the floor with a trace of fluid, not a slab at a time', () => {
    const full = volumeBelow(0);
    // a percent or so lies in a film on the floor, thinner than the slabs it's worked out from, so it's only as close
    // as spreading the bottom row's volume evenly over its height allows
    for (const frac of [0.001, 0.005, 0.013]) {
      expect(fillLevel(0, frac)).toBeGreaterThan(-FLASK_H);
      expect(Math.abs(volumeBelow(-fillLevel(0, frac)) / full - frac)).toBeLessThan(frac * 0.4);
    }
    // no jumps: a little more fluid never raises it by a slab's height (0.6), as filling a row of them at once would
    // (but for the first and last drops, which in a tipped flask fill only a corner, and rise fast there)
    for (const tilt of [0, 0.3]) {
      let last = fillLevel(tilt, 0.001);
      for (let k = 21; k <= 19900; k++) {
        const l = fillLevel(tilt, k / 20000);
        expect(l).toBeGreaterThan(last);
        expect(l - last).toBeLessThan(0.1);
        last = l;
      }
    }
  });

  it('keeps a trace of fluid visible in a flask tipped to pour', () => {
    expect(fillLevel(POUR, 0.02) - fillLevel(POUR, 0)).toBeGreaterThan(1);
  });
});
