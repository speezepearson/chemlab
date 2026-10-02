import { describe, expect, it } from 'vitest';
import { T_ROOM } from '../chem/params';
import { testChemParams } from '../chem/testChem';
import { ReactionNetwork, atomCounts, heatAt, temperature, type Fluid } from '../chem/reactions';
import { equilibriumFluid } from '../chem/equilibrium';
import { NS, SPECIES, bondParam } from '../chem/species';
import { CAP } from './config';
import { Vessel } from './flask';
import { FAUCETS, describeFaucet, faucetOutput, faucetTarget } from './faucets';
import type { Mouth } from './tools';

describe('faucets', () => {
  const net = new ReactionNetwork(testChemParams());

  it('are the six atoms and the twelve pairs that can bond, once each', () => {
    const starts = FAUCETS.map((fa) => SPECIES[fa.start]);
    expect(new Set(starts).size).toBe(18);
    expect(starts.filter((s) => s.size === 1)).toHaveLength(6);
    expect(starts.filter((s) => s.size === 2)).toHaveLength(12);
  });

  for (const fa of FAUCETS) {
    describe(`${describeFaucet(fa)} faucet`, () => {
      const out = faucetOutput(fa, net);
      const T = fa.T ?? T_ROOM;
      const start = SPECIES[fa.start];

      it('outputs fluid at its temperature', () => {
        expect(temperature(out)).toBeCloseTo(T, 12);
      });

      it("outputs its start's atoms", () => {
        const total = atomCounts(out).reduce((t, v) => t + v, 0);
        expect(total).toBeCloseTo(out.N, 12);
        atomCounts(out).forEach((v, a) => expect(v).toBeCloseTo(start.atomIdx.includes(a) ? 1 / start.size : 0, 9));
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

      if (start.size === 2) {
        const [a, b] = start.atoms.filter((x) => x !== null);
        const frozen = bondParam(net.params, a!, b!).A === 0;
        it(frozen ? "stays whole, since its bond can't break" : 'settles to full equilibrium, since its bond can break', () => {
          const atoms = Object.fromEntries([a, b].map((x) => [x!, 0.5]));
          const full = equilibriumFluid(atoms, net.U, T);
          for (let s = 0; s < NS; s++) {
            const want = frozen ? (s === fa.start ? 0.5 : 0) : full.n[s];
            expect(out.n[s], SPECIES[s].name).toBeCloseTo(want, 6);
          }
        });
      }
    });
  }

  it('settles again when the chemistry changes', () => {
    const own = new ReactionNetwork(testChemParams());
    const cy = FAUCETS.find((fa) => describeFaucet(fa) === 'C–Y')!;
    const before = faucetOutput(cy, own).n[cy.start];
    expect(faucetOutput(cy, own).n[cy.start]).toBe(before); // cached
    own.params.bonds.CY.E *= 2;
    own.rebuild();
    expect(faucetOutput(cy, own).n[cy.start]).toBeGreaterThan(before);
  });
});

describe('faucetTarget', () => {
  const spout = { x: 100, y: 60 };
  const reach = 24;
  const mouth = (v: Vessel, y: number): Mouth => ({ v, x0: 80, x1: 120, y });

  it('fills something parked under it, in reach', () => {
    const tank = new Vessel(CAP);
    expect(faucetTarget([mouth(tank, 70)], spout, reach, new Set(), false)?.v).toBe(tank);
  });

  it('fills nothing out of reach, but keeps filling something full (which overflows)', () => {
    const tank = new Vessel(CAP);
    expect(faucetTarget([mouth(tank, 90)], spout, reach, new Set(), false)).toBeNull();
    tank.N = CAP;
    expect(faucetTarget([mouth(tank, 70)], spout, reach, new Set(), false)?.v).toBe(tank);
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
