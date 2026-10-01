import { describe, expect, it } from 'vitest';
import { FLASK_OUTLINE, areaBelow, fillLevel, tiltedOutline } from './flaskShape';

const ANGLES = [0, 0.3, Math.PI / 2, Math.PI * 0.61, Math.PI];
const FULL = areaBelow(FLASK_OUTLINE, 0);

describe('flask fill level', () => {
  it('covers the whole flask when full and none of it when empty, at any tilt', () => {
    for (const ang of ANGLES) {
      const pts = tiltedOutline(ang);
      expect(fillLevel(ang, 1)).toBeCloseTo(Math.min(...pts.map((p) => p.y)), 6);
      expect(fillLevel(ang, 0)).toBeCloseTo(Math.max(...pts.map((p) => p.y)), 6);
    }
  });

  it('leaves an area under the surface in proportion to the fill, at any tilt', () => {
    for (const ang of ANGLES) {
      const pts = tiltedOutline(ang);
      expect(areaBelow(pts, -1e9)).toBeCloseTo(FULL, 6); // turning doesn't change the area
      for (const frac of [0.001, 0.1, 0.25, 0.5, 0.9])
        expect(areaBelow(pts, fillLevel(ang, frac)) / FULL, `${ang} ${frac}`).toBeCloseTo(frac, 6);
    }
  });

  it('rises slowly through the wide base and fast up the narrow neck', () => {
    const rise = (a: number, b: number) => fillLevel(0, a) - fillLevel(0, b);
    expect(rise(0.9, 1)).toBeGreaterThan(2 * rise(0.1, 0.2));
  });

  it('keeps a trace of fluid visible in a flask tipped to pour', () => {
    const ang = Math.PI * 0.61;
    const bottom = Math.max(...tiltedOutline(ang).map((p) => p.y));
    expect(bottom - fillLevel(ang, 0.02)).toBeGreaterThan(1);
  });
});
