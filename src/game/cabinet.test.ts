import { describe, expect, it } from 'vitest';
import { flaskBox, scaleBox, toolBox } from './bodies';
import { CABINET, CABINET_BUILD, ENDLESS, STOCK, endless, putIn, stockWith, takeFrom, takeSlot, type Stocked } from './cabinet';
import { Flask } from './flask';
import { boxesOverlap, solids, type Box } from './physics';
import { Scale } from './scale';
import { CABINET_AREA, COUNTERS, ROOM, type Pose } from './space';
import { Tool } from './tools';

const KINDS = Object.keys(STOCK) as Stocked[];

/** The box of one of a kind standing at a pose. */
function boxAt(k: Stocked, pose: Pose): Box {
  if (k === 'flask') {
    const f = new Flask(1);
    f.pose = pose;
    return flaskBox(f);
  }
  return k === 'scale' ? scaleBox(new Scale(pose)) : toolBox(new Tool(k, 0, pose));
}

describe('the equipment cabinet', () => {
  it('stands against the back wall from the left wall, the back counter running on from it', () => {
    expect(CABINET.x0).toBe(ROOM.x0);
    expect(CABINET.z0).toBe(ROOM.z0);
    expect(COUNTERS.some((c) => c.x0 === CABINET_AREA.x1 && c.z0 === ROOM.z0)).toBe(true);
    expect(CABINET.y1).toBeLessThan(ROOM.y1);
  });

  it('has room for everything it holds', () => {
    expect(CABINET.need.w).toBeLessThanOrEqual(CABINET.x1 - CABINET.x0);
    expect(CABINET.need.d).toBeLessThanOrEqual(CABINET.z1 - CABINET.z0);
    for (const k of KINDS) expect(CABINET.slots[k]).toHaveLength(STOCK[k]);
  });

  it('stands everything inside it, on its shelves, clear of everything else', () => {
    const all = KINDS.flatMap((k) => CABINET.slots[k].map((p) => ({ k, b: boxAt(k, p) })));
    const B = CABINET_BUILD;
    for (const { b } of all) {
      expect(b.x - b.hx).toBeGreaterThan(CABINET.x0 + B.side - 1e-6);
      expect(b.x + b.hx).toBeLessThan(CABINET.x1 - B.side + 1e-6);
      expect(b.z - b.hz).toBeGreaterThan(CABINET.z0 + B.back - 1e-6);
      expect(b.z + b.hz).toBeLessThan(CABINET.z1 + 1e-6);
      expect(b.y - b.hy).toBeGreaterThan(B.base - 1e-6);
      expect(b.y + b.hy).toBeLessThan(CABINET.y1 - B.top + 1e-6);
      // each in one bay
      expect(CABINET.bays.some((bay) => b.x - b.hx >= bay.x0 - 1e-6 && b.x + b.hx <= bay.x1 + 1e-6)).toBe(true);
    }
    // shrunk a hair, so things just touching (stacked) don't count
    const shrink = (b: Box): Box => ({ ...b, hx: b.hx - 0.01, hy: b.hy - 0.01, hz: b.hz - 0.01, parts: undefined });
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(boxesOverlap(shrink(all[i].b), shrink(all[j].b))).toBe(false);
  });

  it("puts the front one of each kind in reach of someone standing at it", () => {
    // the player's eyes, 620 up, as close as they can stand (45 round) to the front one
    for (const k of KINDS) {
      const p = CABINET.slots[k][STOCK[k] - 1];
      const near = Math.min(
        ...solids(boxAt(k, p)).map((b) => {
          const eye = { x: b.x, y: 620, z: CABINET.z1 + 45 };
          const dy = Math.max(0, Math.abs(eye.y - b.y) - b.hy);
          return Math.hypot(dy, eye.z - (b.z + b.hz));
        }),
      );
      expect(near, k).toBeLessThan(460);
    }
  });
});

describe('the stock', () => {
  it("is full but for what's out, taken from the front", () => {
    const s = stockWith({ flask: 3, tank: 20 });
    expect(s.flask.filter(Boolean)).toHaveLength(STOCK.flask - 3);
    expect(s.flask.slice(-3)).toEqual([false, false, false]);
    expect(s.tank.some(Boolean)).toBe(false);
    for (const k of ENDLESS) expect(stockWith({ [k]: 100 })[k].every(Boolean)).toBe(true);
  });

  it('gives the front one first, and runs out', () => {
    const s = stockWith({});
    const taken = Array.from({ length: STOCK.tank + 1 }, () => takeFrom(s, 'tank'));
    expect(taken).toEqual([...Array.from({ length: STOCK.tank }, (_, i) => STOCK.tank - 1 - i), null]);
  });

  it('takes back into the back-most empty slot, and none past full', () => {
    const s = stockWith({});
    expect(takeSlot(s, 'scale', 2)).toBe(true);
    expect(takeSlot(s, 'scale', 2)).toBe(false);
    takeFrom(s, 'scale');
    expect(putIn(s, 'scale')).toBe(2);
    expect(putIn(s, 'scale')).toBe(STOCK.scale - 1);
    expect(putIn(s, 'scale')).toBeNull();
  });

  it('never runs out of the consumables', () => {
    const s = stockWith({});
    for (const k of ENDLESS) {
      expect(endless(k)).toBe(true);
      for (let i = 0; i < 100; i++) expect(takeFrom(s, k)).not.toBeNull();
      expect(takeSlot(s, k, 0)).toBe(true);
      expect(s[k].every(Boolean)).toBe(true);
      expect(putIn(s, k)).toBeNull();
    }
  });
});
