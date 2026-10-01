import { describe, expect, it } from 'vitest';
import { defaultChemParams, T_ROOM } from '../chem/params';
import { ReactionNetwork, atomCounts, heatAt, temperature, type Fluid } from '../chem/reactions';
import { ATOMS } from '../chem/atoms';
import { NS, SPECIES } from '../chem/species';
import { CAP } from './config';
import { Vessel } from './flask';
import { FAUCETS, describeFaucet, faucetOutput, faucetTarget } from './faucets';
import type { Mouth } from './tools';

describe('faucets', () => {
  const net = new ReactionNetwork(defaultChemParams());

  for (const fa of FAUCETS) {
    describe(`${describeFaucet(fa)} faucet`, () => {
      const out = faucetOutput(fa, net.U);
      const T = fa.T ?? T_ROOM;

      it('outputs fluid at its temperature', () => {
        expect(temperature(out)).toBeCloseTo(T, 12);
      });

      it('has a recipe that sums to 100%', () => {
        expect(Object.values(fa.atoms).reduce((t, v) => t + v, 0)).toBeCloseTo(1, 12);
      });

      it('outputs its recipe of atoms', () => {
        const total = atomCounts(out).reduce((t, v) => t + v, 0);
        expect(total).toBeCloseTo(out.N, 12);
        atomCounts(out).forEach((v, a) => expect(v).toBeCloseTo(fa.atoms[ATOMS[a]] ?? 0, 12));
      });

      it('outputs fluid in chemical equilibrium with itself', () => {
        // a flask's worth, in whole molecules
        const n = out.n.map((v) => Math.round(v * CAP));
        const N = SPECIES.reduce((t, s) => t + n[s.i] * s.size, 0);
        const f: Fluid = { n, N, Q: heatAt(T, N) };
        const before = f.n.slice();
        for (let t = 0; t < 100; t += 0.02) net.step(f, 0.02);
        // whole-molecule events jitter by about one per reaction per step, so allow parts per million
        for (let s = 0; s < NS; s++) expect((f.n[s] - before[s]) / CAP, SPECIES[s].name).toBeCloseTo(0, 5);
        expect(temperature(f) / T).toBeCloseTo(1, 5);
      });
    });
  }
});

describe('faucetTarget', () => {
  const spout = { x: 100, y: 60 };
  const reach = 24;
  const mouth = (v: Vessel, y: number): Mouth => ({ v, x0: 80, x1: 120, y });

  it('fills something parked under it, in reach', () => {
    const tank = new Vessel(CAP);
    expect(faucetTarget([mouth(tank, 70)], spout, reach, new Set(), false)?.v).toBe(tank);
  });

  it('fills nothing out of reach, or already full', () => {
    const tank = new Vessel(CAP);
    expect(faucetTarget([mouth(tank, 90)], spout, reach, new Set(), false)).toBeNull();
    tank.N = CAP;
    expect(faucetTarget([mouth(tank, 70)], spout, reach, new Set(), false)).toBeNull();
  });

  it("passes by anything carried unless the right button is held, whether it's a flask, a tank or a funnel", () => {
    for (const cap of [CAP, 4 * CAP, CAP / 4]) {
      const carried = new Vessel(cap);
      const mouths = [mouth(carried, 70)];
      expect(faucetTarget(mouths, spout, reach, new Set([carried]), false)).toBeNull();
      expect(faucetTarget(mouths, spout, reach, new Set([carried]), true)?.v).toBe(carried);
    }
  });

  it('fills what is parked below something carried, if that is in reach', () => {
    const carried = new Vessel(4 * CAP);
    const below = new Vessel(CAP);
    const mouths = [mouth(carried, 70), mouth(below, 80)];
    expect(faucetTarget(mouths, spout, reach, new Set([carried]), false)?.v).toBe(below);
    expect(faucetTarget(mouths, spout, reach, new Set([carried]), true)?.v).toBe(carried);
  });
});
