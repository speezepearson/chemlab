import type { Point } from './flask';

/** Points along a quadratic Bézier from p0 (excluded) to p1 (included). */
function quad(p0: Point, c: Point, p1: Point, n: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y });
  }
  return out;
}

/**
 * The inside of a flask, in local units with the mouth's center at the origin
 * and the base at y = 70, as a closed polygon (the rounded corners are
 * flattened finely enough to draw as curves). Both the drawn glass and the
 * fluid level come from this, so they always agree.
 */
export const FLASK_OUTLINE: readonly Point[] = [
  { x: -11, y: 0 },
  { x: 11, y: 0 },
  { x: 9, y: 22 },
  { x: 26, y: 64 },
  ...quad({ x: 26, y: 64 }, { x: 28, y: 70 }, { x: 22, y: 70 }, 12),
  { x: -22, y: 70 },
  ...quad({ x: -22, y: 70 }, { x: -28, y: 70 }, { x: -26, y: 64 }, 12),
  { x: -9, y: 22 },
];

/** FLASK_OUTLINE as SVG path data, for Path2D. */
export const FLASK_PATH_DATA = `M${FLASK_OUTLINE.map((p) => `${p.x} ${p.y}`).join(' L')} Z`;

/** Twice the signed area of a polygon (shoelace). */
function area2(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

/** Area of the part of a polygon below the line y = h (y grows downward). */
export function areaBelow(poly: readonly Point[], h: number): number {
  // clip to y >= h, one edge at a time (Sutherland–Hodgman against a single half-plane)
  const kept: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pIn = p.y >= h;
    const qIn = q.y >= h;
    if (pIn) kept.push(p);
    if (pIn !== qIn) kept.push({ x: p.x + ((h - p.y) * (q.x - p.x)) / (q.y - p.y), y: h });
  }
  return Math.abs(area2(kept)) / 2;
}

/** FLASK_OUTLINE turned by `ang` about the mouth, as drawFlask turns it. */
export function tiltedOutline(ang: number): Point[] {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return FLASK_OUTLINE.map(({ x, y }) => ({ x: x * c - y * s, y: x * s + y * c }));
}

/**
 * Where the fluid's surface is in a flask tilted by `ang` and filled to
 * fraction `frac` of its capacity: the height, in local units below the
 * mouth (and upright to the screen), that leaves `frac` of the flask's area
 * underneath. So the colored area always tracks the amount of fluid, whether
 * the level is in the wide base or the narrow neck, or the flask is tipped
 * to pour.
 */
export function fillLevel(ang: number, frac: number): number {
  const poly = tiltedOutline(ang);
  let lo = Math.min(...poly.map((p) => p.y)); // the surface can't be higher than the top...
  let hi = Math.max(...poly.map((p) => p.y)); // ...or lower than the bottom
  const target = Math.max(0, Math.min(1, frac)) * areaBelow(poly, lo);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (areaBelow(poly, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
