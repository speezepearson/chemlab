import { FLASK_CENTER, FLASK_R, scaleBox, toolBox } from './bodies';
import { FLASK_H } from './flaskShape';
import { Scale } from './scale';
import { CABINET_AREA, type Pose, type Vec3 } from './space';
import { Tool, type ToolKind } from './tools';

/**
 * The equipment cabinet: open steel shelving against the back wall (CABINET_AREA), holding the lab's stock of
 * everything the equipment wheel makes. Each item it holds sits in a slot of its own on the shelves, and is only drawn there:
 * nothing in it works, and no fluid gets into it. Making an item from the wheel takes one out of the cabinet, and
 * putting one away puts it back. The consumables (ENDLESS) are stacked deep, and never run out.
 */

/** What the cabinet stocks: every kind of thing the equipment wheel makes. */
export type Stocked = 'flask' | 'scale' | Exclude<ToolKind, 'receptacle' | 'analyzer' | 'spectroscope' | 'visualizer'>;

/** The consumables: stacked deep in the cabinet, more than anyone could use, so taking one never empties it. */
export const ENDLESS: readonly Stocked[] = ['thermometer', 'thermometerWide', 'strip', 'culture'];

/** Whether the cabinet's supply of a kind never runs out. */
export const endless = (k: Stocked) => ENDLESS.includes(k);

/** How many of each kind the cabinet holds, full: thirty flasks, and eight of everything else (see ENDLESS). */
export const STOCK: Record<Stocked, number> = {
  flask: 30, scale: 8, dispenser: 8, pipette: 8, exchanger: 8, separator: 8, splitter: 8, multiplexer: 8, sorter: 8,
  heater: 8, tank: 8, meter: 8, dilatometer: 8, column: 8, dish: 8,
  // drawn as this many, but endless
  thermometer: 16, thermometerWide: 16, strip: 16, culture: 8,
};

/**
 * One kind's compartment on a shelf: `cols` side by side, `high` stacked one on another, and `deep` one behind another,
 * each a gap apart (stacked ones just touching).
 */
interface Compartment {
  kind: Stocked;
  cols: number;
  high: number;
  deep: number;
}

/**
 * The cabinet's bays, left to right, each its shelves from the bottom up, each shelf its compartments left to right.
 * Heavy, tall things are low down; the endless stacks are in the last bay.
 */
const BAYS: readonly (readonly (readonly Compartment[])[])[] = [
  [
    [{ kind: 'tank', cols: 3, high: 3, deep: 1 }],
    [{ kind: 'flask', cols: 10, high: 1, deep: 3 }],
    [{ kind: 'scale', cols: 3, high: 1, deep: 3 }],
  ],
  [
    [{ kind: 'heater', cols: 1, high: 1, deep: 8 }],
    [{ kind: 'sorter', cols: 1, high: 1, deep: 8 }],
    [{ kind: 'separator', cols: 1, high: 2, deep: 4 }],
    [{ kind: 'multiplexer', cols: 1, high: 2, deep: 4 }],
  ],
  [
    [{ kind: 'exchanger', cols: 2, high: 1, deep: 4 }],
    [{ kind: 'splitter', cols: 1, high: 2, deep: 4 }, { kind: 'pipette', cols: 2, high: 1, deep: 4 }],
    [{ kind: 'dilatometer', cols: 2, high: 1, deep: 4 }],
    [{ kind: 'column', cols: 1, high: 1, deep: 8 }, { kind: 'meter', cols: 1, high: 1, deep: 8 }, { kind: 'dish', cols: 1, high: 2, deep: 4 }],
  ],
  [
    [{ kind: 'dispenser', cols: 2, high: 1, deep: 4 }, { kind: 'culture', cols: 2, high: 1, deep: 4 }],
    [{ kind: 'strip', cols: 8, high: 1, deep: 2 }],
    [{ kind: 'thermometer', cols: 8, high: 1, deep: 2 }, { kind: 'thermometerWide', cols: 8, high: 1, deep: 2 }],
  ],
];

/**
 * The cabinet's build, in world units: a plinth `base` high under the shelves; uprights `side` thick between the bays
 * and at the ends; shelves `board` thick, each `clear` above the tallest thing on the one below; a back panel `back`
 * thick; a `gap` between things side by side and one behind another; and a top `board` thick, `top` above the highest
 * shelf's things.
 */
export const CABINET_BUILD = { base: 120, side: 8, board: 4, clear: 10, back: 4, gap: 2, top: 16 };

/** A kind's size, as its box is drawn (w across, h tall, d deep), and where that box's middle is from its pose. */
function sizeOf(k: Stocked): { w: number; h: number; d: number; c: Vec3 } {
  if (k === 'flask') return { w: 2 * FLASK_R, h: FLASK_H, d: 2 * FLASK_R, c: FLASK_CENTER };
  const b = k === 'scale' ? scaleBox(new Scale()) : toolBox(new Tool(k, 0));
  return { w: 2 * b.hx, h: 2 * b.hy, d: 2 * b.hz, c: { x: b.x, y: b.y, z: b.z } };
}

/** A compartment's size, in world units. */
function compartmentSize(cp: Compartment): { w: number; h: number; d: number } {
  const { gap } = CABINET_BUILD;
  const s = sizeOf(cp.kind);
  return { w: cp.cols * s.w + (cp.cols + 1) * gap, h: cp.high * s.h, d: cp.deep * s.d + (cp.deep - 1) * gap };
}

/** A shelf of the cabinet, as built: its top (what stands on it stands there), and its x extent. */
export interface Shelf {
  x0: number;
  x1: number;
  y: number;
}

/** The cabinet as built (see CABINET_BUILD): its extent, the x extent of each bay, its shelves, and each kind's slots. */
export interface CabinetLayout {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y1: number;
  bays: { x0: number; x1: number }[];
  shelves: Shelf[];
  /** Each kind's slots: where one of it stands in each (its pose), the back ones first, the front ones last. */
  slots: Record<Stocked, Pose[]>;
  /** How wide and tall the bays' contents are, before any room left over is shared out among them. */
  need: { w: number; h: number; d: number };
}

/** Lay the cabinet out (see CabinetLayout), filling CABINET_AREA across, with whatever room is left shared among its bays. */
function layout(): CabinetLayout {
  const B = CABINET_BUILD;
  const { x0, x1, z0, z1 } = CABINET_AREA;
  const widths = BAYS.map((bay) => Math.max(...bay.map((sh) => sh.reduce((w, cp) => w + compartmentSize(cp).w, 0))));
  const needW = widths.reduce((a, b) => a + b, 0) + (BAYS.length + 1) * B.side;
  const spare = (x1 - x0 - needW) / BAYS.length;
  const front = z1 - B.gap;
  const slots = {} as Record<Stocked, Pose[]>;
  const shelves: Shelf[] = [];
  const bays: { x0: number; x1: number }[] = [];
  let needH = 0;
  let needD = 0;
  let bx = x0 + B.side;
  BAYS.forEach((bay, i) => {
    const bw = widths[i] + spare;
    bays.push({ x0: bx, x1: bx + bw });
    let y = B.base;
    for (const shelf of bay) {
      shelves.push({ x0: bx, x1: bx + bw, y });
      // its compartments spread evenly across the bay
      const used = shelf.reduce((w, cp) => w + compartmentSize(cp).w, 0);
      const pad = (bw - used) / (shelf.length + 1);
      let cx = bx + pad;
      let tallest = 0;
      for (const cp of shelf) {
        const s = sizeOf(cp.kind);
        const size = compartmentSize(cp);
        needD = Math.max(needD, size.d);
        const poses: Pose[] = [];
        // the back layer first, and in each layer, the bottom first
        for (let layer = 0; layer < cp.deep; layer++)
          for (let tier = 0; tier < cp.high; tier++)
            for (let col = 0; col < cp.cols; col++) {
              const mid = {
                x: cx + B.gap + col * (s.w + B.gap) + s.w / 2,
                y: y + tier * s.h + s.h / 2,
                z: front - (cp.deep - 1 - layer) * (s.d + B.gap) - s.d / 2,
              };
              poses.push({ x: mid.x - s.c.x, y: mid.y - s.c.y, z: mid.z - s.c.z, yaw: 0 });
            }
        slots[cp.kind] = poses.slice(0, STOCK[cp.kind]);
        tallest = Math.max(tallest, size.h);
        cx += size.w + pad;
      }
      y += tallest + B.clear + B.board;
    }
    needH = Math.max(needH, y);
    bx += bw + B.side;
  });
  return { x0, x1, z0, z1, y1: needH + B.top, bays, shelves, slots, need: { w: needW, h: needH, d: needD + B.back + B.gap } };
}

export const CABINET: CabinetLayout = layout();

/** What the cabinet holds: for each kind it stocks, whether each of its slots (see CabinetLayout.slots) is filled. */
export type Stock = Record<Stocked, boolean[]>;

/** Whether `k` is something the cabinet stocks. */
export const isStocked = (k: string): k is Stocked => k in STOCK;

/**
 * The cabinet as it would be with `out` of each kind out in the lab: full but for those, taken from the front first,
 * as the equipment wheel takes them (see takeFrom); endless kinds are always full.
 */
export function stockWith(out: Partial<Record<Stocked, number>>): Stock {
  const s = {} as Stock;
  for (const k of Object.keys(STOCK) as Stocked[]) {
    const n = endless(k) ? STOCK[k] : Math.max(0, STOCK[k] - (out[k] ?? 0));
    s[k] = Array.from({ length: STOCK[k] }, (_, i) => i < n);
  }
  return s;
}

/** A copy of a stock. */
export const copyStock = (s: Stock): Stock =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, [...v]])) as Stock;

/**
 * Take one of a kind out of the cabinet, as the equipment wheel does: the front-most there is (the last filled slot), or for an
 * endless kind, any. Returns the slot it came from, or null if there are none left.
 */
export function takeFrom(s: Stock, k: Stocked): number | null {
  if (endless(k)) return s[k].length - 1;
  const i = s[k].lastIndexOf(true);
  if (i < 0) return null;
  s[k][i] = false;
  return i;
}

/** Take the one in a particular slot out of the cabinet, if it's there; an endless kind's always is, and stays. */
export function takeSlot(s: Stock, k: Stocked, slot: number): boolean {
  if (!s[k][slot]) return false;
  if (!endless(k)) s[k][slot] = false;
  return true;
}

/**
 * Put one of a kind back in the cabinet: in the back-most empty slot of its kind. Returns the slot, or null if there's
 * no room for it (when more of a kind are out than the cabinet holds, as an older lab can have), so it's just gone;
 * as is an endless kind's, onto its stack.
 */
export function putIn(s: Stock, k: Stocked): number | null {
  if (endless(k)) return null;
  const i = s[k].indexOf(false);
  if (i < 0) return null;
  s[k][i] = true;
  return i;
}
