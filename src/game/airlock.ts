import type { Box } from './physics';
import { ROOM } from './space';

/**
 * The airlock: a small chamber behind the front wall, just big enough for a standing cryopod, where the player wakes
 * the first time (see GameEngine.enterPod). All in world units.
 * - x: the middle of its doorway, along the front wall.
 * - w, d, h: the chamber inside, across, front to back and high.
 * - wall: how thick the wall with the doorway is, which the doors slide into.
 * - door: the doorway, across and high.
 */
export const AIRLOCK = { x: 150, w: 320, d: 230, h: 1100, wall: 30, door: { w: 240, h: 1014 } };

/** The cryopod: where it stands (its axis), its shell's radius, and how high its body and dome go. */
export const POD = {
  x: AIRLOCK.x,
  z: ROOM.z1 + AIRLOCK.wall + AIRLOCK.d - 72,
  r: 62,
  base: 14,
  top: 654,
};

/**
 * Sim seconds the message in the pod takes to flicker out, its front to slide up (or down), the doors to open or close,
 * the view to fade to black as the player falls asleep (and back as they wake), and to white after the pod opens at
 * Mu Ceti: they run on sim time, like everything else, so pausing stops them.
 */
export const WAKE_S = { flicker: 0.7, open: 1.6, close: 1.2, doze: 1.5, dawn: 2.5 };

/**
 * Where the player is in waking up, the first time (and on a replay of the intro), in going back to sleep, and in
 * waking again:
 * - pod: in the cryopod, with the message projected on the inside of its front; they can look around, but not move,
 *   and the lab waits.
 * - flicker: OK was pressed, and the message is flickering out.
 * - opening: the pod's front is sliding up.
 * - out: they can walk, and the doors stand open until they're out in the lab.
 * - closed: out in the lab. The doors are shut, but for while the ship asks them back to the pod (see doorsOpen). This
 *   is how every lab starts but the first.
 * - shutting: they've got back in the pod, and its front is sliding down.
 * - dozing: the view is fading to black.
 * - asleep: the lab runs on as fast as it can, unseen, until the ship has enough cryostabilizer, or its supply stops;
 *   then they wake.
 * - waking: the black is lifting, on the message in the pod saying which; then it's `pod` again.
 * - arrived: they woke at Mu Ceti, the pod has opened, and the view is fading to white, for good.
 */
export type Wake = 'pod' | 'flicker' | 'opening' | 'out' | 'closed' | 'shutting' | 'dozing' | 'asleep' | 'waking' | 'arrived';

/** Whether the player is in the pod, or otherwise can't move or do anything but look. */
export function inPod(w: Wake): boolean {
  return w !== 'out' && w !== 'closed';
}

/**
 * Whether the airlock's doors should be open: while the player's in the airlock or the pod, and in the lab while the
 * ship asks them back to the pod (`invited`).
 */
export function doorsOpen(w: Wake, invited: boolean, inAirlock: boolean): boolean {
  return w !== 'closed' || invited || inAirlock;
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box => ({
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  z: (z0 + z1) / 2,
  yaw: 0,
  hx: (x1 - x0) / 2,
  hy: (y1 - y0) / 2,
  hz: (z1 - z0) / 2,
});

/**
 * What stands in the way at the airlock while its doors are open, to go with the room's other walls in place of the
 * front wall (see physics.roomBoxes, whose front wall is solid where the doorway is): the front wall either side of
 * the doorway and above it, the chamber's walls, floor and ceiling, and the cryopod's back.
 */
export function airlockBoxes(): Box[] {
  const T = 200;
  const { x, w, d, h, wall, door } = AIRLOCK;
  const z1 = ROOM.z1;
  const back = z1 + wall + d;
  const H = ROOM.y1;
  const [dx0, dx1] = [x - door.w / 2, x + door.w / 2];
  return [
    // the front wall, thick enough that nothing passes through, but for the doorway
    box(ROOM.x0 - T, dx0, -T, H + T, z1, z1 + wall + T),
    box(dx1, ROOM.x1 + T, -T, H + T, z1, z1 + wall + T),
    box(dx0, dx1, door.h, H + T, z1, z1 + wall + T),
    // the chamber
    box(x - w / 2 - T, x - w / 2, -T, h + T, z1, back + T),
    box(x + w / 2, x + w / 2 + T, -T, h + T, z1, back + T),
    box(x - w / 2, x + w / 2, -T, h + T, back, back + T),
    box(x - w / 2, x + w / 2, -T, 0, z1, back),
    box(x - w / 2, x + w / 2, h, h + T, z1, back),
    // the pod's back, behind where the player stands in it
    box(POD.x - POD.r, POD.x + POD.r, 0, POD.top + POD.r, POD.z + 50, POD.z + POD.r + 8),
  ];
}

/** How near the pod's axis the player has to stand to be in it, in world units. */
export const IN_POD = 30;

/** Whether the player, standing at (x, z), is in the cryopod. */
export function inCryopod(x: number, z: number): boolean {
  return Math.hypot(x - POD.x, z - POD.z) < IN_POD;
}

/** Whether a player of radius r standing at z is all the way out of the doorway, into the lab. */
export function outOfAirlock(z: number, r: number): boolean {
  return z + r < ROOM.z1 - 10;
}

/** Smoothly from 0 to 1 as t goes from 0 to 1, easing in and out. */
export function ease(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}
