import { ATOMS } from './atoms';
import { NS, SPECIES } from './species';

/**
 * Molecule counts at chemical equilibrium for a fluid holding `atoms[a]` atoms
 * of each ATOMS[a], at temperature T, given species energies U.
 *
 * Rates go as mole fractions (a bimolecular event rate is n_a·n_b/N for N
 * total atoms), so detailed balance across every reaction gives
 *
 *   n_s = N · exp(−U_s / T) · Π_a z_a^(count of a in s)
 *
 * with one factor z_a per atom, fixed by conservation of each atom. This
 * solves for the z by Newton's method on their logs, which is a convex
 * problem, so it converges from anywhere.
 */
export function equilibrium(atoms: readonly number[], U: Float64Array, T: number): Float64Array {
  const n = new Float64Array(NS);
  const present = ATOMS.map((_, a) => a).filter((a) => atoms[a] > 0);
  const N = present.reduce((t, a) => t + atoms[a], 0);
  if (!N) return n;
  const species = SPECIES.filter((s) => s.atomIdx.every((a) => atoms[a] > 0));
  const k = present.length;
  // counts[j][i]: how many of atom present[i] species j holds
  const counts = species.map((s) => present.map((a) => s.atomIdx.filter((x) => x === a).length));
  const logW = species.map((s) => Math.log(N) - U[s.i] / T);
  const y = present.map((a) => Math.log(atoms[a] / N));

  const amounts = () => species.map((_, j) => Math.exp(logW[j] + counts[j].reduce((t, c, i) => t + c * y[i], 0)));
  for (let iter = 0; iter < 500; iter++) {
    const m = amounts();
    const F = present.map((a, i) => species.reduce((t, _, j) => t + counts[j][i] * m[j], 0) - atoms[a]);
    if (F.every((f, i) => Math.abs(f) <= 1e-13 * atoms[present[i]])) break;
    const J = present.map((_, i) => present.map((_, l) => species.reduce((t, _, j) => t + counts[j][i] * counts[j][l] * m[j], 0)));
    // when one species dominates, J is nearly singular (every row ∝ its counts); a tiny ridge keeps the step finite
    const ridge = 1e-12 * Math.max(...J.map((row, i) => row[i]));
    J.forEach((row, i) => (row[i] += ridge));
    const step = solve(J, F.map((f) => -f));
    // the log-space objective is convex, but a full step can still overshoot wildly from a bad start
    const big = Math.max(...step.map(Math.abs));
    const damp = big > 2 ? 2 / big : 1;
    for (let i = 0; i < k; i++) y[i] += damp * step[i];
  }
  amounts().forEach((v, j) => (n[species[j].i] = v));
  return n;
}

/** Solve A·x = b by Gaussian elimination with partial pivoting. A is small, square and positive definite. */
function solve(A: number[][], b: number[]): number[] {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < k; r++) {
      const f = M[r][c] / M[c][c];
      for (let q = c; q <= k; q++) M[r][q] -= f * M[c][q];
    }
  }
  const x = new Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = M[r][k];
    for (let q = r + 1; q < k; q++) s -= M[r][q] * x[q];
    x[r] = s / M[r][r];
  }
  return x;
}
