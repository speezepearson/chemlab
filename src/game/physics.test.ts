import { describe, expect, it } from 'vitest';
import { boxesOverlap, placeBox, solids, type Box } from './physics';

const box = (x: number, z: number, hx = 10, hz = 10, y = 0, hy = 10): Box => ({ x, y, z, yaw: 0, hx, hy, hz });

describe('boxesOverlap', () => {
  it('tells overlapping boxes from apart and merely touching ones', () => {
    expect(boxesOverlap(box(0, 0), box(15, 0))).toBe(true);
    expect(boxesOverlap(box(0, 0), box(25, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(20, 0))).toBe(false);
  });

  it('needs them to overlap in height and depth too', () => {
    expect(boxesOverlap(box(0, 0), { ...box(0, 0), y: 25 })).toBe(false);
    expect(boxesOverlap(box(0, 0), { ...box(0, 0), y: 15 })).toBe(true);
    expect(boxesOverlap(box(0, 0), box(0, 25))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(0, 15))).toBe(true);
  });

  it('keeps every box square to the room, whatever yaw it carries', () => {
    const long = box(0, 0, 50, 2);
    const off = box(45, 0, 3, 3);
    expect(boxesOverlap(long, off)).toBe(true);
    expect(boxesOverlap({ ...long, yaw: Math.PI / 2 }, off)).toBe(true);
    expect(boxesOverlap({ ...long, yaw: Math.PI / 2 }, box(0, 30, 3, 3))).toBe(false);
  });
});

describe('placeBox', () => {
  it('puts a body’s box, given in its own frame, where its pose is', () => {
    const b = placeBox({ x: 100, y: 200, z: 120, yaw: 0 }, { x: 10, y: -30, z: 0 }, { x: 5, y: 6, z: 7 });
    expect([b.x, b.y, b.z, b.yaw]).toEqual([110, 170, 120, 0]);
    expect([b.hx, b.hy, b.hz]).toEqual([5, 6, 7]);
  });
});

describe('round boxes and parts', () => {
  const cyl = (x: number, z: number, r = 10): Box => ({ ...box(x, z, r, r), round: true });

  it('lets cylinders come as close as their radii, at any angle, where boxes would meet at their corners', () => {
    const d = 21 / Math.SQRT2;
    expect(boxesOverlap(cyl(0, 0), cyl(d, d))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(d, d))).toBe(true);
    expect(boxesOverlap(cyl(0, 0), cyl(19, 0))).toBe(true);
  });

  it('tells a cylinder from the box beside it', () => {
    // a cylinder by a box's corner, clear of it, though their bounding squares overlap
    expect(boxesOverlap(cyl(18, 18), box(0, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0), cyl(18, 18))).toBe(false);
    expect(boxesOverlap(cyl(18, 0), box(0, 0))).toBe(true);
  });

  it('is solid only in its parts', () => {
    // a wide box solid only in a thin part across its top
    const t: Box = { ...box(0, 0, 50, 10, 0, 20), parts: [{ x: 0, y: 15, z: 0, hx: 50, hy: 5, hz: 10 }] };
    expect(boxesOverlap(t, box(30, 0, 5, 5, -10, 5))).toBe(false);
    expect(boxesOverlap(t, box(30, 0, 5, 5, 15, 5))).toBe(true);
    expect(boxesOverlap(box(30, 0, 5, 5, 15, 5), t)).toBe(true);
    // nothing outside the box itself, whatever its parts say
    expect(boxesOverlap(t, box(200, 0, 5, 5, 15, 5))).toBe(false);
  });

  it('lists its solid parts in the room, or itself if it has none', () => {
    const t: Box = { ...box(100, 50, 50, 10, 200, 20), parts: [{ x: -20, y: 15, z: 3, hx: 5, hy: 5, hz: 4, round: true }] };
    expect(solids(t)).toEqual([{ x: 80, y: 215, z: 53, yaw: 0, hx: 5, hy: 5, hz: 4, round: true }]);
    const plain = box(0, 0);
    expect(solids(plain)).toEqual([plain]);
  });
});
