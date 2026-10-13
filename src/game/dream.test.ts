import { describe, expect, it } from 'vitest';
import { Lag, ReactionNetwork, heatAt, type Fluid } from '../chem/reactions';
import { NS, SPECIES, TARGET, singleOf } from '../chem/species';
import { testChemParams } from '../chem/testChem';
import { CAP, FILL_RATE } from './config';
import { DREAM, Dream } from './dream';
import { Vessel, transfer, volume } from './flask';
import { REFERENCE_START, Tool, drip } from './tools';

const H = 0.02;

/**
 * A lab without the engine, for a fixed line: unlimited sources pouring into tanks, tools whose spouts each pour into a
 * vessel (or the sink), and the cryostabilizer station; stepped in the engine's order (see GameEngine.simulate), with
 * the ship's checks first in every substep, as stepWake makes them.
 */
class Lab {
  chem = new ReactionNetwork(testChemParams());
  lags = new Map<Vessel, Lag>();
  clock = 0;
  substeps = 0;
  sources: { fluid: Fluid; rate: number; into: Vessel }[] = [];
  tools: { t: Tool; to: (Vessel | null)[] }[] = [];
  station = new Tool('receptacle', 99);

  constructor() {
    const ref = this.ref;
    ref.setMolecules(TARGET, REFERENCE_START);
    ref.setTemperature(1);
    this.tools.push({ t: this.station, to: [null, null] });
  }

  get ref(): Vessel {
    return this.station.tanks[1];
  }

  vessels(): Vessel[] {
    return this.tools.flatMap(({ t }) => t.tanks);
  }

  fill(v: Vessel, src: Fluid, amount = volume(src)): void {
    v.addFrom(src, amount, true);
    this.overflow(v);
  }

  /** What doesn't fit spills to the sink. */
  overflow(v: Vessel): void {
    const over = volume(v) - v.cap;
    if (over > 0) transfer(v, null, over);
  }

  /** One substep; 'win' or 'wake' if the ship's checks end the sleep before it. */
  step(goal: number, checks = true): 'win' | 'wake' | null {
    if (checks && this.ref.n[TARGET] >= goal) return 'win';
    if (checks && !this.station.supply!.keepingUp) return 'wake';
    for (const s of this.sources) this.fill(s.into, s.fluid, s.rate * H);
    for (const { t, to } of this.tools)
      t.step(H).forEach((out, k) => {
        const down = drip(t.drops[k], out, H);
        if (down && to[k]) this.fill(to[k]!, down);
      });
    for (const v of this.vessels()) {
      let lag = this.lags.get(v);
      if (!lag) this.lags.set(v, (lag = new Lag()));
      this.chem.tick(v, H, lag);
      this.overflow(v);
    }
    this.clock += H;
    this.substeps++;
    return null;
  }

  /** Run until the supply keeps up, as it must for the player to have gone to sleep. */
  warm(): void {
    for (let i = 0; i < 120 / H && !this.station.supply!.keepingUp; i++) this.step(Infinity, false);
    expect(this.station.supply!.keepingUp).toBe(true);
  }

  /** Sleep to the end, simulating every substep, or fast-forwarding with a Dream. */
  sleep(goal: number, dream: boolean): { end: 'win' | 'wake'; t: number; skipped: number } {
    this.warm();
    const t0 = this.clock;
    const turnover = this.tools.flatMap(({ t }) => t.tanks.map((_, k) => t.turnover(k)));
    const d = dream ? new Dream(this.vessels(), turnover, this.ref, goal) : null;
    for (;;) {
      const held = this.ref.n[TARGET];
      const end = this.step(goal);
      if (end) return { end, t: this.clock - t0, skipped: d?.skipped ?? 0 };
      const J = d?.after(H, this.ref.n[TARGET] > held) ?? 0;
      if (J) {
        this.clock += J;
        this.station.supply!.skip(J);
      }
    }
  }
}

const pure = (s: number): Fluid => {
  const n = new Float64Array(NS);
  n[s] = 1 / SPECIES[s].size;
  return { n, N: 1, Q: heatAt(1, 1) };
};

/** An unlimited source of the target, into a dispenser that overflows, through a splitter, half into the station. */
function faucetLine(): Lab {
  const lab = new Lab();
  const d = new Tool('dispenser', 1, undefined, [0.004]);
  const sp = new Tool('splitter', 2, undefined, [0.5]);
  lab.sources.push({ fluid: pure(TARGET), rate: FILL_RATE, into: d.tanks[0] });
  lab.tools.unshift({ t: d, to: [sp.tanks[0]] }, { t: sp, to: [lab.station.tanks[0], null] });
  return lab;
}

/** A big tank of the target draining by its valve into the station, until it's too low to keep the supply up. */
function tankLine(): Lab {
  const lab = new Lab();
  const tk = new Tool('tank', 1, undefined, [0.4]);
  tk.tanks[0].setMolecules(TARGET, 30 * CAP);
  tk.tanks[0].setTemperature(1);
  lab.tools.unshift({ t: tk, to: [lab.station.tanks[0]] });
  return lab;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('dream', () => {
  it('jumps a steady lab on, at the rate the reference fills, longer each time up to its longest', () => {
    const still = new Vessel(CAP);
    still.setMolecules(singleOf('R'), 0.5 * CAP);
    const ref = new Vessel(Infinity);
    const per = 1e6;
    const d = new Dream([still, ref], [Infinity, Infinity], ref, 1e18);
    const lengths: number[] = [];
    for (let i = 0; i < 300 / H; i++) {
      ref.setMolecules(TARGET, ref.n[TARGET] + per);
      const J = d.after(H, true);
      if (J) lengths.push(J);
    }
    expect(lengths.length).toBeGreaterThan(3);
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1]);
    expect(lengths[lengths.length - 1]).toBe(DREAM.most);
    // all of it at the rate measured, simulated and skipped alike
    expect(ref.n[TARGET] / (d.t * (per / H))).toBeCloseTo(1, 3);
    expect(still.n[singleOf('R')]).toBe(0.5 * CAP);
  });

  it('never jumps past a burst short of the goal', () => {
    const ref = new Vessel(Infinity);
    const per = 1e6;
    const goal = 5e10;
    const d = new Dream([ref], [Infinity], ref, goal);
    while (ref.n[TARGET] + per <= goal) {
      ref.setMolecules(TARGET, ref.n[TARGET] + per);
      if (d.after(H, true)) expect(goal - ref.n[TARGET]).toBeGreaterThan((DREAM.heal + 2 * DREAM.later) * (per / H) * 0.9);
    }
    expect(d.jumps).toBeGreaterThan(0);
  });

  it("doesn't jump while the waits between deliveries come anywhere near waking the player", () => {
    const ref = new Vessel(Infinity);
    const d = new Dream([ref], [Infinity], ref, Infinity);
    const every = Math.round((DREAM.gap + 0.1) / H);
    for (let i = 0; i < 5000 / H; i++) {
      const on = i % every === 0;
      if (on) ref.setMolecules(TARGET, ref.n[TARGET] + 1e6);
      expect(d.after(H, on)).toBe(0);
    }
  });

  it("doesn't empty a draining vessel in a jump", () => {
    const tank = new Vessel(Infinity);
    const s = singleOf('G');
    tank.setMolecules(s, 1e9);
    const ref = new Vessel(Infinity);
    const d = new Dream([tank, ref], [Infinity, Infinity], ref, Infinity);
    for (let i = 0; i < 20000 / H && tank.n[s] > 1e7; i++) {
      // drains in proportion to what's left, as a valve does, all of it into the reference
      const out = Math.round(tank.n[s] * 1e-3 * H);
      const was = tank.n[s];
      tank.setMolecules(s, was - out);
      ref.setMolecules(TARGET, ref.n[TARGET] + out);
      if (d.after(H, true)) expect(tank.n[s]).toBeGreaterThan(0.25 * was);
    }
    expect(d.jumps).toBeGreaterThan(0);
  });

  it('wins on a faucet-fed line as a full sleep does, about as soon, with a fraction of the substeps', () => {
    const goal = REFERENCE_START + 1.5 * CAP;
    const full = [0, 1].map(() => {
      const lab = faucetLine();
      return { ...lab.sleep(goal, false), substeps: lab.substeps };
    });
    const fast = [0, 1].map(() => {
      const lab = faucetLine();
      return { ...lab.sleep(goal, true), substeps: lab.substeps };
    });
    for (const r of [...full, ...fast]) expect(r.end).toBe('win');
    expect(Math.abs(mean(fast.map((r) => r.t)) / mean(full.map((r) => r.t)) - 1)).toBeLessThan(0.03);
    expect(mean(fast.map((r) => r.substeps))).toBeLessThan(mean(full.map((r) => r.substeps)) / 4);
  }, 120_000);

  it('wakes as a tank-fed line runs low about when a full sleep does', () => {
    const full = [0, 1].map(() => tankLine().sleep(Infinity, false));
    const fast = [0, 1].map(() => tankLine().sleep(Infinity, true));
    for (const r of [...full, ...fast]) expect(r.end).toBe('wake');
    expect(Math.abs(mean(fast.map((r) => r.t)) / mean(full.map((r) => r.t)) - 1)).toBeLessThan(0.03);
  }, 120_000);
});
