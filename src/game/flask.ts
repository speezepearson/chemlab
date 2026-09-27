import { ATOMS, ATOM_RGB, type Atom } from '../chem/atoms';
import { T_ROOM } from '../chem/params';
import { atomCounts, type Fluid } from '../chem/reactions';
import { NS, singleOf } from '../chem/species';

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
    readonly label = '',
  ) {
    this.x = home.x;
    this.y = home.y;
  }

  /** Add free atoms at temperature T; returns the amount actually added. */
  addSingle(atom: Atom, amount: number, T: number): number {
    amount = Math.min(amount, this.cap - this.N);
    if (amount <= 0) return 0;
    this.n[singleOf(atom)] += amount;
    this.T = (this.N * this.T + amount * T) / (this.N + amount);
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

/**
 * Atom-weighted mix of the six colors (bond structure is invisible), then
 * tanh((T - T_room)/3) toward white when hot or black when cold.
 */
export function fluidColor(f: Fluid): string {
  const c = atomCounts(f);
  let tot = 0;
  for (const v of c) tot += v;
  if (tot <= 0) return 'transparent';
  const col = [0, 0, 0];
  for (let a = 0; a < ATOMS.length; a++) {
    const w = c[a] / tot;
    const rgb = ATOM_RGB[ATOMS[a]];
    for (let k = 0; k < 3; k++) col[k] += w * rgb[k];
  }
  const t = Math.tanh((f.T - T_ROOM) / 3);
  for (let k = 0; k < 3; k++) col[k] = t > 0 ? col[k] + (255 - col[k]) * t : col[k] * (1 + t);
  return `rgb(${col.map(Math.round).join(',')})`;
}

export function pureColor(atom: Atom, T: number): string {
  const n = new Float64Array(NS);
  n[singleOf(atom)] = 1;
  return fluidColor({ n, N: 1, T });
}
