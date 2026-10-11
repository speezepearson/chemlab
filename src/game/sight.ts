import { ROOM } from './space';

/**
 * The player's view settings, from the View panel: the camera's field of view, top to bottom, in degrees, and how
 * much of the left wall the porthole onto the stars takes up, as a fraction of its area (see porthole). Kept in
 * local storage, not in saves: they're preferences.
 */
export interface Sight {
  fov: number;
  port: number;
}

/** The left wall, which the porthole is in: how long it is (front to back) and how tall. */
export const PORT_WALL = { w: ROOM.z1 - ROOM.z0, h: ROOM.y1 };
/** How close the porthole comes to the wall's edges, and its corners' tightest radius once it's as big as it gets. */
const PORT_MARGIN = 60;
const PORT_CORNER = 40;
/** Where the porthole's middle is, as high as it can be while it fits. */
const PORT_Y = 760;
/** How big the porthole starts: a circle of this radius. */
const PORT_R = 150;

/** The field of view's range, in degrees. */
export const FOV_RANGE = { min: 40, max: 110 };

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

export const DEFAULT_SIGHT: Readonly<Sight> = {
  fov: 72,
  port: (Math.PI * PORT_R * PORT_R) / (PORT_WALL.w * PORT_WALL.h),
};

/** The settings in use: the View panel edits them, and the view follows. */
export const SIGHT: Sight = storedSight();

/** Settings from stored JSON, tolerating junk: anything missing or out of range gets its default. */
export function parseSight(json: string | null): Sight {
  const out = { ...DEFAULT_SIGHT };
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return out;
  }
  if (raw && typeof raw === 'object') {
    const { fov, port } = raw as Record<string, unknown>;
    if (typeof fov === 'number' && fov >= FOV_RANGE.min && fov <= FOV_RANGE.max) out.fov = fov;
    if (typeof port === 'number' && port >= 0 && port <= PORT_MAX) out.port = port;
  }
  return out;
}

const KEY = 'slurry-lab.sight';

function storedSight(): Sight {
  try {
    return parseSight(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_SIGHT };
  }
}

export function storeSight(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(SIGHT));
  } catch {
    // storage blocked: the settings just reset next time
  }
}
