import { describe, expect, it } from 'vitest';
import { MAX_FLOW } from './tools';
import { streamLevel, streamPitch } from './water';

describe('stream sounds', () => {
  it('get louder the faster they flow, up to full loudness at a flask a second', () => {
    expect(streamLevel(0)).toBe(0);
    expect(streamLevel(0.01 * MAX_FLOW)).toBeCloseTo(0.1);
    expect(streamLevel(0.25 * MAX_FLOW)).toBeCloseTo(0.5);
    expect(streamLevel(MAX_FLOW)).toBe(1);
    expect(streamLevel(5 * MAX_FLOW)).toBe(1);
  });

  it('ring higher the fuller the vessel, ten times higher when full than empty', () => {
    let last = 0;
    for (let full = 0; full <= 1; full += 0.1) {
      expect(streamPitch(full)).toBeGreaterThan(last);
      last = streamPitch(full);
    }
    expect(streamPitch(1) / streamPitch(0)).toBeCloseTo(10);
    expect(streamPitch(1.5)).toBe(streamPitch(1));
  });
});
