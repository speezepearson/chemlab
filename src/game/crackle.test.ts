import { describe, expect, it } from 'vitest';
import { REACTION_KINDS } from '../chem/reactions';
import { CRACKLE, crackleClicks, crackleRate } from './crackle';

describe('crackle', () => {
  it('clicks faster the busier a kind of reaction is, by well under its square root, up to a most', () => {
    expect(crackleRate(0)).toBe(0);
    expect(crackleRate(-1)).toBe(0);
    expect(crackleRate(CRACKLE.top)).toBe(CRACKLE.most);
    expect(crackleRate(100 * CRACKLE.top)).toBe(CRACKLE.most);
    for (const a of [1e-9, 1e-6, 1e-3]) {
      expect(crackleRate(10 * a)).toBeGreaterThan(crackleRate(a));
      expect(crackleRate(10 * a) / crackleRate(a)).toBeCloseTo(10 ** CRACKLE.power, 9);
      expect(crackleRate(10 * a) / crackleRate(a)).toBeLessThan(Math.sqrt(10));
    }
    // a mix a million times quieter than the liveliest still ticks over, every second or so
    expect(crackleRate(1e-6 * CRACKLE.top)).toBeGreaterThan(0.3);
    expect(crackleRate(1e-6 * CRACKLE.top)).toBeLessThan(2);
  });

  it('plays each kind its own share of a frame, on sim time, thinned alike when there are too many', () => {
    const quiet = REACTION_KINDS.map((_, k) => (k === 0 ? 1e-4 : k === 3 ? 1e-6 : 0));
    const dt = 1 / 60;
    const clicks = crackleClicks(quiet, dt, dt);
    expect(clicks).toEqual(quiet.map((a) => crackleRate(a) * dt));
    // nothing while paused; four times as many at 4×
    expect(crackleClicks(quiet, 0, dt)).toEqual([0, 0, 0, 0]);
    crackleClicks(quiet, 4 * dt, dt).forEach((c, k) => expect(c).toBeCloseTo(4 * clicks[k], 12));
    // everything flat out, at 16×: no more than there's room for in a real second, in the same shares
    const loud = REACTION_KINDS.map((_, k) => CRACKLE.top / (k + 1));
    const thinned = crackleClicks(loud, 16 * dt, dt);
    expect(thinned.reduce((a, b) => a + b, 0)).toBeCloseTo(CRACKLE.real * dt, 9);
    thinned.forEach((c, k) => expect(c / thinned[0]).toBeCloseTo(crackleRate(loud[k]) / crackleRate(loud[0]), 9));
  });
});
