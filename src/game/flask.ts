import { ATOMS, ATOM_RGB } from '../chem/atoms';
import { heatAt, roundRandom, temperature, type Fluid } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { GOAL_PURITY, TRACE } from './config';
import { GLASS_GRAMS } from './scale';
import { LOOK, css, glowWhiteHeat, heatValue, whiteHeat, whiten, type RGB } from './appearance';

export interface Point {
  x: number;
  y: number;
}

/**
 * What takes up room in a vessel: atoms (the default), or molecules. With molecules, bonding shrinks a fluid
 * and breaking bonds swells it, so a full vessel can overflow as it reacts. Toggled from the Chemistry panel.
 * Mass, heat capacity and reaction rates stay per atom either way.
 */
export const VOLUME = { molecules: false };

/** A fluid's volume: its atoms, or its molecules if VOLUME.molecules. */
export function volume(f: Fluid): number {
  if (!VOLUME.molecules) return f.N;
  let m = 0;
  for (let s = 0; s < NS; s++) m += f.n[s];
  return m;
}

/** The units volume is counted in, for display. */
export const volumeUnit = () => (VOLUME.molecules ? 'molecules' : 'atoms');

/** How much room one molecule of species s takes: its atoms, or 1 if VOLUME.molecules. */
export const roomFor = (s: number) => (VOLUME.molecules ? 1 : SPECIES[s].size);

/** A container of fluid with a fixed capacity, by volume (see VOLUME). Its counts and heat are always whole numbers. */
export class Vessel implements Fluid {
  n = new Float64Array(NS);
  N = 0;
  Q = 0;

  constructor(
    readonly cap: number,
    public label = '',
  ) {}

  /**
   * Set one species' molecule count, rounded and clamped to [0, what fits], keeping the temperature;
   * returns the count actually set.
   */
  setMolecules(s: number, molecules: number): number {
    const size = SPECIES[s].size;
    const T = temperature(this);
    const m = Math.max(0, Math.min(Math.round(molecules), Math.floor(this.n[s] + (this.cap - volume(this)) / roomFor(s))));
    this.N += (m - this.n[s]) * size;
    this.n[s] = m;
    this.Q = heatAt(T, this.N);
    return m;
  }

  /** Set the temperature, by setting the heat to match. */
  setTemperature(T: number): void {
    this.Q = heatAt(Math.max(0, T), this.N);
  }

  /**
   * Add about `amount` worth (by volume) of a fluid, in whole molecules, without depleting it (a faucet's
   * recipe, or a packet already sent on its way); returns the atoms actually added. Only what fits is
   * added, unless `overfill`, which leaves it to the caller to deal with the excess.
   */
  addFrom(src: Fluid, amount: number, overfill = false): number {
    if (!overfill) amount = Math.min(amount, this.cap - volume(this));
    const vs = volume(src);
    if (amount <= 0 || vs <= 0) return 0;
    const f = amount / vs;
    let added = 0;
    for (let s = 0; s < NS; s++) {
      const m = roundRandom(src.n[s] * f);
      this.n[s] += m;
      added += m * SPECIES[s].size;
    }
    this.Q += roundRandom((src.Q * added) / src.N);
    this.N += added;
    return added;
  }
}

/** Atoms of the target in a fluid that counts toward the goal: all of them if it's at least GOAL_PURITY target, else none. */
export function sustenance(f: Fluid): number {
  const t = f.n[TARGET] * SPECIES[TARGET].size;
  return f.N > 0 && t >= GOAL_PURITY * f.N ? t : 0;
}

/** A flask on the shelf. It lives in a slot (`home`) and can be picked up and carried. */
export class Flask extends Vessel {
  x: number;
  y: number;
  ang = 0;
  /** Weight of the empty flask, in grams. */
  glass = GLASS_GRAMS;

  constructor(
    public home: Point,
    cap: number,
    label = '',
  ) {
    super(cap, label);
    this.x = home.x;
    this.y = home.y;
  }
}

/**
 * Move about `amount` worth (by volume, see VOLUME) of src's contents, in whole molecules, into dst (or down
 * the sink if dst is null), with heat in proportion; returns the atoms actually moved.
 */
export function transfer(src: Fluid, dst: (Fluid & { cap: number }) | null, amount: number): number {
  const vs = volume(src);
  amount = Math.min(amount, vs, dst ? dst.cap - volume(dst) : Infinity);
  if (amount <= 0) return 0;
  const f = amount / vs;
  let moved = 0;
  for (let s = 0; s < NS; s++) {
    const m = Math.min(src.n[s], roundRandom(src.n[s] * f));
    if (!m) continue;
    src.n[s] -= m;
    if (dst) dst.n[s] += m;
    moved += m * SPECIES[s].size;
  }
  const q = moved >= src.N ? src.Q : Math.min(src.Q, roundRandom((src.Q * moved) / src.N));
  src.Q -= q;
  src.N -= moved;
  if (dst) {
    dst.Q += q;
    dst.N += moved;
  }
  if (src.N < TRACE) {
    src.N = 0;
    src.n.fill(0);
    src.Q = 0;
  }
  return moved;
}

/** One species' color under a color model (see ColorModel in appearance.ts). */
function speciesColor(atoms: readonly RGB[], model: string, mix: number): RGB {
  const avg = [0, 1, 2].map((k) => atoms.reduce((t, c) => t + c[k], 0) / atoms.length) as RGB;
  let c: RGB;
  if (model === 'paint') {
    // multiply, as paints and filters do, then bring the brightest channel back up to the average's
    const prod = [0, 1, 2].map((k) => 255 * atoms.reduce((t, a) => t * (a[k] / 255), 1));
    const top = Math.max(...prod);
    const scale = top > 0 ? Math.max(...avg) / top : 0;
    c = top > 0 ? (prod.map((x) => x * scale) as RGB) : avg;
  } else if (model === 'light') {
    c = [0, 1, 2].map((k) => Math.min(255, atoms.reduce((t, a) => t + a[k], 0))) as RGB;
  } else return avg;
  return avg.map((x, k) => x + (c[k] - x) * mix) as RGB;
}

let colorCache = { key: '', colors: [] as RGB[] };

/** Every species' color under the current LOOK, recomputed only when its settings change. */
function speciesColors(): RGB[] {
  const mix = LOOK.colorModel === 'paint' ? LOOK.paintMix : LOOK.lightMix;
  const key = `${LOOK.colorModel}:${mix}`;
  if (colorCache.key !== key)
    colorCache = {
      key,
      colors: SPECIES.map((s) => speciesColor(s.atomIdx.map((a) => ATOM_RGB[ATOMS[a]] as RGB), LOOK.colorModel, mix)),
    };
  return colorCache.colors;
}

/**
 * Atom-weighted mix of the fluid's molecules' colors; null if empty. Under the default 'atoms' model this is
 * just the mix of its atoms' colors, so bond structure is invisible; the other models show some of it.
 */
export function fluidHue(f: Fluid): RGB | null {
  if (f.N <= 0) return null;
  const colors = speciesColors();
  const col: RGB = [0, 0, 0];
  for (let s = 0; s < NS; s++) {
    if (!(f.n[s] > 0)) continue;
    const w = (f.n[s] * SPECIES[s].size) / f.N;
    for (let k = 0; k < 3; k++) col[k] += w * colors[s][k];
  }
  return col;
}

/** How opaque the fluid looks: 1 unless LOOK.cloudy, then the atom-weighted average of alpha1..3 by molecule size. */
export function fluidAlpha(f: Fluid): number {
  if (!LOOK.cloudy || f.N <= 0) return 1;
  const alpha = [0, LOOK.alpha1, LOOK.alpha2, LOOK.alpha3];
  let a = 0;
  for (let s = 0; s < NS; s++) if (f.n[s] > 0) a += ((f.n[s] * SPECIES[s].size) / f.N) * alpha[SPECIES[s].size];
  return Math.max(0, Math.min(1, a));
}

/** The fluid's own color: its hue, darkened when cold and washed toward white when very hot. */
export function fluidColor(f: Fluid): string {
  const hue = fluidHue(f);
  if (!hue) return 'transparent';
  const T = temperature(f);
  const v = heatValue(T);
  return css(whiten(hue.map((x) => x * v), whiteHeat(T)), fluidAlpha(f));
}

/** Color of the light a hot fluid gives off. */
export function glowColor(f: Fluid): RGB | null {
  const hue = fluidHue(f);
  return hue && whiten(hue, glowWhiteHeat(temperature(f)));
}
