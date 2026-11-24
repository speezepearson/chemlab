import { describe, expect, it } from 'vitest';
import {
  FLASK_R, MAGNET, NOZZLE_REACH, SCALE_SLOTS, magnetShift, STAND_BASE, aimAngle, angleOf, settleAngle, swept, turnValve, valveAt, valveAngle, leverKind, VALVE_DEADZONE, VALVE_SHUT, DIAL_STOP, bathAt, footAt, dipPoses, DIP_FLOOR, DIP_HOVER, STRIP_FLOOR, STRIP_STOOD, flaskBox, flaskFluid, flaskLip, flaskMouth, tankFluid,
  docked, nozzleBox, nozzleMounts, nozzleStand, onScale, scaleBox, scaleSpot, snapReach, spoutAt, standBase, tankMouth, toolBounds, toolBox, toolStands,
  plumbZ,
} from './bodies';
import { SOLVENT_SPECIES, singleOf } from '../chem/species';
import { CAP } from './config';
import { Flask } from './flask';
import { FLASK_H } from './flaskShape';
import { AIRLOCK } from './airlock';
import { boxesOverlap, solids } from './physics';
import { LAMP_POSE } from './presets';
import { SCALE_SHAPE, Scale } from './scale';
import { CELL, COUNTERS, LAMP_AREA, LAMP_FLOOR, LAMP_Z, LIFT, ROOM, counterUnder, fromFrac, groundAt, toFrac, toWorld, wrapAngle } from './space';
import { SCALE_ANCHOR, onCell, toCell, toolAnchor } from './testLayout';
import { BULB_Y, COLUMN, SPOUT_STUB, TANK_H, Hose, INLINE_DOCK, LAMP, SCREEN, SHAPES, STRIP, STRIP_FOOT, THERMOMETER_ROD, Tool, dipUnder, footY, mouthBelow, type ToolKind } from './tools';

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

describe('cells', () => {
  it("are what every counter's edges are a whole number of", () => {
    for (const c of COUNTERS) for (const v of [c.x0, c.x1, c.z0, c.z1]) expect(v / CELL).toBeCloseTo(Math.round(v / CELL), 9);
  });
});

describe('magnetShift', () => {
  const v = () => new Flask(CAP);
  const mouth = (x: number, z: number, y = 100, hx = 15) => ({ v: v(), x, y, z, hx, hz: hx });
  const out = (x: number, z: number, y = 200) => ({ x, y, z });

  it('lines an outlet up over a mouth no further than MAGNET across, and no further', () => {
    const d = MAGNET - 1;
    const near = magnetShift({ outlets: [out(100 + d * 0.6, 50 + d * 0.8)], mouths: [] }, { outlets: [], mouths: [mouth(100, 50)] });
    expect(near).not.toBeNull();
    expect(near!.x).toBeCloseTo(-d * 0.6, 9);
    expect(near!.z).toBeCloseTo(-d * 0.8, 9);
    expect(near!.pairs).toBe(1);
    expect(magnetShift({ outlets: [out(100 + MAGNET + 1, 50)], mouths: [] }, { outlets: [], mouths: [mouth(100, 50)] })).toBeNull();
  });

  it('lines a mouth up under an outlet the same way, and an outlet only over a mouth below it', () => {
    const s = magnetShift({ outlets: [], mouths: [mouth(110, 50)] }, { outlets: [out(100, 50)], mouths: [] });
    expect(s && [s.x, s.z]).toEqual([-10, 0]);
    expect(magnetShift({ outlets: [], mouths: [mouth(110, 50, 300)] }, { outlets: [out(100, 50)], mouths: [] })).toBeNull();
    expect(magnetShift({ outlets: [out(110, 50, 50)], mouths: [] }, { outlets: [], mouths: [mouth(100, 50)] })).toBeNull();
  });

  it('picks the shift that lines up the most pairs at once, and the shortest of those that line up as many', () => {
    // five outlets a cell apart over five mouths a cell apart, though one of them is nearer another
    const outlets = [0, 1, 2, 3, 4].map((i) => out(i * CELL + 7, 0));
    const mouths = [0, 1, 2, 3, 4].map((i) => mouth(i * CELL, 0, 100, 5));
    const all = magnetShift({ outlets, mouths: [] }, { outlets: [], mouths: [...mouths, mouth(4 * CELL + 10, 2, 100, 4)] });
    expect(all!.pairs).toBe(5);
    expect(all!.x).toBeCloseTo(-7, 9);
    // of two that line up one each, the nearer
    const near = magnetShift({ outlets: [out(0, 0)], mouths: [] }, { outlets: [], mouths: [mouth(-8, 0, 100, 5), mouth(5, 0, 100, 5)] });
    expect(near!.x).toBeCloseTo(5, 9);
    // a row twice as far apart: only every other outlet can be over one, and the nearest of those ways wins
    const wide = [0, 1, 2].map((i) => mouth(2 * i * CELL + 3, 0, 100, 5));
    const some = magnetShift({ outlets, mouths: [] }, { outlets: [], mouths: wide });
    expect(some!.pairs).toBe(3);
    expect(some!.x).toBeCloseTo(-4, 9);
    // a row a little further apart than the outlets lines up just one, the nearest
    const off = [0, 1, 2, 3, 4].map((i) => mouth(i * (CELL + 8), 0, 100, 5));
    const one = magnetShift({ outlets, mouths: [] }, { outlets: [], mouths: off });
    expect(one!.pairs).toBe(1);
    expect(one!.x).toBeCloseTo(1, 9);
  });

  it('lines nothing up with a mouth hidden under another, nor an outlet with its own mouth', () => {
    // a wide mouth over a narrow one: the narrow one's fluid would land in the wide one
    const hidden = magnetShift({ outlets: [out(10, 0)], mouths: [] }, { outlets: [], mouths: [mouth(0, 0, 150, 40), mouth(0, 0, 100, 5)] });
    expect(hidden!.x).toBeCloseTo(-10, 9);
    const top = magnetShift({ outlets: [out(10, 0)], mouths: [] }, { outlets: [], mouths: [mouth(5, 0, 150, 40), mouth(0, 0, 100, 5)] });
    expect(top!.x).toBeCloseTo(-5, 9);
    // its own tank under its spout lines nothing up
    expect(magnetShift({ outlets: [out(10, 0)], mouths: [mouth(0, 0)] }, { outlets: [], mouths: [] })).toBeNull();
  });
});

describe('the shadow lamp', () => {
  const lamp = new Tool('shadowlamp', 0, { ...LAMP_POSE });
  const b = toolBox(lamp);
  const { h, wall, box, channel: ch } = LAMP;
  /** The middle of the channel's cell `i`, counting from the enclosure, in the room. */
  const cell = (i: number) => toWorld(LAMP_POSE, { x: ch.x0 + (i + 0.5) * CELL, y: 0, z: 0 });
  const cells = Math.round((ch.x1 - ch.x0) / CELL);
  const flaskAt = (x: number, z: number, y = LIFT) => {
    const f = new Flask(CAP);
    f.pose = at(x, y + FLASK_H, z);
    return f;
  };
  /** The ways a tool can face along the channel: toward the lamp, or toward the screen. */
  const [TO_LAMP, TO_SCREEN] = [LAMP_POSE.yaw - Math.PI / 2, LAMP_POSE.yaw + Math.PI / 2];
  /**
   * Whether a tool of a kind can stand in the channel, in its cell `i`, turned by `yaw`, its foot `up` above the
   * channel's floor: clear of the trough, with its stands' bases on that floor and clear of the rest of it too.
   */
  const stands = (kind: ToolKind, i: number, yaw: number, up = 10, bare = true): boolean => {
    const t = new Tool(kind, 1);
    // (bare: a stopcock's handwheel stands a little proud of the front of what it's on, see below)
    if (bare) t.cocks.fill(null);
    const c = cell(i);
    t.pose = onCell(at(c.x, LAMP_FLOOR.y + up + toolBounds(t).y1, c.z, yaw), toolAnchor(t));
    const on = toolStands(t);
    return !boxesOverlap(toolBox(t), b) && on.every((st) => counterUnder(standBase(st, 0)) === LAMP_FLOOR.y && !boxesOverlap(standBase(st, LAMP_FLOOR.y), b));
  };

  it('lies along the edge toward the room of a bench of its own in the front left corner, with no clamp stand', () => {
    expect(COUNTERS.filter((c) => c.lamp)).toEqual([{ ...LAMP_AREA, lamp: true }]);
    expect([LAMP_AREA.x0, LAMP_AREA.z1]).toEqual([ROOM.x0, ROOM.z1]);
    // clear of every other counter, with room to squeeze between (the player is 90 across), and of the airlock's doorway
    for (const c of COUNTERS.filter((k) => !k.lamp))
      expect(Math.max(c.x0 - LAMP_AREA.x1, LAMP_AREA.x0 - c.x1, c.z0 - LAMP_AREA.z1, LAMP_AREA.z0 - c.z1)).toBeGreaterThanOrEqual(CELL);
    expect(LAMP_AREA.x1).toBeLessThan(AIRLOCK.x - AIRLOCK.door.w / 2);
    // on the bench, its enclosure's back flush with the bench's end, and its front wall on the bench, a little in from
    // its edge
    expect(b.y - b.hy).toBeCloseTo(LIFT);
    expect(b.y + b.hy).toBeCloseTo(LIFT + h);
    expect(b.x + b.hx).toBeCloseTo(LAMP_AREA.x1);
    expect(b.x - b.hx).toBeGreaterThan(LAMP_AREA.x0);
    expect(b.z - b.hz).toBeCloseTo(LAMP_Z - ch.z - wall);
    expect(b.z - b.hz).toBeGreaterThan(LAMP_AREA.z0);
    expect(b.z - b.hz).toBeLessThan(LAMP_AREA.z0 + CELL);
    expect(toolStands(lamp)).toEqual([]);
  });

  it("has its channel along the bench's second row of cells from the room, five cells long, as wide as its screen and more", () => {
    // (wide enough for a flask's shadow to fall on its screen whole, the beam exactly the screen)
    expect(2 * ch.z).toBeGreaterThan(SCREEN.side);
    expect(SCREEN.side).toBeGreaterThan(2 * FLASK_R);
    expect(2 * LAMP.window.r).toBe(SCREEN.side);
    expect(cells).toBe(5);
    expect(ch.x1 - ch.x0).toBe(cells * CELL);
    for (let i = 0; i < cells; i++) {
      const c = cell(i);
      expect(toCell(c.x)).toBeCloseTo(c.x, 6);
      expect(toCell(c.z)).toBeCloseTo(c.z, 6);
      expect(c.z).toBeCloseTo(LAMP_AREA.z0 + 1.5 * CELL, 6);
      expect(c.x).toBeGreaterThan(LAMP_AREA.x0);
      expect(c.x).toBeLessThan(LAMP_AREA.x1);
    }
    // the lamp is at its end away from the left wall, shining toward that wall
    expect(cell(0).x).toBeGreaterThan(cell(cells - 1).x);
    expect(toWorld(LAMP_POSE, { x: box.x0, y: 0, z: 0 }).x).toBeGreaterThan(cell(0).x);
  });

  it("is solid in its enclosure, its two side walls and its end wall, all as tall as it is, and its channel's floor", () => {
    const parts = solids(b);
    expect(parts).toHaveLength(5);
    for (const p of parts.slice(0, 4)) expect([p.y - p.hy, p.y + p.hy].map((y) => +y.toFixed(6))).toEqual([LIFT, LIFT + h]);
    const [enclosure, near, far, end, floor] = parts;
    // the floor is a plate on the bench from wall to wall, from the enclosure to the end wall, and it's where space.ts
    // says the channel's floor is
    expect([floor.y - floor.hy, floor.y + floor.hy].map((y) => +y.toFixed(6))).toEqual([LIFT, LAMP_FLOOR.y]);
    expect([floor.z - floor.hz, floor.z + floor.hz].map((z) => +z.toFixed(6))).toEqual([LAMP_FLOOR.z0, LAMP_FLOOR.z1]);
    expect(floor.x + floor.hx).toBeCloseTo(LAMP_FLOOR.x1);
    expect(floor.x - floor.hx).toBeCloseTo(LAMP_FLOOR.x0);
    expect(LAMP.floor).toBe(LAMP_FLOOR.y - LIFT);
    // the enclosure is as wide as the trough over its walls; the walls are either side of the channel, all along it
    expect(enclosure.hz).toBe(ch.z + wall);
    expect(enclosure.hx).toBe((box.x1 - box.x0) / 2);
    expect([near.z + near.hz, far.z - far.hz].map((z) => +z.toFixed(6))).toEqual([LAMP_FLOOR.z0, LAMP_FLOOR.z1]);
    expect(near.hx).toBe((ch.x1 - ch.x0) / 2);
    // the end wall closes the channel's far end, from side to side, just past its last cell
    expect(end.x + end.hx).toBeCloseTo(cell(cells - 1).x - CELL / 2);
    expect(end.hz).toBe(ch.z + wall);
  });

  it('takes a flask in any cell of its channel, on its floor, and a scale along it, but not across', () => {
    for (let i = 0; i < cells; i++) {
      const f = flaskAt(cell(i).x, cell(i).z, LAMP_FLOOR.y);
      // it stands on the channel's floor, which is where what falls there lands too
      expect(counterUnder(flaskBox(f))).toBe(LAMP_FLOOR.y);
      expect(groundAt(f.pose.x, f.pose.z)).toBe(LAMP_FLOOR.y);
      expect(boxesOverlap(flaskBox(f), b), `${i}`).toBe(false);
      // set down on the bench under the floor, it would be in it
      expect(boxesOverlap(flaskBox(flaskAt(cell(i).x, cell(i).z)), b)).toBe(true);
    }
    // off the floor, the bench is as high as any counter
    expect(groundAt(cell(cells).x, cell(cells).z)).toBe(LIFT);
    expect(groundAt(cell(1).x, cell(1).z + CELL)).toBe(LIFT);
    expect(counterUnder(flaskBox(flaskAt(cell(1).x, cell(1).z + CELL)))).toBe(LIFT);
    // a cell further either way is the enclosure, or the end wall; two past the channel, the bench is free
    expect(boxesOverlap(flaskBox(flaskAt(cell(-1).x, cell(-1).z, LAMP_FLOOR.y)), b)).toBe(true);
    expect(boxesOverlap(flaskBox(flaskAt(cell(cells).x, cell(cells).z)), b)).toBe(true);
    expect(boxesOverlap(flaskBox(flaskAt(cell(cells + 1).x, cell(cells + 1).z)), b)).toBe(false);
    // (a scale is two cells long, a place for a flask over each: it fits over any two of the channel's side by side)
    for (let i = 1; i < cells; i++) {
      const mid = { x: (cell(i - 1).x + cell(i).x) / 2, z: (cell(i - 1).z + cell(i).z) / 2 };
      const along = new Scale(onCell(at(mid.x, LAMP_FLOOR.y + SCALE_SHAPE.body.y1, mid.z, LAMP_POSE.yaw), SCALE_ANCHOR));
      expect(Math.hypot(along.pose.x - mid.x, along.pose.z - mid.z)).toBeCloseTo(0, 6);
      expect(boxesOverlap(scaleBox(along), b)).toBe(false);
      expect(counterUnder(scaleBox(along))).toBe(LAMP_FLOOR.y);
    }
    const across = new Scale(onCell(at(cell(1).x, LAMP_FLOOR.y + SCALE_SHAPE.body.y1, cell(1).z, TO_LAMP), SCALE_ANCHOR));
    expect(boxesOverlap(scaleBox(across), b)).toBe(true);
  });

  it('takes a tool no wider than its channel on its stand, facing along it, and no other', () => {
    // in the cell by the lamp it faces the lamp, its stand behind it in the next cell; by the screen, the screen
    expect(stands('dispenser', 0, TO_LAMP)).toBe(true);
    expect(stands('dispenser', cells - 1, TO_SCREEN)).toBe(true);
    expect(stands('dispenser', 1, TO_LAMP)).toBe(true);
    expect(stands('dispenser', 1, TO_SCREEN)).toBe(true);
    // with its stopcock, as it comes, facing the lamp in the cell by it, the stopcock's handwheel is in the enclosure
    expect(stands('dispenser', 0, TO_LAMP, 10, false)).toBe(false);
    expect(stands('dispenser', 1, TO_LAMP, 10, false)).toBe(true);
    // the other way round its stand would be in the enclosure, or the end wall
    expect(stands('dispenser', 0, TO_SCREEN)).toBe(false);
    expect(stands('dispenser', cells - 1, TO_LAMP)).toBe(false);
    // facing across the channel, its stand would be in a side wall
    for (let i = 0; i < cells; i++) for (const yaw of [LAMP_POSE.yaw, LAMP_POSE.yaw + Math.PI]) expect(stands('dispenser', i, yaw)).toBe(false);
    const fits = (Object.keys(SHAPES) as ToolKind[])
      .filter((k) => !SHAPES[k].fixed && !SHAPES[k].flat)
      .filter((k) => Array.from({ length: cells }, (_, i) => i).some((i) => [TO_LAMP, TO_SCREEN].some((yaw) => stands(k, i, yaw))));
    expect(fits.sort()).toEqual(['column', 'dispenser', 'meter', 'pipette', 'strip', 'thermometer', 'thermometerWide']);
  });

  it('leaves the two rows of its bench behind it clear, with room for the longest tools on their two stands', () => {
    for (const row of [3.5, 4.5])
      for (let x = LAMP_AREA.x0 + CELL / 2; x < LAMP_AREA.x1; x += CELL) {
        const f = flaskAt(x, LAMP_AREA.z0 + row * CELL);
        expect(counterUnder(flaskBox(f))).toBe(LIFT);
        expect(boxesOverlap(flaskBox(f), b), `${x}, ${row}`).toBe(false);
      }
    for (const kind of ['sorter'] as const) {
      // somewhere along the row behind the trough, facing the room, its stands in the row by the wall
      const fits = Array.from({ length: (LAMP_AREA.x1 - LAMP_AREA.x0) / CELL }, (_, i) => i).some((i) => {
        const t = new Tool(kind, 1);
        t.pose = onCell(at(LAMP_AREA.x0 + (i + 0.5) * CELL, LIFT + 260, LAMP_AREA.z0 + 3.5 * CELL, Math.PI), toolAnchor(t));
        const on = toolStands(t);
        return on.length === 2 && !boxesOverlap(toolBox(t), b) && on.every((st) => counterUnder(standBase(st, 0)) === LIFT && !boxesOverlap(standBase(st, LIFT), b));
      });
      expect(fits, kind).toBe(true);
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
    // turned a quarter, left to right becomes front to back, and its front (where its spouts are, see plumbZ) faces +x
    expect(plumbZ(sep)).toBeGreaterThan(0);
    expect(spoutAt(sep, 0).x).toBeCloseTo(plumbZ(sep));
    expect(spoutAt(sep, 0).z).toBeCloseTo(-sep.shape.spouts[0]);
    expect(spoutAt(sep, last).z).toBeCloseTo(-sep.shape.spouts[last]);
  });

  it('bump into each other only where their boxes meet', () => {
    const a = new Tool('dispenser', 0, at(0, 500, 0));
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(CELL - 10, 500, 0))))).toBe(true);
    // a cell apart, either way, they're clear of each other
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(CELL, 500, 0))))).toBe(false);
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(0, 500, CELL, Math.PI / 2))))).toBe(false);
    expect(boxesOverlap(toolBox(a), toolBox(new Tool('dispenser', 1, at(0, 300, 0))))).toBe(false);
  });
});

describe('valves', () => {
  const Q = Math.PI / 2;
  /** The aim's angle round a valve, clockwise from straight up, as a point `r` from its middle (x right, y down). */
  const aim = (a: number, r = 20) => aimAngle(r * Math.sin(a), -r * Math.cos(a));

  it("open a plain valve with its bar along the pipe and shut it with the bar square to it, twice a turn", () => {
    // (from fully open, it's `run` round to where it shuts, a little short of square: see VALVE_SHUT)
    const run = Q - VALVE_SHUT;
    for (const [a, v] of [[0, 1], [run / 2, 0.5], [Q, 0], [2 * Q - run / 2, 0.5], [2 * Q, 1], [3 * Q, 0], [4 * Q, 1], [-Q, 0], [-run / 2, 0.5], [run / 3, 2 / 3]])
      expect(valveAt('valve', a), `${a}`).toBeCloseTo(v, 12);
  });

  it('shut a plain valve all the way while its bar is within a little of square to the pipe, and open it evenly from there', () => {
    expect(VALVE_SHUT).toBeGreaterThan(0);
    expect(VALVE_SHUT).toBeLessThan(Q / 2);
    for (const side of [-1, 1]) {
      for (const f of [0, 0.5, 1]) expect(valveAt('valve', Q + side * f * VALVE_SHUT), `${side} ${f}`).toBeCloseTo(0, 12);
      // just past that it's only just open, not open by a jump
      const just = valveAt('valve', Q + side * (VALVE_SHUT + 1e-3));
      expect(just).toBeGreaterThan(0);
      expect(just).toBeLessThan(0.01);
    }
    // so a bar halfway between along and square is less than half open
    expect(valveAt('valve', Q / 2)).toBeCloseTo((Q / 2 - VALVE_SHUT) / (Q - VALVE_SHUT), 12);
  });

  it("send a splitter's all left pointing left, half each way up or down, and all right pointing right", () => {
    for (const [a, v] of [[-Q, 0], [0, 0.5], [Q, 1], [2 * Q, 0.5], [3 * Q, 0], [Q / 2, 0.75], [-Q / 2, 0.25], [2.5 * Q, 0.25], [5 * Q, 1]])
      for (const kind of ['split', 'join'] as const) expect(valveAt(kind, a), `${kind} ${a}`).toBeCloseTo(v, 12);
  });

  it('draw any setting at an angle that comes back to it, the plain valve shut a quarter turn clockwise', () => {
    for (const kind of ['valve', 'split', 'join', 'dial'] as const)
      for (const v of [0, 0.1, 0.25, 0.5, 0.8, 1]) expect(valveAt(kind, angleOf(kind, v)), `${kind} ${v}`).toBeCloseTo(v, 12);
    expect(angleOf('valve', 0)).toBeCloseTo(Q, 12);
    expect(angleOf('valve', 1)).toBe(0);
    // a splitter's pointer rests toward its fork, below it, and a multiplexer's toward its join, above
    expect(wrapAngle(angleOf('split', 0))).toBeCloseTo(-Q, 12);
    expect(Math.abs(wrapAngle(angleOf('split', 0.5)))).toBeCloseTo(2 * Q, 12);
    expect(angleOf('split', 1)).toBeCloseTo(Q, 12);
    expect(angleOf('join', 0)).toBeCloseTo(-Q, 12);
    expect(angleOf('join', 0.5)).toBeCloseTo(0, 12);
    expect(angleOf('join', 1)).toBeCloseTo(Q, 12);
  });

  it('keep the angle they were turned to while it still says how they are set, and work it out afresh once it does not', () => {
    expect(settleAngle('valve', 3 * Q, 0)).toBe(3 * Q);
    expect(settleAngle('valve', 3 * Q, 1)).toBe(0);
    expect(settleAngle('valve', undefined, 0.5)).toBeCloseTo((Q - VALVE_SHUT) / 2, 12);
    // (anywhere it's shut, it stays as it was turned)
    expect(settleAngle('valve', Q - VALVE_SHUT / 2, 0)).toBe(Q - VALVE_SHUT / 2);
    // (the heater's tap's valve is a plain one)
    const t = new Tool('heater', 0, undefined, [1]);
    turnValve(t, 0, 2 * Q);
    expect(t.valves[0]).toBeCloseTo(1, 12);
    expect(valveAngle(t, 0)).toBeCloseTo(2 * Q, 12);
    // set some other way (an undo, a load), it's drawn as that is
    t.valves[0] = 0;
    expect(valveAngle(t, 0)).toBeCloseTo(Q, 12);
  });

  it('shut a plain valve swept a quarter turn from open, and open it again a quarter turn on', () => {
    const t = new Tool('heater', 0, undefined, [1]);
    turnValve(t, 0, Q);
    expect(t.valves[0]).toBeCloseTo(0, 12);
    turnValve(t, 0, Q);
    expect(t.valves[0]).toBeCloseTo(1, 12);
    // (halfway back to where it shuts, a little short of square: see VALVE_SHUT)
    turnValve(t, 0, -(Q - VALVE_SHUT) / 2);
    expect(t.valves[0]).toBeCloseTo(0.5, 12);
  });

  it('turn by how far the aim swept round, the short way, even across straight down', () => {
    // from just left of straight down to just right of it is a small turn anticlockwise, not most of a turn
    expect(swept(aim(2 * Q + 0.1), aim(2 * Q - 0.1))).toBeCloseTo(-0.2, 9);
    expect(swept(aim(-2 * Q + 0.1), aim(2 * Q - 0.1))).toBeCloseTo(-0.2, 9);
    expect(swept(aim(0.3), aim(0.5))).toBeCloseTo(0.2, 9);
  });

  it('turn nothing going into or coming out of the dead zone round the middle', () => {
    const inside = aimAngle(VALVE_DEADZONE / 2, 0);
    expect(inside).toBeNull();
    expect(swept(aim(0.4), inside)).toBe(0);
    expect(swept(inside, aim(1.2))).toBe(0);
    expect(aimAngle(VALVE_DEADZONE * 2, 0)).toBeCloseTo(Q, 12);
  });

  it('stop a dial at its two ends, and turn it back from one at once', () => {
    const ht = new Tool('heater', 0);
    const k = ht.shape.dial!;
    expect(leverKind(ht, k)).toBe('dial');
    ht.valves[k] = 0.5;
    turnValve(ht, k, 4 * Q);
    expect(ht.valves[k]).toBe(1);
    // no winding up past the stop: the first bit back turns it back
    turnValve(ht, k, -0.1);
    expect(ht.valves[k]).toBeCloseTo(1 - 0.1 / (2 * DIAL_STOP), 12);
    turnValve(ht, k, -8 * Q);
    expect(ht.valves[k]).toBe(0);
    turnValve(ht, k, DIAL_STOP);
    expect(ht.valves[k]).toBeCloseTo(0.5, 12);
  });

  it('are built in only where they share out or set something, not to let a spout out slower', () => {
    const builtIn = (Object.keys(SHAPES) as ToolKind[]).filter((k) => SHAPES[k].valves);
    expect(builtIn.sort()).toEqual(['dilatometer', 'heater', 'multiplexer', 'receptacle', 'splitter']);
    for (const kind of Object.keys(SHAPES) as ToolKind[]) expect(new Tool(kind, 0).valves.length, kind).toBe(SHAPES[kind].valves?.length ?? 0);
  });

  it('leave a plain spout a short stub under what it drains, for a stopcock to go on', () => {
    for (const kind of ['dispenser', 'tank', 'pipette'] as ToolKind[]) {
      const sh = SHAPES[kind];
      const above = (sh.tankH ?? TANK_H) + (sh.funnel || sh.cup ? 0 : (sh.sump?.h ?? 0));
      expect(sh.spoutY - above, kind).toBe(SPOUT_STUB);
    }
    expect(SHAPES.column.spoutY - COLUMN.tube.y1).toBe(SPOUT_STUB);
  });

  it("tell a splitter's and a multiplexer's pointers from the plain valves", () => {
    expect(leverKind(new Tool('splitter', 0), 0)).toBe('split');
    expect(leverKind(new Tool('multiplexer', 0), 0)).toBe('join');
    expect(leverKind(new Tool('heater', 0), 0)).toBe('valve');
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
    expect(scaleSpot(sc, { x: SCALE_SHAPE.platform.x1 - 5, y: 400 + FLASK_H + 5, z: 10 })).toBe(SCALE_SLOTS[1]);
    expect(scaleSpot(sc, { x: -10, y: 400 + FLASK_H + 5, z: 0 })).toBe(SCALE_SLOTS[0]);
    expect(onScale(sc, 30).y).toBeCloseTo(400 + FLASK_H);
  });

  it("leaves one that's too high, too low or off to the side", () => {
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H + 120, z: 0 })).toBeNull();
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H - 40, z: 0 })).toBeNull();
    expect(scaleSpot(sc, { x: 30, y: 400 + FLASK_H, z: 80 })).toBeNull();
    expect(scaleSpot(sc, { x: SCALE_SHAPE.platform.x1 + 10, y: 400 + FLASK_H, z: 0 })).toBeNull();
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
    expect(toolStands(new Tool('sorter', 0, at(0, 600, 0)))).toHaveLength(2);
    for (const kind of ['separator', 'heater'] as const) expect(toolStands(new Tool(kind, 0, at(0, 600, 0)))).toHaveLength(1);
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
    // turned a quarter, the spectroscope's cabinet reaches back from its tube, toward the wall, standing on the counter
    const spec = new Tool('spectroscope', 0, at(500, LIFT + 96, 250, Math.PI / 2));
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
    const a = new Tool('spectroscope', 0, at(450, 800, 150));
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

  it("snaps a nozzle onto a flow meter's tube, clear of it", () => {
    const m = new Tool('meter', 0, at(450, 800, 150));
    const top = tankMouth(m, 0);
    const p = docked({ x: top.x, y: top.y + 100, z: top.z, yaw: 0 }, [m]);
    expect(p.y).toBeCloseTo(top.y + 1);
    expect(boxesOverlap(nozzleBox(new Hose({ faucet: 0 }, p, 0)), toolBox(m))).toBe(false);
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

  it('bump into nothing below the top of the rod, where its stand holds it, so it can stand down in a flask', () => {
    const f = new Flask(CAP);
    f.pose = at(150, LIFT + FLASK_H, 150);
    const t = dipped({ x: 150, y: LIFT + 10, z: 150 });
    expect(boxesOverlap(toolBox(t), flaskBox(f))).toBe(false);
    const [st] = toolStands(t);
    expect(t.pose.y - st.clampY).toBeLessThan(THERMOMETER_ROD.h / 4);
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

  it("are in the hopper under a tank that drains at its front only where it is, leaning forward to its tip", () => {
    const t = new Tool('dispenser', 0, at(300, 700, 150));
    t.tanks[0].setMolecules(R, t.tanks[0].cap / 2);
    const { floor } = tankFluid(t, 0);
    // just above the tip, at the front, it's in it; as far back, it's outside the hopper's sloping floor
    const low = { x: 300, y: floor + 1, z: 150 + plumbZ(t) };
    expect(bathAt(low, [], [t])).toBe(t.tanks[0]);
    expect(bathAt({ ...low, z: 150 - plumbZ(t) }, [], [t])).toBeNull();
  });
  it("have a strip's foot at the tip of its paper, and only its clip bumps into anything", () => {
    const t = new Tool('strip', 9, at(150, LIFT + 200, 150));
    const foot = footAt(t);
    expect(foot.x).toBeCloseTo(150, 9);
    expect(foot.z).toBeCloseTo(150, 9);
    expect(foot.y).toBeCloseTo(LIFT + 200 - (STRIP_FOOT - 0.5), 9);
    // turned, its foot stays under its top
    t.pose = at(150, LIFT + 200, 150, 1.3);
    expect(footAt(t).x).toBeCloseTo(150, 9);
    // stood with its foot in a flask's fluid, it's in it, and doesn't bump into the flask
    const f = new Flask(CAP);
    f.pose = at(150, LIFT + FLASK_H, 150);
    f.setMolecules(R, CAP / 2);
    const { floor, surface } = flaskFluid(f);
    t.pose = at(150, (floor + surface) / 2 + footY('strip'), 150);
    expect(bathAt(footAt(t), [f], [])).toBe(f);
    expect(boxesOverlap(toolBox(t), flaskBox(f))).toBe(false);
    const [st] = toolStands(t);
    expect(t.pose.y - st.clampY).toBeLessThan(STRIP.clip.h);
  });

  it('hover over the middle of a mouth they are aimed at, dip just under its fluid, and stand deeper in it', () => {
    for (const kind of ['strip', 'thermometer', 'thermometerWide'] as const) {
      const t = new Tool(kind, 9);
      const strip = kind === 'strip';
      // a flask, nearly full
      const f = new Flask(CAP);
      f.pose = at(2.5 * CELL, LIFT + FLASK_H, 4.5 * CELL);
      f.setMolecules(R, 0.9 * CAP);
      const m = flaskMouth(f);
      const { hover, dipped, stood } = dipPoses(t, m, flaskFluid(f), 0.2);
      for (const p of [hover, dipped, stood]) {
        t.pose = p;
        const foot = footAt(t);
        expect(foot.x, kind).toBeCloseTo(m.x, 6);
        expect(foot.z, kind).toBeCloseTo(m.z, 6);
        // facing as it's held
        expect(p.yaw).toBe(0.2);
      }
      t.pose = hover;
      expect(footAt(t).y).toBeCloseTo(m.y + DIP_HOVER, 6);
      // dipped by hand, no further in than it takes to touch the fluid
      const { floor, surface } = flaskFluid(f);
      expect(surface - floor).toBeGreaterThan(2 * (STRIP_STOOD + DIP_FLOOR));
      t.pose = dipped;
      expect(footAt(t).y).toBeCloseTo(surface - dipUnder(kind), 6);
      expect(bathAt(footAt(t), [f], [])).toBe(f);
      // a strip's point half in, a thermometer's bulb just covered
      if (strip) expect(surface - (footAt(t).y - 0.5)).toBeCloseTo(STRIP.paper.point / 2, 6);
      else expect(surface - (footAt(t).y + (THERMOMETER_ROD.bulb.y1 - THERMOMETER_ROD.bulb.y0) / 2)).toBeCloseTo(1, 6);
      // stood in it, deeper: a strip's whole point under, a thermometer's bulb near the floor
      t.pose = stood;
      expect(footAt(t).y).toBeCloseTo(strip ? surface - STRIP_STOOD : floor + DIP_FLOOR, 6);
      expect(footAt(t).y).toBeLessThan(surface - dipUnder(kind));
      expect(bathAt(footAt(t), [f], [])).toBe(f);
      // empty, down where it would stand on its floor, dipped or stood
      f.setMolecules(R, 0);
      const empty = dipPoses(t, m, flaskFluid(f), 0);
      for (const p of [empty.dipped, empty.stood]) {
        t.pose = p;
        expect(footAt(t).y).toBeCloseTo(floor + (strip ? STRIP_FLOOR : DIP_FLOOR), 6);
      }
      // in a tool's shallow fluid (a flow meter's tube), dipped to the middle of its depth, and stood no higher: a strip's tip on its floor
      const d = new Tool('meter', 3, at(420, LIFT + 100, 250));
      d.tanks[0].setMolecules(SOLVENT_SPECIES, d.tanks[0].cap / 20);
      const fl = tankFluid(d, 0);
      const mid = (fl.floor + fl.surface) / 2;
      expect(fl.surface - fl.floor).toBeLessThan(2 * dipUnder(kind));
      const shallow = dipPoses(t, tankMouth(d, 0), fl, Math.PI / 2);
      t.pose = shallow.dipped;
      expect(footAt(t).y).toBeCloseTo(mid, 6);
      expect(bathAt(footAt(t), [], [d])).toBe(d.tanks[0]);
      t.pose = shallow.stood;
      expect(footAt(t).y).toBeCloseTo(strip ? fl.floor + STRIP_FLOOR : mid, 6);
      expect(bathAt(footAt(t), [], [d])).toBe(d.tanks[0]);
      // and in next to nothing, either way at the middle of what there is, so it's in it
      d.tanks[0].setMolecules(SOLVENT_SPECIES, d.tanks[0].cap / 2000);
      const film = tankFluid(d, 0);
      const least = dipPoses(t, tankMouth(d, 0), film, 0);
      for (const p of [least.dipped, least.stood]) {
        t.pose = p;
        expect(footAt(t).y).toBeCloseTo((film.floor + film.surface) / 2, 6);
      }
    }
  });
});
