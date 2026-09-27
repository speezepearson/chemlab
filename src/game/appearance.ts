/*
 * How temperature looks. Every function here is continuous and monotone in T;
 * there is no threshold where one effect hands over to another.
 *
 * With the default LOOK:
 *   T:            0     0.4    1      10     100
 *   value         0     0.70   0.95   1.00   1.00   cold fluids fade to black
 *   glow          0     0.07   0.15   0.52   1.00   corona/halo size and opacity
 *   whitening     0     0.01   0.02   0.27   1.00   hot fluids wash out to white
 *
 * LOOK is mutable so the Appearance debug panel can tune it live.
 */

export interface Look {
  /** value = 1 − e^(−coldRate·T) */
  coldRate: number;
  /** glow g = ln(1+T) / ln(1+glowRef): reaches 1 at T = glowRef, keeps rising after */
  glowRef: number;
  /** whitening curve s = min(1, ln(1+T) / ln(1+whiteRef))^whitePow */
  whiteRef: number;
  whitePow: number;
  /** fluid whitening = fluidWhite·s; glow-color whitening = glowWhite·s (each capped at 1) */
  fluidWhite: number;
  glowWhite: number;
  /** corona alpha = min(coronaMax, coronaGain·g); radius = coronaR0 + coronaR1·g */
  coronaGain: number;
  coronaMax: number;
  coronaR0: number;
  coronaR1: number;
  coronaSharpness: number;
  /** halo alpha = min(haloMax, haloLin·g + haloQuad·g²); radius = haloR0 + haloR1·g^haloPow */
  haloLin: number;
  haloQuad: number;
  haloMax: number;
  haloR0: number;
  haloR1: number;
  haloPow: number;
  haloSharpness: number;
}

export function defaultLook(): Look {
  return {
    coldRate: 3,
    glowRef: 100,
    whiteRef: 100,
    whitePow: 2,
    fluidWhite: 1,
    glowWhite: 1,
    coronaGain: 1.3,
    coronaMax: 0.85,
    coronaR0: 64,
    coronaR1: 40,
    coronaSharpness: 1.5,
    haloLin: 0.35,
    haloQuad: 0.6,
    haloMax: 0.95,
    haloR0: 30,
    haloR1: 420,
    haloPow: 1.5,
    haloSharpness: 2,
  };
}

export const LOOK: Look = defaultLook();

export function resetLook(): void {
  Object.assign(LOOK, defaultLook());
}

/** HSV value multiplier: black at T = 0, almost full by T = 1. */
export function heatValue(T: number): number {
  return 1 - Math.exp(-LOOK.coldRate * Math.max(T, 0));
}

/** Glow strength: 0 at T = 0, subtle at 1, strong at 10, 1 at glowRef, still rising beyond. */
export function glowStrength(T: number): number {
  return Math.log1p(Math.max(T, 0)) / Math.log1p(LOOK.glowRef);
}

/** Shape of the whitening curve, 0 at T = 0 rising to 1 at T = whiteRef. */
function whiteCurve(T: number): number {
  return Math.min(1, Math.log1p(Math.max(T, 0)) / Math.log1p(LOOK.whiteRef)) ** LOOK.whitePow;
}

/** How far the fluid itself is washed out toward white. */
export function whiteHeat(T: number): number {
  return Math.min(1, LOOK.fluidWhite * whiteCurve(T));
}

/** How far the color of the light a hot fluid gives off is washed out toward white. */
export function glowWhiteHeat(T: number): number {
  return Math.min(1, LOOK.glowWhite * whiteCurve(T));
}

/** Peak opacity of the tight corona hugging a (full enough) flask: visible from T = 1 up. */
export function coronaAlpha(T: number): number {
  return Math.min(LOOK.coronaMax, LOOK.coronaGain * glowStrength(T));
}

/** Corona radius in unscaled layout pixels. */
export function coronaRadius(T: number): number {
  return LOOK.coronaR0 + LOOK.coronaR1 * glowStrength(T);
}

/** Peak opacity of the wide halo around a (full enough) flask. */
export function haloAlpha(T: number): number {
  const g = glowStrength(T);
  return Math.min(LOOK.haloMax, LOOK.haloLin * g + LOOK.haloQuad * g * g);
}

/** Halo radius in unscaled layout pixels (a flask is 70 tall). */
export function haloRadius(T: number): number {
  return LOOK.haloR0 + LOOK.haloR1 * glowStrength(T) ** LOOK.haloPow;
}

/**
 * Glow opacity at fraction x of the way out from the center, relative to the
 * center: a Gaussian bump times a (1 − x²)² window. It is smooth everywhere
 * and reaches 0 at x = 1 with zero slope, so neither the interior nor the
 * rim shows an edge. Larger `sharpness` concentrates the light at the center.
 */
export function glowFalloff(x: number, sharpness: number): number {
  if (x >= 1) return 0;
  const w = 1 - x * x;
  return Math.exp(-sharpness * x * x) * w * w;
}

export type RGB = [number, number, number];

/** Push a color toward white by fraction w. */
export function whiten(c: readonly number[], w: number): RGB {
  return [0, 1, 2].map((k) => c[k] + (255 - c[k]) * w) as RGB;
}

export function css([r, g, b]: readonly number[], alpha = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}
