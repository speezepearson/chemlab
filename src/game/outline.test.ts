import { describe, expect, it } from 'vitest';
import { MAX_OUTLINE_WIDTH, defaultOutline, parseOutline } from './outline';

describe('outline', () => {
  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseOutline(null)).toEqual(defaultOutline());
    expect(parseOutline('not json')).toEqual(defaultOutline());
    expect(parseOutline('[1, 2]')).toEqual(defaultOutline());
    expect(parseOutline(JSON.stringify({ color: '#12AB9f', width: 0, faint: 0.5 }))).toEqual({ color: '#12ab9f', width: 0, faint: 0.5 });
    expect(parseOutline(JSON.stringify({ color: 'red', width: MAX_OUTLINE_WIDTH + 1 }))).toEqual(defaultOutline());
    expect(parseOutline(JSON.stringify({ color: '#fff', width: -1 }))).toEqual(defaultOutline());
    expect(parseOutline(JSON.stringify({ width: 3.5 }))).toEqual({ ...defaultOutline(), width: 3.5 });
  });

  it('takes a faint outline from none to full, and defaults it when stored settings have none or junk', () => {
    expect(parseOutline(JSON.stringify({ color: '#000000', width: 1 }))).toEqual({ ...defaultOutline(), color: '#000000', width: 1 });
    expect(parseOutline(JSON.stringify({ faint: 0 })).faint).toBe(0);
    expect(parseOutline(JSON.stringify({ faint: 1 })).faint).toBe(1);
    for (const faint of [-0.1, 1.5, '0.5', null]) expect(parseOutline(JSON.stringify({ faint })).faint).toBe(defaultOutline().faint);
  });
});
