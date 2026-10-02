import { CHARACTER, CHAR_DIMS, MIXING, SPECIES_MASS, massOf } from '../chem/mixing';
import { roundRandom, type Fluid } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
import { roomFor, volume } from './volume';

/**
 * How many layers a vessel's contents are kept in. Each layer is a well-mixed parcel of fluid, and layers vary
 * in size: draining one end shrinks the layer there, and fluid landing in a vessel arrives as a layer of its own.
 */
export const LAYERS = 8;

/** One layer of a vessel: whole molecule counts, and how hard it's being stirred, per sim second. */
export interface Layer extends Fluid {
  stir: number;
}

/** Where fluid leaves a vessel: off the top (pouring, spilling), out the bottom (a valve), or evenly from all of it. */
export type End = 'top' | 'bottom' | 'all';

export function emptyLayer(stir = 0): Layer {
  return { n: new Float64Array(NS), N: 0, Q: 0, stir };
}

/** A layer holding a copy of f's molecules. */
export function layerOf(f: Fluid, stir = 0): Layer {
  return { n: Float64Array.from(f.n), N: f.N, Q: 0, stir };
}

/** Add m (possibly negative) molecules of species s to a fluid, keeping its atom count. */
function add(f: Fluid, s: number, m: number): void {
  f.n[s] += m;
  f.N += m * SPECIES[s].size;
}

/** A species' density: its mass per unit of volume. */
const rho = (s: number) => SPECIES_MASS[s] / roomFor(s);

/** A fluid's density: its mass per unit of volume; 0 if it's empty. */
export function density(f: Fluid): number {
  const v = volume(f);
  return v > 0 ? massOf(f) / v : 0;
}

/** A fluid's volume, counting only the species in sp (which must be all it holds). */
function volumeIn(f: Fluid, sp: readonly number[]): number {
  let v = 0;
  for (const s of sp) v += f.n[s] * roomFor(s);
  return v;
}

/** density, counting only the species in sp (which must be all it holds). */
function densityIn(f: Fluid, sp: readonly number[]): number {
  let v = 0;
  let m = 0;
  for (const s of sp) {
    v += f.n[s] * roomFor(s);
    m += f.n[s] * SPECIES_MASS[s];
  }
  return v > 0 ? m / v : 0;
}

/** The species present in any of the layers. */
export function present(f: Fluid): number[] {
  const out: number[] = [];
  for (let s = 0; s < NS; s++) if (f.n[s] > 0) out.push(s);
  return out;
}

/** The share of f's volume each species takes up, into out. */
function fractions(f: Fluid, out: Float64Array): Float64Array {
  const v = volume(f);
  for (let s = 0; s < NS; s++) out[s] = v > 0 ? (f.n[s] * roomFor(s)) / v : 0;
  return out;
}

/**
 * Add d whole molecules of species s across layers, in total exactly d: if d < 0, taken from each in proportion
 * to how many it has (d can't be more than they hold); otherwise added in proportion to each layer's volume.
 */
export function spread(layers: readonly Layer[], s: number, d: number): void {
  if (!d || !layers.length) return;
  if (d < 0) {
    let rem = -d;
    let total = 0;
    for (const l of layers) total += l.n[s];
    for (const l of layers) {
      const has = l.n[s];
      if (rem <= 0) break;
      if (!has) continue;
      const rest = total - has;
      // never leave more to take than the layers after this one hold
      const m = Math.min(has, Math.max(rem - rest, roundRandom((rem * has) / total)));
      add(l, s, -m);
      rem -= m;
      total = rest;
    }
    return;
  }
  const vols = layers.map(volume);
  let total = vols.reduce((a, b) => a + b, 0);
  let rem = d;
  layers.forEach((l, i) => {
    const m = i === layers.length - 1 ? rem : total > 0 ? Math.min(rem, roundRandom((rem * vols[i]) / total)) : 0;
    add(l, s, m);
    rem -= m;
    total -= vols[i];
  });
}

/** Two layers as one, stirred as hard as their volume-weighted average. */
function merge(a: Layer, b: Layer): Layer {
  const va = volume(a);
  const vb = volume(b);
  const out = layerOf(a, va + vb > 0 ? (a.stir * va + b.stir * vb) / (va + vb) : 0);
  for (let s = 0; s < NS; s++) if (b.n[s]) add(out, s, b.n[s]);
  return out;
}

/** A layer cut into two halves (in whole molecules, so about even), the lower first. */
function split(l: Layer): [Layer, Layer] {
  const lo = emptyLayer(l.stir);
  const hi = emptyLayer(l.stir);
  for (let s = 0; s < NS; s++) {
    if (!l.n[s]) continue;
    const m = roundRandom(l.n[s] / 2);
    add(lo, s, m);
    add(hi, s, l.n[s] - m);
  }
  return [lo, hi];
}

const fa = new Float64Array(NS);
const fb = new Float64Array(NS);

/**
 * What merging two layers loses: how much their compositions differ, squared, weighted by their volumes as
 * Ward's method weighs it, so near-identical layers and slivers merge first, and a distinct layer is kept.
 */
function mergeCost(a: Layer, b: Layer): number {
  const va = volume(a);
  const vb = volume(b);
  if (va <= 0 || vb <= 0) return 0;
  fractions(a, fa);
  fractions(b, fb);
  let d = 0;
  for (let s = 0; s < NS; s++) d += (fa[s] - fb[s]) ** 2;
  return (d * va * vb) / (va + vb);
}

/**
 * The layers, bottom to top, brought back to LAYERS of them without moving anything: empty ones dropped, the
 * cheapest neighboring pairs merged (see mergeCost), and the largest split in half while there are too few.
 */
export function normalize(layers: readonly Layer[]): Layer[] {
  const out = layers.filter((l) => l.N > 0);
  while (out.length > LAYERS) {
    let best = 0;
    let cost = Infinity;
    for (let i = 0; i + 1 < out.length; i++) {
      const c = mergeCost(out[i], out[i + 1]);
      if (c < cost) [best, cost] = [i, c];
    }
    out.splice(best, 2, merge(out[best], out[best + 1]));
  }
  while (out.length && out.length < LAYERS) {
    let j = 0;
    for (let i = 1; i < out.length; i++) if (volume(out[i]) > volume(out[j])) j = i;
    if (volume(out[j]) < 2) break;
    const halves = split(out[j]);
    if (!halves[0].N || !halves[1].N) break;
    out.splice(j, 1, ...halves);
  }
  return out;
}

const mean = new Float64Array(CHAR_DIMS);

/**
 * Each species' escaping tendency from fluid f at temperature T, as a log, into out (see MIXING): its room times
 * its weighted squared mismatch with f's mean character, over T. Only the species in sp, which must be all f
 * holds, are set.
 */
export function escape(f: Fluid, sp: readonly number[], T: number, out: Float64Array): Float64Array {
  const v = volumeIn(f, sp);
  mean.fill(0);
  if (v <= 0) return out;
  for (const s of sp) {
    const phi = (f.n[s] * roomFor(s)) / v;
    for (let k = 0; k < CHAR_DIMS; k++) mean[k] += phi * CHARACTER[s * CHAR_DIMS + k];
  }
  const invT = 1 / Math.max(T, 0.05);
  for (const s of sp) {
    let c = 0;
    for (let k = 0; k < 3; k++) c += (CHARACTER[s * CHAR_DIMS + k] - mean[k]) ** 2;
    const o = (CHARACTER[s * CHAR_DIMS + 3] - mean[3]) ** 2;
    out[s] = roomFor(s) * (MIXING.color * c + MIXING.open * o) * invT;
  }
  return out;
}

/**
 * For each species of sp in f, its weight for leaving toward the top (dir 1) or the bottom (−1), given its
 * escaping tendency g (see escape), into out, scaled so the largest is 1. Returns the volume-weighted total of
 * n × weight.
 */
function leaving(f: Fluid, sp: readonly number[], g: Float64Array, dir: 1 | -1, out: Float64Array): number {
  let max = -Infinity;
  for (const s of sp) if (f.n[s]) max = Math.max(max, g[s] - dir * MIXING.gravity * rho(s));
  let z = 0;
  for (const s of sp) {
    if (!f.n[s]) continue;
    out[s] = Math.exp(g[s] - dir * MIXING.gravity * rho(s) - max);
    z += f.n[s] * roomFor(s) * out[s];
  }
  return z;
}

const gl = new Float64Array(NS);
const gu = new Float64Array(NS);
const up = new Float64Array(NS);
const down = new Float64Array(NS);

/**
 * Let two neighboring layers trade equal volumes of fluid for h sim seconds, each sending more of what's least
 * at home in it (see escape) and, slightly, the lighter species up and the heavier down. At equilibrium every
 * species is equally at ease in both, so miscible fluids even out and immiscible ones unmix. sp must hold every
 * species in either layer.
 */
export function exchange(lower: Layer, upper: Layer, sp: readonly number[], T: number, h: number): void {
  const vl = volumeIn(lower, sp);
  const vu = volumeIn(upper, sp);
  if (vl <= 0 || vu <= 0) return;
  const zl = leaving(lower, sp, escape(lower, sp, T, gl), 1, up);
  const zu = leaving(upper, sp, escape(upper, sp, T, gu), -1, down);
  // no species gives up more than half of what it has in one step
  const X = Math.min(MIXING.rate * h * Math.min(vl, vu), 0.5 * zl, 0.5 * zu);
  if (!(X > 0)) return;
  for (const s of sp) {
    const a = lower.n[s] ? Math.min(lower.n[s], roundRandom((X * lower.n[s] * up[s]) / zl)) : 0;
    const b = upper.n[s] ? Math.min(upper.n[s], roundRandom((X * upper.n[s] * down[s]) / zu)) : 0;
    if (a === b) continue;
    add(lower, s, b - a);
    add(upper, s, a - b);
  }
}

/**
 * Let any layer that's denser than the one below it sink, all the way down if need be, in place. sp must hold
 * every species in the layers.
 */
export function overturn(layers: Layer[], sp: readonly number[]): void {
  const d = layers.map((l) => densityIn(l, sp));
  for (let i = layers.length - 2; i >= 0; i--)
    for (let j = i; j < layers.length - 1 && d[j + 1] > d[j]; j++) {
      // the heavier one swaps down past the lighter
      [layers[j], layers[j + 1]] = [layers[j + 1], layers[j]];
      [d[j], d[j + 1]] = [d[j + 1], d[j]];
    }
}

/**
 * Stir the layers for h sim seconds, in place: each stirred layer trades a share 1 − e^(−stir · h) of itself with
 * a pool drawn from every stirred layer, so the stirred ones mix with each other and the still ones are left
 * alone. Then the stirring dies down (see MIXING.calm). sp must hold every species in the layers.
 */
export function churn(layers: readonly Layer[], sp: readonly number[], h: number): void {
  const k = Math.exp(-h / Math.max(MIXING.calm, 1e-6));
  const stirred = layers.filter((l) => l.stir > 1e-3 && l.N > 0);
  for (const l of layers) l.stir = l.stir > 1e-3 ? l.stir * k : 0;
  if (stirred.length < 2) return;
  const pool = emptyLayer();
  const took = stirred.map((l) => {
    const f = 1 - Math.exp(-l.stir * h);
    let v = 0;
    for (const s of sp) {
      if (!l.n[s]) continue;
      const m = Math.min(l.n[s], roundRandom(l.n[s] * f));
      add(l, s, -m);
      add(pool, s, m);
      v += m * roomFor(s);
    }
    return v;
  });
  // back out in the same volumes, the last taking whatever's left
  let left = took.reduce((a, b) => a + b, 0);
  stirred.forEach((l, i) => {
    const last = i === stirred.length - 1;
    for (const s of sp) {
      if (!pool.n[s]) continue;
      const m = last ? pool.n[s] : left > 0 ? Math.min(pool.n[s], roundRandom((pool.n[s] * took[i]) / left)) : 0;
      add(pool, s, -m);
      add(l, s, m);
    }
    left -= took[i];
  });
}

/**
 * A packet of fluid landing on the layers (bottom to top): it sinks through every layer lighter than itself,
 * stirring each in proportion to its volume over theirs (see MIXING.churn), as well as the one it comes to rest
 * on, and settles there as a new layer. Returns the new layers, normalized.
 */
export function plunge(layers: readonly Layer[], packet: Fluid): Layer[] {
  const out = layers.slice();
  const v = volume(packet);
  const d = density(packet);
  let k = out.length;
  while (k > 0 && density(out[k - 1]) < d) k--;
  for (let i = Math.max(0, k - 1); i < out.length; i++) {
    const vi = volume(out[i]);
    if (vi > 0) out[i].stir += (MIXING.churn * v) / vi;
  }
  out.splice(k, 0, layerOf(packet, MIXING.churn));
  return normalize(out);
}

/**
 * Move about `amount` of volume from the layers (bottom to top) of `from` into `into`, in whole molecules: off
 * the top, out of the bottom, or evenly from every layer. Both fluids' counts are kept up to date; heat isn't
 * touched. Returns the atoms moved.
 */
export function drain(
  from: Fluid & { layers: Layer[] }, into: Fluid | null, amount: number, end: End,
): number {
  let moved = 0;
  const take = (l: Layer, f: number) => {
    for (let s = 0; s < NS; s++) {
      if (!l.n[s]) continue;
      const m = f >= 1 ? l.n[s] : Math.min(l.n[s], roundRandom(l.n[s] * f));
      if (!m) continue;
      add(l, s, -m);
      add(from, s, -m);
      if (into) add(into, s, m);
      moved += m * SPECIES[s].size;
    }
  };
  if (end === 'all') {
    // rounded per species, as from an unlayered fluid, then taken from the layers in proportion
    const v = volume(from);
    for (let s = 0; s < NS; s++) {
      const m = v > 0 && from.n[s] ? Math.min(from.n[s], roundRandom((from.n[s] * amount) / v)) : 0;
      if (!m) continue;
      spread(from.layers, s, -m);
      add(from, s, -m);
      if (into) add(into, s, m);
      moved += m * SPECIES[s].size;
    }
  } else {
    const order = end === 'top' ? from.layers.slice().reverse() : from.layers;
    let rem = amount;
    for (const l of order) {
      if (rem <= 0) break;
      const v = volume(l);
      if (v <= 0) continue;
      take(l, rem / v);
      rem -= v;
    }
  }
  from.layers = normalize(from.layers);
  return moved;
}

/**
 * The layers (bottom to top) in runs of neighbors similar enough to react as one fluid: no species' share of a
 * layer differs from its share of the run's first layer by more than 5 points.
 */
export function runs(layers: readonly Layer[]): Layer[][] {
  const out: Layer[][] = [];
  for (const l of layers) {
    const run = out[out.length - 1];
    if (run) {
      fractions(run[0], fa);
      fractions(l, fb);
      let d = 0;
      for (let s = 0; s < NS; s++) d = Math.max(d, Math.abs(fa[s] - fb[s]));
      if (d <= 0.05) {
        run.push(l);
        continue;
      }
    }
    out.push([l]);
  }
  return out;
}
