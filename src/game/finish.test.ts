import { describe, expect, it } from 'vitest';
import { defaultFinish, parseFinish, roughnessAt } from './finish';

describe('finish', () => {
  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseFinish(null)).toEqual(defaultFinish());
    expect(parseFinish('not json')).toEqual(defaultFinish());
    expect(parseFinish('[1, 2]')).toEqual(defaultFinish());
    expect(parseFinish(JSON.stringify({ shine: 0 }))).toEqual({ shine: 0 });
    expect(parseFinish(JSON.stringify({ shine: 1 }))).toEqual({ shine: 1 });
    expect(parseFinish(JSON.stringify({ shine: 0.35 }))).toEqual({ shine: 0.35 });
    for (const shine of [-0.1, 1.5, '0.5', null]) expect(parseFinish(JSON.stringify({ shine }))).toEqual(defaultFinish());
  });

  it('leaves a metal as built at the default shine, and takes every metal to the same ends', () => {
    const mid = defaultFinish().shine;
    for (const base of [0.08, 0.28, 0.45, 0.8]) {
      expect(roughnessAt(base, mid)).toBeCloseTo(base, 12);
      expect(roughnessAt(base, 0)).toBe(1);
      expect(roughnessAt(base, 1)).toBe(0);
      // straight on each half
      expect(roughnessAt(base, 0.25)).toBeCloseTo((1 + base) / 2, 12);
      expect(roughnessAt(base, 0.75)).toBeCloseTo(base / 2, 12);
    }
  });

  it('lets a dressed surface go more matte than its map, and as shiny as any other metal', () => {
    const mid = defaultFinish().shine;
    expect(roughnessAt(1, mid, true)).toBeCloseTo(1, 12);
    expect(roughnessAt(1, 0, true)).toBe(2);
    expect(roughnessAt(1, 0.25, true)).toBeCloseTo(1.5, 12);
    expect(roughnessAt(1, 0.75, true)).toBeCloseTo(roughnessAt(1, 0.75), 12);
    expect(roughnessAt(1, 1, true)).toBe(0);
  });
});
