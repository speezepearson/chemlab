import { describe, expect, it } from 'vitest';
import { AIRLOCK, POD, ease, inPod, outOfAirlock, type Wake } from './airlock';
import { ROOM, WALL_PANEL } from './space';

const whole = (v: number) => expect(v).toBeCloseTo(Math.round(v), 9);

describe('airlock', () => {
  it("has its doorway in the front wall, lined up with the wall's panels", () => {
    const [x0, x1] = [AIRLOCK.x - AIRLOCK.door.w / 2, AIRLOCK.x + AIRLOCK.door.w / 2];
    // the front wall's panels run along it from its end at ROOM.x1, and up from the floor
    for (const x of [x0, x1]) whole((ROOM.x1 - x) / WALL_PANEL.w);
    whole(AIRLOCK.door.h / WALL_PANEL.h);
    expect(x0).toBeGreaterThan(ROOM.x0);
    expect(x1).toBeLessThan(ROOM.x1);
    expect(AIRLOCK.door.h).toBeLessThan(ROOM.y1);
    // and the chamber behind it is no narrower than it, nor lower
    expect(AIRLOCK.door.w).toBeLessThanOrEqual(AIRLOCK.w);
    expect(AIRLOCK.door.h).toBeLessThanOrEqual(AIRLOCK.h);
  });

  it('has the pod standing inside the chamber, behind the wall', () => {
    expect(Math.abs(POD.x - AIRLOCK.x) + POD.r).toBeLessThanOrEqual(AIRLOCK.w / 2);
    expect(POD.z - POD.r).toBeGreaterThan(ROOM.z1 + AIRLOCK.wall);
    expect(POD.z + POD.r).toBeLessThanOrEqual(ROOM.z1 + AIRLOCK.wall + AIRLOCK.d);
    expect(POD.top).toBeLessThan(AIRLOCK.h);
  });

  it('tells when the player is shut in the pod', () => {
    const shut: Wake[] = ['pod', 'flicker', 'opening', 'settling', 'boarding', 'asleep', 'arriving', 'arrived'];
    const free: Wake[] = ['out', 'closed', 'open'];
    for (const w of shut) expect(inPod(w), w).toBe(true);
    for (const w of free) expect(inPod(w), w).toBe(false);
  });

  it("tells when the player's eyes are out of the doorway, into the lab", () => {
    expect(outOfAirlock(POD.z)).toBe(false);
    expect(outOfAirlock(ROOM.z1)).toBe(false);
    expect(outOfAirlock(ROOM.z1 - 200)).toBe(true);
  });
});

describe('ease', () => {
  it('goes smoothly from 0 to 1, and stays there outside', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 12);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    // slow at either end
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
    for (let t = 0; t < 1; t += 0.05) expect(ease(t + 0.05)).toBeGreaterThanOrEqual(ease(t));
  });
});
