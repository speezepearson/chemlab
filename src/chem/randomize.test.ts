import { describe, expect, it } from 'vitest';
import { defaultChemParams } from './params';
import { PINNED_E, draw, randomizeBonds, type Dist } from './randomize';

/** A seeded generator (mulberry32), so the statistics below don't flake. */
function seeded(seed: number): () => number {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const P = { mean: 5, sd: 2, median: 3, sigma: 1, lo: 1, hi: 4, logLo: 0.1, logHi: 100 };
const sample = (d: Dist, n = 20000) => {
  const rand = seeded(1);
  return Array.from({ length: n }, () => draw(d, rand));
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

describe('randomizer', () => {
  it('draws from each distribution', () => {
    const normal = sample({ kind: 'normal', p: P, flip: 0 });
    expect(mean(normal)).toBeCloseTo(5, 1);
    expect(Math.sqrt(mean(normal.map((x) => (x - 5) ** 2)))).toBeCloseTo(2, 1);
    const logn = sample({ kind: 'lognormal', p: P, flip: 0 });
    expect(median(logn)).toBeCloseTo(3, 0);
    expect(Math.min(...logn)).toBeGreaterThan(0);
    const uni = sample({ kind: 'uniform', p: P, flip: 0 });
    expect(Math.min(...uni)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...uni)).toBeLessThanOrEqual(4);
    const logu = sample({ kind: 'loguniform', p: P, flip: 0 });
    // log-uniform over 0.1–100: each decade equally likely, so the median is √(0.1·100) ≈ 3.16
    expect(median(logu)).toBeGreaterThan(2.8);
    expect(median(logu)).toBeLessThan(3.6);
    expect(Math.min(...logu)).toBeGreaterThanOrEqual(0.1);
    expect(Math.max(...logu)).toBeLessThanOrEqual(100);
  });

  it('negates with the given probability', () => {
    const xs = sample({ kind: 'uniform', p: P, flip: 0.3 });
    expect(xs.filter((x) => x < 0).length / xs.length).toBeCloseTo(0.3, 1);
    expect(sample({ kind: 'uniform', p: P, flip: 1 }).every((x) => x < 0)).toBe(true);
  });

  it('randomizes every bond, but keeps blue bonds at E = −2 and R–G at E = 100, and the prefactors', () => {
    const params = defaultChemParams();
    const before = structuredClone(params.bonds);
    const d: Dist = { kind: 'uniform', p: { ...P, lo: 10, hi: 20 }, flip: 0 };
    randomizeBonds(params, d, d, seeded(7));
    for (const [k, b] of Object.entries(params.bonds)) {
      expect(b.E).toBe(PINNED_E[k] ?? b.E);
      if (!(k in PINNED_E)) expect(b.E).toBeGreaterThanOrEqual(10);
      expect(b.Ea).toBeGreaterThanOrEqual(10);
      expect(b.A).toBe(before[k].A);
    }
    expect(['RB', 'CB', 'GB', 'MB'].map((k) => params.bonds[k].E)).toEqual([-2, -2, -2, -2]);
    expect(params.bonds.RG.E).toBe(100);
  });
});
