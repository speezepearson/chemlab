import { describe, expect, it } from 'vitest';
import { BOND_KEYS } from '../chem/atoms';
import { SOLVENT_SPECIES, SPECIES, TARGET, bondMask, pairOf, singleOf, speciesIndex } from '../chem/species';
import { onGrid, paperMouth, toolAnchor, toolBox, toolParts, toolStands } from './bodies';
import { ENDLESS, STOCK } from './cabinet';
import { CAP } from './config';
import { Vessel, roomFor, volume } from './flask';
import { CELL, LIFT, toCell } from './space';
import {
  ATOM_PLACE, BLOTTERS, BOND_ENDS, BOND_PAPER, Blotter, DRIP, SECTOR_ATOMS, SHAPES, TEST_PAPER, TOOL_NAMES, Tool, UNIQUE_TOOLS, bondDots, bondReading,
  bondShares, isBlotter, mouthBelow, overMouth, wetness,
} from './tools';
import { WHEELS } from './wheel';

const R = singleOf('R');
const G = singleOf('G');
const B = singleOf('B');
const K = singleOf('K');
const S = SOLVENT_SPECIES;
const RG = pairOf('R', 'G');
const RK = pairOf('R', 'K');
/** The ring of R, G and K. */
const RGK = speciesIndex(['R', 'G', 'K'], bondMask(['R', 'G'], ['R', 'K'], ['G', 'K']));
/** The chain R–G–B. */
const R_G_B = speciesIndex(['R', 'G', 'B'], bondMask(['R', 'G'], ['G', 'B']));

/** Which line is a bond's: its place in a reading. */
const bond = (k: string) => BOND_KEYS.indexOf(k);

/** A fluid of these species, each this much by volume. */
function fluid(fill: [number, number][]): Vessel {
  const v = new Vessel(Infinity);
  for (const [s, room] of fill) v.setMolecules(s, room / roomFor(s));
  return v;
}

/** How much the sheet of these readings soaks up: the fluids below are measured against it. */
const FULL = 1e6;
/** What a sheet that soaks up FULL reads for a fluid: how far each bond's line has darkened, by the bond's name. */
const read = (fill: [number, number][]) => Object.fromEntries(bondReading(fluid(fill), FULL).map((x, b) => [BOND_KEYS[b], x]));
/** A reading with these lines darkened this far, and the rest not at all. */
const lines = (dark: Record<string, number>) => Object.fromEntries(BOND_KEYS.map((k) => [k, dark[k] ?? 0]));

/** A sheet lying on a counter with its middle over (x, z), facing `yaw`. */
const lying = (x: number, z: number, yaw = 0) => new Tool('bondpaper', 0, { x, y: LIFT + TEST_PAPER.thick, z, yaw });

describe("bond paper's reading", () => {
  it('has a line for each of the six bonds', () => {
    expect(bondReading(fluid([[RG, 1e6]]))).toHaveLength(6);
    expect(BOND_KEYS).toHaveLength(6);
    // (a sheet soaks up TEST_PAPER.cap, unless told otherwise)
    expect(bondReading(fluid([[RG, TEST_PAPER.cap / 4]]))[bond('RG')]).toBeCloseTo(0.25, 9);
  });

  it('darkens nothing for single atoms, whatever their color', () => {
    for (const s of [R, G, B, K]) expect(read([[s, 1e6]])).toEqual(lines({}));
    expect(read([[R, 0.5e6], [G, 0.5e6]])).toEqual(lines({}));
  });

  it("darkens a pair's one line fully, soaked in it, and only that one", () => {
    expect(read([[RG, 1e6]])).toEqual(lines({ RG: 1 }));
    expect(read([[RK, 1e6]])).toEqual(lines({ RK: 1 }));
    expect(read([[pairOf('B', 'K'), 1e6]])).toEqual(lines({ BK: 1 }));
  });

  it("darkens all three of a ring's lines fully, soaked in it, and both of a chain's", () => {
    expect(read([[TARGET, 1e6]])).toEqual(lines({ RG: 1, RB: 1, GB: 1 }));
    expect(read([[RGK, 1e6]])).toEqual(lines({ RG: 1, RK: 1, GK: 1 }));
    expect(read([[R_G_B, 1e6]])).toEqual(lines({ RG: 1, GB: 1 }));
  });

  it('darkens each line by the share, by volume, of the fluid it is soaked in that has its bond: just what bondShares says', () => {
    // 60% R–G, 30% R–G–B and 10% G: nine tenths has R–G, and three tenths G–B
    const mix: [number, number][] = [[RG, 0.6e6], [R_G_B, 0.3e6], [G, 0.1e6]];
    const r = read(mix);
    expect(r.RG).toBeCloseTo(0.9, 9);
    expect(r.GB).toBeCloseTo(0.3, 9);
    for (const k of ['RB', 'RK', 'GK', 'BK']) expect(r[k]).toBe(0);
    const f = fluid(mix);
    expect(bondReading(f, volume(f))).toEqual(bondShares(f, volume(f)));
    // and against what a sheet soaks up, for one that isn't soaked
    expect(bondReading(f)).toEqual(bondShares(f, TEST_PAPER.cap));
    // half R, half R–G darkens R–G's half as far
    expect(read([[R, 0.5e6], [RG, 0.5e6]]).RG).toBeCloseTo(0.5, 9);
  });

  it('is blind to the solvent, which still takes up room: a diluted fluid darkens its lines less', () => {
    expect(read([[S, 1e6]])).toEqual(lines({}));
    expect(read([[RG, 0.1e6], [S, 0.9e6]]).RG).toBeCloseTo(0.1, 9);
    const half = read([[TARGET, 0.5e6], [S, 0.5e6]]);
    for (const k of ['RG', 'RB', 'GB']) expect(half[k]).toBeCloseTo(0.5, 9);
  });

  it('goes by how much it holds, too: a little of a fluid darkens the lines that fluid does, only less by how little', () => {
    const mix = (v: number): [number, number][] => [[R, 0.25 * v], [RG, 0.5 * v], [S, 0.25 * v]];
    expect(read(mix(FULL))).toEqual(lines({ RG: 0.5 }));
    for (const part of [0.5, 0.1, 0.02]) expect(read(mix(part * FULL)).RG).toBeCloseTo(part * 0.5, 9);
    // so a drop or two is much fainter than a soaking, and twice as much twice as dark
    expect(read(mix(0.04 * FULL)).RG).toBeCloseTo(2 * read(mix(0.02 * FULL)).RG, 9);
    expect(read([[RG, 0.03 * FULL]])).toEqual(lines({ RG: 0.03 }));
    // it's the amount with each bond, over what the sheet soaks up
    expect(read([[RG, 0.3 * FULL], [S, 0.7 * FULL]])).toEqual(read([[RG, 0.3 * FULL]]));
    // never darker than fully dark
    expect(read(mix(9 * FULL))).toEqual(lines({ RG: 1 }));
  });

  it('reads nothing for no fluid, and never more than fully dark', () => {
    expect(bondReading(new Vessel(Infinity))).toEqual([0, 0, 0, 0, 0, 0]);
    for (const x of bondReading(fluid([[TARGET, 3], [RGK, 5]]))) expect(x).toBeLessThanOrEqual(1);
  });
});

describe("bond paper's print", () => {
  const dots = () => Object.fromEntries(SECTOR_ATOMS.map((a, i) => [a, bondDots()[i]])) as Record<'R' | 'G' | 'B' | 'K', { x: number; y: number }>;
  const far = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

  it('puts a dot for each color: G at the back, R at the front left, B at the front right, and K in the middle', () => {
    const d = dots();
    expect(bondDots()).toHaveLength(4);
    expect(d.G.x).toBeCloseTo(0, 9);
    expect(d.G.y).toBeLessThan(d.K.y);
    expect(d.R.y).toBeCloseTo(d.B.y, 9);
    expect(d.R.y).toBeGreaterThan(d.K.y);
    expect(d.R.x).toBeCloseTo(-d.B.x, 9);
    expect(d.R.x).toBeLessThan(0);
    // an equilateral triangle, with K at its middle
    expect(far(d.G, d.R)).toBeCloseTo(far(d.R, d.B), 9);
    expect(far(d.G, d.B)).toBeCloseTo(far(d.R, d.B), 9);
    expect(d.K.x).toBeCloseTo((d.R.x + d.G.x + d.B.x) / 3, 9);
    expect(d.K.y).toBeCloseTo((d.R.y + d.G.y + d.B.y) / 3, 9);
    // as their sectors are placed in a sheet of test paper's triangle
    const r = far(d.G, d.K);
    for (const a of SECTOR_ATOMS) {
      expect(d[a].x - d.K.x).toBeCloseTo(r * ATOM_PLACE[a][0], 9);
      expect(d[a].y - d.K.y).toBeCloseTo(r * ATOM_PLACE[a][1], 9);
    }
  });

  it('keeps every dot on the sheet, clear of its edges, as big a triangle as fits, midway front to back', () => {
    const { w, d } = TEST_PAPER;
    const { edge, dot } = BOND_PAPER;
    const ps = bondDots();
    for (const p of ps) {
      expect(Math.abs(p.x) + dot).toBeLessThanOrEqual(w / 2 - edge + 1e-9);
      expect(Math.abs(p.y) + dot).toBeLessThanOrEqual(d / 2 - edge + 1e-9);
    }
    expect(Math.max(...ps.map((p) => Math.abs(p.x))) + dot).toBeCloseTo(w / 2 - edge, 9);
    expect(Math.min(...ps.map((p) => p.y)) + Math.max(...ps.map((p) => p.y))).toBeCloseTo(0, 9);
  });

  it("joins each bond's own two dots, one line for each of the six: the triangle's sides and the three out from its middle", () => {
    expect(BOND_ENDS).toHaveLength(6);
    expect(new Set(BOND_ENDS.map(([i, j]) => [i, j].sort().join())).size).toBe(6);
    BOND_ENDS.forEach(([i, j], b) => {
      expect([SECTOR_ATOMS[i], SECTOR_ATOMS[j]].sort().join('')).toBe(BOND_KEYS[b].split('').sort().join(''));
    });
    const k = SECTOR_ATOMS.indexOf('K');
    expect(BOND_ENDS.filter((e) => e.includes(k))).toHaveLength(3);
  });

  it('stops each line short of the dots at its ends, and runs none over another dot or across another line', () => {
    const { dot, gap, line } = BOND_PAPER;
    const ps = bondDots();
    expect(gap).toBeGreaterThan(0);
    expect(line).toBeLessThan(2 * dot);
    /** How far the point p is from the stretch of line from a to b. */
    const off = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const len = far(a, b);
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len ** 2));
      return far(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    };
    /** The inked stretch of a line: between its dots, short of each. */
    const inked = ([i, j]: readonly [number, number]) => {
      const len = far(ps[i], ps[j]);
      const at = (s: number) => ({ x: ps[i].x + ((ps[j].x - ps[i].x) * s) / len, y: ps[i].y + ((ps[j].y - ps[i].y) * s) / len });
      expect(len).toBeGreaterThan(2 * (dot + gap) + 4);
      return [at(dot + gap), at(len - dot - gap)];
    };
    BOND_ENDS.forEach((e, b) => {
      const [p, q] = inked(e);
      // clear of every dot, its own two included
      for (const c of ps) expect(off(c, p, q) - line / 2).toBeGreaterThan(dot);
      // and of every other line: no two come within a line's width, so none cross
      BOND_ENDS.forEach((e2, b2) => {
        if (b2 <= b) return;
        const [p2, q2] = inked(e2);
        const near = Math.min(...[0, 0.25, 0.5, 0.75, 1].map((s) => off({ x: p2.x + (q2.x - p2.x) * s, y: p2.y + (q2.y - p2.y) * s }, p, q)));
        expect(near).toBeGreaterThan(line);
      });
    });
  });

  it('is inked very faintly dry, and all but black where everything has the bond', () => {
    const { faint, dark } = BOND_PAPER;
    expect(faint).toBeGreaterThan(0);
    expect(faint).toBeLessThanOrEqual(0.08);
    expect(dark).toBeGreaterThan(0.9);
    expect(dark).toBeLessThanOrEqual(1);
    // a tenth of what it holds having a bond darkens its line well over as far again as it's printed
    expect(faint + 0.1 * (dark - faint)).toBeGreaterThan(2 * faint);
  });
});

describe("bond paper's paper", () => {
  const source = (species: number, T = 1) => {
    const v = new Vessel(Infinity);
    v.setMolecules(species, CAP);
    v.setTemperature(T);
    return v;
  };

  it('is a sheet of test paper printed differently: the same shape, and as much soaked up', () => {
    expect([...BLOTTERS].sort()).toEqual(['bondpaper', 'testpaper']);
    expect(isBlotter('bondpaper')).toBe(true);
    expect(isBlotter('strip')).toBe(false);
    expect(SHAPES.bondpaper).toBe(SHAPES.testpaper);
    expect(TOOL_NAMES.bondpaper).toBe('Bond paper');
    const t = new Tool('bondpaper', 0);
    expect(t.paper).toHaveLength(1);
    expect(t.paper[0]).toBeInstanceOf(Blotter);
    expect(t.paper[0].cap).toBe(TEST_PAPER.cap);
    expect(volume(t.paper[0])).toBe(0);
    expect([t.tanks.length, t.shape.spouts.length, t.valves.length]).toEqual([0, 0, 0]);
    expect(t.shape.flat).toBe(true);
    expect(t.memory).toBeUndefined();
  });

  it('is on the first equipment wheel and in the cabinet, a stack that never runs out, and not one of a kind', () => {
    expect(WHEELS[0]).toContain('bondpaper');
    expect(WHEELS[1]).not.toContain('bondpaper');
    expect(ENDLESS).toContain('bondpaper');
    expect(STOCK.bondpaper).toBe(STOCK.testpaper);
    expect(UNIQUE_TOOLS).not.toContain('bondpaper');
  });

  it('holds the first of what landed on it: once soaked, more changes nothing, and its lines stay as they are', () => {
    const t = new Tool('bondpaper', 0);
    const paper = t.paper[0];
    paper.addFrom(source(R), 0.5 * TEST_PAPER.cap, true);
    expect(bondReading(paper)).toEqual([0, 0, 0, 0, 0, 0]);
    paper.addFrom(source(RG), 5 * TEST_PAPER.cap, true);
    expect((paper as Blotter).soaked).toBe(true);
    const was = bondReading(paper);
    expect(was[bond('RG')]).toBeCloseTo(0.5, 5);
    const held = [...paper.n];
    for (const s of [G, B, K, S, TARGET, RK]) expect(paper.addFrom(source(s), 3 * TEST_PAPER.cap, true)).toBe(0);
    expect([...paper.n]).toEqual(held);
    expect(bondReading(paper)).toEqual(was);
    // and running it does nothing to what it holds
    for (let i = 0; i < 200; i++) expect(t.step(0.02)).toEqual([]);
    expect([...paper.n]).toEqual(held);
    expect(paper.Q).toBe(0);
  });

  it('is never overfilled by a mixture, however the shares of its species round', () => {
    const mix = new Vessel(Infinity);
    [R, G, B, K, RG, RK, TARGET].forEach((s, i) => mix.setMolecules(s, CAP / (3 + 2 * i)));
    for (let i = 0; i < 300; i++) {
      const paper = new Tool('bondpaper', i).paper[0] as Blotter;
      paper.addFrom(mix, TEST_PAPER.cap / 3);
      paper.addFrom(mix, 7 * TEST_PAPER.cap);
      expect(volume(paper)).toBeLessThanOrEqual(TEST_PAPER.cap);
      expect(paper.soaked).toBe(true);
      expect([...paper.n].every(Number.isInteger)).toBe(true);
      // and its atoms are still those of its molecules
      expect(paper.N).toBe(SPECIES.reduce((t, sp) => t + paper.n[sp.i] * sp.size, 0));
    }
  });

  it('reads a single drop faintly, as hardly wet as it is, and a few drops as many times darker', () => {
    const t = new Tool('bondpaper', 0);
    const drop = new Vessel(Infinity);
    drop.addFrom(source(TARGET), DRIP.atoms / 2);
    t.paper[0].addFrom(drop, volume(drop), true);
    expect(volume(t.paper[0])).toBe(volume(drop));
    const wet = wetness(volume(t.paper[0]), TEST_PAPER.cap, 1);
    expect(wet).toBe(volume(drop) / TEST_PAPER.cap);
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThan(0.1);
    // all of the drop has the ring's three bonds, so their lines darken as far as the sheet is wet
    const r = bondReading(t.paper[0]);
    for (const k of ['RG', 'RB', 'GB']) expect(r[bond(k)]).toBe(wet);
    for (const k of ['RK', 'GK', 'BK']) expect(r[bond(k)]).toBe(0);
    for (let i = 0; i < 4; i++) t.paper[0].addFrom(drop, volume(drop), true);
    expect(bondReading(t.paper[0])[bond('RG')]).toBeCloseTo(5 * wet, 9);
  });
});

describe('bond paper in the room', () => {
  it('lies flat within one grid cell, its middle over the middle of the cell, solid all over, with no stand', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const t = lying(137, 962, yaw + 0.2);
      t.pose = onGrid(t.pose, toolAnchor(t));
      expect([t.pose.x, t.pose.z]).toEqual([toCell(137), toCell(962)]);
      const b = toolBox(t);
      expect([b.x, b.z]).toEqual([150, 950]);
      expect(b.y - b.hy).toBeCloseTo(LIFT, 9);
      expect(b.y + b.hy).toBeCloseTo(LIFT + TEST_PAPER.thick, 9);
      expect([b.hx, b.hz]).toEqual([TEST_PAPER.w / 2, TEST_PAPER.d / 2]);
      expect(2 * Math.max(b.hx, b.hz)).toBeLessThanOrEqual(CELL);
    }
    const t = lying(150, 950);
    expect(toolStands(t)).toEqual([]);
    expect(toolParts(t)).toEqual(toolParts(new Tool('testpaper', 1, t.pose)));
  });

  it('catches what falls anywhere on its face, and nothing that falls beside it', () => {
    const t = lying(150, 950, Math.PI / 2);
    const m = paperMouth(t);
    expect(m.v).toBe(t.paper[0]);
    expect(m.y).toBeCloseTo(LIFT + TEST_PAPER.thick, 9);
    const h = TEST_PAPER.w / 2;
    for (const [dx, dz] of [[0, 0], [h - 1, h - 1], [-(h - 1), -(h - 1)]])
      expect(mouthBelow([m], { x: 150 + dx, y: LIFT + 200, z: 950 + dz })).toBe(m);
    for (const [dx, dz] of [[h + 1, 0], [0, h + 1], [-(h + 1), 0], [0, -(h + 1)]]) expect(overMouth(m, 150 + dx, 950 + dz)).toBe(false);
  });
});
