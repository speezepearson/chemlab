import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReactionNetwork } from '../chem/reactions';
import { testChemParams } from '../chem/testChem';
import { SHEET_SLOT, inSlot, sheetIn, slotPose, toolStands } from './bodies';
import { STOCK } from './cabinet';
import type { GameEngine } from './engine';
import { DEFAULT_PRESET, LAMP_POSE } from './presets';
import type { SaveState } from './save';
import { SHEET, darkness, type Tool } from './tools';

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
const quiet = () => ({ place() {}, level() {}, swing() {}, run() {}, clunk() {}, stop() {} });
vi.mock('./water', () => ({ WaterSounds: class { update(): void {} stop(): void {} } }));
vi.mock('./rumble', () => ({ rumble: quiet }));
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
  flash: { text: string } | null;
  leftDown(shift: boolean): void;
  grabOrRelease(linked: boolean): void;
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

  it("can't be picked up, and its switch doesn't answer the key that picks things up at all", () => {
    const l = lab();
    const [lamp] = lampOf(l.in);
    const on = (part: string) => (l.in.target = { kind: 'tool', t: lamp, part, k: 0, point: { x: 0, y: 0, z: 0 }, distance: 100 });
    // the switch is for pressing, with the left button: the key neither works it nor says anything
    on('switch');
    l.in.grabOrRelease(false);
    expect([l.in.held, lamp.lit, l.in.flash]).toEqual([null, false, null]);
    // anywhere else on it, the key says why nothing's picked up
    on('body');
    l.in.grabOrRelease(false);
    expect(l.in.held).toBeNull();
    expect(l.in.flash?.text).toBe('That stays where it is');
    expect(lamp.pose).toEqual(LAMP_POSE);
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
