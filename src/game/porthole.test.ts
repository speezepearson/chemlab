import { describe, expect, it } from 'vitest';
import { PORT_MAX, PORT_WALL, porthole, roundedArea } from './porthole';

const frac = (p: ReturnType<typeof porthole>) => roundedArea(p.w, p.h, p.c) / (PORT_WALL.w * PORT_WALL.h);

describe('porthole', () => {
  it('takes up the fraction of the wall asked for', () => {
    for (const f of [0.001, 0.02, 0.2, 0.5, PORT_MAX]) expect(frac(porthole(f)) / f).toBeCloseTo(1, 6);
  });

  it('is a circle while small', () => {
    const p = porthole(0.01);
    expect(p.w).toBeCloseTo(p.h, 9);
    expect(p.c).toBeCloseTo(p.w / 2, 9);
  });

  it('grows across, then squarer, staying on the wall', () => {
    let last = porthole(0);
    for (let f = 0.01; f <= PORT_MAX; f += 0.01) {
      const p = porthole(f);
      expect(p.w).toBeGreaterThanOrEqual(last.w - 1e-6);
      expect(p.h).toBeGreaterThanOrEqual(last.h - 1e-6);
      expect(p.w).toBeLessThan(PORT_WALL.w);
      expect(p.cy - p.h / 2).toBeGreaterThan(0);
      expect(p.cy + p.h / 2).toBeLessThan(PORT_WALL.h);
      last = p;
    }
    expect(porthole(PORT_MAX).c).toBeLessThan(porthole(PORT_MAX).h / 2);
  });

  it("can't be asked for more than it can be", () => {
    expect(frac(porthole(1))).toBeCloseTo(PORT_MAX, 9);
  });
});
