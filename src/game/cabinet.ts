import { COCK_EXTENT, FLASK_CENTER, FLASK_R, scaleBox, toolBox } from './bodies';
import { FLASK_H } from './flaskShape';
import { Scale } from './scale';
import { CABINET_AREA, CELL, EYE, PLAYER_R, REACH, type Pose, type Vec3 } from './space';
import { Tool, type ToolKind } from './tools';

/**
 * The equipment cabinet: open steel shelving against the back wall (CABINET_AREA), holding the lab's stock of
 * everything the equipment wheels make. Each item it holds sits in a slot of its own on the shelves, and is only drawn there:
 * nothing in it works, and no fluid gets into it. Making an item from the wheel takes one out of the cabinet, and
 * putting one away puts it back. The consumables (ENDLESS) are stacked deep, and never run out.
 */

/**
 * What the cabinet stocks: every kind of thing the equipment wheels make, a stopcock (see Cock in tools.ts) among
 * them.
 */
export type Stocked = 'flask' | 'scale' | 'stopcock' | Exclude<ToolKind, 'receptacle' | 'spectroscope' | 'shadowlamp'>;

/** The consumables: stacked deep in the cabinet, more than anyone could use, so taking one never empties it. */
export const ENDLESS: readonly Stocked[] = ['thermometer', 'thermometerWide', 'strip', 'testpaper', 'bondpaper'];

/** Whether the cabinet's supply of a kind never runs out. */
export const endless = (k: Stocked) => ENDLESS.includes(k);

/**
 * How many of each kind the cabinet holds, full: thirty flasks, sixteen stopcocks, three big tanks (each holds a great
 * deal, and the user found three plenty), and eight of everything else (see ENDLESS). The stopcocks fitted on what comes out of it fitted (see ToolShape.fitted) aren't these: they come with it,
 * and go back with it.
 */
export const STOCK: Record<Stocked, number> = {
  flask: 30, scale: 8, stopcock: 16, dispenser: 8, pipette: 8, exchanger: 8, separator: 8, splitter: 8, multiplexer: 8, sorter: 8,
  heater: 8, tank: 3, meter: 8, dilatometer: 8, column: 8,
  // drawn as this many, but endless
  thermometer: 16, thermometerWide: 16, strip: 16, testpaper: 16, bondpaper: 16,
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
    [{ kind: 'tank', cols: 3, high: 1, deep: 1 }],
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
    [{ kind: 'column', cols: 1, high: 1, deep: 8 }, { kind: 'meter', cols: 1, high: 1, deep: 8 }],
  ],
  [
    [{ kind: 'dispenser', cols: 2, high: 1, deep: 4 }],
    // (the sheets of test paper in one stack, lying flat on the shelf, and the sheets of bond paper in another)
    [
      { kind: 'strip', cols: 8, high: 1, deep: 2 }, { kind: 'testpaper', cols: 1, high: 16, deep: 1 },
      { kind: 'bondpaper', cols: 1, high: 16, deep: 1 }, { kind: 'stopcock', cols: 4, high: 1, deep: 4 },
    ],
    [{ kind: 'thermometer', cols: 8, high: 1, deep: 2 }, { kind: 'thermometerWide', cols: 8, high: 1, deep: 2 }],
  ],
];

/**
 * The cabinet's build, in world units: uprights `side` thick between the bays and at the ends; shelves `board` thick,
 * each `clear` above the tallest thing on the one below; a back panel `back` thick; a `gap` between things side by side
 * and one behind another; and a top `board` thick, `top` above the highest shelf's things. Under the shelves is a
 * solid plinth, as high as SHELF_REACH puts the lowest of them (see CabinetLayout.base).
 */
export const CABINET_BUILD = { side: 8, board: 4, clear: 10, back: 4, gap: 2, top: 16 };

/**
 * How far out from the cabinet's front someone is taken to stand to take things from it: a stride (a cell) out, past
 * their own girth (PLAYER_R), not pressed up against it.
 */
export const STAND_OFF = PLAYER_R + CELL;

/**
 * How low and how high what's on the cabinet's shelves can be, at the front, and still be picked up from STAND_OFF out:
 * within REACH of the eyes, EYE up, so from about 173 to about 1067. Nothing in the cabinet stands lower or reaches
 * higher. The user couldn't reach all the way down to its old bottom shelves, on a plinth 120 high, whose things'
 * feet, and all of a low thing like the heater, were out of reach from there; so the shelves now start well above this
 * (see layout).
 */
export const SHELF_REACH = (() => {
  const r = Math.sqrt(REACH ** 2 - (STAND_OFF + CABINET_BUILD.gap) ** 2);
  return { lo: EYE - r, hi: EYE + r };
})();

/** A kind's size, as its box is drawn (w across, h tall, d deep), and where that box's middle is from its pose. */
function sizeOf(k: Stocked): { w: number; h: number; d: number; c: Vec3 } {
  if (k === 'flask') return { w: 2 * FLASK_R, h: FLASK_H, d: 2 * FLASK_R, c: FLASK_CENTER };
  if (k === 'stopcock') {
    // hanging from where it's held (see STOPCOCK), as it would from a spout
    const { hx, y0, y1, z0, z1 } = COCK_EXTENT;
    return { w: 2 * hx, h: y1 - y0, d: z1 - z0, c: { x: 0, y: -(y0 + y1) / 2, z: (z0 + z1) / 2 } };
  }
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
  /** The top of its plinth, where its lowest shelves are. */
  base: number;
  y1: number;
  bays: { x0: number; x1: number }[];
  shelves: Shelf[];
  /** Each kind's slots: where one of it stands in each (its pose), the back ones first, the front ones last. */
  slots: Record<Stocked, Pose[]>;
  /** How wide and tall the bays' contents are, before any room left over is shared out among them. */
  need: { w: number; h: number; d: number };
}

/**
 * Lay the cabinet out (see CabinetLayout), filling CABINET_AREA across, with whatever room is left shared among its
 * bays. Its tallest bay's things are in the middle of SHELF_REACH, as much room in reach under them as over them, and
 * every bay's shelves start as high: as far off the floor as they can be, with the tallest bay still in reach.
 */
function layout(): CabinetLayout {
  const B = CABINET_BUILD;
  const { x0, x1, z0, z1 } = CABINET_AREA;
  const shelfH = (shelf: readonly Compartment[]) => Math.max(...shelf.map((cp) => compartmentSize(cp).h));
  const tallest = Math.max(...BAYS.map((bay) => bay.reduce((h, sh) => h + shelfH(sh), 0) + (bay.length - 1) * (B.clear + B.board)));
  const { lo, hi } = SHELF_REACH;
  const base = Math.round(lo + Math.max(0, (hi - lo - tallest) / 2));
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
    let y = base;
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
  return { x0, x1, z0, z1, base, y1: needH + B.top, bays, shelves, slots, need: { w: needW, h: needH, d: needD + B.back + B.gap } };
}

export const CABINET: CabinetLayout = layout();

/** What the cabinet holds: for each kind it stocks, whether each of its slots (see CabinetLayout.slots) is filled. */
export type Stock = Record<Stocked, boolean[]>;

/** Whether `k` is something the cabinet stocks. */
export const isStocked = (k: string): k is Stocked => k in STOCK;

/**
 * The cabinet as it would be with `out` of each kind out in the lab: full but for those, taken from the front first,
 * as the equipment wheels take them (see takeFrom); endless kinds are always full.
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
 * Take one of a kind out of the cabinet, as an equipment wheel does: the front-most there is (the last filled slot), or for an
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
