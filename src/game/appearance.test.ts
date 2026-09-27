import { describe, expect, it } from 'vitest';
import { coronaAlpha, coronaRadius, glowStrength, haloAlpha, haloRadius, heatValue, whiteHeat } from './appearance';

const FNS = { heatValue, glowStrength, whiteHeat, coronaAlpha, coronaRadius, haloAlpha, haloRadius };

describe('temperature appearance', () => {
  for (const [name, fn] of Object.entries(FNS)) {
    it(`${name} is continuous and non-decreasing`, () => {
      // Consecutive samples on a gap-free grid, so a jump anywhere in [0, 200]
      // shows up as a big step between neighbors.
      const h = 1e-3;
      const scale = fn(200);
      let prev = fn(0);
      for (let i = 1; i <= 200 / h; i++) {
        const T = i * h;
        const cur = fn(T);
        if (cur < prev) expect.fail(`${name} decreases at T=${T}`);
        if (cur - prev > 0.005 * scale) expect.fail(`${name} jumps by ${cur - prev} at T=${T}`);
        prev = cur;
      }
    });
  }

  it('fades cold fluids to black, reaching nearly full value by T = 1', () => {
    expect(heatValue(0)).toBe(0);
    expect(heatValue(0.3)).toBeLessThan(0.7);
    expect(heatValue(1)).toBeGreaterThan(0.9);
  });

  it('glows subtly at T = 1, strongly at 10, blindingly at 100', () => {
    expect(coronaAlpha(0)).toBe(0);
    expect(haloAlpha(0)).toBe(0);
    expect(coronaAlpha(1)).toBeGreaterThan(0.1);
    expect(coronaAlpha(1)).toBeLessThan(0.3);
    expect(haloAlpha(10)).toBeGreaterThan(0.25);
    expect(haloRadius(10)).toBeGreaterThan(2 * haloRadius(1));
    expect(haloAlpha(100)).toBeGreaterThan(0.9);
    expect(whiteHeat(1)).toBeLessThan(0.05);
    expect(whiteHeat(100)).toBeGreaterThan(0.95);
  });
});
