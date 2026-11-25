import { describe, expect, it } from 'vitest';
import { defaultFittings, parseFittings } from './fittings';

describe('fittings', () => {
  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseFittings(null)).toEqual(defaultFittings());
    expect(parseFittings('not json')).toEqual(defaultFittings());
    expect(parseFittings('[1, 2]')).toEqual(defaultFittings());
    expect(parseFittings(JSON.stringify({ stands: false }))).toEqual({ ...defaultFittings(), stands: false });
    for (const tall of [false, true]) expect(parseFittings(JSON.stringify({ tall }))).toEqual({ ...defaultFittings(), tall });
    for (const v of [0, 'false', null]) expect(parseFittings(JSON.stringify({ stands: v, tall: v }))).toEqual(defaultFittings());
    for (const hose of [0, 0.3, 1]) expect(parseFittings(JSON.stringify({ hose }))).toEqual({ ...defaultFittings(), hose });
    for (const hose of [-0.1, 1.5, '0.5', null]) expect(parseFittings(JSON.stringify({ hose }))).toEqual(defaultFittings());
  });

  it("starts with the hoses' tubes somewhere on the slider", () => {
    const { hose } = defaultFittings();
    expect(hose >= 0 && hose <= 1).toBe(true);
  });

  it('starts with the stands drawn', () => {
    expect(defaultFittings().stands).toBe(true);
  });
});
