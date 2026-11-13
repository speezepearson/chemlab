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

/** Area of the part of a polygon below the line y = h (y grows downward): FLASK_OUTLINE's is the flask's outline's. */
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

/** The flask's inside radius `d` below its mouth (0 to 70), from FLASK_OUTLINE's right side; 0 outside it. */
export function flaskRadius(d: number): number {
  let r = 0;
  const n = FLASK_OUTLINE.length;
  for (let i = 0; i < n; i++) {
    const p = FLASK_OUTLINE[i];
    const q = FLASK_OUTLINE[(i + 1) % n];
    if ((p.y <= d && q.y >= d) || (q.y <= d && p.y >= d)) {
      const x = p.y === q.y ? Math.max(p.x, q.x) : p.x + ((d - p.y) * (q.x - p.x)) / (q.y - p.y);
      r = Math.max(r, x);
    }
  }
  return r;
}

/** The flask's depth, mouth to base. */
export const FLASK_H = 70;

/** The flask's inside, in world units cubed: the solid FLASK_OUTLINE turns about its axis. */
export const FLASK_VOLUME = (() => {
  let v = 0;
  const step = 0.01;
  for (let d = step / 2; d < FLASK_H; d += step) v += Math.PI * flaskRadius(d) ** 2 * step;
  return v;
})();

/** The side of the square slabs SLABS cuts the flask's inside into: rows that tile its depth exactly. */
const STEP = FLASK_H / Math.round(FLASK_H / 0.6);

/**
 * The flask's inside, the solid FLASK_OUTLINE turns about its axis, as thin slabs: each is a point (x, y), with the
 * mouth at the origin and y up, and the volume of the slab through it from front to back. Front to back doesn't
 * matter to the level: the flask tips about its own z axis, which leaves z out of every height.
 */
const SLABS: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (let row = 0; row < Math.round(FLASK_H / STEP); row++) {
    const d = (row + 0.5) * STEP;
    const r = flaskRadius(d);
    for (let x = -r + STEP / 2; x < r; x += STEP) out.push([x, -d, 2 * Math.sqrt(r * r - x * x) * STEP * STEP]);
  }
  return out;
})();

let levelCache = { tilt: NaN, heights: new Float64Array(0), below: new Float64Array(0) };

/**
 * Where the fluid's surface is in a flask filled to fraction `frac` of its capacity and tipped by `tilt` about
 * its mouth (its own right side going down, see Flask.tilt): the height above the mouth that leaves `frac` of the
 * flask's volume underneath. So the fluid shown always tracks the amount in it, whether the level is in the
 * wide base or the narrow neck, or the flask is tipped to pour. Each slab's volume is spread evenly over the heights
 * it spans, tipped, so the level rises smoothly with the fill, a trace included, rather than a slab's row at a time.
 */
export function fillLevel(tilt: number, frac: number): number {
  if (levelCache.tilt !== tilt) {
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    const slabs = SLABS.map(([x, y, w]) => [y * c - x * s, w] as const).sort((a, b) => a[0] - b[0]);
    // how far above and below its middle a tipped square slab reaches
    const e = (STEP / 2) * (Math.abs(c) + Math.abs(s));
    // the volume below a height is piecewise linear, bending where a slab starts or ends: walk those heights in
    // order (the starts and the ends are each sorted already), adding up the volume as it goes
    const n = slabs.length;
    const heights = new Float64Array(2 * n);
    const below = new Float64Array(2 * n);
    let [i, j, slope, acc] = [0, 0, 0, 0];
    let y = slabs[0][0] - e;
    for (let k = 0; k < 2 * n; k++) {
      const start = i < n && slabs[i][0] - e <= slabs[j][0] + e;
      const yk = start ? slabs[i][0] - e : slabs[j][0] + e;
      acc += slope * (yk - y);
      y = yk;
      heights[k] = yk;
      below[k] = acc;
      if (start) slope += slabs[i++][1] / (2 * e);
      else slope -= slabs[j++][1] / (2 * e);
    }
    for (let k = 0; k < 2 * n; k++) below[k] /= acc;
    levelCache = { tilt, heights, below };
  }
  const { heights: h, below } = levelCache;
  const f = Math.max(0, Math.min(1, frac));
  if (f <= below[0]) return h[0];
  if (f >= below[below.length - 1]) return h[h.length - 1];
  // the last height with no more than f below it, and the next, which has more
  let lo = 0;
  let hi = below.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (below[mid] <= f) lo = mid;
    else hi = mid;
  }
  return h[lo] + ((h[hi] - h[lo]) * (f - below[lo])) / (below[hi] - below[lo]);
}
