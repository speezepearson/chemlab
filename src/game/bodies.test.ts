import { describe, expect, it } from 'vitest';
import {
  FLASK_R, NOZZLE_REACH, SCALE_ANCHOR, SCALE_SLOTS, STAND_BASE, aimValve, onGrid, toolAnchor, flaskBox, flaskLip, flaskMouth, flip,
  docked, nozzleBox, nozzleMounts, nozzleStand, onScale, scaleSpot, snapReach, spoutNear, spoutAt, standBase, tankMouth, toolBox, toolStands, valveLocal,
  valveNear,
} from './bodies';
import { CAP } from './config';
import { Flask } from './flask';
import { FLASK_H } from './flaskShape';
import { boxesOverlap } from './physics';
import { Scale } from './scale';
import { CELL, COUNTERS, LIFT, counterUnder, fromFrac, toCell, toFrac } from './space';
import { Hose, INLINE_DOCK, SHAPES, Tool, mouthBelow, tankX, type ToolKind } from './tools';

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

describe('the grid', () => {
  it("runs along every counter's edges", () => {
    for (const c of COUNTERS) for (const v of [c.x0, c.x1, c.z0, c.z1]) expect(v / CELL).toBeCloseTo(Math.round(v / CELL), 9);
  });

  it('puts a pose over the middle of the cell its anchor is in, facing the nearest way along it', () => {
    const p = onGrid(at(130, 500, 470, 1.2), { x: 50, y: 0, z: 0 });
    expect(p.yaw).toBeCloseTo(Math.PI / 2);
    expect(p.y).toBe(500);
    // turned a quarter, the anchor is 50 toward −z from it
    expect(p.x).toBeCloseTo(150);
    expect(p.z - 50).toBeCloseTo(450);
  });

  it("puts every mouth and spout of a tool on it over the middle of a cell, however it's turned or flipped", () => {
    for (const kind of Object.keys(SHAPES) as ToolKind[])
      for (const yaw of [0.3, 1.9, -2.5])
        for (const flipped of [false, true]) {
          const t = new Tool(kind, 0);
          t.flipped = flipped && !!t.shape.flippable;
          t.pose = onGrid(at(321, 500, 777, yaw), toolAnchor(t));
          const pts = [...t.tanks.map((_, k) => tankMouth(t, k)), ...t.shape.spouts.map((_, j) => spoutAt(t, j))];
          for (const p of pts) {
            expect(toCell(p.x), kind).toBeCloseTo(p.x, 6);
            expect(toCell(p.z), kind).toBeCloseTo(p.z, 6);
          }
        }
  });

  it("puts both of a scale's places for a flask over cells' middles", () => {
    const sc = new Scale(onGrid(at(321, 500, 777, 2), SCALE_ANCHOR));
    for (const dx of SCALE_SLOTS) {
      const p = onScale(sc, dx);
      expect(toCell(p.x)).toBeCloseTo(p.x, 6);
      expect(toCell(p.z)).toBeCloseTo(p.z, 6);
    }
  });

  it("has every tool's mouths and spouts a whole number of cells apart, so they can all be over cells' middles", () => {
    for (const kind of Object.keys(SHAPES) as ToolKind[]) {
      const sh = SHAPES[kind];
      const xs = [...sh.tanks.map(tankX), ...sh.spouts];
      for (const x of xs) {
        const cells = (x - xs[0]) / CELL;
        expect(cells, kind).toBeCloseTo(Math.round(cells), 9);
      }
    }
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

  it('flip left to right about as near their middle as keeps them on the grid, mirroring their spouts', () => {
    for (const kind of ['separator', 'sorter', 'heater'] as const)
      for (const yaw of [0, Math.PI / 2]) {
        const t = new Tool(kind, 0);
        t.pose = onGrid(at(130, 500, 420, yaw), toolAnchor(t));
        const box = toolBox(t);
        const spouts = t.shape.spouts.map((_, j) => spoutAt(t, j));
        expect(flip(t)).toBe(true);
        expect(Math.hypot(toolBox(t).x - box.x, toolBox(t).z - box.z)).toBeLessThanOrEqual(CELL / 2);
        // the spout that was leftmost is now the rightmost, and they're all still over cells' middles
        const last = t.shape.spouts.length - 1;
        expect(spoutAt(t, last).x - spoutAt(t, 0).x).toBeCloseTo(spouts[0].x - spouts[last].x);
        for (let j = 0; j <= last; j++) {
          expect(toCell(spoutAt(t, j).x)).toBeCloseTo(spoutAt(t, j).x);
          expect(toCell(spoutAt(t, j).z)).toBeCloseTo(spoutAt(t, j).z);
        }
      }
    expect(flip(new Tool('dispenser', 1))).toBe(false);
  });

  it('bump into each other only where their boxes meet', () => {
    const a = new Tool('dispenser', 0, at(0, 500, 0));
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(60, 500, 0))))).toBe(true);
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(80, 500, 0))))).toBe(false);
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(0, 300, 0))))).toBe(false);
  });
});

describe('spoutNear', () => {
  it("finds the spout whose tip, or the pipe just above it, is under the crosshair, as the tool stands", () => {
    const sep = new Tool('separator', 0);
    const y = sep.shape.spoutY;
    expect(spoutNear(sep, sep.shape.spouts[1] + 3, y - 2)).toBe(1);
    expect(spoutNear(sep, sep.shape.spouts[4], y - 25)).toBe(4);
    expect(spoutNear(sep, sep.shape.spouts[4], y - 60)).toBeNull();
    expect(spoutNear(sep, (sep.shape.spouts[1] + sep.shape.spouts[2]) / 2, y)).toBeNull();
    sep.flipped = true;
    expect(spoutNear(sep, -sep.shape.spouts[0], y)).toBe(0);
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
  it('stands a flask let go just over the platform on it, at the nearer of its two places', () => {
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H + 20, z: 0 })).toBe(SCALE_SLOTS[1]);
    expect(scaleSpot(sc, { x: 90, y: 400 + FLASK_H + 5, z: 10 })).toBe(SCALE_SLOTS[1]);
    expect(scaleSpot(sc, { x: -10, y: 400 + FLASK_H + 5, z: 0 })).toBe(SCALE_SLOTS[0]);
    expect(onScale(sc, 30).y).toBeCloseTo(400 + FLASK_H);
  });

  it("leaves one that's too high, too low or off to the side", () => {
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H + 120, z: 0 })).toBeNull();
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H - 40, z: 0 })).toBeNull();
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H, z: 80 })).toBeNull();
    expect(scaleSpot(sc, { x: 130, y: 400 + FLASK_H, z: 0 })).toBeNull();
  });
});

describe('counterUnder', () => {
  const island = COUNTERS.find((c) => c.island)!;
  const mid = { x: (island.x0 + island.x1) / 2, z: (island.z0 + island.z1) / 2 };
  it('finds the counter a footprint lies wholly on, at any yaw', () => {
    expect(counterUnder({ ...mid, hx: 40, hz: 20, yaw: 0 })).toBe(LIFT);
    expect(counterUnder({ ...mid, hx: 40, hz: 20, yaw: 1 })).toBe(LIFT);
  });

  it("finds none for one hanging off an edge, or out in an aisle", () => {
    expect(counterUnder({ x: mid.x, z: island.z0 + 10, hx: 40, hz: 20, yaw: 0 })).toBeNull();
    expect(counterUnder({ x: mid.x, z: island.z0 - 100, hx: 10, hz: 10, yaw: 0 })).toBeNull();
  });
});

describe('stands', () => {
  it('hold a tool up from behind, their bases clear of a flask standing under its spout', () => {
    const t = new Tool('dispenser', 0, at(100, 600, 200));
    const [st, more] = toolStands(t);
    expect(more).toBeUndefined();
    expect(st.z).toBeLessThan(200);
    expect(st.clampY).toBeLessThan(600);
    const f = new Flask(CAP);
    const sp = spoutAt(t, 0);
    f.pose = at(sp.x, LIFT + 70, sp.z);
    expect(boxesOverlap(standBase(st, LIFT), flaskBox(f))).toBe(false);
    expect(st.z + STAND_BASE.hz).toBeLessThan(sp.z - FLASK_R);
  });

  it('turn with the tool, two to a wide tool, and none for one built into a wall', () => {
    const t = new Tool('dispenser', 0, at(0, 600, 0, Math.PI / 2));
    // turned a quarter, its back is toward −x
    expect(toolStands(t)[0].x).toBeLessThan(0);
    expect(toolStands(t)[0].z).toBeCloseTo(0);
    expect(toolStands(new Tool('separator', 0, at(0, 600, 0)))).toHaveLength(2);
    expect(toolStands(new Tool('receptacle', 0, at(0, 600, 0)))).toHaveLength(0);
  });

  it("hold a hose's nozzle from behind it, as it faces", () => {
    const e = { x: 10, y: 500, z: 300 };
    expect(nozzleStand(e, 0).z).toBeLessThan(300);
    expect(nozzleStand(e, Math.PI).z).toBeGreaterThan(300);
    expect(nozzleStand(e, Math.PI).x).toBeCloseTo(10);
  });

  it("hold a hose's nozzle as far behind it as its arm reaches, in steps, within its range", () => {
    const e = { x: 10, y: 500, z: 300 };
    expect(nozzleStand(e, 0).z).toBeCloseTo(300 - NOZZLE_REACH.min);
    expect(nozzleStand(e, 0, 200).z).toBeCloseTo(100);
    const { min, max, step } = NOZZLE_REACH;
    expect(snapReach(0)).toBe(min);
    expect(snapReach(1e6)).toBe(max);
    expect(snapReach(min + step * 0.6)).toBe(min + step);
    expect(snapReach(min + step * 0.4)).toBe(min);
  });

  it("try a nozzle's stand where it's wanted first, then further along the same way, then round it", () => {
    const want = { turn: 0, reach: NOZZLE_REACH.min + 2 * NOZZLE_REACH.step };
    const ms = nozzleMounts(want);
    expect(ms[0]).toEqual(want);
    const same = ms.filter((m) => m.turn === 0);
    expect(ms.slice(0, same.length)).toEqual(same);
    expect(same.map((m) => m.reach)).toContain(NOZZLE_REACH.min);
    expect(same.map((m) => m.reach)).toContain(NOZZLE_REACH.max);
    // the opposite way comes last
    expect(Math.abs(ms[ms.length - 1].turn)).toBeCloseTo(Math.PI);
    expect(new Set(ms.map((m) => `${m.turn.toFixed(3)} ${m.reach}`)).size).toBe(ms.length);
  });

  it("find somewhere for a nozzle's stand clear of a cabinet behind the tube it's over", () => {
    // turned a quarter, the analyzer's cabinet reaches back from its tube, toward the wall, standing on the counter
    const spec = new Tool('analyzer', 0, at(500, LIFT + 96, 250, Math.PI / 2));
    const tube = tankMouth(spec, 0);
    const e = { x: tube.x, y: tube.y + 40, z: tube.z };
    const clear = (m: { turn: number; reach: number }) => !boxesOverlap(standBase(nozzleStand(e, m.turn, m.reach), LIFT), toolBox(spec));
    expect(clear({ turn: 0, reach: NOZZLE_REACH.min })).toBe(false);
    const m = nozzleMounts({ turn: 0, reach: NOZZLE_REACH.min }).find(clear);
    expect(m?.turn).toBe(0);
  });
});

describe('docking', () => {
  it("snaps a nozzle down onto an inline instrument's tube it's over, from not too far above, and nothing else", () => {
    const a = new Tool('analyzer', 0, at(450, 800, 150));
    const d = new Tool('dispenser', 1, at(750, 800, 150));
    const top = tankMouth(a, 0);
    const over = (dy: number, x = top.x) => ({ x, y: top.y + dy, z: top.z, yaw: 0 });
    expect(docked(over(100), [a, d]).y).toBeCloseTo(top.y + 1);
    expect(docked(over(INLINE_DOCK + 1), [a, d]).y).toBeCloseTo(top.y + INLINE_DOCK + 1);
    expect(docked(over(-20), [a, d]).y).toBeCloseTo(top.y - 20);
    expect(docked(over(100, top.x + 30), [a, d]).y).toBeCloseTo(top.y + 100);
    const tank = tankMouth(d, 0);
    expect(docked({ ...over(100), x: tank.x }, [a, d]).y).toBeCloseTo(top.y + 100);
    // docked, the nozzle sits clear of the tube
    expect(boxesOverlap(nozzleBox(new Hose({ faucet: 0 }, docked(over(100), [a]), 0)), toolBox(a))).toBe(false);
  });
});

describe('collision shapes', () => {
  it('let flasks stand as close as their round bases, at any angle', () => {
    const a = new Flask(CAP);
    const b = new Flask(CAP);
    a.pose = at(0, 500, 0);
    const d = (2 * FLASK_R + 1) / Math.SQRT2;
    b.pose = at(d, 500, d);
    expect(boxesOverlap(flaskBox(a), flaskBox(b))).toBe(false);
    b.pose = at(2 * FLASK_R - 2, 500, 0);
    expect(boxesOverlap(flaskBox(a), flaskBox(b))).toBe(true);
  });

  it("let a flask's wide base come down beside another's narrow neck", () => {
    const a = new Flask(CAP);
    const b = new Flask(CAP);
    a.pose = at(0, 500, 0);
    // b's base, 28 across from its middle, level with a's neck, 12 across from its middle
    b.pose = at(42, 500 + FLASK_H - 10, 0);
    expect(boxesOverlap(flaskBox(a), flaskBox(b))).toBe(false);
  });

  it("are solid in a tool's tank and pipes, not the empty space beside its pipes", () => {
    const t = new Tool('separator', 0, at(0, 600, 0));
    const f = new Flask(CAP);
    // beside the tank, above the manifold: empty space within its bounding box
    f.pose = at(70, 600 - 10, 0);
    expect(boxesOverlap(toolBox(t), flaskBox(f))).toBe(false);
    f.pose = at(0, 600 - 40, 0);
    expect(boxesOverlap(toolBox(t), flaskBox(f))).toBe(true);
  });
});
