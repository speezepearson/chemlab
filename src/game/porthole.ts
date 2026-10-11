import { ROOM } from './space';

/** The left wall, which the porthole is in: how long it is (front to back) and how tall. */
export const PORT_WALL = { w: ROOM.z1 - ROOM.z0, h: ROOM.y1 };
/** How close the porthole comes to the wall's edges, and its corners' tightest radius once it's as big as it gets. */
const PORT_MARGIN = 60;
const PORT_CORNER = 40;
/** Where the porthole's middle is, as high as it can be while it fits. */
const PORT_Y = 760;

/**
 * The porthole: a rounded rectangle, w across and h tall, with corners of radius c, its middle cy above the floor
 * (and across the middle of the wall). With w = h = 2c it's a circle.
 */
export interface Porthole {
  w: number;
  h: number;
  c: number;
  cy: number;
}

/** A rounded rectangle's area. */
export function roundedArea(w: number, h: number, c: number): number {
  return w * h - (4 - Math.PI) * c * c;
}

/**
 * The porthole's shape at s from 0 to 3: up to 1 a circle, growing until it's as tall as the wall leaves room for;
 * then stretching across, to as long as the wall; then its corners tightening. Its area only grows with s.
 */
function shapeAt(s: number): Omit<Porthole, 'cy'> {
  const H = PORT_WALL.h - 2 * PORT_MARGIN;
  const W = PORT_WALL.w - 2 * PORT_MARGIN;
  if (s <= 1) return { w: s * H, h: s * H, c: (s * H) / 2 };
  if (s <= 2) return { w: H + (s - 1) * (W - H), h: H, c: H / 2 };
  return { w: W, h: H, c: H / 2 + (Math.min(s, 3) - 2) * (PORT_CORNER - H / 2) };
}

const areaAt = (s: number) => {
  const p = shapeAt(s);
  return roundedArea(p.w, p.h, p.c) / (PORT_WALL.w * PORT_WALL.h);
};

/** The most of the wall the porthole can take up, as a fraction of its area. */
export const PORT_MAX = areaAt(3);

/** The porthole taking up `frac` of the wall's area (clamped to what it can), its middle as near PORT_Y as fits. */
export function porthole(frac: number): Porthole {
  const f = Math.max(0, Math.min(PORT_MAX, frac));
  let [lo, hi] = [0, 3];
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (areaAt(mid) < f) lo = mid;
    else hi = mid;
  }
  const p = shapeAt((lo + hi) / 2);
  const cy = Math.max(PORT_MARGIN + p.h / 2, Math.min(PORT_WALL.h - PORT_MARGIN - p.h / 2, PORT_Y));
  return { ...p, cy };
}

/** How much of the left wall the porthole takes up, by area (see porthole). */
export const PORT_FRAC = 0.25;
