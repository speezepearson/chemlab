import { ATOM_WEIGHT, BONDS, BOND_KEYS } from './atoms';
import type { ChemParams } from './params';
import type { Fluid } from './reactions';
import { NS, SPECIES } from './species';

/*
 * How molecules ring. A molecule is taken for weights on springs: each atom as heavy as it weighs (see ATOM_WEIGHT),
 * each bond a spring as stiff as the size of its energy. It has one way of vibrating fewer than it has atoms, each
 * with its own pitch: stiffer bonds ring higher, heavier atoms lower. Nothing here is looked up: a species' notes
 * follow from its shape, its atoms' weights and the bond energies, so they move with the chemistry.
 */

/** The eigenvalues of a small symmetric matrix, by Jacobi's rotations, ascending. */
function eigenvalues(a: number[][]): number[] {
  const n = a.length;
  const m = a.map((row) => [...row]);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-18) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) [m[k][p], m[k][q]] = [c * m[k][p] - s * m[k][q], s * m[k][p] + c * m[k][q]];
        for (let k = 0; k < n; k++) [m[p][k], m[q][k]] = [c * m[p][k] - s * m[q][k], s * m[p][k] + c * m[q][k]];
      }
  }
  return m.map((row, i) => row[i]).sort((x, y) => x - y);
}

/**
 * The pitches a molecule of species s rings at, lowest first, in the chemistry's own units (the square root of a bond
 * energy over an atom's weight): the frequencies of its atoms on its bonds as springs, each as stiff as the size of
 * its bond's energy. A lone atom has none; a bond with no energy is no spring, so it adds none.
 */
export function modes(s: number, params: ChemParams): number[] {
  const sp = SPECIES[s];
  const n = sp.size;
  if (n < 2) return [];
  // the springs' matrix, scaled by the weights: its eigenvalues are the squares of the frequencies
  const d = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  BONDS.forEach(([i, j], b) => {
    if (!(sp.mask & (1 << b))) return;
    const k = Math.abs(params.bonds[BOND_KEYS[b]].E);
    const p = sp.atomIdx.indexOf(i);
    const q = sp.atomIdx.indexOf(j);
    const [wp, wq] = [ATOM_WEIGHT[sp.atoms[p]], ATOM_WEIGHT[sp.atoms[q]]];
    d[p][p] += k / wp;
    d[q][q] += k / wq;
    d[p][q] -= k / Math.sqrt(wp * wq);
    d[q][p] -= k / Math.sqrt(wp * wq);
  });
  return eigenvalues(d).filter((v) => v > 1e-9).map(Math.sqrt);
}

/** One note of a fluid's ring: its pitch (see modes) and how loud it is, from 0 to 1. */
export interface Partial {
  w: number;
  a: number;
}

/**
 * What a fluid rings with, loudest first, at most `most` notes: every species in it adds its own notes (see modes),
 * sharing between them a loudness that goes as the square root of its share of the molecules, so a little of
 * something is heard well under a lot of something else. Single atoms, having no bonds, add nothing.
 */
export function ringOf(f: Fluid, params: ChemParams, most = 12): Partial[] {
  let molecules = 0;
  for (let s = 0; s < NS; s++) molecules += f.n[s];
  if (molecules <= 0) return [];
  const out: Partial[] = [];
  for (let s = 0; s < NS; s++) {
    if (!f.n[s]) continue;
    const ws = modes(s, params);
    for (const w of ws) out.push({ w, a: Math.sqrt(f.n[s] / molecules / ws.length) });
  }
  return out.sort((x, y) => y.a - x.a).slice(0, most);
}
