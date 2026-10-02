import { ATOMS, BIT_PAIRS, GROUP_PRIMARY, OPPOSITE, bitOf, popcount3, type Atom, type Group } from './atoms';
import { THERMO, T_ROOM, type ChemParams } from './params';
import { NS, SPECIES, bondParam, singleOf, speciesEnergies, speciesIndex } from './species';

/**
 * A well-mixed packet of fluid: species counts plus its heat. In a vessel the
 * counts and the heat are always whole numbers (see roundRandom), which
 * JavaScript numbers hold exactly up to 2^53 ≈ 9×10^15. A faucet's recipe is
 * a Fluid too, but a fractional one: one atom's worth, poured out in whole
 * molecules.
 */
export interface Fluid {
  /** Molecule count per species. */
  n: Float64Array;
  /** Total atom count. */
  N: number;
  /** Thermal energy, in quanta of one unit of bond energy. */
  Q: number;
}

/** A fluid's temperature, from its heat: Q / (heat capacity · atoms). An empty fluid reads as room temperature. */
export function temperature(f: Fluid): number {
  return f.N > 0 ? f.Q / (THERMO.heatCap * f.N) : T_ROOM;
}

/** The heat, in whole quanta, that puts N atoms at temperature T. */
export function heatAt(T: number, N: number): number {
  return Math.round(T * THERMO.heatCap * N);
}

/**
 * x rounded to a whole number at random: up with probability equal to its
 * fractional part. The result is right on average, so a trickle of 0.3
 * molecules a step still adds up, where plain rounding would lose it.
 */
export function roundRandom(x: number): number {
  const lo = Math.floor(x);
  return lo + (Math.random() < x - lo ? 1 : 0);
}

interface Reaction {
  ra: number;
  rb: number; // -1 if unimolecular
  p1: number;
  p2: number; // -1 if single product
  A: number;
  /** Barrier actually climbed in this direction: Ea + max(0, dU). */
  bar: number;
  dU: number;
}

/**
 * Every reaction between the 50 species, stored as parallel typed arrays.
 * Rebuild after changing ChemParams.
 */
export class ReactionNetwork {
  readonly U = new Float64Array(NS);
  count = 0;
  /** Goes up with every rebuild, so whatever depends on the chemistry knows to recompute. */
  version = 0;
  private ra = new Int16Array(0);
  private rb = new Int16Array(0);
  private p1 = new Int16Array(0);
  private p2 = new Int16Array(0);
  private k = new Float64Array(0);
  private bar = new Float64Array(0);
  private dU = new Float64Array(0);
  private flux = new Float64Array(0);
  private cons = new Float64Array(NS);

  constructor(readonly params: ChemParams) {
    this.rebuild();
  }

  rebuild(): void {
    this.version++;
    const p = this.params;
    const U = speciesEnergies(p, this.U);
    const rx: Reaction[] = [];
    const add = (ra: number, rb: number, p1: number, p2: number, A: number, Ea: number, dU: number) =>
      rx.push({ ra, rb, p1, p2, A, bar: Ea + Math.max(0, dU), dU });
    const G = [0, 1, 2] as const;

    // bond formation (bimolecular): A + B -> AB with one new bond
    for (const A of SPECIES)
      for (const B of SPECIES) {
        if (A.i >= B.i) continue;
        if (A.size + B.size > 3) continue;
        if (G.some((g) => A.atoms[g] && B.atoms[g])) continue;
        const atoms = G.map((g) => A.atoms[g] ?? B.atoms[g]);
        for (const ga of G) {
          const a = A.atoms[ga];
          if (!a) continue;
          for (const gb of G) {
            const b = B.atoms[gb];
            if (!b) continue;
            const bp = bondParam(p, a, b);
            const prod = speciesIndex(atoms, A.mask | B.mask | bitOf(ga, gb));
            add(A.i, B.i, prod, -1, bp.A, bp.Ea, -bp.E);
          }
        }
      }

    // ring closure (unimolecular): path -> triangle
    for (const sp of SPECIES)
      if (sp.size === 3 && popcount3(sp.mask) === 2) {
        const k = [0, 1, 2].find((k) => !(sp.mask & (1 << k)))!;
        const [g1, g2] = BIT_PAIRS[k];
        const bp = bondParam(p, sp.atoms[g1]!, sp.atoms[g2]!);
        add(sp.i, -1, speciesIndex(sp.atoms, 7), -1, bp.A, bp.Ea, -bp.E);
      }

    // bond breaking (unimolecular)
    for (const sp of SPECIES)
      for (let k = 0; k < 3; k++) {
        if (!(sp.mask & (1 << k))) continue;
        const [g1, g2] = BIT_PAIRS[k];
        const bp = bondParam(p, sp.atoms[g1]!, sp.atoms[g2]!);
        const nm = sp.mask & ~(1 << k);
        if (sp.size === 3 && popcount3(nm) === 2) {
          // triangle -> path
          add(sp.i, -1, speciesIndex(sp.atoms, nm), -1, bp.A, bp.Ea, bp.E);
        } else if (sp.size === 2) {
          add(sp.i, -1, singleOf(sp.atoms[g1]!), singleOf(sp.atoms[g2]!), bp.A, bp.Ea, bp.E);
        } else {
          // size 3, one bond left: a pair + a single
          const [h1, h2] = BIT_PAIRS[[0, 1, 2].find((kk) => nm & (1 << kk))!];
          const pairAtoms = G.map((g) => (g === h1 || g === h2 ? sp.atoms[g] : null));
          const lone = G.find((g) => g !== h1 && g !== h2)!;
          add(sp.i, -1, speciesIndex(pairAtoms, nm), singleOf(sp.atoms[lone]!), bp.A, bp.Ea, bp.E);
        }
      }

    // swaps (bimolecular, Ea=0): opposite colors trade places, bond topology unchanged
    for (let g = 0 as Group; g < 3; g++) {
      const X = GROUP_PRIMARY[g];
      const Xo: Atom = OPPOSITE[X];
      for (const A of SPECIES) {
        if (A.atoms[g] !== X) continue;
        for (const B of SPECIES) {
          if (B.atoms[g] !== Xo) continue;
          const a2 = A.atoms.slice();
          a2[g] = Xo;
          const b2 = B.atoms.slice();
          b2[g] = X;
          const A2 = speciesIndex(a2, A.mask);
          const B2 = speciesIndex(b2, B.mask);
          if (A2 === B.i && B2 === A.i) continue; // null reaction
          add(A.i, B.i, A2, B2, p.swapA, 0, U[A2] + U[B2] - U[A.i] - U[B.i]);
        }
      }
    }

    this.store(rx);
  }

  private store(rx: Reaction[]): void {
    const nr = rx.length;
    if (nr !== this.count) {
      this.count = nr;
      this.ra = new Int16Array(nr);
      this.rb = new Int16Array(nr);
      this.p1 = new Int16Array(nr);
      this.p2 = new Int16Array(nr);
      this.k = new Float64Array(nr);
      this.bar = new Float64Array(nr);
      this.dU = new Float64Array(nr);
      this.flux = new Float64Array(nr);
    }
    rx.forEach((r, i) => {
      this.ra[i] = r.ra;
      this.rb[i] = r.rb;
      this.p1[i] = r.p1;
      this.p2[i] = r.p2;
      this.k[i] = r.A;
      this.bar[i] = r.bar;
      this.dU[i] = r.dU;
    });
  }

  /**
   * The longest step that consumes at most `share` of any species present in f, at f's current rates: how far
   * step can go in one go and still follow the kinetics rather than overshoot them. Infinity if nothing reacts.
   */
  stableDt(f: Fluid, share: number): number {
    const N = f.N;
    if (N <= 0) return Infinity;
    const { n } = f;
    const { ra, rb, k, bar, cons, count } = this;
    const invT = 1 / Math.max(temperature(f), 0.05);
    cons.fill(0);
    for (let i = 0; i < count; i++) {
      const a = n[ra[i]];
      if (a <= 0) continue;
      const b = rb[i];
      if (b >= 0 && n[b] <= 0) continue;
      const rate = (b >= 0 ? (a * n[b]) / N : a) * k[i] * Math.exp(-bar[i] * invT);
      cons[ra[i]] += rate;
      if (b >= 0) cons[b] += rate;
    }
    let dt = Infinity;
    for (let s = 0; s < NS; s++) if (cons[s] > 0) dt = Math.min(dt, (share * n[s]) / cons[s]);
    return dt;
  }

  /**
   * Hold f at temperature T and let it react until nothing changes, however long that takes in sim time. Each
   * step is as long as the kinetics allow (see stableDt), so slow reactions get there in a few dozen steps; ones
   * that can't happen at all (A = 0, like blue bonds forming or breaking) never do.
   */
  settle(f: Fluid, T: number, maxSteps = 10000): void {
    const before = new Float64Array(NS);
    for (let i = 0; i < maxSteps; i++) {
      f.Q = heatAt(T, f.N);
      const dt = this.stableDt(f, 0.3);
      if (!Number.isFinite(dt)) break;
      before.set(f.n);
      this.step(f, dt);
      let change = 0;
      for (let s = 0; s < NS; s++) change = Math.max(change, (Math.abs(f.n[s] - before[s]) * SPECIES[s].size) / f.N);
      if (change < 1e-11) break;
    }
    f.Q = heatAt(T, f.N);
  }

  /**
   * Advance a fluid by dt (explicit Euler, mass action on mole fractions).
   * Expected fluxes are scaled down where they would drive a species
   * negative, then each becomes a whole number of events by roundRandom.
   * Reaction heat goes into the fluid's heat, also in whole quanta. Cooling is
   * separate (see cool in game/flask.ts).
   */
  step(f: Fluid, dt: number): void {
    const N = f.N;
    if (N <= 0) return;
    const { n } = f;
    const { ra, rb, p1, p2, k, bar, dU, flux, cons, count } = this;
    const invT = 1 / Math.max(temperature(f), 0.05);

    for (let i = 0; i < count; i++) {
      const a = n[ra[i]];
      if (a <= 0) { flux[i] = 0; continue; }
      const b = rb[i];
      let ev: number;
      if (b >= 0) {
        const nb = n[b];
        if (nb <= 0) { flux[i] = 0; continue; }
        ev = (a * nb) / N;
      } else ev = a;
      flux[i] = ev * k[i] * Math.exp(-bar[i] * invT) * dt;
    }

    cons.fill(0);
    for (let i = 0; i < count; i++) {
      const v = flux[i];
      if (!v) continue;
      cons[ra[i]] += v;
      if (rb[i] >= 0) cons[rb[i]] += v;
    }
    for (let i = 0; i < count; i++) {
      const v = flux[i];
      if (!v) continue;
      let sc = 1;
      const ca = cons[ra[i]];
      if (ca > n[ra[i]]) sc = Math.min(sc, n[ra[i]] / ca);
      if (rb[i] >= 0) {
        const cb = cons[rb[i]];
        if (cb > n[rb[i]]) sc = Math.min(sc, n[rb[i]] / cb);
      }
      flux[i] = v * sc;
    }

    let heat = 0;
    for (let i = 0; i < count; i++) {
      if (!flux[i]) continue;
      // whole events, never more than the reactants left after the reactions before this one
      const a = ra[i];
      const b = rb[i];
      const v = Math.min(roundRandom(flux[i]), n[a], b >= 0 ? n[b] : Infinity);
      if (!v) continue;
      n[a] -= v;
      if (b >= 0) n[b] -= v;
      n[p1[i]] += v;
      if (p2[i] >= 0) n[p2[i]] += v;
      heat -= dU[i] * v;
    }
    f.Q = Math.max(0, f.Q + roundRandom(heat));
  }
}

/** Atom count per ATOMS entry. */
export function atomCounts(f: Fluid): number[] {
  const c = ATOMS.map(() => 0);
  for (let s = 0; s < NS; s++) {
    const v = f.n[s];
    if (v > 0) for (const ai of SPECIES[s].atomIdx) c[ai] += v;
  }
  return c;
}
