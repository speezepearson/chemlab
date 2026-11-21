import { describe, expect, it } from 'vitest';
import { temperature } from '../chem/reactions';
import { NS, TARGET } from '../chem/species';
import { CAP, N_FLASKS } from './config';
import { Flask, roomFor } from './flask';
import { CRYOSTABILIZER } from './supply';
import { SHAPES, TANK_CAP, Tool, mouthBelow, type ToolKind } from './tools';
import { faucetBox, faucetPipes, flaskBox, spoutAt, tankMouth, toolBox } from './bodies';
import { boxesOverlap, type Box } from './physics';
import { BENCH, CELL, LIFT, PLANE_Z, fromFrac } from './space';
import { FLASK_H } from './flaskShape';
import {
  DEFAULT_PRESET, LAMP_POSE, PRESETS, PRESET_FLASKS_X, REFERENCE_FILL, SPECTROSCOPE_AT, STATION_POSE, applyFill, fillAtoms,
  type FlaskFill, type Preset, type Spot,
} from './presets';

/** A tool hung where a spot says, as the engine hangs it. */
const hang = (kind: ToolKind, spot: Spot, id = 0) => new Tool(kind, id, { ...fromFrac({ x: spot.at[0], y: spot.at[1] }), yaw: 0 });

/** A preset's tools, hung where it says. */
const toolsOf = (p: Preset) => (p.tools ?? []).map((spec, i) => hang(spec.kind, spec, i));

/** The station, the shadow lamp, and the spectroscope where it starts. */
const fixtures = () => [new Tool('receptacle', 100, STATION_POSE), new Tool('shadowlamp', 101, LAMP_POSE), hang('spectroscope', SPECTROSCOPE_AT, 102)];

const faucetBoxes = () => faucetPipes().map((p) => faucetBox(p.spout));

/** Whether a box lies within the bench: along the wall past the cabinet, and between the counter and the ceiling. */
const onBench = (b: Box) =>
  b.x - b.hx >= BENCH.x0 && b.x + b.hx <= BENCH.x1 && b.y - b.hy >= BENCH.y0 - 1e-6 && b.y + b.hy <= BENCH.y1;

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
        for (const v of t.valves ?? []) expect(v >= 0 && v <= 1).toBe(true);
        expect((t.valves ?? []).length).toBeLessThanOrEqual(SHAPES[t.kind].tanks.length);
        expect((t.tanks ?? []).length).toBeLessThanOrEqual(SHAPES[t.kind].tanks.length);
        for (const fill of t.tanks ?? []) if (fill) expect(fillVolume(fill)).toBeLessThanOrEqual(SHAPES[t.kind].tankCap ?? TANK_CAP);
      }
    });
  }

  for (const p of PRESETS) {
    it(`${p.name} hangs its tools on the bench, in the plane, clear of each other, the faucets, the station and the instruments`, () => {
      const tools = toolsOf(p);
      const others = [...fixtures().map(toolBox), ...faucetBoxes()];
      for (const t of tools) {
        expect(t.pose.z).toBe(PLANE_Z);
        const b = toolBox(t);
        expect(onBench(b), t.kind).toBe(true);
        for (const o of others) expect(boxesOverlap(b, o), t.kind).toBe(false);
      }
      for (const a of tools) for (const b of tools) if (a !== b) expect(boxesOverlap(toolBox(a), toolBox(b))).toBe(false);
    });
  }

  for (const p of PRESETS) {
    it(`${p.name} stands its flasks along the counter, clear of everything hung there`, () => {
      const hung = [...toolsOf(p), ...fixtures()].map(toolBox).concat(faucetBoxes());
      p.flasks.forEach((_, i) => {
        const f = new Flask(CAP);
        f.pose = { x: PRESET_FLASKS_X + i * CELL, y: LIFT + FLASK_H, z: PLANE_Z, yaw: 0 };
        const b = flaskBox(f);
        expect(b.x - b.hx).toBeGreaterThan(BENCH.x0);
        expect(b.x + b.hx).toBeLessThan(BENCH.x1);
        for (const o of hung) expect(boxesOverlap(b, o)).toBe(false);
      });
    });
  }

  it('starts the station and the unique instruments on the bench, clear of each other and of the faucets', () => {
    const fx = fixtures();
    for (const t of fx) {
      const b = toolBox(t);
      expect(b.x - b.hx, t.kind).toBeGreaterThanOrEqual(BENCH.x0);
      expect(b.x + b.hx, t.kind).toBeLessThanOrEqual(BENCH.x1);
      for (const o of faucetBoxes()) expect(boxesOverlap(b, o), t.kind).toBe(false);
    }
    for (const a of fx) for (const b of fx) if (a !== b) expect(boxesOverlap(toolBox(a), toolBox(b)), `${a.kind} ${b.kind}`).toBe(false);
  });

  it("has the heat exchanger demo's dispensers each pouring into one of the exchanger's tanks", () => {
    const tools = toolsOf(PRESETS.find((p) => p.id === 'exchanger')!);
    const ex = tools.find((t) => t.kind === 'exchanger')!;
    const dispensers = tools.filter((t) => t.kind === 'dispenser');
    expect(dispensers).toHaveLength(2);
    const mouths = ex.tanks.map((_, k) => tankMouth(ex, k));
    dispensers.forEach((d, k) => expect(mouthBelow(mouths, spoutAt(d, 0))?.v).toBe(ex.tanks[k]));
  });

  it("has the separator demo's dispensers under its two end spouts", () => {
    const tools = toolsOf(PRESETS.find((p) => p.id === 'separator')!);
    const sep = tools.find((t) => t.kind === 'separator')!;
    const [left, right] = tools.filter((t) => t.kind === 'dispenser');
    const mouths = [tankMouth(left, 0), tankMouth(right, 0)];
    expect(mouthBelow(mouths, spoutAt(sep, 0))?.v).toBe(left.tanks[0]);
    expect(mouthBelow(mouths, spoutAt(sep, sep.shape.spouts.length - 1))?.v).toBe(right.tanks[0]);
    // and nothing else of it pours into them
    for (let j = 1; j < sep.shape.spouts.length - 1; j++) expect(mouthBelow(mouths, spoutAt(sep, j))).toBeNull();
  });

  it("fills the ship's reservoir with what's left on board, and starts the default game with no supply flask", () => {
    const ref = new Tool('receptacle', 0).tanks[1];
    applyFill(ref, REFERENCE_FILL);
    // a hundred flasks of triangles
    expect(ref.n[TARGET]).toBe(CRYOSTABILIZER.start);
    expect(ref.N).toBe(3 * CRYOSTABILIZER.start);
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
