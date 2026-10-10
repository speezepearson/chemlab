import { describe, expect, it } from 'vitest';
import { placement } from './place';

describe('placement', () => {
  it('plays something close ahead at full volume, centered', () => {
    expect(placement(0, 0, -100)).toEqual({ gain: 1, pan: 0 });
    expect(placement(0, 0, 0)).toEqual({ gain: 1, pan: 0 });
  });

  it('fades with distance, to silence far off', () => {
    const g = [400, 800, 1600, 3200, 6000].map((d) => placement(0, 0, -d).gain);
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeLessThan(g[i - 1]);
    expect(g[1]).toBeCloseTo(0.5);
    expect(g[4]).toBe(0);
  });

  it('pans toward the side it is on, and is quieter behind', () => {
    expect(placement(100, 0, 0).pan).toBeCloseTo(0.8);
    expect(placement(-100, 0, 0).pan).toBeCloseTo(-0.8);
    expect(placement(30, 0, -100).pan).toBeGreaterThan(0);
    expect(placement(0, 0, 100).gain).toBeCloseTo(0.6);
    expect(placement(0, 0, 100).pan).toBe(0);
  });
});
