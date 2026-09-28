import { describe, expect, it } from 'vitest';
import { temperature } from '../chem/reactions';
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
        for (const v of t.valves ?? []) expect(v >= 0 && v <= 1).toBe(true);
        expect((t.valves ?? []).length).toBeLessThanOrEqual(SHAPES[t.kind].tanks.length);
        expect((t.tanks ?? []).length).toBeLessThanOrEqual(SHAPES[t.kind].tanks.length);
        for (const fill of t.tanks ?? []) if (fill) expect(fillAtoms(fill)).toBeLessThanOrEqual(TANK_CAP);
      }
    });
  }

  it('starts the default game with the supply of target', () => {
    const f = new Flask({ x: 0, y: 0 }, CAP);
    applyFill(f, DEFAULT_PRESET.flasks[0]);
    // whole molecules only
    expect(f.n[TARGET]).toBe(Math.round((0.4 * CAP) / 3));
    expect(f.N).toBe(3 * Math.round((0.4 * CAP) / 3));
    expect(f.label).toBe('supply');
  });

  it('applyFill replaces whatever was in the flask', () => {
    const f = new Flask({ x: 0, y: 0 }, CAP);
    applyFill(f, DEFAULT_PRESET.flasks[0]);
    f.setTemperature(7);
    applyFill(f, null);
    expect(f.N).toBe(0);
    expect(f.Q).toBe(0);
    expect(f.n.every((v) => v === 0)).toBe(true);
    expect(temperature(f)).toBe(1);
    expect(f.label).toBe('');
  });
});
