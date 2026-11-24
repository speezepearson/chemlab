import { describe, expect, it } from 'vitest';
import { HOSE_DEG, aimCone, defaultHoseAim, parseHoseAim } from './hoseAim';

describe('hose aim', () => {
  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseHoseAim(null)).toEqual(defaultHoseAim());
    expect(parseHoseAim('not json')).toEqual(defaultHoseAim());
    expect(parseHoseAim('[1, 2]')).toEqual(defaultHoseAim());
    expect(parseHoseAim(JSON.stringify({ deg: HOSE_DEG.min }))).toEqual({ deg: HOSE_DEG.min });
    expect(parseHoseAim(JSON.stringify({ deg: HOSE_DEG.max }))).toEqual({ deg: HOSE_DEG.max });
    for (const deg of [HOSE_DEG.min - 1, HOSE_DEG.max + 1, '5', null]) expect(parseHoseAim(JSON.stringify({ deg }))).toEqual(defaultHoseAim());
  });

  it('starts somewhere on the slider, on one of its steps', () => {
    const { deg } = defaultHoseAim();
    expect(deg).toBeGreaterThanOrEqual(HOSE_DEG.min);
    expect(deg).toBeLessThanOrEqual(HOSE_DEG.max);
    expect((deg - HOSE_DEG.min) % HOSE_DEG.step).toBe(0);
  });

  it('is the setting itself at the normal field of view, and narrows as the view zooms in, to cover as much of the screen', () => {
    const t = (d: number) => Math.tan((d * Math.PI) / 180);
    expect(aimCone(8, 90, 90)).toBeCloseTo(t(8), 12);
    // at a third of the field of view's tangent, a third of the setting's
    expect(aimCone(8, 2 * (Math.atan(t(45) / 3) * 180) / Math.PI, 90)).toBeCloseTo(t(8) / 3, 12);
    expect(aimCone(8, 30, 90)).toBeLessThan(aimCone(8, 90, 90));
  });
});
