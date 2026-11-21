import { describe, expect, it } from 'vitest';
import { ease, inPod, type Wake } from './airlock';

describe('airlock', () => {
  it('tells when the player is shut in the pod', () => {
    const shut: Wake[] = ['pod', 'flicker', 'opening', 'boarding', 'asleep', 'arriving', 'arrived'];
    const free: Wake[] = ['out', 'closed', 'open'];
    for (const w of shut) expect(inPod(w), w).toBe(true);
    for (const w of free) expect(inPod(w), w).toBe(false);
  });
});

describe('ease', () => {
  it('goes smoothly from 0 to 1, and stays there outside', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 12);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    // slow at either end
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
    for (let t = 0; t < 1; t += 0.05) expect(ease(t + 0.05)).toBeGreaterThanOrEqual(ease(t));
  });
});
