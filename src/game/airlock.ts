import type { Box } from './physics';
import { ROOM, WALL_PANEL } from './space';

/**
 * The airlock: a small chamber behind the front wall, just big enough for a standing cryopod, where the player wakes
 * the first time (see GameEngine.enterPod). All in world units.
 * - x: the middle of its doorway, along the front wall: the doorway is two of the wall's panels across and two high,
 *   lined up with them, as the cryostabilizer station is (the front wall's panels run from its end at ROOM.x1).
 * - w, d, h: the chamber inside, across, front to back and high.
 * - wall: how thick the wall with the doorway is, which the doors slide into.
 * - door: the doorway, across and high.
 */
export const AIRLOCK = {
  x: ROOM.x1 - 10 * WALL_PANEL.w,
  w: 2 * WALL_PANEL.w,
  d: 320,
  h: 1100,
  wall: 30,
  door: { w: 2 * WALL_PANEL.w, h: 2 * WALL_PANEL.h },
};

/**
 * The cryopod: where it stands (its axis), its shell's radius, and how high its body and dome go. Its door is `arc` of
 * its body's round, facing the lab, hinged on its edge toward +x (so on the right as the player stands in it), and
 * swings out by `swing`; the dome is whole, over all of it.
 */
export const POD = {
  x: AIRLOCK.x,
  z: ROOM.z1 + AIRLOCK.wall + AIRLOCK.d - 102,
  r: 87,
  base: 14,
  top: 701,
  arc: (80 * Math.PI) / 180,
  swing: (105 * Math.PI) / 180,
};

/**
 * Sim seconds the message in the pod takes to flicker out, its front to slide up, and the doors to slide shut or open:
 * they run on sim time, like everything else, so pausing stops them.
 */
export const WAKE_S = { flicker: 0.7, open: 1.6, close: 1.2, fade: 1.5, arrive: 5 };
/** Real seconds, once the pod's open at Mu Ceti, before the screen starts fading to white (see Wake's arriving). */
export const BLINDED_S = 1;
/** Real seconds the screen takes to fade in from black as the player wakes from a sleep. */
export const RISE_S = 1.5;

/**
 * Where the player is in waking up, the first time (and on a replay of the intro), and how the airlock stands after:
 * - pod: in the cryopod, with the message projected on the inside of its front; they can look around, but not move,
 *   and the lab waits.
 * - flicker: OK was pressed, and the message is flickering out.
 * - opening: the pod's front is sliding up.
 * - out: they can walk, and the doors stand open until they're out in the lab.
 * - closed: the doors have closed behind them. This is how every lab starts but the first.
 * - open: the station has been delivering steadily (see DELIVERY), and the doors have slid open again, back to the
 *   pod; they close again once it stops, when the player's out in the lab.
 * - settling: the player walked into the pod while it was open, and is easing into place in it, facing out: they've
 *   stopped walking, and it's their own movement, so it goes in real time (see SETTLE_S).
 * - boarding: settled in, the pod's front slides down in front of them, and then all fades to black.
 * - asleep: in the pod, asleep, while the lab runs on (see sleep.ts) until the goal's reached, or the station stops
 *   delivering. Then they wake in the pod as at first, the screen fading in from black: back to pod, with the same
 *   message (its numbers brought up to date), or, if there's enough cryostabilizer, a welcome to Mu Ceti.
 * - arriving: OK was pressed on the welcome, and the message has flickered out: the pod's front slides up, and the
 *   screen fades to white in the light of Mu Ceti. The lab stands still as it was when there was enough, so this
 *   goes in real time (see WAKE_S.arrive).
 * - arrived: all white, and the game's won; the player can carry on in the lab from there, or start again.
 */
export type Wake =
  | 'pod' | 'flicker' | 'opening' | 'out' | 'closed' | 'open' | 'settling' | 'boarding' | 'asleep' | 'arriving' | 'arrived';

/** Real seconds the player takes to ease into place in the pod as they get in (see Wake's settling). */
export const SETTLE_S = 1.4;

/** Whether the player is still shut in the pod. */
export function inPod(w: Wake): boolean {
  return w !== 'out' && w !== 'closed' && w !== 'open';
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

/** Whether a player of radius r standing at z is all the way out of the doorway, into the lab. */
export function outOfAirlock(z: number, r: number): boolean {
  return z + r < ROOM.z1 - 10;
}

/** Smoothly from 0 to 1 as t goes from 0 to 1, easing in and out. */
export function ease(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}
