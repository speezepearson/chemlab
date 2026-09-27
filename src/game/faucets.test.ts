import { describe, expect, it } from 'vitest';
import { defaultChemParams, T_ROOM } from '../chem/params';
import { ReactionNetwork, type Fluid } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';
import { CAP } from './config';
import { FAUCETS, faucetOutput } from './faucets';

describe('faucets', () => {
  const net = new ReactionNetwork(defaultChemParams());

  for (const fa of FAUCETS) {
    const name = SPECIES.find((s) => faucetOutput(fa).n[s.i] > 0)?.name ?? '?';

    describe(`${fa.atom} faucet`, () => {
      it('outputs fluid at room temperature', () => {
        expect(faucetOutput(fa).T).toBe(T_ROOM);
      });

      it(`outputs fluid (${name}…) in chemical equilibrium with itself`, () => {
        const out = faucetOutput(fa);
        const scale = CAP / out.N;
        const f: Fluid = { n: out.n.map((v) => v * scale), N: CAP, T: out.T };
        const before = f.n.slice();
        for (let t = 0; t < 100; t += 0.02) net.step(f, 0.02);
        for (let s = 0; s < NS; s++) expect(f.n[s], SPECIES[s].name).toBeCloseTo(before[s], 6);
        expect(f.T).toBeCloseTo(out.T, 9);
      });
    });
  }
});
