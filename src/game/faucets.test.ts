import { describe, expect, it } from 'vitest';
import { defaultChemParams, T_ROOM } from '../chem/params';
import { ReactionNetwork, atomCounts, heatAt, temperature, type Fluid } from '../chem/reactions';
import { ATOMS } from '../chem/atoms';
import { NS, SPECIES } from '../chem/species';
import { CAP } from './config';
import { FAUCETS, describeFaucet, faucetOutput } from './faucets';

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
