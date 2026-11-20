import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReactionNetwork } from '../chem/reactions';
import { testChemParams } from '../chem/testChem';
import { SOLVENT_SPECIES, pairOf, singleOf } from '../chem/species';
import { SHEET_SLOT, flaskLip, inSlot, sheetIn, slotPose, toolStands } from './bodies';
import { STOCK } from './cabinet';
import { CAP } from './config';
import type { GameEngine } from './engine';
import { Vessel, volume, type Flask } from './flask';
import { DEFAULT_PRESET, LAMP_POSE } from './presets';
import type { SaveState } from './save';
import { CELL, LIFT, toCell } from './space';
import { INLINE_TOOLS, SHAPES, SHEET, TEST_PAPER, UNIQUE_TOOLS, darkness, paperReading, type Tool } from './tools';

/*
 * The engine itself, with nothing to draw on and nothing to hear: the view and the sounds are stood in for, as they
 * are in the headless benchmark (see bench/), along with the few things of a browser's that it reaches for.
 */

vi.mock('./view', () => ({
  ARRIVAL: { open: 1 },
  View: class {
    resize(): void {}
    look(): void {}
    pick(): null {
      return null;
    }
    project(): null {
      return null;
    }
    toHead(p: unknown): unknown {
      return p;
    }
    icons(): object {
      return {};
    }
    render(): void {}
    dispose(): void {}
  },
}));
const quiet = () => ({ place() {}, swing() {}, run() {}, clunk() {}, stop() {} });
vi.mock('./water', () => ({ WaterSounds: class { update(): void {} stop(): void {} } }));
vi.mock('./diverter', () => ({ diverter: quiet }));
vi.mock('./changeover', () => ({ changeover: quiet }));
vi.mock('./chime', () => ({ chime() {} }));
vi.mock('./shatter', () => ({ shatter() {} }));
vi.mock('./ambience', () => ({ hushAlarms() {} }));

/** The engine's own things, which these tests reach into. */
interface Inside {
  tools: Tool[];
  held: { kind: string; t?: Tool; relYaw: number } | null;
  target: unknown;
  stock: Record<string, boolean[]>;
  leftDown(shift: boolean): void;
  release(): void;
  putAway(): void;
  putBack(): void;
  move(dt: number): void;
  simulate(dt: number, quiet?: boolean): void;
  sleeper(): { skip(dt: number): void };
  placement(h: unknown): { rest: { pose: Tool['pose'] } } | { why: string };
  stands(): { of: { t?: Tool } }[];
}

let Engine: typeof GameEngine;
const engines: GameEngine[] = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const noop = () => {};
  g.window = globalThis;
  g.addEventListener ??= noop;
  g.removeEventListener ??= noop;
  g.document = { addEventListener: noop, removeEventListener: noop, pointerLockElement: null, exitPointerLock: noop };
  g.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = noop;
  ({ GameEngine: Engine } = await import('./engine'));
});

afterEach(() => {
  for (const e of engines.splice(0)) e.destroy();
});

/** A lab with nothing drawn, and what's inside it. */
function lab(): { e: GameEngine; in: Inside } {
  const canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const stage = { clientWidth: 1280, clientHeight: 720 } as unknown as HTMLElement;
  const cb = { onInspect() {}, onEdit() {}, onLabel() {}, onHud() {}, onAwake() {} };
  const e = new Engine(canvas, stage, new ReactionNetwork(testChemParams()), cb);
  engines.push(e);
  return { e, in: e as unknown as Inside };
}

/** The least a save can be: as old a lab as there is, with nothing in it. */
const bare = (): SaveState => ({ v: 1, preset: DEFAULT_PRESET.id, flasks: [], tools: [], scales: [], hoses: [] });

describe('test paper', () => {
  type Lab = { e: GameEngine; in: Inside };
  /** More of the engine's own things, which these tests reach into. */
  interface Hands {
    held: { kind: string; t?: Tool; f?: Flask; dir?: { x: number; y: number; z: number } } | null;
    flasks: Flask[];
    placeHeld(h: unknown, p: Tool['pose']): void;
  }
  const hands = (l: Lab) => l.in as unknown as Hands;
  const R = singleOf('R');
  const G = singleOf('G');
  const RG = pairOf('R', 'G');
  /** The middle of a cell in the front row of the first island. */
  const SPOT = { x: 150, z: 950 };
  const paperOf = (t: Tool) => t.paper[0];
  /** Where something is, to a millionth of a unit. */
  const where = (p: Tool['pose']) => [p.x, p.y, p.z, p.yaw].map((v) => Math.round(v * 1e6) / 1e6 + 0);
  const flat = (x: number, z: number, yaw = 0) => [x, LIFT + TEST_PAPER.thick, z, yaw];

  /** Take a sheet out of the cabinet, by the wheel, and lay it down in the cell at (x, z). */
  function lay(l: Lab, x = SPOT.x, z = SPOT.z): Tool {
    // looking a little down, the sheet is held low in front, over the cell
    const there = () => {
      l.e.debug({ x, z: z + 96, yaw: 0, pitch: (-20 * Math.PI) / 180 });
      l.in.move(0);
    };
    there();
    expect(l.e.spawn('testpaper')).toBe(true);
    there();
    const t = l.in.held!.t!;
    l.in.release();
    expect(l.in.held).toBeNull();
    return t;
  }

  /** Take one of a kind out of the cabinet and hold it at a pose, standing well out of its way. */
  function holdAt(l: Lab, kind: 'flask' | 'pipette' | 'testpaper', p: Tool['pose']): void {
    l.e.debug({ x: p.x, z: p.z + 400, yaw: 0, pitch: 0 });
    l.in.move(0);
    expect(l.e.spawn(kind)).toBe(true);
    hands(l).placeHeld(l.in.held, p);
  }

  /** A pipette set down on its stand with its spout over the middle of the cell at (x, z), `up` above the counter. */
  function pipetteOver(l: Lab, x = SPOT.x, z = SPOT.z, up = 60): Tool {
    holdAt(l, 'pipette', { x, y: LIFT + up + SHAPES.pipette.spoutY, z, yaw: 0 });
    const t = l.in.held!.t!;
    l.in.release();
    expect(l.in.held).toBeNull();
    return t;
  }

  /** Run the lab for `s` sim seconds. */
  const run = (l: Lab, s: number) => {
    for (let i = 0; i < Math.round(s / 0.05); i++) l.in.simulate(0.05);
  };

  it('comes out of the cabinet as often as wanted, held low so that its face shows, and is thrown away when put away', () => {
    const l = lab();
    for (let i = 0; i < STOCK.testpaper + 3; i++) {
      expect(l.e.spawn('testpaper')).toBe(true);
      expect(l.in.held?.t?.kind).toBe('testpaper');
      expect(hands(l).held!.dir!.y).toBeLessThan(0);
      l.in.putAway();
      expect(l.in.held).toBeNull();
    }
    expect(l.in.tools.some((t) => t.kind === 'testpaper')).toBe(false);
    expect(l.in.stock.testpaper.every(Boolean)).toBe(true);
  });

  it('lies flat on the counter where it is let go of, in the middle of a cell, with no stand', () => {
    const l = lab();
    const sheet = lay(l);
    expect(where(sheet.pose)).toEqual(flat(SPOT.x, SPOT.z));
    expect(toolStands(sheet)).toEqual([]);
    expect(l.in.stands().some((s) => s.of.t === sheet)).toBe(false);
    // off a counter there's nowhere for it to lie
    holdAt(l, 'testpaper', { x: 150, y: 500, z: 1200, yaw: 0 });
    expect('why' in l.in.placement(l.in.held)).toBe(true);
    l.in.putAway();
    // turned a quarter, it lies a quarter turned
    holdAt(l, 'testpaper', { x: 350, y: 500, z: 950, yaw: Math.PI / 2 });
    const turned = l.in.held!.t!;
    l.in.release();
    expect(where(turned.pose)).toEqual(flat(350, 950, where({ ...turned.pose, yaw: Math.PI / 2 })[3]));
  });

  it('lets nothing else be set down on its cell, but a tool on its stand can have its spout over it', () => {
    const l = lab();
    const sheet = lay(l);
    const cell = (p: { x: number; z: number }) => [toCell(p.x), toCell(p.z)];
    // a flask held over it goes down in the next cell
    holdAt(l, 'flask', { x: SPOT.x + 10, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const fl = l.in.placement(l.in.held);
    expect('rest' in fl && cell(fl.rest.pose)).not.toEqual(cell(SPOT));
    expect('rest' in fl && Math.hypot(fl.rest.pose.x - SPOT.x, fl.rest.pose.z - SPOT.z)).toBe(CELL);
    l.in.putAway();
    // and so does another sheet
    holdAt(l, 'testpaper', { x: SPOT.x - 10, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const sh = l.in.placement(l.in.held);
    expect('rest' in sh && cell(sh.rest.pose)).not.toEqual(cell(SPOT));
    l.in.putAway();
    // a pipette on its stand goes right over it, its spout over the sheet's middle, its stand's base behind
    const pip = pipetteOver(l);
    expect(cell(pip.pose)).toEqual(cell(SPOT));
    expect(where(pip.pose).slice(0, 3)).toEqual([SPOT.x, LIFT + 60 + SHAPES.pipette.spoutY, SPOT.z]);
    expect(toolStands(pip)).toHaveLength(1);
    expect(where(sheet.pose)).toEqual(flat(SPOT.x, SPOT.z));
    // and a sheet can be laid under a spout that's already there
    const next = pipetteOver(l, SPOT.x + CELL);
    const under = lay(l, SPOT.x + CELL);
    expect(where(under.pose)).toEqual(flat(SPOT.x + CELL, SPOT.z));
    expect(where(next.pose).slice(0, 3)).toEqual([SPOT.x + CELL, LIFT + 60 + SHAPES.pipette.spoutY, SPOT.z]);
  });

  it('soaks up what a spout lets out onto it, until it is soaked: then the rest runs off, and what it shows stays', () => {
    const l = lab();
    const sheet = lay(l);
    const pip = pipetteOver(l);
    const paper = paperOf(sheet);
    pip.tanks[0].setMolecules(R, 5 * TEST_PAPER.cap);
    pip.valves[0] = 1;
    run(l, 0.1);
    // what's landed so far already shows at full strength, though the sheet's hardly wet
    expect(volume(paper)).toBeGreaterThan(0);
    expect(volume(paper)).toBeLessThan(0.5 * TEST_PAPER.cap);
    expect(paperReading(paper)).toEqual([[1, 0, 0, 0]]);
    run(l, 30);
    // far more left the pipette than the sheet holds
    expect(volume(pip.tanks[0])).toBeLessThan(0.1 * TEST_PAPER.cap);
    expect(volume(paper) / TEST_PAPER.cap).toBeCloseTo(1, 4);
    expect(volume(paper)).toBeLessThanOrEqual(TEST_PAPER.cap);
    const was = [...paper.n];
    // more, of something else, changes nothing
    pip.tanks[0].setMolecules(R, 0);
    pip.tanks[0].setMolecules(G, 5 * TEST_PAPER.cap);
    run(l, 30);
    expect(volume(pip.tanks[0])).toBeLessThan(0.1 * TEST_PAPER.cap);
    expect([...paper.n]).toEqual(was);
    expect(paperReading(paper)).toEqual([[1, 0, 0, 0]]);
  });

  it('shows a single drop at full strength', () => {
    const l = lab();
    const sheet = lay(l);
    const pip = pipetteOver(l);
    const paper = paperOf(sheet);
    pip.tanks[0].setMolecules(RG, TEST_PAPER.cap);
    pip.valves[0] = 0.02;
    // until the first drop has fallen and landed
    for (let i = 0; i < 2000 && paper.N === 0; i++) l.in.simulate(0.02);
    expect(paper.N).toBeGreaterThan(0);
    expect(volume(paper)).toBeLessThan(0.5 * TEST_PAPER.cap);
    expect(paperReading(paper)).toEqual([[1, 1, 0, 0]]);
  });

  it('takes a pour from a flask held over it', () => {
    const l = lab();
    const sheet = lay(l);
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    f.setMolecules(G, 0.5 * CAP);
    // tipped all the way, with the right button held, its lip over the sheet
    const tipped = l.in as unknown as { rightHeld: boolean };
    const lip = flaskLip(f, Math.PI * 0.61);
    hands(l).placeHeld(l.in.held, { ...f.pose, x: f.pose.x + SPOT.x - lip.x, y: f.pose.y + 30, z: f.pose.z + SPOT.z - lip.z });
    f.tilt = Math.PI * 0.61;
    tipped.rightHeld = true;
    run(l, 1);
    expect(volume(paperOf(sheet)) / TEST_PAPER.cap).toBeCloseTo(1, 4);
    expect(paperReading(paperOf(sheet))).toEqual([[0, 1, 0, 0]]);
    // the flask lost what it poured, not just what the sheet took up
    expect(0.5 * CAP - volume(f)).toBeGreaterThan(5 * TEST_PAPER.cap);
  });

  it('keeps what it holds as it is: it neither reacts nor cools, while a flask of the same does', () => {
    const l = lab();
    const sheet = lay(l);
    const paper = paperOf(sheet);
    const mix = new Vessel(Infinity);
    mix.setMolecules(R, CAP);
    mix.setMolecules(G, CAP);
    mix.setTemperature(1);
    paper.addFrom(mix, TEST_PAPER.cap / 2, true);
    holdAt(l, 'flask', { x: SPOT.x + 2 * CELL, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    f.addFrom(mix, CAP / 2);
    const was = [...paper.n];
    l.e.speed = 16;
    run(l, 5);
    expect(f.n[RG]).toBeGreaterThan(0);
    expect(paper.n[RG]).toBe(0);
    expect([...paper.n]).toEqual(was);
    expect(paper.Q).toBe(0);
  });

  it('can be picked up again, wet and stained, and laid down somewhere else, as it was', () => {
    const l = lab();
    const sheet = lay(l);
    const paper = paperOf(sheet);
    const mix = new Vessel(Infinity);
    mix.setMolecules(RG, CAP);
    paper.addFrom(mix, TEST_PAPER.cap, true);
    const was = [...paper.n];
    l.e.debug({ x: SPOT.x, z: SPOT.z + 400, yaw: 0, pitch: 0 });
    l.in.target = { kind: 'tool', t: sheet, part: 'body', k: 0, point: { ...sheet.pose }, distance: 300 };
    l.in.leftDown(false);
    expect(l.in.held?.t).toBe(sheet);
    hands(l).placeHeld(l.in.held, { x: SPOT.x + 3 * CELL, y: LIFT + 100, z: SPOT.z - CELL, yaw: Math.PI });
    l.in.target = null;
    l.in.release();
    expect(where(sheet.pose)).toEqual(flat(SPOT.x + 3 * CELL, SPOT.z - CELL, where({ ...sheet.pose, yaw: Math.PI })[3]));
    expect([...paper.n]).toEqual(was);
    // undo takes it back to where it lay
    l.e.undo();
    expect(where(sheet.pose)).toEqual(flat(SPOT.x, SPOT.z));
    expect([...paper.n]).toEqual(was);
  });

  it('is saved with what it holds, and where it lies', () => {
    const l = lab();
    const fresh = lay(l);
    const stained = lay(l, SPOT.x + CELL);
    const mix = new Vessel(Infinity);
    mix.setMolecules(R, 0.2 * CAP);
    mix.setMolecules(RG, 0.3 * CAP);
    mix.setMolecules(SOLVENT_SPECIES, 0.5 * CAP);
    mix.setTemperature(4);
    paperOf(stained).addFrom(mix, 0.6 * TEST_PAPER.cap, true);
    stained.note = 'batch 3';
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const saved = s.tools.filter((t) => t.kind === 'testpaper');
    expect(saved).toHaveLength(2);
    // by species name
    expect(Object.keys(saved[1].paper![0].n).sort()).toEqual(['R', 'R–G', 'S']);
    expect(saved[0].paper![0].n).toEqual({});
    l.e.restore(s, DEFAULT_PRESET);
    const [a, b] = l.in.tools.filter((t) => t.kind === 'testpaper');
    expect(where(a.pose)).toEqual(where(fresh.pose));
    expect(where(b.pose)).toEqual(where(stained.pose));
    expect(paperOf(a).N).toBe(0);
    expect([...paperOf(b).n]).toEqual([...paperOf(stained).n]);
    expect(paperReading(paperOf(b))).toEqual(paperReading(paperOf(stained)));
    expect(paperReading(paperOf(b))[0][0]).toBeCloseTo(0.5, 2);
    expect(b.note).toBe('batch 3');
    // a save that says nothing of what it holds (or says too much) loads it blank, or with what fits
    const odd = JSON.parse(JSON.stringify(s)) as SaveState;
    const [x, y] = odd.tools.filter((t) => t.kind === 'testpaper');
    delete x.paper;
    y.paper = [{ n: { R: 50 * TEST_PAPER.cap }, Q: 0 }];
    l.e.restore(odd, DEFAULT_PRESET);
    const [c, d] = l.in.tools.filter((t) => t.kind === 'testpaper');
    expect(paperOf(c).N).toBe(0);
    expect(volume(paperOf(d))).toBe(TEST_PAPER.cap);
  });
});

describe('the composition analyzer, which is gone', () => {
  /** A lab's save with an analyzer in it, as every lab had: fed by a hose from a pipette, and with a hose out of each of its spouts. */
  function withAnalyzer(l: { e: GameEngine; in: Inside }): SaveState {
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const spectro = s.tools.find((t) => t.kind === 'spectroscope')!;
    const tube = { n: { R: 1e6, 'R–G': 2e6 }, Q: 12e6 };
    const analyzer = { ...spectro, kind: 'analyzer', id: 901, fx: 1.15, tanks: [tube], drops: [tube, { n: {}, Q: 0 }], reading: [0.5, 0, 0, 0] };
    const pipette = { ...spectro, kind: 'pipette', id: 902, fx: 0.55, fy: 0.3, z: 750, valves: [0.5], tanks: [{ n: { G: 5e7 }, Q: 15e7 }], drops: [{ n: {}, Q: 0 }] };
    s.tools.unshift(analyzer as unknown as SaveState['tools'][number], pipette as SaveState['tools'][number]);
    s.hoses.push(
      // into its tube, out of its spout and out of its waste spout
      { outlet: { x: 1.15, y: 0.46, z: 150, yaw: 0, reach: 50 }, on: { tool: 902, spout: 0 } },
      { outlet: { x: 0.25, y: 0.6, z: 750, yaw: 0, reach: 50 }, on: { tool: 901, spout: 0 } },
      { outlet: { x: 0.35, y: 0.6, z: 750, yaw: 0, reach: 50 }, on: { tool: 901, spout: 1 } },
    );
    return s;
  }
  const kinds = (l: Inside) => l.tools.map((t) => t.kind as string);

  it('is in no new lab, which still has its spectroscope and bond visualizer where they were', () => {
    const l = lab();
    expect(kinds(l.in)).not.toContain('analyzer');
    expect(kinds(l.in).filter((k) => k === 'spectroscope' || k === 'visualizer').sort()).toEqual(['spectroscope', 'visualizer']);
    expect(UNIQUE_TOOLS).not.toContain('analyzer');
    expect(INLINE_TOOLS).not.toContain('analyzer');
    expect(Object.keys(SHAPES)).not.toContain('analyzer');
    const at = (kind: string) => l.in.tools.find((t) => t.kind === kind)!.pose;
    expect([at('spectroscope').x, at('visualizer').x]).toEqual([1450, 1750]);
  });

  it('is lost from an older save as it loads, without error, with the hoses out of its spouts; the rest loads as it was', () => {
    const l = lab();
    const before = l.in.tools.map((t) => [t.kind, t.id]);
    const s = withAnalyzer(l);
    expect(() => l.e.restore(s, DEFAULT_PRESET)).not.toThrow();
    expect(kinds(l.in)).not.toContain('analyzer');
    // everything else is there, the pipette with what it held, and its hose where it was, now over nothing
    expect(l.in.tools.map((t) => [t.kind, t.id])).toEqual([['pipette', 902], ...before]);
    const pip = l.in.tools.find((t) => t.kind === 'pipette')!;
    expect(pip.tanks[0].N).toBe(5e7);
    const hoses = (l.in as unknown as { hoses: { on: { tool?: Tool } }[] }).hoses;
    expect(hoses).toHaveLength(1);
    expect(hoses[0].on.tool).toBe(pip);
    // and the lab runs: what the hose lets out falls to the counter
    expect(() => {
      for (let i = 0; i < 40; i++) l.in.simulate(0.05);
    }).not.toThrow();
    expect(pip.tanks[0].N).toBeLessThan(5e7);
    // saved again, there's no trace of it
    expect(JSON.stringify(l.e.snapshot())).not.toContain('analyzer');
  });
});

const lampOf = (l: Inside) => l.tools.filter((t) => t.kind === 'shadowlamp');

describe('the shadow lamp', () => {
  it('is in every new lab, on its bench, switched off', () => {
    const l = lab();
    const lamps = lampOf(l.in);
    expect(lamps).toHaveLength(1);
    expect(lamps[0].pose).toEqual(LAMP_POSE);
    expect(lamps[0].lit).toBe(false);
  });

  it('is added to a save from before there was one, and only ever one, always on its bench', () => {
    const l = lab();
    l.e.restore(bare(), DEFAULT_PRESET);
    expect(lampOf(l.in)).toHaveLength(1);
    expect(lampOf(l.in)[0].pose).toEqual(LAMP_POSE);
    // a save with two of them, somewhere else, loads with the first, where it belongs
    const s = l.e.snapshot();
    const saved = s.tools.find((t) => t.kind === 'shadowlamp')!;
    s.tools.push({ ...saved, id: 999 });
    for (const t of s.tools) if (t.kind === 'shadowlamp') Object.assign(t, { fx: 0.5, fy: 0.5, z: 700, yaw: 0 });
    l.e.restore(s, DEFAULT_PRESET);
    expect(lampOf(l.in)).toHaveLength(1);
    expect(lampOf(l.in)[0].id).toBe(saved.id);
    expect(lampOf(l.in)[0].pose).toEqual(LAMP_POSE);
  });

  it('is switched on and off with the left button on its switch, which a save keeps and undo takes back', () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    l.in.target = { kind: 'tool', t: lamp, part: 'switch', k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 };
    l.in.leftDown(false);
    expect(lamp.lit).toBe(true);
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    l.in.leftDown(false);
    expect(lamp.lit).toBe(false);
    l.e.undo();
    expect(lamp.lit).toBe(true);
    l.e.undo();
    expect(lamp.lit).toBe(false);
    l.e.restore(s, DEFAULT_PRESET);
    expect(lampOf(l.in)[0].lit).toBe(true);
  });
});

describe('shadow paper', () => {
  /** Stand at (x, z) with eyes on (tx, ty, tz), carrying along what's held. */
  function look(l: { e: GameEngine; in: Inside }, x: number, z: number, tx: number, ty: number, tz: number): void {
    const [dx, dy, dz] = [tx - x, ty - 620, tz - z];
    l.e.debug({ x, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
    l.in.move(0);
  }
  /**
   * Take a sheet out of the cabinet, by the wheel, standing out in the room in front of the lamp's bench, with the
   * sheet held up to the holder: turned to face the lamp, or as it comes, facing whoever holds it.
   */
  function sheetAtHolder(l: { e: GameEngine; in: Inside }, turned = true): Tool {
    const at = () => look(l, SHEET_SLOT.x, SHEET_SLOT.z - 240, SHEET_SLOT.x, SHEET_SLOT.y - 150, SHEET_SLOT.z);
    at();
    expect(l.e.spawn('sheet')).toBe(true);
    if (turned) l.in.held!.relYaw = Math.PI;
    at();
    return l.in.held!.t!;
  }

  it('comes out of the cabinet as often as wanted, and is thrown away when put away', () => {
    const l = lab();
    for (let i = 0; i < STOCK.sheet + 3; i++) {
      expect(l.e.spawn('sheet')).toBe(true);
      expect(l.in.held?.t?.kind).toBe('sheet');
      l.in.putAway();
      expect(l.in.held).toBeNull();
    }
    expect(l.in.tools.some((t) => t.kind === 'sheet')).toBe(false);
    expect(l.in.stock.sheet.every(Boolean)).toBe(true);
  });

  it("goes into the lamp's holder when it's let go of there, with no stand, and out again when it's picked up", () => {
    const l = lab();
    const sheet = sheetAtHolder(l);
    // in hand it has no stand, and where it would go is the holder
    expect(l.in.stands().some((s) => s.of.t === sheet)).toBe(false);
    const pl = l.in.placement(l.in.held);
    expect('rest' in pl && pl.rest.pose).toEqual(SHEET_SLOT);
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(sheet.pose).toEqual(SHEET_SLOT);
    expect(sheetIn(l.in.tools)).toBe(sheet);
    expect(toolStands(sheet)).toEqual([]);
    expect(l.in.stands().some((s) => s.of.t === sheet)).toBe(false);
    // a second sheet held there has to go somewhere else: on a stand, over the bench
    const second = sheetAtHolder(l);
    const pl2 = l.in.placement(l.in.held);
    if ('rest' in pl2) expect(inSlot(pl2.rest.pose)).toBe(false);
    l.in.putAway();
    expect(l.in.tools).not.toContain(second);
    // picked up with the crosshair on it, and set down on an island, it's on a stand like any tool
    l.in.target = { kind: 'tool', t: sheet, part: 'body', k: 0, point: { ...SHEET_SLOT }, distance: 200 };
    l.in.leftDown(false);
    expect(l.in.held?.t).toBe(sheet);
    look(l, 100, 1200, 100, 700, 800);
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(sheetIn(l.in.tools)).toBeNull();
    expect(toolStands(sheet)).toHaveLength(1);
    expect(l.in.stands().some((s) => s.of.t === sheet)).toBe(true);
    // undo puts it back in the holder, and Q puts back one picked up from there
    l.e.undo();
    expect(sheet.pose).toEqual(SHEET_SLOT);
    l.in.leftDown(false);
    look(l, 100, 1200, 100, 700, 800);
    l.in.putBack();
    expect(sheet.pose).toEqual(SHEET_SLOT);
  });

  it('goes in with its back to the lamp, if that is how it is held', () => {
    const l = lab();
    // as it comes out of the cabinet it faces whoever holds it, who's looking at the lamp across the holder
    const sheet = sheetAtHolder(l, false);
    l.in.release();
    expect(sheet.pose).toEqual(slotPose(SHEET_SLOT.yaw + Math.PI));
    expect(Math.cos(sheet.pose.yaw - SHEET_SLOT.yaw)).toBeCloseTo(-1);
    expect(sheetIn(l.in.tools)).toBe(sheet);
  });

  it('keeps its image, and its place in the holder, through a save', () => {
    const l = lab();
    const sheet = sheetAtHolder(l);
    l.in.release();
    const N = SHEET.cells;
    sheet.expose(Float32Array.from({ length: N * N }, (_, k) => (k % N < N / 3 ? 0 : 1)), 0.6);
    const loose = sheetAtHolder(l);
    look(l, 100, 1200, 100, 700, 800);
    l.in.release();
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    expect(s.tools.filter((t) => t.kind === 'sheet').map((t) => typeof t.image)).toEqual(['string', 'undefined']);
    l.e.restore(s, DEFAULT_PRESET);
    const [a, b] = l.in.tools.filter((t) => t.kind === 'sheet');
    expect(a.pose).toEqual(SHEET_SLOT);
    expect(sheetIn(l.in.tools)).toBe(a);
    expect(darkness(a.dose[N - 1])).toBeCloseTo(darkness(0.6), 2);
    expect(a.dose[0]).toBe(0);
    expect(b.pose.x).toBeCloseTo(loose.pose.x);
    expect(b.pose.z).toBeCloseTo(loose.pose.z);
    expect(Math.max(...b.dose)).toBe(0);
  });

  it("is owed the lamp's light while it's in the holder with the lamp on, on sim time", () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    const press = () => {
      l.in.target = { kind: 'tool', t: lamp, part: 'switch', k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 };
      l.in.leftDown(false);
      l.in.target = null;
    };
    // on, with no sheet in, nothing happens
    press();
    l.in.simulate(0.1);
    expect([lamp.lit, lamp.sheet, lamp.owed]).toEqual([true, null, 0]);
    // a sheet in hand at the holder isn't in it yet; let go of there, it is, and the light's time is the lab's
    const sheet = sheetAtHolder(l);
    l.in.simulate(0.1);
    expect([lamp.sheet, lamp.owed]).toEqual([null, 0]);
    l.in.release();
    l.in.simulate(0.1);
    expect(lamp.sheet).toBe(sheet);
    expect(lamp.owed).toBeCloseTo(0.1);
    // paused, none; at 16×, sixteen times as much
    l.e.speed = 0;
    l.in.simulate(0.1);
    expect(lamp.owed).toBeCloseTo(0.1);
    l.e.speed = 16;
    l.in.simulate(0.05);
    expect(lamp.owed).toBeCloseTo(0.9);
    // off, no more; and with nothing drawing the lab, what's owed just waits, the sheet as it was
    press();
    l.e.speed = 1;
    l.in.simulate(0.1);
    expect(lamp.owed).toBeCloseTo(0.9);
    expect(Math.max(...sheet.dose)).toBe(0);
    // picked up, it's out of the holder, and owed nothing
    l.in.target = { kind: 'tool', t: sheet, part: 'body', k: 0, point: { ...SHEET_SLOT }, distance: 200 };
    l.in.leftDown(false);
    l.in.simulate(0.1);
    expect([lamp.sheet, lamp.owed]).toEqual([null, 0]);
  });

  it('is owed no more than darkens it all the way, through the longest sleep', () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    sheetAtHolder(l);
    l.in.release();
    lamp.lit = true;
    l.in.simulate(0.1, true);
    expect(lamp.owed).toBeCloseTo(0.1);
    l.in.sleeper().skip(100000);
    expect(lamp.owed).toBe(SHEET.full);
    l.in.simulate(0.1, true);
    expect(lamp.owed).toBe(SHEET.full);
  });
});
