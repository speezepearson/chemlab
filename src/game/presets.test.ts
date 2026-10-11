import { describe, expect, it } from 'vitest';
import { temperature } from '../chem/reactions';
import { NS, TARGET } from '../chem/species';
import { CAP, N_FLASKS } from './config';
import { Flask, roomFor } from './flask';
import { REFERENCE_CAP, SHAPES, TANK_CAP, Tool } from './tools';
import { DEFAULT_PRESET, PRESETS, applyFill, fillAtoms, type FlaskFill } from './presets';

/** How much room a fill takes, by volume. */
const fillVolume = (fill: FlaskFill) => fill.contents.reduce((t, c) => t + c.molecules * roomFor(c.species), 0);

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
        expect(fillVolume(fill)).toBeLessThanOrEqual(CAP);
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
        for (const fill of t.tanks ?? []) if (fill) expect(fillVolume(fill)).toBeLessThanOrEqual(SHAPES[t.kind].tankCap ?? TANK_CAP);
      }
    });
  }

  it('starts the default game with the cryostabilizer reference holding the target, and no supply flask', () => {
    const spec = DEFAULT_PRESET.tools!.find((t) => t.kind === 'reference')!;
    const ref = new Tool('reference', 0);
    applyFill(ref.tanks[0], spec.tanks![0]);
    // full: a hundred flasks of triangles
    expect(ref.tanks[0].n[TARGET]).toBe(REFERENCE_CAP);
    expect(ref.tanks[0].N).toBe(3 * REFERENCE_CAP);
    expect(DEFAULT_PRESET.flasks.filter(Boolean)).toHaveLength(0);
  });

  it('applyFill replaces whatever was in the flask', () => {
    const f = new Flask(CAP);
    applyFill(f, { contents: [{ species: TARGET, molecules: 1000 }], T: 1, label: 'x' });
    f.setTemperature(7);
    applyFill(f, null);
    expect(f.N).toBe(0);
    expect(f.Q).toBe(0);
    expect(f.n.every((v) => v === 0)).toBe(true);
    expect(temperature(f)).toBe(1);
    expect(f.label).toBe('');
  });
});
