import { ATOMS, ATOM_RGB } from '../chem/atoms';
import { T_ROOM } from '../chem/params';
import { atomCounts, type Fluid } from '../chem/reactions';
import { NS } from '../chem/species';
import { css, glowWhiteHeat, heatValue, whiteHeat, whiten, type RGB } from './appearance';

export interface Point {
  x: number;
  y: number;
}

export class Flask implements Fluid {
  n = new Float64Array(NS);
  N = 0;
  T = T_ROOM;
  x: number;
  y: number;
  ang = 0;

  constructor(
    public home: Point,
    readonly cap: number,
    public label = '',
  ) {
    this.x = home.x;
    this.y = home.y;
  }

  /** Add `amount` atoms' worth of a fluid without depleting it; returns the amount actually added. */
  addFrom(src: Fluid, amount: number): number {
    amount = Math.min(amount, this.cap - this.N);
    if (amount <= 0) return 0;
    const f = amount / src.N;
    for (let s = 0; s < NS; s++) this.n[s] += src.n[s] * f;
    this.T = (this.N * this.T + amount * src.T) / (this.N + amount);
    this.N += amount;
    return amount;
  }
}

/** Move `atoms` atoms' worth of src's contents into dst (or down the sink if dst is null). */
export function transfer(src: Fluid, dst: (Fluid & { cap: number }) | null, atoms: number): number {
  atoms = Math.min(atoms, src.N, dst ? dst.cap - dst.N : Infinity);
  if (atoms <= 1e-9) return 0;
  const f = atoms / src.N;
  for (let s = 0; s < NS; s++) {
    const m = src.n[s] * f;
    src.n[s] -= m;
    if (dst) dst.n[s] += m;
  }
  if (dst) {
    dst.T = (dst.N * dst.T + atoms * src.T) / (dst.N + atoms);
    dst.N += atoms;
  }
  src.N -= atoms;
  if (src.N < 1e-6) {
    src.N = 0;
    src.n.fill(0);
  }
  return atoms;
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
  const v = heatValue(f.T);
  return css(whiten(hue.map((x) => x * v), whiteHeat(f.T)));
}

/** Color of the light a hot fluid gives off. */
export function glowColor(f: Fluid): RGB | null {
  const hue = fluidHue(f);
  return hue && whiten(hue, glowWhiteHeat(f.T));
}
