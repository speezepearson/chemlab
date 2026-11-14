import { describe, expect, it } from 'vitest';
import { ATOMS } from './atoms';
import { Mordant, Mordants } from './mordant';
import { ReactionNetwork, type Fluid } from './reactions';
import { NS, SPECIES, TARGET, bondMask, pairOf, singleOf, speciesIndex } from './species';
import { testChemParams } from './testChem';

const [R, G, B, K] = (['R', 'G', 'B', 'K'] as const).map(singleOf);
const color = (a: 'R' | 'G' | 'B' | 'K') => ATOMS.indexOf(a);
const fluid = (parts: [number, number][] = []): Fluid => {
  const f = { n: new Float64Array(NS), N: 0, Q: 0 };
  for (const [s, n] of parts) {
    f.n[s] = n;
    f.N += n * SPECIES[s].size;
  }
  return f;
};
const atoms = (f: Fluid, a: string) => SPECIES.reduce((t, sp) => t + (sp.atoms.includes(a as 'R') ? f.n[sp.i] : 0), 0);
const run = (m: Mordant, loose: Fluid, fixed: Fluid, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / 0.02); i++) m.react(loose, fixed, 0.02);
};

describe('mordant', () => {
  const net = new ReactionNetwork(testChemParams());
  const ringK = speciesIndex(['R', 'G', 'K'], bondMask(['R', 'G'], ['R', 'K'], ['G', 'K']));

  it('fixes what bonds to the dye, and leaves alone what already has its color, or bonds with nothing', () => {
    const m = new Mordant(net, color('R'), 1);
    const loose = fluid([[G, 1000], [pairOf('R', 'G'), 1000], [B, 1000]]);
    const fixed = fluid([[R, 50000]]);
    run(m, loose, fixed, 120);
    expect(loose.n[G]).toBeLessThan(5);
    expect(fixed.n[pairOf('R', 'G')]).toBe(1000 - loose.n[G]);
    expect(fixed.n[R]).toBe(50000 - fixed.n[pairOf('R', 'G')]);
    expect(loose.n[pairOf('R', 'G')]).toBe(1000);
    expect(loose.n[B]).toBe(1000);
    expect(loose.N + fixed.N).toBe(54000);
  });

  it('fixes the product with the dye in it and frees the other, whichever way a displacement goes', () => {
    // a chemistry in which no bond forms or breaks outright, so displacement is all there is
    const params = testChemParams();
    for (const bond of Object.values(params.bonds)) bond.A = 0;
    const k = new Mordant(new ReactionNetwork(params), color('K'), 1);
    // the dye displaces: black takes blue's place in the triangle, which is fixed, and the blue is loose
    const loose = fluid([[TARGET, 1000]]);
    const fixed = fluid([[K, 50000]]);
    run(k, loose, fixed, 60);
    expect(loose.n[TARGET]).toBeLessThanOrEqual(3);
    expect(loose.n[B]).toBe(1000 - loose.n[TARGET]);
    expect(fixed.n[ringK]).toBe(loose.n[B]);
    expect(fixed.n[K]).toBe(50000 - loose.n[B]);
    // the dye is displaced: red takes fixed black's place in G–K, and R–G goes free, the black staying behind
    const freed = fluid([[R, 1000]]);
    const held = fluid([[pairOf('G', 'K'), 1000]]);
    run(k, freed, held, 600);
    expect(freed.n[pairOf('R', 'G')]).toBeGreaterThan(990);
    expect(held.n[K]).toBe(freed.n[pairOf('R', 'G')]);
    expect(atoms(held, 'K')).toBe(1000);
    expect(atoms(freed, 'K')).toBe(0);
  });

  it('lets a fixed molecule break: the piece with the dye stays, and the other comes loose', () => {
    const m = new Mordant(net, color('R'), 5);
    const loose = fluid();
    const fixed = fluid([[pairOf('R', 'K'), 100000]]);
    run(m, loose, fixed, 20);
    expect(loose.n[K]).toBeGreaterThan(1000);
    expect(fixed.n[R]).toBe(loose.n[K]);
    expect(atoms(fixed, 'R')).toBe(100000);
    expect(atoms(loose, 'R')).toBe(0);
    // cold, it holds
    const cold = fluid([[pairOf('R', 'K'), 100000]]);
    run(new Mordant(net, color('R'), 0.2), fluid(), cold, 20);
    expect(cold.n[pairOf('R', 'K')]).toBe(100000);
  });

  it('does nothing with nothing fixed, and nothing loose reacts with anything loose', () => {
    const m = new Mordant(net, color('R'), 1);
    const loose = fluid([[R, 1000], [G, 1000]]);
    const none = fluid();
    run(m, loose, none, 60);
    expect([...loose.n]).toEqual([...fluid([[R, 1000], [G, 1000]]).n]);
    expect(none.N).toBe(0);
  });

  it('is made once for each color and temperature, and again when the chemistry changes', () => {
    const own = new ReactionNetwork(testChemParams());
    const all = new Mordants(own);
    const m = all.of(color('R'), 1);
    expect(all.of(color('R'), 1)).toBe(m);
    expect(all.of(color('G'), 1)).not.toBe(m);
    expect(all.of(color('R'), 2)).not.toBe(m);
    const again = all.of(color('R'), 1);
    own.params.bonds.RG.A = 0;
    own.rebuild();
    const changed = all.of(color('R'), 1);
    expect(changed).not.toBe(again);
    const loose = fluid([[G, 1000]]);
    run(changed, loose, fluid([[R, 50000]]), 60);
    expect(loose.n[G]).toBe(1000);
  });
});
