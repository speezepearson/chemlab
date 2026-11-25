import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BOND_KEYS } from '../chem/atoms';
import { ReactionNetwork } from '../chem/reactions';
import { testChemParams } from '../chem/testChem';
import { SOLVENT_SPECIES, pairOf, singleOf } from '../chem/species';
import { FLASK_R, MAGNET, NEAR, NEAR_STEP, NOZZLE_REACH, PLATFORM_REACH, flaskLip, flaskMouth, onScale, plumbZ, spoutAt, spoutTip, settleAngle, DIAL_STOP, STOPCOCK, VALVE_WHEEL, tankMouth, scaleBox, standBase, toolBounds, toolBox, toolStands, type Stand } from './bodies';
import { boxesOverlap } from './physics';
import { STOCK } from './cabinet';
import { WHEELS } from './wheel';
import { CAP, TRACE } from './config';
import type { GameEngine } from './engine';
import { Vessel, volume, type Flask } from './flask';
import type { Scale } from './scale';
import { FLASK_H } from './flaskShape';
import { DEFAULT_PRESET, LAMP_POSE, PRESETS } from './presets';
import { FAUCETS, faucetRate, faucetTarget, faucetValveAt } from './faucets';
import { FILL_RATE } from './config';
import type { SaveState } from './save';
import { CELL, LAMP_FLOOR, LIFT, REACH, counterUnder, toWorld } from './space';
import { AIM, AIM_DEG } from './aim';
import { toCell } from './testLayout';
import {
  DRIP, DRIP_FLOW, Hose, INLINE_TOOLS, MAX_FLOW, PAPER_TAU, REFERENCE_FLOW, SCREEN, SHAPES, TEST_PAPER, UNIQUE_TOOLS, bondReading, bondShares, paperReading,
  type Blotter, type Cock, type Mouth, Tool,
} from './tools';

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
    blocked(): boolean {
      return false;
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
  valveAimed(): { t: Tool; k: number } | { faucet: number } | null;
  viewW: number;
  grabOrRelease(linked: boolean): void;
  release(): void;
  putAway(): void;
  putBack(): void;
  move(dt: number): void;
  simulate(dt: number, quiet?: boolean): void;
  sleeper(): { skip(dt: number): void };
  placement(h: unknown): { rest: { pose: Tool['pose'] } } | { why: string };
  stands(): Stand[];
  keys: Set<string>;
}

/** Fit a stopcock at the tip of t's first spout, set to v (see Tool.cocks), or set the one there to v. */
const cock = (t: Tool, v: number) => (t.cocks[0] = { valve: v });

/** Whether the lab has t's stands up, as t stands (see toolStands). */
const standing = (l: { in: Inside }, t: Tool) =>
  l.in.stands().some((s) => toolStands(t).some((u) => u.x === s.x && u.z === s.z && u.clampY === s.clampY));

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
/** How far, in radians, the middle of what's held is from straight ahead of the eyes, where the crosshair is. */
function offRay(l: Lab): number {
  const I = l.in as unknown as { eye(): { x: number; y: number; z: number }; lookDir(): { x: number; y: number; z: number } };
  const c = toolBox(l.in.held!.t!);
  const e = I.eye();
  const d = I.lookDir();
  const v = { x: c.x - e.x, y: c.y - e.y, z: c.z - e.z };
  return Math.acos(Math.min(1, (v.x * d.x + v.y * d.y + v.z * d.z) / Math.hypot(v.x, v.y, v.z)));
}
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
  // looking a little down, the sheet is held in front, about there; and then just there
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

/** Where what's held is held: its ghost's pose, if it's moved by one, or else its own. */
function heldPose(l: Lab): Tool['pose'] {
  const h = l.in.held as unknown as { ghost?: { pose: Tool['pose'] }; t?: Tool; f?: Flask; sc?: Scale };
  return h.ghost?.pose ?? (h.t ?? h.f ?? h.sc)!.pose;
}

/** Stand `d` in front of `p` (toward the room's front), the eyes on it, as if the mouse were captured. */
function lookAt(l: Lab, p: { x: number; y: number; z: number }, d = 200): void {
  l.e.debug({ x: p.x, z: p.z + d, yaw: 0, pitch: Math.atan2(p.y - 620, d), locked: true });
}

/** Run the lab for `s` sim seconds. */
const run = (l: Lab, s: number) => {
  for (let i = 0; i < Math.round(s / 0.05); i++) l.in.simulate(0.05);
};

describe('test paper', () => {
  const R = singleOf('R');
  const G = singleOf('G');
  const RG = pairOf('R', 'G');

  it('comes out of the cabinet as often as wanted, held with its middle on the crosshair, and is thrown away when put away', () => {
    const l = lab();
    for (let i = 0; i < STOCK.testpaper + 3; i++) {
      // looking down at a counter or level, its face's middle is straight ahead
      l.e.debug({ x: SPOT.x, z: SPOT.z + 300, yaw: 0, pitch: [-0.8, -0.4, 0][i % 3] });
      expect(l.e.spawn('testpaper')).toBe(true);
      l.in.move(0);
      expect(l.in.held?.t?.kind).toBe('testpaper');
      expect(offRay(l)).toBeLessThan(1e-9);
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
    expect(standing(l, sheet)).toBe(false);
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
    cock(pip, 1);
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
    cock(pip, 0.02);
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
    // tipped all the way, with E held, its lip over the sheet
    const tipped = l.in as unknown as { using: boolean };
    const lip = flaskLip(f, Math.PI * 0.61);
    hands(l).placeHeld(l.in.held, { ...f.pose, x: f.pose.x + SPOT.x - lip.x, y: f.pose.y + 30, z: f.pose.z + SPOT.z - lip.z });
    f.tilt = Math.PI * 0.61;
    tipped.using = true;
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

  it('comes out of the cabinet as often as wanted, held with its middle on the crosshair, and is thrown away when put away', () => {
    const l = lab();
    for (let i = 0; i < STOCK.bondpaper + 3; i++) {
      // looking down at a counter or level, its face's middle is straight ahead
      l.e.debug({ x: SPOT.x, z: SPOT.z + 300, yaw: 0, pitch: [-0.8, -0.4, 0][i % 3] });
      expect(l.e.spawn('bondpaper')).toBe(true);
      l.in.move(0);
      expect(l.in.held?.t?.kind).toBe('bondpaper');
      expect(offRay(l)).toBeLessThan(1e-9);
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
    expect(standing(l, sheet)).toBe(false);
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
    cock(pip, 1);
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
    faucets: { start: { start: number }; spout: { x: number; y: number; z: number }; valve: number }[];
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
    cock(pip, 1);
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
      cock(pip, 1);
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
    cock(pip, 1);
    run(l, 6);
    expect(volume(paperOf(sheet)) / cap).toBeCloseTo(1, 4);
  });

  it('is wetted on sim time: paused, nothing lands on it, however it is held', () => {
    const l = lab();
    const { pip, f } = line(l);
    const sheet = wave(l, 150);
    pip.tanks[0].setMolecules(R, 3 * cap);
    cock(pip, 1);
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
    cock(pip, 0.02);
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
    faucet.valve = 1;
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
    cock(pip, 1);
    run(l, 5);
    cock(pip, 0);
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
    cock(pip, 1);
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
      // (a scale is moved by a ghost, held there while the scale itself is still in the cabinet)
      const pose = () => (h.kind === 'scale' ? h.sc!.pose : h.t!.pose);
      expect(h.kind === 'scale' ? !!(l.in.held as unknown as { ghost?: object }).ghost : true).toBe(true);
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
      expect(pose().y).toBeLessThanOrEqual(LIFT + 200);
      expect(where(under.pose)).toEqual(flat(x, SPOT.z));
      // (a scale stands on the counter, not on the paper)
      if (what === 'scale') expect(now.y - now.hy).toBeCloseTo(LIFT, 6);
      expect(scales(l)).toHaveLength(what === 'scale' ? 1 : 0);
    }
  });

  it("is a tool's stand too, base and all: nothing about a sheet under it is in its way", () => {
    // every kind of tool that stands on a stand, with a sheet in each cell its base touches
    const kinds = (Object.keys(STOCK) as (keyof typeof STOCK)[]).filter((k) => k !== 'flask' && k !== 'scale' && k !== 'stopcock' && !SHAPES[k as Tool['kind']].flat);
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
    cock(pip, 1);
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
    expect(kinds(l.in).sort()).toEqual(['receptacle', 'shadowlamp', 'spectroscope']);
    expect((l.in as unknown as { hoses: unknown[] }).hoses).toEqual([]);
    expect(l.in.tools.every((t) => t.id > 0)).toBe(true);
  });
});

describe('the splitter, which is gone', () => {
  const kinds = (l: Inside) => l.tools.map((t) => t.kind as string);
  it('is dropped as a save loads, with the hoses on its spouts and the stopcocks on them', () => {
    const l = lab();
    const s = bare();
    const none = { n: {}, Q: 0 };
    s.tools.push({
      kind: 'splitter', id: 0, fx: 0.5, fy: 0.5, z: 750, valves: [0.3], tanks: [none], drops: [none, none],
      cocks: [{ valve: 0.5 }, null], ends: [null, { valve: 1 }],
    } as unknown as SaveState['tools'][number]);
    s.hoses.push({ outlet: { x: 0.25, y: 0.6, z: 750, yaw: 0, reach: 50 }, on: { tool: 0, spout: 1 } });
    l.e.restore(s, DEFAULT_PRESET);
    expect(Object.keys(SHAPES)).not.toContain('splitter');
    expect(kinds(l.in).sort()).toEqual(['receptacle', 'shadowlamp', 'spectroscope']);
    expect((l.in as unknown as { hoses: unknown[] }).hoses).toEqual([]);
    expect(l.in.tools.every((t) => t.id > 0)).toBe(true);
    expect(JSON.stringify(l.e.snapshot())).not.toContain('splitter');
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

describe('E', () => {
  /** How E is pressed and let go, as the engine's own things (see useDown and using). */
  type Use = { useDown(): void; using: boolean; held: { f?: Flask } | null };
  const use = (l: Lab) => l.in as unknown as Use;

  it('uses what’s in hand while it’s held, and neither sets it down nor picks anything up', () => {
    const l = lab();
    // (with a flask looked at to pour into: over nothing, it would be emptied at the press instead, see below)
    holdAt(l, 'flask', { x: SPOT.x + 2 * CELL, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    const into = use(l).held!.f!;
    l.in.release();
    expect(l.in.held).toBeNull();
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    const f = use(l).held!.f!;
    f.setMolecules(singleOf('G'), 0.5 * CAP);
    run(l, 0.05);
    l.in.target = { kind: 'flask', f: into };
    use(l).useDown();
    expect(use(l).using).toBe(true);
    for (let i = 0; i < 20; i++) l.in.move(0.05);
    // still in hand, tipping to pour
    expect(use(l).held?.f).toBe(f);
    expect(f.tilt).toBeGreaterThan(0);
    // let go of (the touch screen's stand-in, as the key's keyup does), it rights itself
    l.e.touchKey('KeyE', false);
    expect(use(l).using).toBe(false);
    for (let i = 0; i < 20; i++) l.in.move(0.05);
    expect(f.tilt).toBe(0);
    // with empty hands, it picks up nothing, and isn't left in use for the next thing taken in hand
    hands(l).placeHeld(l.in.held, { x: SPOT.x, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    l.in.release();
    expect(l.in.held).toBeNull();
    l.in.target = { kind: 'flask', f };
    use(l).useDown();
    expect(l.in.held).toBeNull();
    expect(use(l).using).toBe(false);
  });

  it('empties a flask that would pour into nothing, at a press, but pours one over an open top while it’s held', () => {
    const l = lab();
    const I = l.in as unknown as { wouldEmpty(): boolean; emptying: boolean };
    // a flask standing on the counter, and another in hand, away from it
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    const under = use(l).held!.f!;
    l.in.release();
    expect(l.in.held).toBeNull();
    holdAt(l, 'flask', { x: SPOT.x + 3 * CELL, y: LIFT + 200, z: SPOT.z, yaw: 0 });
    const f = use(l).held!.f!;
    run(l, 0.05);
    l.in.target = null;
    // empty, there's nothing to let out
    expect(I.wouldEmpty()).toBe(false);
    f.setMolecules(singleOf('G'), 0.5 * CAP);
    expect(I.wouldEmpty()).toBe(true);
    // looking at the other flask, it would be poured into it instead
    l.in.target = { kind: 'flask', f: under };
    expect(I.wouldEmpty()).toBe(false);
    l.in.target = null;
    // and so it would with its lip, tipped, over the other's mouth, though the crosshair's not on it
    const was = { ...f.pose };
    const lip = flaskLip(f, Math.PI * 0.61);
    const m = flaskMouth(under);
    hands(l).placeHeld(l.in.held, { ...was, x: was.x + m.x - lip.x, z: was.z + m.z - lip.z });
    expect(I.wouldEmpty()).toBe(false);
    use(l).useDown();
    expect(use(l).using).toBe(true);
    expect(I.emptying).toBe(false);
    l.e.touchKey('KeyE', false);
    // over nothing, one press: it tips, lets it all go and rights itself, with E not held, and stays in hand
    hands(l).placeHeld(l.in.held, was);
    use(l).useDown();
    expect(use(l).using).toBe(false);
    expect(I.emptying).toBe(true);
    expect(I.wouldEmpty()).toBe(false);
    for (let i = 0; i < 60 && (I.emptying || f.tilt > 0); i++) {
      l.in.move(0.05);
      run(l, 0.05);
    }
    expect(f.N).toBe(0);
    expect(under.N).toBe(0);
    expect(f.tilt).toBe(0);
    expect(I.emptying).toBe(false);
    expect(use(l).held?.f).toBe(f);
  });
});

describe('E’s hint', () => {
  it('shows over the mouth a flask in hand would be poured into, but not while it pours, nor for an empty one', () => {
    const l = lab();
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    expect(l.in.held).toBeNull();
    holdAt(l, 'flask', { x: SPOT.x + 2 * CELL, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    const held = hands(l).held!.f!;
    const I = l.in as unknown as { pourHintAt(): unknown; useDown(): void; using: boolean };
    // (the open tops, as of the last step)
    run(l, 0.05);
    l.in.target = { kind: 'flask', f };
    // empty, nothing to pour
    expect(I.pourHintAt()).toBeNull();
    held.setMolecules(singleOf('G'), 0.3 * CAP);
    expect(I.pourHintAt()).toEqual(expect.objectContaining({ x: expect.closeTo(SPOT.x, 6), z: expect.closeTo(SPOT.z, 6) }));
    I.useDown();
    expect(I.pourHintAt()).toBeNull();
    l.e.touchKey('KeyE', false);
    expect(I.pourHintAt()).not.toBeNull();
    // aimed at nothing in particular, none
    l.in.target = null;
    expect(I.pourHintAt()).toBeNull();
  });

  it('shows by the open top a strip or a thermometer in hand would be dipped into, but not while it dips', () => {
    const l = lab();
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    f.setMolecules(singleOf('G'), 0.3 * CAP);
    l.in.release();
    expect(l.in.held).toBeNull();
    const I = l.in as unknown as { dipHintAt(): { at: { x: number; z: number }; strip: boolean } | null; pourHintAt(): unknown; useDown(): void };
    run(l, 0.05);
    for (const kind of ['thermometer', 'strip'] as const) {
      expect(l.e.spawn(kind)).toBe(true);
      // aimed at nothing in particular, none
      l.in.target = null;
      expect(I.dipHintAt()).toBeNull();
      l.in.target = { kind: 'flask', f };
      expect(I.dipHintAt()).toEqual({ at: expect.objectContaining({ x: SPOT.x, z: SPOT.z }), strip: kind === 'strip' });
      // (and it's not the flask's hint)
      expect(I.pourHintAt()).toBeNull();
      I.useDown();
      expect(I.dipHintAt()).toBeNull();
      l.e.touchKey('KeyE', false);
      l.in.putAway();
      expect(l.in.held).toBeNull();
    }
    // with empty hands, none
    expect(I.dipHintAt()).toBeNull();
  });
});

describe('the left button’s hint', () => {
  it('shows for picking something up, but not for setting down what’s in hand', () => {
    const l = lab();
    const I = l.in as unknown as { leftWouldDo(): boolean; leftHint(): boolean; placed: unknown; placement(h: unknown): unknown };
    holdAt(l, 'flask', { x: SPOT.x, y: LIFT + 160, z: SPOT.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.target = null;
    // (where it would be set down, as each frame works out)
    I.placed = I.placement(l.in.held);
    // in hand, with somewhere to rest: the left button would set it down, and its hint doesn't say so
    expect(I.leftWouldDo()).toBe(true);
    expect(I.leftHint()).toBe(false);
    l.in.release();
    expect(l.in.held).toBeNull();
    // with empty hands and the crosshair on it, it would pick it up, and says so
    l.in.target = { kind: 'flask', f };
    expect(I.leftWouldDo()).toBe(true);
    expect(I.leftHint()).toBe(true);
    l.in.target = null;
    expect(I.leftHint()).toBe(false);
  });

  it('puts what’s in hand in the cabinet, with the crosshair on the cabinet, and shows its hint for that', () => {
    const l = lab();
    const I = l.in as unknown as { leftHint(): boolean; flasks: Flask[] };
    expect(l.e.spawn('flask')).toBe(true);
    expect(I.flasks).toHaveLength(1);
    l.in.target = { kind: 'cabinet' } as Inside['target'];
    expect(I.leftHint()).toBe(true);
    l.in.leftDown(false);
    expect(l.in.held).toBeNull();
    expect(I.flasks).toHaveLength(0);
  });
});

describe('setting things down', () => {
  /** More of the engine's own things: the faucets, the scales, and where things are made to face. */
  interface More {
    faucets: { start: { start: number }; spout: { x: number; y: number; z: number }; valve: number }[];
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
    // (off toward the room, away from the wall)
    const off = (d: number) => ({ x: sp.x - d * 0.8, y: LIFT + 150, z: sp.z - d * 0.6, yaw: 0 });
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

  it('lines up both of a separator’s spouts over two tanks at its pitch, or the best it can over two at another', () => {
    for (const pitch of [CELL, CELL + 9]) {
      const l = lab();
      // (set down with Alt held, as they're placed, so nothing pulls them into line)
      l.in.keys.add('AltLeft');
      const ds = [-1, 1].map((i) => setAt(l, 'dispenser', { x: SPOT.x + i * pitch, y: LIFT + 230, z: SPOT.z, yaw: 0 }) as Tool);
      l.in.keys.delete('AltLeft');
      // held facing the other way, high over them, a little off
      holdAt(l, 'separator' as 'pipette', { x: SPOT.x + 5, y: LIFT + 480, z: SPOT.z + 3, yaw: Math.PI });
      const t = l.in.held!.t!;
      // (it's moved by a ghost, and isn't in the lab yet: see it where its ghost is)
      t.pose = heldPose(l);
      const mouths = ds.map((d) => tankMouth(d, 0));
      const apart = (j: number, m: { x: number; z: number }) => Math.hypot(spoutAt(t, j).x - m.x, spoutAt(t, j).z - m.z);
      // the nearest any spout is to any tank's middle, as it's held
      const nearest = Math.min(...t.shape.spouts.flatMap((_, j) => mouths.map((m) => apart(j, m))));
      const to = rests(l)!.pose;
      const moved = Math.hypot(to.x - (SPOT.x + 5), to.z - (SPOT.z + 3));
      t.pose = to;
      const lined = t.shape.spouts.filter((_, j) => mouths.some((m) => apart(j, m) < 1e-6)).length;
      if (pitch === CELL) {
        expect(lined).toBe(2);
        // facing the other way, its spouts (in front of its middle, see plumbZ) are behind it as the room goes
        expect([to.x, to.z].map((v) => +v.toFixed(6))).toEqual([SPOT.x, +(SPOT.z + plumbZ(t)).toFixed(6)]);
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
    // without Alt it faces the nearest of the four ways; with it, as it's held (by its ghost)
    expect(rests(l)!.pose.yaw).toBeCloseTo(0, 9);
    l.in.keys.add('AltLeft');
    l.in.move(0);
    expect(heldPose(l).yaw).toBeCloseTo(p.yaw + Math.PI / 6, 9);
    const pl0 = l.in.placement(l.in.held);
    expect(pl0, JSON.stringify(heldPose(l))).toHaveProperty("rest");
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
    cock(d, 1);
    run(l, 2);
    expect(f.N).toBeGreaterThan(0);
    // and a save keeps it turned so
    l.e.restore(JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState, DEFAULT_PRESET);
    expect(l.in.tools.find((t) => t.kind === 'dispenser')!.pose.yaw).toBeCloseTo(Math.PI / 6, 6);
    // so is a flask under the end spout of a separator turned so, out to one side of where it's held from
    l.in.keys.add('AltLeft');
    const sep = setAt(l, 'separator', { x: 1150, y: LIFT + 300, z: 820, yaw: Math.PI / 6 }) as Tool;
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

  it('has no places of its own for a magnet: an empty scale is set down just where it is held', () => {
    const l = lab();
    const [a, b] = more(l).faucets.map((fa) => fa.spout);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const sc = setAt(l, 'scale', { x: mid.x - 6, y: LIFT + 100, z: mid.z + 8, yaw }) as Scale;
    expect([sc.pose.x, sc.pose.z]).toEqual([mid.x - 6, mid.z + 8]);
  });

  it('stands a flask on a scale just where it is held over the platform, as on a counter, or pulled under a faucet', () => {
    const l = lab();
    const [a, b] = more(l).faucets.map((fa) => fa.spout);
    for (const fa of more(l).faucets.slice(0, 2)) fa.valve = 1;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const sc = setAt(l, 'scale', { x: mid.x, y: LIFT + 100, z: mid.z, yaw }) as Scale;
    // off-centre, away from any faucet's magnet: just where it's held
    const spot = onScale(sc, -PLATFORM_REACH.x, 0.5);
    l.in.keys.add('AltLeft');
    const f = setAt(l, 'flask', { ...spot, y: spot.y + 40 }) as Flask;
    l.in.keys.delete('AltLeft');
    expect(sc.load).toEqual([{ f, dx: expect.closeTo(-PLATFORM_REACH.x, 6), dz: expect.closeTo(0.5, 6) }]);
    expect(f.pose.y).toBeCloseTo(sc.pose.y + 70, 6);
    // a second, held over the first, is set down beside it, not in it
    holdAt(l, 'flask', { ...spot, y: spot.y + 40 });
    const g = l.in.held!.f!;
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(Math.hypot(g.pose.x - f.pose.x, g.pose.z - f.pose.z)).toBeGreaterThanOrEqual(2 * FLASK_R - 1e-6);
    // under the faucets, held near them over the platform, each is pulled under its spout by its own magnet, and catches
    sc.remove(f);
    sc.remove(g);
    more(l).flasks.splice(0);
    const fs = [a, b].map((s) => setAt(l, 'flask', { ...s, y: sc.pose.y + 120, x: s.x + 4, yaw: 0 }) as Flask);
    expect(sc.load.map((x) => x.f)).toEqual(fs);
    fs.forEach((h, i) => expect([h.pose.x, h.pose.z].map((v) => +v.toFixed(6))).toEqual([[a, b][i].x, [a, b][i].z].map((v) => +v.toFixed(6))));
    run(l, 1);
    expect(fs[0].n[more(l).faucets[0].start.start]).toBeGreaterThan(0);
    expect(fs[1].n[more(l).faucets[1].start.start]).toBeGreaterThan(0);
    // and a save keeps where each stands
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    expect(s.scales[0].load.every((x) => Number.isFinite(x.dz))).toBe(true);
    l.e.restore(s, DEFAULT_PRESET);
    const sc2 = more(l).scales[0];
    expect(sc2.load.map((x) => +x.dx.toFixed(6))).toEqual(sc.load.map((x) => +x.dx.toFixed(6)));
    // a save from when it had two places for a flask, which kept no dz, loads them where they stood, across its middle
    for (const x of s.scales[0].load) delete x.dz;
    l.e.restore(s, DEFAULT_PRESET);
    expect(more(l).scales[0].load.map((x) => x.dz)).toEqual([0, 0]);
  });

  it('shows no guides into an empty scale held under two faucets: it has no places of its own', () => {
    const l = lab();
    const [a, b] = more(l).faucets.map((fa) => fa.spout);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    const G = l.in as unknown as { guides(pl: unknown): { look: string }[] };
    holdAt(l, 'scale' as 'pipette', { x: mid.x - 6, y: LIFT + 100, z: mid.z + 8, yaw });
    expect(G.guides(l.in.placement(l.in.held)).filter((g) => g.look === 'snap')).toHaveLength(0);
  });
});

describe('ghost moves', () => {
  interface Ghosting {
    held: { kind: string; t?: Tool; sc?: Scale; f?: Flask; ghost?: { pose: Tool['pose'] } } | null;
    hoses: { on: object; outlet: { x: number; y: number; z: number } }[];
    scales: Scale[];
    flasks: Flask[];
    faucets: { spout: { x: number; y: number; z: number }; start: { start: number }; valve: number }[];
    history: { canUndo: boolean };
    target: unknown;
    grabOrRelease(linked: boolean): void;
    obstacles(h: unknown): { x: number; z: number }[];
  }
  const g = (l: Lab) => l.in as unknown as Ghosting;
  /** Where what's held would come to rest. */
  const restAt = (l: Lab) => {
    const p = l.in.placement(l.in.held);
    expect('rest' in p, 'why' in p ? p.why : '').toBe(true);
    return 'rest' in p ? p.rest.pose : P;
  };
  const P = { x: SPOT.x + 0.3 * CELL, y: LIFT + 260, z: SPOT.z - 0.2 * CELL, yaw: 0 };
  /** A lab with a dispenser set down at P with a flask under its spout, and R in its tank. */
  function rig(): { l: Lab; d: Tool; f: Flask } {
    const l = lab();
    holdAt(l, 'dispenser' as 'pipette', P);
    const d = l.in.held!.t!;
    l.in.release();
    const sp = spoutAt(d, 0);
    holdAt(l, 'flask', { x: sp.x, y: LIFT + 100, z: sp.z, yaw: 0 });
    const f = l.in.held!.f!;
    l.in.release();
    expect(l.in.held).toBeNull();
    d.tanks[0].setMolecules(singleOf('R'), CAP / 2);
    return { l, d, f };
  }
  /** Pick up a tool with the crosshair on it, standing back from it. */
  const pick = (l: Lab, t: Tool, linked = false) => {
    l.e.debug({ x: t.pose.x, z: t.pose.z + 300, yaw: 0, pitch: -0.2 });
    l.in.target = { kind: 'tool', t, part: 'body', k: 0, point: { ...t.pose }, distance: 300 };
    g(l).grabOrRelease(linked);
    l.in.target = null;
    expect(l.in.held?.t).toBe(t);
  };

  it('leaves what is picked up where it is, still pouring, until it is set down, and then moves it at once, as one step', () => {
    const { l, d, f } = rig();
    const was = { ...d.pose };
    cock(d, 1);
    pick(l, d);
    expect(g(l).held!.ghost).toBeDefined();
    const to = { ...P, x: P.x + 3 * CELL };
    hands(l).placeHeld(l.in.held, to);
    run(l, 1);
    expect(d.pose).toEqual(was);
    expect(f.N).toBeGreaterThan(0);
    // and still solid where it stands: the player walks into it as into anything
    const box = toolBox(d);
    expect(g(l).obstacles(null).some((b) => b.x === box.x && b.z === box.z)).toBe(true);
    // what's held stays where it was, so it's still poured from, and nothing of it goes down the drain
    const caught = f.N;
    run(l, 1);
    expect(f.N).toBeGreaterThan(caught);
    expect(where(restAt(l))).toEqual(where(to));
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(where(d.pose)).toEqual(where(to));
    // undone in one step
    l.e.undo();
    expect(d.pose).toEqual(was);
  });

  it('takes what is moved by its ghost out of what the crosshair can be on, as anything held is', () => {
    const { l, d } = rig();
    const I = l.in as unknown as { heldObject(): object | null };
    pick(l, d);
    expect(g(l).held!.ghost).toBeDefined();
    expect(I.heldObject()).toBe(d);
  });

  it('can be nudged into space it partly takes up itself, its stand too', () => {
    const { l, d } = rig();
    pick(l, d);
    const to = { ...P, x: P.x + MAGNET + 2 };
    hands(l).placeHeld(l.in.held, to);
    expect(where(restAt(l))).toEqual(where(to));
  });

  it('carries hoses following it along only when it is set down', () => {
    const l = lab();
    const fa = g(l).faucets[0];
    fa.valve = 1;
    // a scale with a flask on it under a faucet, open, which pours into it
    holdAt(l, 'scale' as 'pipette', { x: fa.spout.x, y: LIFT + 100, z: fa.spout.z + 30, yaw: Math.PI / 2 });
    const sc = (l.in.held as unknown as { sc: Scale }).sc;
    l.in.release();
    expect(l.in.held).toBeNull();
    const place = onScale(sc, CELL / 2);
    holdAt(l, 'flask', { x: place.x, y: place.y + 40, z: place.z, yaw: 0 });
    const f = l.in.held!.f!;
    l.in.release();
    expect(sc.load.map((x) => x.f)).toEqual([f]);
    expect(Math.hypot(place.x - fa.spout.x, place.z - fa.spout.z)).toBeLessThan(1e-6);
    run(l, 0.2);
    expect(f.N).toBeGreaterThan(0);
    const before = g(l).history.canUndo;
    // picked up hooked up, its faucet's hose comes out to go with it, but neither moves until it's set down
    l.e.debug({ x: sc.pose.x - 300, z: sc.pose.z, yaw: -Math.PI / 2, pitch: -0.3 });
    l.in.target = { kind: 'scale', sc, part: 'body', point: { ...sc.pose }, distance: 300 };
    g(l).grabOrRelease(true);
    l.in.target = null;
    expect(g(l).held!.ghost).toBeDefined();
    expect(g(l).hoses).toHaveLength(1);
    const was = { ...sc.pose };
    const to = { ...sc.pose, z: sc.pose.z + 3 * CELL };
    hands(l).placeHeld(l.in.held, to);
    run(l, 0.2);
    expect(sc.pose).toEqual(was);
    expect(g(l).hoses[0].outlet.z).toBeCloseTo(fa.spout.z, 6);
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(sc.pose.z).toBeCloseTo(to.z, 6);
    const on = sc.load[0];
    expect(f.pose.z).toBeCloseTo(onScale(sc, on.dx, on.dz).z, 6);
    expect(g(l).hoses[0].outlet.z).toBeCloseTo(f.pose.z, 6);
    // one step: undone, the scale's back, and the hose rolled back up
    l.e.undo();
    expect(sc.pose).toEqual(was);
    expect(g(l).hoses).toHaveLength(0);
    expect(g(l).history.canUndo).toBe(before);
  });

  it('leaves it just as it was if Q is pressed, with no step to undo', () => {
    const { l, d } = rig();
    const was = { ...d.pose };
    l.e.undo();
    l.e.undo();
    // (nothing left to undo, so a step would show)
    expect(g(l).history.canUndo).toBe(false);
    holdAt(l, 'dispenser' as 'pipette', { ...P, x: P.x + 4 * CELL });
    l.in.release();
    expect(g(l).history.canUndo).toBe(true);
    l.e.undo();
    expect(g(l).history.canUndo).toBe(false);
    pick(l, d);
    hands(l).placeHeld(l.in.held, { ...P, x: P.x + 3 * CELL });
    l.in.putBack();
    expect(l.in.held).toBeNull();
    expect(d.pose).toEqual(was);
    expect(g(l).history.canUndo).toBe(false);
  });

  it('makes something new only a ghost until it is set down, and puts it back in the cabinet if it is not', () => {
    const l = lab();
    const left = l.in.stock.dispenser.filter(Boolean).length;
    l.e.debug({ x: SPOT.x, z: SPOT.z + 200, yaw: 0, pitch: -0.3 });
    l.in.move(0);
    expect(l.e.spawn('dispenser')).toBe(true);
    const t = l.in.held!.t!;
    expect(l.in.tools).not.toContain(t);
    expect(l.in.stock.dispenser.filter(Boolean).length).toBe(left - 1);
    // saved meanwhile, it's still in the cabinet
    expect(l.e.snapshot().cabinet!.dispenser).toHaveLength(left);
    l.in.putBack();
    expect(l.in.held).toBeNull();
    expect(l.in.tools).not.toContain(t);
    expect(l.in.stock.dispenser.filter(Boolean).length).toBe(left);
    // set down, it's there
    expect(l.e.spawn('dispenser')).toBe(true);
    const u = l.in.held!.t!;
    hands(l).placeHeld(l.in.held, P);
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(l.in.tools).toContain(u);
    expect(where(u.pose)).toEqual(where(P));
  });

  it('loads a cabinet saved with more slots of a kind than it has now, keeping those it has', () => {
    const l = lab();
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const n = STOCK.tank;
    // as saved when there were more of them, with the second empty and the rest full
    s.cabinet = { ...s.cabinet, tank: Array.from({ length: n + 5 }, (_, i) => i).filter((i) => i !== 1) };
    l.e.restore(s, DEFAULT_PRESET);
    expect(l.in.stock.tank).toEqual(Array.from({ length: n }, (_, i) => i !== 1));
  });

  it('puts a flask, a dipper, a sheet of test paper or a hose’s nozzle in hand, not a ghost', () => {
    const l = lab();
    for (const kind of ['flask', 'thermometer', 'testpaper'] as const) {
      l.e.debug({ x: SPOT.x, z: SPOT.z + 200, yaw: 0, pitch: -0.3 });
      l.in.move(0);
      expect(l.e.spawn(kind)).toBe(true);
      expect(g(l).held!.ghost, kind).toBeUndefined();
      const thing = g(l).held!.f ?? g(l).held!.t!;
      expect([...g(l).flasks, ...l.in.tools]).toContain(thing);
      // held where it's held: it's moved itself
      expect(heldPose(l)).toBe(thing.pose);
      l.in.putAway();
    }
    // a hose's nozzle, taken hold of
    const h = new Hose({ faucet: 0 }, { x: SPOT.x, y: LIFT + 150, z: SPOT.z }, NOZZLE_REACH.min);
    (g(l).hoses as unknown as Hose[]).push(h);
    lookAt(l, h.outlet);
    l.e.touchHose();
    expect(g(l).held!.kind).toBe('hose');
    expect(g(l).held!.ghost).toBeUndefined();
  });
});

describe('the shadow lamp', () => {
  it('is in every new lab, on its bench, out, its screen dark', () => {
    const l = lab();
    const lamps = lampOf(l.in);
    expect(lamps).toHaveLength(1);
    expect(lamps[0].pose).toEqual(LAMP_POSE);
    expect(lamps[0].lit).toBe(false);
    expect(lamps[0].valves).toEqual([]);
    expect(Math.max(...lamps[0].glow)).toBe(0);
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

  it('is lit with the left button on its button, and stays lit until it is put out with it again; a save keeps it and undo takes a press back', () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    l.in.target = { kind: 'tool', t: lamp, part: 'button', k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 };
    l.in.leftDown(false);
    expect(lamp.lit).toBe(true);
    l.e.speed = 16;
    for (let i = 0; i < 20; i++) l.in.simulate(0.05);
    l.e.speed = 1;
    expect(lamp.lit).toBe(true);
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    // pressed again, it's out; undo puts it back lit, and undo again takes back the first press
    l.in.leftDown(false);
    expect(lamp.lit).toBe(false);
    l.e.undo();
    expect(lamp.lit).toBe(true);
    l.e.undo();
    expect(lamp.lit).toBe(false);
    l.e.undo(true);
    expect(lamp.lit).toBe(true);
    l.e.restore(s, DEFAULT_PRESET);
    const [saved] = lampOf(l.in);
    expect(saved.lit).toBe(true);
    // (its screen comes up from dark)
    expect(Math.max(...saved.glow)).toBe(0);
  });

  it("owes its screen the lab's time while it's lit: none paused, sixteen times as much at 16×, and no end of it through a sleep", () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    l.in.simulate(0.1);
    expect(lamp.owed).toBe(0);
    lamp.press();
    l.in.simulate(0.1);
    expect(lamp.owed).toBeCloseTo(0.1);
    l.e.speed = 0;
    l.in.simulate(0.1);
    expect(lamp.owed).toBeCloseTo(0.1);
    l.e.speed = 16;
    l.in.simulate(0.05);
    expect(lamp.owed).toBeCloseTo(0.9);
    // with nothing drawing the lab, what's owed just waits, the screen as it was; and it's never more than brings
    // it all the way
    expect(Math.max(...lamp.glow)).toBe(0);
    l.in.sleeper().skip(100000);
    expect(lamp.owed).toBe(SCREEN.most);
    expect(lamp.lit).toBe(true);
  });

  it("can't be picked up, and its button doesn't answer the key that picks things up at all", () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    const on = (part: string) => (l.in.target = { kind: 'tool', t: lamp, part, k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 });
    // the button is for pressing, with the left button: the key neither works it nor says anything
    on('button');
    l.in.grabOrRelease(false);
    expect([l.in.held, lamp.lit, l.in.flash]).toEqual([null, false, null]);
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
    // a dispenser held too low in the cell by the screen, facing the screen, comes up to stand over the floor, its
    // stand's base on the floor behind it
    expect(l.e.spawn('dispenser')).toBe(true);
    const d = l.in.held!.t!;
    // (bare: the handwheel of the stopcock it comes with stands a little proud of its front, into the end wall)
    d.cocks.fill(null);
    // (whoever holds it is looking across the channel, the screen's end on their right)
    l.in.held!.relYaw = Math.PI / 2;
    l.in.held!.dist = Math.hypot(160, LIFT + 40 - 620);
    look(l, mid.x - 2 * CELL, mid.z - 160, mid.x - 2 * CELL, LIFT + 40, mid.z);
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(d.pose.x).toBeCloseTo(mid.x - 2 * CELL);
    expect(d.pose.z).toBeCloseTo(mid.z);
    expect(d.pose.y - toolBounds(d).y1).toBeCloseTo(LAMP_FLOOR.y);
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
    // (it's held in front, short of the middle: just over the middle, then)
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

describe('a heater from when it had three taps', () => {
  it("loads with its middle tap as its tap and its dial as its dial, its hoses on the spouts those became", () => {
    const l = lab();
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const none = { n: {}, Q: 0 };
    const drop = (n: number) => ({ n: { R: n }, Q: n });
    s.tools.push({
      kind: 'heater', id: 900, fx: 0.5, fy: 0.5, z: 750, valves: [0.1, 0.2, 0.3, 0.6], tanks: [none], drops: [drop(1), drop(2), drop(3), drop(4)],
    } as unknown as SaveState['tools'][number]);
    const outlet = (x: number) => ({ x, y: 0.6, z: 750, yaw: 0, reach: 50 });
    s.hoses.push(
      { outlet: outlet(0.2), on: { tool: 900, spout: 0 } },
      { outlet: outlet(0.3), on: { tool: 900, spout: 1 } },
      { outlet: outlet(0.4), on: { tool: 900, spout: 2 } },
      { outlet: outlet(0.5), on: { tool: 900, spout: 3 } },
    );
    l.e.restore(s, DEFAULT_PRESET);
    const ht = l.in.tools.find((t) => t.kind === 'heater')!;
    expect(ht.valves).toEqual([0.2, 0.6]);
    expect(ht.drops.map((d) => d.N)).toEqual([2, 4]);
    const hoses = (l.in as unknown as { hoses: { on: { tool?: Tool; spout?: number }; outlet: { x: number } }[] }).hoses.filter((h) => h.on.tool === ht);
    expect(hoses.map((h) => h.on.spout)).toEqual([0, 1]);
    expect(hoses[0].outlet.x).toBeLessThan(hoses[1].outlet.x);
    // saved again and loaded, it's as it is now
    l.e.restore(JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState, DEFAULT_PRESET);
    const again = l.in.tools.find((t) => t.kind === 'heater')!;
    expect(again.valves).toEqual([0.2, 0.6]);
    expect((l.in as unknown as { hoses: { on: { tool?: Tool; spout?: number } }[] }).hoses.filter((h) => h.on.tool === again).map((h) => h.on.spout)).toEqual([0, 1]);
  });
});

describe('shadow paper, which is gone', () => {
  /** A lab's save with a sheet of shadow paper in the lamp's slot, with an image on it, and another on a stand, as labs had. */
  function withSheets(l: { e: GameEngine; in: Inside }): SaveState {
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const lamp = s.tools.find((t) => t.kind === 'shadowlamp')!;
    const sheet = { ...lamp, kind: 'sheet', valves: [], tanks: [], drops: [], memory: undefined };
    s.tools.unshift(
      { ...sheet, id: 901, fx: 0.1, fy: 0.2, z: 2650, yaw: Math.PI / 2, image: btoa('\x01\xff\x80') } as unknown as SaveState['tools'][number],
      { ...sheet, id: 902, fx: 0.5, fy: 0.5, z: 750, yaw: 0 } as unknown as SaveState['tools'][number],
    );
    // (and its lamp had a dial, and was part-way through an exposure)
    Object.assign(lamp, { valves: [0.75], memory: [1, 0.4] });
    return s;
  }
  const kinds = (l: Inside) => l.tools.map((t) => t.kind as string);

  it('is no kind of tool, and the cabinet and the wheels have none', () => {
    const l = lab();
    expect(kinds(l.in)).not.toContain('sheet');
    expect(Object.keys(SHAPES)).not.toContain('sheet');
    expect(Object.keys(STOCK)).not.toContain('sheet');
    expect(WHEELS.flat() as string[]).not.toContain('sheet');
  });

  it('is lost from an older save as it loads, without error; its lamp loads lit, with no dial', () => {
    const l = lab();
    const before = l.in.tools.map((t) => [t.kind, t.id]);
    const s = withSheets(l);
    expect(() => l.e.restore(s, DEFAULT_PRESET)).not.toThrow();
    expect(kinds(l.in)).not.toContain('sheet');
    expect(l.in.tools.map((t) => [t.kind, t.id])).toEqual(before);
    const [lamp] = lampOf(l.in);
    expect([lamp.lit, lamp.valves]).toEqual([true, []]);
    expect(() => {
      for (let i = 0; i < 40; i++) l.in.simulate(0.05);
    }).not.toThrow();
    // saved again, there's no trace of it
    const again = JSON.stringify(l.e.snapshot());
    expect(again).not.toContain('sheet');
    expect(again).not.toContain('image');
  });
});

describe('faucets’ valves', () => {
  /** The engine's faucets, and the rest of its own things these tests reach into. */
  interface Taps {
    faucets: {
      start: { start: number };
      spout: { x: number; y: number; z: number };
      wall: { x: number; y: number; z: number };
      valve: number;
      drop: Vessel;
      out: Vessel | null;
      flow: number;
      streaming: boolean;
    }[];
    flasks: Flask[];
    falling: { v: Vessel }[];
    hoses: Hose[];
    open: Mouth[];
    view: { ray(x: number, y: number): { o: { x: number; y: number; z: number }; d: { x: number; y: number; z: number } } };
    history: { canUndo: boolean };
    look(dx: number, dy: number, shift: boolean): void;
  }
  const taps = (l: Lab) => l.in as unknown as Taps;

  /** A flask set down under faucet i's spout, emptied. */
  function under(l: Lab, i = 0): Flask {
    const sp = taps(l).faucets[i].spout;
    holdAt(l, 'flask', { x: sp.x, y: sp.y - 80, z: sp.z, yaw: 0 });
    const f = hands(l).held!.f!;
    l.in.release();
    expect([f.pose.x, f.pose.z]).toEqual([sp.x, sp.z]);
    f.n.fill(0);
    f.N = f.Q = 0;
    return f;
  }

  it('are all shut in a new lab, after Reset and in every preset, and a shut one lets out nothing', () => {
    const l = lab();
    expect(taps(l).faucets.length).toBe(FAUCETS.length);
    expect(taps(l).faucets.every((fa) => fa.valve === 0)).toBe(true);
    const f = under(l);
    run(l, 2);
    expect(f.N).toBe(0);
    expect(taps(l).faucets.every((fa) => !fa.out && fa.drop.N === 0)).toBe(true);
    for (const p of PRESETS) {
      for (const fa of taps(l).faucets) fa.valve = 1;
      l.e.load(p);
      expect(taps(l).faucets.every((fa) => fa.valve === 0), p.id).toBe(true);
    }
    for (const fa of taps(l).faucets) fa.valve = 0.5;
    l.e.reset();
    expect(taps(l).faucets.every((fa) => fa.valve === 0)).toBe(true);
  });

  it('fill what is under one at its valve’s rate, open, and stop when it is shut', () => {
    const l = lab();
    const fa = taps(l).faucets[0];
    const f = under(l);
    fa.valve = 0.5;
    run(l, 1);
    expect(fa.streaming).toBe(true);
    // what it pours is its one atom, at the valve's rate
    expect(f.n[fa.start.start]).toBe(volume(f));
    expect(volume(f) / faucetRate(0.5)).toBeCloseTo(1, 4);
    expect(fa.flow).toBeCloseTo(faucetRate(0.5) / MAX_FLOW, 4);
    // fully open is the faucets' full rate
    expect(faucetRate(1)).toBe(FILL_RATE);
    fa.valve = 0;
    const had = volume(f);
    run(l, 1);
    expect(volume(f)).toBe(had);
    expect(fa.out).toBeNull();
  });

  it('runs away to the sink with nothing under it, drawn falling to the counter', () => {
    const l = lab();
    const fa = taps(l).faucets[1];
    expect(faucetTarget(taps(l).open, fa.spout)).toBeNull();
    const before = taps(l).flasks.map((f) => f.N);
    fa.valve = 1;
    run(l, 0.5);
    expect(fa.streaming).toBe(true);
    expect(fa.flow).toBeCloseTo(FILL_RATE / MAX_FLOW, 4);
    expect(taps(l).flasks.map((f) => f.N)).toEqual(before);
  });

  it('drips at a low enough setting, in drops, as a tool’s spout does, losing nothing on the way', () => {
    const l = lab();
    const fa = taps(l).faucets[0];
    const f = under(l);
    fa.valve = DRIP_FLOW / FILL_RATE / 3;
    let t = 0;
    let hung = false;
    for (; t < 60 && f.N === 0; t += 0.05) {
      l.in.simulate(0.05);
      expect(fa.streaming).toBe(false);
      hung ||= fa.drop.N > 0;
    }
    expect(hung).toBe(true);
    expect(f.N).toBeGreaterThan(0);
    // all of what it let out is hanging, falling, or in the flask
    const falling = taps(l).falling.reduce((s, d) => s + volume(d.v), 0);
    expect((volume(fa.drop) + falling + volume(f)) / (faucetRate(fa.valve) * t)).toBeCloseTo(1, 1);
  });

  it('runs out of its hose’s nozzle, if it’s out, and not out of its spout', () => {
    const l = lab();
    const fa = taps(l).faucets[0];
    const atSpout = under(l);
    const away = under(l, 2);
    const m = flaskMouth(away);
    taps(l).hoses.push(new Hose({ faucet: 0 }, { x: m.x, y: m.y + 24, z: m.z }, NOZZLE_REACH.min));
    fa.valve = 1;
    run(l, 1);
    expect(atSpout.N).toBe(0);
    expect(away.n[fa.start.start] / faucetRate(1)).toBeCloseTo(1, 4);
  });

  it('load as saved, and a save that doesn’t say loads them all open', () => {
    const l = lab();
    const set = taps(l).faucets.map((_, i) => [0, 0.25, 1][i % 3]);
    taps(l).faucets.forEach((fa, i) => (fa.valve = set[i]));
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    for (const fa of taps(l).faucets) fa.valve = 0.5;
    l.e.restore(s, DEFAULT_PRESET);
    expect(taps(l).faucets.map((fa) => fa.valve)).toEqual(set);
    // a save from before faucets had valves
    for (const f of s.faucets!) delete f.valve;
    l.e.restore(s, DEFAULT_PRESET);
    expect(taps(l).faucets.every((fa) => fa.valve === 1)).toBe(true);
    l.e.restore(bare(), DEFAULT_PRESET);
    expect(taps(l).faucets.every((fa) => fa.valve === 1)).toBe(true);
  });

  it('take a stopcock on the spout, and then let out as far as both are open, at its foot', () => {
    const l = lab();
    const fa = taps(l).faucets[0] as Taps['faucets'][number] & { cock: Cock | null };
    const f = under(l);
    fa.valve = 1;
    expect(l.e.spawn('stopcock')).toBe(true);
    l.in.target = { kind: 'faucet', i: 0, spout: true, point: fa.spout };
    l.in.leftDown(false);
    expect(l.in.held).toBeNull();
    expect(fa.cock).toEqual({ valve: 0 });
    const I = l.in as unknown as { faucetOutlet(i: number): { y: number } };
    expect(I.faucetOutlet(0).y).toBe(fa.spout.y - STOPCOCK.drop);
    run(l, 1);
    expect(f.N).toBe(0);
    fa.cock!.valve = 0.5;
    run(l, 1);
    expect(volume(f) / faucetRate(0.5)).toBeCloseTo(1, 3);
    // with another on its hose's end, as far as both are open
    const nozzle = new Hose({ faucet: 0 }, { x: fa.spout.x, y: fa.spout.y - 40, z: fa.spout.z }, NOZZLE_REACH.min);
    taps(l).hoses.push(nozzle);
    expect(l.e.spawn('stopcock')).toBe(true);
    l.in.target = null;
    lookAt(l, nozzle.outlet);
    l.in.leftDown(false);
    const fe = fa as unknown as { end: Cock | null };
    expect(fe.end).toEqual({ valve: 0 });
    fe.end!.valve = 0.5;
    const was = volume(f);
    run(l, 1);
    expect((volume(f) - was) / faucetRate(0.25)).toBeCloseTo(1, 2);
    const s0 = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    expect([s0.faucets![0].cock, s0.faucets![0].end]).toEqual([{ valve: 0.5 }, { valve: 0.5 }]);
    fe.end = null;
    taps(l).hoses.splice(0);
    fa.valve = 0.5;
    const had = volume(f);
    run(l, 1);
    expect((volume(f) - had) / faucetRate(0.25)).toBeCloseTo(1, 3);
    // its handwheel turns it, and the rest of it takes it off
    l.in.target = { kind: 'faucet', i: 0, cock: true, turns: true };
    expect(l.in.valveAimed()).toEqual({ cock: { m: { faucet: 0 }, nozzle: false } });
    // a save keeps it, and a save from before there were stopcocks has none
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    expect(s.faucets![0].cock).toEqual({ valve: 0.5 });
    l.e.restore(s, DEFAULT_PRESET);
    expect((taps(l).faucets[0] as unknown as { cock: Cock | null }).cock).toEqual({ valve: 0.5 });
    delete s.faucets![0].cock;
    l.e.restore(s, DEFAULT_PRESET);
    expect((taps(l).faucets[0] as unknown as { cock: Cock | null }).cock).toBeNull();
    l.e.restore(JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState, DEFAULT_PRESET);
    l.in.target = { kind: 'faucet', i: 0, cock: true };
    const fb = taps(l).faucets[0] as unknown as { cock: Cock | null };
    fb.cock = { valve: 0.5 };
    l.in.leftDown(false);
    expect(fb.cock).toBeNull();
    expect(l.in.held?.kind).toBe('cock');
    l.in.putBack();
    expect(fb.cock).toEqual({ valve: 0.5 });
  });

  it('take none on the station’s waste spigot, but one on its reservoir’s faucet, which it throttles', () => {
    const l = lab();
    const st = l.in.tools.find((t) => t.kind === 'receptacle')!;
    expect(l.e.spawn('stopcock')).toBe(true);
    l.in.target = { kind: 'tool', t: st, part: 'spout', k: 0, point: spoutTip(st, 0) };
    expect(l.in.placement(l.in.held)).not.toHaveProperty('rest', expect.objectContaining({ cock: expect.objectContaining({ m: { tool: st, spout: 0 } }) }));
    l.in.target = { kind: 'tool', t: st, part: 'spout', k: 1, point: spoutTip(st, 1) };
    l.in.leftDown(false);
    expect(st.cocks).toEqual([null, { valve: 0 }]);
    st.valves[0] = 1;
    const ref = st.tanks[1];
    const was = ref.N;
    st.step(0.1);
    expect(ref.N).toBe(was);
    st.cocks[1]!.valve = 0.5;
    const out = st.step(0.1)[1];
    expect(volume(out!) / (0.5 * REFERENCE_FLOW * 0.1)).toBeCloseTo(1, 4);
  });

  /** Hold Q or E down for `s` real seconds, a frame every `step`, as a press of the key does, and let it go. */
  function hold(l: Lab, code: 'KeyQ' | 'KeyE', s: number, step = 0.02): void {
    l.e.touchKey(code, true);
    for (let i = 0; i < Math.round(s / step); i++) l.in.move(step);
    l.e.touchKey(code, false);
  }
  /** What the engine knows of a valve being turned. */
  const turning = (l: Lab) => (l.in as unknown as { turning: unknown }).turning;

  it('turns by its handwheel with Q and E as a tool’s valve does, from press to let go one step to undo', () => {
    const l = lab();
    const fa = taps(l).faucets[0] as unknown as { valve: number; angle?: number };
    l.e.debug({ x: taps(l).faucets[0].spout.x - 300, z: taps(l).faucets[0].spout.z, yaw: -Math.PI / 2, pitch: 0, locked: true });
    l.in.target = { kind: 'faucet', i: 0, valve: true };
    expect(l.in.valveAimed()).toEqual({ faucet: 0 });
    // the rest of the faucet isn't its valve
    l.in.target = { kind: 'faucet', i: 0 };
    expect(l.in.valveAimed()).toBeNull();
    l.in.target = { kind: 'faucet', i: 0, valve: true };
    // (on the drop, clear of the pipe from the wall above, 3.5 in radius, and the spout's tip, 7 tall, below, on every faucet)
    for (const f of taps(l).faucets) {
      const v = faucetValveAt(f);
      expect(f.wall.y - 3.5 - (v.y + VALVE_WHEEL.r)).toBeGreaterThanOrEqual(2);
      expect(v.y - VALVE_WHEEL.r - (f.spout.y + 7)).toBeGreaterThanOrEqual(2);
    }
    expect(taps(l).history.canUndo).toBe(false);
    expect(fa.valve).toBe(0);
    // a tap of E turns it clockwise a few degrees: still shut (see VALVE_SHUT)
    const shut = settleAngle('valve', fa.angle, fa.valve);
    hold(l, 'KeyE', 0.1);
    const tap = fa.angle! - shut;
    expect(tap).toBeGreaterThan((1 * Math.PI) / 180);
    expect(tap).toBeLessThan((8 * Math.PI) / 180);
    expect(fa.valve).toBe(0);
    expect(turning(l)).toBeNull();
    // (so it's no step to undo: its setting's as it was)
    expect(taps(l).history.canUndo).toBe(false);
    // held, it opens, from press to let go one step to undo
    const tapped = fa.angle!;
    hold(l, 'KeyE', 0.5);
    const first = fa.angle! - tapped;
    expect(fa.valve).toBeGreaterThan(0);
    expect(taps(l).history.canUndo).toBe(true);
    l.e.undo();
    expect(fa.valve).toBe(0);
    expect(taps(l).history.canUndo).toBe(false);
    l.e.undo(true);
    expect(fa.valve).toBeGreaterThan(0);
    // and it speeds up as it's held: held a second, it turns more than twice as far as held half of one
    const mid = fa.angle!;
    hold(l, 'KeyE', 1);
    expect(fa.angle! - mid).toBeGreaterThan(2 * first);
    // Q turns it back the other way
    const was = fa.angle!;
    hold(l, 'KeyQ', 0.3);
    expect(fa.angle!).toBeLessThan(was);
  });

  /** Where valve v's face is, to look at (see the engine's valveFace). */
  const faceOf = (l: Lab, v: unknown) => (l.in as unknown as { valveFace(v: unknown): { at: { x: number; y: number; z: number } } }).valveFace(v).at;
  /** Stand `d` in front of `p`, as lookAt does, the eyes `deg` degrees above it. */
  const lookAbove = (l: Lab, p: { x: number; y: number; z: number }, deg: number, d = 200) =>
    l.e.debug({ x: p.x, z: p.z + d, yaw: 0, pitch: Math.atan2(p.y - 620, d) + (deg * Math.PI) / 180, locked: true });
  /** What Q and E would turn (see the engine's aimedValve). */
  const aimedValve = (l: Lab) => (l.in as unknown as { aimedValve(): unknown }).aimedValve();

  it('turns only from a fresh press, not with both keys, and lets go when it leaves the aim', () => {
    const l = lab();
    const t = new Tool('heater', 99, { x: SPOT.x, y: LIFT + 400, z: SPOT.z, yaw: 0 }, [1]);
    (taps(l) as unknown as { tools: Tool[] }).tools.push(t);
    const tap = faceOf(l, { t, k: 0 });
    // looking well away from it, E does nothing
    l.e.debug({ x: SPOT.x, z: SPOT.z + 300, yaw: 1, pitch: 0, locked: true });
    l.in.target = null;
    l.e.touchKey('KeyE', true);
    l.in.move(0.1);
    expect(turning(l)).toBeNull();
    // E already down as the crosshair comes onto it turns nothing
    lookAt(l, tap);
    l.in.target = { kind: 'tool', t, part: 'valve', k: 0, point: tap } as never;
    l.in.move(0.1);
    expect(t.valves[0]).toBe(1);
    l.e.touchKey('KeyE', false);
    // pressed afresh, it does; with Q down too, it stops
    l.e.touchKey('KeyE', true);
    l.in.move(0.2);
    const a = t.angles[0]!;
    expect(a).toBeGreaterThan(0);
    l.e.touchKey('KeyQ', true);
    l.in.move(0.2);
    expect(t.angles[0]).toBe(a);
    l.e.touchKey('KeyE', false);
    l.in.move(0.2);
    expect(t.angles[0]).toBeLessThan(a);
    // looking away past the aim, it's let go of, Q still down
    l.in.target = null;
    lookAbove(l, tap, AIM.deg + 1);
    l.in.move(0.1);
    expect(turning(l)).toBeNull();
    l.e.touchKey('KeyQ', false);
  });

  it('turns clockwise with E as it’s seen, even from behind, and a dial only to its stops', () => {
    const l = lab();
    const t = new Tool('heater', 99, { x: SPOT.x, y: LIFT + 400, z: SPOT.z, yaw: 0 }, [1]);
    (taps(l) as unknown as { tools: Tool[] }).tools.push(t);
    const tap = faceOf(l, { t, k: 0 });
    l.in.target = { kind: 'tool', t, part: 'valve', k: 0, point: tap } as never;
    // from in front, clockwise is its own clockwise
    lookAt(l, tap);
    hold(l, 'KeyE', 0.2);
    const a = t.angles[0]!;
    expect(a).toBeGreaterThan(0);
    // from behind, it's the other way round
    l.e.debug({ x: tap.x, z: tap.z - 300, yaw: Math.PI, pitch: Math.atan2(tap.y - 620, 300), locked: true });
    hold(l, 'KeyE', 0.2);
    expect(t.angles[0]).toBeCloseTo(0, 9);
    // its dial turns only as far as its stop, however long E's held
    const d = t.shape.dial!;
    lookAt(l, faceOf(l, { t, k: d }));
    l.in.target = { kind: 'tool', t, part: 'valve', k: d, point: tap } as never;
    hold(l, 'KeyE', 4);
    expect(t.valves[d]).toBe(1);
    expect(t.angles[d]).toBeCloseTo(DIAL_STOP, 9);
    hold(l, 'KeyQ', 0.1);
    expect(t.valves[d]).toBeLessThan(1);
  });

  it('turns a stopcock by its handwheel just as a plain valve: E opens it, Q shuts it again, each one step to undo', () => {
    const l = lab();
    const t = new Tool('dispenser', 99, { x: SPOT.x, y: LIFT + 400, z: SPOT.z, yaw: 0 });
    (taps(l) as unknown as { tools: Tool[] }).tools.push(t);
    const c = t.cocks[0]!;
    lookAt(l, faceOf(l, { cock: { m: { tool: t, spout: 0 }, nozzle: false } }));
    // only its handwheel (and the hub it's on) is it, for the crosshair; its collar and barrel are for taking it off
    l.in.target = { kind: 'tool', t, part: 'cock', k: 0, point: spoutAt(t, 0) } as never;
    expect(l.in.valveAimed()).toBeNull();
    l.in.target = { kind: 'tool', t, part: 'cock', k: 0, turns: true, point: spoutAt(t, 0) } as never;
    expect(l.in.valveAimed()).toEqual({ cock: { m: { tool: t, spout: 0 }, nozzle: false } });
    // shut, as it comes; E held turns it open
    expect(c.valve).toBe(0);
    hold(l, 'KeyE', 0.5);
    expect(c.valve).toBeGreaterThan(0.5);
    const open = c.valve;
    // and Q, back shut
    hold(l, 'KeyQ', 0.5);
    expect(c.valve).toBe(0);
    expect(t.cocks[0]).toBe(c);
    l.e.undo();
    expect(t.cocks[0]!.valve).toBeCloseTo(open, 9);
    l.e.undo();
    expect(t.cocks[0]!.valve).toBe(0);
    l.e.undo(true);
    expect(t.cocks[0]!.valve).toBeCloseTo(open, 9);
  });

  it('turns the handwheel within the aim of the crosshair, though it isn’t on it, and none further off', () => {
    const l = lab();
    const t = new Tool('dispenser', 99, { x: SPOT.x, y: LIFT + 400, z: SPOT.z, yaw: 0 });
    (taps(l) as unknown as { tools: Tool[] }).tools.push(t);
    const c = t.cocks[0]!;
    const v = { cock: { m: { tool: t, spout: 0 }, nozzle: false } };
    const at = faceOf(l, v);
    l.in.target = null;
    lookAbove(l, at, AIM.deg + 0.5);
    expect(aimedValve(l)).toBeNull();
    hold(l, 'KeyE', 0.5);
    expect(c.valve).toBe(0);
    lookAbove(l, at, AIM.deg - 0.5);
    expect(aimedValve(l)).toEqual(v);
    hold(l, 'KeyE', 0.5);
    expect(c.valve).toBeGreaterThan(0);
  });

  it('turns none hidden behind something else, unless the crosshair is right on it, and lets go of one that comes to be', () => {
    const l = lab();
    const t = new Tool('dispenser', 99, { x: SPOT.x, y: LIFT + 400, z: SPOT.z, yaw: 0 });
    (taps(l) as unknown as { tools: Tool[] }).tools.push(t);
    const v = { cock: { m: { tool: t, spout: 0 }, nozzle: false } };
    const at = faceOf(l, v);
    const view = (l.in as unknown as { view: { blocked(): boolean } }).view;
    lookAbove(l, at, AIM.deg / 2);
    l.in.target = null;
    expect(aimedValve(l)).toEqual(v);
    view.blocked = () => true;
    expect(aimedValve(l)).toBeNull();
    // right on its handwheel, it's turned all the same
    l.in.target = { kind: 'tool', t, part: 'cock', k: 0, turns: true, point: at } as never;
    expect(aimedValve(l)).toEqual(v);
    // being turned, it's let go of once it's hidden and the crosshair isn't on it
    view.blocked = () => false;
    l.in.target = null;
    l.e.touchKey('KeyE', true);
    l.in.move(0.1);
    expect(turning(l)).not.toBeNull();
    view.blocked = () => true;
    l.in.move(0.1);
    expect(turning(l)).toBeNull();
    l.e.touchKey('KeyE', false);
  });

  it('turns the one fewest degrees off, but the one the crosshair is on first; and keeps turning it till it leaves the aim', () => {
    const l = lab();
    const t = new Tool('heater', 99, { x: SPOT.x, y: LIFT + 400, z: SPOT.z, yaw: 0 }, [1]);
    (taps(l) as unknown as { tools: Tool[] }).tools.push(t);
    const d = t.shape.dial!;
    const [tap, dial] = [faceOf(l, { t, k: 0 }), faceOf(l, { t, k: d })];
    const between = (k: number) => ({ x: tap.x + k * (dial.x - tap.x), y: tap.y + k * (dial.y - tap.y), z: tap.z + k * (dial.z - tap.z) });
    // (with the aim wide enough to take in both)
    const was = AIM.deg;
    AIM.deg = AIM_DEG.max;
    l.in.target = null;
    lookAt(l, between(0.3));
    expect(aimedValve(l)).toEqual({ t, k: 0 });
    lookAt(l, between(0.7));
    expect(aimedValve(l)).toEqual({ t, k: d });
    // the crosshair on the tap, though the dial is nearer
    l.in.target = { kind: 'tool', t, part: 'valve', k: 0, point: tap } as never;
    expect(aimedValve(l)).toEqual({ t, k: 0 });
    // turning the tap, it goes on turning it as the dial comes nearer
    l.in.target = null;
    lookAt(l, between(0.3));
    l.e.touchKey('KeyE', true);
    l.in.move(0.2);
    const a = t.angles[0]!;
    const dialWas = t.valves[d];
    lookAt(l, between(0.7));
    l.in.move(0.2);
    expect(t.angles[0]).toBeGreaterThan(a);
    expect(t.valves[d]).toBe(dialWas);
    AIM.deg = was;
    // and out of the aim, it's let go of
    lookAbove(l, tap, AIM.deg + 1, 300);
    l.in.move(0.1);
    expect(turning(l)).toBeNull();
    l.e.touchKey('KeyE', false);
  });
});

describe('C', () => {
  /** The engine's own things these tests reach into. */
  interface Pulls {
    hoseAim(): { m: unknown; hose: Hose | null; nozzle: boolean } | null;
    hoses: Hose[];
    tools: Tool[];
    faucets: { spout: { x: number; y: number; z: number } }[];
    held: { kind: string; h?: Hose; t?: Tool } | null;
    mountAt(m: unknown): { x: number; y: number; z: number };
    history: { canUndo: boolean };
  }
  const pulls = (l: Lab) => l.in as unknown as Pulls;
  /** The spout or faucet C would take hold of a hose by, or that of the nozzle it would. */
  const aimed = (l: Lab) => pulls(l).hoseAim()?.m ?? null;
  /** A separator on its stand over SPOT, its two spouts a few cells apart, side by side across the view. */
  const separator = (l: Lab) => {
    const t = new Tool('separator', 99, { x: SPOT.x + 2 * CELL, y: LIFT + 400, z: SPOT.z, yaw: 0 });
    pulls(l).tools.push(t);
    return t;
  };

  it('pulls out the hose of the spout nearest the crosshair, and only near enough, in reach', () => {
    const l = lab();
    const t = separator(l);
    const [a, b] = [spoutAt(t, 0), spoutAt(t, 1)];
    // looking a little nearer the second than the first, it's the second's (with the cone wide enough to take in both)
    const was = AIM.deg;
    AIM.deg = AIM_DEG.max;
    lookAt(l, { x: a.x + 0.6 * (b.x - a.x), y: a.y, z: a.z });
    expect(aimed(l)).toEqual({ tool: t, spout: 1 });
    lookAt(l, { x: a.x + 0.4 * (b.x - a.x), y: a.y, z: a.z });
    expect(aimed(l)).toEqual({ tool: t, spout: 0 });
    AIM.deg = was;
    // within the player's setting of the crosshair, in degrees, and no further: looked at from in front, and then
    // that much higher
    const off = (deg: number) => {
      const d = 200;
      l.e.debug({ x: a.x, z: a.z + d, yaw: 0, pitch: Math.atan2(a.y - 620, d) + (deg * Math.PI) / 180, locked: true });
    };
    off(AIM.deg - 0.5);
    expect(aimed(l)).toEqual({ tool: t, spout: 0 });
    off(AIM.deg + 0.5);
    expect(aimed(l)).toBeNull();
    // and not out of reach, however straight at it
    lookAt(l, a, REACH + 20);
    expect(aimed(l)).toBeNull();
    // nor with something in hand
    lookAt(l, a);
    expect(l.e.spawn('flask')).toBe(true);
    expect(aimed(l)).toBeNull();
    l.in.putBack();
    // pulled out, its nozzle's in hand, one step to undo
    expect(pulls(l).history.canUndo).toBe(false);
    l.e.touchHose();
    expect(pulls(l).held?.kind).toBe('hose');
    expect(pulls(l).hoses.map((h) => h.on)).toEqual([{ tool: t, spout: 0 }]);
    hands(l).placeHeld(l.in.held, { ...a, x: a.x - 2 * CELL, y: a.y - 40, yaw: 0 });
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(pulls(l).history.canUndo).toBe(true);
    l.e.undo();
    expect(pulls(l).hoses).toHaveLength(0);
    expect(pulls(l).history.canUndo).toBe(false);
  });

  it('takes hold of a hose that’s out, by its spout or its nozzle, whichever is nearer the crosshair', () => {
    const l = lab();
    const t = separator(l);
    const a = spoutAt(t, 0);
    const nozzle = { x: a.x - 3 * CELL, y: a.y - 20, z: a.z };
    const hose = new Hose({ tool: t, spout: 0 }, nozzle, NOZZLE_REACH.min);
    pulls(l).hoses.push(hose);
    // by its spout, measured to the spout itself, not to where the hose has gone
    expect(pulls(l).mountAt({ tool: t, spout: 0 })).toEqual(a);
    lookAt(l, a);
    expect(pulls(l).hoseAim()).toMatchObject({ m: { tool: t, spout: 0 }, hose, nozzle: false });
    // by its nozzle
    lookAt(l, nozzle);
    expect(pulls(l).hoseAim()).toMatchObject({ m: { tool: t, spout: 0 }, hose, nozzle: true });
    // of the two, the one fewer degrees off (with the cone wide enough to take in both)
    const was = AIM.deg;
    AIM.deg = AIM_DEG.max;
    const between = (k: number) => lookAt(l, { x: a.x + k * (nozzle.x - a.x), y: a.y + k * (nozzle.y - a.y), z: a.z }, 400);
    between(0.3);
    expect(pulls(l).hoseAim()?.nozzle).toBe(false);
    between(0.7);
    expect(pulls(l).hoseAim()?.nozzle).toBe(true);
    AIM.deg = was;
    // C at the spout brings the nozzle to hand from where it was; Q puts it back there, leaving nothing to undo
    lookAt(l, a);
    l.e.touchHose();
    expect(pulls(l).held?.h).toBe(hose);
    expect(pulls(l).hoses).toHaveLength(1);
    l.in.putBack();
    expect(l.in.held).toBeNull();
    expect(hose.outlet).toEqual(nozzle);
    expect(pulls(l).history.canUndo).toBe(false);
    // C at the nozzle takes hold of it there, and set down again, it's a step to undo
    lookAt(l, nozzle);
    l.e.touchHose();
    expect(pulls(l).held?.h).toBe(hose);
    hands(l).placeHeld(l.in.held, { ...nozzle, x: nozzle.x - CELL, yaw: 0 });
    l.in.release();
    expect(l.in.held).toBeNull();
    expect(pulls(l).history.canUndo).toBe(true);
    l.e.undo();
    expect(hose.outlet).toEqual(nozzle);
  });

  it('sets a nozzle in hand down, not the left button, and that with the pull is one step to undo', () => {
    const l = lab();
    const t = separator(l);
    const a = spoutAt(t, 0);
    lookAt(l, a);
    l.e.touchHose();
    expect(pulls(l).held?.kind).toBe('hose');
    const there = { ...a, x: a.x - 2 * CELL, y: a.y - 40, yaw: 0 };
    hands(l).placeHeld(l.in.held, there);
    // the left button sets nothing down
    l.in.target = null;
    l.in.leftDown(false);
    expect(pulls(l).held?.kind).toBe('hose');
    // C does, where the left button used to
    hands(l).placeHeld(l.in.held, there);
    l.e.touchHose();
    expect(l.in.held).toBeNull();
    expect(pulls(l).hoses).toHaveLength(1);
    expect([pulls(l).hoses[0].outlet.x, pulls(l).hoses[0].outlet.z]).toEqual([there.x, there.z]);
    expect(pulls(l).history.canUndo).toBe(true);
    l.e.undo();
    expect(pulls(l).hoses).toHaveLength(0);
    expect(pulls(l).history.canUndo).toBe(false);
  });

  it('passes over what’s hidden behind something else for the next nearest, and takes none if all are', () => {
    const l = lab();
    const t = separator(l);
    const [a, b] = [spoutAt(t, 0), spoutAt(t, 1)];
    const was = AIM.deg;
    AIM.deg = AIM_DEG.max;
    const view = (l.in as unknown as { view: { blocked(from: unknown, to: { x: number }): boolean } }).view;
    lookAt(l, { x: a.x + 0.3 * (b.x - a.x), y: a.y, z: a.z });
    expect(aimed(l)).toEqual({ tool: t, spout: 0 });
    // the nearer hidden, the next nearest
    view.blocked = (_, to) => to.x === a.x;
    expect(aimed(l)).toEqual({ tool: t, spout: 1 });
    // both hidden, none
    view.blocked = () => true;
    expect(aimed(l)).toBeNull();
    l.e.touchHose();
    expect(l.in.held).toBeNull();
    AIM.deg = was;
  });

  it('takes a nozzle whose tip is hidden, down in what it’s docked on, if its top isn’t', () => {
    const l = lab();
    const t = separator(l);
    const a = spoutAt(t, 0);
    lookAt(l, a);
    l.e.touchHose();
    hands(l).placeHeld(l.in.held, { ...a, x: a.x - 2 * CELL, y: a.y - 40, yaw: 0 });
    l.e.touchHose();
    const tip = pulls(l).hoses[0].outlet;
    const view = (l.in as unknown as { view: { blocked(from: unknown, to: { y: number }): boolean } }).view;
    lookAt(l, tip);
    view.blocked = (_, to) => to.y === tip.y;
    expect(pulls(l).hoseAim()?.nozzle).toBe(true);
    view.blocked = () => true;
    expect(pulls(l).hoseAim()).toBeNull();
  });

  it('pulls out a faucet’s hose', () => {
    const l = lab();
    const at = pulls(l).mountAt({ faucet: 0 });
    l.e.debug({ x: at.x - 200, z: at.z, yaw: -Math.PI / 2, pitch: Math.atan2(at.y - 620, 200), locked: true });
    expect(aimed(l)).toEqual({ faucet: 0 });
    l.e.touchHose();
    expect(pulls(l).held?.kind).toBe('hose');
    expect(pulls(l).held?.h?.on).toEqual({ faucet: 0 });
  });

  it('is never the left button: on a spout, that picks the tool up, and pulls nothing out', () => {
    const l = lab();
    const pip = pipetteOver(l);
    lookAt(l, spoutAt(pip, 0));
    l.in.target = { kind: 'tool', t: pip, part: 'spout', k: 0, point: spoutTip(pip, 0) };
    l.in.leftDown(false);
    expect(pulls(l).held?.kind).toBe('tool');
    expect(pulls(l).held?.t).toBe(pip);
    expect(pulls(l).hoses).toHaveLength(0);
    l.in.putBack();
    // and on a faucet's spout, nothing at all
    l.in.target = { kind: 'faucet', i: 0, spout: true };
    l.in.leftDown(false);
    expect(l.in.held).toBeNull();
    expect(pulls(l).hoses).toHaveLength(0);
  });
});

describe('stopcocks', () => {
  /** More of the engine's own things, which these tests reach into. */
  interface Cocks {
    held: { kind: string; c?: Cock; from?: unknown } | null;
    flasks: Flask[];
    hoses: Hose[];
    target: unknown;
  }
  const cocks = (l: Lab) => l.in as unknown as Cocks;
  /** A pipette set down with its spout's tip over the middle of SPOT, `up` above the counter, its stopcock taken off. */
  const bare = (l: Lab, up = 200) => {
    const pip = pipetteOver(l, SPOT.x, SPOT.z, up);
    pip.cocks[0] = null;
    return pip;
  };
  /** Aim at spout j of t, its tip. */
  const atSpout = (l: Lab, t: Tool, j = 0) => (l.in.target = { kind: 'tool', t, part: 'spout', k: j, point: spoutTip(t, j) });
  /** Aim at the stopcock on spout j of t. */
  const atCock = (l: Lab, t: Tool, j = 0) => (l.in.target = { kind: 'tool', t, part: 'cock', k: j, point: spoutTip(t, j) });

  it('come fitted, shut, on the dispenser, the pipette, the big tank and the swell bulbs; every other spout comes bare, and fully open', () => {
    for (const kind of Object.keys(SHAPES) as Tool['kind'][]) {
      const t = new Tool(kind, 0);
      const fitted = ['dispenser', 'pipette', 'tank', 'dilatometer'].includes(kind);
      expect(t.cocks.length, kind).toBe(t.shape.spouts.length);
      for (const c of t.cocks) expect(c, kind).toEqual(fitted ? { valve: 0 } : null);
      t.shape.spouts.forEach((_, j) => expect(t.open(j), kind).toBe(fitted ? 0 : 1));
    }
  });

  it('go on a bare spout from the wheel, out of their own compartment, and come off again into the hand', () => {
    const l = lab();
    const pip = bare(l);
    const tip = spoutTip(pip, 0);
    expect(spoutAt(pip, 0)).toEqual(tip);
    const n = l.in.stock.stopcock.filter(Boolean).length;
    expect(WHEELS[0]).toContain('stopcock');
    expect(l.e.spawn('stopcock')).toBe(true);
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(n - 1);
    // away from any spout it goes nowhere, and says so
    l.in.target = null;
    l.e.debug({ x: SPOT.x, z: SPOT.z + 400, yaw: Math.PI, pitch: 0 });
    l.in.release();
    expect(l.in.flash?.text).toBe('Put it on a spout');
    expect(cocks(l).held?.kind).toBe('cock');
    // aimed at the spout, it goes on, shut, and what leaves the spout leaves its foot, STOPCOCK.drop lower
    atSpout(l, pip);
    l.in.leftDown(false);
    expect(cocks(l).held).toBeNull();
    expect(pip.cocks[0]).toEqual({ valve: 0 });
    expect(spoutAt(pip, 0)).toEqual({ ...tip, y: tip.y - STOPCOCK.drop });
    pip.tanks[0].setMolecules(singleOf('R'), CAP / 20);
    run(l, 1);
    expect(pip.tanks[0].N).toBe(CAP / 20);
    // taken off, the spout's open again, and Q puts it back as it was
    atCock(l, pip);
    l.in.leftDown(false);
    expect(cocks(l).held?.c).toEqual({ valve: 0 });
    expect(pip.cocks[0]).toBeNull();
    l.in.putBack();
    expect(pip.cocks[0]).toEqual({ valve: 0 });
    // taken off and put away, it's back in its compartment
    atCock(l, pip);
    l.in.leftDown(false);
    l.in.putAway();
    expect(pip.cocks[0]).toBeNull();
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(n);
    // each was one step to undo
    l.e.undo();
    expect(pip.cocks[0]).toEqual({ valve: 0 });
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(n - 1);
  });

  it('go on only where there is room for one, and only one to a spout', () => {
    const l = lab();
    // a flask's mouth right under the spout's tip
    const pip = bare(l, FLASK_H + 15);
    const f = setAtFlask(l, spoutTip(pip, 0));
    expect(f.pose.y).toBeCloseTo(LIFT + FLASK_H, 6);
    expect(l.e.spawn('stopcock')).toBe(true);
    atSpout(l, pip);
    expect(l.in.placement(l.in.held)).toEqual({ why: 'No room for a stopcock there' });
    l.in.leftDown(false);
    expect(l.in.flash?.text).toBe('No room for a stopcock there');
    expect(pip.cocks[0]).toBeNull();
    l.in.putAway();
    // one with one on it already takes no other
    const d = new Tool('dispenser', 98, { x: SPOT.x + 3 * CELL, y: LIFT + 400, z: SPOT.z, yaw: 0 });
    l.in.tools.push(d);
    expect(l.e.spawn('stopcock')).toBe(true);
    atSpout(l, d);
    expect('why' in l.in.placement(l.in.held)).toBe(true);
  });

  it('are part of what they are on, in its way and it in theirs', () => {
    const d = new Tool('dispenser', 0, { x: 500, y: LIFT + 400, z: 500, yaw: 0 });
    const tip = spoutTip(d, 0);
    const b = toolBox(d);
    expect(b.y - b.hy).toBeCloseTo(tip.y - STOPCOCK.drop, 6);
    // a flask's mouth a little under the spout's own tip, but above its stopcock's foot
    const f = { ...flaskMouth({ pose: { x: tip.x, y: tip.y - STOPCOCK.drop + 5, z: tip.z, yaw: 0 } } as Flask) };
    const box = { x: f.x, y: f.y - FLASK_H / 2, z: f.z, yaw: 0, hx: FLASK_R, hy: FLASK_H / 2, hz: FLASK_R, round: true };
    expect(boxesOverlap(box, b)).toBe(true);
    d.cocks[0] = null;
    expect(boxesOverlap(box, toolBox(d))).toBe(false);
  });

  it('come and go with what they are fitted on, not out of their own compartment', () => {
    const l = lab();
    const n = l.in.stock.stopcock.filter(Boolean).length;
    expect(l.e.spawn('dispenser')).toBe(true);
    const d = l.in.held!.t!;
    expect(d.cocks).toEqual([{ valve: 0 }]);
    l.in.putAway();
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(n);
    // a loose one put away with its compartment full is just gone
    expect(l.e.spawn('stopcock')).toBe(true);
    l.in.stock.stopcock.fill(true);
    l.in.putAway();
    expect(cocks(l).held).toBeNull();
    expect(l.in.stock.stopcock.every(Boolean)).toBe(true);
  });

  it('are kept by a save, and one in hand as put back; a save from before them fits them as its valves were', () => {
    const l = lab();
    const pip = bare(l);
    pip.cocks[0] = { valve: 0.3 };
    atCock(l, pip);
    l.in.leftDown(false);
    expect(pip.cocks[0]).toBeNull();
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const saved = s.tools.find((t) => t.id === pip.id)!;
    expect(saved.cocks).toEqual([{ valve: 0.3 }]);
    l.e.restore(s, DEFAULT_PRESET);
    expect(l.in.tools.find((t) => t.id === pip.id)!.cocks).toEqual([{ valve: 0.3 }]);
    // none saved on it: none
    saved.cocks = [null];
    l.e.restore(s, DEFAULT_PRESET);
    expect(l.in.tools.find((t) => t.id === pip.id)!.cocks).toEqual([null]);
    // from before stopcocks: a separator's one valve on both its spouts, swell bulbs' each on its own, their dial kept
    const old = (kind: Tool['kind'], id: number, valves: number[]) =>
      ({ kind, id, fx: 0.5, fy: 0.3, z: 750, valves, tanks: [], drops: [] }) as SaveState['tools'][number];
    s.tools.push(old('separator', 950, [0.3]), old('dilatometer', 951, [0.2, 0.7, 0.4]), old('multiplexer', 952, [0.8]), old('meter', 953, []));
    for (const t of s.tools) if (t.id === pip.id) Object.assign(t, { valves: [0.3], cocks: undefined });
    l.e.restore(s, DEFAULT_PRESET);
    const by = (id: number) => l.in.tools.find((t) => t.id === id)!;
    expect(by(950).cocks).toEqual([{ valve: 0.3 }, { valve: 0.3 }]);
    expect(by(950).valves).toEqual([]);
    expect(by(951).cocks).toEqual([{ valve: 0.2 }, { valve: 0.7 }]);
    expect(by(951).valves).toEqual([0.4]);
    expect(by(952).cocks).toEqual([null]);
    expect(by(952).valves).toEqual([0.8]);
    expect(by(953).cocks).toEqual([null]);
    expect(by(pip.id).cocks).toEqual([{ valve: 0.3 }]);
  });

  it('are fitted by the demos where their valves used to be set', () => {
    const l = lab();
    l.e.load(PRESETS.find((p) => p.id === 'exchanger')!);
    const ts = l.in.tools.filter((t) => t.kind === 'dispenser' || t.kind === 'exchanger');
    expect(ts.flatMap((t) => t.cocks.map((c) => c?.valve))).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('go on the end of a hose, under its nozzle, which then lets out at their foot, and up to the spout as it rolls up', () => {
    const l = lab();
    const pip = bare(l);
    const tip = spoutTip(pip, 0);
    // a spout's stopcock stays at its tip as the hose is pulled out, and the hose runs from its foot
    pip.cocks[0] = { valve: 1 };
    lookAt(l, spoutAt(pip, 0));
    l.e.touchHose();
    expect(cocks(l).held?.kind).toBe('hose');
    const hose = cocks(l).hoses[0];
    const I = l.in as unknown as { mountAt(m: unknown): unknown; outletAt(t: Tool, j: number): { x: number; y: number; z: number } };
    expect(I.mountAt(hose.on)).toEqual({ ...tip, y: tip.y - STOPCOCK.drop });
    l.in.putBack();
    expect(cocks(l).hoses).toHaveLength(0);
    // with the hose's nozzle set down out to one side, a stopcock goes on under it, pointed at
    pip.cocks[0] = null;
    const nozzle = new Hose({ tool: pip, spout: 0 }, { x: tip.x + 2 * CELL, y: tip.y, z: tip.z }, NOZZLE_REACH.min);
    cocks(l).hoses.push(nozzle);
    expect(l.e.spawn('stopcock')).toBe(true);
    l.in.target = null;
    lookAt(l, nozzle.outlet);
    l.in.leftDown(false);
    expect(cocks(l).held).toBeNull();
    expect([pip.cocks[0], pip.ends[0]]).toEqual([null, { valve: 0 }]);
    // the hose still runs from the spout's bare tip, and what it lets out leaves the stopcock's foot
    expect(I.mountAt(nozzle.on)).toEqual(tip);
    expect(I.outletAt(pip, 0)).toEqual({ ...nozzle.outlet, y: nozzle.outlet.y - STOPCOCK.drop });
    expect(spoutAt(pip, 0)).toEqual(tip);
    pip.tanks[0].setMolecules(singleOf('R'), CAP / 20);
    run(l, 1);
    expect(pip.tanks[0].N).toBe(CAP / 20);
    // it's turned, and taken off, there just as at a tip
    l.in.target = { kind: 'hose', h: nozzle, cock: true, turns: true, point: nozzle.outlet };
    expect(l.in.valveAimed()).toEqual({ cock: { m: { tool: pip, spout: 0 }, nozzle: true } });
    l.in.target = { kind: 'hose', h: nozzle, cock: true, point: nozzle.outlet };
    l.in.leftDown(false);
    expect(pip.ends[0]).toBeNull();
    l.in.putBack();
    expect(pip.ends[0]).toEqual({ valve: 0 });
    // the hose rolled up, the stopcock goes up to the spout's tip, which has none
    l.in.target = null;
    lookAt(l, nozzle.outlet);
    l.e.touchHose();
    expect(cocks(l).held?.kind).toBe('hose');
    l.in.putAway();
    expect(cocks(l).hoses).toHaveLength(0);
    expect([pip.cocks[0], pip.ends[0]]).toEqual([{ valve: 0 }, null]);
    expect(I.outletAt(pip, 0)).toEqual({ ...tip, y: tip.y - STOPCOCK.drop });
  });

  it('go one at a spout’s tip and one on its hose’s end, each on its own, and let it out as far as both are open', () => {
    const l = lab();
    const pip = bare(l);
    const tip = spoutTip(pip, 0);
    const I = l.in as unknown as { mountAt(m: unknown): unknown; outletAt(t: Tool, j: number): { x: number; y: number; z: number }; valveAimed(): unknown };
    pip.cocks[0] = { valve: 0.5 };
    const nozzle = new Hose({ tool: pip, spout: 0 }, { x: tip.x + 2 * CELL, y: tip.y, z: tip.z }, NOZZLE_REACH.min);
    cocks(l).hoses.push(nozzle);
    // the tip's taken, but the hose's end is free: aimed at the nozzle, the second goes on there
    expect(l.e.spawn('stopcock')).toBe(true);
    atSpout(l, pip);
    expect('why' in l.in.placement(l.in.held)).toBe(true);
    l.in.target = null;
    lookAt(l, nozzle.outlet);
    l.in.leftDown(false);
    expect(cocks(l).held).toBeNull();
    expect([pip.cocks[0], pip.ends[0]]).toEqual([{ valve: 0.5 }, { valve: 0 }]);
    // the hose runs from the tip's stopcock's foot, and lets out at the end's
    expect(I.mountAt(nozzle.on)).toEqual({ ...tip, y: tip.y - STOPCOCK.drop });
    expect(I.outletAt(pip, 0)).toEqual({ ...nozzle.outlet, y: nozzle.outlet.y - STOPCOCK.drop });
    // the two multiply
    pip.ends[0]!.valve = 0.4;
    expect(pip.open(0)).toBeCloseTo(0.2, 12);
    // each is turned, and taken off, by itself
    l.in.target = { kind: 'tool', t: pip, part: 'cock', k: 0, turns: true, point: tip };
    expect(l.in.valveAimed()).toEqual({ cock: { m: { tool: pip, spout: 0 }, nozzle: false } });
    l.in.target = { kind: 'hose', h: nozzle, cock: true, turns: true, point: nozzle.outlet };
    expect(l.in.valveAimed()).toEqual({ cock: { m: { tool: pip, spout: 0 }, nozzle: true } });
    l.in.target = { kind: 'tool', t: pip, part: 'cock', k: 0, point: tip };
    l.in.leftDown(false);
    expect([pip.cocks[0], pip.ends[0]]).toEqual([null, { valve: 0.4 }]);
    l.in.putBack();
    expect([pip.cocks[0], pip.ends[0]]).toEqual([{ valve: 0.5 }, { valve: 0.4 }]);
    // a save keeps both, and loads them back
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const saved = s.tools.find((t) => t.id === pip.id)!;
    expect([saved.cocks, saved.ends]).toEqual([[{ valve: 0.5 }], [{ valve: 0.4 }]]);
    l.e.restore(s, DEFAULT_PRESET);
    const again = l.in.tools.find((t) => t.id === pip.id)!;
    expect([again.cocks, again.ends]).toEqual([[{ valve: 0.5 }], [{ valve: 0.4 }]]);
    // one on a hose's end with no hose, the tip taken, goes back in the cabinet
    const n = l.in.stock.stopcock.filter(Boolean).length;
    s.hoses = [];
    l.e.restore(s, DEFAULT_PRESET);
    const bare2 = l.in.tools.find((t) => t.id === pip.id)!;
    expect([bare2.cocks, bare2.ends]).toEqual([[{ valve: 0.5 }], [null]]);
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(Math.min(STOCK.stopcock, n + 1));
  });

  it('load as one on the end of a hose, if it is there, from a save from when a spout had only one, said by `nozzle`', () => {
    const l = lab();
    const pip = bare(l);
    const tip = spoutTip(pip, 0);
    cocks(l).hoses.push(new Hose({ tool: pip, spout: 0 }, { x: tip.x + 2 * CELL, y: tip.y, z: tip.z }, NOZZLE_REACH.min));
    const s = JSON.parse(JSON.stringify(l.e.snapshot())) as SaveState;
    const saved = s.tools.find((t) => t.id === pip.id)!;
    saved.cocks = [{ valve: 0.3, nozzle: true }];
    delete saved.ends;
    l.e.restore(s, DEFAULT_PRESET);
    let t = l.in.tools.find((u) => u.id === pip.id)!;
    expect([t.cocks, t.ends]).toEqual([[null], [{ valve: 0.3 }]]);
    // and with no hose, at the tip
    s.hoses = [];
    l.e.restore(s, DEFAULT_PRESET);
    t = l.in.tools.find((u) => u.id === pip.id)!;
    expect([t.cocks, t.ends]).toEqual([[{ valve: 0.3 }], [null]]);
  });

  it('rolled up on its hose with one at the tip already, the end one comes into her hand, and one undo puts both back', () => {
    const l = lab();
    const pip = bare(l);
    const tip = spoutTip(pip, 0);
    pip.cocks[0] = { valve: 0.5 };
    const nozzle = new Hose({ tool: pip, spout: 0 }, { x: tip.x + 2 * CELL, y: tip.y, z: tip.z }, NOZZLE_REACH.min);
    cocks(l).hoses.push(nozzle);
    pip.ends[0] = { valve: 0.7 };
    // (with a place for it in its compartment)
    l.in.stock.stopcock.fill(false, 8);
    l.in.target = null;
    lookAt(l, nozzle.outlet);
    l.e.touchHose();
    expect(cocks(l).held?.kind).toBe('hose');
    l.in.putAway();
    expect(cocks(l).hoses).toHaveLength(0);
    expect([pip.cocks[0], pip.ends[0]]).toEqual([{ valve: 0.5 }, null]);
    // in hand, as one fresh from the cabinet, set as it was: Q puts it in the cabinet
    expect(cocks(l).held?.kind).toBe('cock');
    expect(cocks(l).held?.c).toEqual({ valve: 0.7 });
    expect(cocks(l).held?.from).toBeUndefined();
    const n = l.in.stock.stopcock.filter(Boolean).length;
    l.in.putBack();
    expect(cocks(l).held).toBeNull();
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(n + 1);
    // one undo: the hose out, with its stopcock on its end, and the cabinet as it was
    l.e.undo();
    expect(cocks(l).hoses).toEqual([nozzle]);
    expect([pip.cocks[0], pip.ends[0]]).toEqual([{ valve: 0.5 }, { valve: 0.7 }]);
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(n);
  });

  it('go with a tool put away, both of them; and through the changeover, an end one with the tip taken goes in the cabinet', () => {
    const l = lab();
    const pip = bare(l);
    const tip = spoutTip(pip, 0);
    pip.cocks[0] = { valve: 0.5 };
    pip.ends[0] = { valve: 0.7 };
    cocks(l).hoses.push(new Hose({ tool: pip, spout: 0 }, { x: tip.x + 2 * CELL, y: tip.y, z: tip.z }, NOZZLE_REACH.min));
    l.in.stock.stopcock.fill(false, 8);
    const n = l.in.stock.stopcock.filter(Boolean).length;
    l.in.target = { kind: 'tool', t: pip, part: 'body', k: 0, point: tip };
    l.in.grabOrRelease(false);
    l.in.putAway();
    expect(l.in.tools).not.toContain(pip);
    expect(cocks(l).hoses).toHaveLength(0);
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(n);
    // the station: one at its faucet's tip, one on its hose's end
    const st = l.in.tools.find((t) => t.kind === 'receptacle')!;
    const ft = spoutTip(st, 1);
    st.cocks[1] = { valve: 1 };
    st.ends[1] = { valve: 1 };
    cocks(l).hoses.push(new Hose({ tool: st, spout: 1 }, { x: ft.x - 100, y: ft.y, z: ft.z }, NOZZLE_REACH.min));
    st.swap = 0;
    l.in.simulate(0.02);
    expect(cocks(l).hoses).toHaveLength(0);
    expect([st.cocks[1], st.ends[1]]).toEqual([{ valve: 1 }, null]);
    expect(l.in.stock.stopcock.filter(Boolean)).toHaveLength(n + 1);
  });

  it('go on no nozzle docked on an instrument’s tube; and one docking with a stopcock on its end sends it to the spout', () => {
    const l = lab();
    const pip = bare(l);
    const meter = new Tool('meter', 97, { x: SPOT.x + 4 * CELL, y: LIFT + 300, z: SPOT.z, yaw: 0 });
    l.in.tools.push(meter);
    const top = tankMouth(meter, 0);
    const nozzle = new Hose({ tool: pip, spout: 0 }, { x: top.x, y: top.y + 1, z: top.z }, NOZZLE_REACH.min);
    cocks(l).hoses.push(nozzle);
    expect(l.e.spawn('stopcock')).toBe(true);
    l.in.target = null;
    lookAt(l, nozzle.outlet);
    expect(l.in.placement(l.in.held)).toEqual({ why: 'No room for a stopcock there' });
    l.in.putAway();
    // a nozzle with one on its end, taken up and docked, leaves it at the spout's tip
    nozzle.outlet = { x: top.x + CELL, y: top.y + 60, z: top.z };
    pip.ends[0] = { valve: 0.5 };
    l.in.target = null;
    lookAt(l, nozzle.outlet);
    l.e.touchHose();
    expect(cocks(l).held?.kind).toBe('hose');
    const I = l.in as unknown as { snapped(h: unknown, p: unknown): { y: number }; setDown(h: unknown, r: unknown): void };
    const over = { x: top.x, y: top.y + 40, z: top.z, yaw: 0 };
    expect(I.snapped(l.in.held, over).y).toBe(top.y + 1);
    // but not with one at the tip already
    pip.cocks[0] = { valve: 1 };
    expect(I.snapped(l.in.held, over).y).toBe(over.y);
    pip.cocks[0] = null;
    I.setDown(l.in.held, { pose: { x: top.x, y: top.y + 1, z: top.z, yaw: 0 }, hose: { turn: 0, reach: NOZZLE_REACH.min } });
    expect([pip.cocks[0], pip.ends[0]]).toEqual([{ valve: 0.5 }, null]);
  });

  /** A flask set down with its mouth just under p. */
  function setAtFlask(l: Lab, p: { x: number; y: number; z: number }): Flask {
    holdAt(l, 'flask', { x: p.x, y: LIFT + 150, z: p.z, yaw: 0 });
    const f = cocks(l).held!.kind === 'flask' ? (l.in.held!.f as Flask) : null;
    l.in.release();
    return f!;
  }
});
