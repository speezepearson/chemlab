import { describe, expect, it } from 'vitest';
import { CHANNELS, DEFAULT_VOLUME, defaultVolumes, gainOf, parseVolumes } from './volumes';

describe('volumes', () => {
  it('maps the middle of a slider to the designed level, the top to four times it, the bottom to silence', () => {
    expect(gainOf(DEFAULT_VOLUME)).toBe(1);
    expect(gainOf(1)).toBe(4);
    expect(gainOf(0)).toBe(0);
    expect(gainOf(2)).toBe(4);
    expect(gainOf(-1)).toBe(0);
  });

  it('starts every channel at the default', () => {
    for (const c of CHANNELS) expect(defaultVolumes()[c]).toBe(DEFAULT_VOLUME);
  });

  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseVolumes(null)).toEqual(defaultVolumes());
    expect(parseVolumes('not json')).toEqual(defaultVolumes());
    expect(parseVolumes('[1, 2]')).toEqual(defaultVolumes());
    const v = parseVolumes(JSON.stringify({ hum: 0.2, klaxon: 'loud', alarm: 3, drips: 0, bogus: 1 }));
    expect(v).toEqual({ ...defaultVolumes(), hum: 0.2, drips: 0 });
  });
});
