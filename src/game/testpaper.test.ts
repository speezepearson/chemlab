import { describe, expect, it } from 'vitest';
import { heatAt } from '../chem/reactions';
import { SOLVENT_SPECIES, TARGET, pairOf, singleOf, speciesIndex } from '../chem/species';
import { onGrid, paperMouth, spoutAt, standBase, toolAnchor, toolBox, toolParts, toolStands } from './bodies';
import { STOCK, type Stocked } from './cabinet';
import { CAP, TRACE } from './config';
import { Vessel, roomFor, volume } from './flask';
import { boxesOverlap } from './physics';
import { CELL, LIFT, toCell } from './space';
import {
  ATOM_PLACE, Blotter, DRIP, SECTOR_ATOMS, SHAPES, STRIP, TEST_PAPER, Tool, analyzerSector, composition, mouthBelow, overMouth, paperReading, paperTriangles,
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

/** What a sheet's one triangle reads for a fluid: how strongly R, G, B and K are stained. */
const read = (fill: [number, number][]) => paperReading(fluid(fill))[0];

/** A sheet lying on a counter with its middle over (x, z), facing `yaw`. */
const lying = (x: number, z: number, yaw = 0) => new Tool('testpaper', 0, { x, y: LIFT + TEST_PAPER.thick, z, yaw });

describe("test paper's reading", () => {
  it('has one triangle, for molecules of every size, with a stain for each color', () => {
    expect(TEST_PAPER.triangles).toHaveLength(1);
    expect([...TEST_PAPER.triangles[0].sizes].sort()).toEqual([1, 2, 3, 4]);
    expect(paperReading(fluid([[R, 1e6]]))).toHaveLength(1);
    expect(read([[R, 1e6]])).toHaveLength(SECTOR_ATOMS.length);
  });

  it('stains a single color fully, and only that one', () => {
    expect(read([[R, 1e6]])).toEqual([1, 0, 0, 0]);
    expect(read([[G, 1e6]])).toEqual([0, 1, 0, 0]);
    expect(read([[B, 1e6]])).toEqual([0, 0, 1, 0]);
    expect(read([[K, 1e6]])).toEqual([0, 0, 0, 1]);
  });

  it("stains each of a pair's colors fully", () => {
    expect(read([[RG, 1e6]])).toEqual([1, 1, 0, 0]);
    expect(read([[pairOf('B', 'K'), 1e6]])).toEqual([0, 0, 1, 1]);
  });

  it("stains all three of a triangle's colors fully, and all four of a molecule of four", () => {
    expect(read([[TARGET, 1e6]])).toEqual([1, 1, 1, 0]);
    expect(read([[speciesIndex(['R', 'G', 'B', 'K'], 63), 1e6]])).toEqual([1, 1, 1, 1]);
  });

  it('stains a mix by the share of it that has each color, whatever the size of the molecule it is in', () => {
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

  it('goes by shares, not by how much there is: a drop reads as a soaking does', () => {
    const mix = (v: number): [number, number][] => [[R, 0.25 * v], [RG, 0.5 * v], [S, 0.25 * v]];
    expect(read(mix(4e3))).toEqual(read(mix(4e9)));
    expect(read(mix(4e3))[0]).toBeCloseTo(0.75, 9);
  });

  it('reads nothing for no fluid', () => {
    expect(paperReading(new Vessel(Infinity))).toEqual([[0, 0, 0, 0]]);
  });

  it("is the reading by size and color with the sizes put together, and is one a size with a triangle for each", () => {
    const f = fluid([[R, 0.2e6], [RG, 0.3e6], [TARGET, 0.5e6]]);
    const bySize = composition(f, volume(f));
    paperReading(f)[0].forEach((x, c) => expect(x).toBeCloseTo(bySize[c] + bySize[4 + c] + bySize[8 + c] + bySize[12 + c], 9));
    // four triangles in a row, one per size, are only a longer list
    const one = TEST_PAPER.triangles;
    TEST_PAPER.triangles = [1, 2, 3, 4].map((w) => ({ sizes: [w] }));
    try {
      const rows = paperReading(f);
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
      const whole = analyzerSector(a);
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

  it('soaks up about what a wicking strip drinks, a hundredth of a flask', () => {
    const t = new Tool('testpaper', 0);
    expect(t.paper).toHaveLength(1);
    expect(t.paper[0]).toBeInstanceOf(Blotter);
    expect(t.paper[0].cap).toBe(TEST_PAPER.cap);
    expect(TEST_PAPER.cap).toBe(CAP / 100);
    expect(TEST_PAPER.cap).toBe(STRIP.cap);
    expect(volume(t.paper[0])).toBe(0);
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

  it('reads a single drop at full strength, hardly wet', () => {
    const t = new Tool('testpaper', 0);
    const drop = new Vessel(Infinity);
    drop.addFrom(source(RG), DRIP.atoms / 2);
    t.paper[0].addFrom(drop, volume(drop), true);
    expect(volume(t.paper[0])).toBe(volume(drop));
    expect(paperReading(t.paper[0])).toEqual([[1, 1, 0, 0]]);
    const wet = wetness(volume(t.paper[0]), TEST_PAPER.cap, 1);
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThan(0.5);
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
  it('lies flat within one grid cell, its middle over the middle of the cell', () => {
    expect(TEST_PAPER.w).toBeLessThanOrEqual(CELL);
    expect(TEST_PAPER.d).toBeLessThanOrEqual(CELL);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const t = lying(137, 962, yaw + 0.2);
      t.pose = onGrid(t.pose, toolAnchor(t));
      expect([t.pose.x, t.pose.z]).toEqual([toCell(137), toCell(962)]);
      expect(Math.abs(Math.sin(2 * t.pose.yaw))).toBeLessThan(1e-9);
      const b = toolBox(t);
      expect([b.x, b.z]).toEqual([150, 950]);
      expect(b.y - b.hy).toBeCloseTo(LIFT, 9);
      expect(b.y + b.hy).toBeCloseTo(LIFT + TEST_PAPER.thick, 9);
      expect([b.hx, b.hz]).toEqual([TEST_PAPER.w / 2, TEST_PAPER.d / 2]);
    }
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
    const kinds = (Object.keys(STOCK) as Stocked[]).filter((k) => k !== 'flask' && k !== 'scale' && SHAPES[k].spouts.length > 0);
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
