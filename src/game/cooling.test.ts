import { describe, expect, it } from 'vitest';
import { singleOf } from '../chem/species';
import { temperature } from '../chem/reactions';
import { CAP } from './config';
import { COOLING, cool, exposure, restoreDefaultCooling, taper } from './cooling';
import { FLASK_OUTLINE, areaBelow, fillLevel } from './flaskShape';
import { Vessel } from './flask';
import { cupFillHeight } from './tools';

const R = singleOf('R');

function at(T: number, atoms = CAP): Vessel {
  const v = new Vessel(Infinity);
  v.setMolecules(R, atoms);
  v.setTemperature(T);
  return v;
}

/** How long fluid with `exp` exposure takes to close all but 1/e of its gap to ambient, in sim seconds. */
const tau = (exp: number) => 1 / (COOLING.rate * exp);

describe('cooling', () => {
  it('drifts toward ambient exponentially, from above or below', () => {
    for (const T0 of [10, 0.2]) {
      const v = at(T0);
      for (let i = 0; i < 100; i++) cool(v, 0.5, 0.1);
      const expected = 1 + (T0 - 1) * Math.exp(-COOLING.rate * 0.5 * 10);
      expect(temperature(v)).toBeCloseTo(expected, 3);
    }
  });

  it('goes to whatever ambient is set to, and stops there', () => {
    COOLING.ambient = 3;
    const v = at(1);
    for (let i = 0; i < 1000; i++) cool(v, 10, 0.1);
    expect(temperature(v)).toBeCloseTo(3, 6);
    restoreDefaultCooling();
    expect(COOLING.ambient).toBe(1);
  });

  it('takes the room temperature at once in a film with no depth', () => {
    const v = at(50);
    cool(v, exposure(0, 10), 0.01);
    expect(temperature(v)).toBeCloseTo(1, 6);
  });

  it('exposes thin layers and narrow columns most, and deep wide pools least', () => {
    const fullDispenser = exposure(84, 60);
    const puddle = exposure(taper(0.025, 84, 60, 60).h, 60);
    const pipeTube = exposure(84, 10);
    expect(puddle).toBeGreaterThan(5 * fullDispenser);
    expect(pipeTube).toBeGreaterThan(3 * fullDispenser);
  });

  it('cools a full flask in about a minute, a full dispenser in two, a pipette in half a minute', () => {
    const area = areaBelow(FLASK_OUTLINE, 0);
    const flaskH = 70 - fillLevel(0, 1);
    expect(tau(exposure(flaskH, area / flaskH))).toBeCloseTo(65, -1);
    expect(tau(exposure(84, 60))).toBeCloseTo(110, -1);
    const h = cupFillHeight(1, 10, 84, 28, 14);
    expect(tau(exposure(h, (10 * 84 + 19 * 14) / h))).toBeCloseTo(27, -1);
    // a tenth of a flask in a dispenser (which holds four) lies 2 deep
    expect(tau(exposure(taper(0.1 / 4, 84, 60, 60).h, 60))).toBeLessThan(10);
  });

  it('measures a funnel from its narrow stem', () => {
    expect(taper(0, 30, 6, 44)).toEqual({ h: 0, w: 6 });
    expect(taper(1, 30, 6, 44)).toEqual({ h: 30, w: 25 });
    expect(taper(0.5, 30, 6, 44).w).toBeCloseTo(15.5);
  });
});
