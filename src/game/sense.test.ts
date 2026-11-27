import { afterEach, describe, expect, it, vi } from 'vitest';
import { JUDGE, misjudge } from './sense';

describe('misjudge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is off by up to JUDGE / 2 either way, evenly, and exact in the middle', () => {
    expect(misjudge(3, () => 0.5)).toBe(3);
    expect(misjudge(3, () => 0)).toBeCloseTo(3 * (1 - JUDGE / 2), 12);
    expect(misjudge(3, () => 0.999999)).toBeCloseTo(3 * (1 + JUDGE / 2), 5);
    expect(misjudge(3, () => 0.75)).toBeCloseTo(3 * (1 + JUDGE / 4), 12);
    for (let r = 0; r < 1; r += 0.01) {
      const x = misjudge(10, () => r);
      expect(x).toBeGreaterThanOrEqual(10 * (1 - JUDGE / 2) - 1e-12);
      expect(x).toBeLessThan(10 * (1 + JUDGE / 2));
    }
    expect(misjudge(0, () => 0.1)).toBe(0);
  });

  it('draws once, from Math.random unless it’s given another source', () => {
    const r = vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(misjudge(2)).toBeCloseTo(2 * (1 + JUDGE / 2), 12);
    expect(r).toHaveBeenCalledTimes(1);
    let n = 0;
    misjudge(2, () => (n++, 0.3));
    expect(n).toBe(1);
  });
});
