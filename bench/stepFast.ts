/*
 * A prototype of ReactionNetwork.step with the same semantics (explicit Euler, fluxes scaled down where they'd drive a
 * species negative, whole events by random rounding), restructured for speed, to measure what micro-optimizing step
 * alone buys. Not wired into the game. It differs from step in the order random numbers are drawn, so results match
 * in distribution, not bit for bit.
 *
 * Changes: one pass computes fluxes, consumption and the heat estimate together; the scaling and the applying of
 * events are merged into a second pass (against a copy of the counts as the step began, as step's separate scaling
 * pass sees them); typed arrays are Int32; roundRandom is inlined.
 */
import { THERMO } from '../src/chem/params';
import { ReactionNetwork, temperature, type Fluid } from '../src/chem/reactions';
import { NS } from '../src/chem/species';

const n0 = new Float64Array(NS);

export function stepFast(net: ReactionNetwork, f: Fluid, dt: number): number {
  const N = f.N;
  if (N <= 0 || dt <= 0) return Infinity;
  const { n } = f;
  const p = net as any;
  const ra: Int16Array = p.ra;
  const rb: Int16Array = p.rb;
  const p1: Int16Array = p.p1;
  const p2: Int16Array = p.p2;
  const k: Float64Array = p.k;
  const barOf: Int32Array = p.barOf;
  const barList: Float64Array = p.barList;
  const boltz: Float64Array = p.boltz;
  const seen: Int32Array = p.seen;
  const dU: Float64Array = p.dU;
  const flux: Float64Array = p.flux;
  const cons: Float64Array = p.cons;
  const first: Int32Array = p.first;
  const active: Int32Array = p.active;
  const invT = 1 / Math.max(temperature(f), 0.05);
  const stamp = ++p.stamp;
  const invN = 1 / N;

  cons.fill(0);
  let na = 0;
  let barMax = 0;
  let warming = 0;
  for (let s = 0; s < NS; s++) {
    const a = n[s];
    n0[s] = a;
    if (a <= 0) continue;
    const end = first[s + 1];
    for (let i = first[s]; i < end; i++) {
      const ki = k[i];
      if (ki === 0) continue;
      const b = rb[i];
      let ev = a;
      if (b >= 0) {
        const nb = n[b];
        if (nb <= 0) continue;
        ev = a * nb * invN;
      }
      const j = barOf[i];
      if (seen[j] !== stamp) {
        seen[j] = stamp;
        boltz[j] = Math.exp(-barList[j] * invT);
        if (barList[j] > barMax) barMax = barList[j];
      }
      const v = ev * ki * boltz[j] * dt;
      flux[i] = v;
      active[na++] = i;
      cons[s] += v;
      if (b >= 0) cons[b] += v;
      warming -= dU[i] * v;
    }
  }
  p.barMax = barMax;
  let tau = (THERMO.heatCap * N) / (invT * invT * barMax * Math.abs(warming / dt));
  for (let s = 0; s < NS; s++) {
    const c = cons[s];
    if (c > 0) {
      const t = (n0[s] * dt) / c;
      if (t < tau) tau = t;
      // reuse cons as the scale for species s: 1, or what's there over what would be used
      cons[s] = c > n0[s] ? n0[s] / c : 1;
    }
  }
  let heat = 0;
  for (let m = 0; m < na; m++) {
    const i = active[m];
    const a = ra[i];
    const b = rb[i];
    let sc = cons[a];
    if (b >= 0 && cons[b] < sc) sc = cons[b];
    const x = flux[i] * sc;
    const lo = Math.floor(x);
    let v = lo + (Math.random() < x - lo ? 1 : 0);
    if (v > n[a]) v = n[a];
    if (b >= 0 && v > n[b]) v = n[b];
    if (v === 0) continue;
    n[a] -= v;
    if (b >= 0) n[b] -= v;
    n[p1[i]] += v;
    if (p2[i] >= 0) n[p2[i]] += v;
    heat -= dU[i] * v;
  }
  const hl = Math.floor(heat);
  f.Q = Math.max(0, f.Q + hl + (Math.random() < heat - hl ? 1 : 0));
  return tau;
}
