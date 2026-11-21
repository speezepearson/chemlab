import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReactionNetwork } from '../chem/reactions';
import { testChemParams } from '../chem/testChem';
import { SOLVENT_SPECIES, pairOf, singleOf } from '../chem/species';
import { FAUCET_Y, FLASK_R, SHEET_SLOT, inSlot, paperFace, spoutAt, tankMouth, toolBox } from './bodies';
import { STOCK } from './cabinet';
import { CAP, TRACE } from './config';
import type { GameEngine } from './engine';
import { FAUCET_X } from './faucets';
import { Vessel, volume, type Flask } from './flask';
import { FLASK_H } from './flaskShape';
import { BEFORE_LEFT, DEFAULT_PRESET, LAMP_POSE } from './presets';
import type { SaveState } from './save';
import { CATCH_REST_S } from './still';
import { LIFT, PLANE_Z, toFrac, type Pose } from './space';
import { DRIP, PAPER_TAU, SHAPES, SHEET, TEST_PAPER, Tool, lampShot, paperReading, type Blotter, type Hose } from './tools';
import { WHEELS } from './wheel';

/*
 * The engine itself, with nothing to draw on and nothing to hear: the view and the sounds are stood in for, as they
 * are in the headless benchmark (see bench/), along with the few things of a browser's that it reaches for.
 */

vi.mock('./view', () => ({
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
  flasks: Flask[];
  hoses: { on: { tool?: Tool; faucet?: number } }[];
  held: { kind: string; t?: Tool; f?: Flask } | null;
  placed: unknown;
  target: unknown;
  still: { x: number; y: number; s: number } | null;
  stock: Record<string, boolean[]>;
  flash: { text: string } | null;
  wake: string;
  nextToolId: number;
  faucetFlows: { m: { v: unknown } }[];
  smelled: { script: { text: string }[] } | null;
  sniffing: { when: number } | null;
  takeOut(kind: string, slot: number): void;
  placeHeld(h: unknown, p: Pose): void;
  placement(h: unknown, p: Pose): { pose: Pose; rest: { pose: Pose } | null; why: string | null };
  release(): void;
  putAway(): void;
  carry(dt?: number): void;
  leftDown(shift: boolean): void;
  simulate(dt: number, quiet?: boolean): void;
  sleeper(): { skip(dt: number): void };
  grabbable(p: unknown): boolean;
  sniff(): void;
  stepSniff(now: number): void;
  pointer: { x: number; y: number } | null;
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

type Lab = { e: GameEngine; in: Inside };

/** A lab with nothing drawn, out of the pod, and what's inside it. */
function lab(save?: SaveState): Lab {
  const canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const stage = { clientWidth: 1280, clientHeight: 720 } as unknown as HTMLElement;
  const cb = { onInspect() {}, onEdit() {}, onLabel() {}, onHud() {}, onAwake() {} };
  const e = new Engine(canvas, stage, new ReactionNetwork(testChemParams()), cb);
  engines.push(e);
  const l = { e, in: e as unknown as Inside };
  if (save) e.restore(save, DEFAULT_PRESET);
  l.in.wake = 'closed';
  return l;
}

/** The least a save can be: a lab on the wall with nothing in it. */
const bare = (): SaveState => ({ v: 1, wall: true, preset: DEFAULT_PRESET.id, flasks: [], tools: [], scales: [], hoses: [] });

/** Take one of a kind out of the cabinet, and leave it at a pose (its top middle, for a tool, or a flask's mouth). */
function put(l: Lab, kind: string, p: Pose): Tool | Flask {
  l.in.takeOut(kind, l.in.stock[kind].lastIndexOf(true));
  const h = l.in.held!;
  const it = (h.t ?? h.f)!;
  l.in.placeHeld(h, p);
  l.in.placed = l.in.placement(h, p);
  l.in.release();
  expect(l.in.held, `${kind}: ${l.in.flash?.text}`).toBeNull();
  return it;
}

/** Take one of a kind out of the cabinet and hold it at a pose. */
function holdAt(l: Lab, kind: string, p: Pose): Tool | Flask {
  l.in.takeOut(kind, l.in.stock[kind].lastIndexOf(true));
  const h = l.in.held!;
  l.in.placeHeld(h, p);
  return (h.t ?? h.f)!;
}

const at = (x: number, y: number): Pose => ({ x, y, z: PLANE_Z, yaw: 0 });

/** Run the lab for `s` sim seconds. */
const run = (l: Lab, s: number) => {
  for (let i = 0; i < Math.round(s / 0.05); i++) l.in.simulate(0.05);
};

/** The first faucet's spout, across the wall, and a flask standing on the counter right under it. */
const FX = FAUCET_X[0];
const underFaucet = (l: Lab) => put(l, 'flask', at(FX, LIFT + FLASK_H)) as Flask;
/** A sheet of blotting paper pinned between the first faucet's spout and a flask under it. */
const inStream = (l: Lab, kind: 'testpaper' | 'bondpaper' = 'testpaper') => put(l, kind, at(FX, FAUCET_Y - 5)) as Tool;

const R = singleOf('R');

/** A vessel of so many molecules of one species. */
function of(s: number, molecules: number): Vessel {
  const v = new Vessel(Infinity);
  v.setMolecules(s, molecules);
  return v;
}

describe('sheets of blotting paper on the wall', () => {
  it('come out of the cabinet as often as wanted, and are thrown away when put away', () => {
    const l = lab(bare());
    for (const kind of ['testpaper', 'bondpaper'])
      for (let i = 0; i < STOCK[kind as 'testpaper'] + 3; i++) {
        l.in.takeOut(kind, STOCK[kind as 'testpaper'] - 1);
        expect(l.in.held?.t?.kind).toBe(kind);
        l.in.putAway();
        expect(l.in.held).toBeNull();
      }
    expect(l.in.tools.some((t) => t.kind === 'testpaper' || t.kind === 'bondpaper')).toBe(false);
  });

  it('are pinned to the wall wherever they are let go of, in front of nothing but another sheet', () => {
    const l = lab(bare());
    // anywhere on the bench, high on the wall too: nothing holds it up
    const high = put(l, 'testpaper', at(3000, 1100)) as Tool;
    expect([high.pose.x, high.pose.y]).toEqual([3000, 1100]);
    // behind a flask, a tool and a hose's nozzle, as if they weren't there
    put(l, 'flask', at(3500, LIFT + FLASK_H));
    put(l, 'dispenser', at(3700, 800));
    const behind = put(l, 'bondpaper', at(3500, LIFT + 80)) as Tool;
    expect([behind.pose.x, behind.pose.y]).toEqual([3500, LIFT + 80]);
    put(l, 'testpaper', at(3700, 760));
    // but not over another sheet
    holdAt(l, 'testpaper', at(3520, LIFT + 90));
    expect(l.in.placement(l.in.held, at(3520, LIFT + 90)).why).toBe('No room');
    l.in.putAway();
    // and something set down in front of one stands there as if it weren't
    const f = put(l, 'flask', at(3000, 1100 - 2)) as Flask;
    expect(f.pose.y).toBe(1100 - 2);
  });
});

describe('a stream past a sheet of blotting paper', () => {
  it("is just as it would be if the sheet weren't there: it runs on into the flask under it, which fills as fast", () => {
    const plain = lab(bare());
    const fp = underFaucet(plain);
    const papered = lab(bare());
    const fs = underFaucet(papered);
    const sheet = inStream(papered);
    run(plain, 0.3);
    run(papered, 0.3);
    // the faucet runs for the flask, not the sheet, and lands in it
    expect(papered.in.faucetFlows.map((x) => x.m.v)).toEqual([fs]);
    expect(volume(fp)).toBeGreaterThan(0);
    // (to within a molecule a substep, which is how fluid's rounded as it moves)
    expect(Math.abs(volume(fs) - volume(fp))).toBeLessThanOrEqual(20);
    expect(volume(paperFace(sheet) && sheet.paper[0])).toBeGreaterThan(0);
  });

  it('wets the sheet: it takes a copy of what passes, as much as it has room for, and holds it', () => {
    const l = lab(bare());
    underFaucet(l);
    const sheet = inStream(l);
    const paper = sheet.paper[0] as Blotter;
    run(l, 0.05);
    expect(volume(paper)).toBeGreaterThan(0);
    run(l, 2);
    expect(volume(paper)).toBeCloseTo(TEST_PAPER.cap, -3);
    expect(paper.soaked).toBe(true);
    // all of it what the faucet lets out, R
    expect(paperReading(paper)[0][0]).toBeCloseTo(1, 3);
    const was = [...paper.n];
    run(l, 1);
    expect([...paper.n]).toEqual(was);
  });

  it('leaves a sheet beside it, or above where it comes out, dry', () => {
    const l = lab(bare());
    underFaucet(l);
    const beside = put(l, 'testpaper', at(FX + TEST_PAPER.w / 2 + 2, FAUCET_Y - 5)) as Tool;
    const above = put(l, 'testpaper', at(FX - 10, FAUCET_Y + 130)) as Tool;
    run(l, 1);
    expect(beside.paper[0].N).toBe(0);
    expect(above.paper[0].N).toBe(0);
  });

  it("doesn't wet a sheet in hand until it's been held still a while, so one swept through it stays clean", () => {
    const l = lab(bare());
    underFaucet(l);
    const sheet = holdAt(l, 'testpaper', at(FX, FAUCET_Y - 5)) as Tool;
    // just taken in hand, it's moving
    l.in.carry(0);
    expect(l.in.still?.s).toBe(0);
    run(l, 0.4);
    expect(sheet.paper[0].N).toBe(0);
    // held still a little while, not yet long enough
    l.in.carry(CATCH_REST_S / 2);
    run(l, 0.4);
    expect(sheet.paper[0].N).toBe(0);
    // long enough
    l.in.carry(CATCH_REST_S / 2);
    run(l, 0.1);
    expect(sheet.paper[0].N).toBeGreaterThan(0);
  });

  it('is wetted on sim time: paused, nothing reaches it', () => {
    const l = lab(bare());
    underFaucet(l);
    const sheet = inStream(l);
    for (let i = 0; i < 20; i++) l.in.simulate(0);
    expect(sheet.paper[0].N).toBe(0);
  });

  it("takes a copy of a falling drop, which falls on whole into what's below", () => {
    const l = lab(bare());
    const f = put(l, 'flask', at(4000, LIFT + FLASK_H)) as Flask;
    const pip = put(l, 'pipette', at(4000, LIFT + 280)) as Tool;
    const sheet = put(l, 'testpaper', at(4000, LIFT + 160)) as Tool;
    const RG = pairOf('R', 'G');
    pip.tanks[0].setMolecules(RG, (4 * DRIP.atoms) / 2);
    pip.valves[0] = 0.2;
    const had = volume(pip.tanks[0]);
    run(l, 1);
    // (it drips: what leaves it gathers in a drop that falls, rather than streaming)
    expect(pip.streaming[0]).toBe(false);
    run(l, 29);
    // drops have fallen, and every one of them reached the flask whole
    const fell = had - volume(pip.tanks[0]) - volume(pip.drops[0]);
    expect(fell).toBeGreaterThan(0);
    expect(Math.abs(volume(f) - fell)).toBeLessThanOrEqual(DRIP.atoms);
    // and the sheet has a copy of some, as much as it has room for
    expect(sheet.paper[0].n[RG]).toBeGreaterThan(0);
    expect(volume(sheet.paper[0])).toBeLessThanOrEqual(TEST_PAPER.cap);
  });

  it('wets a sheet of bond paper the same way, its lines coming up by what it holds', () => {
    const l = lab(bare());
    underFaucet(l);
    const sheet = inStream(l, 'bondpaper');
    run(l, 0.1);
    expect(sheet.paper[0].N).toBeGreaterThan(0);
    // R alone has no bonds: it's wet, and its lines are as faint as they were
    run(l, 3);
    expect(sheet.showing[0]).toBeCloseTo(1, 2);
    expect(sheet.showing.slice(1).every((x) => x === 0)).toBe(true);
  });
});

describe('what a sheet of blotting paper shows', () => {
  it('comes up on sim time, over a couple of seconds, not at once, and not while paused', () => {
    const l = lab(bare());
    const sheet = put(l, 'testpaper', at(4000, 700)) as Tool;
    sheet.paper[0].addFrom(of(R, TEST_PAPER.cap), TEST_PAPER.cap, true);
    for (let i = 0; i < 10; i++) l.in.simulate(0);
    expect(sheet.showing[1]).toBe(0);
    run(l, PAPER_TAU);
    expect(sheet.showing[1]).toBeGreaterThan(0.5);
    expect(sheet.showing[1]).toBeLessThan(0.8);
    run(l, 4);
    expect(sheet.showing[1]).toBeCloseTo(1, 3);
  });

  it('goes on coming up through a sleep that skips ahead', () => {
    const l = lab(bare());
    const sheet = put(l, 'testpaper', at(4000, 700)) as Tool;
    sheet.paper[0].addFrom(of(R, TEST_PAPER.cap), TEST_PAPER.cap, true);
    l.in.sleeper().skip(10);
    expect(sheet.showing[1]).toBeCloseTo(1, 3);
  });

  it('is saved with what the sheet holds and where it hangs, and loads so', () => {
    const l = lab(bare());
    const sheet = put(l, 'bondpaper', at(4000, 700)) as Tool;
    const RG = pairOf('R', 'G');
    sheet.paper[0].addFrom(of(RG, TEST_PAPER.cap / 2), TEST_PAPER.cap / 2, true);
    run(l, 0.3);
    const showing = [...sheet.showing];
    const m = lab(l.e.snapshot());
    const again = m.in.tools.find((t) => t.kind === 'bondpaper')!;
    expect([again.pose.x, again.pose.y]).toEqual([4000, 700]);
    expect([...again.paper[0].n]).toEqual([...sheet.paper[0].n]);
    again.showing.forEach((x, i) => expect(x).toBeCloseTo(showing[i], 6));
  });
});

describe('what main took out', () => {
  /** A save on the wall with one tool of a kind there no longer is, a dispenser, and a hose from each. */
  const old = (kind: string): SaveState => ({
    ...bare(),
    tools: [
      { kind: kind as 'dispenser', id: 7, fx: 3, fy: 0.3, valves: [0.5], tanks: [] },
      { kind: 'dispenser', id: 3, fx: 4, fy: 0.3, valves: [0.5], tanks: [] },
    ],
    hoses: [
      { on: { tool: 7, spout: 0 }, outlet: toFrac({ x: 3200, y: 600, z: PLANE_Z }) },
      { on: { tool: 3, spout: 0 }, outlet: toFrac({ x: 4200, y: 600, z: PLANE_Z }) },
    ],
  });

  for (const kind of ['analyzer', 'visualizer', 'dish', 'culture']) {
    it(`loses a ${kind} from an older save, with the hose out of its spout, and loads the rest as it was`, () => {
      expect(kind in SHAPES).toBe(false);
      expect(WHEELS.flat() as string[]).not.toContain(kind);
      expect(Object.keys(STOCK)).not.toContain(kind);
      const l = lab(old(kind));
      expect(l.in.tools.map((t) => t.kind).sort()).toEqual(['dispenser', 'receptacle', 'shadowlamp', 'sheet', 'spectroscope']);
      expect(l.in.hoses).toHaveLength(1);
      expect(l.in.hoses[0].on.tool?.id).toBe(3);
      // a tool the save lacked, added as it loads, doesn't get the lost one's id, nor its hose
      expect(l.in.tools.every((t) => t.id !== 7)).toBe(true);
    });
  }
});

describe('a save from before the station moved to the left end', () => {
  // a flask on the counter under where the first faucet was, one under where the station's waste spigot was, and a
  // dispenser far off with its hose's nozzle over where the station's funnel was
  const old = (): SaveState => {
    const flask = (x: number) => ({ n: {}, Q: 0, x: x / 1000, up: FLASK_H, glass: 100 });
    const nozzle = toFrac({ x: spoutAt(new Tool('receptacle', -1, BEFORE_LEFT.station), 0).x, y: BEFORE_LEFT.station.y - 160, z: PLANE_Z });
    const spot = toFrac({ x: 4000, y: 900, z: PLANE_Z });
    return {
      ...bare(),
      flasks: [flask(BEFORE_LEFT.faucets[0]), flask(spoutAt(new Tool('receptacle', -1, BEFORE_LEFT.station), 0).x)],
      tools: [{ kind: 'dispenser', id: 1, fx: spot.x, fy: spot.y, valves: [0], tanks: [], drops: [] }],
      hoses: [{ outlet: nozzle, on: { tool: 1, spout: 0 } }],
    };
  };
  const outlets = (l: Lab) =>
    (l.in.hoses as unknown as Hose[]).map((h) => ({ on: 'tool' in h.on ? `${h.on.tool.kind}.${h.on.spout}` : `faucet ${h.on.faucet}`, x: h.outlet.x }));

  it("keeps pouring where it did: into the funnel where it is now, and from the faucets and spouts that moved where they were", () => {
    const l = lab(old());
    const station = l.in.tools.find((t) => t.kind === 'receptacle')!;
    const funnel = tankMouth(station, 0);
    const spigot = spoutAt(new Tool('receptacle', -1, BEFORE_LEFT.station), 0).x;
    // the faucet over the flask that was under the waste spigot pours where it used to, into nothing
    const over = FAUCET_X.findIndex((x) => Math.abs(x - spigot) < FLASK_R);
    expect(over).toBeGreaterThan(0);
    expect(outlets(l).sort((a, b) => a.on.localeCompare(b.on))).toEqual([
      { on: 'dispenser.0', x: funnel.x },
      { on: 'faucet 0', x: BEFORE_LEFT.faucets[0] },
      { on: `faucet ${over}`, x: BEFORE_LEFT.faucets[over] },
      { on: 'receptacle.0', x: spigot },
    ]);
  });

  it('is left as it is once saved since', () => {
    const l = lab({ ...old(), stationLeft: true });
    expect(outlets(l)).toEqual([{ on: 'dispenser.0', x: spoutAt(new Tool('receptacle', -1, BEFORE_LEFT.station), 0).x }]);
    expect(lab().e.snapshot().stationLeft).toBe(true);
  });
});

describe('the shadow lamp', () => {
  it("is in every new lab, built into the wall, with a new sheet of shadow paper in its slot", () => {
    const l = lab();
    const lamp = l.in.tools.find((t) => t.kind === 'shadowlamp')!;
    expect(lamp.pose).toEqual(LAMP_POSE);
    expect(lamp.valves[0]).toBe(0.5);
    const sheets = l.in.tools.filter((t) => t.kind === 'sheet');
    expect(sheets).toHaveLength(1);
    expect(inSlot(sheets[0].pose)).toBe(true);
    expect(l.in.grabbable({ kind: 'tool', t: lamp, part: 'body', k: 0 })).toBe(false);
  });

  it("has its pane's foot at the counter's top, so a flask on the counter in front of it is all in its light", () => {
    const top = LAMP_POSE.y - 14;
    expect(LAMP_POSE.y - SHAPES.shadowlamp.box.y1).toBe(LIFT);
    expect(top - (LIFT + FLASK_H)).toBeGreaterThanOrEqual(0);
    // and it's in nothing's way in front of it: a flask stands there
    const l = lab(bare());
    put(l, 'flask', at(LAMP_POSE.x, LIFT + FLASK_H));
  });

  it('is lit with the left button on its button, for as long as its dial says, and put out with it again; undo takes a press back', () => {
    const l = lab(bare());
    const lamp = l.in.tools.find((t) => t.kind === 'shadowlamp')!;
    lamp.valves[0] = 0.25;
    l.in.pointer = { x: 1, y: 1 };
    l.in.target = { kind: 'tool', t: lamp, part: 'button', k: 0 };
    l.in.leftDown(false);
    expect(lamp.lit).toBe(true);
    expect(lamp.left).toBeCloseTo(lampShot(0.25));
    run(l, 0.05);
    expect(lamp.left).toBeCloseTo(lampShot(0.25) - 0.05, 6);
    // a save keeps it shining for what it has left
    const m = lab(l.e.snapshot());
    const again = m.in.tools.find((t) => t.kind === 'shadowlamp')!;
    expect(again.lit).toBe(true);
    expect(again.left).toBeCloseTo(lamp.left, 6);
    l.in.leftDown(false);
    expect(lamp.lit).toBe(false);
    l.e.undo();
    expect(lamp.lit).toBe(true);
    run(l, 1);
    expect(lamp.lit).toBe(false);
  });
});

describe('shadow paper', () => {
  it("goes into the lamp's slot when it's let go of over the pane, and nowhere near it otherwise, and only one at a time", () => {
    const l = lab(bare());
    const lamp = l.in.tools.find((t) => t.kind === 'shadowlamp')!;
    const first = l.in.tools.find((t) => t.kind === 'sheet')!;
    // with one in the slot, another let go of there is just pinned where it's held, if there's room
    holdAt(l, 'sheet', at(SHEET_SLOT.x + 10, SHEET_SLOT.y + 15));
    expect(inSlot(l.in.placement(l.in.held, at(SHEET_SLOT.x + 10, SHEET_SLOT.y + 15)).pose)).toBe(false);
    l.in.putAway();
    // take the first out and hang it elsewhere
    l.in.tools.splice(l.in.tools.indexOf(first), 1);
    const sheet = put(l, 'sheet', at(SHEET_SLOT.x + 20, SHEET_SLOT.y + 30)) as Tool;
    expect(sheet.pose).toEqual(SHEET_SLOT);
    l.in.simulate(0.02);
    expect(lamp.sheet).toBe(sheet);
    // far from it, it's pinned where it's let go of
    const other = put(l, 'sheet', at(4000, 900)) as Tool;
    expect([other.pose.x, other.pose.y]).toEqual([4000, 900]);
    // in the slot it's behind the lamp's frame, out of its way, and out of the way of what's in front of it
    expect(toolBox(sheet).z).toBe(PLANE_Z);
  });

  it("is owed the lamp's light while it's in the slot with the lamp lit, on sim time, and none with no sheet there", () => {
    const l = lab(bare());
    const lamp = l.in.tools.find((t) => t.kind === 'shadowlamp')!;
    lamp.valves[0] = 1;
    lamp.press();
    l.in.simulate(0);
    expect(lamp.owed).toBe(0);
    run(l, 0.5);
    // (nothing draws it here, so what's owed waits)
    expect(lamp.owed).toBeCloseTo(0.5, 6);
    const sheet = l.in.tools.find((t) => t.kind === 'sheet')!;
    l.in.tools.splice(l.in.tools.indexOf(sheet), 1);
    run(l, 0.2);
    expect(lamp.owed).toBe(0);
  });

  it('is owed no more than the exposure had left, through the longest sleep', () => {
    const l = lab(bare());
    const lamp = l.in.tools.find((t) => t.kind === 'shadowlamp')!;
    lamp.valves[0] = 0;
    lamp.press();
    l.in.simulate(0.02);
    l.in.sleeper().skip(3600);
    expect(lamp.lit).toBe(false);
    expect(lamp.owed).toBeCloseTo(lampShot(0), 6);
  });

  it('keeps its image, and its place in the slot, through a save', () => {
    const l = lab(bare());
    const sheet = l.in.tools.find((t) => t.kind === 'sheet')!;
    const n = SHEET.cells;
    sheet.expose(Float32Array.from({ length: n * n }, (_, i) => (i % n < n / 2 ? 1 : 0.2)), 1);
    const m = lab(l.e.snapshot());
    const again = m.in.tools.find((t) => t.kind === 'sheet')!;
    expect(inSlot(again.pose)).toBe(true);
    for (const i of [0, n / 2, n * n - 1]) expect(again.dose[i]).toBeCloseTo(sheet.dose[i], 1);
  });
});

describe('a sniff', () => {
  /** A flask of `species` on the counter, with the pointer on it. */
  const aimed = (l: Lab, species: number) => {
    const f = put(l, 'flask', at(4000, LIFT + FLASK_H)) as Flask;
    f.setMolecules(species, CAP / 2);
    // (what's open on top is looked at afresh each frame)
    l.in.simulate(0);
    l.in.target = { kind: 'flask', f };
    return f;
  };

  it('smells what the pointer is on, a moment after F, and says what it makes of it', () => {
    const l = lab(bare());
    aimed(l, R);
    l.in.sniff();
    expect(l.in.sniffing).not.toBeNull();
    // not before her nose would have got there
    l.in.stepSniff(l.in.sniffing!.when - 1);
    expect(l.in.smelled).toBeNull();
    l.in.stepSniff(l.in.sniffing!.when);
    expect(l.in.sniffing).toBeNull();
    expect(l.in.smelled!.script.length).toBeGreaterThan(0);
  });

  it('smells nothing in an empty flask or plain solvent, but says so', () => {
    const l = lab(bare());
    aimed(l, SOLVENT_SPECIES);
    l.in.sniff();
    l.in.stepSniff(Infinity);
    expect(l.in.smelled!.script.map((f) => f.text).join(' ')).toMatch(/[Nn]othing|No smell|anything/);
  });

  it("can't smell through glass: the station's reservoir is sealed", () => {
    const l = lab(bare());
    const st = l.in.tools.find((t) => t.kind === 'receptacle')!;
    expect(tankMouth(st, 1)).toBeTruthy();
    l.in.target = { kind: 'tool', t: st, part: 'tank', k: 1 };
    l.in.sniff();
    expect(l.in.sniffing).toBeNull();
    expect(l.in.flash?.text).toBe('It’s sealed');
  });

  it('smells the flask in hand, with the pointer on nothing', () => {
    const l = lab(bare());
    const f = holdAt(l, 'flask', at(4000, 800)) as Flask;
    f.setMolecules(pairOf('R', 'G'), CAP / 2);
    l.in.simulate(0);
    l.in.target = null;
    l.in.sniff();
    l.in.stepSniff(Infinity);
    expect(l.in.smelled!.script.length).toBeGreaterThan(0);
    expect(TRACE).toBeGreaterThan(0);
  });
});
