import { describe, expect, it } from 'vitest';
import { temperature } from '../chem/reactions';
import { TARGET } from '../chem/species';
import { CAP } from './config';
import { Flask } from './flask';
import { CRYOSTABILIZER } from './supply';
import { Tool } from './tools';
import { REFERENCE_FILL, applyFill } from './presets';

describe('presets', () => {
  it("fills the ship's reservoir with what's left on board", () => {
    const ref = new Tool('receptacle', 0).tanks[1];
    applyFill(ref, REFERENCE_FILL);
    // a hundred flasks of triangles
    expect(ref.n[TARGET]).toBe(CRYOSTABILIZER.start);
    expect(ref.N).toBe(3 * CRYOSTABILIZER.start);
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
