import { ROOM, WALL_PANEL } from './space';

/**
 * The airlock: a small chamber behind the front wall (the one opposite the bench, behind the player as they work),
 * just big enough for a standing cryopod, where the player wakes the first time (see GameEngine.enterPod). All in
 * world units.
 * - x: the middle of its doorway, along the front wall, opposite where the bench's faucets, supply station and
 *   instruments are: the doorway is two of the wall's panels across and two high, lined up with them, as the supply
 *   station is (the front wall's panels run from its end at ROOM.x1).
 * - w, d, h: the chamber inside, across, front to back and high.
 * - wall: how thick the wall with the doorway is, which the doors slide into.
 * - door: the doorway, across and high.
 */
export const AIRLOCK = {
  x: ROOM.x1 - 27 * WALL_PANEL.w,
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
 * - pod: in the cryopod, with the message projected on the inside of its front; they can't move, and the lab waits.
 * - flicker: OK was pressed, and the message is flickering out.
 * - opening: the pod's door is swinging open.
 * - out: they're out at the bench, where the view last was there, and the doors stand open behind them until the
 *   next sim substep.
 * - closed: the doors have closed behind them. This is how every lab starts but the first.
 * - open: the station has been delivering steadily (see DELIVERY), and the doors have slid open again, back to the
 *   pod; they close again once it stops, when the player's out in the lab.
 * - boarding: the player got into the pod while the airlock was open: its front slides down in front of them, and
 *   then all fades to black.
 * - asleep: in the pod, asleep, while the lab runs on (see sleep.ts) until the goal's reached, or the station stops
 *   delivering. Then they wake in the pod as at first, the screen fading in from black: back to pod, with the same
 *   message (its numbers brought up to date), or, if there's enough cryostabilizer, a welcome to Mu Ceti.
 * - arriving: OK was pressed on the welcome, and the message has flickered out: the pod's front slides up, and the
 *   screen fades to white in the light of Mu Ceti. The lab stands still as it was when there was enough, so this
 *   goes in real time (see WAKE_S.arrive).
 * - arrived: all white, and the game's won; the player can carry on in the lab from there, or start again.
 */
export type Wake =
  | 'pod' | 'flicker' | 'opening' | 'out' | 'closed' | 'open' | 'boarding' | 'asleep' | 'arriving' | 'arrived';

/** Whether the player is still shut in the pod. */
export function inPod(w: Wake): boolean {
  return w !== 'out' && w !== 'closed' && w !== 'open';
}

/** Smoothly from 0 to 1 as t goes from 0 to 1, easing in and out. */
export function ease(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}
