import { describe, expect, it } from 'vitest';
import {
  aimValve, flaskLip, flaskMouth, flip, onScale, scaleSpot, spoutAt, tankMouth, toolBox, valveLocal, valveNear,
} from './bodies';
import { CAP } from './config';
import { Flask } from './flask';
import { FLASK_H } from './flaskShape';
import { boxesOverlap } from './physics';
import { Scale } from './scale';
import { fromFrac, toFrac } from './space';
import { Tool, mouthBelow } from './tools';

const at = (x: number, y: number, z: number, yaw = 0) => ({ x, y, z, yaw });

describe('fromFrac', () => {
  it('puts the old bench on the back wall, its sink on the counter, and back again', () => {
    const p = fromFrac({ x: 0.3, y: 0.4 });
    expect(p.x).toBeCloseTo(300);
    expect(toFrac(p).x).toBeCloseTo(0.3);
    expect(toFrac(p).y).toBeCloseTo(0.4);
    // further down the old bench is lower in the room
    expect(fromFrac({ x: 0, y: 0.6 }).y).toBeLessThan(p.y);
  });
});

describe('tools in the room', () => {
  it('drip from a spout into the tank of a tool hung right under it, at any yaw', () => {
    for (const yaw of [0, 1, Math.PI]) {
      const top = new Tool('dispenser', 0, at(100, 800, 200, yaw));
      const below = new Tool('dispenser', 1, at(100, 600, 200, yaw + 0.3));
      const m = mouthBelow([tankMouth(top, 0), tankMouth(below, 0)], spoutAt(top, 0));
      expect(m?.v).toBe(below.tanks[0]);
    }
  });

  it('turn their spouts with them', () => {
    const sep = new Tool('separator', 0, at(0, 500, 0, Math.PI / 2));
    const last = sep.shape.spouts.length - 1;
    // turned a quarter, left to right becomes front to back
    expect(spoutAt(sep, 0).x).toBeCloseTo(0);
    expect(spoutAt(sep, 0).z).toBeCloseTo(-sep.shape.spouts[0]);
    expect(spoutAt(sep, last).z).toBeCloseTo(-sep.shape.spouts[last]);
  });

  it('flip left to right in place, mirroring their spouts but not where they stand', () => {
    const sep = new Tool('separator', 0, at(100, 500, 0));
    const box = toolBox(sep);
    const left = spoutAt(sep, 0).x;
    expect(flip(sep)).toBe(true);
    expect(toolBox(sep).x).toBeCloseTo(box.x);
    // the spout that was leftmost is now the rightmost, mirrored about the box's middle
    expect(spoutAt(sep, 0).x).toBeCloseTo(2 * box.x - left);
    expect(flip(new Tool('dispenser', 1))).toBe(false);
  });

  it('bump into each other only where their boxes meet', () => {
    const a = new Tool('dispenser', 0, at(0, 500, 0));
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(60, 500, 0))))).toBe(true);
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(80, 500, 0))))).toBe(false);
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(0, 300, 0))))).toBe(false);
  });
});

describe('valveNear', () => {
  it('finds the nearest valve within reach of its lever, and none further off', () => {
    const ht = new Tool('heater', 0);
    const v = valveLocal(ht, 1);
    expect(valveNear(ht, v.x + 5, v.y + 3)).toBe(1);
    expect(valveNear(ht, v.x + 40, v.y + 40)).toBeNull();
    expect(valveNear(new Tool('sorter', 0), 0, 0)).toBeNull();
  });

  it('keeps valves where they were on a flipped tool, mirrored', () => {
    const ht = new Tool('heater', 0);
    const v = valveLocal(ht, 0);
    flip(ht);
    expect(valveLocal(ht, 0).x).toBeCloseTo(-v.x);
  });
});

describe('aimValve', () => {
  it("turns a dial clockwise from down-left, off, to down-right, full", () => {
    const ht = new Tool('heater', 0);
    const k = ht.shape.dial!;
    const v = valveLocal(ht, k);
    aimValve(ht, k, v.x - 20, v.y + 20);
    expect(ht.valves[k]).toBeCloseTo(0);
    aimValve(ht, k, v.x, v.y - 20);
    expect(ht.valves[k]).toBeCloseTo(0.5);
    aimValve(ht, k, v.x + 20, v.y + 20);
    expect(ht.valves[k]).toBeCloseTo(1);
  });

  it('still opens upward and closes to the right on a flipped tool', () => {
    const sep = new Tool('separator', 0);
    flip(sep);
    const v = valveLocal(sep, 0);
    aimValve(sep, 0, v.x, v.y - 30);
    expect(sep.valves[0]).toBeCloseTo(1);
    aimValve(sep, 0, v.x + 30, v.y);
    expect(sep.valves[0]).toBeCloseTo(0);
  });

  it('opens pointing up, closes pointing right, and ignores the core', () => {
    const t = new Tool('dispenser', 0);
    const v = valveLocal(t, 0);
    aimValve(t, 0, v.x, v.y - 30);
    expect(t.valves[0]).toBeCloseTo(1);
    aimValve(t, 0, v.x + 30, v.y);
    expect(t.valves[0]).toBeCloseTo(0);
    aimValve(t, 0, v.x + 20, v.y - 20);
    expect(t.valves[0]).toBeCloseTo(0.5);
    aimValve(t, 0, v.x + 2, v.y - 2);
    expect(t.valves[0]).toBeCloseTo(0.5);
  });

  it("sweeps a splitter's from all left to all right", () => {
    const t = new Tool('splitter', 0);
    const v = valveLocal(t, 0);
    aimValve(t, 0, v.x - 30, v.y);
    expect(t.valves[0]).toBeCloseTo(0);
    aimValve(t, 0, v.x + 30, v.y);
    expect(t.valves[0]).toBeCloseTo(1);
    aimValve(t, 0, v.x, v.y - 30);
    expect(t.valves[0]).toBeCloseTo(0.5);
  });
});

describe('flasks in the room', () => {
  it('pour from their right lip, which swings down and under as they tip', () => {
    const f = new Flask(CAP);
    f.pose = at(0, 500, 0);
    expect(flaskLip(f).x).toBeGreaterThan(0);
    f.tilt = Math.PI / 2;
    expect(flaskLip(f).x).toBeCloseTo(0);
    expect(flaskLip(f).y).toBeLessThan(500);
    // turned to face the other way, it pours to the other side
    f.tilt = 0.3;
    f.pose = at(0, 500, 0, Math.PI);
    expect(flaskLip(f).x).toBeLessThan(0);
  });

  it('catch what falls on their mouth', () => {
    const f = new Flask(CAP);
    f.pose = at(10, 400, 20);
    expect(mouthBelow([flaskMouth(f)], { x: 15, y: 600, z: 25 })?.v).toBe(f);
    expect(mouthBelow([flaskMouth(f)], { x: 40, y: 600, z: 20 })).toBeNull();
  });
});

describe('scaleSpot', () => {
  const sc = new Scale(at(0, 400, 0));
  it('stands a flask let go just over the platform on it, kept off its ends', () => {
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H + 20, z: 0 })).toBeCloseTo(30);
    expect(scaleSpot(sc, { x: 90, y: 400 + FLASK_H + 5, z: 10 })).toBeCloseTo(68);
    expect(onScale(sc, 30).y).toBeCloseTo(400 + FLASK_H);
  });

  it("leaves one that's too high, too low or off to the side", () => {
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H + 120, z: 0 })).toBeNull();
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H - 40, z: 0 })).toBeNull();
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H, z: 80 })).toBeNull();
    expect(scaleSpot(sc, { x: 130, y: 400 + FLASK_H, z: 0 })).toBeNull();
  });
});
