import { describe, expect, it } from 'vitest';
import { axes, onPlaneZ, sightAt, type Camera } from './sight';

const persp: Camera = { x: 100, y: 600, z: 1000, yaw: 0, pitch: 0, fov: 90 };

describe('axes', () => {
  it('has a camera at yaw 0 look square at the back wall, with x to its right and y up', () => {
    const a = axes({ yaw: 0, pitch: 0 });
    expect(a.ahead).toEqual({ x: -0, y: 0, z: -1 });
    expect(a.right.x).toBeCloseTo(1);
    expect(a.up.y).toBeCloseTo(1);
  });

  it('turns it round to the wall behind at a yaw of π, where right is the other way along the room', () => {
    const a = axes({ yaw: Math.PI, pitch: 0 });
    expect(a.ahead.z).toBeCloseTo(1);
    expect(a.right.x).toBeCloseTo(-1);
  });

  it('tips it up with its pitch, and keeps its three ways square to each other', () => {
    const a = axes({ yaw: 0.4, pitch: 0.3 });
    expect(a.ahead.y).toBeCloseTo(Math.sin(0.3));
    const dot = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => p.x * q.x + p.y * q.y + p.z * q.z;
    for (const [p, q] of [[a.right, a.up], [a.right, a.ahead], [a.up, a.ahead]]) expect(dot(p, q)).toBeCloseTo(0);
    for (const p of [a.right, a.up, a.ahead]) expect(dot(p, p)).toBeCloseTo(1);
  });
});

describe('sightAt', () => {
  it('fans lines of sight out from a camera with perspective', () => {
    const mid = sightAt(persp, 0, 0, 2);
    const top = sightAt(persp, 0, 1, 2);
    const side = sightAt(persp, 1, 0, 2);
    expect(mid.o).toEqual({ x: 100, y: 600, z: 1000 });
    expect(top.o).toEqual(mid.o);
    // at 90° top to bottom, the top of the view is 45° up, and at twice as wide as tall, the side is twice as far out
    expect(top.d.y / -top.d.z).toBeCloseTo(1);
    expect(side.d.x / -side.d.z).toBeCloseTo(2);
  });

  it('sets them side by side for one without, all going the same way', () => {
    const cam: Camera = { ...persp, ortho: 300 };
    const mid = sightAt(cam, 0, 0, 2);
    const corner = sightAt(cam, 1, 1, 2);
    expect(corner.d).toEqual(mid.d);
    expect(corner.o.x - mid.o.x).toBeCloseTo(600);
    expect(corner.o.y - mid.o.y).toBeCloseTo(300);
  });
});

describe('onPlaneZ', () => {
  it('finds where a line of sight meets the wall, with perspective and without', () => {
    // 880 off the plane at 90°, the top of the view is 880 above the middle
    const p = onPlaneZ(sightAt(persp, 0, 1, 1), 120)!;
    expect(p).toEqual({ x: 100, y: 600 + 880, z: 120 });
    const q = onPlaneZ(sightAt({ ...persp, ortho: 300 }, 0.5, -1, 2), 120)!;
    expect(q.x).toBeCloseTo(100 + 300);
    expect(q.y).toBeCloseTo(300);
  });

  it('slides across the wall as the view does, whichever way it looks, since the wall is flat', () => {
    for (const cam of [persp, { ...persp, ortho: 400, yaw: 0.4, pitch: -0.3 }, { ...persp, yaw: -0.2, pitch: 0.1 }]) {
      const a = onPlaneZ(sightAt(cam, 0.3, -0.6, 1.5), 120)!;
      const b = onPlaneZ(sightAt({ ...cam, x: cam.x + 70, y: cam.y - 30 }, 0.3, -0.6, 1.5), 120)!;
      expect(b.x - a.x).toBeCloseTo(70);
      expect(b.y - a.y).toBeCloseTo(-30);
    }
  });

  it('finds nothing behind the camera', () => {
    expect(onPlaneZ(sightAt(persp, 0, 0, 1), 2000)).toBeNull();
  });
});
