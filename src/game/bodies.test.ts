import { describe, expect, it } from 'vitest';
import {
  FAUCET_NECK, FAUCET_Y, FLASK_R, NOZZLE_R, SCALE_SLOTS, TOOL_DEPTH, bathAt, dippedIn, docked, faucetBox, faucetPipes, flaskArm, flaskBox,
  flaskFluid, flaskLip, flaskMouth, footAt, insideVessel, isDocked, nozzleArm, nozzleBox, onScale, scaleArm, scaleBox, scaleSpot, spoutAt, spoutNear,
  tankFluid, tankMouth, toolArms, toolBox, turnValve, newTurn, leverAt, setLever, valveLocal, valveNear, SHEET_SLOT, SLOT_REACH, inSlot, sheetIn, slotted,
} from './bodies';
import { LAMP_POSE, STATION_POSE } from './presets';
import { singleOf } from '../chem/species';
import { CAP } from './config';
import { COLOR_FAUCETS, FAUCET_X } from './faucets';
import { Flask } from './flask';
import { FLASK_H } from './flaskShape';
import { boxesOverlap, solids } from './physics';
import { Scale } from './scale';
import { BENCH, CELL, LIFT, PLANE_Z, fromFrac, toFrac } from './space';
import { BULB_Y, Hose, INLINE_DOCK, LAMP, SHAPES, SHEET, STRIP_FOOT, THERMOMETER_ROD, Tool, footY, mouthBelow, tankX, type ToolKind } from './tools';

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

describe('tool shapes', () => {
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
  it('drip from a spout into the tank of a tool hung right under it', () => {
    const top = new Tool('dispenser', 0, at(100, 800, PLANE_Z));
    const below = new Tool('dispenser', 1, at(100, 600, PLANE_Z));
    const m = mouthBelow([tankMouth(top, 0), tankMouth(below, 0)], spoutAt(top, 0));
    expect(m?.v).toBe(below.tanks[0]);
    // and past it, a CELL along, into nothing
    below.pose = at(100 + CELL, 600, PLANE_Z);
    expect(mouthBelow([tankMouth(top, 0), tankMouth(below, 0)], spoutAt(top, 0))).toBeNull();
  });

  it("drip from a row of spouts into a row of flasks a CELL apart under them", () => {
    const sep = new Tool('separator', 0, at(1000, 800, PLANE_Z));
    const flasks = sep.shape.spouts.map((x) => {
      const f = new Flask(CAP);
      f.pose = at(1000 + x, LIFT + FLASK_H, PLANE_Z);
      return f;
    });
    sep.shape.spouts.forEach((_, j) => expect(mouthBelow(flasks.map(flaskMouth), spoutAt(sep, j))?.v).toBe(flasks[j]));
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
  });
});

describe('valveNear', () => {
  it('finds the nearest valve within reach of its lever, and none further off', () => {
    const ex = new Tool('exchanger', 0);
    const v = valveLocal(ex, 1);
    expect(valveNear(ex, v.x + 5, v.y + 3)).toBe(1);
    expect(valveNear(ex, v.x + 40, v.y + 40)).toBeNull();
    expect(valveNear(new Tool('sorter', 0), 0, 0)).toBeNull();
  });
});

describe('turnValve', () => {
  /** Turn valve k from scratch with the pointer at each of these points round it, at radius r, by angle clockwise from straight up. */
  const round = (t: Tool, k: number, degrees: number[], r = 20, turn = newTurn()): number[] => {
    const v = valveLocal(t, k);
    return degrees.map((d) => {
      const a = (d * Math.PI) / 180;
      turnValve(t, k, v.x + r * Math.sin(a), v.y - r * Math.cos(a), turn);
      return t.valves[k];
    });
  };
  /** Every whole degree from `a` to `b`, the way it goes. */
  const sweep = (a: number, b: number): number[] => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => a + Math.sign(b - a) * i);

  it("sets a dial to where it's first pointed, clockwise from down-left, off, to down-right, full", () => {
    const ht = new Tool('heater', 0);
    const k = ht.shape.dial!;
    expect(round(ht, k, [-135])[0]).toBeCloseTo(0);
    expect(round(ht, k, [0])[0]).toBeCloseTo(0.5);
    expect(round(ht, k, [135])[0]).toBeCloseTo(1);
    // first pointed into the gap at the bottom, it stays where it was
    ht.valves[k] = 0.3;
    expect(round(ht, k, [180])[0]).toBe(0.3);
  });

  it('then follows the pointer round, staying at the end it reaches however far round it goes, and coming back as it does', () => {
    const ht = new Tool('heater', 0);
    const k = ht.shape.dial!;
    const turn = newTurn();
    // from straight up, clockwise round twice: up to full at down-right, and full from there on, across the gap too
    const there = round(ht, k, sweep(0, 720), 20, turn);
    expect(there[135]).toBeCloseTo(1);
    expect(Math.min(...there.slice(135))).toBeCloseTo(1);
    for (let i = 1; i < there.length; i++) expect(there[i]).toBeGreaterThanOrEqual(there[i - 1]);
    // and back the other way, down as soon as it turns back, to off, and off from there on
    const back = round(ht, k, sweep(720, -90), 20, turn);
    expect(back[45]).toBeCloseTo(1 - 45 / 270);
    expect(back[270]).toBeCloseTo(0);
    expect(Math.max(...back.slice(270))).toBeCloseTo(0);
    for (let i = 1; i < back.length; i++) expect(back[i]).toBeLessThanOrEqual(back[i - 1]);
  });

  it('opens a valve pointed up, closes it pointed right, and follows from there, clamped', () => {
    const t = new Tool('dispenser', 0);
    expect(round(t, 0, [0])[0]).toBeCloseTo(1);
    expect(round(t, 0, [90])[0]).toBeCloseTo(0);
    expect(round(t, 0, [45])[0]).toBeCloseTo(0.5);
    const turn = newTurn();
    // from half open, a full turn counterclockwise opens it all the way, and a quarter back closes it
    const open = round(t, 0, sweep(45, -315), 20, turn);
    expect(open[open.length - 1]).toBe(1);
    expect(round(t, 0, sweep(-315, -225), 20, turn).pop()).toBeCloseTo(0);
  });

  it('opens a valve the other way too, pointed down, by how far its lever is from shut either way', () => {
    const t = new Tool('dispenser', 0);
    expect(round(t, 0, [180])[0]).toBeCloseTo(1);
    expect(t.sides[0]).toBe(-1);
    expect(round(t, 0, [135])[0]).toBeCloseTo(0.5);
    expect(t.sides[0]).toBe(-1);
    expect(leverAt(t, 0)).toBeCloseTo(-0.5);
    expect(round(t, 0, [45])[0]).toBeCloseTo(0.5);
    expect(t.sides[0]).toBe(1);
    // pointed left, outside the sweep, it stays where it was
    expect(round(t, 0, [270])[0]).toBeCloseTo(0.5);
    expect(t.sides[0]).toBe(1);
  });

  it('turns smoothly through shut from one side to the other, clamped a quarter turn either way', () => {
    const t = new Tool('dispenser', 0);
    const turn = newTurn();
    // from open up, clockwise: shut at straight right, then opening down, all the way at straight down, and no further
    const down = sweep(0, 300).map((d) => (round(t, 0, [d], 20, turn), leverAt(t, 0)));
    expect(down[0]).toBeCloseTo(1);
    expect(down[90]).toBeCloseTo(0);
    expect(down[180]).toBeCloseTo(-1);
    expect(Math.max(...down.slice(180))).toBeCloseTo(-1);
    for (let i = 1; i < down.length; i++) {
      expect(down[i]).toBeLessThanOrEqual(down[i - 1]);
      // no jumps
      expect(down[i - 1] - down[i]).toBeLessThan(1 / 90 + 1e-9);
    }
    expect([t.valves[0], t.sides[0]]).toEqual([1, -1]);
    // and back off the end as soon as it turns back, through shut and up again
    const up = sweep(300, 90).map((d) => (round(t, 0, [d], 20, turn), leverAt(t, 0)));
    expect(up[30]).toBeCloseTo(-1 + 30 / 90);
    expect(up[90]).toBeCloseTo(0);
    expect(up[180]).toBeCloseTo(1);
    expect(up[210]).toBe(1);
    expect([t.valves[0], t.sides[0]]).toEqual([1, 1]);
  });

  it("sets a plain valve's lever either side of shut, the usual way at shut", () => {
    const t = new Tool('dispenser', 0);
    setLever(t, 0, -0.25);
    expect([t.valves[0], t.sides[0]]).toEqual([0.25, -1]);
    setLever(t, 0, -3);
    expect([t.valves[0], t.sides[0]]).toEqual([1, -1]);
    setLever(t, 0, 0);
    expect([t.valves[0], t.sides[0]]).toEqual([0, 1]);
    setLever(t, 0, 2);
    expect([t.valves[0], t.sides[0]]).toEqual([1, 1]);
  });

  it('keeps a valve where it is in its core, and picks the pointer up again where it comes out', () => {
    const t = new Tool('dispenser', 0);
    const v = valveLocal(t, 0);
    const turn = newTurn();
    round(t, 0, [45], 20, turn);
    turnValve(t, 0, v.x + 2, v.y - 2, turn);
    expect(t.valves[0]).toBeCloseTo(0.5);
    // out the other side of the core, it's where it was, and goes on from there
    expect(round(t, 0, [225, 215], 20, turn)).toEqual([expect.closeTo(0.5), expect.closeTo(0.5 + 10 / 90)]);
  });

  it("sweeps a splitter's or multiplexer's lever from all left to all right over the top", () => {
    for (const kind of ['splitter', 'multiplexer'] as const) {
      const t = new Tool(kind, 0);
      expect(round(t, 0, [-90])[0], kind).toBeCloseTo(0);
      expect(round(t, 0, [0])[0], kind).toBeCloseTo(0.5);
      expect(round(t, 0, [90])[0], kind).toBeCloseTo(1);
      // past all right, round underneath, it stays all right
      const turn = newTurn();
      expect(round(t, 0, sweep(0, 260), 20, turn).pop(), kind).toBe(1);
    }
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

describe('docking', () => {
  it("snaps a nozzle down onto an inline instrument's tube it's over, from not too far above, and nothing else", () => {
    const a = new Tool('spectroscope', 0, at(450, 800, PLANE_Z));
    const d = new Tool('dispenser', 1, at(750, 800, PLANE_Z));
    const top = tankMouth(a, 0);
    const over = (dy: number, x = top.x) => ({ x, y: top.y + dy, z: top.z, yaw: 0 });
    expect(docked(over(100), [a, d]).y).toBeCloseTo(top.y + 1);
    expect(docked(over(INLINE_DOCK + 1), [a, d]).y).toBeCloseTo(top.y + INLINE_DOCK + 1);
    expect(docked(over(-20), [a, d]).y).toBeCloseTo(top.y - 20);
    expect(docked(over(100, top.x + 30), [a, d]).y).toBeCloseTo(top.y + 100);
    const tank = tankMouth(d, 0);
    expect(docked({ ...over(100), x: tank.x }, [a, d]).y).toBeCloseTo(top.y + 100);
    // docked, the nozzle sits clear of the tube
    expect(boxesOverlap(nozzleBox(new Hose({ faucet: 0 }, docked(over(100), [a]))), toolBox(a))).toBe(false);
  });

  it("centers a nozzle over the tube it snaps onto", () => {
    const a = new Tool('spectroscope', 0, at(450, 800, PLANE_Z));
    const top = tankMouth(a, 0);
    const off = top.hx / 2;
    const p = docked({ x: top.x + off, y: top.y + 50, z: top.z, yaw: 0 }, [a]);
    expect(p.x).toBeCloseTo(top.x, 9);
    expect(p.z).toBe(top.z);
    // one that doesn't snap stays where it was let go
    expect(docked({ x: top.x + off, y: top.y + INLINE_DOCK + 5, z: top.z, yaw: 0 }, [a]).x).toBe(top.x + off);
  });

  it("snaps a nozzle onto a flow meter's tube, clear of it", () => {
    const m = new Tool('meter', 0, at(450, 800, PLANE_Z));
    const top = tankMouth(m, 0);
    const p = docked({ x: top.x, y: top.y + 100, z: top.z, yaw: 0 }, [m]);
    expect(p.y).toBeCloseTo(top.y + 1);
    expect(boxesOverlap(nozzleBox(new Hose({ faucet: 0 }, p)), toolBox(m))).toBe(false);
  });

  it("tells a nozzle snapped onto a tube from one left near it", () => {
    const a = new Tool('spectroscope', 0, at(450, 800, PLANE_Z));
    const d = new Tool('dispenser', 1, at(750, 800, PLANE_Z));
    const top = tankMouth(a, 0);
    const h = new Hose({ faucet: 0 }, docked({ x: top.x + 2, y: top.y + 30, z: top.z, yaw: 0 }, [a, d]));
    expect(isDocked(h, [a, d])).toBe(true);
    // not without the instrument, nor above it, nor beside it
    expect(isDocked(h, [d])).toBe(false);
    h.outlet = { ...h.outlet, y: top.y + 30 };
    expect(isDocked(h, [a, d])).toBe(false);
    h.outlet = { ...h.outlet, x: top.x + 10, y: top.y + 1 };
    expect(isDocked(h, [a, d])).toBe(false);
    // nor over a tank that isn't an instrument's
    const tank = tankMouth(d, 0);
    expect(isDocked(new Hose({ faucet: 0 }, { x: tank.x, y: tank.y + 1, z: tank.z }), [a, d])).toBe(false);
  });
});

describe('arms', () => {
  it('hold a narrow tool up by one in its middle, gripping its back near its top', () => {
    const t = new Tool('dispenser', 0, at(300, 800, PLANE_Z));
    const arms = toolArms(t);
    expect(arms).toHaveLength(1);
    const [a] = arms;
    const b = t.shape.box;
    expect(a.x).toBeCloseTo(300 + (b.x0 + b.x1) / 2, 9);
    expect(a.z).toBeCloseTo(PLANE_Z - TOOL_DEPTH.dispenser.body / 2, 9);
    expect(a.z).toBeGreaterThan(0);
    expect(a.y).toBeLessThanOrEqual(800 - b.y0);
    expect(a.y).toBeGreaterThan(800 - b.y1);
    // on the tool's box, at its back
    const box = toolBox(t);
    expect(Math.abs(a.x - box.x)).toBeLessThanOrEqual(box.hx);
    expect(Math.abs(a.y - box.y)).toBeLessThanOrEqual(box.hy);
    expect(a.z).toBeCloseTo(box.z - box.hz, 9);
  });

  it('hold a wide tool up by two, one near each end', () => {
    const t = new Tool('separator', 0, at(1000, 800, PLANE_Z));
    const b = t.shape.box;
    const arms = toolArms(t);
    expect(arms).toHaveLength(2);
    const [l, r] = arms;
    expect(l.x).toBeGreaterThan(1000 + b.x0);
    expect(l.x).toBeLessThan(1000);
    expect(r.x).toBeGreaterThan(1000);
    expect(r.x).toBeLessThan(1000 + b.x1);
    expect(l.y).toBe(r.y);
    for (const a of arms) expect(a.z).toBeLessThan(PLANE_Z);
  });

  it('hold up nothing built into the wall', () => {
    expect(toolArms(new Tool('receptacle', 0, at(1000, 800, PLANE_Z)))).toHaveLength(0);
  });

  it("grip a thermometer by the top of its rod, the part of it that bumps into things", () => {
    const t = new Tool('thermometer', 9, at(150, 800, PLANE_Z));
    const [a] = toolArms(t);
    expect(800 - a.y).toBeLessThan(THERMOMETER_ROD.h / 4);
    const [top] = solids(toolBox(t));
    expect(Math.abs(a.y - top.y)).toBeLessThanOrEqual(top.hy);
  });

  it("grip a flask, a scale and a hose's nozzle from behind, straight back from them", () => {
    const f = new Flask(CAP);
    f.pose = at(300, 700, PLANE_Z);
    const fa = flaskArm(f);
    expect(fa.x).toBe(300);
    expect(fa.z).toBeLessThan(PLANE_Z);
    expect(fa.y).toBeLessThan(700);
    expect(fa.y).toBeGreaterThan(700 - FLASK_H);
    const sc = new Scale(at(500, 700, PLANE_Z));
    const sa = scaleArm(sc);
    expect(sa.x).toBe(500);
    expect(sa.y).toBeLessThan(700);
    const sb = scaleBox(sc);
    expect(sa.z).toBeCloseTo(sb.z - sb.hz, 9);
    const h = new Hose({ faucet: 0 }, { x: 700, y: 650, z: PLANE_Z });
    const na = nozzleArm(h);
    expect(na).toEqual({ x: 700, y: na.y, z: PLANE_Z - NOZZLE_R });
    const nb = nozzleBox(h);
    expect(Math.abs(na.y - nb.y)).toBeLessThanOrEqual(nb.hy);
  });
});

describe('faucets', () => {
  it('have their spouts in a row along the wall where FAUCET_X says, out in the plane', () => {
    const pipes = faucetPipes();
    expect(pipes.map((p) => p.spout.x)).toEqual([...FAUCET_X]);
    for (const { spout, wall } of pipes) {
      expect(spout.y).toBe(FAUCET_Y);
      expect(spout.z).toBe(PLANE_Z);
      // its pipe leaves the wall straight behind and above it
      expect(wall.x).toBe(spout.x);
      expect(wall.y).toBe(FAUCET_Y + FAUCET_NECK);
      expect(wall.z).toBeLessThan(spout.z);
      expect(wall.z).toBeGreaterThanOrEqual(0);
    }
  });

  it("are boxed from the spout up past the knob, and back to the wall, clear of each other", () => {
    const pipes = faucetPipes();
    const boxes = pipes.map((p) => faucetBox(p.spout));
    pipes.forEach(({ spout, wall }, i) => {
      const b = boxes[i];
      expect(b.x).toBe(spout.x);
      expect(b.y - b.hy).toBeCloseTo(spout.y, 9);
      expect(b.y + b.hy).toBeGreaterThan(wall.y);
      expect(b.z - b.hz).toBeCloseTo(0, 9);
      expect(b.z + b.hz).toBeGreaterThan(spout.z);
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(boxesOverlap(boxes[i], boxes[j])).toBe(false);
  });

  it('come after the supply station, which is next to the cabinet, clear of it and of the shadow lamp', () => {
    const station = toolBox(new Tool('receptacle', 0, { ...STATION_POSE }));
    const lamp = toolBox(new Tool('shadowlamp', 1, { ...LAMP_POSE }));
    expect(station.x - station.hx).toBeGreaterThanOrEqual(BENCH.x0);
    for (const { spout } of faucetPipes()) {
      const b = faucetBox(spout);
      expect(b.x - b.hx).toBeGreaterThan(station.x + station.hx);
      expect(boxesOverlap(b, station)).toBe(false);
      expect(boxesOverlap(b, lamp)).toBe(false);
    }
    // the first row is between the station and the lamp
    expect(FAUCET_X[COLOR_FAUCETS]).toBeLessThan(lamp.x - lamp.hx);
  });

  it('leave room under them for a flask on a scale on the counter, to fill it', () => {
    const [{ spout }] = faucetPipes();
    const sc = new Scale(at(spout.x - SCALE_SLOTS[1], LIFT, PLANE_Z));
    const f = new Flask(CAP);
    f.pose = onScale(sc, SCALE_SLOTS[1]);
    expect(boxesOverlap(flaskBox(f), faucetBox(spout))).toBe(false);
    expect(boxesOverlap(scaleBox(sc, true), faucetBox(spout))).toBe(false);
    expect(mouthBelow([flaskMouth(f)], spout)?.v).toBe(f);
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

describe('dippers', () => {
  const R = singleOf('R');
  /** A thermometer standing upright with its bulb at p. */
  const dipped = (p: { x: number; y: number; z: number }) => new Tool('thermometer', 9, at(p.x, p.y + BULB_Y, p.z));

  it('bump into nothing below the top of the rod, where its arm holds it, so it can stand down in a flask', () => {
    const f = new Flask(CAP);
    f.pose = at(150, LIFT + FLASK_H, 150);
    const t = dipped({ x: 150, y: LIFT + 10, z: 150 });
    expect(boxesOverlap(toolBox(t), flaskBox(f))).toBe(false);
    // its top still does
    expect(boxesOverlap(toolBox(t), toolBox(new Tool('thermometer', 8, at(151, t.pose.y, 150))))).toBe(true);
  });

  it("are in a flask's fluid with their bulb below its surface, inside its outline", () => {
    const f = new Flask(CAP);
    f.pose = at(150, LIFT + FLASK_H, 150);
    f.setMolecules(R, (2 / 3) * CAP);
    const { floor, surface } = flaskFluid(f);
    expect(floor).toBe(LIFT);
    expect(surface).toBeGreaterThan(floor);
    expect(surface).toBeLessThan(f.pose.y);
    const mid = { x: 150, y: (floor + surface) / 2, z: 150 };
    expect(footAt(dipped(mid)).y).toBeCloseTo(mid.y, 9);
    expect(bathAt(mid, [f], [])).toBe(f);
    // above the surface, or outside the glass at that height
    expect(bathAt({ ...mid, y: surface + 2 }, [f], [])).toBeNull();
    expect(bathAt({ ...mid, x: 150 + FLASK_R + 2 }, [f], [])).toBeNull();
    expect(bathAt({ ...mid, y: floor - 2 }, [f], [])).toBeNull();
    // tipped to pour, it holds nothing to dip in
    f.tilt = 1;
    expect(bathAt(mid, [f], [])).toBeNull();
    f.tilt = 0;
    // and empty, nothing
    f.setMolecules(R, 0);
    expect(bathAt(mid, [f], [])).toBeNull();
    expect(flaskFluid(f).surface).toBe(floor);
  });

  it("are in a tank's fluid with their bulb below its surface, within its walls", () => {
    const t = new Tool('dispenser', 0, at(300, 700, 150));
    t.tanks[0].setMolecules(R, t.tanks[0].cap / 2);
    const { floor, surface } = tankFluid(t, 0);
    expect(surface).toBeGreaterThan(floor);
    expect(surface).toBeLessThan(700);
    const mid = { x: 300, y: (floor + surface) / 2, z: 150 };
    expect(bathAt(mid, [], [t])).toBe(t.tanks[0]);
    expect(bathAt({ ...mid, x: 300 + SHAPES.dispenser.tanks[0].x1 + 2 }, [], [t])).toBeNull();
    expect(bathAt({ ...mid, y: surface + 2 }, [], [t])).toBeNull();
    t.tanks[0].setMolecules(R, 0);
    expect(bathAt(mid, [], [t])).toBeNull();
  });
  it("have a strip's foot at the tip of its paper, and only its clip bumps into anything", () => {
    const t = new Tool('strip', 9, at(150, LIFT + 200, 150));
    const foot = footAt(t);
    expect(foot.x).toBeCloseTo(150, 9);
    expect(foot.z).toBeCloseTo(150, 9);
    expect(foot.y).toBeCloseTo(LIFT + 200 - (STRIP_FOOT - 0.5), 9);
    // stood with its foot in a flask's fluid, it's in it, and doesn't bump into the flask
    const f = new Flask(CAP);
    f.pose = at(150, LIFT + FLASK_H, 150);
    f.setMolecules(R, CAP / 2);
    const { floor, surface } = flaskFluid(f);
    t.pose = at(150, (floor + surface) / 2 + footY('strip'), 150);
    expect(bathAt(footAt(t), [f], [])).toBe(f);
    expect(boxesOverlap(toolBox(t), flaskBox(f))).toBe(false);
  });
});

describe('insideVessel', () => {
  const R = singleOf('R');

  it("finds the flask a point is inside, whether or not it's in its fluid, where dippedIn needs the fluid", () => {
    const f = new Flask(CAP);
    f.pose = at(150, LIFT + FLASK_H, PLANE_Z);
    const { floor } = flaskFluid(f);
    const low = { x: 150, y: floor + 5, z: PLANE_Z };
    const high = { x: 150, y: f.pose.y - 5, z: PLANE_Z };
    // empty: inside it, but in no fluid
    expect(insideVessel(low, [f], [])).toBe(f);
    expect(dippedIn(low, [f], [])).toBeNull();
    expect(bathAt(low, [f], [])).toBeNull();
    // a third full: in its fluid low down, only inside it higher up
    f.setMolecules(R, CAP / 3);
    const { surface } = flaskFluid(f);
    expect(surface).toBeGreaterThan(low.y);
    expect(surface).toBeLessThan(high.y);
    expect(insideVessel(low, [f], [])).toBe(f);
    expect(bathAt(low, [f], [])).toBe(f);
    expect(dippedIn(low, [f], [])?.depth).toBeCloseTo(surface - low.y, 6);
    expect(insideVessel(high, [f], [])).toBe(f);
    expect(bathAt(high, [f], [])).toBeNull();
    // outside the glass, above its mouth or below its floor, in none
    for (const p of [{ ...low, x: 150 + FLASK_R + 2 }, { ...high, y: f.pose.y + 5 }, { ...low, y: floor - 2 }]) {
      expect(insideVessel(p, [f], [])).toBeNull();
      expect(bathAt(p, [f], [])).toBeNull();
    }
    // tipped to pour, in none
    f.tilt = 1;
    expect(insideVessel(low, [f], [])).toBeNull();
  });

  it("finds the tank a point is inside, whether or not it's in its fluid", () => {
    const t = new Tool('dispenser', 0, at(300, 800, PLANE_Z));
    const { floor } = tankFluid(t, 0);
    const low = { x: 300, y: floor + 5, z: PLANE_Z };
    const high = { x: 300, y: 795, z: PLANE_Z };
    expect(insideVessel(low, [], [t])).toBe(t.tanks[0]);
    expect(bathAt(low, [], [t])).toBeNull();
    t.tanks[0].setMolecules(R, t.tanks[0].cap / 3);
    const { surface } = tankFluid(t, 0);
    expect(surface).toBeGreaterThan(low.y);
    expect(surface).toBeLessThan(high.y);
    expect(insideVessel(low, [], [t])).toBe(t.tanks[0]);
    expect(bathAt(low, [], [t])).toBe(t.tanks[0]);
    expect(insideVessel(high, [], [t])).toBe(t.tanks[0]);
    expect(bathAt(high, [], [t])).toBeNull();
    // beside its walls, or below its floor, in none
    for (const p of [{ ...low, x: 300 + SHAPES.dispenser.tanks[0].x1 + 2 }, { ...low, y: floor - 2 }]) {
      expect(insideVessel(p, [], [t])).toBeNull();
      expect(bathAt(p, [], [t])).toBeNull();
    }
  });

  it("never finds the supply station's tanks, in the wall", () => {
    const r = new Tool('receptacle', 0, at(1000, 800, PLANE_Z));
    r.tanks[1].setMolecules(R, r.tanks[1].cap / 2);
    const m = tankMouth(r, 1);
    for (let dy = 0; dy < 400; dy += 10) {
      const p = { x: m.x, y: m.y - dy, z: PLANE_Z };
      expect(insideVessel(p, [], [r])).toBeNull();
      expect(bathAt(p, [], [r])).toBeNull();
    }
  });
});

describe("the shadow lamp's slot", () => {
  const lamp = () => new Tool('shadowlamp', 0, { ...LAMP_POSE });

  it("stands a sheet of shadow paper behind the lamp's pane, its margin behind the frame and its bar showing above it", () => {
    const s = new Tool('sheet', 1, { ...SHEET_SLOT });
    // the paper's lit square is the pane, exactly
    const paperTop = SHEET_SLOT.y - SHEET.top;
    expect(paperTop - SHEET.margin).toBeCloseTo(LAMP_POSE.y - LAMP.pane.y, 9);
    expect(SHEET_SLOT.x).toBe(LAMP_POSE.x);
    // its bar is above the frame's top, to take it out by
    expect(SHEET_SLOT.y).toBeGreaterThan(LAMP_POSE.y);
    // in the wall behind the frame, so in neither's way
    expect(boxesOverlap(toolBox(s), toolBox(lamp()))).toBe(false);
    // where a sheet pinned to the wall anywhere else would be in the frame's way
    expect(boxesOverlap(toolBox(new Tool('sheet', 2, { ...SHEET_SLOT, y: SHEET_SLOT.y + 1 })), toolBox(lamp()))).toBe(true);
    expect(inSlot(s.pose)).toBe(true);
    expect(sheetIn([lamp(), s])).toBe(s);
    expect(sheetIn([lamp(), s], s)).toBeNull();
  });

  it('takes a sheet let go of near it, if the lamp is there and its slot is empty', () => {
    const near = { ...SHEET_SLOT, x: SHEET_SLOT.x + SLOT_REACH.x - 1, y: SHEET_SLOT.y - SLOT_REACH.y + 1 };
    const s = new Tool('sheet', 1, near);
    expect(slotted(s, near, [lamp()])).toEqual(SHEET_SLOT);
    // too far from it, or with no lamp, or a sheet in it already, it's just where it's held
    const far = { ...near, x: SHEET_SLOT.x + SLOT_REACH.x + 1 };
    expect(slotted(s, far, [lamp()])).toEqual(far);
    expect(slotted(s, near, [])).toEqual(near);
    expect(slotted(s, near, [lamp(), new Tool('sheet', 2, { ...SHEET_SLOT })])).toEqual(near);
  });

  it("leaves the lamp's frame and what's pinned to the wall out of the way of what's in the plane in front of them", () => {
    const f = new Flask(CAP);
    f.pose = { x: LAMP_POSE.x, y: LIFT + FLASK_H, z: PLANE_Z, yaw: 0 };
    expect(boxesOverlap(flaskBox(f), toolBox(lamp()))).toBe(false);
    expect(boxesOverlap(flaskBox(f), toolBox(new Tool('sheet', 1, { ...SHEET_SLOT })))).toBe(false);
    expect(boxesOverlap(flaskBox(f), toolBox(new Tool('testpaper', 1, { x: LAMP_POSE.x + 300, y: LIFT + 70, z: PLANE_Z, yaw: 0 })))).toBe(false);
    expect(toolArms(lamp())).toEqual([]);
    expect(toolArms(new Tool('sheet', 1, { x: 4000, y: 900, z: PLANE_Z, yaw: 0 }))).toEqual([]);
  });
});
