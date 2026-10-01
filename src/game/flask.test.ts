import { afterEach, describe, expect, it } from 'vitest';
import { SPECIES, TARGET, singleOf, speciesIndex } from '../chem/species';
import { Flask, VOLUME, Vessel, sustenance, transfer, volume } from './flask';
import { separate } from './tools';

const atomTotal = (f: Flask) => SPECIES.reduce((t, s) => t + f.n[s.i] * s.size, 0);

describe('sustenance', () => {
  it('counts the target only in vessels at least 99% pure', () => {
    const f = new Flask({ x: 0, y: 0 }, 1e6);
    f.setMolecules(TARGET, 1000);
    expect(sustenance(f)).toBe(3000);
    f.setMolecules(singleOf('R'), 30); // exactly 99%
    expect(sustenance(f)).toBe(3000);
    f.setMolecules(singleOf('R'), 31);
    expect(sustenance(f)).toBe(0);
    expect(sustenance(new Flask({ x: 0, y: 0 }, 10))).toBe(0);
  });
});

describe('Flask.setMolecules', () => {
  it('sets a count and keeps N equal to the atom total', () => {
    const f = new Flask({ x: 0, y: 0 }, 300);
    expect(f.setMolecules(TARGET, 40)).toBe(40);
    expect(f.setMolecules(singleOf('R'), 25)).toBe(25);
    expect(f.N).toBe(145);
    expect(f.setMolecules(TARGET, 10)).toBe(10);
    expect(f.N).toBe(55);
    expect(f.N).toBeCloseTo(atomTotal(f));
  });

  it('clamps to what fits in the flask', () => {
    const f = new Flask({ x: 0, y: 0 }, 300);
    f.setMolecules(singleOf('G'), 120);
    // 180 atoms of room left = 60 triangles
    expect(f.setMolecules(TARGET, 1000)).toBe(60);
    expect(f.N).toBe(300);
  });

  it('clamps negative counts to zero', () => {
    const f = new Flask({ x: 0, y: 0 }, 300);
    f.setMolecules(TARGET, 5);
    expect(f.setMolecules(TARGET, -3)).toBe(0);
    expect(f.N).toBe(0);
  });
});

describe('whole numbers', () => {
  const whole = (f: { n: Float64Array; Q: number }) => f.n.every(Number.isInteger) && Number.isInteger(f.Q);

  it('survive pouring, filling from a recipe, and splitting, with atoms and heat conserved', () => {
    const a = new Flask({ x: 0, y: 0 }, 1e9);
    // a faucet-style recipe: one atom's worth, fractional
    const recipe = { n: new Float64Array(SPECIES.length), N: 1, Q: 3 };
    recipe.n[singleOf('R')] = 0.3;
    recipe.n[TARGET] = 0.7 / 3;
    a.addFrom(recipe, 123456789.5);
    expect(whole(a)).toBe(true);
    a.setTemperature(2.5);
    expect(whole(a)).toBe(true);

    const b = new Flask({ x: 0, y: 0 }, 1e9);
    const [N0, Q0] = [a.N, a.Q];
    transfer(a, b, 3.3e7);
    expect(whole(a) && whole(b)).toBe(true);
    expect(a.N + b.N).toBe(N0);
    expect(a.Q + b.Q).toBe(Q0);
    expect(atomTotal(a) + atomTotal(b)).toBe(N0);

    const [l, r] = separate(b);
    expect(whole(l) && whole(r)).toBe(true);
    expect(l.N + r.N).toBe(b.N);
    expect(l.Q + r.Q).toBe(b.Q);
  });

  it('round setMolecules to a whole count', () => {
    const f = new Flask({ x: 0, y: 0 }, 300);
    expect(f.setMolecules(TARGET, 12.6)).toBe(13);
    expect(whole(f)).toBe(true);
  });
});

describe('volume by molecules', () => {
  const RG = speciesIndex(['R', 'G', null], 1);
  afterEach(() => {
    VOLUME.molecules = false;
  });

  it('counts atoms by default, and molecules when switched', () => {
    const v = new Vessel(Infinity);
    v.setMolecules(RG, 100);
    expect(volume(v)).toBe(200);
    VOLUME.molecules = true;
    expect(volume(v)).toBe(100);
  });

  it('fills, pours and caps by molecules', () => {
    VOLUME.molecules = true;
    const v = new Vessel(1000);
    // a pair takes one molecule's room, so 1000 of them fit: 2000 atoms
    expect(v.setMolecules(RG, 5000)).toBe(1000);
    expect(v.N).toBe(2000);
    const dst = new Vessel(300);
    transfer(v, dst, 500);
    expect(dst.n[RG]).toBe(300);
    expect(volume(v)).toBe(700);
  });
});
