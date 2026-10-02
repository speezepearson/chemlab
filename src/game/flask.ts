import { ATOMS, ATOM_RGB } from '../chem/atoms';
import { THERMO, T_ROOM } from '../chem/params';
import { heatAt, roundRandom, temperature, type Fluid, type ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { CAP, GOAL_PURITY, TRACE } from './config';
import { GLASS_GRAMS } from './scale';
import {
  churn, drain, exchange, layerOf, normalize, overturn, plunge, present, runs, spread, type End, type Layer,
} from './layers';
import { roomFor, volume } from './volume';
import { LOOK, css, glowWhiteHeat, heatValue, whiteHeat, whiten, type RGB } from './appearance';

export interface Point {
  x: number;
  y: number;
}

export { VOLUME, roomFor, volume, volumeUnit } from './volume';

/**
 * A container of fluid with a fixed capacity, by volume (see VOLUME). Its counts and heat are always whole numbers.
 *
 * A vessel with a finite capacity is layered: its contents are kept as a stack of layers (see layers.ts), which
 * separate by miscibility and density while it stands, and it can be drained from the top or the bottom. The
 * counts (n, N) are the totals, and they're what's authoritative: anything that sets them directly leaves the
 * layers to catch up, with the change spread evenly through them, the next time they're used. Heat is kept for
 * the whole vessel, which is at one temperature throughout.
 */
export class Vessel implements Fluid {
  n = new Float64Array(NS);
  N = 0;
  Q = 0;
  /** The layers, bottom to top; empty when the vessel is, or isn't layered. See strata. */
  layers: Layer[] = [];
  /** Whether a mixer keeps it fully stirred, so it never separates. */
  stirred = false;

  constructor(
    readonly cap: number,
    public label = '',
    /** Whether it keeps layers: by default, if it has a finite capacity. Packets of fluid in flight don't. */
    readonly layered = Number.isFinite(cap),
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
   * added, unless `overfill`, which leaves it to the caller to deal with the excess. In a layered vessel it
   * lands as a packet (see receive).
   */
  addFrom(src: Fluid, amount: number, overfill = false): number {
    if (!overfill) amount = Math.min(amount, this.cap - volume(this));
    const vs = volume(src);
    if (amount <= 0 || vs <= 0) return 0;
    if (this.layered) {
      const p = new Vessel(Infinity);
      const added = p.addFrom(src, amount, true);
      this.receive(p);
      return added;
    }
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

  /**
   * Take in all of a packet of fluid, heat and all, without depleting it. In a layered vessel it sinks through
   * whatever's lighter than itself, stirring it, and comes to rest as a layer of its own (see plunge).
   */
  receive(p: Fluid): void {
    if (p.N <= 0) return;
    this.reconcile();
    for (let s = 0; s < NS; s++) this.n[s] += p.n[s];
    this.N += p.N;
    this.Q += p.Q;
    if (this.layered) this.layers = plunge(this.layers, p);
  }

  /** Stir every layer by `stir` more (per sim second), as when the vessel is jostled. */
  slosh(stir: number): void {
    this.reconcile();
    for (const l of this.layers) l.stir += stir;
  }

  /** Forget the layers, so the contents count as evenly mixed (after replacing them wholesale). */
  remix(): void {
    this.layers = [];
  }

  /**
   * Bring the layers in line with the totals: whatever was set directly since they were last used is spread
   * through them (see spread), evenly by volume if added, in proportion if taken away.
   */
  private reconcile(): void {
    if (!this.layered) return;
    if (this.N <= 0) {
      this.layers = [];
      return;
    }
    if (!this.layers.length) {
      this.layers = normalize([layerOf(this)]);
      return;
    }
    let changed = false;
    for (let s = 0; s < NS; s++) {
      let sum = 0;
      for (const l of this.layers) sum += l.n[s];
      if (sum === this.n[s]) continue;
      spread(this.layers, s, this.n[s] - sum);
      changed = true;
    }
    if (changed) this.layers = normalize(this.layers);
  }

  /** The layers, bottom to top, up to date, each with its share of the heat (so at the vessel's temperature). */
  strata(): readonly Layer[] {
    this.reconcile();
    for (const l of this.layers) l.Q = this.N > 0 ? (this.Q * l.N) / this.N : 0;
    return this.layers;
  }

  /**
   * Move about `amount` (by volume) of the contents into `into`, from `end`, keeping the counts; heat is left to
   * the caller. Returns the atoms moved.
   */
  drawOff(into: Fluid | null, amount: number, end: End): number {
    this.reconcile();
    return drain(this, into, amount, end);
  }

  /**
   * React for h sim seconds. Each run of similar layers (see runs) reacts as one fluid, so fluids that have
   * separated only react where they meet, as they trade molecules.
   */
  react(net: ReactionNetwork, h: number): void {
    if (this.N <= 0) return;
    this.reconcile();
    const groups = this.layered ? runs(this.layers) : [];
    if (groups.length <= 1) {
      net.step(this, h); // the layers catch up when next used
      return;
    }
    const T = temperature(this);
    let heat = 0;
    for (const g of groups) {
      const f: Fluid = layerOf(g[0]);
      for (const l of g.slice(1)) {
        for (let s = 0; s < NS; s++) f.n[s] += l.n[s];
        f.N += l.N;
      }
      const before = Float64Array.from(f.n);
      f.Q = T * THERMO.heatCap * f.N;
      const q = f.Q;
      net.step(f, h);
      heat += f.Q - q;
      for (let s = 0; s < NS; s++) {
        const d = f.n[s] - before[s];
        if (!d) continue;
        spread(g, s, d);
        this.n[s] += d;
        this.N += d * SPECIES[s].size;
      }
    }
    this.Q = Math.max(0, this.Q + Math.round(heat));
    this.layers = normalize(this.layers);
  }

  /**
   * Let the layers settle for h sim seconds: stirring mixes what it reaches and dies down, neighbors trade
   * molecules toward equilibrium (see exchange), and anything denser than what's below it sinks. A stirred
   * vessel (see stirred) is just kept evenly mixed.
   */
  settle(h: number): void {
    if (!this.layered || this.N <= 0) return;
    this.reconcile();
    if (this.stirred) {
      this.layers = [layerOf(this)];
      return;
    }
    const L = this.layers;
    const sp = present(this);
    // a single species has nothing to separate from
    if (L.length < 2 || sp.length < 2) return;
    churn(L, sp, h);
    const T = temperature(this);
    for (let i = 0; i + 1 < L.length; i++) exchange(L[i], L[i + 1], sp, T, h);
    overturn(L, sp);
  }
}

/**
 * How fluids cool (or warm) toward the ship's air, editable from the Physics panel:
 * - ambient: the air's temperature;
 * - tau: sim seconds for a full flask of single atoms to get a factor e closer to it.
 */
export const COOLING = { ambient: T_ROOM, tau: 60 };
const DEFAULT_COOLING = { ...COOLING };

export function restoreDefaultCooling(): void {
  Object.assign(COOLING, DEFAULT_COOLING);
}

/**
 * Newton's law of cooling, for h sim seconds: heat leaves for the air (or comes in from it) in proportion to the
 * fluid's surface area and its difference from COOLING.ambient. The area goes as volume^⅔, as for any vessel of a
 * given shape, and the heat it holds as its atoms, so a vessel's time constant is tau · (atoms / CAP) /
 * (volume / CAP)^⅔: a fuller vessel takes longer, and so does fluid of bigger molecules, more atoms to a volume.
 * The heat goes to the air, which holds so much that its temperature never changes. One temperature per vessel:
 * its layers are thin, touching and stirred by whatever lands, so they share heat much faster than the walls lose it.
 */
export function cool(v: Fluid, h: number): void {
  const vol = volume(v);
  if (v.N <= 0 || vol <= 0 || !(COOLING.tau > 0)) return;
  const tau = (COOLING.tau * (v.N / CAP)) / Math.cbrt(vol / CAP) ** 2;
  const target = COOLING.ambient * THERMO.heatCap * v.N;
  v.Q = Math.max(0, v.Q - roundRandom((v.Q - target) * (1 - Math.exp(-h / tau))));
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
 * the sink if dst is null), with heat in proportion; returns the atoms actually moved. A layered src gives it up
 * from `end`: the top, the bottom, or evenly from every layer. A layered dst takes it in as a packet (see
 * Vessel.receive).
 */
export function transfer(src: Fluid, dst: (Fluid & { cap: number }) | null, amount: number, end: End = 'all'): number {
  const vs = volume(src);
  amount = Math.min(amount, vs, dst ? dst.cap - volume(dst) : Infinity);
  if (amount <= 0) return 0;
  const packet = dst instanceof Vessel && dst.layered ? new Vessel(Infinity) : null;
  const into = packet ?? dst;
  const N0 = src.N;
  let moved = 0;
  if (src instanceof Vessel && src.layered) moved = src.drawOff(into, amount, end);
  else {
    const f = amount / vs;
    for (let s = 0; s < NS; s++) {
      const m = Math.min(src.n[s], roundRandom(src.n[s] * f));
      if (!m) continue;
      src.n[s] -= m;
      if (into) into.n[s] += m;
      moved += m * SPECIES[s].size;
    }
    src.N -= moved;
    if (into) into.N += moved;
  }
  const q = moved >= N0 ? src.Q : Math.min(src.Q, roundRandom((src.Q * moved) / N0));
  src.Q -= q;
  if (into) into.Q += q;
  if (packet) (dst as Vessel).receive(packet);
  if (src.N < TRACE) {
    src.N = 0;
    src.n.fill(0);
    src.Q = 0;
    if (src instanceof Vessel) src.remix();
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
