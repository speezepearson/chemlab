import { describe, expect, it } from 'vitest';
import { AIRLOCK, POD, airlockBoxes, outOfAirlock } from './airlock';
import { roomBoxes, walk, type Cylinder } from './physics';
import { ROOM } from './space';

const R = 45;
/** The room's walls with the front wall swapped for the airlock's, as the engine has them while the doors are open. */
const open = () => [...roomBoxes(ROOM, false), ...airlockBoxes()];
const at = (x: number, z: number): Cylinder => ({ x, z, r: R, y0: 0, y1: 640 });

describe('airlock', () => {
  it('lets the player walk out of the pod and through the doorway into the lab', () => {
    let p = at(POD.x, POD.z);
    for (let i = 0; i < 100; i++) p = walk(p, 0, -10, open());
    expect(outOfAirlock(p.z, R)).toBe(true);
  });

  it("doesn't let them out any other way", () => {
    // across, or back
    for (const [dx, dz] of [[10, 0], [-10, 0], [0, 10]]) {
      let p = at(POD.x, POD.z);
      for (let i = 0; i < 100; i++) p = walk(p, dx, dz, open());
      expect(Math.abs(p.x - AIRLOCK.x)).toBeLessThan(AIRLOCK.w / 2);
      expect(p.z).toBeLessThan(ROOM.z1 + AIRLOCK.wall + AIRLOCK.d);
    }
    // and beside the doorway the front wall still stands
    let p = at(AIRLOCK.x + AIRLOCK.door.w, ROOM.z1 - 200);
    for (let i = 0; i < 100; i++) p = walk(p, 0, 10, open());
    expect(p.z + R).toBeLessThanOrEqual(ROOM.z1 + 1e-6);
  });

  it('starts the player clear of everything', () => {
    const p = at(POD.x, POD.z);
    expect(walk(p, 0, -1, open()).z).toBeCloseTo(POD.z - 1, 9);
  });
});
