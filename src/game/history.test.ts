import { describe, expect, it } from 'vitest';
import { Flask } from './flask';
import { History, UNDO_DEPTH, arrange, arrangement, sameArrangement, type Things } from './history';
import { Scale } from './scale';
import { Hose, Tool } from './tools';

const sw = { alarmsOff: false, blindsShut: false };

function lab(): Things {
  const f = new Flask(100);
  f.pose = { x: 50, y: 490, z: 150, yaw: 0 };
  const t = new Tool('dispenser', 0, { x: 250, y: 800, z: 150, yaw: 0 });
  const sc = new Scale({ x: 450, y: 420, z: 150, yaw: 0 });
  const h = new Hose({ tool: t, spout: 0 }, { x: 250, y: 600, z: 150 }, 50);
  return { flasks: [f], tools: [t], scales: [sc], hoses: [h], faucets: [{ note: '' }] };
}

describe('arrangement', () => {
  it('puts things back where they were, but not what they hold', () => {
    const l = lab();
    const [f] = l.flasks;
    const [t] = l.tools;
    const a = arrangement(l, sw);
    f.pose = { x: 950, y: 490, z: 150, yaw: 1 };
    f.label = 'acid';
    t.valves[0] = 0.7;
    t.flipped = true;
    f.N = 5;
    arrange(l, a);
    expect(f.pose).toEqual({ x: 50, y: 490, z: 150, yaw: 0 });
    expect(f.label).toBe('');
    expect(t.valves[0]).toBe(0);
    expect(t.flipped).toBe(false);
    expect(f.N).toBe(5);
  });

  it('brings back the same thing that was taken away, and takes away one that was made', () => {
    const l = lab();
    const [f] = l.flasks;
    const a = arrangement(l, sw);
    l.flasks.splice(0, 1);
    const made = new Flask(100);
    l.flasks.push(made);
    arrange(l, a);
    expect(l.flasks).toEqual([f]);
    expect(l.flasks[0]).toBe(f);
  });

  it('keeps what stands on a scale, and the hoses where they were', () => {
    const l = lab();
    const [f] = l.flasks;
    const [sc] = l.scales;
    const [h] = l.hoses;
    sc.put(f, 50);
    const a = arrangement(l, sw);
    sc.remove(f);
    h.outlet = { x: 0, y: 0, z: 0 };
    h.turn = 2;
    arrange(l, a);
    expect(sc.load).toEqual([{ f, dx: 50 }]);
    expect(h.outlet).toEqual({ x: 250, y: 600, z: 150 });
    expect(h.turn).toBe(0);
  });

  it('tells a changed arrangement from the same one', () => {
    const l = lab();
    const a = arrangement(l, sw);
    expect(sameArrangement(a, arrangement(l, sw))).toBe(true);
    // what's in the vessels doesn't count
    l.flasks[0].N = 9;
    expect(sameArrangement(a, arrangement(l, sw))).toBe(true);
    l.tools[0].valves[0] = 0.5;
    expect(sameArrangement(a, arrangement(l, sw))).toBe(false);
    l.tools[0].valves[0] = 0;
    expect(sameArrangement(a, arrangement(l, { ...sw, blindsShut: true }))).toBe(false);
    l.flasks.push(new Flask(100));
    expect(sameArrangement(a, arrangement(l, sw))).toBe(false);
  });
});

describe('History', () => {
  it('undoes and redoes an action in one step, and leaves no step for one that changed nothing', () => {
    const l = lab();
    const [f] = l.flasks;
    const hist = new History();
    hist.mark(arrangement(l, sw));
    hist.commit(arrangement(l, sw));
    expect(hist.canUndo).toBe(false);

    hist.mark(arrangement(l, sw));
    f.pose = { ...f.pose, x: 150 };
    hist.mark(arrangement(l, sw)); // already under way: still from the start
    f.pose = { ...f.pose, x: 250 };
    hist.commit(arrangement(l, sw));
    expect(hist.canUndo).toBe(true);

    arrange(l, hist.undo(arrangement(l, sw))!);
    expect(f.pose.x).toBe(50);
    expect(hist.canUndo).toBe(false);
    arrange(l, hist.redo(arrangement(l, sw))!);
    expect(f.pose.x).toBe(250);
    expect(hist.redo(arrangement(l, sw))).toBe(null);
  });

  it('forgets what could be redone once something new is done', () => {
    const l = lab();
    const [f] = l.flasks;
    const hist = new History();
    hist.mark(arrangement(l, sw));
    f.pose = { ...f.pose, x: 150 };
    hist.commit(arrangement(l, sw));
    arrange(l, hist.undo(arrangement(l, sw))!);
    expect(hist.canRedo).toBe(true);
    hist.mark(arrangement(l, sw));
    f.label = 'x';
    hist.commit(arrangement(l, sw));
    expect(hist.canRedo).toBe(false);
  });

  it('goes back only so far', () => {
    const l = lab();
    const [f] = l.flasks;
    const hist = new History();
    for (let i = 1; i <= UNDO_DEPTH + 5; i++) {
      hist.mark(arrangement(l, sw));
      f.pose = { ...f.pose, x: i };
      hist.commit(arrangement(l, sw));
    }
    let n = 0;
    for (let a = hist.undo(arrangement(l, sw)); a; a = hist.undo(arrangement(l, sw))) {
      arrange(l, a);
      n++;
    }
    expect(n).toBe(UNDO_DEPTH);
    expect(f.pose.x).toBe(5);
  });
});
