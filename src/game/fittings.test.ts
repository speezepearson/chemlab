import { describe, expect, it } from 'vitest';
import { defaultFittings, parseFittings } from './fittings';

describe('fittings', () => {
  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseFittings(null)).toEqual(defaultFittings());
    expect(parseFittings('not json')).toEqual(defaultFittings());
    expect(parseFittings('[1, 2]')).toEqual(defaultFittings());
    expect(parseFittings(JSON.stringify({ stands: false }))).toEqual({ ...defaultFittings(), stands: false });
    expect(parseFittings(JSON.stringify({ tall: false }))).toEqual({ ...defaultFittings(), tall: false });
    for (const v of [0, 'false', null]) expect(parseFittings(JSON.stringify({ stands: v, tall: v }))).toEqual(defaultFittings());
  });

  it('starts with the stands drawn, full height', () => {
    expect(defaultFittings()).toMatchObject({ stands: true, tall: true });
  });
});
