import { describe, expect, it } from 'vitest';
import { RING, ringHz, ringTime } from './ring';

describe('a tapped vessel', () => {
  it('sounds a note of pitch 1 at its base frequency, and others in proportion', () => {
    expect(ringHz(1)).toBe(RING.base);
    expect(ringHz(2.5)).toBe(2.5 * RING.base);
  });

  it('rings longer the lower the note, within limits', () => {
    expect(ringTime(RING.base)).toBeCloseTo(RING.ring, 9);
    expect(ringTime(4 * RING.base)).toBeCloseTo(RING.ring / 2, 9);
    expect(ringTime(RING.base / 2)).toBeGreaterThan(ringTime(RING.base));
    expect(ringTime(1)).toBe(3);
    expect(ringTime(1e6)).toBe(0.2);
  });
});
