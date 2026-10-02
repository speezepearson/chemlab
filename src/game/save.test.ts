import { describe, expect, it } from 'vitest';
import { defaultChemParams } from '../chem/params';
import { TARGET, singleOf } from '../chem/species';
import { Vessel } from './flask';
import { decodeSave, encodeSave, loadChem, loadVessel, saveChem, saveVessel, type SaveState } from './save';

describe('saves', () => {
  it('round-trip a vessel exactly', () => {
    const v = new Vessel(4e9, 'supply');
    v.n[TARGET] = 123456789;
    v.n[singleOf('R')] = 7;
    v.N = 3 * 123456789 + 7;
    v.Q = 987654321;
    const w = new Vessel(4e9);
    loadVessel(w, saveVessel(v));
    expect([...w.n]).toEqual([...v.n]);
    expect([w.N, w.Q, w.label]).toEqual([v.N, v.Q, v.label]);
  });

  it('round-trip the layers of a vessel', () => {
    const v = new Vessel(1e6);
    v.setMolecules(singleOf('R'), 1000);
    v.setMolecules(singleOf('C'), 1000);
    for (let i = 0; i < 500; i++) v.settle(0.02);
    const w = new Vessel(1e6);
    loadVessel(w, saveVessel(v));
    expect(w.strata().map((l) => [...l.n])).toEqual(v.strata().map((l) => [...l.n]));
  });

  it('drop what does not fit, unknown species, and fractions', () => {
    const w = new Vessel(10);
    loadVessel(w, { n: { '△RGB': 2.6, nonsense: 5, R: 100 }, Q: 12.4 });
    // by molecules, 3 triangles leave room for 7 R
    expect(w.n[TARGET]).toBe(3);
    expect(w.n[singleOf('R')]).toBe(7);
    expect([w.N, w.Q]).toEqual([16, 12]);
  });

  it('encode to a string and back, including the chemistry', () => {
    const params = defaultChemParams();
    params.bonds.RG.E = 42;
    const s: SaveState = { v: 1, preset: 'stranded', flasks: [], tools: [], scales: [], hoses: [], chem: saveChem(params) };
    const back = decodeSave(encodeSave(s));
    expect(back).toEqual(s);
    const fresh = defaultChemParams();
    loadChem(fresh, back.chem);
    expect(fresh.bonds.RG.E).toBe(42);
  });

  it('reject strings that are not saves', () => {
    expect(() => decodeSave('hello')).toThrow();
    expect(() => decodeSave('{"v":2}')).toThrow();
  });
});
