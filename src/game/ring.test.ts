import { describe, expect, it } from 'vitest';
import { RING, glassHz, ringHz, ringTime } from './ring';

describe('a tapped vessel', () => {
  it('sounds a note of pitch 1 at its base frequency, and others in proportion', () => {
    expect(ringHz(1)).toBe(RING.base);
    expect(ringHz(2.5)).toBe(2.5 * RING.base);
  });

  it('rings its glass lower the fuller it is, whatever is in it', () => {
    const [hz] = RING.glass[0];
    expect(glassHz(hz, 0)).toBe(hz);
    expect(glassHz(hz, 1)).toBeCloseTo(hz / Math.sqrt(1 + RING.load), 9);
    for (let i = 0; i < 10; i++) expect(glassHz(hz, (i + 1) / 10)).toBeLessThan(glassHz(hz, i / 10));
    // full, it's a good few semitones under empty; with a hundredth in it, as good as empty
    expect(glassHz(hz, 1) / hz).toBeLessThan(0.75);
    expect(glassHz(hz, 0.01) / hz).toBeGreaterThan(0.99);
    expect(glassHz(hz, 7)).toBe(glassHz(hz, 1));
    expect(glassHz(hz, -1)).toBe(hz);
  });

  it('rings longer the lower the note, within limits', () => {
    expect(ringTime(RING.base)).toBeCloseTo(RING.ring, 9);
    expect(ringTime(4 * RING.base)).toBeCloseTo(RING.ring / 2, 9);
    expect(ringTime(RING.base / 2)).toBeGreaterThan(ringTime(RING.base));
    expect(ringTime(1)).toBe(3);
    expect(ringTime(1e6)).toBe(0.2);
  });
});
