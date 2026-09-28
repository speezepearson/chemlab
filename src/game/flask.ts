import { ATOMS, ATOM_RGB } from '../chem/atoms';
import { atomCounts, heatAt, roundRandom, temperature, type Fluid } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
import { TRACE } from './config';
import { GLASS_GRAMS } from './scale';
import { css, glowWhiteHeat, heatValue, whiteHeat, whiten, type RGB } from './appearance';

export interface Point {
  x: number;
  y: number;
}

/** A container of fluid with a fixed capacity, in atoms. Its counts and heat are always whole numbers. */
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
    const m = Math.max(0, Math.min(Math.round(molecules), Math.floor(this.n[s] + (this.cap - this.N) / size)));
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
   * Add about `amount` atoms' worth of a fluid, in whole molecules, without depleting it (a faucet's
   * recipe, or a packet already sent on its way); returns the atoms actually added.
   */
  addFrom(src: Fluid, amount: number): number {
    amount = Math.min(amount, this.cap - this.N);
    if (amount <= 0 || src.N <= 0) return 0;
    const f = amount / src.N;
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
 * Move about `atoms` atoms' worth of src's contents, in whole molecules, into dst (or down the sink if dst
 * is null), with heat in proportion; returns the atoms actually moved.
 */
export function transfer(src: Fluid, dst: (Fluid & { cap: number }) | null, atoms: number): number {
  atoms = Math.min(atoms, src.N, dst ? dst.cap - dst.N : Infinity);
  if (atoms <= 0) return 0;
  const f = atoms / src.N;
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

/** Atom-weighted mix of the six colors (bond structure is invisible); null if empty. */
export function fluidHue(f: Fluid): RGB | null {
  const c = atomCounts(f);
  let tot = 0;
  for (const v of c) tot += v;
  if (tot <= 0) return null;
  const col: RGB = [0, 0, 0];
  for (let a = 0; a < ATOMS.length; a++) {
    const w = c[a] / tot;
    const rgb = ATOM_RGB[ATOMS[a]];
    for (let k = 0; k < 3; k++) col[k] += w * rgb[k];
  }
  return col;
}

/** The fluid's own color: its hue, darkened when cold and washed toward white when very hot. */
export function fluidColor(f: Fluid): string {
  const hue = fluidHue(f);
  if (!hue) return 'transparent';
  const T = temperature(f);
  const v = heatValue(T);
  return css(whiten(hue.map((x) => x * v), whiteHeat(T)));
}

/** Color of the light a hot fluid gives off. */
export function glowColor(f: Fluid): RGB | null {
  const hue = fluidHue(f);
  return hue && whiten(hue, glowWhiteHeat(temperature(f)));
}
