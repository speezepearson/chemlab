import { describe, expect, it } from 'vitest';
import { AIM_DEG, aimCone, defaultAim, parseAim } from './aim';

describe('aim', () => {
  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseAim(null)).toEqual(defaultAim());
    expect(parseAim('not json')).toEqual(defaultAim());
    expect(parseAim('[1, 2]')).toEqual(defaultAim());
    expect(parseAim(JSON.stringify({ deg: AIM_DEG.min }))).toEqual({ deg: AIM_DEG.min });
    expect(parseAim(JSON.stringify({ deg: AIM_DEG.max }))).toEqual({ deg: AIM_DEG.max });
    for (const deg of [AIM_DEG.min - 1, AIM_DEG.max + 1, '5', null]) expect(parseAim(JSON.stringify({ deg }))).toEqual(defaultAim());
  });

  it('starts somewhere on the slider, on one of its steps', () => {
    const { deg } = defaultAim();
    expect(deg).toBeGreaterThanOrEqual(AIM_DEG.min);
    expect(deg).toBeLessThanOrEqual(AIM_DEG.max);
    expect((deg - AIM_DEG.min) % AIM_DEG.step).toBe(0);
  });

  it('is the setting itself at the normal field of view, and narrows as the view zooms in, to cover as much of the screen', () => {
    const t = (d: number) => Math.tan((d * Math.PI) / 180);
    expect(aimCone(8, 90, 90)).toBeCloseTo(t(8), 12);
    // at a third of the field of view's tangent, a third of the setting's
    expect(aimCone(8, 2 * (Math.atan(t(45) / 3) * 180) / Math.PI, 90)).toBeCloseTo(t(8) / 3, 12);
    expect(aimCone(8, 30, 90)).toBeLessThan(aimCone(8, 90, 90));
  });
});
