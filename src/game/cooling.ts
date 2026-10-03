import { T_ROOM } from '../chem/params';
import { heatAt, roundRandom, temperature, type Fluid } from '../chem/reactions';

/**
 * How fluid in a vessel drifts to the room's temperature, editable from the Chemistry panel:
 * - rate: how fast, per sim second per unit of exposure (see exposure). Each sim second a fluid closes
 *   1 − e^(−rate·exposure) of the gap to ambient, so by default a full flask (exposure 0.155) takes about
 *   65 s to close all but 1/e of it, a full dispenser (0.09) 110 s, a full pipette (0.37) 27 s, and a
 *   puddle 2 deep in a dispenser (1.07) 9 s;
 * - ambient: the room's temperature, which everything drifts to (faucets pour at T = 1).
 */
export const COOLING = { rate: 0.1, ambient: T_ROOM };
const DEFAULT_COOLING = { ...COOLING };

export function restoreDefaultCooling(): void {
  Object.assign(COOLING, DEFAULT_COOLING);
}

/**
 * A rough thermal surface per volume, in 1 / world units, of fluid standing `h` deep in a vessel, `w` wide on
 * average (its area as drawn, over its depth). Taking it to be as deep, front to back, as it is wide, its floor and
 * free surface give 2/h and its walls 4/w. So a thin layer (small h) or a narrow column (small w) is exposed, and
 * a deep, wide pool isn't. With nothing standing (h = 0) it's infinite: a film takes the room's temperature at once.
 */
export function exposure(h: number, w: number): number {
  return h > 0 && w > 0 ? 2 / h + 4 / w : Infinity;
}

/**
 * How deep and how wide on average fluid stands when it fills `share` of a vessel `H` deep, tapering straight from
 * `w0` wide at its floor to `w1` at its top, with the level drawn at `share` of the way up (as drawTank draws it).
 */
export function taper(share: number, H: number, w0: number, w1: number): { h: number; w: number } {
  const h = Math.max(0, Math.min(1, share)) * H;
  return { h, w: w0 + ((w1 - w0) * h) / (2 * H) };
}

/**
 * Let a fluid lose heat to (or take it from) the room for `dt` sim seconds, with `exp` exposure (see exposure):
 * it closes 1 − e^(−COOLING.rate·exp·dt) of the gap to COOLING.ambient, in whole quanta.
 */
export function cool(f: Fluid, exp: number, dt: number): void {
  if (f.N <= 0 || temperature(f) === COOLING.ambient) return;
  const k = 1 - Math.exp(-COOLING.rate * exp * dt);
  f.Q = Math.max(0, f.Q + roundRandom((heatAt(COOLING.ambient, f.N) - f.Q) * k));
}
