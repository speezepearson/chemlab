import { describe, expect, it } from 'vitest';
import { defaultScroll, parseScroll } from './scroll';

describe('scroll', () => {
  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseScroll(null)).toEqual(defaultScroll());
    expect(parseScroll('not json')).toEqual(defaultScroll());
    expect(parseScroll('[1, 2]')).toEqual(defaultScroll());
    expect(parseScroll(JSON.stringify({ invert: 'yes' }))).toEqual(defaultScroll());
    expect(parseScroll(JSON.stringify({ invert: !defaultScroll().invert }))).toEqual({ invert: !defaultScroll().invert });
  });
});
