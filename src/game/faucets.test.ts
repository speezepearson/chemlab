import { describe, expect, it } from 'vitest';
import { defaultChemParams, T_ROOM } from '../chem/params';
import { ReactionNetwork, atomCounts, type Fluid } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
import { CAP } from './config';
import { FAUCETS, faucetOutput } from './faucets';

describe('faucets', () => {
  const net = new ReactionNetwork(defaultChemParams());

  for (const fa of FAUCETS) {
    describe(`${fa.name} faucet`, () => {
      const out = faucetOutput(fa, net.U);

      it('outputs fluid at room temperature', () => {
        expect(out.T).toBe(T_ROOM);
      });

      it(`outputs ${fa.name}'s atoms, in its proportions`, () => {
        const want = SPECIES.find((s) => s.name === fa.name)!;
        const total = atomCounts(out).reduce((t, v) => t + v, 0);
        expect(total).toBeCloseTo(out.N, 12);
        atomCounts(out).forEach((v, a) =>
          expect(v).toBeCloseTo(want.atomIdx.filter((x) => x === a).length / want.size, 12),
        );
      });

      it('outputs fluid in chemical equilibrium with itself', () => {
        const f: Fluid = { n: out.n.map((v) => v * CAP), N: CAP, T: out.T };
        const before = f.n.slice();
        for (let t = 0; t < 100; t += 0.02) net.step(f, 0.02);
        for (let s = 0; s < NS; s++) expect((f.n[s] - before[s]) / CAP, SPECIES[s].name).toBeCloseTo(0, 9);
        expect(f.T).toBeCloseTo(out.T, 9);
      });
    });
  }
});
