import type { Flask } from './flask';
import type { Scale } from './scale';
import type { Pose, Vec3 } from './space';
import type { Hose, Tool } from './tools';

/**
 * Undo and redo, of the lab's arrangement only: what's in it, where everything is and which way it faces, tools'
 * valves, hoses, scales' tares, the player's notes and the room's switches. Never what's in the vessels:
 * the lab reacts and flows on between the player's actions, so an undo puts things back where they were, holding
 * whatever they hold now. Things are kept by reference, so one taken away and brought back by an undo or a redo is
 * the very same, with whatever it held when it went.
 */

/** The things in the lab that are arranged, as the engine keeps them. */
export interface Things {
  flasks: Flask[];
  tools: Tool[];
  scales: Scale[];
  hoses: Hose[];
  faucets: { note: string }[];
}

/** The lab's arrangement at some moment (see arrangement). */
export interface Arrangement {
  flasks: { f: Flask; pose: Pose; label: string }[];
  tools: { t: Tool; pose: Pose; valves: number[]; note: string; labels: string[] }[];
  scales: { sc: Scale; pose: Pose; load: { f: Flask; dx: number }[]; tare: number; note: string }[];
  hoses: { h: Hose; outlet: Vec3; turn: number; reach: number }[];
  faucets: string[];
  alarmsOff: boolean;
  blindsShut: boolean;
}

/** The room's switches, which the engine keeps itself. */
export type Switches = Pick<Arrangement, 'alarmsOff' | 'blindsShut'>;

/** How the lab is arranged just now. */
export function arrangement(l: Things, sw: Switches): Arrangement {
  return {
    flasks: l.flasks.map((f) => ({ f, pose: { ...f.pose }, label: f.label })),
    tools: l.tools.map((t) => ({
      t, pose: { ...t.pose }, valves: [...t.valves], note: t.note, labels: t.tanks.map((v) => v.label),
    })),
    scales: l.scales.map((sc) => ({ sc, pose: { ...sc.pose }, load: sc.load.map((x) => ({ ...x })), tare: sc.tare, note: sc.note })),
    hoses: l.hoses.map((h) => ({ h, outlet: { ...h.outlet }, turn: h.turn, reach: h.reach })),
    faucets: l.faucets.map((fa) => fa.note),
    alarmsOff: sw.alarmsOff,
    blindsShut: sw.blindsShut,
  };
}

/** Put the lab back as it was arranged, in place (the switches are left to the engine). */
export function arrange(l: Things, a: Arrangement): void {
  l.flasks.splice(0, Infinity, ...a.flasks.map(({ f, pose, label }) => Object.assign(f, { pose: { ...pose }, label, tilt: 0 })));
  l.tools.splice(
    0,
    Infinity,
    ...a.tools.map(({ t, pose, valves, note, labels }) => {
      Object.assign(t, { pose: { ...pose }, note });
      t.valves.splice(0, Infinity, ...valves);
      t.tanks.forEach((v, k) => (v.label = labels[k] ?? ''));
      return t;
    }),
  );
  l.scales.splice(
    0,
    Infinity,
    ...a.scales.map(({ sc, pose, load, tare, note }) => {
      Object.assign(sc, { pose: { ...pose }, tare, note });
      sc.load.splice(0, Infinity, ...load.map((x) => ({ ...x })));
      return sc;
    }),
  );
  l.hoses.splice(0, Infinity, ...a.hoses.map(({ h, outlet, turn, reach }) => Object.assign(h, { outlet: { ...outlet }, turn, reach })));
  l.faucets.forEach((fa, i) => (fa.note = a.faucets[i] ?? ''));
}

/** Whether two arrangements are the same: the same things, in the same order, arranged the same way. */
export function sameArrangement(a: Arrangement, b: Arrangement): boolean {
  // the things themselves by reference, and everything else by value
  const refs = (x: Arrangement) => [...x.flasks.map((e) => e.f), ...x.tools.map((e) => e.t), ...x.scales.map((e) => e.sc), ...x.hoses.map((e) => e.h)];
  const ra = refs(a);
  const rb = refs(b);
  if (ra.length !== rb.length || ra.some((r, i) => r !== rb[i])) return false;
  const ids = new Map<object, number>(ra.map((r, i) => [r, i]));
  const values = (x: Arrangement) =>
    JSON.stringify({
      ...x,
      flasks: x.flasks.map(({ pose, label }) => ({ pose, label })),
      tools: x.tools.map(({ t: _, ...rest }) => rest),
      scales: x.scales.map(({ sc: _, load, ...rest }) => ({ ...rest, load: load.map(({ f, dx }) => ({ f: ids.get(f) ?? -1, dx })) })),
      hoses: x.hoses.map(({ h: _, ...rest }) => rest),
    });
  return values(a) === values(b);
}

/** How many steps back undo can go. */
export const UNDO_DEPTH = 100;

/**
 * The arrangements to go back to, and forward to again. An action under way (a carry, a valve being turned) is marked
 * at its start and committed at its end, so it's undone in one step; one that changes nothing leaves no step.
 */
export class History {
  private undos: Arrangement[] = [];
  private redos: Arrangement[] = [];
  /** The arrangement as an action under way began, until it's committed. */
  private before: Arrangement | null = null;

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** An action is starting, from arrangement `now`; nothing, if one's already under way. */
  mark(now: Arrangement): void {
    this.before ??= now;
  }

  /** The action under way is done, leaving arrangement `now`: it's a step to undo, if it changed anything. */
  commit(now: Arrangement): void {
    const before = this.before;
    this.before = null;
    if (!before || sameArrangement(before, now)) return;
    this.undos.push(before);
    if (this.undos.length > UNDO_DEPTH) this.undos.shift();
    this.redos = [];
  }

  /** Step back from arrangement `now`: the arrangement to put back, if there is one. */
  undo(now: Arrangement): Arrangement | null {
    this.before = null;
    const a = this.undos.pop();
    if (a) this.redos.push(now);
    return a ?? null;
  }

  /** Step forward again from arrangement `now`: the arrangement to put back, if there is one. */
  redo(now: Arrangement): Arrangement | null {
    this.before = null;
    const a = this.redos.pop();
    if (a) this.undos.push(now);
    return a ?? null;
  }

  /** Forget it all, as when another lab is loaded. */
  clear(): void {
    this.undos = [];
    this.redos = [];
    this.before = null;
  }
}
