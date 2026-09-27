import { describe, expect, it } from 'vitest';
import { NS, TARGET } from '../chem/species';
import { CAP, N_FLASKS } from './config';
import { Flask } from './flask';
import { SHAPES, TANK_CAP } from './tools';
import { DEFAULT_PRESET, PRESETS, applyFill, fillAtoms } from './presets';

describe('presets', () => {
  it('have unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  for (const p of PRESETS) {
    it(`${p.name} fits on the shelf`, () => {
      expect(p.flasks.length).toBeLessThanOrEqual(N_FLASKS);
      for (const fill of p.flasks) {
        if (!fill) continue;
        expect(fillAtoms(fill)).toBeGreaterThan(0);
        expect(fillAtoms(fill)).toBeLessThanOrEqual(CAP);
        expect(fill.T).toBeGreaterThanOrEqual(0);
        for (const c of fill.contents) {
          expect(Number.isInteger(c.species) && c.species >= 0 && c.species < NS).toBe(true);
          expect(c.molecules).toBeGreaterThan(0);
        }
      }
    });
  }

  for (const p of PRESETS) {
    it(`${p.name} has sensible tools`, () => {
      for (const t of p.tools ?? []) {
        for (const c of t.at) expect(c >= 0 && c <= 1).toBe(true);
        if (t.valve !== undefined) expect(t.valve >= 0 && t.valve <= 1).toBe(true);
        expect((t.tanks ?? []).length).toBeLessThanOrEqual(SHAPES[t.kind].tanks.length);
        for (const fill of t.tanks ?? []) if (fill) expect(fillAtoms(fill)).toBeLessThanOrEqual(TANK_CAP);
      }
    });
  }

  it('starts the default game with the supply of target', () => {
    const f = new Flask({ x: 0, y: 0 }, CAP);
    applyFill(f, DEFAULT_PRESET.flasks[0]);
    expect(f.n[TARGET]).toBeCloseTo((0.4 * CAP) / 3);
    expect(f.N).toBeCloseTo(0.4 * CAP);
    expect(f.label).toBe('supply');
  });

  it('applyFill replaces whatever was in the flask', () => {
    const f = new Flask({ x: 0, y: 0 }, CAP);
    applyFill(f, DEFAULT_PRESET.flasks[0]);
    f.T = 7;
    applyFill(f, null);
    expect(f.N).toBe(0);
    expect(f.n.every((v) => v === 0)).toBe(true);
    expect(f.T).toBe(1);
    expect(f.label).toBe('');
  });
});
