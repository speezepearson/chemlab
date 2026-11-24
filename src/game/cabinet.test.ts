import { describe, expect, it } from 'vitest';
import { cockBox, flaskBox, scaleBox, toolBox } from './bodies';
import { CABINET, CABINET_BUILD, ENDLESS, SHELF_REACH, STAND_OFF, STOCK, endless, putIn, stockWith, takeFrom, takeSlot, type Stocked } from './cabinet';
import { Flask } from './flask';
import { boxesOverlap, type Box } from './physics';
import { Scale } from './scale';
import { CABINET_AREA, COUNTERS, EYE, REACH, ROOM, type Pose } from './space';
import { Tool } from './tools';

const KINDS = Object.keys(STOCK) as Stocked[];

/** The box of one of a kind standing at a pose. */
function boxAt(k: Stocked, pose: Pose): Box {
  if (k === 'flask') {
    const f = new Flask(1);
    f.pose = pose;
    return flaskBox(f);
  }
  if (k === 'stopcock') return cockBox(pose, pose.yaw);
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
      expect(b.y - b.hy).toBeGreaterThan(CABINET.base - 1e-6);
      expect(b.y + b.hy).toBeLessThan(CABINET.y1 - B.top + 1e-6);
      // each in one bay
      expect(CABINET.bays.some((bay) => b.x - b.hx >= bay.x0 - 1e-6 && b.x + b.hx <= bay.x1 + 1e-6)).toBe(true);
    }
    // and each under any shelf over it, clear of the board
    for (const { k, b } of all)
      for (const sh of CABINET.shelves)
        if (sh.x0 <= b.x && b.x <= sh.x1 && sh.y > b.y - b.hy + 1e-6) expect(b.y + b.hy, k).toBeLessThanOrEqual(sh.y - B.board - B.clear + 1e-6);
    // shrunk a hair, so things just touching (stacked) don't count
    const shrink = (b: Box): Box => ({ ...b, hx: b.hx - 0.01, hy: b.hy - 0.01, hz: b.hz - 0.01, parts: undefined });
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(boxesOverlap(shrink(all[i].b), shrink(all[j].b))).toBe(false);
  });

  it('has nothing lower or higher than can be reached from a stride out, and no shelf on the plinth', () => {
    expect(CABINET.base).toBeGreaterThanOrEqual(SHELF_REACH.lo);
    for (const sh of CABINET.shelves) expect(sh.y).toBeGreaterThanOrEqual(CABINET.base);
    for (const k of KINDS)
      for (const p of CABINET.slots[k]) {
        const b = boxAt(k, p);
        expect(b.y - b.hy, k).toBeGreaterThanOrEqual(SHELF_REACH.lo);
        expect(b.y + b.hy, k).toBeLessThanOrEqual(SHELF_REACH.hi);
      }
  });

  it('puts the whole front of the front one of each kind in reach of someone standing a stride out', () => {
    for (const k of KINDS) {
      const b = boxAt(k, CABINET.slots[k][STOCK[k] - 1]);
      const out = CABINET.z1 + STAND_OFF - (b.z + b.hz);
      for (const y of [b.y - b.hy, b.y + b.hy]) expect(Math.hypot(EYE - y, out), k).toBeLessThanOrEqual(REACH);
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
