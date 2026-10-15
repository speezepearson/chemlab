import { describe, expect, it } from 'vitest';
import { MAX_OUTLINE_WIDTH, defaultOutline, parseOutline } from './outline';

describe('outline', () => {
  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseOutline(null)).toEqual(defaultOutline());
    expect(parseOutline('not json')).toEqual(defaultOutline());
    expect(parseOutline('[1, 2]')).toEqual(defaultOutline());
    expect(parseOutline(JSON.stringify({ color: '#12AB9f', width: 0 }))).toEqual({ color: '#12ab9f', width: 0 });
    expect(parseOutline(JSON.stringify({ color: 'red', width: MAX_OUTLINE_WIDTH + 1 }))).toEqual(defaultOutline());
    expect(parseOutline(JSON.stringify({ color: '#fff', width: -1 }))).toEqual(defaultOutline());
    expect(parseOutline(JSON.stringify({ width: 3.5 }))).toEqual({ ...defaultOutline(), width: 3.5 });
  });
});
