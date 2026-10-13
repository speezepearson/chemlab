import { describe, expect, it } from 'vitest';
import { AIRLOCK, POD, airlockBoxes, doorsOpen, inPod, outOfAirlock, type Wake } from './airlock';
import { roomBoxes, walk, type Cylinder } from './physics';
import { ROOM } from './space';

const R = 45;
/** The room's walls with the front wall swapped for the airlock's, as the engine has them while the doors are open. */
const open = () => [...roomBoxes(ROOM, false), ...airlockBoxes()];
const at = (x: number, z: number): Cylinder => ({ x, z, r: R, y0: 0, y1: 640 });

describe('airlock', () => {
  it('lets the player walk out of the pod and through the doorway into the lab', () => {
    let p = at(POD.x, POD.z);
    for (let i = 0; i < 100; i++) p = walk(p, null, 0, -10, open()).player;
    expect(outOfAirlock(p.z, R)).toBe(true);
  });

  it("doesn't let them out any other way", () => {
    // across, or back
    for (const [dx, dz] of [[10, 0], [-10, 0], [0, 10]]) {
      let p = at(POD.x, POD.z);
      for (let i = 0; i < 100; i++) p = walk(p, null, dx, dz, open()).player;
      expect(Math.abs(p.x - AIRLOCK.x)).toBeLessThan(AIRLOCK.w / 2);
      expect(p.z).toBeLessThan(ROOM.z1 + AIRLOCK.wall + AIRLOCK.d);
    }
    // and beside the doorway the front wall still stands
    let p = at(AIRLOCK.x + AIRLOCK.door.w, ROOM.z1 - 200);
    for (let i = 0; i < 100; i++) p = walk(p, null, 0, 10, open()).player;
    expect(p.z + R).toBeLessThanOrEqual(ROOM.z1 + 1e-6);
  });

  it('starts the player clear of everything', () => {
    const p = at(POD.x, POD.z);
    expect(walk(p, null, 0, -1, open()).player.z).toBeCloseTo(POD.z - 1, 9);
  });

  it('opens its doors while the player is in the airlock or the pod, and in the lab only while the ship asks them back', () => {
    expect(doorsOpen('closed', false, false)).toBe(false);
    expect(doorsOpen('closed', true, false)).toBe(true);
    // not shut on them
    expect(doorsOpen('closed', false, true)).toBe(true);
    for (const w of ['pod', 'flicker', 'opening', 'out', 'shutting', 'dozing', 'asleep', 'waking', 'arrived'] as Wake[])
      expect(doorsOpen(w, false, false)).toBe(true);
  });

  it("holds the player still while they're in the pod, or falling asleep or waking in it", () => {
    for (const w of ['shutting', 'dozing', 'asleep', 'waking', 'pod', 'flicker', 'opening', 'arrived'] as Wake[]) expect(inPod(w)).toBe(true);
    expect(inPod('out')).toBe(false);
    expect(inPod('closed')).toBe(false);
  });
});
