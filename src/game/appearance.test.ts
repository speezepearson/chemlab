import { afterEach, describe, expect, it } from 'vitest';
import { ATOM_RGB } from '../chem/atoms';
import { pairOf, singleOf } from '../chem/species';
import { Vessel, fluidAlpha, fluidHue } from './flask';
import {
  LOOK, defaultLook, glowFalloff, heatValue, resetLook, whiteHeat,
} from './appearance';

const FNS = { heatValue, whiteHeat };

function expectContinuousNonDecreasing(name: string, fn: (T: number) => number) {
  // Consecutive samples on a gap-free grid, so a jump anywhere in [0, 200]
  // shows up as a big step between neighbors.
  const h = 1e-3;
  const scale = Math.max(fn(200), 1e-9);
  let prev = fn(0);
  for (let i = 1; i <= 200 / h; i++) {
    const T = i * h;
    const cur = fn(T);
    if (cur < prev) expect.fail(`${name} decreases at T=${T}`);
    if (cur - prev > 0.005 * scale) expect.fail(`${name} jumps by ${cur - prev} at T=${T}`);
    prev = cur;
  }
}

describe('temperature appearance', () => {
  for (const [name, fn] of Object.entries(FNS)) {
    it(`${name} is continuous and non-decreasing`, () => expectContinuousNonDecreasing(name, fn));
  }

  it('fades cold fluids to black, reaching nearly full value by T = 1', () => {
    expect(heatValue(0)).toBe(0);
    expect(heatValue(0.3)).toBeLessThan(0.7);
    expect(heatValue(1)).toBeGreaterThan(0.9);
  });

  it('washes hot fluids out to white: barely at T = 1, fully by 100', () => {
    expect(whiteHeat(1)).toBeLessThan(0.05);
    expect(whiteHeat(100)).toBeGreaterThan(0.95);
  });

  for (const sharpness of [1.5, 2]) {
    it(`glow falloff (sharpness ${sharpness}) fades smoothly to nothing, with no visible rim`, () => {
      expect(glowFalloff(0, sharpness)).toBe(1);
      expect(glowFalloff(1, sharpness)).toBe(0);
      const h = 1e-3;
      let prev = 1;
      for (let i = 1; i <= 1 / h; i++) {
        const cur = glowFalloff(i * h, sharpness);
        if (cur > prev) expect.fail(`falloff increases at x=${i * h}`);
        if (prev - cur > 0.005) expect.fail(`falloff jumps at x=${i * h}`);
        prev = cur;
      }
      // zero slope at the rim: the last few percent of the radius carry almost no light
      expect(glowFalloff(0.95, sharpness)).toBeLessThan(0.01);
    });
  }

  it('stays continuous with tuned (non-default) parameters', () => {
    // (a pow below 1 is still continuous but starts infinitely steep at T = 0,
    // which this finite-step jump detector can't tell from a jump)
    Object.assign(LOOK, { coldRate: 0.7, whiteRef: 5, whitePow: 1.3, fluidWhite: 0.3 });
    try {
      for (const [name, fn] of Object.entries(FNS)) expectContinuousNonDecreasing(name, fn);
      expect(whiteHeat(1000)).toBeCloseTo(0.3);
    } finally {
      resetLook();
    }
    expect(LOOK).toEqual(defaultLook());
  });
});

describe('composition', () => {
  const R = singleOf('R');
  const G = singleOf('G');
  const RG = pairOf('R', 'G');
  const fluid = (contents: [number, number][]) => {
    const v = new Vessel(Infinity);
    for (const [s, m] of contents) v.setMolecules(s, m);
    return v;
  };
  const free = fluid([[R, 100], [G, 100]]);
  const bonded = fluid([[RG, 100]]);
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((x, k) => x - b[k]));
  afterEach(resetLook);

  it("by default, colors a fluid by its atoms alone, so bonding doesn't change it", () => {
    expect(dist(fluidHue(free)!, fluidHue(bonded)!)).toBeLessThan(1e-9);
    expect(fluidAlpha(bonded)).toBe(1);
  });

  it('under the light model, bonding R and G brightens it', () => {
    LOOK.colorModel = 'light';
    expect(dist(fluidHue(free)!, fluidHue(bonded)!)).toBeGreaterThan(50);
    expect(Math.max(...fluidHue(bonded)!)).toBe(255);
    // a free atom is its own color under any model
    expect(fluidHue(fluid([[R, 1]]))).toEqual([...ATOM_RGB.R]);
  });

  it('under the paint model, bonding R and B turns it purple, red and blue over green', () => {
    LOOK.colorModel = 'paint';
    const rb = fluidHue(fluid([[pairOf('R', 'B'), 100]]))!;
    expect(Math.min(rb[0], rb[2])).toBeGreaterThan(1.5 * rb[1]);
  });

  it('with mix 0, any model is the default', () => {
    LOOK.colorModel = 'light';
    LOOK.lightMix = 0;
    expect(dist(fluidHue(free)!, fluidHue(bonded)!)).toBeLessThan(1e-9);
  });

  it('when cloudy, is as opaque as the atom-weighted alpha of its molecule sizes', () => {
    LOOK.cloudy = true;
    expect(fluidAlpha(free)).toBeCloseTo(LOOK.alpha1);
    expect(fluidAlpha(bonded)).toBeCloseTo(LOOK.alpha2);
    expect(fluidAlpha(fluid([[R, 100], [RG, 50]]))).toBeCloseTo((LOOK.alpha1 + LOOK.alpha2) / 2);
  });
});
