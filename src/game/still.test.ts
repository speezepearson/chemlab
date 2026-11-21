import { describe, expect, it } from 'vitest';
import { CATCH_REST_S, STILL_TOL, catches, stillness, type Stillness } from './still';

/** Hold at each point in turn, dt real seconds a step, from just taken in hand. */
const run = (points: [number, number][], dt: number): Stillness => {
  let st: Stillness | null = null;
  for (const [x, y] of points) st = stillness(st, x, y, dt);
  return st!;
};

describe('stillness', () => {
  it('counts as moving just as it is taken in hand', () => {
    expect(catches(null)).toBe(false);
    expect(catches(stillness(null, 10, 20, 1))).toBe(false);
  });

  it('catches once held still for CATCH_REST_S, and not before', () => {
    const steps = 20;
    const dt = CATCH_REST_S / steps;
    const before = run(Array.from({ length: steps }, () => [10, 20]), dt);
    expect(catches(before)).toBe(false);
    expect(catches(stillness(before, 10, 20, dt))).toBe(true);
  });

  it('ignores jitter within STILL_TOL of where it came to rest', () => {
    const j = STILL_TOL * 0.9;
    const st = run([[0, 0], [j, 0], [0, j], [-j, 0], [0, -j]], CATCH_REST_S / 2);
    expect(st.x).toBe(0);
    expect(catches(st)).toBe(true);
  });

  it('starts over when moved, even by slow drift', () => {
    const still = run([[0, 0], [0, 0], [0, 0]], CATCH_REST_S);
    expect(catches(still)).toBe(true);
    const moved = stillness(still, STILL_TOL * 2, 0, CATCH_REST_S);
    expect(catches(moved)).toBe(false);
    // creeping a little each step still adds up to moving
    const creep = run(Array.from({ length: 10 }, (_, i) => [i * STILL_TOL * 0.6, 0]), CATCH_REST_S / 2);
    expect(catches(creep)).toBe(false);
  });
});
