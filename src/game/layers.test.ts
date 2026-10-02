import { afterEach, describe, expect, it } from 'vitest';
import { restoreDefaultMixing } from '../chem/mixing';
import { defaultChemParams } from '../chem/params';
import { ReactionNetwork } from '../chem/reactions';
import { NS, SPECIES, singleOf, speciesIndex } from '../chem/species';
import { CAP } from './config';
import { Vessel, transfer, volume } from './flask';
import { LAYERS } from './layers';

const R = singleOf('R');
const C = singleOf('C');
const G = singleOf('G');
const RG = speciesIndex(['R', 'G', null], 1);

/** A flask of `a` and `b` half and half, at T, left to stand for `seconds`. */
function stood(a: number, b: number, T = 1, seconds = 20): Vessel {
  const v = new Vessel(CAP);
  v.setMolecules(a, CAP / 4);
  v.setMolecules(b, CAP / 4);
  v.setTemperature(T);
  for (let i = 0; i < seconds / 0.02; i++) v.settle(0.02);
  return v;
}

/** The share of a fluid's volume that species s takes up. */
const share = (f: { n: Float64Array; N: number; Q: number }, s: number) => f.n[s] / volume(f);

/** Whether a vessel's layers add up to its totals, in whole molecules. */
function consistent(v: Vessel): boolean {
  const layers = v.strata();
  for (let s = 0; s < NS; s++) {
    const sum = layers.reduce((t, l) => t + l.n[s], 0);
    if (sum !== v.n[s] || layers.some((l) => !Number.isInteger(l.n[s]))) return false;
  }
  return layers.reduce((t, l) => t + l.N, 0) === v.N;
}

afterEach(restoreDefaultMixing);

describe('layers', () => {
  it('keep a vessel in LAYERS layers that add up to its contents', () => {
    const v = stood(R, C, 1, 1);
    expect(v.strata().length).toBe(LAYERS);
    expect(consistent(v)).toBe(true);
    v.setMolecules(G, CAP / 10); // set directly: spread through the layers when they're next used
    expect(consistent(v)).toBe(true);
    transfer(v, null, CAP / 3, 'top');
    expect(consistent(v)).toBe(true);
  });

  it('separate opposite colors at room temperature, the lighter on top', () => {
    const v = stood(R, C);
    const L = v.strata();
    expect(share(L[L.length - 1], R)).toBeGreaterThan(0.9); // R weighs 0.75, C 1.05
    expect(share(L[0], C)).toBeGreaterThan(0.9);
  });

  it('let heat mix fluids that separate cold', () => {
    const v = stood(R, C, 3);
    const L = v.strata();
    expect(share(L[L.length - 1], R)).toBeLessThan(0.6);
  });

  it('keep similar colors mixed, with only a slight gradient', () => {
    const v = stood(R, G);
    const L = v.strata();
    expect(share(L[L.length - 1], R)).toBeGreaterThan(0.5);
    expect(share(L[L.length - 1], R)).toBeLessThan(0.6);
  });

  it('pour off the top and drain from the bottom', () => {
    const v = stood(R, C);
    const top = new Vessel(Infinity);
    transfer(v, top, CAP / 5, 'top');
    const bottom = new Vessel(Infinity);
    transfer(v, bottom, CAP / 5, 'bottom');
    expect(share(top, R)).toBeGreaterThan(0.9);
    expect(share(bottom, C)).toBeGreaterThan(0.9);
  });

  it('let something denser poured in sink to the bottom, stirring what it passes', () => {
    const v = stood(R, C);
    const pairs = new Vessel(Infinity);
    pairs.setMolecules(RG, CAP / 10);
    v.receive(pairs);
    const L = v.strata();
    expect(share(L[0], RG)).toBeGreaterThan(0.9);
    expect(L.every((l) => l.stir > 0)).toBe(true);
  });

  it('let something lighter poured in float, stirring only the top', () => {
    const v = stood(C, G); // G weighs 0.85, C 1.05
    const red = new Vessel(Infinity);
    red.setMolecules(R, CAP / 20);
    v.receive(red);
    const L = v.strata();
    expect(share(L[L.length - 1], R)).toBeGreaterThan(0.9);
    expect(L[0].stir).toBe(0);
  });

  it('mix when sloshed, then settle again', () => {
    const v = stood(R, C);
    v.slosh(5);
    for (let i = 0; i < 25; i++) v.settle(0.02);
    let L = v.strata();
    expect(share(L[L.length - 1], R)).toBeLessThan(0.75);
    for (let i = 0; i < 1000; i++) v.settle(0.02);
    L = v.strata();
    expect(share(L[L.length - 1], R)).toBeGreaterThan(0.9);
  });

  it('stay mixed when stirred', () => {
    const v = new Vessel(CAP);
    v.stirred = true;
    v.setMolecules(R, CAP / 4);
    v.setMolecules(C, CAP / 4);
    for (let i = 0; i < 500; i++) v.settle(0.02);
    const bottom = new Vessel(Infinity);
    transfer(v, bottom, CAP / 10, 'bottom');
    expect(share(bottom, R)).toBeCloseTo(0.5, 1);
  });

  it('react apart once separated, conserving atoms', () => {
    const net = new ReactionNetwork(defaultChemParams());
    const v = stood(R, C);
    v.setMolecules(G, CAP / 10);
    const atoms = v.N;
    for (let i = 0; i < 100; i++) {
      v.react(net, 0.02);
      v.settle(0.02);
    }
    expect(v.N).toBe(atoms);
    expect(consistent(v)).toBe(true);
    expect(SPECIES.some((s) => s.size > 1 && v.n[s.i] > 0)).toBe(true);
  });
});
