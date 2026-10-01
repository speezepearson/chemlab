import type { ChemParams } from './params';

/*
 * Random chemistries: draw every bond's E and Ea independently from a chosen distribution, each draw then
 * negated with some probability. A few bond energies stay pinned (see PINNED_E).
 */

export type DistKind = 'normal' | 'lognormal' | 'uniform' | 'loguniform';

export interface DistParam {
  key: string;
  label: string;
  min: number;
  max: number;
  /** Whether its slider is logarithmic (min must be > 0). */
  log?: boolean;
}

/** Each distribution's parameters, as the sliders that set them. */
export const DISTS: Record<DistKind, { name: string; params: DistParam[] }> = {
  normal: {
    name: 'normal',
    params: [
      { key: 'mean', label: 'mean', min: -20, max: 50 },
      { key: 'sd', label: 'std dev', min: 0, max: 30 },
    ],
  },
  lognormal: {
    name: 'lognormal',
    params: [
      { key: 'median', label: 'median', min: 0.01, max: 100, log: true },
      { key: 'sigma', label: 'σ of ln', min: 0, max: 3 },
    ],
  },
  uniform: {
    name: 'uniform',
    params: [
      { key: 'lo', label: 'min', min: 0, max: 100 },
      { key: 'hi', label: 'max', min: 0, max: 100 },
    ],
  },
  loguniform: {
    name: 'log-uniform',
    params: [
      { key: 'logLo', label: 'min', min: 0.01, max: 1000, log: true },
      { key: 'logHi', label: 'max', min: 0.01, max: 1000, log: true },
    ],
  },
};

/**
 * A distribution to draw from: which kind, every kind's parameters (so switching back and forth keeps them),
 * and the probability of negating a draw.
 */
export interface Dist {
  kind: DistKind;
  p: Record<string, number>;
  flip: number;
}

const PARAM_DEFAULTS = { mean: 3, sd: 2, median: 3, sigma: 1, lo: 0.5, hi: 6, logLo: 0.1, logHi: 30 };

/** What the Chemistry panel's randomizer is set to; kept here so it outlasts the panel. */
export const RANDOMIZER: { E: Dist; Ea: Dist } = {
  E: { kind: 'lognormal', p: { ...PARAM_DEFAULTS }, flip: 0.15 },
  Ea: { kind: 'lognormal', p: { ...PARAM_DEFAULTS, median: 2 }, flip: 0 },
};

/** Bond energies that randomizing leaves fixed: every bond to B is uphill, and R–G is very strong. */
export const PINNED_E: Readonly<Record<string, number>> = { RB: -2, CB: -2, GB: -2, MB: -2, RG: 100 };

/** A standard normal draw (Box–Muller). */
function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** One draw from d, negated with probability d.flip, to three significant figures. */
export function draw(d: Dist, rand = Math.random): number {
  const p = d.p;
  let v: number;
  if (d.kind === 'normal') v = p.mean + p.sd * gaussian(rand);
  else if (d.kind === 'lognormal') v = p.median * Math.exp(p.sigma * gaussian(rand));
  else if (d.kind === 'uniform') v = p.lo + (p.hi - p.lo) * rand();
  else v = Math.exp(Math.log(p.logLo) + (Math.log(p.logHi) - Math.log(p.logLo)) * rand());
  if (rand() < d.flip) v = -v;
  return Number(v.toPrecision(3));
}

/** Give every bond a fresh E (unless pinned, see PINNED_E) and Ea, each drawn independently. Prefactors stay. */
export function randomizeBonds(params: ChemParams, E: Dist, Ea: Dist, rand = Math.random): void {
  for (const [k, b] of Object.entries(params.bonds)) {
    b.E = PINNED_E[k] ?? draw(E, rand);
    b.Ea = draw(Ea, rand);
  }
}
