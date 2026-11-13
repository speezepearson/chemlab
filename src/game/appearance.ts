/*
 * How temperature looks. Every function here is continuous and monotone in T;
 * there is no threshold where one effect hands over to another.
 *
 * With the default LOOK:
 *   T:            0     0.4    1      10     100
 *   value         0     0.70   0.95   1.00   1.00   cold fluids fade to black
 *   whitening     0     0.01   0.02   0.27   1.00   hot fluids wash out to white
 *
 * And how composition looks (colorModel, cloudy, and the solvent's thinning,
 * solventAlpha): see fluidHue and fluidAlpha in flask.ts.
 *
 * LOOK is mutable so the Appearance debug panel can tune it live.
 */

/**
 * How a molecule's atoms combine into its color. A fluid's color is then the
 * atom-weighted average of its molecules' colors.
 * - atoms: a molecule is the average of its atoms, so the fluid is just the
 *   average of its atoms and no reaction changes it.
 * - paint: atoms mix like paint (multiply), rescaled to the average's brightness.
 * - light: atoms add like overlapping spotlights, clipped at full brightness.
 */
export type ColorModel = 'atoms' | 'paint' | 'light';

export interface Look {
  /** value = 1 − e^(−coldRate·T) */
  coldRate: number;
  /** whitening curve s = min(1, ln(1+T) / ln(1+whiteRef))^whitePow */
  whiteRef: number;
  whitePow: number;
  /** fluid whitening = fluidWhite·s (capped at 1) */
  fluidWhite: number;
  colorModel: ColorModel;
  /** How far a molecule's color goes from its atoms' average to the paint model's color (0 to 1). */
  paintMix: number;
  /** How far a molecule's color goes from its atoms' average to the light model's color (0 to 1). */
  lightMix: number;
  /** Whether bigger molecules make a fluid cloudier: opacity is the atom-weighted average of alpha1..3 by molecule size, alpha3 for three atoms or four. */
  cloudy: boolean;
  alpha1: number;
  alpha2: number;
  alpha3: number;
}

export function defaultLook(): Look {
  return {
    coldRate: 3,
    whiteRef: 100,
    whitePow: 2,
    fluidWhite: 1,
    colorModel: 'atoms',
    paintMix: 1,
    lightMix: 1,
    cloudy: false,
    alpha1: 0.2,
    alpha2: 0.6,
    alpha3: 1,
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

/** Shape of the whitening curve, 0 at T = 0 rising to 1 at T = whiteRef. */
function whiteCurve(T: number): number {
  return Math.min(1, Math.log1p(Math.max(T, 0)) / Math.log1p(LOOK.whiteRef)) ** LOOK.whitePow;
}

/** How far the fluid itself is washed out toward white. */
export function whiteHeat(T: number): number {
  return Math.min(1, LOOK.fluidWhite * whiteCurve(T));
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

/**
 * How opaque a fluid is by the share of its atoms that are the solvent, S, which has no color and thins whatever it's
 * in: 1 with none, falling to 0.12 for pure S, which still reads as a liquid with a surface. Concave, so strong
 * dilutions still show their color: about 0.70 at half S, 0.34 at nine tenths.
 */
export function solventAlpha(share: number): number {
  const x = Math.max(0, Math.min(1, share));
  return 0.12 + 0.88 * (1 - x) ** 0.6;
}

/** The hue of a fluid that's all solvent: a faint, cool near-white, as clear liquid in glass looks. */
export const SOLVENT_TINT: RGB = [222, 232, 240];

/** Push a color toward white by fraction w. */
export function whiten(c: readonly number[], w: number): RGB {
  return [0, 1, 2].map((k) => c[k] + (255 - c[k]) * w) as RGB;
}

export function css([r, g, b]: readonly number[], alpha = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}
