import { ATOMS, type Atom } from './atoms';
import { THERMO } from './params';
import type { Fluid } from './reactions';
import { NS, SPECIES } from './species';

/**
 * One atom's worth of a fluid made of atoms in these shares, at full chemical equilibrium at T: every reaction
 * run to its end, including ones the kinetics never get to (see equilibrium).
 */
export function equilibriumFluid(atoms: Partial<Record<Atom, number>>, U: Float64Array, T: number): Fluid {
  const shares = ATOMS.map((a) => atoms[a] ?? 0);
  const total = shares.reduce((t, v) => t + v, 0);
  return { n: equilibrium(shares.map((v) => v / total), U, T), N: 1, Q: T * THERMO.heatCap };
}

/**
 * Molecule counts at chemical equilibrium for a fluid holding `atoms[a]` atoms
 * of each ATOMS[a], at temperature T, given species energies U.
 *
 * Rates go as mole fractions (a bimolecular event rate is n_a·n_b/N for N
 * total atoms), so detailed balance across every reaction gives
 *
 *   n_s = N · exp(−U_s / T) · Π_a z_a^(count of a in s)
 *
 * with one factor z_a per atom, fixed by conservation of each atom. Their
 * logs y minimize the convex function G(y) = Σ_s n_s(y) − Σ_a atoms_a·y_a,
 * whose gradient is the atom-balance residuals. This minimizes it by damped
 * Newton (Levenberg–Marquardt): energies spanning hundreds of k_B·T make it
 * wildly ill-conditioned from a cold start, so a step is taken only if it
 * lowers G (or, once G is flat to rounding, shrinks the residuals), with the
 * damping raised until one does.
 */
export function equilibrium(atoms: readonly number[], U: Float64Array, T: number): Float64Array {
  const n = new Float64Array(NS);
  const present = ATOMS.map((_, a) => a).filter((a) => atoms[a] > 0);
  const N = present.reduce((t, a) => t + atoms[a], 0);
  if (!N) return n;
  const species = SPECIES.filter((s) => s.atomIdx.every((a) => atoms[a] > 0));
  // counts[j][i]: how many of atom present[i] species j holds
  const counts = species.map((s) => present.map((a) => s.atomIdx.filter((x) => x === a).length));
  const logW = species.map((s) => Math.log(N) - U[s.i] / T);

  const amounts = (y: number[]) =>
    species.map((_, j) => Math.exp(logW[j] + counts[j].reduce((t, c, i) => t + c * y[i], 0)));
  // each atom's excess over its target, and the sum of their squares relative to the targets
  const residuals = (m: number[]) =>
    present.map((a, i) => species.reduce((t, _, j) => t + counts[j][i] * m[j], 0) - atoms[a]);
  // the log of the sum of their squares, relative to the targets, computed so it can't overflow
  const merit = (F: number[]) => {
    const rel = F.map((f, i) => Math.abs(f / atoms[present[i]]));
    const big = Math.max(...rel);
    if (!Number.isFinite(big)) return Infinity;
    if (big === 0) return -Infinity;
    return 2 * Math.log(big) + Math.log(rel.reduce((t, x) => t + (x / big) ** 2, 0));
  };

  // start from each atom's share, lowered evenly so that no species starts out above N
  let y = present.map((a) => Math.log(atoms[a] / N));
  const excess = Math.max(
    0,
    ...species.map((s, j) => (logW[j] + counts[j].reduce((t, c, i) => t + c * y[i], 0) - Math.log(N)) / s.size),
  );
  y = y.map((v) => v - excess);
  const objective = (y: number[], m: number[]) =>
    m.reduce((t, v) => t + v, 0) - present.reduce((t, a, i) => t + atoms[a] * y[i], 0);
  let m = amounts(y);
  let F = residuals(m);
  let r = merit(F);
  let g = objective(y, m);
  let damping = 1e-3;
  for (let iter = 0; iter < 2000 && damping < 1e30; iter++) {
    if (F.every((f, i) => Math.abs(f) <= 1e-13 * atoms[present[i]])) break;
    const J = present.map((_, i) =>
      present.map((_, l) => species.reduce((t, _, j) => t + counts[j][i] * counts[j][l] * m[j], 0)),
    );
    // damp by the largest curvature, not each atom's own: an atom whose species are all negligible has ~0 curvature
    const scale = Math.max(...J.map((row, i) => row[i]));
    const damped = J.map((row, i) => row.map((v, l) => (i === l ? v + damping * scale + 1e-300 : v)));
    const step = solve(damped, F.map((f) => -f));
    const yNew = y.map((v, i) => v + step[i]);
    const mNew = amounts(yNew);
    const FNew = residuals(mNew);
    const rNew = merit(FNew);
    const gNew = objective(yNew, mNew);
    const flat = Math.abs(gNew - g) <= 1e-12 * (Math.abs(g) + N);
    if (gNew < g || (flat && rNew < r)) {
      [y, m, F, r, g] = [yNew, mNew, FNew, rNew, gNew];
      damping = Math.max(damping / 3, 1e-12);
    } else damping *= 4; // overshot, or overflowed to Infinity/NaN: try a shorter, more cautious step
  }
  m.forEach((v, j) => (n[species[j].i] = v));
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
