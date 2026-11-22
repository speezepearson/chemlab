import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BOND_KEYS } from '../chem/atoms';
import { ReactionNetwork } from '../chem/reactions';
import { testChemParams } from '../chem/testChem';
import { SOLVENT_SPECIES, pairOf, singleOf } from '../chem/species';
import { FLASK_R, MAGNET, NEAR, NEAR_STEP, SCALE_SLOTS, SHEET_SLOT, flaskLip, onScale, spoutAt, tankMouth, inSlot, scaleBox, sheetIn, slotPose, standBase, toolBox, toolStands } from './bodies';
import { boxesOverlap } from './physics';
import { STOCK } from './cabinet';
import { WHEELS } from './wheel';
import { CAP, TRACE } from './config';
import type { GameEngine } from './engine';
import { Vessel, volume, type Flask } from './flask';
import type { Scale } from './scale';
import { FLASK_H } from './flaskShape';
import { DEFAULT_PRESET, LAMP_POSE } from './presets';
import type { SaveState } from './save';
import { CELL, LAMP_FLOOR, LIFT, counterUnder, toWorld } from './space';
import { toCell } from './testLayout';
import { DRIP, INLINE_TOOLS, PAPER_TAU, SHAPES, SHEET, TEST_PAPER, UNIQUE_TOOLS, bondReading, bondShares, darkness, lampShot, paperReading, type Blotter, type Tool } from './tools';

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
  held: { kind: string; t?: Tool; f?: Flask; relYaw: number; dist: number } | null;
  target: unknown;
  stock: Record<string, boolean[]>;
  flash: { text: string } | null;
  leftDown(shift: boolean): void;
  rightDown(): void;
  endTurn(): void;
  valveAimed(): { t: Tool; k: number } | null;
  viewW: number;
  grabOrRelease(linked: boolean): void;
  release(): void;
  putAway(): void;
  putBack(): void;
  move(dt: number): void;
  simulate(dt: number, quiet?: boolean): void;
  sleeper(): { skip(dt: number): void };
  placement(h: unknown): { rest: { pose: Tool['pose'] } } | { why: string };
  stands(): { of: { t?: Tool } }[];
  keys: Set<string>;
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

type Lab = { e: GameEngine; in: Inside };
/** More of the engine's own things, which the tests of the sheets of blotting paper reach into. */
interface Hands {
  held: { kind: string; t?: Tool; f?: Flask; dir?: { x: number; y: number; z: number } } | null;
  flasks: Flask[];
  placeHeld(h: unknown, p: Tool['pose']): void;
}
const hands = (l: Lab) => l.in as unknown as Hands;
/** A sheet of blotting paper, of either kind. */
type Sheet = 'testpaper' | 'bondpaper';
/** The middle of a cell in the front row of the first island. */
/** A cell's middle on the first island, a cell in from its front edge. */
const SPOT = { x: 2.5 * CELL, z: 14.5 * CELL };
const paperOf = (t: Tool) => t.paper[0];
/** Where something is, to a millionth of a unit. */
const where = (p: Tool['pose']) => [p.x, p.y, p.z, p.yaw].map((v) => Math.round(v * 1e6) / 1e6 + 0);
const flat = (x: number, z: number, yaw = 0) => [x, LIFT + TEST_PAPER.thick, z, yaw];

/** Take a sheet out of the cabinet, by the wheel, and lay it down with its middle at (x, z). */
function lay(l: Lab, x = SPOT.x, z = SPOT.z, kind: Sheet = 'testpaper'): Tool {
  // looking a little down, the sheet is held low in front, about there; and then just there
  const there = () => {
    l.e.debug({ x, z: z + 96, yaw: 0, pitch: (-20 * Math.PI) / 180 });
    l.in.move(0);
  };
  there();
  expect(l.e.spawn(kind)).toBe(true);
  there();
  const t = l.in.held!.t!;
  hands(l).placeHeld(l.in.held, { ...t.pose, x, z });
  l.in.release();
  expect(l.in.held, `at ${x}, ${z}: ${l.in.flash?.text}`).toBeNull();
  return t;
}

/** Take one of a kind out of the cabinet and hold it at a pose, standing well out of its way. */
function holdAt(l: Lab, kind: 'flask' | 'pipette' | Sheet, p: Tool['pose']): void {
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

describe('test paper', () => {
  const R = singleOf('R');
  const G = singleOf('G');
  const RG = pairOf('R', 'G');

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
    holdAt(l, 'testpaper', { x: SPOT.x + 3 * CELL, y: 500, z: SPOT.z, yaw: Math.PI / 2 });
    const turned = l.in.held!.t!;
    l.in.release();
    expect(where(turned.pose)).toEqual(flat(SPOT.x + 3 * CELL, SPOT.z, where({ ...turned.pose, yaw: Math.PI / 2 })[3]));
  });

  it('lets no other sheet be laid on its cell, but a tool on its stand can have its spout over it', () => {
    const l = lab();
    const sheet = lay(l);
    const cell = (p: { x: number; z: number }) => [toCell(p.x), toCell(p.z)];
    // another sheet held over it goes down beside it instead, as near where it's held as it can, no further than NEAR
    holdAt(l, 'testpaper', { x: SPOT.x - 10, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const sh = l.in.placement(l.in.held);
    expect('rest' in sh).toBe(true);
    const to = 'rest' in sh ? sh.rest.pose : sheet.pose;
    expect(Math.max(Math.abs(to.x - SPOT.x), Math.abs(to.z - SPOT.z))).toBeGreaterThanOrEqual(TEST_PAPER.w);
    expect(Math.hypot(to.x - (SPOT.x - 10), to.z - SPOT.z)).toBeLessThanOrEqual(NEAR + 1e-9);
    expect(Math.hypot(to.x - (SPOT.x - 10), to.z - SPOT.z)).toBeGreaterThan(TEST_PAPER.w - 10 - NEAR_STEP);
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
    // (a pipette holds a little over three times what a sheet soaks up)
    pip.tanks[0].setMolecules(R, 3 * TEST_PAPER.cap);
    pip.valves[0] = 1;
    run(l, 0.1);
    // what's landed so far is to show already, as faintly as the sheet is wet: all of it is R
    expect(volume(paper)).toBeGreaterThan(0);
    expect(volume(paper)).toBeLessThan(0.5 * TEST_PAPER.cap);
    expect(paperReading(paper)).toEqual([[volume(paper) / TEST_PAPER.cap, 0, 0, 0]]);
    run(l, 30);
    // far more left the pipette than the sheet holds
    expect(volume(pip.tanks[0])).toBeLessThan(0.1 * TEST_PAPER.cap);
    expect(volume(paper) / TEST_PAPER.cap).toBeCloseTo(1, 4);
    expect(volume(paper)).toBeLessThanOrEqual(TEST_PAPER.cap);
    const was = [...paper.n];
    // more, of something else, changes nothing
    pip.tanks[0].setMolecules(R, 0);
    pip.tanks[0].setMolecules(G, 3 * TEST_PAPER.cap);
    run(l, 30);
    expect(volume(pip.tanks[0])).toBeLessThan(0.1 * TEST_PAPER.cap);
    expect([...paper.n]).toEqual(was);
    // soaked in R, it's stained R through and through, and nothing else
    expect(paperReading(paper)[0][0]).toBeCloseTo(1, 4);
    expect(paperReading(paper)[0].slice(1)).toEqual([0, 0, 0]);
  });

  it('shows a single drop faintly, and a second as much again', () => {
    const l = lab();
    const sheet = lay(l);
    const pip = pipetteOver(l);
    const paper = paperOf(sheet);
    pip.tanks[0].setMolecules(RG, TEST_PAPER.cap);
    pip.valves[0] = 0.02;
    // until the first drop has fallen and landed
    for (let i = 0; i < 2000 && paper.N === 0; i++) l.in.simulate(0.02);
    expect(paper.N).toBeGreaterThan(0);
    const one = volume(paper) / TEST_PAPER.cap;
    expect(one).toBeLessThan(0.1);
    expect(paperReading(paper)).toEqual([[one, one, 0, 0]]);
    // and the next
    for (let i = 0; i < 4000 && volume(paper) === one * TEST_PAPER.cap; i++) l.in.simulate(0.02);
    const two = volume(paper) / TEST_PAPER.cap;
    // (drops aren't all one size)
    expect(two / one).toBeGreaterThan(1.3);
    expect(two / one).toBeLessThan(3.5);
    expect(paperReading(paper)).toEqual([[two, two, 0, 0]]);
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
    // six tenths soaked in a mix half of which has an R
    expect(paperReading(paperOf(b))[0][0]).toBeCloseTo(0.3, 2);
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

describe('bond paper', () => {
  const R = singleOf('R');
  const RG = pairOf('R', 'G');
  const RK = pairOf('R', 'K');
  const bond = (k: string) => BOND_KEYS.indexOf(k);

  it('comes out of the cabinet as often as wanted, held low so that its face shows, and is thrown away when put away', () => {
    const l = lab();
    for (let i = 0; i < STOCK.bondpaper + 3; i++) {
      expect(l.e.spawn('bondpaper')).toBe(true);
      expect(l.in.held?.t?.kind).toBe('bondpaper');
      expect(hands(l).held!.dir!.y).toBeLessThan(0);
      l.in.putAway();
      expect(l.in.held).toBeNull();
    }
    expect(l.in.tools.some((t) => t.kind === 'bondpaper')).toBe(false);
    expect(l.in.stock.bondpaper.every(Boolean)).toBe(true);
  });

  it('lies flat on the counter where it is let go of, in the middle of a cell, with no stand, as a sheet of test paper does', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, 'bondpaper');
    expect(sheet.kind).toBe('bondpaper');
    expect(where(sheet.pose)).toEqual(flat(SPOT.x, SPOT.z));
    expect(toolStands(sheet)).toEqual([]);
    expect(l.in.stands().some((s) => s.of.t === sheet)).toBe(false);
    // nothing else can be set down on its cell, not even a sheet of the other kind
    holdAt(l, 'testpaper', { x: SPOT.x - 10, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const sh = l.in.placement(l.in.held);
    expect('rest' in sh && [toCell(sh.rest.pose.x), toCell(sh.rest.pose.z)]).not.toEqual([toCell(SPOT.x), toCell(SPOT.z)]);
    l.in.putAway();
    // but a pipette on its stand goes right over it
    const pip = pipetteOver(l);
    expect(where(pip.pose).slice(0, 3)).toEqual([SPOT.x, LIFT + 60 + SHAPES.pipette.spoutY, SPOT.z]);
  });

  it('soaks up what a spout lets out onto it, its lines darkening by what it holds, until it is soaked: then they stay', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, 'bondpaper');
    const pip = pipetteOver(l);
    const paper = paperOf(sheet);
    expect(bondReading(paper)).toEqual([0, 0, 0, 0, 0, 0]);
    // three parts R–G to one of R
    pip.tanks[0].setMolecules(RG, 2.25 * TEST_PAPER.cap);
    pip.tanks[0].setMolecules(R, 0.75 * TEST_PAPER.cap);
    pip.valves[0] = 1;
    run(l, 0.1);
    // what's landed so far is to show already, as faintly as the sheet is wet: three quarters of it has the bond
    expect(volume(paper)).toBeGreaterThan(0);
    expect(volume(paper)).toBeLessThan(0.5 * TEST_PAPER.cap);
    expect(bondReading(paper)[bond('RG')] / (volume(paper) / TEST_PAPER.cap)).toBeCloseTo(0.75, 2);
    run(l, 30);
    expect(volume(pip.tanks[0])).toBeLessThan(0.1 * TEST_PAPER.cap);
    expect(volume(paper) / TEST_PAPER.cap).toBeCloseTo(1, 4);
    expect(volume(paper)).toBeLessThanOrEqual(TEST_PAPER.cap);
    // soaked, each line is as dark as the share of what the sheet holds that has its bond
    const was = bondReading(paper);
    expect(was).toEqual(bondShares(paper, TEST_PAPER.cap));
    expect(was[bond('RG')]).toBeCloseTo(0.75, 2);
    expect(was.filter((x) => x > 0)).toHaveLength(1);
    // more, of something else, changes nothing
    const held = [...paper.n];
    pip.tanks[0].setMolecules(RK, 3 * TEST_PAPER.cap);
    run(l, 30);
    expect(volume(pip.tanks[0])).toBeLessThan(0.1 * TEST_PAPER.cap);
    expect([...paper.n]).toEqual(held);
    expect(bondReading(paper)).toEqual(was);
  });

  it('keeps what it holds as it is: it neither reacts nor cools, while a flask of the same does', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, 'bondpaper');
    const paper = paperOf(sheet);
    const mix = new Vessel(Infinity);
    mix.setMolecules(R, CAP);
    mix.setMolecules(singleOf('G'), CAP);
    mix.setTemperature(1);
    paper.addFrom(mix, TEST_PAPER.cap / 2, true);
    holdAt(l, 'flask', { x: SPOT.x + 2 * CELL, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    f.addFrom(mix, CAP / 2);
    l.e.speed = 16;
    run(l, 5);
    // in the flask, R and G have bonded; on the paper they never do, so no line darkens
    expect(f.n[RG]).toBeGreaterThan(0);
    expect(paper.n[RG]).toBe(0);
    expect(bondReading(paper)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(paper.Q).toBe(0);
  });

  it('is saved with what it holds, and where it lies, beside a sheet of test paper with its own', () => {
    const l = lab();
    const bonds = lay(l, SPOT.x, SPOT.z, 'bondpaper');
    const test = lay(l, SPOT.x + CELL, SPOT.z, 'testpaper');
    const mix = new Vessel(Infinity);
    mix.setMolecules(R, 0.2 * CAP);
    mix.setMolecules(RG, 0.3 * CAP);
    mix.setMolecules(SOLVENT_SPECIES, 0.5 * CAP);
    paperOf(bonds).addFrom(mix, 0.6 * TEST_PAPER.cap, true);
    paperOf(test).addFrom(mix, 0.4 * TEST_PAPER.cap, true);
    bonds.note = 'batch 4';
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const saved = s.tools.filter((t) => t.kind === 'bondpaper');
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0].paper![0].n).sort()).toEqual(['R', 'R–G', 'S']);
    l.e.restore(s, DEFAULT_PRESET);
    const b = l.in.tools.find((t) => t.kind === 'bondpaper')!;
    const t = l.in.tools.find((t) => t.kind === 'testpaper')!;
    expect(where(b.pose)).toEqual(where(bonds.pose));
    expect([...paperOf(b).n]).toEqual([...paperOf(bonds).n]);
    expect([...paperOf(t).n]).toEqual([...paperOf(test).n]);
    expect(bondReading(paperOf(b))).toEqual(bondReading(paperOf(bonds)));
    // six tenths soaked in a mix three tenths of which has the bond
    expect(bondReading(paperOf(b))[bond('RG')]).toBeCloseTo(0.18, 2);
    expect(b.note).toBe('batch 4');
    // a save that says too much of what it holds loads it with what fits
    const odd = JSON.parse(JSON.stringify(s)) as SaveState;
    odd.tools.find((x) => x.kind === 'bondpaper')!.paper = [{ n: { 'R–G': 50 * TEST_PAPER.cap }, Q: 0 }];
    l.e.restore(odd, DEFAULT_PRESET);
    expect(volume(paperOf(l.in.tools.find((x) => x.kind === 'bondpaper')!))).toBe(TEST_PAPER.cap);
  });
});

describe.each(['testpaper', 'bondpaper'] as const)('a sheet of %s held in a stream', (kind) => {
  const R = singleOf('R');
  const G = singleOf('G');
  const RG = pairOf('R', 'G');
  const cap = TEST_PAPER.cap;
  /** Yet more of the engine's own things: what's on its way down, and the faucets. */
  interface Falls {
    falling: { v: Vessel }[];
    faucets: { start: { start: number }; spout: { x: number; y: number; z: number } }[];
  }
  const falls = (l: Lab) => l.in as unknown as Falls;

  /** A flask standing in the cell at SPOT, and a pipette on its stand over it, its spout `up` above the counter. */
  function line(l: Lab, up = 220): { pip: Tool; f: Flask } {
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    expect([f.pose.x, f.pose.z]).toEqual([SPOT.x, SPOT.z]);
    const pip = pipetteOver(l, SPOT.x, SPOT.z, up);
    expect(pip.pose.y - SHAPES.pipette.spoutY).toBeGreaterThan(f.pose.y + 100);
    return { pip, f };
  }

  /** Take a sheet in hand and hold it level, `up` above the counter, with its middle `dx` across from the spout. */
  function wave(l: Lab, up: number, dx = 0): Tool {
    holdAt(l, kind, { x: SPOT.x + dx, y: LIFT + up, z: SPOT.z, yaw: 0 });
    const sheet = l.in.held!.t!;
    expect(sheet.kind).toBe(kind);
    return sheet;
  }

  /** How many molecules of a species there are in the pipette, hanging from it, falling, on the sheet and in the flask. */
  const count = (l: Lab, s: number, pip: Tool, sheet: Tool, f: Flask) =>
    pip.tanks[0].n[s] + pip.drops[0].n[s] + falls(l).falling.reduce((t, d) => t + d.v.n[s], 0) + paperOf(sheet).n[s] + f.n[s];

  it('takes up what it has room for, of what the stream is made of, and the rest runs on into what is below; none is lost or made', () => {
    const l = lab();
    const { pip, f } = line(l);
    const sheet = wave(l, 150);
    const paper = paperOf(sheet);
    // three parts R–G to one of R, which do nothing to each other
    pip.tanks[0].setMolecules(RG, 2.25 * cap);
    pip.tanks[0].setMolecules(R, 0.75 * cap);
    const before = [R, RG].map((s) => count(l, s, pip, sheet, f));
    expect(before).toEqual([0.75 * cap, 2.25 * cap]);
    pip.valves[0] = 1;
    run(l, 0.1);
    // at once it's wet with what's running, and showing it; nothing has got past it yet
    expect(volume(paper)).toBeGreaterThan(0);
    expect(volume(paper)).toBeLessThan(0.5 * cap);
    expect(paper.n[RG] / volume(paper)).toBeCloseTo(0.75, 2);
    expect(f.N).toBe(0);
    run(l, 8);
    // soaked, with the first of the stream, and not a molecule over; and the stream has run on into the flask
    expect(volume(paper) / cap).toBeCloseTo(1, 4);
    expect(volume(paper)).toBeLessThanOrEqual(cap);
    expect(paper.n[RG] / volume(paper)).toBeCloseTo(0.75, 2);
    expect(paper.Q).toBe(0);
    expect(volume(f)).toBeGreaterThan(0.5 * cap);
    expect(f.n[RG] / volume(f)).toBeCloseTo(0.75, 2);
    // every molecule that left the pipette is on the sheet or in the flask (but for less than a trace of a packet,
    // which is let go wherever fluid is moved)
    const after = [R, RG].map((s) => count(l, s, pip, sheet, f));
    after.forEach((n, i) => expect(Math.abs(n - before[i])).toBeLessThan(TRACE));
    expect(after.every(Number.isInteger)).toBe(true);
    // from then on it takes nothing more, and everything goes by it (counted in atoms, since what's in the flask reacts)
    const held = [...paper.n];
    const was = f.N;
    pip.tanks[0].setMolecules(G, 2 * cap);
    const out = () => pip.tanks[0].N + pip.drops[0].N + falls(l).falling.reduce((t, d) => t + d.v.N, 0);
    const left = out();
    run(l, 2);
    expect([...paper.n]).toEqual(held);
    expect(left - out()).toBeGreaterThan(0.2 * cap);
    expect(Math.abs(f.N - was - (left - out()))).toBeLessThan(TRACE);
  });

  it('stays dry beside the stream, or above where it comes out: then all of it reaches what is below', () => {
    for (const [up, dx] of [[150, TEST_PAPER.w / 2 + 2], [150, -(TEST_PAPER.w / 2 + 2)], [300, 0]]) {
      const l = lab();
      const { pip, f } = line(l);
      const sheet = wave(l, up, dx);
      pip.tanks[0].setMolecules(R, 3 * cap);
      pip.valves[0] = 1;
      run(l, 5);
      expect(paperOf(sheet).N).toBe(0);
      expect(volume(f)).toBeGreaterThan(cap);
      expect(Math.abs(count(l, R, pip, sheet, f) - 3 * cap)).toBeLessThan(TRACE);
    }
    // and its edge is enough to catch it
    const l = lab();
    const { pip } = line(l);
    const sheet = wave(l, 150, TEST_PAPER.w / 2 - 2);
    pip.tanks[0].setMolecules(R, 3 * cap);
    pip.valves[0] = 1;
    run(l, 6);
    expect(volume(paperOf(sheet)) / cap).toBeCloseTo(1, 4);
  });

  it('is wetted on sim time: paused, nothing lands on it, however it is held', () => {
    const l = lab();
    const { pip, f } = line(l);
    const sheet = wave(l, 150);
    pip.tanks[0].setMolecules(R, 3 * cap);
    pip.valves[0] = 1;
    l.e.speed = 0;
    run(l, 5);
    expect(paperOf(sheet).N).toBe(0);
    expect(f.N).toBe(0);
    expect(volume(pip.tanks[0])).toBe(3 * cap);
    l.e.speed = 1;
    run(l, 1);
    expect(paperOf(sheet).N).toBeGreaterThan(0);
  });

  it('takes its share of a single drop, the rest of which falls on', () => {
    const l = lab();
    const { pip, f } = line(l);
    const sheet = wave(l, 150);
    const paper = paperOf(sheet);
    // all but soaked, with room for about a tenth of a drop
    const room = Math.round(DRIP.atoms / 10);
    const wet = new Vessel(Infinity);
    wet.setMolecules(G, cap);
    paper.addFrom(wet, cap - room, true);
    expect((paper as Blotter).soaked).toBe(false);
    pip.tanks[0].setMolecules(R, 2 * cap);
    pip.valves[0] = 0.02;
    // until the first drop has struck the sheet and what was left of it has landed in the flask
    for (let i = 0; i < 4000 && f.N === 0; i++) l.in.simulate(0.02);
    expect(paper.n[R]).toBeGreaterThan(0);
    expect(paper.n[R]).toBeLessThanOrEqual(room);
    expect((paper as Blotter).soaked).toBe(true);
    expect(f.n[R]).toBeGreaterThan(room);
    expect(f.n[G]).toBe(0);
    expect(count(l, R, pip, sheet, f)).toBe(2 * cap);
  });

  it("is wetted under a faucet, which runs on into a flask under it", () => {
    const l = lab();
    const [faucet] = falls(l).faucets;
    const sp = faucet.spout;
    holdAt(l, 'flask', { x: sp.x, y: sp.y - 80, z: sp.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    expect([f.pose.x, f.pose.z]).toEqual([sp.x, sp.z]);
    // held between the faucet's spout and the flask's mouth
    expect(sp.y - f.pose.y).toBeGreaterThan(40);
    holdAt(l, kind, { x: sp.x + 10, y: (sp.y + f.pose.y) / 2, z: sp.z - 10, yaw: 0 });
    const paper = paperOf(l.in.held!.t!);
    f.n.fill(0);
    f.N = f.Q = 0;
    run(l, 0.5);
    expect(volume(paper) / cap).toBeCloseTo(1, 3);
    // a faucet pours its one atom, and that's all that's on the sheet and in the flask
    const atom = faucet.start.start;
    expect(paper.n[atom]).toBe(volume(paper));
    expect(f.n[atom]).toBe(volume(f));
    expect(volume(f)).toBeGreaterThan(2 * cap);
  });

  it('is laid down afterwards as it is, wet', () => {
    const l = lab();
    const { pip, f } = line(l);
    const sheet = wave(l, 150);
    const paper = paperOf(sheet);
    pip.tanks[0].setMolecules(RG, 3 * cap);
    pip.valves[0] = 1;
    run(l, 5);
    pip.valves[0] = 0;
    expect(volume(paper) / cap).toBeCloseTo(1, 4);
    const held = [...paper.n];
    // let go of over the flask's cell, it's laid there, under the flask
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(where(sheet.pose)).toEqual(flat(f.pose.x, f.pose.z));
    expect([...paper.n]).toEqual(held);
    // soaked in R–G, it reads R and G, or their bond, as strongly as it ever will
    const shown = kind === 'testpaper' ? paperReading(paper)[0].slice(0, 2) : bondReading(paper).filter((x) => x > 0);
    expect(shown).toHaveLength(kind === 'testpaper' ? 2 : 1);
    for (const x of shown) expect(x).toBeCloseTo(1, 4);
  });
});

describe.each(['testpaper', 'bondpaper'] as const)('what a sheet of %s shows, in the lab', (kind) => {
  const cap = TEST_PAPER.cap;
  /** A mixture that shows on either sheet. */
  const mix = () => {
    const v = new Vessel(Infinity);
    v.setMolecules(pairOf('R', 'G'), CAP);
    v.setMolecules(singleOf('R'), CAP);
    return v;
  };
  /** How wet a sheet looks so far, of how wet it's to look. */
  const come = (t: Tool) => t.showing[0] / (volume(paperOf(t)) / cap);
  const sheets = (l: Lab) => l.in.tools.filter((t) => t.kind === kind);

  it('comes up on sim time: not at all while paused, sixteen times as fast at 16×, and in hand as on a counter', () => {
    const l = lab();
    const laid = lay(l, SPOT.x, SPOT.z, kind);
    holdAt(l, kind, { x: SPOT.x + 2 * CELL, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const held = l.in.held!.t!;
    for (const t of [laid, held]) paperOf(t).addFrom(mix(), cap / 2, true);
    l.e.speed = 0;
    run(l, 5);
    for (const t of [laid, held]) expect(t.showing.every((x) => x === 0)).toBe(true);
    l.e.speed = 1;
    run(l, 0.5);
    for (const t of [laid, held]) expect(come(t)).toBeCloseTo(1 - Math.exp(-0.5 / PAPER_TAU), 6);
    expect(laid.showing.filter((x) => x > 0).length).toBeGreaterThan(1);
    // a twentieth of a second at 16× is eight tenths of a second in the lab
    l.e.speed = 16;
    l.in.simulate(0.05);
    for (const t of [laid, held]) expect(come(t)).toBeCloseTo(1 - Math.exp(-1.3 / PAPER_TAU), 6);
    run(l, 1);
    for (const t of [laid, held]) expect(t.developed).toBe(true);
  });

  it('comes up as a stream wets it, not all at once', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, kind);
    const pip = pipetteOver(l);
    pip.tanks[0].setMolecules(pairOf('R', 'G'), 3 * cap);
    pip.valves[0] = 1;
    run(l, 0.25);
    // it's already holding some, and showing less than that calls for
    expect(volume(paperOf(sheet))).toBeGreaterThan(0);
    expect(sheet.showing[0]).toBeGreaterThan(0);
    expect(come(sheet)).toBeLessThan(0.6);
    expect(sheet.developed).toBe(false);
    run(l, 30);
    expect(sheet.developed).toBe(true);
    expect(sheet.showing[0]).toBeCloseTo(volume(paperOf(sheet)) / cap, 9);
  });

  it('goes on coming up through a sleep that skips ahead', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, kind);
    paperOf(sheet).addFrom(mix(), cap / 2, true);
    run(l, 0.2);
    expect(sheet.developed).toBe(false);
    l.in.sleeper().skip(30);
    expect(sheet.developed).toBe(true);
  });

  it('is saved half come up, and loads so; a save from before sheets took time loads all there', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, kind);
    paperOf(sheet).addFrom(mix(), cap / 2, true);
    run(l, 0.4);
    const was = [...sheet.showing];
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const saved = s.tools.find((t) => t.kind === kind)!;
    expect(saved.memory).toEqual(was);
    l.e.restore(s, DEFAULT_PRESET);
    const [back] = sheets(l);
    expect(back).not.toBe(sheet);
    expect([...back.showing]).toEqual(was);
    run(l, 0.4);
    expect(come(back)).toBeCloseTo(1 - Math.exp(-0.8 / PAPER_TAU), 6);
    // an older save says nothing of what its sheets showed: all of it
    delete saved.memory;
    l.e.restore(s, DEFAULT_PRESET);
    const [old] = sheets(l);
    expect(old.developed).toBe(true);
    expect(come(old)).toBe(1);
    expect(old.showing.filter((x) => x > 0).length).toBeGreaterThan(1);
    // and once it's all there, a save keeps nothing more of it
    expect(l.e.snapshot().tools.find((t) => t.kind === kind)!.memory).toBeUndefined();
  });
});

describe.each(['testpaper', 'bondpaper'] as const)('what stands on a sheet of %s', (kind) => {
  const R = singleOf('R');
  const cap = TEST_PAPER.cap;
  const cell = (p: { x: number; z: number }) => [toCell(p.x), toCell(p.z)];
  /** Where what's held would come to rest, if it can. */
  const rests = (l: Lab) => {
    const p = l.in.placement(l.in.held);
    return 'rest' in p ? p.rest.pose : null;
  };
  /** More of the engine's own things: its scales. */
  const scales = (l: Lab) => (l.in as unknown as { scales: { pose: Tool['pose'] }[] }).scales;

  it('is set down on it as if it were not there: a flask, a scale, a thermometer or a strip on its stand', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, kind);
    // a flask held over it goes straight down onto the counter, just where it's held
    holdAt(l, 'flask', { x: SPOT.x + 10, y: LIFT + 150, z: SPOT.z - 5, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    expect(where(f.pose)).toEqual([SPOT.x + 10, LIFT + 70, SPOT.z - 5, 0]);
    expect(where(sheet.pose)).toEqual(flat(SPOT.x, SPOT.z));
    // and so do a scale, and the dippers on their stands, each over a sheet
    for (const what of ['scale', 'thermometer', 'strip'] as const) {
      const l = lab();
      const x = SPOT.x + 2 * CELL;
      const under = lay(l, x, SPOT.z, kind);
      l.e.debug({ x, z: SPOT.z + 400, yaw: 0, pitch: 0 });
      l.in.move(0);
      expect(l.e.spawn(what)).toBe(true);
      const h = l.in.held as unknown as { kind: string; t?: Tool; sc?: { pose: Tool['pose'] } };
      hands(l).placeHeld(l.in.held, { x, y: LIFT + 200, z: SPOT.z, yaw: 0 });
      const was = h.kind === 'scale' ? scaleBox(h.sc as never) : toolBox(h.t!);
      const to = rests(l)!;
      expect(to).not.toBeNull();
      // it comes straight down where it's held
      expect(to.x).toBeCloseTo(x, 9);
      expect(to.z).toBeCloseTo(SPOT.z, 9);
      l.in.release();
      expect(l.in.held, `${what}: ${l.in.flash?.text}`).toBeNull();
      const now = h.kind === 'scale' ? scaleBox(h.sc as never) : toolBox(h.t!);
      // over the sheet, which is where it was
      expect(Math.abs(now.x - x)).toBeLessThan(now.hx + TEST_PAPER.w / 2);
      expect(Math.abs(now.z - SPOT.z)).toBeLessThan(now.hz + TEST_PAPER.d / 2);
      expect(now.y).toBeLessThanOrEqual(was.y);
      expect(where(under.pose)).toEqual(flat(x, SPOT.z));
      // (a scale stands on the counter, not on the paper)
      if (what === 'scale') expect(now.y - now.hy).toBeCloseTo(LIFT, 6);
      expect(scales(l)).toHaveLength(what === 'scale' ? 1 : 0);
    }
  });

  it("is a tool's stand too, base and all: nothing about a sheet under it is in its way", () => {
    // every kind of tool that stands on a stand, with a sheet in each cell its base touches
    const kinds = (Object.keys(STOCK) as (keyof typeof STOCK)[]).filter((k) => k !== 'flask' && k !== 'scale' && !SHAPES[k as Tool['kind']].flat);
    let onSheets = 0;
    for (const k of kinds) {
      const l = lab();
      // (with Alt held, so that no magnet pulls a spout over a sheet's middle)
      l.in.keys.add('AltLeft');
      holdAt(l, k as 'pipette', { x: 450, y: LIFT + 260, z: 950, yaw: 0 });
      const t = l.in.held!.t!;
      const bare = rests(l);
      if (!bare) continue;
      // where it would stand with nothing there: lay sheets under its stands' bases, and under its spouts
      const bases = toolStands(t, bare).map((st) => standBase(st, LIFT));
      const cells = new Set([...bases.flatMap((b) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => `${toCell(b.x + sx * (b.hx - 1))},${toCell(b.z + sz * (b.hz - 1))}`)))]);
      l.in.putAway();
      const sheets = [...cells].map((c) => c.split(',').map(Number)).map(([x, z]) => lay(l, x, z, kind));
      if (bases.some((b) => sheets.some((sh) => boxesOverlap(b, toolBox(sh))))) onSheets++;
      holdAt(l, k as 'pipette', { x: 450, y: LIFT + 260, z: 950, yaw: 0 });
      // it stands just where it would have
      expect(rests(l), k).toEqual(bare);
      l.in.release();
      expect(l.in.held, k).toBeNull();
      sheets.forEach((sh, i) => expect(where(sh.pose)).toEqual(flat(...([...cells][i].split(',').map(Number) as [number, number]))));
    }
    // (and some of those bases do stand on a sheet: the big tank's, which is a cell and more behind it)
    expect(onSheets).toBeGreaterThan(0);
  });

  it('is laid under what already stands there, but not on another sheet, of either kind', () => {
    const l = lab();
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    const pip = pipetteOver(l, SPOT.x + 2 * CELL);
    const under = lay(l, SPOT.x, SPOT.z, kind);
    expect(where(under.pose)).toEqual(flat(SPOT.x, SPOT.z));
    expect(where(f.pose).slice(0, 3)).toEqual([SPOT.x, LIFT + 70, SPOT.z]);
    const below = lay(l, SPOT.x + 2 * CELL, SPOT.z, kind);
    expect(where(below.pose)).toEqual(flat(SPOT.x + 2 * CELL, SPOT.z));
    expect(where(pip.pose).slice(0, 3)).toEqual([SPOT.x + 2 * CELL, LIFT + 60 + SHAPES.pipette.spoutY, SPOT.z]);
    // but two sheets don't share a cell
    for (const other of ['testpaper', 'bondpaper'] as const) {
      holdAt(l, other, { x: SPOT.x + 5, y: LIFT + 150, z: SPOT.z, yaw: 0 });
      expect(cell(rests(l)!)).not.toEqual(cell(SPOT));
      l.in.putAway();
    }
  });

  it('catches what falls before the sheet does; what it spills lands on the sheet', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, kind);
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    expect(cell(f.pose)).toEqual(cell(sheet.pose));
    const pip = pipetteOver(l, SPOT.x, SPOT.z, 200);
    pip.tanks[0].setMolecules(R, 2 * cap);
    pip.valves[0] = 1;
    run(l, 3);
    // the flask has it all, and the sheet under it is dry
    expect(volume(f)).toBeGreaterThan(0.5 * cap);
    expect(paperOf(sheet).N).toBe(0);
    // brim full, the flask spills over its lip, onto the sheet it stands on
    f.setMolecules(R, f.cap);
    run(l, 3);
    expect(volume(f)).toBeLessThanOrEqual(f.cap);
    expect(paperOf(sheet).n[R]).toBeGreaterThan(0);
    expect(paperOf(sheet).n[R]).toBe(volume(paperOf(sheet)));
  });

  it('finds a sheet from when sheets were thicker laid down on the counter as its save loads', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, kind);
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const saved = s.tools.find((t) => t.kind === kind)!;
    // (saves keep heights as fractions of the old bench's, growing downward: this is one unit higher)
    saved.fy -= (1 - TEST_PAPER.thick) / 620;
    l.e.restore(s, DEFAULT_PRESET);
    const [back] = l.in.tools.filter((t) => t.kind === kind);
    expect(where(back.pose)).toEqual(where(sheet.pose));
    expect(where(back.pose)).toEqual(flat(SPOT.x, SPOT.z));
  });

  it('stays where it is when the sheet is picked up from under it, and when the lab is saved and loaded', () => {
    const l = lab();
    const sheet = lay(l, SPOT.x, SPOT.z, kind);
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 150, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    f.setMolecules(R, 0.3 * CAP);
    const stood = where(f.pose);
    // saved and loaded, both are where they were
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    l.e.restore(s, DEFAULT_PRESET);
    const [sheet2] = l.in.tools.filter((t) => t.kind === kind);
    const [f2] = hands(l).flasks;
    expect(where(sheet2.pose)).toEqual(where(sheet.pose));
    expect(where(f2.pose).slice(0, 3)).toEqual(stood.slice(0, 3));
    // the sheet can still be picked up, and the flask doesn't move
    l.e.debug({ x: SPOT.x, z: SPOT.z + 400, yaw: 0, pitch: 0 });
    l.in.target = { kind: 'tool', t: sheet2, part: 'body', k: 0, point: { ...sheet2.pose }, distance: 300 };
    l.in.leftDown(false);
    expect(l.in.held?.t).toBe(sheet2);
    expect(where(f2.pose).slice(0, 3)).toEqual(stood.slice(0, 3));
    expect(f2.n[R]).toBe(0.3 * CAP);
    hands(l).placeHeld(l.in.held, { x: SPOT.x + 3 * CELL, y: LIFT + 100, z: SPOT.z, yaw: 0 });
    l.in.target = null;
    l.in.release();
    expect(where(sheet2.pose)).toEqual(flat(SPOT.x + 3 * CELL, SPOT.z));
    expect(where(f2.pose).slice(0, 3)).toEqual(stood.slice(0, 3));
    // and undo puts the sheet back under it
    l.e.undo();
    expect(where(sheet2.pose)).toEqual(flat(SPOT.x, SPOT.z));
    expect(where(f2.pose).slice(0, 3)).toEqual(stood.slice(0, 3));
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

  it('is in no new lab, which still has its spectroscope where it was', () => {
    const l = lab();
    expect(kinds(l.in)).not.toContain('analyzer');
    expect(kinds(l.in).filter((k) => k === 'spectroscope')).toHaveLength(1);
    expect(UNIQUE_TOOLS).not.toContain('analyzer');
    expect(INLINE_TOOLS).not.toContain('analyzer');
    expect(Object.keys(SHAPES)).not.toContain('analyzer');
    expect(l.in.tools.find((t) => t.kind === 'spectroscope')!.pose.x).toBe(toCell(1450));
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

describe('the bond visualizer, which is gone', () => {
  /**
   * A lab's save with a bond visualizer in it, as every lab had, right of the spectroscope: a pipette's hose docked on
   * its tube, a hose out of its own spout, and a reading on its screen.
   */
  function withVisualizer(l: { e: GameEngine; in: Inside }): SaveState {
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const spectro = s.tools.find((t) => t.kind === 'spectroscope')!;
    const tube = { n: { R: 1e6, 'R–G': 2e6 }, Q: 12e6 };
    const visualizer = { ...spectro, kind: 'visualizer', id: 901, fx: 1.75, tanks: [tube], drops: [tube], reading: [0.5, 0, 0, 0, 0, 0] };
    const pipette = { ...spectro, kind: 'pipette', id: 902, fx: 0.55, fy: 0.3, z: 750, valves: [0.5], tanks: [{ n: { G: 5e7 }, Q: 15e7 }], drops: [{ n: {}, Q: 0 }] };
    s.tools.unshift(visualizer as unknown as SaveState['tools'][number], pipette as SaveState['tools'][number]);
    s.hoses.push(
      // onto its tube, and out of its spout
      { outlet: { x: 1.75, y: 0.46, z: 150, yaw: 0, reach: 50 }, on: { tool: 902, spout: 0 } },
      { outlet: { x: 0.25, y: 0.6, z: 750, yaw: 0, reach: 50 }, on: { tool: 901, spout: 0 } },
    );
    return s;
  }
  const kinds = (l: Inside) => l.tools.map((t) => t.kind as string);

  it('is in no new lab, which has its spectroscope where it was, and bond paper to take from the cabinet instead', () => {
    const l = lab();
    expect(kinds(l.in)).not.toContain('visualizer');
    expect([...UNIQUE_TOOLS].sort()).toEqual(['receptacle', 'shadowlamp', 'spectroscope']);
    expect([...INLINE_TOOLS].sort()).toEqual(['meter', 'spectroscope']);
    expect(Object.keys(SHAPES)).not.toContain('visualizer');
    expect(kinds(l.in).filter((k) => k === 'spectroscope')).toHaveLength(1);
    expect(l.in.tools.find((t) => t.kind === 'spectroscope')!.pose.x).toBe(toCell(1450));
    expect(l.e.spawn('bondpaper')).toBe(true);
    expect(l.in.held?.t?.kind).toBe('bondpaper');
  });

  it('is lost from an older save as it loads, without error, with the hose out of its spout; the rest loads as it was', () => {
    const l = lab();
    const before = l.in.tools.map((t) => [t.kind, t.id]);
    const s = withVisualizer(l);
    expect(() => l.e.restore(s, DEFAULT_PRESET)).not.toThrow();
    expect(kinds(l.in)).not.toContain('visualizer');
    // none is added back in its place, and everything else is there, the pipette with what it held
    expect(l.in.tools.map((t) => [t.kind, t.id])).toEqual([['pipette', 902], ...before]);
    const pip = l.in.tools.find((t) => t.kind === 'pipette')!;
    expect(pip.tanks[0].N).toBe(5e7);
    // the hose that was docked on its tube is where it was, now over nothing; the one out of its spout is gone
    const hoses = (l.in as unknown as { hoses: { on: { tool?: Tool }; outlet: { x: number } }[] }).hoses;
    expect(hoses).toHaveLength(1);
    expect(hoses[0].on.tool).toBe(pip);
    expect(hoses[0].outlet.x).toBeCloseTo(1750, 6);
    // and the lab runs: what the hose lets out falls to the counter
    expect(() => {
      for (let i = 0; i < 40; i++) l.in.simulate(0.05);
    }).not.toThrow();
    expect(pip.tanks[0].N).toBeLessThan(5e7);
    // saved again, there's no trace of it
    expect(JSON.stringify(l.e.snapshot())).not.toContain('visualizer');
  });

  it("doesn't hand its hose on to a tool the save lacked, added as it loads", () => {
    // as bare a save as can be, but for a visualizer with its hose out: the station and the spectroscope are added
    const l = lab();
    const s = bare();
    const none = { n: {}, Q: 0 };
    s.tools.push({ kind: 'visualizer', id: 0, fx: 1.75, fy: 0.5, z: 150, valves: [], tanks: [none], drops: [none] } as unknown as SaveState['tools'][number]);
    s.hoses.push({ outlet: { x: 0.25, y: 0.6, z: 750, yaw: 0, reach: 50 }, on: { tool: 0, spout: 0 } });
    l.e.restore(s, DEFAULT_PRESET);
    expect(kinds(l.in).sort()).toEqual(['receptacle', 'shadowlamp', 'sheet', 'spectroscope']);
    expect((l.in as unknown as { hoses: unknown[] }).hoses).toEqual([]);
    expect(l.in.tools.every((t) => t.id > 0)).toBe(true);
  });
});

describe('the dish, which is gone', () => {
  /** A lab's save with a dish in it, set down on the front counter with solvent in it, and a pipette beside it. */
  function withDish(l: { e: GameEngine; in: Inside }): SaveState {
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const spectro = s.tools.find((t) => t.kind === 'spectroscope')!;
    const dish = { ...spectro, kind: 'dish', id: 901, fx: 0.45, fy: 0.3, z: 750, valves: [], tanks: [{ n: { S: 4e7 }, Q: 4e7 }], drops: [], note: 'carrier' };
    const pipette = { ...spectro, kind: 'pipette', id: 902, fx: 0.55, fy: 0.3, z: 750, valves: [0], tanks: [{ n: { G: 5e7 }, Q: 15e7 }], drops: [{ n: {}, Q: 0 }] };
    s.tools.unshift(dish as unknown as SaveState['tools'][number], pipette as SaveState['tools'][number]);
    return s;
  }
  const kinds = (l: Inside) => l.tools.map((t) => t.kind as string);

  it('is no kind of tool, and the cabinet and the wheels have none', () => {
    const l = lab();
    expect(kinds(l.in)).not.toContain('dish');
    expect(Object.keys(SHAPES)).not.toContain('dish');
    expect(Object.keys(STOCK)).not.toContain('dish');
    expect(WHEELS.flat() as string[]).not.toContain('dish');
  });

  it('is lost from an older save as it loads, without error, with what was in it; the rest loads as it was', () => {
    const l = lab();
    const before = l.in.tools.map((t) => [t.kind, t.id]);
    const s = withDish(l);
    expect(() => l.e.restore(s, DEFAULT_PRESET)).not.toThrow();
    expect(kinds(l.in)).not.toContain('dish');
    expect(l.in.tools.map((t) => [t.kind, t.id])).toEqual([['pipette', 902], ...before]);
    expect(l.in.tools.find((t) => t.kind === 'pipette')!.tanks[0].N).toBe(5e7);
    expect(() => {
      for (let i = 0; i < 40; i++) l.in.simulate(0.05);
    }).not.toThrow();
    // saved again, there's no trace of it
    const again = JSON.stringify(l.e.snapshot());
    expect(again).not.toContain('dish');
    expect(again).not.toContain('carrier');
  });
});

describe('the sleeper culture, which is gone', () => {
  /**
   * A lab's save with a sleeper culture in it, on the front counter: some fluid in its plate, some of its cells dead,
   * and a hose out of its spout.
   */
  function withCulture(l: { e: GameEngine; in: Inside }): SaveState {
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const spectro = s.tools.find((t) => t.kind === 'spectroscope')!;
    const culture = {
      ...spectro, kind: 'culture', id: 901, fx: 0.45, fy: 0.3, z: 750, valves: [0.5], tanks: [{ n: { R: 2e6 }, Q: 2e6 }],
      drops: [{ n: {}, Q: 0 }], memory: Array.from({ length: 180 }, (_, i) => +(i % 4 === 0)), note: 'tried on R',
    };
    const pipette = { ...spectro, kind: 'pipette', id: 902, fx: 0.55, fy: 0.3, z: 750, valves: [0], tanks: [{ n: { G: 5e7 }, Q: 15e7 }], drops: [{ n: {}, Q: 0 }] };
    s.tools.unshift(culture as unknown as SaveState['tools'][number], pipette as SaveState['tools'][number]);
    s.hoses.push({ outlet: { x: 0.25, y: 0.6, z: 750, yaw: 0, reach: 50 }, on: { tool: 901, spout: 0 } });
    return s;
  }
  const kinds = (l: Inside) => l.tools.map((t) => t.kind as string);

  it('is no kind of tool, and the cabinet and the wheels have none', () => {
    const l = lab();
    expect(kinds(l.in)).not.toContain('culture');
    expect(Object.keys(SHAPES)).not.toContain('culture');
    expect(Object.keys(STOCK)).not.toContain('culture');
    expect(WHEELS.flat() as string[]).not.toContain('culture');
  });

  it('is lost from an older save as it loads, without error, with the hose out of its spout; the rest loads as it was', () => {
    const l = lab();
    const before = l.in.tools.map((t) => [t.kind, t.id]);
    const hoses = () => (l.in as unknown as { hoses: unknown[] }).hoses.length;
    const had = hoses();
    const s = withCulture(l);
    expect(() => l.e.restore(s, DEFAULT_PRESET)).not.toThrow();
    expect(kinds(l.in)).not.toContain('culture');
    expect(l.in.tools.map((t) => [t.kind, t.id])).toEqual([['pipette', 902], ...before]);
    expect(l.in.tools.find((t) => t.kind === 'pipette')!.tanks[0].N).toBe(5e7);
    // the hose that was out of its spout is gone with it
    expect(hoses()).toBe(had);
    expect(() => {
      for (let i = 0; i < 40; i++) l.in.simulate(0.05);
    }).not.toThrow();
    // saved again, there's no trace of it
    const again = JSON.stringify(l.e.snapshot());
    expect(again).not.toContain('culture');
    expect(again).not.toContain('tried on R');
  });
});

/** Stand at (x, z) with eyes on (tx, ty, tz), carrying along what's held. */
function look(l: { e: GameEngine; in: Inside }, x: number, z: number, tx: number, ty: number, tz: number): void {
  const [dx, dy, dz] = [tx - x, ty - 620, tz - z];
  l.e.debug({ x, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
  l.in.move(0);
}

const lampOf = (l: Inside) => l.tools.filter((t) => t.kind === 'shadowlamp');

describe('setting things down', () => {
  /** More of the engine's own things: the faucets, the scales, and where things are made to face. */
  interface More {
    faucets: { start: { start: number }; spout: { x: number; y: number; z: number } }[];
    scales: Scale[];
    flasks: Flask[];
    player: { x: number; z: number; yaw: number; pitch: number };
  }
  const more = (l: Lab) => l.in as unknown as More;
  type Kind = Parameters<GameEngine['spawn']>[0];
  /** Take one of a kind out of the cabinet, hold it at a pose, and let go of it there; what it was. */
  function setAt(l: Lab, kind: Kind, p: Tool['pose']): Tool | Flask | Scale {
    holdAt(l, kind as 'pipette', p);
    const h = l.in.held as unknown as { t?: Tool; f?: Flask; sc?: Scale };
    const it = h.t ?? h.f ?? h.sc!;
    l.in.release();
    expect(l.in.held, `${kind}: ${l.in.flash?.text}`).toBeNull();
    return it;
  }
  /** Where what's held would come to rest, or why not. */
  const rests = (l: Lab) => {
    const p = l.in.placement(l.in.held);
    return 'rest' in p ? p.rest : null;
  };
  /** Somewhere on the first island, between cells' middles. */
  const ODD = { x: SPOT.x + 0.37 * CELL, z: SPOT.z - 0.29 * CELL };

  it('sets what is let go of down just where it is held, and a save keeps it there', () => {
    const l = lab();
    const d = setAt(l, 'dispenser', { x: ODD.x, y: LIFT + 260, z: ODD.z, yaw: Math.PI / 2 }) as Tool;
    expect(where(d.pose)).toEqual(where({ x: ODD.x, y: LIFT + 260, z: ODD.z, yaw: Math.PI / 2 }));
    const f = setAt(l, 'flask', { x: ODD.x + 2 * CELL + 7, y: LIFT + 150, z: ODD.z + 3, yaw: 0 }) as Flask;
    expect(where(f.pose)).toEqual([ODD.x + 2 * CELL + 7, LIFT + FLASK_H, ODD.z + 3, 0].map((v) => Math.round(v * 1e6) / 1e6));
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    l.e.restore(s, DEFAULT_PRESET);
    const d2 = l.in.tools.find((t) => t.kind === 'dispenser')!;
    for (const [a, b] of [[d2.pose, d.pose], [more(l).flasks[0].pose, f.pose]])
      for (const k of ['x', 'y', 'z', 'yaw'] as const) expect(a[k]).toBeCloseTo(b[k], 6);
  });

  it('pulls a flask under a faucet when it is held within MAGNET of it, and not when it is further', () => {
    const l = lab();
    const sp = more(l).faucets[0].spout;
    const off = (d: number) => ({ x: sp.x + d * 0.8, y: LIFT + 150, z: sp.z - d * 0.6, yaw: 0 });
    holdAt(l, 'flask', off(MAGNET - 1));
    expect([rests(l)!.pose.x, rests(l)!.pose.z]).toEqual([sp.x, sp.z]);
    l.in.putAway();
    holdAt(l, 'flask', off(MAGNET + 1));
    const far = rests(l)!.pose;
    expect(far.x).toBeCloseTo(off(MAGNET + 1).x, 9);
    expect(far.z).toBeCloseTo(off(MAGNET + 1).z, 9);
    // and with Alt held, not at all
    l.in.putAway();
    l.in.keys.add('AltLeft');
    holdAt(l, 'flask', off(MAGNET - 1));
    expect(rests(l)!.pose.x).toBeCloseTo(off(MAGNET - 1).x, 9);
  });

  it('lines up all five of a separator’s spouts over a row of five tanks at its pitch, or the best it can over a row at another', () => {
    for (const pitch of [CELL, CELL + 9]) {
      const l = lab();
      // (set down with Alt held, as they're placed, so nothing pulls them into line)
      l.in.keys.add('AltLeft');
      const ds = [-2, -1, 0, 1, 2].map((i) => setAt(l, 'dispenser', { x: SPOT.x + i * pitch, y: LIFT + 230, z: SPOT.z, yaw: 0 }) as Tool);
      l.in.keys.delete('AltLeft');
      // held facing the other way, high over them, a little off
      holdAt(l, 'separator' as 'pipette', { x: SPOT.x + 5, y: LIFT + 480, z: SPOT.z + 3, yaw: Math.PI });
      const t = l.in.held!.t!;
      const mouths = ds.map((d) => tankMouth(d, 0));
      const apart = (j: number, m: { x: number; z: number }) => Math.hypot(spoutAt(t, j).x - m.x, spoutAt(t, j).z - m.z);
      // the nearest any spout is to any tank's middle, as it's held
      const nearest = Math.min(...t.shape.spouts.flatMap((_, j) => mouths.map((m) => apart(j, m))));
      const to = rests(l)!.pose;
      const moved = Math.hypot(to.x - (SPOT.x + 5), to.z - (SPOT.z + 3));
      t.pose = to;
      const lined = t.shape.spouts.filter((_, j) => mouths.some((m) => apart(j, m) < 1e-6)).length;
      if (pitch === CELL) {
        expect(lined).toBe(5);
        expect([to.x, to.z].map((v) => +v.toFixed(6))).toEqual([SPOT.x, SPOT.z]);
      } else {
        // no two line up at once, so just the pair nearest lining up does
        expect(lined).toBe(1);
        expect(moved).toBeCloseTo(nearest, 6);
      }
      expect(moved).toBeLessThanOrEqual(MAGNET);
    }
  });

  it('with Alt held, sets a tool down turned just as it is held, and a flask is pulled under its spout all the same', () => {
    const l = lab();
    const p = more(l).player;
    l.e.debug({ x: ODD.x, z: ODD.z + 150, yaw: 0, pitch: -0.3 });
    l.in.move(0);
    expect(l.e.spawn('dispenser')).toBe(true);
    const d = l.in.held!.t!;
    l.in.held!.relYaw = Math.PI / 6;
    l.in.move(0);
    // without Alt it faces the nearest of the four ways; with it, as it's held
    expect(d.pose.yaw).toBeCloseTo(0, 9);
    l.in.keys.add('AltLeft');
    l.in.move(0);
    expect(d.pose.yaw).toBeCloseTo(p.yaw + Math.PI / 6, 9);
    const pl0 = l.in.placement(l.in.held);
    expect(pl0, JSON.stringify(d.pose)).toHaveProperty("rest");
    const want = rests(l)!.pose;
    l.in.release();
    expect(l.in.held, l.in.flash?.text).toBeNull();
    expect(where(d.pose)).toEqual(where(want));
    expect(d.pose.yaw).toBeCloseTo(Math.PI / 6, 9);
    // on its stand, which stands on the counter behind it, turned with it
    const [st] = toolStands(d);
    expect(st.yaw).toBeCloseTo(Math.PI / 6, 9);
    expect(counterUnder(standBase(st, 0))).toBe(LIFT);
    // a flask held near under its spout is pulled under it, and catches what it lets out
    l.in.keys.delete('AltLeft');
    const sp = spoutAt(d, 0);
    holdAt(l, 'flask', { x: sp.x + 9, y: LIFT + 100, z: sp.z - 7, yaw: 0 });
    const f = l.in.held!.f!;
    l.in.release();
    expect(l.in.held, l.in.flash?.text).toBeNull();
    expect(f.pose.x).toBeCloseTo(sp.x, 9);
    expect(f.pose.z).toBeCloseTo(sp.z, 9);
    d.tanks[0].setMolecules(singleOf('R'), CAP);
    d.valves[0] = 1;
    run(l, 2);
    expect(f.N).toBeGreaterThan(0);
    // and a save keeps it turned so
    l.e.restore(JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState, DEFAULT_PRESET);
    expect(l.in.tools.find((t) => t.kind === 'dispenser')!.pose.yaw).toBeCloseTo(Math.PI / 6, 6);
    // so is a flask under the end spout of a separator turned so, out to one side of where it's held from
    l.in.keys.add('AltLeft');
    const sep = setAt(l, 'separator', { x: 1300, y: LIFT + 300, z: 800, yaw: Math.PI / 6 }) as Tool;
    l.in.keys.delete('AltLeft');
    expect(sep.pose.yaw).toBeCloseTo(Math.PI / 6, 9);
    const end = spoutAt(sep, sep.shape.spouts.length - 1);
    const g = setAt(l, 'flask', { x: end.x - 6, y: LIFT + 100, z: end.z + 11, yaw: 0 }) as Flask;
    expect(g.pose.x).toBeCloseTo(end.x, 9);
    expect(g.pose.z).toBeCloseTo(end.z, 9);
  });

  it('sets what has no room where it is held down as near as there is room, no further than NEAR, or not at all', () => {
    const l = lab();
    const f = setAt(l, 'flask', { x: ODD.x, y: LIFT + 150, z: ODD.z, yaw: 0 }) as Flask;
    holdAt(l, 'flask', { x: ODD.x + 5, y: LIFT + 150, z: ODD.z, yaw: 0 });
    const to = rests(l)!.pose;
    const gone = Math.hypot(to.x - (ODD.x + 5), to.z - ODD.z);
    expect(gone).toBeGreaterThan(0);
    expect(gone).toBeLessThanOrEqual(NEAR + 1e-9);
    expect(Math.hypot(to.x - f.pose.x, to.z - f.pose.z)).toBeGreaterThanOrEqual(2 * FLASK_R);
    l.in.putAway();
    // off the front of the island by more than that, it can't be set down
    const front = 16 * CELL;
    holdAt(l, 'flask', { x: ODD.x, y: LIFT + 150, z: front - FLASK_R + NEAR + 1, yaw: 0 });
    expect('why' in l.in.placement(l.in.held)).toBe(true);
    l.in.putAway();
    holdAt(l, 'flask', { x: ODD.x, y: LIFT + 150, z: front - FLASK_R + NEAR - 1, yaw: 0 });
    expect(rests(l)!.pose.z).toBeLessThanOrEqual(front - FLASK_R + 1e-9);
  });

  it('pulls an empty scale under two faucets side by side, its places for a flask under them, and both flasks on it catch', () => {
    const l = lab();
    const [a, b] = more(l).faucets.map((fa) => fa.spout);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(SCALE_SLOTS[1] - SCALE_SLOTS[0], 6);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const sc = setAt(l, 'scale', { x: mid.x - 6, y: LIFT + 100, z: mid.z + 8, yaw }) as Scale;
    const places = SCALE_SLOTS.map((dx) => onScale(sc, dx));
    for (const [p, s] of [[places[0], a], [places[1], b]]) {
      expect(p.x).toBeCloseTo(s.x, 6);
      expect(p.z).toBeCloseTo(s.z, 6);
    }
    const fs = places.map((p) => setAt(l, 'flask', { ...p, y: p.y + 40, x: p.x + 4 }) as Flask);
    expect(sc.load.map((x) => x.f)).toEqual(fs);
    run(l, 1);
    expect(fs[0].n[more(l).faucets[0].start.start]).toBeGreaterThan(0);
    expect(fs[1].n[more(l).faucets[1].start.start]).toBeGreaterThan(0);
  });
});

describe('the shadow lamp', () => {
  it('is in every new lab, on its bench, out, its dial halfway', () => {
    const l = lab();
    const lamps = lampOf(l.in);
    expect(lamps).toHaveLength(1);
    expect(lamps[0].pose).toEqual(LAMP_POSE);
    expect(lamps[0].lit).toBe(false);
    expect(lamps[0].valves).toEqual([0.5]);
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

  it('is lit with the left button on its button, for as long as its dial says, and put out with it again; a save keeps it and undo takes a press back', () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    lamp.valves[0] = 1;
    l.in.target = { kind: 'tool', t: lamp, part: 'button', k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 };
    l.in.leftDown(false);
    expect([lamp.lit, lamp.left]).toEqual([true, lampShot(1)]);
    // it shines on the lab's time: paused it holds, and it goes out by itself when its time is up
    l.in.simulate(0.1);
    expect(lamp.left).toBeCloseTo(lampShot(1) - 0.1);
    l.e.speed = 0;
    l.in.simulate(0.1);
    expect(lamp.left).toBeCloseTo(lampShot(1) - 0.1);
    l.e.speed = 1;
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    // pressed again, it's out; undo puts it back lit, with what it had left, and undo again takes back the first press
    l.in.leftDown(false);
    expect(lamp.lit).toBe(false);
    l.e.undo();
    expect(lamp.lit).toBe(true);
    expect(lamp.left).toBeCloseTo(lampShot(1) - 0.1);
    l.e.undo();
    expect(lamp.lit).toBe(false);
    l.e.undo(true);
    expect(lamp.lit).toBe(true);
    l.e.speed = 16;
    for (let i = 0; i < 5; i++) l.in.simulate(0.05);
    expect([lamp.lit, lamp.left]).toEqual([false, 0]);
    // and once it's shone itself out, an undo of something else doesn't light it again
    l.e.undo();
    expect(lamp.lit).toBe(false);
    l.e.restore(s, DEFAULT_PRESET);
    const [saved] = lampOf(l.in);
    expect(saved.lit).toBe(true);
    expect(saved.left).toBeCloseTo(lampShot(1) - 0.1);
    expect(saved.valves).toEqual([1]);
  });

  it('has its dial turned like any valve, which undo takes back', () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    l.in.target = { kind: 'tool', t: lamp, part: 'valve', k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 };
    expect(l.in.valveAimed()).toEqual({ t: lamp, k: 0 });
    // (with no view to say where the mouse points, the dial is turned by hand)
    l.in.viewW = 0;
    l.in.rightDown();
    lamp.valves[0] = 0.8;
    l.in.endTurn();
    l.e.undo();
    expect(lamp.valves[0]).toBe(0.5);
    l.e.undo(true);
    expect(lamp.valves[0]).toBe(0.8);
  });

  it("can't be picked up, and its button and dial don't answer the key that picks things up at all", () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    const on = (part: string) => (l.in.target = { kind: 'tool', t: lamp, part, k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 });
    // the button is for pressing, with the left button, and the dial for turning, with the right: the key neither
    // works them nor says anything
    for (const part of ['button', 'valve']) {
      on(part);
      l.in.grabOrRelease(false);
      expect([l.in.held, lamp.lit, l.in.flash]).toEqual([null, false, null]);
    }
    // anywhere else on it, the key says why nothing's picked up
    on('body');
    l.in.grabOrRelease(false);
    expect(l.in.held).toBeNull();
    expect(l.in.flash?.text).toBe('That stays where it is');
    expect(lamp.pose).toEqual(LAMP_POSE);
  });

  it("stands what's set down in its channel on the channel's floor, a tool on its stand included", () => {
    const l = lab();
    const mid = toWorld(LAMP_POSE, { x: 0, y: 0, z: 0 });
    /** Hold what's in hand over the middle of the channel's middle cell, its middle `y` high. */
    const hold = (y: number) => {
      const from = { x: mid.x, z: mid.z - 160 };
      l.in.held!.dist = Math.hypot(160, y - 620);
      look(l, from.x, from.z, mid.x, y, mid.z);
    };
    look(l, mid.x, mid.z - 160, mid.x, 560, mid.z);
    expect(l.e.spawn('flask')).toBe(true);
    const f = l.in.held!.f!;
    hold(560);
    l.in.release();
    expect(l.in.held).toBeNull();
    expect([f.pose.x, f.pose.z].map((v) => +v.toFixed(6))).toEqual([mid.x, mid.z].map((v) => +v.toFixed(6)));
    expect(f.pose.y).toBeCloseTo(LAMP_FLOOR.y + FLASK_H);
    // a dispenser held too low in the cell by the sheet, facing the sheet, comes up to stand over the floor, its
    // stand's base on the floor behind it
    expect(l.e.spawn('dispenser')).toBe(true);
    const d = l.in.held!.t!;
    // (whoever holds it is looking across the channel, the sheet's end on their right)
    l.in.held!.relYaw = Math.PI / 2;
    l.in.held!.dist = Math.hypot(160, LIFT + 40 - 620);
    look(l, mid.x - 2 * CELL, mid.z - 160, mid.x - 2 * CELL, LIFT + 40, mid.z);
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(d.pose.x).toBeCloseTo(mid.x - 2 * CELL);
    expect(d.pose.z).toBeCloseTo(mid.z);
    expect(d.pose.y - d.shape.box.y1).toBeCloseTo(LAMP_FLOOR.y);
    const [st] = toolStands(d);
    expect(counterUnder(standBase(st, 0))).toBe(LAMP_FLOOR.y);
    expect(st.x).toBeGreaterThan(d.pose.x);
  });

  it('lets a sheet of test paper be laid on the floor of its channel, and a flask be stood on that', () => {
    const l = lab();
    const mid = toWorld(LAMP_POSE, { x: 0, y: 0, z: 0 });
    const hold = (y: number) => {
      l.in.held!.dist = Math.hypot(160, y - 620);
      look(l, mid.x, mid.z - 160, mid.x, y, mid.z);
    };
    look(l, mid.x, mid.z - 160, mid.x, 560, mid.z);
    expect(l.e.spawn('testpaper')).toBe(true);
    const p = l.in.held!.t!;
    hold(LAMP_FLOOR.y + 20);
    // (it's held low in front, a little nearer: just over the middle, then)
    hands(l).placeHeld(l.in.held, { ...p.pose, x: mid.x, z: mid.z });
    l.in.release();
    expect(l.in.held).toBeNull();
    expect([p.pose.x, p.pose.z].map((v) => +v.toFixed(6))).toEqual([mid.x, mid.z].map((v) => +v.toFixed(6)));
    expect(p.pose.y - p.shape.box.y1).toBeCloseTo(LAMP_FLOOR.y);
    expect(l.e.spawn('flask')).toBe(true);
    const f = l.in.held!.f!;
    hold(560);
    l.in.release();
    expect(l.in.held).toBeNull();
    expect([f.pose.x, f.pose.z].map((v) => +v.toFixed(6))).toEqual([mid.x, mid.z].map((v) => +v.toFixed(6)));
    expect(f.pose.y).toBeCloseTo(LAMP_FLOOR.y + FLASK_H);
  });
});

describe('shadow paper', () => {
  /** A lab with the sheet its lamp starts with gone from the slot, as if taken out and put away. */
  function emptied(): { e: GameEngine; in: Inside } {
    const l = lab();
    (l.in as unknown as { tools: Tool[] }).tools = l.in.tools.filter((t) => t.kind !== 'sheet');
    return l;
  }

  it("starts in the slot of a lamp that's new: a new lab's, and an older save's that had no lamp, but not one whose sheet was taken out", () => {
    const l = lab();
    const sheets = () => l.in.tools.filter((t) => t.kind === 'sheet');
    expect(sheets()).toHaveLength(1);
    expect(sheets()[0].pose).toEqual(slotPose(SHEET_SLOT.yaw));
    expect(inSlot(sheets()[0].pose)).toBe(true);
    expect(sheets()[0].dose.every((d) => d === 0)).toBe(true);
    // a save from before there was a lamp gets one, with its sheet
    l.e.restore(bare(), DEFAULT_PRESET);
    expect(sheets()).toHaveLength(1);
    expect(inSlot(sheets()[0].pose)).toBe(true);
    // one that has a lamp, and nothing in its slot, is left that way
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    s.tools = s.tools.filter((t) => t.kind !== 'sheet');
    l.e.restore(s, DEFAULT_PRESET);
    expect(sheets()).toHaveLength(0);
  });

  /**
   * Take a sheet out of the cabinet, by the wheel, standing out in the room in front of the lamp's bench, with the
   * sheet held up over the end of the lamp's channel: turned to face the lamp, or with its back to it.
   */
  function sheetAtSlot(l: { e: GameEngine; in: Inside }, facing = true): Tool {
    const at = () => look(l, SHEET_SLOT.x, SHEET_SLOT.z - 160, SHEET_SLOT.x, SHEET_SLOT.y - 150, SHEET_SLOT.z);
    at();
    expect(l.e.spawn('sheet')).toBe(true);
    // (whoever holds it is looking across the channel, the lamp on their left)
    l.in.held!.relYaw = facing ? -Math.PI / 2 : Math.PI / 2;
    at();
    return l.in.held!.t!;
  }

  it('comes out of the cabinet as often as wanted, and is thrown away when put away', () => {
    const l = emptied();
    for (let i = 0; i < STOCK.sheet + 3; i++) {
      expect(l.e.spawn('sheet')).toBe(true);
      expect(l.in.held?.t?.kind).toBe('sheet');
      l.in.putAway();
      expect(l.in.held).toBeNull();
    }
    expect(l.in.tools.some((t) => t.kind === 'sheet')).toBe(false);
    expect(l.in.stock.sheet.every(Boolean)).toBe(true);
  });

  it("goes into the lamp's slot when it's let go of there, with no stand, and out again when it's picked up", () => {
    const l = emptied();
    const sheet = sheetAtSlot(l);
    // in hand it has no stand, and where it would go is the slot
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
    const second = sheetAtSlot(l);
    const pl2 = l.in.placement(l.in.held);
    if ('rest' in pl2) expect(inSlot(pl2.rest.pose)).toBe(false);
    l.in.putAway();
    expect(l.in.tools).not.toContain(second);
    // picked up with the crosshair on it, and set down on an island, it's on a stand like any tool
    l.in.target = { kind: 'tool', t: sheet, part: 'body', k: 0, point: { ...SHEET_SLOT }, distance: 200 };
    l.in.leftDown(false);
    expect(l.in.held?.t).toBe(sheet);
    look(l, 100, 1100, 100, 700, 700);
    l.in.release();
    expect(l.in.held, l.in.flash?.text).toBeNull();
    expect(sheetIn(l.in.tools)).toBeNull();
    expect(toolStands(sheet)).toHaveLength(1);
    expect(l.in.stands().some((s) => s.of.t === sheet)).toBe(true);
    // undo puts it back in the slot, and Q puts back one picked up from there
    l.e.undo();
    expect(sheet.pose).toEqual(SHEET_SLOT);
    l.in.leftDown(false);
    look(l, 100, 1100, 100, 700, 700);
    l.in.putBack();
    expect(sheet.pose).toEqual(SHEET_SLOT);
  });

  it('goes in with its back to the lamp, if that is how it is held', () => {
    const l = emptied();
    const sheet = sheetAtSlot(l, false);
    l.in.release();
    expect(sheet.pose).toEqual(slotPose(SHEET_SLOT.yaw + Math.PI));
    expect(Math.cos(sheet.pose.yaw - SHEET_SLOT.yaw)).toBeCloseTo(-1);
    expect(sheetIn(l.in.tools)).toBe(sheet);
  });

  it('keeps its image, and its place in the slot, through a save', () => {
    const l = emptied();
    const sheet = sheetAtSlot(l);
    l.in.release();
    const N = SHEET.cells;
    sheet.expose(Float32Array.from({ length: N * N }, (_, k) => (k % N < N / 3 ? 0 : 1)), 0.6);
    const loose = sheetAtSlot(l);
    look(l, 100, 1100, 100, 700, 700);
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

  it("is owed the lamp's light while it's in the slot with the lamp lit, on sim time", () => {
    const l = emptied();
    const [lamp] = lampOf(l.in);
    lamp.valves[0] = 1;
    const press = () => {
      l.in.target = { kind: 'tool', t: lamp, part: 'button', k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 };
      l.in.leftDown(false);
      l.in.target = null;
    };
    // lit, with no sheet in, nothing happens
    press();
    l.in.simulate(0.1);
    expect([lamp.lit, lamp.sheet, lamp.owed]).toEqual([true, null, 0]);
    // a sheet in hand at the slot isn't in it yet; let go of there, it is, and the light's time is the lab's
    const sheet = sheetAtSlot(l);
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
    // put out, no more; and with nothing drawing the lab, what's owed just waits, the sheet as it was
    press();
    l.e.speed = 1;
    l.in.simulate(0.1);
    expect(lamp.owed).toBeCloseTo(0.9);
    expect(Math.max(...sheet.dose)).toBe(0);
    // picked up, it's out of the slot, and owed nothing
    l.in.target = { kind: 'tool', t: sheet, part: 'body', k: 0, point: { ...SHEET_SLOT }, distance: 200 };
    l.in.leftDown(false);
    l.in.simulate(0.1);
    expect([lamp.sheet, lamp.owed]).toEqual([null, 0]);
  });

  it('is owed no more than the exposure had left, through the longest sleep', () => {
    const l = emptied();
    const [lamp] = lampOf(l.in);
    sheetAtSlot(l);
    l.in.release();
    lamp.valves[0] = 0.75;
    lamp.press();
    l.in.simulate(0.1, true);
    expect(lamp.owed).toBeCloseTo(0.1);
    l.in.sleeper().skip(100000);
    expect(lamp.owed).toBeCloseTo(lampShot(0.75));
    expect(lamp.lit).toBe(false);
    l.in.simulate(0.1, true);
    expect(lamp.owed).toBeCloseTo(lampShot(0.75));
  });
});
