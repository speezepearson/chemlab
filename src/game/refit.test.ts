import { describe, expect, it } from 'vitest';
import { refit } from './refit';
import type { SaveState, SavedHose, SavedTool } from './save';
import { SHAPES } from './tools';

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
});
