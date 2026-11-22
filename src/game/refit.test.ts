import { describe, expect, it } from 'vitest';
import { spoutAt } from './bodies';
import { plumbing, readLab } from './flatten';
import { FLASK_H } from './flaskShape';
import { refit } from './refit';
import type { SaveState, SavedFlask, SavedHose, SavedTool } from './save';
import { CELL, LIFT, toFrac } from './space';
import { SEPARATOR_OUTLET, SHAPES } from './tools';
import { SPECIES } from '../chem/species';

const empty = { n: {}, Q: 0 };
const save = (tools: SavedTool[], hoses: SavedHose[]): SaveState => ({ v: 1, wall: true, preset: 'x', flasks: [], tools, scales: [], hoses });
const hose = (tool: number, spout: number, x = 0.5): SavedHose => ({ outlet: { x, y: 0.3 }, on: { tool, spout } });

describe('refit', () => {
  describe('a heater from when it had three taps', () => {
    const old: SavedTool = {
      kind: 'heater', id: 4, fx: 0.4, fy: 0.3, valves: [0.2, 0, 1, 0.7], sides: [-1, 1, 1, -1], tanks: [empty],
      drops: [{ n: { R: 1 }, Q: 0 }, empty, empty, { n: { G: 2 }, Q: 0 }],
    };
    const s = save([old], [hose(4, 0, 0.1), hose(4, 2, 0.2), hose(4, 3, 0.3), { outlet: { x: 0.9, y: 0.3 }, on: { faucet: 1 } }]);
    const [t] = refit(s).tools;

    it('keeps only its dial, at its setting and with its side, as its one valve', () => {
      expect(t.valves).toEqual([0.7]);
      expect(t.valves.length).toBe(SHAPES.heater.valves!.length);
      expect(t.sides).toEqual([-1]);
    });

    it("keeps the drop on its end's spout, and drops its taps'", () => {
      expect(t.drops).toEqual([{ n: { G: 2 }, Q: 0 }]);
    });

    it("moves a hose on its end's spout to its one spout, and drops those on its taps' spouts", () => {
      const hoses = refit(s).hoses;
      expect(hoses).toHaveLength(2);
      expect(hoses[0]).toEqual({ outlet: { x: 0.3, y: 0.3 }, on: { tool: 4, spout: 0 } });
      expect(hoses[1].on).toEqual({ faucet: 1 });
    });

    it("leaves the save it's given as it was", () => {
      expect(old.valves).toHaveLength(4);
      expect(s.hoses).toHaveLength(4);
    });
  });

  it('leaves a save with only tools of the shapes they have now as it is', () => {
    const s = save([{ kind: 'heater', id: 1, fx: 0.4, fy: 0.3, valves: [0.5], tanks: [empty] }], [hose(1, 0)]);
    expect(refit(s)).toBe(s);
  });

  describe('a separator from when it had five spouts', () => {
    // hung 300 over the counter at 1000 along, so its spouts are well above a flask standing on the counter
    const at = toFrac({ x: 1000, y: LIFT + 300, z: 0 });
    const sep = (extra: Partial<SavedTool> = {}): SavedTool => ({ kind: 'separator', id: 5, fx: at.x, fy: at.y, valves: [0.4], tanks: [empty], ...extra });
    /** A flask standing on the counter with its mouth's middle x along. */
    const flask = (x: number): SavedFlask => ({ n: {}, Q: 0, x: x / 1000, up: FLASK_H, glass: 100 });
    const drops = [0, 1, 2, 3, 4].map((j) => ({ n: { R: j + 1 }, Q: 0 }));

    it('has the left spout let out what has black in it, as the old right end did, and the right the rest, as the old left end did', () => {
      for (const sp of SPECIES) expect(SEPARATOR_OUTLET[sp.i]).toBe(sp.atoms.includes('K') ? 0 : 1);
      expect(SHAPES.separator.spouts).toHaveLength(2);
    });

    it("keeps its valve, moves the old ends' hoses and drops to the spouts that let out what they did, and drops the rest", () => {
      const s = save([sep({ drops })], [hose(5, 0, 0.7), hose(5, 2, 0.8), hose(5, 4, 0.9)]);
      const r = refit(s);
      expect(r.twoSpoutSeparator).toBe(true);
      expect(r.tools[0].valves).toEqual([0.4]);
      expect(r.tools[0].drops).toEqual([drops[4], drops[0]]);
      expect(r.hoses).toEqual([
        { outlet: { x: 0.7, y: 0.3 }, on: { tool: 5, spout: 1 } },
        { outlet: { x: 0.9, y: 0.3 }, on: { tool: 5, spout: 0 } },
      ]);
    });

    it("keeps a bare end spout pouring into what it poured into, through a hose from the spout that takes its place", () => {
      // under the old left end's spout, which let out what had no black in it
      const s: SaveState = { ...save([sep()], []), flasks: [flask(1000 - 2 * CELL)] };
      expect(plumbing(readLab(s))['spout 5.1']).toBeNull();
      const r = refit(s);
      expect(r.hoses).toHaveLength(1);
      expect(r.hoses[0].on).toEqual({ tool: 5, spout: 1 });
      expect(plumbing(readLab(r))).toMatchObject({ 'spout 5.0': null, 'spout 5.1': 'flask 0' });
    });

    it('pours into nothing new: a spout over what its old spout missed gets a hose to where that spout poured, into nothing', () => {
      // under where the left spout is now, and the old spout one in from the left end was; nothing under the old ends
      const s: SaveState = { ...save([sep()], []), flasks: [flask(1000 - CELL)] };
      const lab = readLab(s);
      expect(spoutAt(lab.tools[0], 0).x).toBeCloseTo(1000 - CELL, 6);
      const r = refit(s);
      expect(r.hoses).toHaveLength(1);
      expect(r.hoses[0].on).toEqual({ tool: 5, spout: 0 });
      expect(plumbing(readLab(r))).toMatchObject({ 'spout 5.0': null, 'spout 5.1': null });
    });

    it('needs no hose on a spout that pours where its old spout did anyway, into nothing', () => {
      const s = save([sep()], []);
      expect(plumbing(readLab(s))).toMatchObject({ 'spout 5.0': null, 'spout 5.1': null });
      expect(refit(s).hoses).toHaveLength(0);
    });

    it('is refitted once: a save from after it had two spouts is left as it is', () => {
      const s: SaveState = { ...save([sep()], [hose(5, 1)]), twoSpoutSeparator: true };
      expect(refit(s)).toBe(s);
    });
  });
});
