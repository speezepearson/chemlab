import { describe, expect, test } from 'vitest';
import { HOME_W } from './config';
import { SHEET_SLOT, faucetBox, faucetPipes, flaskBox, footAt, inSlot, nozzleBox, scaleBox, tankMouth, toolBox } from './bodies';
import { LAMP_POSE } from './presets';
import { FAUCETS } from './faucets';
import { FLASK_H } from './flaskShape';
import { flatten, outletKey, plumbing, readLab, standing, type Lab } from './flatten';
import { boxesOverlap, type Box } from './physics';
import type { SaveState, SavedTool } from './save';
import { SCALE_SHAPE } from './scale';
import { BENCH, LIFT, ROOM, toFrac, type Pose, type Vec3 } from './space';
import { Tool, footY, isDipper, type ToolKind } from './tools';

/* ---------------- building saves from when the lab was a room ---------------- */

/** A tool saved with its top center at (x, y, z) in the room, facing `yaw`. */
function tool(kind: ToolKind, id: number, x: number, y: number, z: number, yaw = 0): SavedTool {
  const f = toFrac({ x, y, z });
  return { kind, id, fx: f.x, fy: f.y, z, yaw, valves: [], tanks: [] };
}

/** A flask saved with its mouth at (x, y, z) in the room. */
const flask = (x: number, y: number, z: number) => ({ n: {}, Q: 0, x: x / HOME_W, up: y - LIFT, z, yaw: 0, glass: 100 });

/** A hose saved with its nozzle at p in the room. */
function hose(on: { tool?: number; spout?: number; faucet?: number }, p: Vec3) {
  const f = toFrac(p);
  return { outlet: { x: f.x, y: f.y, z: p.z }, on };
}

/** A save from the room, with the current faucets (so hoses on faucets are by their current index). */
function room(parts: Partial<SaveState>): SaveState {
  return {
    v: 1, preset: 'stranded', flasks: [], tools: [], scales: [], hoses: [],
    faucets: FAUCETS.map((_, i) => ({ x: (i + 0.5) / FAUCETS.length, y: 0.05 })),
    ...parts,
  };
}

/** Where a tool's tank's mouth is, as the tool stands in the room at `pose`. */
const mouthOf = (kind: ToolKind, pose: Pose, k = 0) => tankMouth(new Tool(kind, 0, pose), k);

/* ---------------- the guarantees ---------------- */

/** Everything solid in a lab on the wall, with what it is, and the fixed things it must keep clear of. */
function bodies(lab: Lab): { name: string; box: Box; dipper?: number }[] {
  return [
    ...lab.tools.map((t) => ({ name: `tool ${t.id} (${t.kind})`, box: toolBox(t), dipper: isDipper(t.kind) ? t.id : undefined })),
    ...lab.flasks.map((f, i) => ({ name: `flask ${i}`, box: flaskBox(f) })),
    ...lab.scales.map((sc, i) => ({ name: `scale ${i}`, box: scaleBox(sc) })),
    ...lab.hoses.map((h) => ({ name: `nozzle on ${outletKey(h.on)}`, box: nozzleBox({ on: { faucet: 0 }, outlet: h.outlet }) })),
    ...faucetPipes().map((p, i) => ({ name: `faucet ${i}`, box: faucetBox(p.spout) })),
  ];
}

/** Check every guarantee flatten makes of a save from the room; returns the lab it laid out. */
function check(s: SaveState): { flat: SaveState; lab: Lab } {
  const before = JSON.stringify(s);
  const flat = flatten(s);
  expect(JSON.stringify(s)).toBe(before);
  expect(flat.wall).toBe(true);
  // it's laid out once and for all
  expect(flatten(flat)).toBe(flat);
  expect(flatten(structuredClone(s))).toEqual(flat);
  const old = readLab(s);
  const lab = readLab(flat);
  // every link kept, and none made
  expect(plumbing(lab)).toEqual(plumbing(old));
  // every dipper in what it stood in, as deep, over its mouth's middle
  const stood = standing(old);
  const stands = standing(lab);
  for (const [id, st] of Object.entries(stood)) {
    if (!st) continue;
    expect(stands[Number(id)]?.in).toBe(st.in);
    expect(stands[Number(id)]!.up).toBeCloseTo(st.up, 6);
  }
  // nothing overlaps, but a dipper the vessel it stands in; and everything's on the bench
  const all = bodies(lab);
  const hostOf = (id: number) => stands[id]?.in.match(/^tank (-?\d+)\./)?.[1];
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    // (a sheet of shadow paper in the lamp's slot reaches down behind the counter)
    const slotted = a.name.includes('(sheet)') && inSlot(lab.tools.find((t) => a.name.startsWith(`tool ${t.id} `))!.pose);
    if (!a.name.startsWith('faucet') && !slotted) {
      expect(a.box.x - a.box.hx, a.name).toBeGreaterThanOrEqual(BENCH.x0);
      expect(a.box.x + a.box.hx, a.name).toBeLessThanOrEqual(BENCH.x1);
      expect(a.box.y - a.box.hy, a.name).toBeGreaterThanOrEqual(LIFT - 1e-6);
      expect(a.box.y + a.box.hy, a.name).toBeLessThanOrEqual(ROOM.y1);
    }
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      const exempt = (d: { dipper?: number }, o: { name: string }) => d.dipper !== undefined && o.name.startsWith(`tool ${hostOf(d.dipper)} `);
      if (exempt(a, b) || exempt(b, a)) continue;
      expect(boxesOverlap(a.box, b.box), `${a.name} overlaps ${b.name}`).toBe(false);
    }
  }
  // flasks and scales stand on the counter, flasks on scales on them where they were
  const onScale = new Set(lab.scales.flatMap((sc) => sc.load.map(({ f }) => f)));
  lab.flasks.forEach((f) => {
    if (!onScale.has(f)) expect(f.pose.y).toBeCloseTo(LIFT + FLASK_H, 6);
  });
  lab.scales.forEach((sc) => expect(sc.pose.y).toBeCloseTo(LIFT + SCALE_SHAPE.body.y1, 6));
  expect(flat.scales.map((sc) => sc.load)).toEqual(old.scales.map((sc) => sc.load.map(({ f, dx }) => ({ f: old.flasks.indexOf(f), dx }))));
  // saved as the wall has it: no depths or yaws left
  for (const o of [...flat.tools, ...flat.flasks, ...flat.scales]) expect('z' in o || 'yaw' in o).toBe(false);
  for (const h of flat.hoses) expect(Object.keys(h.outlet).sort()).toEqual(['x', 'y']);
  expect(flat.faucets).toHaveLength(FAUCETS.length);
  return { flat, lab };
}

/** Where the hose on an outlet has its nozzle, in a lab. */
const nozzle = (lab: Lab, key: string) => lab.hoses.find((h) => outletKey(h.on) === key)?.outlet;

describe('flatten', () => {
  test("hangs a sheet of test paper or bond paper that lay on a counter on the wall, and puts the shadow lamp, and a sheet in its slot, where they always are", () => {
    const s = room({
      tools: [
        tool('testpaper', 1, 300, 420.4, 950, Math.PI / 2), tool('bondpaper', 2, 1500, 420.4, 350),
        // the lamp on its bench in the front left corner, a sheet in its slot facing it, and another on a stand
        tool('shadowlamp', 3, -450, 520, 2750, Math.PI), tool('sheet', 4, -597.5, 534, 2750, Math.PI / 2), tool('sheet', 5, 900, 700, 300),
      ],
    });
    const { lab } = check(s);
    const of = (id: number) => lab.tools.find((t) => t.id === id)!;
    expect(of(3).pose).toEqual(LAMP_POSE);
    expect(of(4).pose).toEqual(SHEET_SLOT);
    expect(inSlot(of(5).pose)).toBe(false);
    for (const id of [1, 2, 5]) {
      const b = toolBox(of(id));
      expect(b.x - b.hx).toBeGreaterThanOrEqual(BENCH.x0);
      expect(b.y - b.hy).toBeGreaterThanOrEqual(LIFT);
    }
  });

  test('leaves a save that is already on the wall as it is', () => {
    const s: SaveState = { ...room({}), wall: true };
    expect(flatten(s)).toBe(s);
  });

  test('keeps a spout pouring into a flask below it, with a hose, and leaves one pouring into nothing bare', () => {
    const s = room({
      tools: [tool('dispenser', 1, 3000, 700, 600), tool('dispenser', 2, 3400, 700, 600)],
      flasks: [flask(3000, 520, 600)],
    });
    expect(plumbing(readLab(s))).toMatchObject({ 'spout 1.0': 'flask 0', 'spout 2.0': null });
    const { lab } = check(s);
    const p = nozzle(lab, 'spout 1.0')!;
    expect(p.x).toBeCloseTo(lab.flasks[0].pose.x, 6);
    // it was 66 above the flask's mouth, so it's as high as a nozzle goes
    expect(p.y - lab.flasks[0].pose.y).toBeCloseTo(45, 6);
    expect(nozzle(lab, 'spout 2.0')).toBeUndefined();
  });

  test('reads spouts and mouths turned to face any way', () => {
    // an exchanger turned a quarter, its spouts over two flasks along z, pouring into a tank turned the other way
    const pose: Pose = { x: 3000, y: 800, z: 900, yaw: Math.PI / 2 };
    const t = new Tool('exchanger', 1, pose);
    const s = room({
      tools: [tool('exchanger', 1, pose.x, pose.y, pose.z, pose.yaw), tool('tank', 2, 2000, 640, 900, -Math.PI / 2)],
      flasks: t.shape.spouts.map((x) => flask(pose.x, 600, pose.z - x)),
    });
    const links = plumbing(readLab(s));
    expect(links['spout 1.0']).toBe('flask 0');
    expect(links['spout 1.1']).toBe('flask 1');
    check(s);
  });

  test('gives a faucet that poured into something a hose, and keeps the rest bare and pouring into nothing', () => {
    const s = room({ flasks: [flask(2250, 490, 350)] });
    expect(plumbing(readLab(s))['faucet 0']).toBe('flask 0');
    const { flat, lab } = check(s);
    expect(flat.hoses.map((h) => h.on)).toEqual([{ faucet: 0 }]);
    expect(nozzle(lab, 'faucet 0')!.x).toBeCloseTo(lab.flasks[0].pose.x, 6);
  });

  test('sets a nozzle over the middle of the mouth it pours into, as high above it as it was, within limits', () => {
    const pose: Pose = { x: 500, y: 600, z: 900, yaw: Math.PI };
    const m = mouthOf('dispenser', pose);
    const s = room({
      tools: [tool('dispenser', 1, 300, 900, 1500), tool('dispenser', 2, pose.x, pose.y, pose.z, pose.yaw), tool('splitter', 3, 800, 900, 1500)],
      hoses: [hose({ tool: 1, spout: 0 }, { x: m.x + 20, y: m.y + 30, z: m.z }), hose({ tool: 3, spout: 1 }, { x: m.x, y: m.y + 5, z: m.z - 10 })],
    });
    const { lab } = check(s);
    const into = tankMouth(lab.tools.find((t) => t.id === 2)!, 0);
    const a = nozzle(lab, 'spout 1.0')!;
    const b = nozzle(lab, 'spout 3.1')!;
    expect([a.x, b.x]).toEqual([into.x, into.x]);
    // the one 30 above stays 30 above; the one 5 above goes up to the least height, and they're kept apart
    expect(b.y - into.y).toBe(15);
    expect(a.y - into.y).toBe(30);
  });

  test('stacks the nozzles of several hoses into one mouth', () => {
    const pose: Pose = { x: 600, y: 700, z: 1500, yaw: 0 };
    const m = mouthOf('tank', pose);
    const s = room({
      tools: [tool('tank', 1, pose.x, pose.y, pose.z)],
      hoses: [0, 1, 2, 3].map((i) => hose({ faucet: i }, { x: m.x + 10 * i, y: m.y + 24, z: m.z })),
    });
    const { lab } = check(s);
    const ys = [0, 1, 2, 3].map((i) => nozzle(lab, `faucet ${i}`)!.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(12);
  });

  test('keeps a nozzle snapped onto an inline instrument snapped', () => {
    const pose: Pose = { x: 1000, y: 800, z: 1800, yaw: Math.PI / 2 };
    const m = mouthOf('meter', pose);
    const s = room({
      tools: [tool('dispenser', 1, 300, 900, 1500), tool('meter', 2, pose.x, pose.y, pose.z, pose.yaw), tool('spectroscope', 3, 1500, 800, 1800)],
      hoses: [hose({ tool: 1, spout: 0 }, { x: m.x, y: m.y + 1, z: m.z }), hose({ tool: 2, spout: 0 }, { ...mouthOf('spectroscope', { x: 1500, y: 800, z: 1800, yaw: 0 }), y: mouthOf('spectroscope', { x: 1500, y: 800, z: 1800, yaw: 0 }).y + 30 })],
    });
    const { lab } = check(s);
    const into = tankMouth(lab.tools.find((t) => t.id === 2)!, 0);
    expect(nozzle(lab, 'spout 1.0')!.y).toBeCloseTo(into.y + 1, 6);
    const analyzer = tankMouth(lab.tools.find((t) => t.id === 3)!, 0);
    expect(nozzle(lab, 'spout 2.0')!.y).toBeCloseTo(analyzer.y + 30, 6);
  });

  test('parks a hose that poured into nothing on the counter', () => {
    const s = room({ tools: [tool('heater', 1, 600, 900, 1500)], hoses: [hose({ tool: 1, spout: 0 }, { x: 100, y: 800, z: 2900 })] });
    expect(plumbing(readLab(s))['spout 1.0']).toBeNull();
    const { lab } = check(s);
    expect(nozzle(lab, 'spout 1.0')!.y).toBeCloseTo(LIFT + 6, 6);
  });

  test('stands a dipper as deep in what it stood in', () => {
    const t = new Tool('thermometer', 2, { x: 0, y: 0, z: 0, yaw: 0 });
    const strip = new Tool('strip', 3, { x: 0, y: 0, z: 0, yaw: 0 });
    const tank: Pose = { x: 600, y: 700, z: 1500, yaw: 0 };
    const fl = { x: 300, y: 490, z: 900 };
    const s = room({
      tools: [
        tool('dispenser', 1, tank.x, tank.y, tank.z),
        tool('thermometer', 2, fl.x, fl.y - FLASK_H + 20 + footY(t.kind), fl.z),
        tool('strip', 3, tank.x + 10, tank.y - 60 + footY(strip.kind), tank.z),
        tool('thermometerWide', 4, 2000, 1000, 1000),
      ],
      flasks: [flask(fl.x, fl.y, fl.z)],
      hoses: [hose({ faucet: 5 }, { x: fl.x, y: fl.y + 20, z: fl.z })],
    });
    const old = standing(readLab(s));
    expect(old[2]).toEqual({ in: 'flask 0', up: 20 });
    expect(old[3]?.in).toBe('tank 1.0');
    expect(old[4]).toBeNull();
    const { lab } = check(s);
    expect(standing(lab)[4]).toBeNull();
    const th = lab.tools.find((u) => u.id === 2)!;
    expect(footAt(th).x).toBeCloseTo(lab.flasks[0].pose.x, 6);
  });

  test('keeps flasks on their scales where they stood on them', () => {
    const sc = toFrac({ x: 900, y: 460, z: 600 });
    const s = room({
      flasks: [flask(850, 530, 600), flask(950, 530, 600), flask(1200, 490, 600)],
      scales: [{ fx: sc.x, fy: sc.y, z: 600, yaw: Math.PI, tare: 0, load: [{ f: 0, dx: -50 }, { f: 1, dx: 50 }] }],
      tools: [tool('exchanger', 1, 900, 700, 600, Math.PI)],
    });
    const links = plumbing(readLab(s));
    expect(new Set([links['spout 1.0'], links['spout 1.1']])).toEqual(new Set(['flask 0', 'flask 1']));
    const { lab } = check(s);
    expect(lab.flasks[1].pose.x - lab.flasks[0].pose.x).toBeCloseTo(100, 6);
  });

  test('hangs many tools without a spout over anything', () => {
    const kinds: ToolKind[] = ['dispenser', 'separator', 'heater', 'sorter', 'tank', 'exchanger', 'splitter', 'multiplexer', 'pipette', 'column', 'testpaper', 'dilatometer'];
    const tools = Array.from({ length: 60 }, (_, i) => tool(kinds[i % kinds.length], i, 200 + (i % 10) * 200, 900, 600 + Math.floor(i / 10) * 300, (i % 4) * (Math.PI / 2)));
    const s = room({ tools, flasks: Array.from({ length: 12 }, (_, i) => flask(200 + i * 150, 490, 300)) });
    check(s);
  });

  test('lists the faucets as they are now, and renumbers or drops the hoses on them', () => {
    // six faucets were six atoms: the first, third and fifth are R, G and B (see faucetIndex)
    const s = room({
      faucets: Array.from({ length: 6 }, (_, i) => ({ x: i / 6, y: 0.05, note: `note ${i}` })),
      tools: [tool('dispenser', 1, 600, 700, 1500), tool('nonsense' as ToolKind, 2, 0, 700, 600)],
      hoses: [hose({ faucet: 2 }, { x: 0, y: 900, z: 300 }), hose({ faucet: 1 }, { x: 0, y: 900, z: 300 }), hose({ tool: 2, spout: 0 }, { x: 0, y: 900, z: 300 }), { outlet: { x: 0, y: 0 } }],
    });
    const { flat } = check(s);
    expect(flat.tools.map((t) => t.id)).toEqual([1]);
    expect(flat.hoses.map((h) => h.on)).toEqual([{ faucet: 1 }]);
    expect(flat.faucets!.map((f) => f.note)).toEqual(['note 0', 'note 2', 'note 4', ...Array(FAUCETS.length - 3).fill(undefined)]);
  });
});

const SAVES = import.meta.glob<SaveState>('../../bench/saves/*.json', { eager: true, import: 'default' });

describe('flatten the bench saves', () => {
  test('there are some', () => expect(Object.keys(SAVES).length).toBeGreaterThan(0));
  for (const [path, s] of Object.entries(SAVES)) {
    test(path.split('/').pop()!, () => {
      const { flat, lab } = check(s);
      const all = bodies(lab).filter((b) => !b.name.startsWith('faucet'));
      const added = flat.hoses.length - readLab(s).hoses.length;
      const parked = lab.hoses.filter((h) => Math.abs(h.outlet.y - (LIFT + 6)) < 1e-6).length;
      const x0 = Math.min(...all.map((b) => b.box.x - b.box.hx));
      const x1 = Math.max(...all.map((b) => b.box.x + b.box.hx));
      const y1 = Math.max(...all.map((b) => b.box.y + b.box.hy));
      console.log(`${path}: ${added} hoses added, ${parked} parked; x ${x0.toFixed(0)}..${x1.toFixed(0)}, top ${y1.toFixed(0)}`);
    });
  }
});
