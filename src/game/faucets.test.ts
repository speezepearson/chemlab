import { describe, expect, it } from 'vitest';
import { T_ROOM } from '../chem/params';
import { testChemParams } from '../chem/testChem';
import { ReactionNetwork, atomCounts, heatAt, temperature, type Fluid } from '../chem/reactions';
import { equilibriumFluid } from '../chem/equilibrium';
import { NS, SPECIES, pairOf } from '../chem/species';
import { pairKey } from '../chem/atoms';
import { CAP } from './config';
import { Vessel } from './flask';
import { FAUCETS, describeFaucet, faucetIndex, faucetOutput, faucetTarget, type Faucet } from './faucets';
import type { Mouth } from './tools';

describe('faucets', () => {
  const net = new ReactionNetwork(testChemParams());

  it('are the four atoms, once each, in the order R, G, B, K', () => {
    const starts = FAUCETS.map((fa) => SPECIES[fa.start]);
    expect(starts.map((s) => s.name)).toEqual(['R', 'G', 'B', 'K']);
    expect(starts.every((s) => s.size === 1)).toBe(true);
  });

  // faucets of pairs are gone from the lab, but faucetOutput still settles them, as it would anything
  const pairs: Faucet[] = SPECIES.filter((s) => s.size === 2).map((s) => ({ start: s.i }));

  for (const fa of [...FAUCETS, ...pairs]) {
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
        const [a, b] = start.atoms;
        const frozen = net.params.bonds[pairKey(a, b)].A === 0;
        it(frozen ? "stays whole, since its bond can't break" : 'settles to full equilibrium, since its bond can break', () => {
          const atoms = Object.fromEntries([a, b].map((x) => [x, 0.5]));
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
    const cy: Faucet = { start: pairOf('G', 'K') };
    const before = faucetOutput(cy, own).n[cy.start];
    expect(faucetOutput(cy, own).n[cy.start]).toBe(before); // cached
    own.params.bonds.GK.E *= 2;
    own.rebuild();
    expect(faucetOutput(cy, own).n[cy.start]).toBeGreaterThan(before);
  });
});

describe('faucetIndex', () => {
  it("is a faucet's own place in a save of today's faucets", () => {
    FAUCETS.forEach((_, i) => expect(faucetIndex(i, FAUCETS.length)).toBe(i));
  });

  const [R, G, B] = ['R', 'G', 'B'].map((a) => FAUCETS.findIndex((fa) => SPECIES[fa.start].name === a));

  it("finds R, G and B's faucets among a six-atom save's R, Y, G, C, B and M, and nothing for the rest", () => {
    expect(Array.from({ length: 6 }, (_, i) => faucetIndex(i, 6))).toEqual([R, null, G, null, B, null]);
  });

  it("finds R, G and B's faucets among an old save's 18, and nothing for the rest", () => {
    const found = Array.from({ length: 18 }, (_, i) => faucetIndex(i, 18));
    expect([found[3], found[7], found[11]]).toEqual([R, G, B]);
    expect(found.filter((j) => j !== null)).toHaveLength(3);
  });

  it('finds nothing in a save of any other number', () => {
    expect(faucetIndex(0, 7)).toBeNull();
  });
});

describe('faucetTarget', () => {
  const spout = { x: 100, y: 600, z: 0 };
  const mouth = (v: Vessel, y: number): Mouth => ({ v, x: 100, y, z: 0, hx: 20, hz: 20 });

  it('fills something standing under it, however far down', () => {
    const tank = new Vessel(CAP);
    expect(faucetTarget([mouth(tank, 590)], spout)?.v).toBe(tank);
    expect(faucetTarget([mouth(tank, 300)], spout)?.v).toBe(tank);
  });

  it('keeps filling something full (which overflows), but nothing beside it', () => {
    const tank = new Vessel(CAP);
    tank.N = CAP;
    expect(faucetTarget([mouth(tank, 500)], spout)?.v).toBe(tank);
    expect(faucetTarget([{ ...mouth(tank, 500), x: 200 }], spout)).toBeNull();
  });

  it('fills only the first thing under it', () => {
    const top = new Vessel(4 * CAP);
    const below = new Vessel(CAP);
    expect(faucetTarget([mouth(below, 400), mouth(top, 500)], spout)?.v).toBe(top);
  });
});
