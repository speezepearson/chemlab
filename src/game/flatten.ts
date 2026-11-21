import { FLASK_H } from './flaskShape';
import { CAP, HOME_H, HOME_W } from './config';
import { Flask } from './flask';
import { COLOR_FAUCETS, FAUCETS, faucetIndex } from './faucets';
import { boxesOverlap, type Box } from './physics';
import { LAMP_POSE, STATION_POSE } from './presets';
import type { SaveState, SavedFlask, SavedHose, SavedScale, SavedTool } from './save';
import { Scale, SCALE_SHAPE } from './scale';
import { BENCH, CELL, LIFT, PLANE_Z, ROOM, fromFrac, toFrac, type Pose, type Vec3 } from './space';
import { INLINE_TOOLS, SHAPES, STRIP_FOOT, Tool, UNIQUE_TOOLS, footY, isDipper, overMouth, type Mouth, type ToolKind } from './tools';
import { SHEET_SLOT, faucetBox, faucetPipes, flaskBox, flaskMouth, footAt, nozzleBox, onScale, scaleBox, spoutAt, tankFluid, tankMouth, toolBox } from './bodies';

/**
 * Laying out afresh, along the wall, a lab saved when it was a room to walk round. Such a save put tools, flasks,
 * scales and hoses' nozzles anywhere in the room, facing any of four ways; what made the lab work was what fell into
 * what: fluid leaving a spout or a faucet (or the nozzle of a hose pulled out of one) falls into the first open top
 * below it. So the old layout is read for that plumbing (see plumbing), and for what each dipper stood in (see
 * standing), and everything is set out again along the wall with the same plumbing: a link the old layout had is kept
 * by a hose where it needs one, and no new link is made. Flasks and scales stand along the counter, tools hang above
 * it, and nothing overlaps anything.
 */

/* ---------------- reading a save ---------------- */

/** What a hose runs from, or an outlet is: a tool's spout (the tool by its id), or a faucet (by its current index). */
export type Mount = { tool: number; spout: number } | { faucet: number };

/** A lab read from a save, in the room: where everything is, but not what's in it. */
export interface Lab {
  /** The tools, the supply station among them, each with the save's entry it came from (see `saved`). */
  tools: Tool[];
  /** Per tool, the save's entry it came from. */
  saved: SavedTool[];
  /** The flasks, in the save's order; those on a scale are where it stands them. */
  flasks: Flask[];
  /** The scales, in the save's order, each with what stands on it. */
  scales: Scale[];
  /** The hoses that are on something, one at most per spout or faucet, each with the save's entry it came from. */
  hoses: { on: Mount; outlet: Vec3; saved: number }[];
  /** Each faucet's spout, by current index (see FAUCETS). */
  faucets: Vec3[];
}

/** How far out from the back wall things were in a save from the room, if it didn't say: over the back counter. */
const OLD_Z = 150;
/** Where the supply station was built into the room's right wall, whatever a save from then says. */
const OLD_STATION: Pose = { x: 2250, y: 820, z: 1150, yaw: -Math.PI / 2 };
/**
 * Where a sheet of shadow paper stood in the shadow lamp's slot, at the end of its trough on its own bench in the
 * room's front left corner (facing either way along the trough). One there is in the lamp's slot on the wall now (see
 * SHEET_SLOT), and the lamp, built into the wall, is always where it is (see LAMP_POSE).
 */
const OLD_SLOT = { x: -597.5, y: 534, z: 2750 };

/** Whether a tool in a save from the room was a sheet of shadow paper in the shadow lamp's slot (see OLD_SLOT). */
const oldSlotted = (t: Tool) => t.kind === 'sheet' && Math.hypot(t.pose.x - OLD_SLOT.x, t.pose.y - OLD_SLOT.y, t.pose.z - OLD_SLOT.z) < 1;

/** Where a tool that's always in the same place goes, whatever the save says: the station, the lamp, a sheet in its slot. */
function fixedPose(t: Tool, wall: boolean): Pose | null {
  if (t.kind === 'receptacle') return { ...STATION_POSE };
  if (t.kind === 'shadowlamp') return { ...LAMP_POSE };
  if (!wall && oldSlotted(t)) return { ...SHEET_SLOT };
  return null;
}

/**
 * Where faucet i's spout was in the room: the four colors' in a row along the right wall, and the solvent's in the
 * middle of each of the six islands, two across and three deep.
 */
function oldFaucetSpout(i: number): Vec3 {
  if (i < COLOR_FAUCETS) return { x: 2250, y: 580, z: 350 + 100 * i };
  const k = i - COLOR_FAUCETS;
  return { x: -400 + (k % 2) * 1300 + 550, y: 580, z: 600 + Math.floor(k / 2) * 800 + 250 };
}

const num = (x: unknown, d: number): number => (Number.isFinite(x) ? (x as number) : d);

/**
 * A save's lab, in the room: on the wall if the save is (see SaveState.wall), or else where it was when the lab was a
 * room to walk round. It reads it as the game loads it: tools of unknown kinds and second copies of the one-of-a-kind
 * ones are dropped, a flask on a scale stands where the scale puts it, an older save's wicking strip that stood in a
 * tray is raised to keep its paper where it was, and a hose is on the spout or faucet it names, if there is one and it
 * hasn't one already, and is dropped if not.
 */
export function readLab(s: SaveState): Lab {
  const wall = !!s.wall;
  const at = (p: Vec3, d: { z?: number; yaw?: number }): Pose =>
    wall ? { ...p, z: PLANE_Z, yaw: 0 } : { ...p, z: num(d.z, OLD_Z), yaw: num(d.yaw, 0) };
  const tools: Tool[] = [];
  const saved: SavedTool[] = [];
  for (const st of s.tools) {
    if (!(st.kind in SHAPES)) continue;
    if (UNIQUE_TOOLS.includes(st.kind) && saved.some((u) => u.kind === st.kind)) continue;
    let pose = at(fromFrac({ x: num(st.fx, 0), y: num(st.fy, 0) }), st);
    if (st.kind === 'receptacle') pose = { ...(wall ? STATION_POSE : OLD_STATION) };
    if (st.kind === 'strip' && st.tanks?.length) pose = { ...pose, y: pose.y + STRIP_FOOT - 4 };
    tools.push(new Tool(st.kind, st.id, pose, st.valves ?? []));
    saved.push(st);
  }
  const flasks = s.flasks.map((sf) => {
    const f = new Flask(CAP);
    f.pose = at({ x: num(sf.x, 0) * HOME_W, y: LIFT + num(sf.up, 0), z: 0 }, sf);
    return f;
  });
  const placed = new Set<number>();
  const scales = (s.scales ?? []).map((ss) => {
    const sc = new Scale(at(fromFrac({ x: num(ss.fx, 0), y: num(ss.fy, 0) }), ss));
    for (const { f, dx } of ss.load ?? []) {
      if (!flasks[f] || placed.has(f)) continue;
      placed.add(f);
      sc.put(flasks[f], dx);
      flasks[f].pose = onScale(sc, dx);
    }
    return sc;
  });
  const count = s.faucets?.length ?? 0;
  const hoses: Lab['hoses'] = [];
  (s.hoses ?? []).forEach((sh, i) => {
    const on = mountOf(sh, tools, count);
    if (!on || !sh.outlet || hoses.some((h) => outletKey(h.on) === outletKey(on))) return;
    const o = sh.outlet;
    hoses.push({ on, outlet: { ...fromFrac({ x: num(o.x, 0), y: num(o.y, 0) }), z: wall ? PLANE_Z : num(o.z, OLD_Z) }, saved: i });
  });
  const faucets = wall ? faucetPipes().map((p) => p.spout) : FAUCETS.map((_, i) => oldFaucetSpout(i));
  return { tools, saved, flasks, scales, hoses, faucets };
}

/** The spout or faucet a saved hose is on, by current faucet index, among a save's `count` faucets; null if none. */
function mountOf(sh: SavedHose, tools: readonly Tool[], count: number): Mount | null {
  const on = sh.on;
  if (!on) return null;
  const t = tools.find((u) => u.id === on.tool);
  if (t && Number.isInteger(on.spout) && on.spout! >= 0 && on.spout! < t.shape.spouts.length) return { tool: t.id, spout: on.spout! };
  const fa = Number.isInteger(on.faucet) ? faucetIndex(on.faucet!, count) : null;
  return fa !== null ? { faucet: fa } : null;
}

/* ---------------- what falls into what ---------------- */

/** An outlet's name, for plumbing's keys: "spout 3.1" (tool 3's second spout) or "faucet 4". */
export const outletKey = (m: Mount): string => ('tool' in m ? `spout ${m.tool}.${m.spout}` : `faucet ${m.faucet}`);
/** A vessel's name, for plumbing's values: "flask 2" (by its place in the save), or "tank 3.0" (tool 3's first tank). */
const flaskKey = (i: number) => `flask ${i}`;
const tankKey = (id: number, k: number) => `tank ${id}.${k}`;

/** An open top in the lab: its vessel's name (see flaskKey, tankKey), its mouth, and how high its floor is. */
interface Top {
  key: string;
  m: Mouth;
  floor: number;
}

/** Every open top in a lab: each flask's mouth (none are tipped), and each tool's open tanks'. */
function tops(lab: Lab): Top[] {
  const out: Top[] = lab.flasks.map((f, i) => ({ key: flaskKey(i), m: flaskMouth(f), floor: f.pose.y - FLASK_H }));
  for (const t of lab.tools) {
    t.tanks.forEach((_, k) => {
      if (t.isOpen(k)) out.push({ key: tankKey(t.id, k), m: tankMouth(t, k), floor: tankFluid(t, k).floor });
    });
  }
  return out;
}

/** The first open top that something falling from p lands in (see mouthBelow), or null if it falls to the sink. */
function landing(all: readonly Top[], p: Vec3): Top | null {
  let best: Top | null = null;
  for (const t of all) if (t.m.y < p.y && overMouth(t.m, p.x, p.z) && (!best || t.m.y > best.m.y)) best = t;
  return best;
}

/** Every outlet in a lab and where its fluid leaves: each tool's spouts and each faucet, or the nozzle of a hose on it. */
function outlets(lab: Lab): { on: Mount; p: Vec3 }[] {
  const hose = new Map(lab.hoses.map((h) => [outletKey(h.on), h.outlet]));
  const all: Mount[] = [
    ...lab.tools.flatMap((t) => t.shape.spouts.map((_, j) => ({ tool: t.id, spout: j }))),
    ...lab.faucets.map((_, i) => ({ faucet: i })),
  ];
  return all.map((on) => {
    const p = hose.get(outletKey(on));
    if (p) return { on, p };
    return { on, p: 'tool' in on ? spoutAt(lab.tools.find((t) => t.id === on.tool)!, on.spout) : lab.faucets[on.faucet] };
  });
}

/**
 * A lab's plumbing: for every outlet (see outletKey), the vessel its fluid falls into (see flaskKey, tankKey), or null
 * if it falls to the sink.
 */
export function plumbing(lab: Lab): Record<string, string | null> {
  const all = tops(lab);
  return Object.fromEntries(outlets(lab).map((o) => [outletKey(o.on), landing(all, o.p)?.key ?? null]));
}

/** The open top a dipper's foot at p stands in, if any: under its mouth, and no lower than its floor. */
function standsIn(all: readonly Top[], p: Vec3): Top | null {
  let best: Top | null = null;
  for (const t of all) {
    if (p.y < t.m.y && p.y >= t.floor - 1e-6 && overMouth(t.m, p.x, p.z) && (!best || t.m.y > best.m.y)) best = t;
  }
  return best;
}

/**
 * What each dipper in a lab (by tool id) stands in: the vessel its foot is in (see standsIn) and how high its foot is
 * above that vessel's floor; null for one standing in nothing.
 */
export function standing(lab: Lab): Record<number, { in: string; up: number } | null> {
  const all = tops(lab);
  return Object.fromEntries(
    lab.tools.filter((t) => isDipper(t.kind)).map((t) => {
      const foot = footAt(t);
      const top = standsIn(all, foot);
      return [t.id, top ? { in: top.key, up: foot.y - top.floor } : null];
    }),
  );
}

/* ---------------- laying it out ---------------- */

/** How far in from the bench's ends and the ceiling everything is kept. */
const MARGIN = 10;
/** How high above a counter's top the bottom of a tool hangs, at least: clear of a flask on a scale and its nozzles. */
const TOOL_FLOOR = 120;
/**
 * Where the lowest shelf of tools hangs from (the bottoms of the tools on it), above the counter: over the faucets'
 * spouts, so there's room under every tool for a flask on a scale and a nozzle over it.
 */
const SHELF_FLOOR = 220;
/** How far apart, up and down, the shelves of tools are: between the top of what's kept clear on one and the next. */
const SHELF_GAP = 10;
/** Where along the wall the lab is laid out from: past the faucets' first row, the station and the instruments' place. */
const LAB_X = 3400;
/** Where the one-of-a-kind instruments go, in a row, if there's room: past the supply station. */
const INSTRUMENTS_X = { x0: 2440, x1: LAB_X };
/** The one-of-a-kind instruments, in the order they're laid out in their row (the station is always where it is). */
const INSTRUMENTS: readonly ToolKind[] = UNIQUE_TOOLS.filter((k) => k !== 'receptacle' && k !== 'shadowlamp');
/** How far apart along the wall the places tried for a tool are; for what stands on the counter, twice this. */
const STEP_X = CELL / 4;
/** How far apart up the wall the places tried for a tool are. */
const STEP_Y = 10;
/** How much room is kept clear above every open top, for nozzles and dippers to come. */
const HEADROOM = 60;
/** How high above the mouth it pours into a hose's nozzle is, at least and at most, unless it's snapped onto a tube. */
const NOZZLE_UP = { min: 15, max: 45 };
/** How far apart, up and down, the nozzles of hoses pouring into the same mouth are. */
const NOZZLE_GAP = 12;
/** How high above the mouth of an inline instrument's tube a nozzle was, at most, to have been snapped onto it. */
const DOCKED = 1.5;
/** How high above the counter the tip of a hose's nozzle parked on it is: it pours into nothing. */
const PARKED_Y = LIFT + 6;

/** Where an outlet's fluid leaves, and the vessel it must fall into (null for the sink); a bare spout's name, if it is one. */
interface Outlet {
  p: Vec3;
  expect: string | null;
  bare?: string;
}

/**
 * Something laid out as one, as it would be at one place: what's solid in it, what must be kept clear (room above its
 * open tops), its open tops, its outlets, and where it puts each of its things (to be moved along with it).
 */
interface Cluster {
  solids: Box[];
  clears: Box[];
  tops: Top[];
  outlets: Outlet[];
  tools: Map<number, Pose>;
  flasks: Map<number, Pose>;
  scales: Map<number, Pose>;
  nozzles: Map<string, Vec3>;
}

const shiftBox = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });
const shiftPoint = <T extends Vec3>(p: T, dx: number, dy: number): T => ({ ...p, x: p.x + dx, y: p.y + dy });
const shiftTop = (t: Top, dx: number, dy: number): Top => ({
  key: t.key, floor: t.floor + dy, m: { ...shiftPoint(t.m, dx, dy), rim: t.m.rim && shiftPoint(t.m.rim, dx, dy) },
});
const nozzleAt = (p: Vec3): Box => nozzleBox({ on: { faucet: 0 }, outlet: p });
const within = (b: Box): boolean =>
  b.x - b.hx >= BENCH.x0 + MARGIN - 1e-6 && b.x + b.hx <= BENCH.x1 - MARGIN + 1e-6 && b.y - b.hy >= LIFT - 1e-6 && b.y + b.hy <= ROOM.y1 - MARGIN + 1e-6;

/**
 * Whether box b overlaps any of `others` (see boxesOverlap), checking first, cheaply, whether their bounds are even
 * near: most aren't.
 */
function hits(b: Box, others: readonly Box[]): boolean {
  for (const o of others) {
    if (Math.abs(b.x - o.x) >= b.hx + o.hx || Math.abs(b.y - o.y) >= b.hy + o.hy || Math.abs(b.z - o.z) >= b.hz + o.hz) continue;
    if (boxesOverlap(b, o)) return true;
  }
  return false;
}

/** Something to lay out: a tool (with what stands in it), a scale (with the flasks on it), or a flask on the counter. */
type Thing = { tool: Tool } | { scale: number } | { flask: number };

/** What's been laid out so far, and the checks a place for the next thing must pass. */
class Layout {
  solids: Box[] = [];
  clears: Box[] = [];
  tops: Top[] = [];
  /** Every outlet laid out so far, with how high the top it falls into is (−∞ for the sink). */
  outlets: (Outlet & { under: number })[] = [];
  tools = new Map<number, Pose>();
  flasks = new Map<number, Pose>();
  scales = new Map<number, Pose>();
  nozzles = new Map<string, Vec3>();

  /**
   * Whether c, moved by (dx, dy), fits: inside the bench, overlapping nothing, its outlets falling where they should
   * and nobody else's falling into it. Null if it doesn't; else the bare spouts that would pour into something, which
   * must be none unless `park`, when they're to be given hoses parked on the counter instead. With `clear` false, the
   * room kept above open tops is let go.
   */
  fits(c: Cluster, dx: number, dy: number, park: boolean, clear: boolean): string[] | null {
    const solids = c.solids.map((b) => shiftBox(b, dx, dy));
    if (!solids.every(within)) return null;
    const clears = clear ? c.clears.map((b) => shiftBox(b, dx, dy)) : [];
    if (!clears.every(within)) return null;
    for (const b of solids) if (hits(b, this.solids) || (clear && hits(b, this.clears))) return null;
    for (const b of clears) if (hits(b, this.solids)) return null;
    const tops = c.tops.map((t) => shiftTop(t, dx, dy));
    for (const o of this.outlets) {
      if (tops.some((t) => t.m.y < o.p.y && t.m.y > o.under && overMouth(t.m, o.p.x, o.p.z))) return null;
    }
    const all = [...this.tops, ...tops];
    const parked: string[] = [];
    for (const o of c.outlets) {
      const lands = landing(all, shiftPoint(o.p, dx, dy))?.key ?? null;
      if (lands === o.expect) continue;
      if (!park || !o.bare) return null;
      parked.push(o.bare);
    }
    return parked;
  }

  /** Lay c out, moved by (dx, dy), but for the bare spouts in `parked`, which are to get hoses parked on the counter. */
  add(c: Cluster, dx: number, dy: number, parked: readonly string[] = []): void {
    this.solids.push(...c.solids.map((b) => shiftBox(b, dx, dy)));
    this.clears.push(...c.clears.map((b) => shiftBox(b, dx, dy)));
    this.tops.push(...c.tops.map((t) => shiftTop(t, dx, dy)));
    for (const o of c.outlets) {
      if (o.bare && parked.includes(o.bare)) continue;
      const p = shiftPoint(o.p, dx, dy);
      this.outlets.push({ ...o, p, under: landing(this.tops, p)?.m.y ?? -Infinity });
    }
    for (const [id, p] of c.tools) this.tools.set(id, shiftPoint(p, dx, dy));
    for (const [i, p] of c.flasks) this.flasks.set(i, shiftPoint(p, dx, dy));
    for (const [i, p] of c.scales) this.scales.set(i, shiftPoint(p, dx, dy));
    for (const [k, p] of c.nozzles) this.nozzles.set(k, shiftPoint(p, dx, dy));
  }
}

/** A hose's nozzle to set over a vessel's mouth: its outlet, whether it was snapped onto a tube, and how high it was. */
interface Inflow {
  key: string;
  docked: boolean;
  up: number;
}

/**
 * A save from when the lab was a room to walk round, laid out afresh along the wall (see the top of this file), with
 * the same plumbing; a save that's already on the wall, as it is. Every outlet still falls into the vessel it did, if
 * any, through a hose's nozzle over its mouth if it needs one, and an outlet that fell to the sink still does, its
 * hose's nozzle parked on the counter if it has one; every dipper stands as deep in the same vessel; and nothing
 * overlaps anything, inside the bench. The faucets are listed as they are now, with their notes, and the hoses on them
 * renumbered to match. The save given isn't changed.
 */
export function flatten(s: SaveState): SaveState {
  if (s.wall) return s;
  const old = readLab(s);
  const links = plumbing(old);
  const stood = standing(old);
  const oldTops = new Map(tops(old).map((t) => [t.key, t]));
  const oldOut = new Map(outlets(old).map((o) => [outletKey(o.on), o.p]));
  const oldHose = new Map(old.hoses.map((h) => [outletKey(h.on), h]));
  const toolOf = new Map(old.tools.map((t) => [t.id, t]));

  // what pours into each vessel, and which outlets need a hose: every one that pours into something, or had one
  const into = new Map<string, Inflow[]>();
  for (const [key, v] of Object.entries(links)) {
    if (v === null) continue;
    const o = oldOut.get(key)!;
    const m = oldTops.get(v)!.m;
    const host = v.startsWith('tank') ? toolOf.get(Number(v.slice(5).split('.')[0])) : undefined;
    const docked = !!host && INLINE_TOOLS.includes(host.kind) && oldHose.has(key) && o.y - m.y >= 0 && o.y - m.y <= DOCKED;
    const up = Math.min(NOZZLE_UP.max, Math.max(NOZZLE_UP.min, o.y - m.y));
    into.set(v, [...(into.get(v) ?? []), { key, docked, up }]);
  }
  const hosed = new Set([...oldHose.keys(), ...Object.keys(links).filter((k) => links[k] !== null)]);
  const parked = new Set([...oldHose.keys()].filter((k) => links[k] === null));
  // what stands in each vessel, and how high its foot is above the vessel's floor
  const dipped = new Map<string, { tool: Tool; up: number }[]>();
  for (const t of old.tools) {
    const st = stood[t.id];
    if (st) dipped.set(st.in, [...(dipped.get(st.in) ?? []), { tool: t, up: st.up }]);
  }

  /**
   * A thing's cluster as it would be with its own place at `pose`: itself, the dippers standing in it, the nozzles
   * pouring into it, and the room kept above its open tops.
   */
  function cluster(thing: Thing, pose: Pose): Cluster {
    const c: Cluster = { solids: [], clears: [], tops: [], outlets: [], tools: new Map(), flasks: new Map(), scales: new Map(), nozzles: new Map() };
    const vessels: Top[] = [];
    const standFlask = (i: number, at: Pose) => {
      const f = new Flask(CAP);
      f.pose = at;
      c.solids.push(flaskBox(f));
      c.flasks.set(i, at);
      vessels.push({ key: flaskKey(i), m: flaskMouth(f), floor: at.y - FLASK_H });
    };
    if ('tool' in thing) {
      const t = new Tool(thing.tool.kind, thing.tool.id, pose);
      c.solids.push(toolBox(t));
      c.tools.set(t.id, pose);
      t.tanks.forEach((_, k) => {
        if (t.isOpen(k)) vessels.push({ key: tankKey(t.id, k), m: tankMouth(t, k), floor: tankFluid(t, k).floor });
      });
      t.shape.spouts.forEach((_, j) => {
        const key = outletKey({ tool: t.id, spout: j });
        if (!hosed.has(key)) c.outlets.push({ p: spoutAt(t, j), expect: null, bare: key });
      });
    } else if ('scale' in thing) {
      const sc = new Scale(pose);
      c.solids.push(scaleBox(sc));
      c.scales.set(thing.scale, pose);
      for (const { f, dx } of old.scales[thing.scale].load) standFlask(old.flasks.indexOf(f), onScale(sc, dx));
    } else {
      standFlask(thing.flask, pose);
    }
    c.tops.push(...vessels);
    // the dippers standing in each vessel, their feet as high above its floor as they were, over its mouth's middle
    for (const v of vessels) {
      for (const d of dipped.get(v.key) ?? []) {
        const at: Pose = { x: v.m.x, y: v.floor + d.up + footY(d.tool.kind), z: PLANE_Z, yaw: 0 };
        c.solids.push(toolBox(new Tool(d.tool.kind, d.tool.id, at)));
        c.tools.set(d.tool.id, at);
      }
    }
    // the nozzles pouring into each vessel, one above another, as near as they'll go to the height they were at
    for (const v of vessels) {
      const ups: number[] = [];
      const wants = [...(into.get(v.key) ?? [])].sort((a, b) => +b.docked - +a.docked || a.up - b.up || (a.key < b.key ? -1 : 1));
      wants.forEach((w, i) => {
        const tries = w.docked && i === 0 ? [1] : nozzleHeights(w.up);
        const at = (u: number) => ({ x: v.m.x, y: v.m.y + u, z: v.m.z });
        const fine = (u: number) => !ups.some((h) => Math.abs(h - u) < NOZZLE_GAP) && !hits(nozzleAt(at(u)), c.solids);
        const u = tries.find(fine) ?? tries[tries.length - 1];
        ups.push(u);
        c.solids.push(nozzleAt(at(u)));
        c.nozzles.set(w.key, at(u));
        c.outlets.push({ p: at(u), expect: v.key });
      });
      c.clears.push({ x: v.m.x, y: v.m.y + HEADROOM / 2, z: v.m.z, yaw: 0, hx: v.m.hx, hy: HEADROOM / 2, hz: v.m.hz });
    }
    return c;
  }

  const lay = new Layout();
  // the faucets, and their spouts that have no hose
  const spouts = faucetPipes().map((p) => p.spout);
  spouts.forEach((p, i) => {
    lay.solids.push(faucetBox(p));
    const key = outletKey({ faucet: i });
    if (!hosed.has(key)) lay.outlets.push({ p, expect: null, bare: key, under: -Infinity });
  });
  // the station, where it always is (or where the game will put one, if the save has none); the shadow lamp, built
  // into the wall; and a sheet of shadow paper that was in its slot, in it still
  const station = old.tools.find((t) => t.kind === 'receptacle') ?? new Tool('receptacle', -1, STATION_POSE);
  lay.add(cluster({ tool: station }, { ...STATION_POSE }), 0, 0);
  const fixed = new Map<number, Pose>();
  for (const t of old.tools) {
    const p = t.kind === 'receptacle' ? null : fixedPose(t, false);
    if (!p) continue;
    fixed.set(t.id, p);
    lay.add(cluster({ tool: t }, p), 0, 0);
  }

  // the order things are laid out in: linked things together, upstream first, groups by where they were
  const things = order(old, links, stood);
  const instruments = things.filter((t): t is { tool: Tool } => 'tool' in t && INSTRUMENTS.includes(t.tool.kind));
  instruments.sort((a, b) => INSTRUMENTS.indexOf(a.tool.kind) - INSTRUMENTS.indexOf(b.tool.kind));
  const parkedSpouts: string[] = [];
  const shelf: Shelf = { floor: LIFT + SHELF_FLOOR, top: LIFT + SHELF_FLOOR, x: LAB_X };
  for (const t of instruments) placeTool(lay, t.tool, cluster, INSTRUMENTS_X, true, parkedSpouts);
  for (const t of things) {
    if ('tool' in t) {
      if (INSTRUMENTS.includes(t.tool.kind) || isDipper(t.tool.kind) || t.tool.kind === 'receptacle' || fixed.has(t.tool.id)) continue;
      if (!shelve(lay, t.tool, cluster, shelf)) placeTool(lay, t.tool, cluster, { x0: LAB_X, x1: BENCH.x1 }, false, parkedSpouts);
    } else {
      placeOnCounter(lay, t, cluster, near(lay, t, old, links));
    }
  }
  // the dippers standing in nothing, hung where their feet are in nothing either
  for (const t of things) {
    if (!('tool' in t) || !isDipper(t.tool.kind) || stood[t.tool.id]) continue;
    placeTool(lay, t.tool, cluster, { x0: LAB_X, x1: BENCH.x1 }, false, parkedSpouts, (c, dx, dy) => {
      const foot = footAt(new Tool(t.tool.kind, t.tool.id, shiftPoint(c.tools.get(t.tool.id)!, dx, dy)));
      return !standsIn(lay.tops, foot);
    });
  }
  for (const k of parkedSpouts) {
    hosed.add(k);
    parked.add(k);
  }

  // the hoses whose nozzles pour into nothing, parked on the counter as near as there's room to what they're on
  const parkedAt = new Map<string, Vec3>();
  for (const key of [...hosed].filter((k) => parked.has(k)).sort(byOutlet)) {
    const on = parseOutlet(key);
    const from = 'tool' in on ? lay.tools.get(on.tool)!.x + spoutX(toolOf.get(on.tool)!, on.spout) : spouts[on.faucet].x;
    parkedAt.set(key, park(lay, from));
  }

  return write(s, old, lay, hosed, parkedAt);
}

/** The heights above a mouth to try a nozzle at, nearest `up` first: from NOZZLE_UP's least to most, then higher. */
function nozzleHeights(up: number): number[] {
  const near: number[] = [];
  for (let u = NOZZLE_UP.min; u <= NOZZLE_UP.max; u++) near.push(u);
  near.sort((a, b) => Math.abs(a - up) - Math.abs(b - up) || a - b);
  for (let u = NOZZLE_UP.max + NOZZLE_GAP; u <= 400; u += NOZZLE_GAP) near.push(u);
  return near;
}

/** How far right of a tool's middle its spout j is, as it faces out from the wall. */
const spoutX = (t: Tool, j: number) => t.shape.spouts[j];

/** An outlet's name (see outletKey) read back. */
function parseOutlet(key: string): Mount {
  const [kind, rest] = key.split(' ');
  if (kind === 'faucet') return { faucet: Number(rest) };
  const [tool, spout] = rest.split('.').map(Number);
  return { tool, spout };
}

/** Outlets in a steady order: tools' spouts by tool id and spout, then faucets by index. */
function byOutlet(a: string, b: string): number {
  const [p, q] = [parseOutlet(a), parseOutlet(b)];
  const rank = (m: Mount) => ('tool' in m ? [0, m.tool, m.spout] : [1, m.faucet, 0]);
  const [r, s] = [rank(p), rank(q)];
  return r[0] - s[0] || r[1] - s[1] || r[2] - s[2];
}

/** The shelf tools are being hung on: the bottoms of the tools on it, the top of what's kept clear over them, and how far along it's filled. */
interface Shelf {
  floor: number;
  top: number;
  x: number;
}

/**
 * Hang a tool (with what stands in it and pours into it) on the shelf, its bottom on the shelf's floor, in the first
 * place along it past what's on it already where it fits, with no bare spout pouring into anything; or failing that,
 * on a new shelf above, if there's room for one. Returns whether it was hung.
 */
function shelve(lay: Layout, tool: Tool, cluster: (t: Thing, pose: Pose) => Cluster, shelf: Shelf): boolean {
  const b = tool.shape.box;
  const c = cluster({ tool }, { x: 0, y: 0, z: PLANE_Z, yaw: 0 });
  const top = (dy: number) => Math.max(...[...c.solids, ...c.clears].map((o) => o.y + o.hy + dy));
  for (let tries = 0; tries < 2; tries++) {
    const y = shelf.floor + b.y1;
    if (y - b.y0 > ROOM.y1 - MARGIN) return false;
    for (let x = Math.ceil((shelf.x - b.x0) / STEP_X) * STEP_X; x + b.x1 <= BENCH.x1 - MARGIN; x += STEP_X) {
      if (!lay.fits(c, x, y, false, true)) continue;
      lay.add(c, x, y);
      shelf.x = x + b.x1 + STEP_X;
      shelf.top = Math.max(shelf.top, top(y));
      return true;
    }
    // a new shelf above this one
    Object.assign(shelf, { floor: shelf.top + SHELF_GAP, top: shelf.top + SHELF_GAP, x: LAB_X });
  }
  return false;
}

/**
 * Hang a tool (with what stands in it and pours into it) in the first place that fits, scanning along the wall from
 * `span.x0` (and then from the bench's start) to `span.x1`, and up from just over the counter at each place: by
 * columns, or with `rows`, by rows from the bottom. Places where a bare spout would pour into something are tried
 * only if there are none else, its fewest such spouts being given parked hoses instead (added to `parked`); then the
 * room kept over open tops is let go; and failing all that it's hung at the start anyway. `ok` is any further check.
 */
function placeTool(
  lay: Layout,
  tool: Tool,
  cluster: (t: Thing, pose: Pose) => Cluster,
  span: { x0: number; x1: number },
  rows: boolean,
  parked: string[],
  ok: (c: Cluster, dx: number, dy: number) => boolean = () => true,
): void {
  const b = tool.shape.box;
  // its pose's x on the grid of STEP_X, and its bottom STEP_Y apart
  const firstX = (x0: number) => Math.ceil((x0 + MARGIN - b.x0) / STEP_X) * STEP_X;
  const lastX = (x1: number) => x1 - b.x1;
  const xsIn = (x0: number, x1: number) => {
    const out: number[] = [];
    for (let x = firstX(x0); x <= lastX(x1); x += STEP_X) out.push(x);
    return out;
  };
  const ys = (floor: number) => {
    const out: number[] = [];
    for (let y = LIFT + floor + b.y1; y - b.y0 <= ROOM.y1 - MARGIN; y += STEP_Y) out.push(y);
    return out;
  };
  const c = cluster({ tool }, { x: 0, y: 0, z: PLANE_Z, yaw: 0 });
  const spans = [xsIn(span.x0, span.x1), span.x0 > BENCH.x0 || span.x1 < BENCH.x1 ? xsIn(BENCH.x0, BENCH.x1) : []];
  const attempts: { park: boolean; clear: boolean; floor: number }[] = [
    { park: false, clear: true, floor: TOOL_FLOOR },
    { park: true, clear: true, floor: TOOL_FLOOR },
    { park: true, clear: false, floor: MARGIN },
  ];
  for (const a of attempts) {
    for (const xs of spans) {
      const places = rows ? ys(a.floor).flatMap((y) => xs.map((x) => [x, y])) : xs.flatMap((x) => ys(a.floor).map((y) => [x, y]));
      let best: { x: number; y: number; parks: string[] } | null = null;
      for (const [x, y] of places) {
        const parks = lay.fits(c, x, y, a.park, a.clear);
        if (!parks || !ok(c, x, y)) continue;
        if (!best || parks.length < best.parks.length) best = { x, y, parks };
        if (!parks.length) break;
      }
      if (best) {
        lay.add(c, best.x, best.y, best.parks);
        parked.push(...best.parks);
        return;
      }
    }
  }
  const [x, y] = [firstX(span.x0), ys(MARGIN)[0]];
  lay.add(c, x, y, c.outlets.flatMap((o) => (o.bare ? [o.bare] : [])));
  parked.push(...c.outlets.flatMap((o) => (o.bare ? [o.bare] : [])));
}

/**
 * Stand a scale (with its flasks) or a flask on the counter, at the free place nearest `pref` along it, its middle (and
 * so its flasks') half a CELL off the grid tools hang on, so no tool's spout is ever over a flask's mouth. Failing that
 * (the counter full), anywhere.
 */
function placeOnCounter(lay: Layout, thing: Thing, cluster: (t: Thing, pose: Pose) => Cluster, pref: number): void {
  const isScale = 'scale' in thing;
  const half = isScale ? SCALE_SHAPE.platform.x1 : 28;
  const y = isScale ? LIFT + SCALE_SHAPE.body.y1 : LIFT + FLASK_H;
  const c = cluster(thing, { x: 0, y, z: PLANE_Z, yaw: 0 });
  const xs: number[] = [];
  for (let x = Math.ceil((BENCH.x0 + MARGIN + half - CELL / 4) / (CELL / 2)) * (CELL / 2) + CELL / 4; x + half <= BENCH.x1 - MARGIN; x += CELL / 2) xs.push(x);
  xs.sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref) || a - b);
  for (const clear of [true, false]) {
    for (const x of xs) {
      if (lay.fits(c, x, 0, false, clear)) return lay.add(c, x, 0);
    }
  }
  lay.add(c, xs[0], 0);
}

/**
 * Where along the counter a scale or flask would best stand: under the middle of what's laid out that pours into it,
 * or that it stood in a chain with; else as near the start of the lab as there's room.
 */
function near(lay: Layout, thing: Thing, old: Lab, links: Record<string, string | null>): number {
  const mine = new Set(
    'scale' in thing ? old.scales[thing.scale].load.map(({ f }) => flaskKey(old.flasks.indexOf(f))) : 'flask' in thing ? [flaskKey(thing.flask)] : [],
  );
  const xs: number[] = [];
  for (const [key, v] of Object.entries(links)) {
    if (v === null || !mine.has(v)) continue;
    const on = parseOutlet(key);
    const p = 'tool' in on ? lay.tools.get(on.tool) : undefined;
    if (p && 'tool' in on) xs.push(p.x + old.tools.find((t) => t.id === on.tool)!.shape.spouts[on.spout]);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : LAB_X + CELL / 4;
}

/** Where to park a hose's nozzle on the counter, as near as there's room to `x`: over nothing, and touching nothing. */
function park(lay: Layout, x: number): Vec3 {
  for (let d = 0; d <= BENCH.x1 - BENCH.x0; d += STEP_Y) {
    for (const sx of d ? [x - d, x + d] : [x]) {
      const p = { x: Math.round(sx), y: PARKED_Y, z: PLANE_Z };
      const box = nozzleAt(p);
      if (!within(box) || hits(box, lay.solids) || landing(lay.tops, p)) continue;
      lay.solids.push(box);
      return p;
    }
  }
  return { x, y: PARKED_Y, z: PLANE_Z };
}

/**
 * The order to lay things out in: things linked by what pours into what (or standing on one scale) together, each
 * group from what's upstream to what's downstream, and the groups in the order they stood across the room, from the
 * back wall out. Dippers standing in something go with it, so they aren't listed.
 */
function order(old: Lab, links: Record<string, string | null>, stood: Record<number, unknown>): Thing[] {
  const onScale = new Map<number, number>();
  old.scales.forEach((sc, i) => sc.load.forEach(({ f }) => onScale.set(old.flasks.indexOf(f), i)));
  const things: Thing[] = [
    ...old.tools.filter((t) => !(isDipper(t.kind) && stood[t.id])).map((tool) => ({ tool })),
    ...old.scales.map((_, scale) => ({ scale })),
    ...old.flasks.flatMap((_, flask) => (onScale.has(flask) ? [] : [{ flask }])),
  ];
  const name = (t: Thing) => ('tool' in t ? `t${t.tool.id}` : 'scale' in t ? `s${t.scale}` : `f${t.flask}`);
  const index = new Map(things.map((t, i) => [name(t), i]));
  const of = (vessel: string): number | undefined => {
    const [kind, rest] = vessel.split(' ');
    if (kind === 'flask') {
      const f = Number(rest);
      return onScale.has(f) ? index.get(`s${onScale.get(f)}`) : index.get(`f${f}`);
    }
    return index.get(`t${Number(rest.split('.')[0])}`);
  };
  const where = (t: Thing): Pose => ('tool' in t ? t.tool.pose : 'scale' in t ? old.scales[t.scale].pose : old.flasks[t.flask].pose);
  // across the room from the back wall out, a few cells deep at a time, and along each band
  const rank = (i: number) => {
    const p = where(things[i]);
    return Math.floor(p.z / (4 * CELL)) * 1e6 + p.x;
  };
  const next: number[][] = things.map(() => []);
  const fed = things.map(() => false);
  const group = things.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])));
  for (const [key, v] of Object.entries(links)) {
    const on = parseOutlet(key);
    if (v === null || !('tool' in on)) continue;
    const [a, b] = [index.get(`t${on.tool}`), of(v)];
    if (a === undefined || b === undefined || a === b) continue;
    next[a].push(b);
    fed[b] = true;
    group[root(a)] = root(b);
  }
  const byRank = things.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
  const groups = new Map<number, number[]>();
  for (const i of byRank) groups.set(root(i), [...(groups.get(root(i)) ?? []), i]);
  const seen = new Set<number>();
  const out: Thing[] = [];
  const visit = (i: number) => {
    if (seen.has(i)) return;
    seen.add(i);
    out.push(things[i]);
    for (const j of [...next[i]].sort((a, b) => rank(a) - rank(b) || a - b)) visit(j);
  };
  for (const members of groups.values()) {
    for (const i of members) if (!fed[i]) visit(i);
    for (const i of members) visit(i);
  }
  return out;
}

/* ---------------- writing it out ---------------- */

/** The save, laid out as `lay` has it, with every hose in `hosed`: its nozzle over what it pours into, or parked. */
function write(s: SaveState, old: Lab, lay: Layout, hosed: Set<string>, parkedAt: Map<string, Vec3>): SaveState {
  const frac = (p: Vec3) => {
    const f = toFrac(p);
    return { fx: f.x, fy: f.y };
  };
  const flat = <T extends { z?: number; yaw?: number }>(o: T): T => {
    const out = structuredClone(o);
    delete out.z;
    delete out.yaw;
    return out;
  };
  const tools: SavedTool[] = old.saved.map((st) => {
    const t = flat(st);
    const pose = st.kind === 'receptacle' ? STATION_POSE : lay.tools.get(st.id)!;
    Object.assign(t, frac(pose));
    // an older save's strip stood in a tray; it's bare paper now, posed where its paper is (see readLab), and with no
    // tray left in its save, it isn't raised again
    if (st.kind === 'strip' && st.tanks?.length) {
      const label = st.tanks[0]?.label;
      if (!t.note && typeof label === 'string' && label) t.note = label;
      t.tanks = [];
    }
    return t;
  });
  const flasks: SavedFlask[] = s.flasks.map((sf, i) => {
    const p = lay.flasks.get(i)!;
    return { ...flat(sf), x: p.x / HOME_W, up: p.y - LIFT };
  });
  const scales: SavedScale[] = (s.scales ?? []).map((ss, i) => ({
    ...flat(ss),
    ...frac(lay.scales.get(i)!),
    load: old.scales[i].load.map(({ f, dx }) => ({ f: old.flasks.indexOf(f), dx })),
  }));
  const hose = (key: string): SavedHose => {
    const p = lay.nozzles.get(key) ?? parkedAt.get(key)!;
    const f = toFrac(p);
    return { outlet: { x: f.x, y: f.y }, on: parseOutlet(key) };
  };
  const kept = old.hoses.map((h) => outletKey(h.on));
  const added = [...hosed].filter((k) => !kept.includes(k)).sort(byOutlet);
  const count = s.faucets?.length ?? 0;
  const notes = new Map<number, string>();
  (s.faucets ?? []).forEach((f, i) => {
    const j = faucetIndex(i, count);
    if (j !== null && typeof f?.note === 'string') notes.set(j, f.note);
  });
  const out: SaveState = {
    ...structuredClone(s),
    wall: true,
    tools,
    flasks,
    scales,
    hoses: [...kept, ...added].map(hose),
    faucets: FAUCETS.map((_, i) => ({ x: (i + 0.5) / FAUCETS.length, y: 30 / HOME_H, ...(notes.has(i) ? { note: notes.get(i) } : {}) })),
  };
  return out;
}
