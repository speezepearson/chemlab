import { CAP } from './config';
import type { Flask } from './flask';

/** Fluid weighs 1 µg per atom, so a billion atoms (a full flask) weighs 1 kg. */
export const GRAMS_PER_ATOM = 1000 / CAP;
/** Nominal weight of an empty flask; each one is off by up to ±GLASS_ERROR. */
export const GLASS_GRAMS = 100;
export const GLASS_ERROR = 6;
/** The heaviest load a scale can read. */
export const SCALE_MAX = 5000;

/**
 * The empty weight of the flask in shelf slot i. Deterministic, so the same
 * flask weighs the same every game, but not round, so weighing fluid means
 * taring with the flask on first.
 */
export function glassGrams(i: number): number {
  // one round of mulberry32 seeded with the slot, mapped to [0, 1)
  let t = Math.imul(i + 1, 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  return GLASS_GRAMS + GLASS_ERROR * (2 * u - 1);
}

export function flaskGrams(f: Flask): number {
  return f.glass + f.N * GRAMS_PER_ATOM;
}

/** Scale geometry in local units, origin at the top center of the platform. */
export const SCALE_SHAPE = {
  /** Where flasks stand on the platform. */
  spots: [-58, 0, 58],
  platform: { x0: -92, x1: 92 },
  body: { x0: -84, x1: 84, y1: 40 },
  display: { x0: -62, x1: 22, y0: 12, y1: 32 },
  tare: { x0: 32, x1: 70, y0: 14, y1: 30 },
  /** Bounding box, including flasks standing on it. */
  box: { x0: -92, x1: 92, y0: -74, y1: 42 },
};

/** A bench scale with gram resolution. Flasks stand on its platform, one per spot. */
export class Scale {
  readonly spots: (Flask | null)[] = SCALE_SHAPE.spots.map(() => null);
  /** Subtracted from the reading, in whole grams. */
  tare = 0;

  constructor(
    /** Position of the platform's top center, as a fraction of the stage's width and height. */
    public fx: number,
    public fy: number,
  ) {}

  /** The true weight of everything on the platform, in grams. */
  gross(): number {
    let g = 0;
    for (const f of this.spots) if (f) g += flaskGrams(f);
    return g;
  }

  /** What the display shows: whole grams less the tare, or null when overloaded. */
  reading(): number | null {
    const g = this.gross();
    return g > SCALE_MAX ? null : Math.round(g) - this.tare;
  }

  /** Make the current load read zero. Does nothing while overloaded, like a real scale. */
  zero(): void {
    const g = this.gross();
    if (g <= SCALE_MAX) this.tare = Math.round(g);
  }

  /** Take a flask off, if it's on. */
  remove(f: Flask): void {
    const k = this.spots.indexOf(f);
    if (k >= 0) this.spots[k] = null;
  }
}
