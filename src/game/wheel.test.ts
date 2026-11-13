import { describe, expect, it } from 'vitest';
import { STOCK } from './cabinet';
import { WHEEL, WHEELS, wheelMove, wheelPick, wheelSpan } from './wheel';

const out = (WHEEL.hole + WHEEL.reach) / 2;
/** A pointer `r` out, `turn` of a full turn clockwise from straight up. */
const at = (turn: number, r = out) => ({ x: r * Math.sin(turn * 2 * Math.PI), y: -r * Math.cos(turn * 2 * Math.PI) });

describe('WHEELS', () => {
  it('have everything the cabinet stocks, each on one wheel', () => {
    expect(WHEELS.flat().sort()).toEqual(Object.keys(STOCK).sort());
  });
});

describe('wheelPick', () => {
  it('picks nothing in the hole', () => {
    expect(wheelPick({ x: 0, y: 0 }, 8)).toBeNull();
    expect(wheelPick(at(0.3, WHEEL.hole - 1), 8)).toBeNull();
    expect(wheelPick(at(0.3, WHEEL.hole + 1), 8)).not.toBeNull();
  });

  it('goes clockwise from the first sector, centered straight up', () => {
    expect(wheelPick(at(0), 8)).toBe(0);
    expect(wheelPick(at(0.25), 8)).toBe(2);
    expect(wheelPick(at(0.5), 8)).toBe(4);
    expect(wheelPick(at(0.75), 8)).toBe(6);
    // just either side of straight up is still the first
    expect(wheelPick(at(0.05), 8)).toBe(0);
    expect(wheelPick(at(0.95), 8)).toBe(0);
    expect(wheelPick(at(0.07), 8)).toBe(1);
    expect(wheelPick(at(0.93), 8)).toBe(7);
  });

  it('picks the sector whose span the pointer is in, however many there are', () => {
    for (const n of [1, 2, 5, 19]) {
      for (let i = 0; i < n; i++) {
        const { from, to } = wheelSpan(i, n);
        for (const f of [0.02, 0.5, 0.98]) {
          expect(wheelPick(at((from + (to - from) * f) / (2 * Math.PI)), n)).toBe(i);
        }
      }
    }
  });

  it('has no sectors to pick when there are none', () => {
    expect(wheelPick(at(0), 0)).toBeNull();
  });
});

describe('wheelMove', () => {
  it('moves the pointer by what the mouse moved', () => {
    expect(wheelMove({ x: 10, y: -20 }, 5, 7)).toEqual({ x: 15, y: -13 });
  });

  it('keeps the pointer within reach, in the same direction', () => {
    const p = wheelMove({ x: 0, y: 0 }, 3000, -4000);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(WHEEL.reach);
    expect(p.x / p.y).toBeCloseTo(-0.75);
  });

  it('comes back across the middle in no more than twice its reach', () => {
    let p = wheelMove({ x: 0, y: 0 }, 0, -10000);
    p = wheelMove(p, 0, 2 * WHEEL.reach);
    expect(wheelPick(p, 8)).toBe(4);
  });

  it('reaches past the hole, so something can be picked', () => {
    expect(WHEEL.reach).toBeGreaterThan(WHEEL.hole);
    expect(WHEEL.rim).toBeGreaterThanOrEqual(WHEEL.reach);
  });
});
