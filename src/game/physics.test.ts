import { describe, expect, it } from 'vitest';
import { boxesOverlap, cylinderHitsBox, moveBox, roomBoxes, walk, type Box } from './physics';

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

describe('moveBox', () => {
  it('goes all the way when nothing is in the way', () => {
    const b = moveBox(box(0, 0), { x: 100, y: 0, z: 50, yaw: 1 }, [box(0, 200)]);
    expect([b.x, b.z, b.yaw]).toEqual([100, 50, 1].map((v) => expect.closeTo(v, 6)));
  });

  it('stops short of a wall, sliding along it', () => {
    const wall = box(50, 0, 5, 500);
    const b = moveBox(box(0, 0), { x: 100, y: 0, z: 80, yaw: 0 }, [wall]);
    expect(b.x).toBeLessThanOrEqual(35);
    expect(b.x).toBeGreaterThan(30);
    expect(b.z).toBeCloseTo(80, 6);
    expect(boxesOverlap(b, wall)).toBe(false);
  });

  it("doesn't tunnel through something thin", () => {
    const sheet = box(50, 0, 0.5, 500);
    expect(moveBox(box(0, 0), { x: 1000, y: 0, z: 0, yaw: 0 }, [sheet]).x).toBeLessThan(50);
  });

  it("won't turn into something", () => {
    const long = box(0, 0, 50, 2);
    const post = box(0, 30, 3, 3);
    const b = moveBox(long, { x: 0, y: 0, z: 0, yaw: Math.PI / 2 }, [post]);
    expect(b.yaw).toBeLessThan(Math.PI / 2 - 0.05);
    expect(boxesOverlap(b, post)).toBe(false);
  });

  it('can be pulled free of something it already overlaps', () => {
    const b = moveBox(box(0, 0), { x: 100, y: 0, z: 0, yaw: 0 }, [box(5, 0)]);
    expect(b.x).toBeCloseTo(100, 6);
  });
});

describe('walk', () => {
  const player = { x: 0, z: 0, r: 10, y0: 0, y1: 100 };
  it('slides the player along a wall', () => {
    const wall = box(30, 0, 5, 500, 0, 50, 100);
    const { player: p } = walk(player, null, 50, 40, [wall]);
    expect(p.x).toBeLessThanOrEqual(15);
    expect(p.z).toBeCloseTo(40, 6);
  });

  it('stops when the load would hit something, though the player would not', () => {
    const load = box(0, -60, 10, 10, 0, 50);
    const post = box(40, -60, 5, 5, 0, 50);
    const { player: p, load: l } = walk(player, load, 60, 0, [post]);
    expect(p.x).toBeLessThan(26);
    expect(l!.x).toBeCloseTo(p.x, 6);
    expect(boxesOverlap(l!, post)).toBe(false);
  });

  it('keeps the player inside the room', () => {
    const room = roomBoxes({ x0: -100, x1: 100, z0: -100, z1: 100, y1: 300 });
    const { player: p } = walk(player, null, 500, -500, room);
    expect(p.x).toBeLessThanOrEqual(90);
    expect(p.z).toBeGreaterThanOrEqual(-90);
  });
});
