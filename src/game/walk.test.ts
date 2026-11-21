import { describe, expect, it } from 'vitest';
import { BENCH, CABINET_AREA, COUNTERS, ROOM } from './space';
import { BODY_R, canStand, walk } from './walk';

const counter = COUNTERS[0];
/** Somewhere in the middle of the room, well clear of everything. */
const mid = { x: (BENCH.x0 + ROOM.x1) / 2, z: ROOM.z1 / 2 };

describe('walk', () => {
  it('goes as far as asked in the open', () => {
    const p = walk(mid, 120, -80);
    expect(p.x).toBeCloseTo(mid.x + 120);
    expect(p.z).toBeCloseTo(mid.z - 80);
  });

  it('stops against the counter, its body’s radius out from it, however far it was going', () => {
    const p = walk(mid, 0, -10_000);
    expect(p.x).toBeCloseTo(mid.x);
    expect(p.z).toBeGreaterThanOrEqual(counter.z1 + BODY_R);
    expect(p.z).toBeLessThan(counter.z1 + BODY_R + 0.5);
  });

  it('slides along the counter when walking into it at a slant', () => {
    const from = { x: mid.x, z: counter.z1 + BODY_R + 10 };
    const p = walk(from, 300, -300);
    expect(p.x).toBeCloseTo(from.x + 300);
    expect(p.z).toBeGreaterThanOrEqual(counter.z1 + BODY_R);
    expect(p.z).toBeLessThan(counter.z1 + BODY_R + 0.5);
  });

  it('stops against the equipment cabinet', () => {
    const from = { x: (CABINET_AREA.x0 + CABINET_AREA.x1) / 2, z: CABINET_AREA.z1 + 400 };
    const p = walk(from, 0, -1000);
    expect(p.z).toBeGreaterThanOrEqual(CABINET_AREA.z1 + BODY_R);
    expect(p.z).toBeLessThan(CABINET_AREA.z1 + BODY_R + 0.5);
  });

  it('goes round the cabinet’s corner rather than through it', () => {
    // walking along the front of the counter, toward the cabinet, which comes further out
    const from = { x: CABINET_AREA.x1 + 500, z: counter.z1 + BODY_R + 1 };
    const p = walk(from, -1000, 0);
    expect(canStand(p)).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(CABINET_AREA.x1);
  });

  it('keeps inside the room’s walls, the airlock’s among them', () => {
    expect(walk(mid, 0, 100_000).z).toBeCloseTo(ROOM.z1 - BODY_R);
    expect(walk(mid, 100_000, 0).x).toBeCloseTo(ROOM.x1 - BODY_R);
    const end = { x: ROOM.x0 + 400, z: CABINET_AREA.z1 + 400 };
    expect(walk(end, -100_000, 0).x).toBeCloseTo(ROOM.x0 + BODY_R);
  });

  it('never ends anywhere it couldn’t stand, from wherever it could', () => {
    let p = { ...mid };
    // a long wander, with steps of all sizes, every which way
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 2000; i++) {
      p = walk(p, rand() * 900, rand() * 900);
      expect(canStand(p)).toBe(true);
    }
  });

  it('lets someone stood where they shouldn’t be walk out', () => {
    const inside = { x: mid.x, z: counter.z1 - 10 };
    expect(canStand(inside)).toBe(false);
    const p = walk(inside, 0, 400);
    expect(p.z).toBeCloseTo(inside.z + 400);
  });
});

describe('canStand', () => {
  it('is false in the counter or the cabinet, or too near a wall, and true in the open', () => {
    expect(canStand(mid)).toBe(true);
    expect(canStand({ x: mid.x, z: counter.z1 + BODY_R / 2 })).toBe(false);
    expect(canStand({ x: CABINET_AREA.x0 + 500, z: CABINET_AREA.z1 + 10 })).toBe(false);
    expect(canStand({ x: mid.x, z: ROOM.z1 - 10 })).toBe(false);
  });
});
