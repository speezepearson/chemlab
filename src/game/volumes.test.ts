import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUMES, MIDDLE, defaultVolumes, gainOf, parseVolumes } from './volumes';

describe('volumes', () => {
  it('maps the middle of a slider to the sound as synthesized, the top to four times it, the bottom to silence', () => {
    expect(gainOf(MIDDLE)).toBe(1);
    expect(gainOf(1)).toBe(4);
    expect(gainOf(0)).toBe(0);
    expect(gainOf(2)).toBe(4);
    expect(gainOf(-1)).toBe(0);
  });

  it('starts the far-off alarms well under everything else', () => {
    expect(defaultVolumes()).toEqual(DEFAULT_VOLUMES);
    expect(DEFAULT_VOLUMES.klaxon).toBeLessThan(MIDDLE);
    expect(DEFAULT_VOLUMES.alarm).toBeLessThan(MIDDLE);
    expect(DEFAULT_VOLUMES.hum).toBe(MIDDLE);
  });

  it('reads what was stored, and defaults whatever is missing or junk', () => {
    expect(parseVolumes(null)).toEqual(defaultVolumes());
    expect(parseVolumes('not json')).toEqual(defaultVolumes());
    expect(parseVolumes('[1, 2]')).toEqual(defaultVolumes());
    const v = parseVolumes(JSON.stringify({ hum: 0.2, klaxon: 'loud', alarm: 3, drips: 0, bogus: 1 }));
    expect(v).toEqual({ ...defaultVolumes(), hum: 0.2, drips: 0 });
  });
});
