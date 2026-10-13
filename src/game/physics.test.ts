import { describe, expect, it } from 'vitest';
import { boxesOverlap, cylinderHitsBox, roomBoxes, segmentHitsBox, walk, type Box } from './physics';

const box = (x: number, z: number, hx = 10, hz = 10, yaw = 0, y = 0, hy = 10): Box => ({ x, y, z, yaw, hx, hy, hz });

describe('boxesOverlap', () => {
  it('tells overlapping boxes from apart and merely touching ones', () => {
    expect(boxesOverlap(box(0, 0), box(15, 0))).toBe(true);
    expect(boxesOverlap(box(0, 0), box(25, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(20, 0))).toBe(false);
  });

  it('needs them to overlap in height too', () => {
    expect(boxesOverlap(box(0, 0), { ...box(0, 0), y: 25 })).toBe(false);
    expect(boxesOverlap(box(0, 0), { ...box(0, 0), y: 15 })).toBe(true);
  });

  it('turns boxes by their yaw', () => {
    // a long thin box along x misses one off its end once it's turned a quarter
    const long = box(0, 0, 50, 2);
    const off = box(45, 0, 3, 3);
    expect(boxesOverlap(long, off)).toBe(true);
    expect(boxesOverlap({ ...long, yaw: Math.PI / 2 }, off)).toBe(false);
    // a square turned 45° reaches √2 times further toward a corner
    expect(boxesOverlap(box(0, 0), box(24, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0, 10, 10, Math.PI / 4), box(23, 0))).toBe(true);
  });
});

describe('segmentHitsBox', () => {
  it('tells a line through a box from one that passes by or stops short', () => {
    const b = box(0, 0);
    expect(segmentHitsBox({ x: -30, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, b)).toBe(true);
    expect(segmentHitsBox({ x: -30, y: 0, z: 15 }, { x: 30, y: 0, z: 15 }, b)).toBe(false);
    expect(segmentHitsBox({ x: -30, y: 0, z: 0 }, { x: -15, y: 0, z: 0 }, b)).toBe(false);
    expect(segmentHitsBox({ x: -30, y: 25, z: 0 }, { x: 30, y: 25, z: 0 }, b)).toBe(false);
    // starting inside counts
    expect(segmentHitsBox({ x: 0, y: 0, z: 0 }, { x: 30, y: 30, z: 30 }, b)).toBe(true);
  });

  it('turns the box by its yaw', () => {
    // a long thin box along x is missed by a line along x off to its side once it's turned a quarter
    const long = box(0, 0, 50, 2);
    const a = { x: -30, y: 0, z: 30 };
    const c = { x: 30, y: 0, z: -30 };
    expect(segmentHitsBox(a, c, long)).toBe(true);
    expect(segmentHitsBox({ x: 40, y: 0, z: -10 }, { x: 40, y: 0, z: 10 }, long)).toBe(true);
    expect(segmentHitsBox({ x: 40, y: 0, z: -10 }, { x: 40, y: 0, z: 10 }, { ...long, yaw: Math.PI / 2 })).toBe(false);
  });
});

describe('cylinderHitsBox', () => {
  const cyl = (x: number, z: number) => ({ x, z, r: 5, y0: -100, y1: 100 });
  it('finds the nearest point of the box, corners included', () => {
    expect(cylinderHitsBox(cyl(14, 0), box(0, 0))).toBe(true);
    expect(cylinderHitsBox(cyl(16, 0), box(0, 0))).toBe(false);
    expect(cylinderHitsBox(cyl(13, 13), box(0, 0))).toBe(true);
    expect(cylinderHitsBox(cyl(14.5, 14.5), box(0, 0))).toBe(false);
  });

  it('passes under or over a box', () => {
    expect(cylinderHitsBox({ x: 0, z: 0, r: 5, y0: 20, y1: 100 }, box(0, 0))).toBe(false);
  });
});

describe('walk', () => {
  const player = { x: 0, z: 0, r: 10, y0: 0, y1: 100 };
  it('slides the player along a wall', () => {
    const wall = box(30, 0, 5, 500, 0, 50, 100);
    const p = walk(player, 50, 40, [wall]);
    expect(p.x).toBeLessThanOrEqual(15);
    expect(p.z).toBeCloseTo(40, 6);
  });

  it('keeps the player inside the room', () => {
    const room = roomBoxes({ x0: -100, x1: 100, z0: -100, z1: 100, y1: 300 });
    const p = walk(player, 500, -500, room);
    expect(p.x).toBeLessThanOrEqual(90);
    expect(p.z).toBeGreaterThanOrEqual(-90);
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
    expect(boxesOverlap(cyl(18, 0), box(0, 0))).toBe(true);
    expect(cylinderHitsBox({ x: 12, z: 12, r: 10, y0: -5, y1: 5 }, cyl(0, 0))).toBe(true);
    expect(cylinderHitsBox({ x: 15, z: 15, r: 10, y0: -5, y1: 5 }, cyl(0, 0))).toBe(false);
  });

  it('is solid only in its parts, which turn with it', () => {
    // a wide box solid only in a thin part across its top
    const t: Box = { ...box(0, 0, 50, 10, 0, 0, 20), parts: [{ x: 0, y: 15, z: 0, hx: 50, hy: 5, hz: 10 }] };
    expect(boxesOverlap(t, box(30, 0, 5, 5, 0, -10, 5))).toBe(false);
    expect(boxesOverlap(t, box(30, 0, 5, 5, 0, 15, 5))).toBe(true);
    // turned a quarter, its part runs front to back
    const turned = { ...t, parts: [{ x: 30, y: 0, z: 0, hx: 5, hy: 20, hz: 5 }], yaw: Math.PI / 2 };
    expect(boxesOverlap(turned, box(0, -30, 3, 3))).toBe(true);
    expect(boxesOverlap(turned, box(30, 0, 3, 3))).toBe(false);
  });
});
