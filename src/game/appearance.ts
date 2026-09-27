/*
 * How temperature looks. Every function here is continuous and monotone in T;
 * there is no threshold where one effect hands over to another.
 *
 *   T:            0     0.4    1      10     100
 *   value         0     0.70   0.95   1.00   1.00   cold fluids fade to black
 *   glow          0     0.07   0.15   0.52   1.00   corona/halo size and opacity, white heat
 */

/** HSV value multiplier: black at T = 0, almost full by T = 1. */
export function heatValue(T: number): number {
  return 1 - Math.exp(-3 * Math.max(T, 0));
}

/** Glow strength: 0 at T = 0, subtle at 1, strong at 10, 1 at 100, still rising beyond. */
export function glowStrength(T: number): number {
  return Math.log1p(Math.max(T, 0)) / Math.log(101);
}

/** How far the fluid itself is washed out toward white: negligible at 1, total by 100. */
export function whiteHeat(T: number): number {
  const g = glowStrength(T);
  return Math.min(1, g * g);
}

/** Peak opacity of the tight corona hugging a (full enough) flask: visible from T = 1 up. */
export function coronaAlpha(T: number): number {
  return Math.min(0.85, 1.3 * glowStrength(T));
}

/** Corona radius in unscaled layout pixels. */
export function coronaRadius(T: number): number {
  return 38 + 30 * glowStrength(T);
}

/** Peak opacity of the wide halo around a (full enough) flask. */
export function haloAlpha(T: number): number {
  const g = glowStrength(T);
  return Math.min(0.95, 0.35 * g + 0.6 * g * g);
}

/** Halo radius in unscaled layout pixels (a flask is 70 tall). */
export function haloRadius(T: number): number {
  return 30 + 420 * glowStrength(T) ** 1.5;
}

export type RGB = [number, number, number];

/** Push a color toward white by fraction w. */
export function whiten(c: readonly number[], w: number): RGB {
  return [0, 1, 2].map((k) => c[k] + (255 - c[k]) * w) as RGB;
}

export function css([r, g, b]: readonly number[], alpha = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}
