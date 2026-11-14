import type { Stocked } from './cabinet';

/**
 * The equipment wheels: each held open with a key, a ring of sectors round the middle of the view, one for each thing
 * it takes out of the equipment cabinet. The mouse, instead of looking around, moves a pointer out from the middle,
 * and whichever sector it's in the direction of when the key's let go is what's taken.
 *
 * Lengths are in the wheel's own units, which are CSS pixels unless the view is too small for it and it's drawn
 * smaller. Its sectors go clockwise from the first, which is centered straight up.
 */
export const WHEEL = {
  /** The hole in its middle: a pointer no further out than this picks nothing. */
  hole: 70,
  /** Its outer edge, as drawn. */
  rim: 230,
  /** As far out as the pointer goes, so that it's never far from pointing some other way. */
  reach: 150,
  /** Each sector's icon: how far out its middle is, and how big it is, a side. */
  icon: { r: 160, size: 112 },
};

/**
 * What's on each wheel, in its order: between them, everything the cabinet stocks, each on one wheel. Roughly, the
 * first is for experimenting and learning, and the second for mass production.
 */
export const WHEELS: readonly (readonly Stocked[])[] = [
  ['flask', 'scale', 'pipette', 'thermometer', 'thermometerWide', 'trumpet', 'strip', 'dish', 'column', 'culture'],
  ['dispenser', 'exchanger', 'separator', 'splitter', 'sorter', 'heater', 'tank', 'meter', 'multiplexer', 'dilatometer'],
];

/** Where the wheel's pointer is, from its middle: x right, y down. */
export interface WheelAim {
  x: number;
  y: number;
}

/** The pointer, moved by (dx, dy) and kept within the wheel's reach. */
export function wheelMove(at: WheelAim, dx: number, dy: number): WheelAim {
  const x = at.x + dx;
  const y = at.y + dy;
  const d = Math.hypot(x, y);
  return d > WHEEL.reach ? { x: (x * WHEEL.reach) / d, y: (y * WHEEL.reach) / d } : { x, y };
}

/** Which of the wheel's `n` sectors the pointer picks: the one in its direction, or none while it's in the hole. */
export function wheelPick(at: WheelAim, n: number): number | null {
  if (n <= 0 || Math.hypot(at.x, at.y) <= WHEEL.hole) return null;
  const turn = Math.atan2(at.x, -at.y) / (2 * Math.PI);
  return ((Math.round(turn * n) % n) + n) % n;
}

/** The angles sector `i` of `n` runs between, in radians clockwise from straight up. */
export function wheelSpan(i: number, n: number): { from: number; to: number } {
  const step = (2 * Math.PI) / n;
  return { from: (i - 0.5) * step, to: (i + 0.5) * step };
}
