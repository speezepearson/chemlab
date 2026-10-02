import { describe, expect, it } from 'vitest';
import { placement } from './place';

describe('placement', () => {
  const W = 1000;
  const H = 600;

  it('is full volume anywhere in view, panned gently toward its side', () => {
    for (const [x, y] of [[500, 300], [0, 0], [1000, 600], [10, 590]]) expect(placement(x, y, W, H).gain).toBe(1);
    expect(placement(500, 300, W, H).pan).toBe(0);
    expect(placement(0, 300, W, H).pan).toBeCloseTo(-0.5);
    expect(placement(1000, 300, W, H).pan).toBeCloseTo(0.5);
  });

  it('fades the further off screen it is, to silence a whole view away', () => {
    const g = [1000, 1100, 1500, 1900, 2000, 3000].map((x) => placement(x, 300, W, H).gain);
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeLessThan(g[i - 1] + 1e-12);
    expect(g[0]).toBe(1);
    expect(g[2]).toBeCloseTo(0.25);
    expect(g[4]).toBe(0);
    expect(placement(500, -600, W, H).gain).toBe(0);
    expect(placement(500, 900, W, H).gain).toBeCloseTo(0.25);
  });

  it('pans all the way once well off to one side, and not at all for straight up or down', () => {
    expect(placement(-500, 300, W, H).pan).toBe(-1);
    expect(placement(1500, 300, W, H).pan).toBe(1);
    expect(placement(500, -300, W, H).pan).toBe(0);
  });
});
