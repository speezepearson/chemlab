/*
 * Headless benchmark of GameEngine.simulate: the real engine, with the View and Web Audio stubbed out (see
 * vite.bench.config.ts). Builds a handful of scenes, from an idle lab to a busy one, and reports per scene:
 *   - wall time per substep and per sim second, uninstrumented (mode "time")
 *   - an exclusive-time breakdown by function, from wrapping methods (mode "breakdown")
 *   - chemistry stats: how often each vessel is stepped versus put off, active reactions per step (mode "stats")
 *
 *   - mode "tight": the sim alone in a tight loop, no frames, as while the player sleeps (sim s per wall s)
 *   - mode "micro": ReactionNetwork.step and tick alone on single fluids, and the bench/stepFast.ts prototype
 *
 * Usage:  npm run bench -- [scene ...] [--frames=N] [--speed=S,S2] [--mode=time,breakdown,stats,tight,micro] [--quiet]
 *   e.g.  npm run bench -- busy --speed=1000 --frames=30
 *         npm run bench -- prod --mode=tight --sim=120 --reps=3 --tightstats
 * Scenes: idle quiet8 room8 fresh8 hot8 busy prod (see SCENES). Tight-loop options: --chunk (sim s per simulate
 * call, 1), --warm (30), --sim (120), --reps (3, best and median reported), --tightstats (chem stats, step time by
 * vessel kind, Tool.step by tool kind).
 * Experiments: --substep=X (try another substep length), --nochem (tick does nothing), --slab (Vessels' counts as
 * views into a shared buffer instead of their own Float64Array), --faststep (bench/stepFast.ts). --save=DIR writes each scene's SaveState for the
 * browser bench (bench/browser.cjs); --load=FILE starts from one.
 * For a CPU profile:  node --cpu-prof --cpu-prof-dir=bench/prof bench/dist/sim.js busy --mode=time
 *   then:  node bench/cpuprofile.mjs bench/prof/<file>.cpuprofile
 *
 * Uses the default chemistry, since that's what the game runs; it's a measurement, not a test.
 */
import { ATOMS, type Atom } from '../src/chem/atoms';
import { equilibrium } from '../src/chem/equilibrium';
import { T_ROOM, defaultChemParams } from '../src/chem/params';
import { Lag, ReactionNetwork, heatAt, type Fluid } from '../src/chem/reactions';
import { NS, SPECIES, singleOf, speciesEnergies } from '../src/chem/species';
import { flaskMouth, tankMouth, NOZZLE_REACH } from '../src/game/bodies';
import { CAP } from '../src/game/config';
import { GameEngine } from '../src/game/engine';
import { Vessel } from '../src/game/flask';
import { DEFAULT_PRESET, type FlaskFill, type Preset } from '../src/game/presets';
import { Hose, Tool } from '../src/game/tools';
import { stepFast } from './stepFast';

/* ---------------- a deterministic Math.random ---------------- */

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- the browser globals the engine touches ---------------- */

const g = globalThis as Record<string, unknown>;
const noop = () => {};
g.window = globalThis;
g.devicePixelRatio = 1;
g.addEventListener ??= noop;
g.removeEventListener ??= noop;
g.document = { addEventListener: noop, removeEventListener: noop, pointerLockElement: null, exitPointerLock: noop };
g.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = noop;

const canvas = { addEventListener: noop, removeEventListener: noop, setPointerCapture: noop, requestPointerLock: noop };
const stage = { clientWidth: 1280, clientHeight: 720 };
const callbacks = new Proxy({}, { get: () => noop });

/* ---------------- scenes ---------------- */

const params = defaultChemParams();
const U = speciesEnergies(params);

/** A fill of `flasks` worth of atoms, mixed from `atoms` shares, at chemical equilibrium at Teq, then set to T. */
function mixFill(atoms: Partial<Record<Atom, number>>, flasks: number, Teq: number, T: number): FlaskFill {
  const a = ATOMS.map((x) => atoms[x] ?? 0);
  const n = equilibrium(a, U, Teq);
  return { contents: SPECIES.filter((s) => n[s.i] * flasks * CAP >= 1).map((s) => ({ species: s.i, molecules: n[s.i] * flasks * CAP })), T };
}
/** Unreacted singles, as just mixed. */
function freshFill(atoms: Partial<Record<Atom, number>>, flasks: number, T: number): FlaskFill {
  return { contents: ATOMS.filter((x) => atoms[x]).map((x) => ({ species: singleOf(x), molecules: atoms[x]! * flasks * CAP })), T };
}
const EVEN: Partial<Record<Atom, number>> = { R: 1 / 6, Y: 1 / 6, G: 1 / 6, C: 1 / 6, B: 1 / 6, M: 1 / 6 };
const COLORS: Atom[] = ['R', 'Y', 'G', 'C', 'B', 'M', 'R', 'G'];

/** The engine with its private parts reachable, as the bench pokes at them. */
type Engine = Record<string, any>;

interface Scene {
  about: string;
  preset: Preset;
  /** Adjust the loaded lab: hoses, flasks under faucets. */
  after?: (e: Engine) => void;
}

const base = (flasks: (FlaskFill | null)[], id: string): Preset => ({ ...DEFAULT_PRESET, id, name: id, flasks, tools: [] });

function hose(e: Engine, on: Hose['on'], into: { x: number; y: number; z: number }, up = 24): void {
  e.hoses.push(new Hose(on, { x: into.x, y: into.y + up, z: into.z }, NOZZLE_REACH.min));
}

const SCENES: Record<string, Scene> = {
  idle: { about: 'default lab: 8 empty flasks, station (reference full of target), analyzer, spectroscope', preset: base([], 'idle') },
  quiet8: {
    about: '8 flasks 2/3 full, each one pure color at room T',
    preset: base(COLORS.map((c) => ({ contents: [{ species: singleOf(c), molecules: (2 / 3) * CAP }], T: T_ROOM })), 'quiet8'),
  },
  room8: {
    about: '8 flasks 2/3 full of an equilibrated even mix of all six atoms at T=1',
    preset: base(COLORS.map(() => mixFill(EVEN, 2 / 3, 1, 1)), 'room8'),
  },
  fresh8: {
    about: '8 flasks 2/3 full of all six atoms just mixed (unreacted singles) at T=1',
    preset: base(COLORS.map(() => freshFill(EVEN, 2 / 3, 1)), 'fresh8'),
  },
  hot8: {
    about: '8 flasks 2/3 full of the room-T equilibrium mix, heated to T=4 (reacting, cooling)',
    preset: base(COLORS.map(() => mixFill(EVEN, 2 / 3, 1, 4)), 'hot8'),
  },
  busy: {
    about:
      'hot8 + 6 faucets running through hoses into a heater -> separator (looped) -> analyzer/spectroscope/splitter -> exchanger, ' +
      'sorter, meter, dispenser -> pipette, big tank, two flasks overflowing under faucets',
    preset: {
      ...base(COLORS.map(() => mixFill(EVEN, 2 / 3, 1, 4)), 'busy'),
      tools: [
        { kind: 'heater', at: [0.25, 0.3], valves: [0.1, 0.1, 0.1, 0.6] },
        { kind: 'separator', at: [0.75, 0.3], valves: [0.3], tanks: [mixFill(EVEN, 2, 1, 3)] },
        { kind: 'splitter', at: [1.0, 0.25], valves: [0.5] },
        { kind: 'sorter', at: [1.3, 0.25] },
        { kind: 'exchanger', at: [0.45, 0.6], valves: [0.3, 0.3], tanks: [mixFill(EVEN, 0.5, 1, 2), mixFill(EVEN, 0.5, 1, 1)] },
        { kind: 'dispenser', at: [0.7, 0.6], valves: [0.05], tanks: [mixFill(EVEN, 4, 1, 5)] },
        { kind: 'pipette', at: [0.9, 0.6], valves: [0.5] },
        { kind: 'tank', at: [1.2, 0.6], valves: [0.02], tanks: [mixFill(EVEN, 10, 1, 1.5)] },
        { kind: 'meter', at: [1.5, 0.6] },
      ],
    },
    after(e) {
      const T = (k: string) => e.tools.find((t: Tool) => t.kind === k) as Tool;
      const [heater, sep, split, sorter, exch, disp, pip, , meter] = e.tools as Tool[];
      const analyzer = T('analyzer');
      const spectro = T('spectroscope');
      hose(e, { faucet: 0 }, tankMouth(heater, 0));
      hose(e, { faucet: 2 }, tankMouth(heater, 0), 44);
      hose(e, { tool: heater, spout: 3 }, tankMouth(sep, 0), 64);
      hose(e, { tool: sep, spout: 0 }, tankMouth(sep, 0));
      hose(e, { tool: sep, spout: 1 }, tankMouth(sep, 0), 44);
      hose(e, { tool: sep, spout: 2 }, tankMouth(analyzer, 0));
      hose(e, { tool: sep, spout: 3 }, tankMouth(spectro, 0));
      hose(e, { tool: sep, spout: 4 }, tankMouth(split, 0));
      hose(e, { tool: split, spout: 0 }, tankMouth(exch, 0));
      hose(e, { tool: split, spout: 1 }, tankMouth(exch, 1));
      hose(e, { faucet: 3 }, tankMouth(sorter, 0));
      hose(e, { faucet: 4 }, tankMouth(meter, 0));
      hose(e, { tool: disp, spout: 0 }, tankMouth(pip, 0));
      hose(e, { faucet: 1 }, flaskMouth(e.flasks[0]));
      hose(e, { faucet: 5 }, flaskMouth(e.flasks[1]));
    },
  },
  prod: {
    about:
      'a steady-state production line into the station, as left running while asleep: faucets R+G -> heater 1 -> holding ' +
      'tank (hot) -> separator looped on itself (wash), faucet B -> heater 2 -> separator; separator 2,3,4 -> sorter; ' +
      'sorter triples -> exchanger (cooled by faucet C) -> analyzer -> station receptacle; 4 flasks of hot intermediates on the side',
    preset: {
      ...base([...COLORS.slice(0, 4).map(() => mixFill(EVEN, 2 / 3, 1, 3)), null, null, null, null], 'prod'),
      tools: [
        { kind: 'heater', at: [0.25, 0.25], valves: [0, 0, 0, 0.7] },
        { kind: 'dispenser', at: [0.45, 0.6], valves: [0.1], tanks: [mixFill({ R: 0.5, G: 0.5 }, 2, 1, 6)] },
        { kind: 'separator', at: [0.75, 0.3], valves: [0.05], tanks: [mixFill(EVEN, 2, 1, 10)] },
        { kind: 'heater', at: [0.25, 0.6], valves: [0, 0, 0, 0.9] },
        { kind: 'sorter', at: [1.0, 0.25] },
        { kind: 'exchanger', at: [1.3, 0.6], valves: [0.5, 0.5] },
        { kind: 'tank', at: [1.6, 0.25], valves: [0.02], tanks: [mixFill(EVEN, 10, 1, 1)] },
      ],
    },
    after(e) {
      const [h1, hold, sep, h2, sorter, exch] = e.tools as Tool[];
      const analyzer = e.tools.find((t: Tool) => t.kind === 'analyzer') as Tool;
      const station = e.tools.find((t: Tool) => t.kind === 'receptacle') as Tool;
      hose(e, { faucet: 0 }, tankMouth(h1, 0));
      hose(e, { faucet: 2 }, tankMouth(h1, 0), 44);
      hose(e, { tool: h1, spout: 3 }, tankMouth(hold, 0));
      hose(e, { tool: hold, spout: 0 }, tankMouth(sep, 0), 64);
      hose(e, { faucet: 4 }, tankMouth(h2, 0));
      hose(e, { tool: h2, spout: 3 }, tankMouth(sep, 0), 84);
      hose(e, { tool: sep, spout: 0 }, tankMouth(sep, 0));
      hose(e, { tool: sep, spout: 1 }, tankMouth(sep, 0), 44);
      hose(e, { tool: sep, spout: 2 }, tankMouth(sorter, 0));
      hose(e, { tool: sep, spout: 3 }, tankMouth(sorter, 0), 44);
      hose(e, { tool: sep, spout: 4 }, tankMouth(sorter, 0), 64);
      hose(e, { tool: sorter, spout: 2 }, tankMouth(exch, 0));
      hose(e, { faucet: 3 }, tankMouth(exch, 1));
      hose(e, { tool: exch, spout: 0 }, tankMouth(analyzer, 0));
      hose(e, { tool: analyzer, spout: 0 }, tankMouth(station, 0));
    },
  },
};

/* ---------------- instrumentation ---------------- */

const acc = new Map<string, { t: number; n: number }>();
const stack: number[] = [];
const restores: (() => void)[] = [];

/** Wrap obj[name] to add its exclusive wall time (less any wrapped callees) and call count under `label`. */
function wrap(obj: any, name: string, label = name): void {
  const orig = obj[name];
  obj[name] = function (this: unknown, ...args: unknown[]) {
    const t0 = performance.now();
    stack.push(0);
    try {
      return orig.apply(this, args);
    } finally {
      const el = performance.now() - t0;
      const child = stack.pop()!;
      if (stack.length) stack[stack.length - 1] += el;
      let a = acc.get(label);
      if (!a) acc.set(label, (a = { t: 0, n: 0 }));
      a.t += el - child;
      a.n++;
    }
  };
  restores.push(() => (obj[name] = orig));
}
function unwrapAll(): void {
  while (restores.length) restores.pop()!();
  acc.clear();
}

/* ---------------- chemistry stats ---------------- */

interface ChemStats {
  ticks: number;
  tickNonEmpty: number;
  tickStepped: number;
  movedCalls: number;
  movedTrue: number;
  steps: number;
  active: number;
  stepDt: number;
}
function chemStats(net: ReactionNetwork): { stats: ChemStats; undo: () => void } {
  const stats: ChemStats = { ticks: 0, tickNonEmpty: 0, tickStepped: 0, movedCalls: 0, movedTrue: 0, steps: 0, active: 0, stepDt: 0 };
  const P = ReactionNetwork.prototype as any;
  const { tick, step, moved } = P;
  const N = net as any;
  let stepped = 0;
  P.tick = function (f: Fluid, h: number, lag: Lag) {
    stats.ticks++;
    if (f.N > 0) stats.tickNonEmpty++;
    stepped = 0;
    tick.call(this, f, h, lag);
    if (stepped) stats.tickStepped++;
  };
  P.moved = function (f: Fluid, lag: Lag) {
    stats.movedCalls++;
    const r = moved.call(this, f, lag);
    if (r) stats.movedTrue++;
    return r;
  };
  P.step = function (f: Fluid, dt: number) {
    stepped++;
    stats.steps++;
    stats.stepDt += dt;
    // count the reactions that can happen (as step's own loop does)
    const { first, k, rb } = N;
    for (let s = 0; s < NS; s++) {
      if (f.n[s] <= 0) continue;
      for (let i = first[s]; i < first[s + 1]; i++) if (k[i] && (rb[i] < 0 || f.n[rb[i]] > 0)) stats.active++;
    }
    return step.call(this, f, dt);
  };
  return { stats, undo: () => Object.assign(P, { tick, step, moved }) };
}

/* ---------------- running ---------------- */

const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const sceneNames = args.filter((a) => !a.startsWith('--'));
const FRAMES = Number(opt('frames', '60'));
const SPEEDS = opt('speed', '16').split(',').map(Number);
const MODES = opt('mode', 'time,breakdown,stats').split(',');
const FRAME_DT = 1 / 60;
const quiet = args.includes('--quiet');
/** Substep length to try (the engine's is 0.02), via the hook vite.bench.config.ts puts in simulate. */
const SUBSTEP = Number(opt('substep', '0.02'));
(globalThis as any).__SUBSTEP = SUBSTEP;
/** --nochem: the chemistry does nothing (tick is a no-op), to see what the rest of the sim costs. */
const NOCHEM = args.includes('--nochem');
if (NOCHEM) (ReactionNetwork.prototype as any).tick = () => {};
/** --slab: Vessels' counts are views into big shared buffers (see vite.bench.config.ts), as pooling would make them cheap. */
if (args.includes('--slab')) {
  let buf = new Float64Array(0);
  let at = 0;
  (globalThis as any).__slab = () => {
    if (at + NS > buf.length) {
      buf = new Float64Array(NS * 4096);
      at = 0;
    }
    const v = buf.subarray(at, at + NS);
    at += NS;
    return v;
  };
}
/** --load=FILE: start every scene from a SaveState (as the browser bench does) instead of its own setup. */
const LOADED = opt('load', '') ? JSON.parse((await import('node:fs')).readFileSync(opt('load', ''), 'utf8')) : null;
/** --faststep: swap in the restructured step (bench/stepFast.ts) everywhere. */
if (args.includes('--faststep'))
  (ReactionNetwork.prototype as any).step = function (this: ReactionNetwork, f: Fluid, dt: number) {
    return stepFast(this, f, dt);
  };

function makeEngine(scene: Scene, seed: number): { e: Engine; net: ReactionNetwork } {
  Math.random = mulberry32(seed);
  const net = new ReactionNetwork(params);
  const e = new GameEngine(canvas as any, stage as any, net, callbacks as any, scene.preset) as unknown as Engine;
  e.wake = 'closed';
  if (LOADED) e.restore(LOADED, DEFAULT_PRESET);
  else scene.after?.(e);
  return { e, net };
}

function vesselCount(e: Engine): { all: number; full: number } {
  const vs = e.vessels() as Vessel[];
  return { all: vs.length, full: vs.filter((v) => v.N > 0).length };
}

const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

function runScene(name: string, scene: Scene, speed: number): void {
  const substepsPerFrame = Math.ceil((FRAME_DT * speed) / 0.02);
  const simPerFrame = FRAME_DT * speed;
  console.log(`\n=== ${name} @ ${speed}x  (${substepsPerFrame} substeps/frame, ${FRAMES} frames = ${fmt(FRAMES * simPerFrame, 1)} sim s)`);
  console.log(`    ${scene.about}`);

  if (MODES.includes('time')) {
    // warm the JIT on a throwaway copy, then time a fresh one from the same seed
    {
      const { e } = makeEngine(scene, 1);
      e.speed = speed;
      for (let i = 0; i < Math.min(FRAMES, 20); i++) e.simulate(FRAME_DT);
    }
    const { e } = makeEngine(scene, 1);
    e.speed = speed;
    const vc = vesselCount(e);
    const times: number[] = [];
    for (let i = 0; i < FRAMES; i++) {
      const t0 = performance.now();
      e.simulate(FRAME_DT);
      times.push(performance.now() - t0);
    }
    const total = times.reduce((a, b) => a + b, 0);
    const sorted = [...times].sort((a, b) => a - b);
    const vc2 = vesselCount(e);
    // the render-side engine work (building the Frame for the view), and the HUD, per frame
    let renderMs = NaN;
    try {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) e.render(FRAME_DT);
      renderMs = (performance.now() - t0) / 20;
    } catch {
      /* the stub view can't do everything render needs */
    }
    console.log(
      `  time: ${fmt(total / FRAMES)} ms/frame (median ${fmt(sorted[sorted.length >> 1])}, max ${fmt(sorted[sorted.length - 1])}); ` +
        `${fmt((1000 * total) / FRAMES / substepsPerFrame, 2)} us/substep; ${fmt(total / (FRAMES * simPerFrame), 3)} ms per sim s; ` +
        `max sustainable speed at 10 ms/frame of sim: ${fmt((10 / (total / FRAMES)) * speed, 0)}x`,
    );
    console.log(`  vessels: ${vc.all} (${vc.full} holding fluid at start, ${vc2.full} at end); engine.render (frame building, stub view) ${fmt(renderMs)} ms`);
    RESULTS.push({ scene: name, speed, msPerFrame: total / FRAMES, usPerSubstep: (1000 * total) / FRAMES / substepsPerFrame, vessels: vc.all, full: vc.full });
  }

  if (MODES.includes('breakdown')) {
    const { e, net } = makeEngine(scene, 1);
    e.speed = speed;
    const EP = Object.getPrototypeOf(e);
    wrap(e, 'simulate', 'simulate (own: loop, closures, drops, drip, cool, faucet setup)');
    wrap(net, 'tick', 'chem.tick (own: owed bookkeeping, lag.x copy)');
    wrap(net, 'step', 'chem.step');
    wrap(net, 'moved', 'chem.moved');
    wrap(Tool.prototype, 'step', 'Tool.step (incl. transfer/divide/smooth)');
    wrap(e, 'overflow', 'engine.overflow');
    wrap(e, 'fill', 'engine.fill (addFrom)');
    wrap(e, 'stream', 'engine.stream (inflow map)');
    wrap(e, 'exposures', 'engine.exposures (per frame)');
    wrap(e, 'mouths', 'engine.mouths (per frame)');
    wrap(e, 'vessels', 'engine.vessels (per frame)');
    wrap(e, 'outletAt', 'engine.outletAt (per frame)');
    wrap(e, 'faucetOutlet', 'engine.faucetOutlet (per frame)');
    wrap(e, 'stepWake', 'engine.stepWake');
    wrap(e, 'loose', 'engine.loose');
    wrap(e, 'hear', 'engine.hear');
    void EP;
    for (let i = 0; i < FRAMES; i++) e.simulate(FRAME_DT);
    const total = [...acc.values()].reduce((a, b) => a + b.t, 0);
    const subs = FRAMES * substepsPerFrame;
    console.log(`  breakdown (exclusive, instrumented; total ${fmt(total / FRAMES)} ms/frame, ${fmt((1000 * total) / subs, 2)} us/substep):`);
    const rows = [...acc.entries()].sort((a, b) => b[1].t - a[1].t);
    for (const [k, v] of rows)
      console.log(
        `    ${k.padEnd(66)} ${fmt((100 * v.t) / total, 1).padStart(5)}%  ${fmt((1000 * v.t) / subs, 2).padStart(8)} us/substep  ` +
          `${String(v.n).padStart(8)} calls  ${fmt((1000 * v.t) / v.n, 3)} us/call`,
      );
    unwrapAll();
  }

  if (MODES.includes('stats')) {
    const { e, net } = makeEngine(scene, 1);
    e.speed = speed;
    const { stats: s, undo } = chemStats(net);
    for (let i = 0; i < FRAMES; i++) e.simulate(FRAME_DT);
    undo();
    const sim = FRAMES * simPerFrame;
    console.log(
      `  chem: ${s.ticks} ticks (${s.tickNonEmpty} on non-empty vessels, ${fmt((100 * s.tickStepped) / Math.max(1, s.tickNonEmpty), 1)}% of those stepped); ` +
        `${s.steps} steps = ${fmt(s.steps / sim, 1)} per sim s; mean step dt ${fmt(s.stepDt / Math.max(1, s.steps), 4)} sim s; ` +
        `mean active reactions/step ${fmt(s.active / Math.max(1, s.steps), 1)} (of ${net.count}); moved() calls ${s.movedCalls}, true ${s.movedTrue}`,
    );
    // per vessel: steps per sim second
    const vs = (e.vessels() as Vessel[]).filter((v) => v.N > 0);
    if (!quiet && vs.length <= 60) {
      const lags = e.lags as WeakMap<Vessel, Lag>;
      const desc = vs.map((v) => {
        const lag = lags.get(v);
        return `${fmt(v.N / CAP, 2)}F T=${fmt(v.Q / (3 * v.N), 2)} slack=${lag ? fmt(lag.slack, 3) : '-'}`;
      });
      console.log(`  vessels at end: ${desc.join(' | ')}`);
    }
    RESULTS_STATS.push({ scene: name, speed, ...s, sim });
  }
}

const RESULTS: { scene: string; speed: number; msPerFrame: number; usPerSubstep: number; vessels: number; full: number }[] = [];
const RESULTS_STATS: Record<string, unknown>[] = [];

/** Micro-benchmark of one ReactionNetwork.step on a fluid, without the engine. */
function microStep(): void {
  console.log('\n=== chem.step micro-benchmark (one 0.02 s step on a 2/3-full flask, us/call)');
  const net = new ReactionNetwork(params);
  const cases: [string, FlaskFill][] = [
    ['pure R', { contents: [{ species: singleOf('R'), molecules: (2 / 3) * CAP }], T: 1 }],
    ['even mix, equilibrium, T=1', mixFill(EVEN, 2 / 3, 1, 1)],
    ['even mix, equilibrium at T=1, heated to T=4', mixFill(EVEN, 2 / 3, 1, 4)],
    ['even mix, equilibrium at T=4', mixFill(EVEN, 2 / 3, 4, 4)],
    ['six singles just mixed, T=1', freshFill(EVEN, 2 / 3, 1)],
  ];
  for (const [label, fill] of cases) {
    Math.random = mulberry32(7);
    const mk = () => {
      const v = new Vessel(CAP);
      for (const { species, molecules } of fill.contents) {
        v.n[species] += Math.round(molecules);
        v.N += Math.round(molecules) * SPECIES[species].size;
      }
      v.Q = heatAt(fill.T, v.N);
      return v;
    };
    const v = mk();
    const snap = v.n.slice();
    const Q = v.Q;
    const N = 20000;
    for (let i = 0; i < 2000; i++) {
      v.n.set(snap);
      v.Q = Q;
      net.step(v, 0.02);
    }
    let present = 0;
    for (let s = 0; s < NS; s++) if (snap[s] > 0) present++;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      v.n.set(snap);
      v.Q = Q;
      net.step(v, 0.02);
    }
    const us = ((performance.now() - t0) * 1000) / N;
    // the restructured prototype (bench/stepFast.ts), and how far its mean result is from step's
    for (let i = 0; i < 2000; i++) {
      v.n.set(snap);
      v.Q = Q;
      stepFast(net, v, 0.02);
    }
    const tf = performance.now();
    for (let i = 0; i < N; i++) {
      v.n.set(snap);
      v.Q = Q;
      stepFast(net, v, 0.02);
    }
    const usFast = ((performance.now() - tf) * 1000) / N;
    const mean = (fn: (f: Fluid, dt: number) => unknown) => {
      const acc2 = new Float64Array(NS + 1);
      for (let i = 0; i < 400; i++) {
        v.n.set(snap);
        v.Q = Q;
        fn(v, 0.02);
        for (let s = 0; s < NS; s++) acc2[s] += v.n[s] / 400;
        acc2[NS] += v.Q / 400;
      }
      return acc2;
    };
    const ma = mean((f, dt) => net.step(f, dt));
    const mb = mean((f, dt) => stepFast(net, f, dt));
    let worstRel = 0;
    for (let s = 0; s <= NS; s++) {
      const base0 = s < NS ? snap[s] : Q;
      const da = ma[s] - base0;
      const db = mb[s] - base0;
      if (Math.abs(da) > 1e3) worstRel = Math.max(worstRel, Math.abs(da - db) / Math.abs(da));
    }
    console.log(`    stepFast ${fmt(usFast, 2)} us (${fmt(us / usFast, 2)}x); worst relative gap in mean change vs step: ${fmt(worstRel, 4)}`);
    // tick on a lag that's been stepped: the cost of a deferred tick (moved() only)
    const lag = new Lag();
    v.n.set(snap);
    v.Q = Q;
    net.tick(v, 0.02, lag);
    const t1 = performance.now();
    let steps = 0;
    const orig = net.step.bind(net);
    (net as any).step = (f: Fluid, dt: number) => (steps++, orig(f, dt));
    for (let i = 0; i < N; i++) net.tick(v, 0.02, lag);
    const usTick = ((performance.now() - t1) * 1000) / N;
    delete (net as any).step;
    console.log(
      `  ${label.padEnd(44)} species ${String(present).padStart(2)}  step ${fmt(us, 2).padStart(6)} us   ` +
        `tick ${fmt(usTick, 2).padStart(6)} us (stepped ${fmt((100 * steps) / N, 1)}% of ticks, slack ${fmt(lag.slack, 4)})`,
    );
  }
}

/**
 * "Asleep": the sim alone in a tight loop, no frames. simulate is called with `chunk` sim seconds at a time (the
 * engine still splits it into 0.02 s substeps); reports sim seconds per wall second over `sim` sim seconds, after
 * `warm` sim seconds to reach a steady state.
 */
function tight(name: string, scene: Scene): void {
  const chunk = Number(opt('chunk', '1'));
  const warm = Number(opt('warm', '30'));
  const simS = Number(opt('sim', '120'));
  const reps = Number(opt('reps', '3'));
  const walls: number[] = [];
  let line = '';
  for (let rep = 0; rep < reps; rep++) {
    const { e } = makeEngine(scene, 1);
    e.speed = 1;
    for (let t = 0; t < warm; t += chunk) e.simulate(chunk);
    const vc = vesselCount(e);
    const station = e.tools.find((t: Tool) => t.kind === 'receptacle') as Tool;
    const r0 = station.tanks[2].n.slice();
    let cycles = 0;
    let had = !!station.cycle;
    const t0 = performance.now();
    let worst = 0;
    for (let t = 0; t < simS; t += chunk) {
      const c0 = performance.now();
      e.simulate(chunk);
      worst = Math.max(worst, performance.now() - c0);
      if (station.cycle && !had) cycles++;
      had = !!station.cycle;
    }
    walls.push((performance.now() - t0) / 1000);
    let dRef = 0;
    for (let s = 0; s < NS; s++) dRef += Math.abs(station.tanks[2].n[s] - r0[s]);
    line =
      `worst chunk ${fmt(worst, 1)} ms; vessels ${vc.all} (${vc.full} full); receptacle ${fmt(station.tanks[0].N / CAP, 3)}F, ` +
      `cycles started ${cycles}, reference changed by ${fmt(dRef / CAP, 4)}F of molecules`;
  }
  walls.sort((a, b) => a - b);
  const wall = walls[0];
  const subs = (simS / chunk) * Math.ceil(chunk / SUBSTEP);
  console.log(
    `  tight ${name.padEnd(8)} chunk ${chunk}, substep ${SUBSTEP}${NOCHEM ? ', NO CHEM' : ''}: best of ${reps} ${fmt(simS / wall, 0).padStart(6)} sim s per wall s ` +
      `(median ${fmt(simS / walls[walls.length >> 1], 0)}), ${fmt((1e6 * wall) / subs, 1)} us/substep; ${line}`,
  );
  if (!args.includes('--tightstats')) return;
  // the same run again, for chemistry stats and the chemistry's time by kind of vessel
  const { e: e2, net } = makeEngine(scene, 1);
  e2.speed = 1;
  for (let t = 0; t < warm; t += chunk) e2.simulate(chunk);
  const kind = new Map<Vessel, string>();
  for (const f of e2.flasks as Vessel[]) kind.set(f, 'flask');
  for (const t of e2.tools as Tool[]) {
    for (const v of t.tanks) kind.set(v, `${t.kind} tank`);
    for (const v of t.tube) kind.set(v, 'heater tube cell');
  }
  const { stats: s, undo } = chemStats(net);
  const P = ReactionNetwork.prototype as any;
  const inner = P.step;
  const byKind = new Map<string, { t: number; n: number; vessels: Set<Vessel> }>();
  P.step = function (f: Vessel, dt: number) {
    const t0 = performance.now();
    const r = inner.call(this, f, dt);
    const k = kind.get(f) ?? 'other';
    let b = byKind.get(k);
    if (!b) byKind.set(k, (b = { t: 0, n: 0, vessels: new Set() }));
    b.t += performance.now() - t0;
    b.n++;
    b.vessels.add(f);
    return r;
  };
  // and Tool.step's time by kind of tool
  const TP = Tool.prototype as any;
  const toolStep = TP.step;
  const byTool = new Map<string, { t: number; n: number }>();
  TP.step = function (this: Tool, h: number) {
    const t0 = performance.now();
    const r = toolStep.call(this, h);
    let b = byTool.get(this.kind);
    if (!b) byTool.set(this.kind, (b = { t: 0, n: 0 }));
    b.t += performance.now() - t0;
    b.n++;
    return r;
  };
  const t1 = performance.now();
  for (let t = 0; t < simS; t += chunk) e2.simulate(chunk);
  const wall2 = performance.now() - t1;
  P.step = inner;
  TP.step = toolStep;
  undo();
  console.log(
    `    Tool.step by kind (us per call, % of run): ` +
      [...byTool.entries()]
        .sort((a, b) => b[1].t - a[1].t)
        .map(([k, b]) => `${k} ${fmt((1000 * b.t) / b.n, 2)} (${fmt((100 * b.t) / wall2, 1)}%)`)
        .join(', '),
  );
  console.log(
    `    chem: ${fmt((100 * s.tickStepped) / Math.max(1, s.tickNonEmpty), 1)}% of non-empty ticks stepped; ${fmt(s.steps / simS, 1)} steps per sim s; ` +
      `mean step dt ${fmt(s.stepDt / Math.max(1, s.steps), 4)}; mean active reactions/step ${fmt(s.active / Math.max(1, s.steps), 1)}; ` +
      `moved() true ${s.movedTrue} of ${s.movedCalls}`,
  );
  for (const [k, b] of [...byKind.entries()].sort((a, b) => b[1].t - a[1].t))
    console.log(
      `    step() on ${k.padEnd(18)} ${String(b.vessels.size).padStart(3)} vessels  ${fmt(b.n / simS, 1).padStart(7)} steps/sim s  ` +
        `${fmt(b.t, 0).padStart(6)} ms (${fmt((100 * b.t) / wall2, 1)}% of the run)  ${fmt((1000 * b.t) / b.n, 2)} us/step`,
    );
}

const names = sceneNames.length ? sceneNames : Object.keys(SCENES);
/** --save=DIR: write each scene's SaveState (after warming `--warm` sim s) as DIR/<scene>.json, for the browser bench. */
const saveDir = opt('save', '');
if (saveDir) {
  const fs = await import('node:fs');
  for (const n of names) {
    const { e } = makeEngine(SCENES[n], 1);
    e.speed = 1;
    const warm = Number(opt('warm', '0'));
    for (let t = 0; t < warm; t += 1) e.simulate(1);
    fs.writeFileSync(`${saveDir}/${n}.json`, JSON.stringify(e.snapshot()));
    console.log(`saved ${saveDir}/${n}.json`);
  }
  process.exit(0);
}
if (MODES.includes('micro')) microStep();
if (MODES.includes('tight')) {
  console.log('\n=== asleep: the sim alone in a tight loop');
  for (const n of names) if (SCENES[n]) tight(n, SCENES[n]);
}
if (['time', 'breakdown', 'stats'].some((m) => MODES.includes(m)))
  for (const speed of SPEEDS) for (const n of names) if (SCENES[n]) runScene(n, SCENES[n], speed);
if (MODES.includes('time')) {
  console.log('\n=== summary (uninstrumented)');
  for (const r of RESULTS)
    console.log(
      `  ${r.scene.padEnd(8)} ${String(r.speed).padStart(5)}x  ${fmt(r.msPerFrame, 2).padStart(9)} ms/frame  ${fmt(r.usPerSubstep, 2).padStart(8)} us/substep  ` +
        `${String(r.vessels).padStart(3)} vessels (${r.full} full)`,
    );
}
