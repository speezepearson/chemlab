import { describe, expect, it } from 'vitest';
import { heatAt } from '../chem/reactions';
import { SOLVENT_SPECIES, TARGET, pairOf, singleOf, speciesIndex } from '../chem/species';
import { paperMouth, spoutAt, standBase, toolBox, toolParts, toolStands } from './bodies';
import { STOCK, type Stocked } from './cabinet';
import { CAP, TRACE } from './config';
import { Vessel, roomFor, volume } from './flask';
import { boxesOverlap } from './physics';
import { CELL, LIFT } from './space';
import { onCell, toCell, toolAnchor } from './testLayout';
import {
  ATOM_PLACE, Blotter, DRIP, SECTOR_ATOMS, SHAPES, STRIP, TEST_PAPER, Tool, atomSector, composition, mouthBelow, overMouth, paperReading, paperTriangles,
  sectorInset, wetness,
} from './tools';

const R = singleOf('R');
const G = singleOf('G');
const B = singleOf('B');
const K = singleOf('K');
const S = SOLVENT_SPECIES;
const RG = pairOf('R', 'G');

/** A fluid of these species, each this much by volume. */
function fluid(fill: [number, number][]): Vessel {
  const v = new Vessel(Infinity);
  for (const [s, room] of fill) v.setMolecules(s, room / roomFor(s));
  return v;
}

/** How much the sheet of these readings soaks up: the fluids below are measured against it. */
const FULL = 1e6;
/** What the one triangle of a sheet that soaks up FULL reads for a fluid: how strongly R, G, B and K are stained. */
const read = (fill: [number, number][]) => paperReading(fluid(fill), FULL)[0];

/** A sheet lying on a counter with its middle over (x, z), facing `yaw`. */
const lying = (x: number, z: number, yaw = 0) => new Tool('testpaper', 0, { x, y: LIFT + TEST_PAPER.thick, z, yaw });

describe("test paper's reading", () => {
  it('has one triangle, for molecules of every size, with a stain for each color', () => {
    expect(TEST_PAPER.triangles).toHaveLength(1);
    expect([...TEST_PAPER.triangles[0].sizes].sort()).toEqual([1, 2, 3, 4]);
    expect(paperReading(fluid([[R, 1e6]]))).toHaveLength(1);
    // (a sheet soaks up TEST_PAPER.cap, unless told otherwise)
    expect(paperReading(fluid([[R, TEST_PAPER.cap / 4]]))[0][0]).toBeCloseTo(0.25, 9);
    expect(read([[R, 1e6]])).toHaveLength(SECTOR_ATOMS.length);
  });

  it('stains a single color fully, soaked in it, and only that one', () => {
    expect(read([[R, 1e6]])).toEqual([1, 0, 0, 0]);
    expect(read([[G, 1e6]])).toEqual([0, 1, 0, 0]);
    expect(read([[B, 1e6]])).toEqual([0, 0, 1, 0]);
    expect(read([[K, 1e6]])).toEqual([0, 0, 0, 1]);
  });

  it("stains each of a pair's colors fully, soaked in it", () => {
    expect(read([[RG, 1e6]])).toEqual([1, 1, 0, 0]);
    expect(read([[pairOf('B', 'K'), 1e6]])).toEqual([0, 0, 1, 1]);
  });

  it("stains all three of a triangle's colors fully, and all four of a molecule of four", () => {
    expect(read([[TARGET, 1e6]])).toEqual([1, 1, 1, 0]);
    expect(read([[speciesIndex(['R', 'G', 'B', 'K'], 63), 1e6]])).toEqual([1, 1, 1, 1]);
  });

  it('stains by the share of a mix it is soaked in that has each color, whatever the size of the molecule it is in', () => {
    // 20% R, 20% G, 30% B and 30% R–G: half of it has an R, half a G, and three tenths a B
    const r = read([[R, 0.2e6], [G, 0.2e6], [B, 0.3e6], [RG, 0.3e6]]);
    [0.5, 0.5, 0.3, 0].forEach((want, c) => expect(r[c]).toBeCloseTo(want, 9));
    // black shows with the rest
    const k = read([[K, 0.25e6], [pairOf('R', 'K'), 0.25e6], [G, 0.5e6]]);
    [0.25, 0.5, 0, 0.5].forEach((want, c) => expect(k[c]).toBeCloseTo(want, 9));
  });

  it('is blind to the solvent, which still takes up room: a diluted fluid stains fainter', () => {
    expect(read([[S, 1e6]])).toEqual([0, 0, 0, 0]);
    const r = read([[R, 0.5e6], [S, 0.5e6]]);
    [0.5, 0, 0, 0].forEach((want, c) => expect(r[c]).toBeCloseTo(want, 9));
    // a tenth as strong, a tenth as stained
    expect(read([[RG, 0.1e6], [S, 0.9e6]])[1]).toBeCloseTo(0.1, 9);
  });

  it('goes by how much it holds, too: a little of a fluid stains as that fluid does, only fainter by how little', () => {
    const mix = (v: number): [number, number][] => [[R, 0.25 * v], [RG, 0.5 * v], [S, 0.25 * v]];
    const soaked = read(mix(FULL));
    expect(soaked[0]).toBeCloseTo(0.75, 9);
    expect(soaked[1]).toBeCloseTo(0.5, 9);
    for (const part of [0.5, 0.1, 0.02]) read(mix(part * FULL)).forEach((x, c) => expect(x).toBeCloseTo(part * soaked[c], 9));
    // so a drop or two is much fainter than a soaking, and twice as much twice as strong
    expect(read(mix(0.04 * FULL))[0]).toBeCloseTo(2 * read(mix(0.02 * FULL))[0], 9);
    expect(read(mix(0.02 * FULL))[0]).toBeLessThan(0.02);
    // and it's the amount with each color, over what the sheet soaks up
    expect(read([[R, 0.3 * FULL]])).toEqual([0.3, 0, 0, 0]);
    expect(read([[R, 0.3 * FULL], [S, 0.7 * FULL]])).toEqual(read([[R, 0.3 * FULL]]));
    // never more than fully stained
    expect(read(mix(9 * FULL))).toEqual([1, 1, 0, 0]);
  });

  it('reads nothing for no fluid', () => {
    expect(paperReading(new Vessel(Infinity))).toEqual([[0, 0, 0, 0]]);
  });

  it("is the reading by size and color with the sizes put together, and is one a size with a triangle for each", () => {
    const f = fluid([[R, 0.2e6], [RG, 0.3e6], [TARGET, 0.5e6]]);
    const bySize = composition(f, volume(f));
    paperReading(f, volume(f))[0].forEach((x, c) => expect(x).toBeCloseTo(bySize[c] + bySize[4 + c] + bySize[8 + c] + bySize[12 + c], 9));
    // four triangles in a row, one per size, are only a longer list
    const one = TEST_PAPER.triangles;
    TEST_PAPER.triangles = [1, 2, 3, 4].map((w) => ({ sizes: [w] }));
    try {
      const rows = paperReading(f, volume(f));
      expect(rows).toHaveLength(4);
      rows.forEach((row, w) => row.forEach((x, c) => expect(x).toBeCloseTo(bySize[4 * w + c], 9)));
      expect(rows[0][0]).toBeCloseTo(0.2, 9);
      expect(rows[1].slice(0, 2).every((x) => Math.abs(x - 0.3) < 1e-9)).toBe(true);
      const tris = paperTriangles();
      expect(tris).toHaveLength(4);
      // in a row from the left, clear of each other and of the sheet's edges
      tris.forEach((t, i) => {
        if (i) expect(t.x - tris[i - 1].x).toBeGreaterThanOrEqual(t.r * Math.sqrt(3) + TEST_PAPER.edge - 1e-9);
        expect(t.x - (t.r * Math.sqrt(3)) / 2).toBeGreaterThanOrEqual(-TEST_PAPER.w / 2 + TEST_PAPER.edge - 1e-9);
        expect(t.x + (t.r * Math.sqrt(3)) / 2).toBeLessThanOrEqual(TEST_PAPER.w / 2 - TEST_PAPER.edge + 1e-9);
      });
    } finally {
      TEST_PAPER.triangles = one;
    }
  });
});

describe("test paper's print", () => {
  it('is a triangle on its base, in the middle of the sheet, within its edges', () => {
    const [t] = paperTriangles();
    const { w, d, edge } = TEST_PAPER;
    const corners = (['G', 'R', 'B'] as const).map((a) => ({ x: t.x + t.r * ATOM_PLACE[a][0], y: t.y + t.r * ATOM_PLACE[a][1] }));
    for (const p of corners) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(w / 2 - edge + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(d / 2 - edge + 1e-9);
    }
    // G's corner is at the back, R's and B's level at the front, left and right; and it's centered
    expect(corners[0].y).toBeLessThan(corners[1].y);
    expect(corners[1].y).toBeCloseTo(corners[2].y, 9);
    expect(corners[1].x).toBeLessThan(corners[2].x);
    expect(t.x).toBeCloseTo(0, 9);
    expect(Math.min(...corners.map((p) => p.y)) + Math.max(...corners.map((p) => p.y))).toBeCloseTo(0, 9);
    // as big as fits
    expect(Math.max(...corners.map((p) => Math.abs(p.x)))).toBeCloseTo(w / 2 - edge, 9);
  });

  it("cuts a triangle into four equal ones, each corner's atom at its corner and K upside down in the middle", () => {
    const area = (ps: (readonly [number, number])[]) =>
      Math.abs((ps[1][0] - ps[0][0]) * (ps[2][1] - ps[0][1]) - (ps[2][0] - ps[0][0]) * (ps[1][1] - ps[0][1])) / 2;
    const whole = area((['G', 'B', 'R'] as const).map((a) => ATOM_PLACE[a]));
    for (const a of SECTOR_ATOMS) {
      const s = atomSector(a);
      expect(s).toHaveLength(3);
      expect(area(s)).toBeCloseTo(whole / 4, 9);
      // each sector is centered on its atom's place, between the corner and the middle for a corner's
      const mid = [0, 1].map((k) => (s[0][k] + s[1][k] + s[2][k]) / 3);
      const want = a === 'K' ? [0, 0] : ATOM_PLACE[a].map((v) => v / 2);
      expect(mid[0]).toBeCloseTo(want[0], 9);
      expect(mid[1]).toBeCloseTo(want[1], 9);
    }
    // the middle one points down: one corner at the bottom, two level above it
    const ys = atomSector('K').map((p) => p[1]).sort((p, q) => p - q);
    expect(ys[0]).toBeCloseTo(ys[1], 9);
    expect(ys[2]).toBeGreaterThan(ys[1]);
  });

  it("keeps each stain inside its small triangle, a margin in from its lines", () => {
    const side = (ps: (readonly [number, number])[]) => Math.hypot(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1]);
    const mid = (ps: (readonly [number, number])[]) => [0, 1].map((k) => (ps[0][k] + ps[1][k] + ps[2][k]) / 3);
    /** How far p is inside the line from a to b, on the side c is on. */
    const inside = (p: readonly [number, number], a: readonly [number, number], b: readonly [number, number], c: readonly number[]) => {
      const n = [b[1] - a[1], a[0] - b[0]];
      const len = Math.hypot(n[0], n[1]);
      const dist = (q: readonly number[]) => ((q[0] - a[0]) * n[0] + (q[1] - a[1]) * n[1]) / len;
      return dist(p) * Math.sign(dist(c));
    };
    const m = 0.06;
    for (const a of SECTOR_ATOMS) {
      const whole = atomSector(a);
      const stain = sectorInset(a, m);
      expect(sectorInset(a, 0)).toEqual(whole);
      expect(mid(stain)[0]).toBeCloseTo(mid(whole)[0], 9);
      expect(mid(stain)[1]).toBeCloseTo(mid(whole)[1], 9);
      expect(side(stain)).toBeLessThan(side(whole));
      // every corner of the stain is m inside the two sides it lies between, and further inside the third
      for (const p of stain) {
        const ds = whole.map((q, i) => inside(p, q, whole[(i + 1) % 3], mid(whole))).sort((x, y) => x - y);
        expect(ds[0]).toBeCloseTo(m, 9);
        expect(ds[1]).toBeCloseTo(m, 9);
        expect(ds[2]).toBeGreaterThan(m);
      }
      // a margin as wide as the triangle is deep leaves nothing
      expect(side(sectorInset(a, 0.25))).toBeCloseTo(0, 9);
      expect(side(sectorInset(a, 1))).toBeCloseTo(0, 9);
    }
    // on the sheet, the margin is wider than half a line, so no stain touches one
    expect(TEST_PAPER.margin).toBeGreaterThan(TEST_PAPER.line / 2);
    expect(TEST_PAPER.margin / paperTriangles()[0].r).toBeLessThan(0.25);
  });
});

describe("test paper's paper", () => {
  const source = (species: number, T = 1) => {
    const v = new Vessel(Infinity);
    v.setMolecules(species, CAP);
    v.setTemperature(T);
    return v;
  };

  it('soaks up three hundredths of a flask, three times what a wicking strip drinks, and a score of drops', () => {
    const t = new Tool('testpaper', 0);
    expect(t.paper).toHaveLength(1);
    expect(t.paper[0]).toBeInstanceOf(Blotter);
    expect(t.paper[0].cap).toBe(TEST_PAPER.cap);
    expect(TEST_PAPER.cap / CAP).toBeCloseTo(0.03, 12);
    expect(TEST_PAPER.cap / STRIP.cap).toBeCloseTo(3, 12);
    expect(Number.isInteger(TEST_PAPER.cap)).toBe(true);
    expect(volume(t.paper[0])).toBe(0);
    // a drop of single atoms is a few hundredths of it, so it takes a good many to soak it
    expect(DRIP.atoms / TEST_PAPER.cap).toBeGreaterThan(0.02);
    expect(DRIP.atoms / TEST_PAPER.cap).toBeLessThan(0.1);
  });

  it('takes up what lands on it as far as it has room, and no further, however it is poured on', () => {
    const paper: Vessel = new Tool('testpaper', 0).paper[0];
    const soaked = () => (paper as Blotter).soaked;
    const cap = TEST_PAPER.cap;
    // (told to overfill, as the engine's fill tells every vessel)
    paper.addFrom(source(R), 0.4 * cap, true);
    expect(volume(paper) / cap).toBeCloseTo(0.4, 5);
    expect(soaked()).toBe(false);
    expect(wetness(volume(paper), cap, 1)).toBeCloseTo(0.4, 5);
    paper.addFrom(source(R), 25 * cap, true);
    expect(volume(paper) / cap).toBeCloseTo(1, 5);
    expect(volume(paper) - cap).toBeLessThan(TRACE);
    expect(soaked()).toBe(true);
    expect(wetness(volume(paper), cap, 1)).toBeCloseTo(1, 5);
  });

  it('holds the first of what landed on it: once soaked, more changes nothing, and the reading stays', () => {
    const t = new Tool('testpaper', 0);
    const paper = t.paper[0];
    paper.addFrom(source(R), 0.5 * TEST_PAPER.cap, true);
    paper.addFrom(source(RG), 5 * TEST_PAPER.cap, true);
    const [was] = paperReading(paper);
    expect(was[0]).toBeCloseTo(1, 5);
    expect(was[1]).toBeCloseTo(0.5, 5);
    const held = [...paper.n];
    for (const s of [G, B, K, S, TARGET]) expect(paper.addFrom(source(s), 3 * TEST_PAPER.cap, true)).toBe(0);
    expect([...paper.n]).toEqual(held);
    expect(paperReading(paper)[0]).toEqual(was);
  });

  it('reads a single drop faintly, as hardly wet as it is, and a few drops as many times stronger', () => {
    const t = new Tool('testpaper', 0);
    const drop = new Vessel(Infinity);
    drop.addFrom(source(RG), DRIP.atoms / 2);
    t.paper[0].addFrom(drop, volume(drop), true);
    expect(volume(t.paper[0])).toBe(volume(drop));
    const wet = wetness(volume(t.paper[0]), TEST_PAPER.cap, 1);
    expect(wet).toBe(volume(drop) / TEST_PAPER.cap);
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThan(0.1);
    // all of the drop has an R and a G, so those are stained as far as the sheet is wet
    expect(paperReading(t.paper[0])).toEqual([[wet, wet, 0, 0]]);
    for (let i = 0; i < 4; i++) t.paper[0].addFrom(drop, volume(drop), true);
    expect(paperReading(t.paper[0])[0][0]).toBeCloseTo(5 * wet, 9);
  });

  it('keeps none of the heat of what it takes up', () => {
    const paper = new Tool('testpaper', 0).paper[0];
    const hot = source(R, 9);
    expect(hot.Q).toBe(heatAt(9, hot.N));
    paper.addFrom(hot, TEST_PAPER.cap / 2, true);
    expect(paper.N).toBeGreaterThan(0);
    expect(paper.Q).toBe(0);
  });

  it('has no tanks, spouts or valves, and running it does nothing to what it holds', () => {
    const t = new Tool('testpaper', 0);
    expect([t.tanks.length, t.shape.spouts.length, t.valves.length]).toEqual([0, 0, 0]);
    expect(t.shape.flat).toBe(true);
    expect(t.memory).toBeUndefined();
    t.paper[0].addFrom(source(R), 0.3 * TEST_PAPER.cap, true);
    t.paper[0].addFrom(source(G), 0.3 * TEST_PAPER.cap, true);
    const held = [...t.paper[0].n];
    for (let i = 0; i < 500; i++) expect(t.step(0.02)).toEqual([]);
    expect([...t.paper[0].n]).toEqual(held);
  });
});

describe('test paper in the room', () => {
  it("lies flat within a cell's square (see CELL), its middle over the square's middle", () => {
    expect(TEST_PAPER.w).toBeLessThanOrEqual(CELL);
    expect(TEST_PAPER.d).toBeLessThanOrEqual(CELL);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const t = lying(137, 962, yaw + 0.2);
      t.pose = onCell(t.pose, toolAnchor(t));
      expect([t.pose.x, t.pose.z]).toEqual([toCell(137), toCell(962)]);
      expect(Math.abs(Math.sin(2 * t.pose.yaw))).toBeLessThan(1e-9);
      const b = toolBox(t);
      expect([b.x, b.z]).toEqual([toCell(137), toCell(962)]);
      expect(b.y - b.hy).toBeCloseTo(LIFT, 9);
      expect(b.y + b.hy).toBeCloseTo(LIFT + TEST_PAPER.thick, 9);
      expect([b.hx, b.hz]).toEqual([TEST_PAPER.w / 2, TEST_PAPER.d / 2]);
    }
  });

  it("is thin enough to lie under the fluid in a flask that stands on it, through it", () => {
    // (a flask's fluid is drawn from 0.6 above what the flask stands on: see FLASK_FLUID in view.ts; and the sheet's
    // printed face is drawn 0.06 above the sheet)
    expect(TEST_PAPER.thick).toBeGreaterThan(0);
    expect(TEST_PAPER.thick + 0.06).toBeLessThan(0.55);
  });

  it('is solid all over, and has no stand', () => {
    const t = lying(150, 950);
    expect(toolStands(t)).toEqual([]);
    const parts = toolParts(t);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ x0: -TEST_PAPER.w / 2, x1: TEST_PAPER.w / 2, y0: 0, y1: TEST_PAPER.thick, hz: TEST_PAPER.d / 2 });
  });

  it('catches what falls anywhere on its face, and nothing that falls beside it', () => {
    const t = lying(150, 950, Math.PI / 2);
    const m = paperMouth(t);
    expect(m.v).toBe(t.paper[0]);
    expect(m.y).toBeCloseTo(LIFT + TEST_PAPER.thick, 9);
    expect(m.rim).toBeUndefined();
    const h = TEST_PAPER.w / 2;
    for (const [dx, dz] of [[0, 0], [h - 1, h - 1], [-(h - 1), h - 1], [h - 1, -(h - 1)], [-(h - 1), -(h - 1)]])
      expect(mouthBelow([m], { x: 150 + dx, y: LIFT + 200, z: 950 + dz })).toBe(m);
    for (const [dx, dz] of [[h + 1, 0], [0, h + 1], [-(h + 1), 0], [0, -(h + 1)]]) expect(overMouth(m, 150 + dx, 950 + dz)).toBe(false);
    // nothing lands on it from below
    expect(mouthBelow([m], { x: 150, y: LIFT, z: 950 })).toBeNull();
  });

  it("is clear of the base of every stand that holds a tool's spout over its middle", () => {
    const sheet = lying(150, 950);
    const kinds = (Object.keys(STOCK) as Stocked[]).filter((k) => k !== 'flask' && k !== 'scale' && k !== 'stopcock' && SHAPES[k].spouts.length > 0);
    expect(kinds.length).toBeGreaterThan(5);
    for (const kind of kinds)
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
        SHAPES[kind as keyof typeof SHAPES].spouts.forEach((_, j) => {
          const t = new Tool(kind as keyof typeof SHAPES, 1, { x: 0, y: LIFT + 300, z: 0, yaw });
          // slid so that spout j is over the sheet's middle
          const sp = spoutAt(t, j);
          t.pose = { ...t.pose, x: t.pose.x + 150 - sp.x, z: t.pose.z + 950 - sp.z };
          expect(spoutAt(t, j).x).toBeCloseTo(150, 9);
          expect(mouthBelow([paperMouth(sheet)], spoutAt(t, j))).not.toBeNull();
          const stands = toolStands(t);
          expect(stands.length).toBeGreaterThan(0);
          for (const st of stands) expect(boxesOverlap(standBase(st, LIFT), toolBox(sheet))).toBe(false);
        });
  });
});
