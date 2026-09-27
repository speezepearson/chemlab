import { describe, expect, it } from 'vitest';
import { SPECIES, TARGET, singleOf } from '../chem/species';
import { Flask } from './flask';

const atomTotal = (f: Flask) => SPECIES.reduce((t, s) => t + f.n[s.i] * s.size, 0);

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
