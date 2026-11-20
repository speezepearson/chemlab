import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReactionNetwork } from '../chem/reactions';
import { testChemParams } from '../chem/testChem';
import type { GameEngine } from './engine';
import { DEFAULT_PRESET, LAMP_POSE } from './presets';
import type { SaveState } from './save';
import type { Tool } from './tools';

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
  target: unknown;
  leftDown(shift: boolean): void;
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
});
