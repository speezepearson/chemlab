import { SPECIES } from '../chem/species';
import type { Block } from '../intro/notice';
import { GOAL_PURITY } from './config';
import { volume } from './flask';
import { SCALE_SHAPE, type Scale } from './scale';
import {
  ANALYZER, analyzerSector, BOND_ENDS, bondPoint, COLUMN, columnInk, cultureCells, INSTRUMENT, METER_BODY, METER_DIGITS, meterText, needleAt,
  SECTOR_ATOMS, SPECTROSCOPE, spectroscopeAt, spectroscopeTop, spectroscopeUnit, spectroscopeY, STATION, STRIP, stripInk,
  THERMOMETER_ROD, THERMOMETERS, wetness, type ThermometerKind, type Tool,
} from './tools';

/**
 * What's drawn on the lab's screens and printed surfaces, onto plain 2D canvases, with nothing three-dimensional about
 * it: the instruments' screens, the strip's and the column's inks, a thermometer's scale, a sleeper culture's cells,
 * the seven-segment readouts, the station's needle, diverter and readouts, the pod's message, and the plates and
 * tape round the lab. The wall view (view.ts) lays these canvases on its meshes as textures; the flat view (view2d.ts)
 * draws them straight onto its own canvas. So there's one copy of how each of them looks.
 */

/**
 * A canvas something's drawn on, `ppu` pixels per world unit, and what was last drawn on it (`key`), so each function
 * here draws only when what it shows has changed; it calls `changed` when it has.
 */
export interface Board {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly ppu: number;
  key: string;
  changed(): void;
}

/** A new board for something w by h world units, `ppu` pixels per unit, for drawing straight from (nothing to tell when it changes). */
export function board(w: number, h: number, ppu: number): Board {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * ppu));
  canvas.height = Math.max(1, Math.round(h * ppu));
  return { canvas, ctx: canvas.getContext('2d')!, ppu, key: '', changed: () => {} };
}

/** A CRT's phosphor green. */
export const PHOSPHOR = '64, 255, 110';

/** The station's gauge's segments: lit green for what's held, red for what's wanted (flashing), and dark. */
export const SEGMENT_COLORS = { held: 0x3cff6a, wanted: 0xff3a2e, off: 0x1d2a21 } as const;

/** The heater's wire as its dial turns up, at even steps from 0 to 1: copper, then glowing red, orange, yellow, white. */
export const WIRE_RAMP: readonly (readonly number[])[] = [[184, 115, 51], [196, 62, 38], [255, 96, 30], [255, 192, 84], [255, 250, 236]];

/** The heater's wire's color at dial setting d (see WIRE_RAMP), 0–255 per channel. */
export function wireColor(d: number): number[] {
  const x = Math.max(0, Math.min(1, d)) * (WIRE_RAMP.length - 1);
  const i = Math.min(WIRE_RAMP.length - 2, Math.floor(x));
  return WIRE_RAMP[i].map((c, k) => c + (WIRE_RAMP[i + 1][k] - c) * (x - i));
}

/**
 * The supply station's diverter's LCD: a pipe down from the funnel, branching off toward the reservoir, with
 * the diverter's flap across whichever way it isn't sending what comes through, and that way lit while anything's
 * going through: green into the reservoir, red down to the waste spigot, filling the pipe right up to its walls; the
 * rest of the pipes black inside. Only the pipes, the flap and what's in them are drawn, straight on the plate.
 */
export function drawDiverter(sc: Board, gate: 'reservoir' | 'waste', flowing: boolean): void {
  const key = `${gate} ${flowing}`;
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const d = STATION.display;
  const [w, h] = [d.x1 - d.x0, d.y1 - d.y0];
  ctx.setTransform(ppu, 0, 0, ppu, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // the pipes' centerlines, in the display's frame: down from the top, with the branch leaving at j, down and
  // across at 45°, then straight across to the edge toward the reservoir; the pipe down is right under the funnel's
  // stem, in the display's middle
  const x = w / 2;
  const j = 14;
  const down: [number, number][] = [[x, 0], [x, h]];
  const branch: [number, number][] = [[x, j], [x + 10, j + 10], [w, j + 10]];
  const stroke = (pts: [number, number][], width: number, color: string) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  // their walls: each stroked wide in the walls' color, then filled black inside, and the way it's sending lit
  // right up to the walls
  const wallColor = 'rgba(200, 222, 210, 0.75)';
  for (const p of [down, branch]) stroke(p, 9, wallColor);
  for (const p of [down, branch]) stroke(p, 6, '#000');
  if (flowing)
    stroke(gate === 'reservoir' ? [[x, 0], ...branch] : down, 6, gate === 'reservoir' ? '#3cff6a' : '#ff3a2e');
  // the flap: along the branch's lower wall, across the pipe below it; or across the branch's mouth
  ctx.lineCap = 'round';
  stroke(gate === 'reservoir' ? [[x - 3, j + 1.2], [x + 3, j + 7.2]] : [[x + 2.9, j + 7.1], [x + 7.1, j + 2.9]], 1.6, wallColor);
  sc.changed();
}

/**
 * A gradient down a canvas L tall through C stretches of a strip's paper or a column's bed, each `color(c)` at its
 * middle, `at(c)` of the way down, blended smoothly between them, and the ends held out to the canvas's.
 */
export function cellGradient(ctx: CanvasRenderingContext2D, L: number, C: number, at: (c: number) => number, color: (c: number) => string): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, 0, L);
  const order = Array.from({ length: C }, (_, c) => c).sort((a, b) => at(a) - at(b));
  order.forEach((c, i) => {
    if (i === 0) g.addColorStop(0, color(c));
    g.addColorStop(at(c), color(c));
    if (i === C - 1) g.addColorStop(1, color(c));
  });
  return g;
}

/**
 * How wet the stretches of a strip's paper or a column's bed look, from how wet each is (see wetness), but the one the
 * liquid comes in at drawn as wet as the next: it fills as liquid comes in and empties each time what's on it moves on
 * (see Bed), which would otherwise show as a flicker.
 */
export function entryWet(wet: number[]): number[] {
  if (wet.length > 1) wet[0] = Math.max(wet[0], wet[1]);
  return wet;
}

/**
 * A wicking strip's paper's outline on its canvas, W across and L tall, foot at the bottom: its sides straight down,
 * and its last STRIP.paper.point narrowing to a point at its foot.
 */
export function paperOutline(ctx: CanvasRenderingContext2D, W: number, L: number): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, L - STRIP.paper.point);
  ctx.lineTo(W / 2, L);
  ctx.lineTo(0, L - STRIP.paper.point);
  ctx.closePath();
}

/**
 * A wicking strip's paper, foot at the bottom, cut to a point there: cream, darker as far as each stretch of it is wet
 * (see wetness), by what's on it; each species on each stretch of it (see Tool.paper) as ink of its own
 * color, as opaque as stripInk says, single atoms first, so what's left in bands lies over the carrier's tint; both
 * blended smoothly from one stretch's middle to the next, except for a spot that has yet to move, which is drawn
 * stretch by stretch, so its top is a line, where the fluid's surface was; lines marked across its edges, over all
 * that (see drawMarks); and each stretch browned over by how scorched it is (see Tool.scorch), stretch by stretch too,
 * so that ends at a line as well. Nothing's drawn outside its outline.
 */
export function drawStrip(sc: Board, t: Tool): void {
  const { paper } = t;
  const C = paper.length;
  let sum = 0;
  paper.forEach((v, c) => (sum += v.N * (c + 1)));
  let char = 0;
  t.scorch.forEach((x, c) => (char += x * (c + 1)));
  const key = `${sum} ${t.soaked > 0} ${char.toFixed(2)}`;
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const [W, L] = [2 * STRIP.paper.w, STRIP.paper.len];
  const at = (c: number) => 1 - (c + 0.5) / C;
  // till the paper's drunk anything, what's on it is a spot, just where it was dipped: nothing's run to blend
  const spot = t.soaked === 0;
  const wet = spot ? paper.map((v) => wetness(volume(v), STRIP.cap, C)) : entryWet(paper.map((v) => wetness(volume(v), STRIP.cap, C)));
  ctx.setTransform(ppu, 0, 0, ppu, 0, 0);
  ctx.clearRect(0, 0, W, L);
  ctx.save();
  paperOutline(ctx, W, L);
  ctx.clip();
  ctx.fillStyle = '#e6dfc8';
  ctx.fillRect(0, 0, W, L);
  // each stretch's own part of the paper, filled edge to edge, wherever it's to show at all
  const cells = (alpha: (c: number) => number, rgb: string) => {
    for (let c = 0; c < C; c++) {
      const a = alpha(c);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(${rgb}, ${a})`;
      ctx.fillRect(0, L * (1 - (c + 1) / C), W, L / C);
    }
  };
  // blended from each stretch's middle to the next's, or, for a spot, stretch by stretch
  const lay = (alpha: (c: number) => number, rgb: string) => {
    if (spot) return cells(alpha, rgb);
    ctx.fillStyle = cellGradient(ctx, L, C, at, (c) => `rgba(${rgb}, ${alpha(c)})`);
    ctx.fillRect(0, 0, W, L);
  };
  if (wet.some((w) => w > 0)) lay((c) => 0.28 * wet[c], '96, 92, 78');
  const here = SPECIES.map((_, s) => s).filter((s) => paper.some((v) => v.n[s] > 0));
  here.sort((a, b) => SPECIES[a].size - SPECIES[b].size);
  for (const s of here) lay((c) => stripInk(s, paper[c].n[s]), SPECIES[s].color.slice(4, -1));
  // printed on the paper, so over what's run up it, and under where it's scorched
  drawMarks(ctx, W, L, STRIP.marks);
  cells((c) => 0.92 * t.scorch[c], '46, 28, 14');
  ctx.restore();
  sc.changed();
}

/**
 * How the lines marked along a wicking strip's paper and a column's bed are drawn, in local units: `w` thick; on
 * paper, across each edge, `len` in from it, and `long` in for every `every`th; round a bed, right round it, every
 * `every`th `thick` times as thick.
 */
export const MARKS = { len: 1.8, long: 3.2, every: 5, w: 0.3, thick: 2.2, color: 'rgba(52, 46, 38, 0.7)' };

/**
 * Lines marked on a strip of paper, or round a bed, W across and L long, dividing its length into `n` equal parts, to
 * read off how far along it something has run: on paper, across both its edges, every fifth longer; `round` a bed
 * (whose canvas runs right round it), rings, every fifth thicker. Nothing's marked at its ends.
 */
export function drawMarks(ctx: CanvasRenderingContext2D, W: number, L: number, n: number, round = false): void {
  ctx.strokeStyle = MARKS.color;
  for (let k = 1; k < n; k++) {
    const y = (L * k) / n;
    const fifth = k % MARKS.every === 0;
    ctx.lineWidth = round && fifth ? MARKS.w * MARKS.thick : MARKS.w;
    const len = round ? W / 2 : fifth ? MARKS.long : MARKS.len;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(len, y);
    ctx.moveTo(W, y);
    ctx.lineTo(W - len, y);
    ctx.stroke();
  }
}

/** Where a thermometer's capillary runs across its rod, in its own frame, left of the middle, with its scale's ticks right of it. */
export const CAPILLARY_X = -1.4;

/**
 * A column's bed, its top at the top: the paper's cream, darker as far as each stretch of it is wet (see wetness), by
 * what's on it; each species on each stretch (see Tool.bed) as ink of its own color, as opaque as columnInk says,
 * single atoms first, so bands lie over the carrier's tint; both blended smoothly from one stretch's middle to the next;
 * and lines marked round it, over all that (see drawMarks).
 */
export function drawColumn(sc: Board, t: Tool): void {
  const { bed } = t;
  const C = bed.length;
  let sum = 0;
  bed.forEach((v, c) => (sum += v.N * (c + 1)));
  const key = `${sum}`;
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const [W, L] = [sc.canvas.width / ppu, sc.canvas.height / ppu];
  const at = (c: number) => (c + 0.5) / C;
  ctx.setTransform(ppu, 0, 0, ppu, 0, 0);
  ctx.fillStyle = '#e6dfc8';
  ctx.fillRect(0, 0, W, L);
  const wet = entryWet(bed.map((v) => wetness(volume(v), COLUMN.cap, C)));
  if (wet.some((w) => w > 0)) {
    ctx.fillStyle = cellGradient(ctx, L, C, at, (c) => `rgba(96, 92, 78, ${0.28 * wet[c]})`);
    ctx.fillRect(0, 0, W, L);
  }
  const here = SPECIES.map((_, s) => s).filter((s) => bed.some((v) => v.n[s] > 0));
  here.sort((a, b) => SPECIES[a].size - SPECIES[b].size);
  for (const s of here) {
    const rgb = SPECIES[s].color.slice(4, -1);
    ctx.fillStyle = cellGradient(ctx, L, C, at, (c) => `rgba(${rgb}, ${columnInk(s, bed[c].n[s])})`);
    ctx.fillRect(0, 0, W, L);
  }
  drawMarks(ctx, W, L, COLUMN.marks, true);
  sc.changed();
}

/**
 * A thermometer's scale, on the white enamel backing inside its rod (see THERMOMETER_ROD): from 0 at its foot to the
 * kind's top at its top, evenly (see thermometerAt), a tick every `tick` right of where the capillary runs, those at
 * every `long` longer, and those at every `num` numbered at the backing's right edge (see THERMOMETERS). It's drawn
 * once.
 */
export function drawThermometerScale(sc: Board, kind: ThermometerKind): void {
  const { ctx, ppu } = sc;
  const { backing: b, foot, top: y1 } = THERMOMETER_ROD;
  const { top, tick, long, num } = THERMOMETERS[kind];
  // the screen covers the backing, in the rod's own frame
  ctx.setTransform(ppu, 0, 0, ppu, (b.w / 2) * ppu, -b.y0 * ppu);
  ctx.fillStyle = '#f1efe6';
  ctx.fillRect(-b.w / 2, b.y0, b.w, b.y1 - b.y0);
  ctx.strokeStyle = ctx.fillStyle = '#1e201f';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '700 3.2px "Schibsted Grotesk", sans-serif';
  const x = CAPILLARY_X + 0.45;
  const [L, M] = [Math.round(long / tick), Math.round(num / tick)];
  for (let i = 0; i <= Math.round(top / tick); i++) {
    const y = foot - ((i * tick) / top) * (foot - y1);
    ctx.lineWidth = i % L ? 0.2 : 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (i % L ? 0.55 : 1.1), y);
    ctx.stroke();
    // squeezed to fit beside the ticks, if it has to be
    if (i % M === 0) ctx.fillText(String(Math.round(i * tick)), b.w / 2 - 0.05, y + 0.15, b.w / 2 - 0.05 - (x + 1.3));
  }
  sc.changed();
}

/** How long a sleeper culture's cell is shown dying, swollen and amber, in sim seconds. */
export const DYING = 1.2;

/** How far the station's needle swings, from its left stop to its right, in radians, about straight up. */
export const NEEDLE_SWEEP = (140 * Math.PI) / 180;

/**
 * The supply station's needle: an enamel dial with no words or numbers, a needle swinging across it from its
 * left stop (see needleAt), evenly spaced ticks, and a red line where the diverter's line is, with a green band from
 * there to the right stop. `u` is how far across the needle stands, from 0 to 1 (see Tool.needle).
 */
export function drawNeedle(sc: Board, u: number): void {
  const key = u.toFixed(3);
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const d = STATION.needle;
  const [w, h] = [d.x1 - d.x0, d.y1 - d.y0];
  ctx.setTransform(ppu, 0, 0, ppu, 0, 0);
  ctx.fillStyle = '#d6d1be';
  ctx.fillRect(0, 0, w, h);
  const [cx, cy] = [w / 2, h - 7];
  const r = Math.min(w / 2 - 4, cy - 5);
  // where on the dial u is, at radius q: from the pivot, swung (u − ½) of the sweep from straight up
  const at = (v: number, q: number): [number, number] => {
    const a = (v - 0.5) * NEEDLE_SWEEP;
    return [cx + q * Math.sin(a), cy - q * Math.cos(a)];
  };
  const arc = (from: number, to: number, q: number, width: number, color: string) => {
    ctx.beginPath();
    ctx.arc(cx, cy, q, -Math.PI / 2 + (from - 0.5) * NEEDLE_SWEEP, -Math.PI / 2 + (to - 0.5) * NEEDLE_SWEEP);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  const line = (a: [number, number], b: [number, number], width: number, color: string) => {
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  ctx.lineCap = 'butt';
  const pass = needleAt(GOAL_PURITY);
  arc(0, 1, r, 0.5, '#3b3a34');
  arc(pass, 1, r - 2, 3, '#3f9a55');
  for (let i = 0; i <= 10; i++) line(at(i / 10, r), at(i / 10, r - (i % 5 ? 2.5 : 4)), 0.5, '#3b3a34');
  line(at(pass, r + 1.5), at(pass, r - 5.5), 1.1, '#c8372d');
  // the needle, over a little round cap on its pivot
  ctx.lineCap = 'round';
  line(at(u, -3), at(u, r - 1), 0.9, '#17161a');
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, 2 * Math.PI);
  ctx.fillStyle = '#17161a';
  ctx.fill();
  sc.changed();
}

/**
 * A composition analyzer's screen: a triangle per molecule size (1 to 4 atoms), each cut into four smaller ones, one
 * per color (see analyzerSector): its three corners, and the upside-down one in the middle. Each glows as bright as its
 * share of what it's reading, and is dark while it has nothing to read. No words, no lines between the sectors: reading
 * it is part of the game.
 */
export function drawAnalysis(sc: Board, t: Tool): void {
  const key = t.reading?.map((x) => x.toFixed(2)).join(',') ?? '';
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const { screen: s } = INSTRUMENT;
  const { triangles } = ANALYZER;
  const n = SECTOR_ATOMS.length;
  const sectors = SECTOR_ATOMS.map(analyzerSector);
  const outline = (['G', 'B', 'R'] as const).map((a) => analyzerSector(a)[0]);
  const green = (a: number) => `rgba(${PHOSPHOR}, ${a})`;
  ctx.setTransform(ppu, 0, 0, ppu, -s.x0 * ppu, -s.y0 * ppu);
  ctx.fillStyle = '#040a06';
  ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  triangles.xs.forEach((cx, w) => {
    const { y: cy, r } = triangles;
    const path = (ps: readonly (readonly [number, number])[]) => {
      ctx.beginPath();
      for (const [dx, dy] of ps) ctx.lineTo(cx + r * dx, cy + r * dy);
      ctx.closePath();
    };
    if (t.reading)
      for (let j = 0; j < n; j++) {
        const b = Math.min(1, t.reading[w * n + j]);
        if (b <= 0) continue;
        ctx.fillStyle = ctx.shadowColor = green(b);
        ctx.shadowBlur = 5 * ppu;
        path(sectors[j]);
        ctx.fill();
      }
    ctx.shadowColor = green(0.85);
    ctx.shadowBlur = 2 * ppu;
    ctx.strokeStyle = green(0.85);
    ctx.lineWidth = 0.9;
    path(outline);
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  for (let y = s.y0; y < s.y1; y += 1.5) ctx.fillRect(s.x0, y, s.x1 - s.x0, 0.6);
  sc.changed();
}

/**
 * A bond visualizer's screen: four points, one per atom, at the corners and the middle of a triangle (see bondPoint), and a line between two of them
 * for each bond between those atoms going by, glowing as bright as the share of what's passing that has that bond (see
 * bondShares); just the points while it has nothing to read. No words: reading it is part of the game.
 */
export function drawBonds(sc: Board, t: Tool): void {
  const key = t.links?.map((x) => x.toFixed(2)).join(',') ?? '';
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const s = INSTRUMENT.screen;
  const green = (a: number) => `rgba(${PHOSPHOR}, ${a})`;
  ctx.setTransform(ppu, 0, 0, ppu, -s.x0 * ppu, -s.y0 * ppu);
  ctx.fillStyle = '#040a06';
  ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  if (t.links)
    BOND_ENDS.forEach(([i, j], b) => {
      const a = Math.min(1, t.links![b]);
      if (a <= 0) return;
      const [p, q] = [bondPoint(i), bondPoint(j)];
      ctx.strokeStyle = ctx.shadowColor = green(a);
      ctx.shadowBlur = 4 * ppu;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    });
  ctx.fillStyle = ctx.shadowColor = green(0.85);
  ctx.shadowBlur = 2 * ppu;
  for (let i = 0; i < SECTOR_ATOMS.length; i++) {
    const p = bondPoint(i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.8, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  for (let y = s.y0; y < s.y1; y += 1.5) ctx.fillRect(s.x0, y, s.x1 - s.x0, 0.6);
  sc.changed();
}

/** The spectroscope's number for 10^k of its f axis's unit: 1, 10, 100, ..., and under 1, .1, .01, .... */
export function fLabel(k: number): string {
  return k < 0 ? '.' + '0'.repeat(-k - 1) + '1' : String(10 ** k);
}

/**
 * A spectroscope's screen: a graph of the bonds passing through it lately, by energy (see spectroscopeAt). E, in uB,
 * runs across on a log scale, along a baseline halfway up, with ticks as on log paper (at 1 to 9 times each power of
 * ten, the powers of ten longer, and numbered along the screen's foot). f, in S with a prefix to suit the range (see spectroscopeUnit), runs up from the baseline for stable
 * bonds and down from it for uphill ones, on a log scale that ranges itself to the tallest line (see spectroscopeTop
 * and spectroscopeY), with log-paper ticks both ways along the left, the powers of ten numbered, so they slide as the
 * flow changes; clipped at the plot's top and bottom.
 */
export function drawSpectroscope(sc: Board, t: Tool, energies: readonly number[]): void {
  const key = `${t.bonds.map((c) => c.toPrecision(3)).join(',')}|${energies.join(',')}`;
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const s = INSTRUMENT.screen;
  const green = (a: number) => `rgba(${PHOSPHOR}, ${a})`;
  ctx.setTransform(ppu, 0, 0, ppu, -s.x0 * ppu, -s.y0 * ppu);
  ctx.fillStyle = '#040a06';
  ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  // the plot, inside margins for the labels: f's title above, its numbers left, E's numbers and title below
  const p = { x0: s.x0 + 13, x1: s.x1 - 5, y0: s.y0 + 8, y1: s.y1 - 8 };
  const base = (p.y0 + p.y1) / 2;
  const half = base - p.y0;
  const { lnE0, lnE1, perS } = SPECTROSCOPE;
  const X = (l: number) => p.x0 + ((l - lnE0) / (lnE1 - lnE0)) * (p.x1 - p.x0);
  const n = Math.round((p.x1 - p.x0) * ppu);
  const lines = Array.from({ length: n + 1 }, (_, i) => spectroscopeAt(lnE0 + (i / n) * (lnE1 - lnE0), t.bonds, energies));
  const top = spectroscopeTop(Math.max(0, ...lines.map((l) => Math.max(l.up, l.down))));
  const unit = spectroscopeUnit(top);
  const Y = (v: number) => base - Math.max(-1, Math.min(1, v)) * half;
  ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = green(0.75);
  ctx.shadowBlur = 1.5 * ppu;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(p.x0, p.y0);
  ctx.lineTo(p.x0, p.y1);
  ctx.moveTo(p.x0, base);
  ctx.lineTo(p.x1, base);
  ctx.stroke();
  const mono = (px: number) => `${px}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
  // the ticks' numbers smaller than the axes' titles
  ctx.font = mono(3.5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let d = Math.floor(lnE0 / Math.LN10); d <= Math.ceil(lnE1 / Math.LN10); d++)
    for (let m = 1; m <= 9; m++) {
      const e = m * 10 ** d;
      const l = Math.log(e);
      if (l < lnE0 || l > lnE1) continue;
      const tick = m === 1 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(X(l), base - tick / 2);
      ctx.lineTo(X(l), base + tick / 2);
      ctx.stroke();
      if (m === 1) ctx.fillText(String(+e.toPrecision(1)), X(l), p.y1 + 1.5);
    }
  ctx.font = mono(5);
  ctx.textAlign = 'right';
  ctx.fillText('E (uB)', p.x1, p.y1 + 1.5);
  ctx.textAlign = 'left';
  ctx.fillText(`f (${unit.name})`, s.x0 + 2, s.y0 + 1.5);
  ctx.font = mono(3.5);
  // f's ticks, the same both ways from the baseline, numbered at the powers of ten that have room
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('0', p.x0 - 2.5, base);
  if (top > 0) {
    const floor = top / 10 ** SPECTROSCOPE.decades;
    let last = 0;
    for (let d = Math.floor(Math.log10(floor / perS)); d <= Math.ceil(Math.log10(top / perS)); d++)
      for (let m = 1; m <= 9; m++) {
        const f = m * 10 ** d * perS;
        if (f < floor || f > top) continue;
        const h = spectroscopeY(f, top) * half;
        const tick = m === 1 ? 2 : 1;
        ctx.beginPath();
        for (const y of [base - h, base + h]) {
          ctx.moveTo(p.x0 - tick, y);
          ctx.lineTo(p.x0, y);
        }
        ctx.stroke();
        if (m === 1 && h >= 3 && h - last >= 3.8) {
          last = h;
          ctx.fillText(fLabel(d - unit.exp), p.x0 - 2.5, base - h);
          ctx.fillText(fLabel(d - unit.exp), p.x0 - 2.5, base + h);
        }
      }
  }
  // the curve, glowing, over a faint fill back to the baseline
  ctx.beginPath();
  ctx.moveTo(p.x0, base);
  lines.forEach((l, i) => ctx.lineTo(p.x0 + i / ppu, Y(spectroscopeY(l.up, top) - spectroscopeY(l.down, top))));
  ctx.lineTo(p.x1, base);
  ctx.fillStyle = green(0.12);
  ctx.fill();
  ctx.strokeStyle = ctx.shadowColor = green(0.95);
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  for (let y = s.y0; y < s.y1; y += 1.5) ctx.fillRect(s.x0, y, s.x1 - s.x0, 0.6);
  sc.changed();
}

/**
 * Text on a seven-segment display, right-aligned in `cells` digit cells ending at x, with its digits' tops at y:
 * lit segments glow, and unlit ones show faintly, as on a real display. Shows digits, '-', and the letters of "OUEr";
 * a '.' lights the decimal point after the digit before it.
 */
export function drawSevenSeg(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, cells: number, color: string, ghost: string, ppu: number): void {
  const W = 7;
  const H = 13;
  const PITCH = 11;
  const SEG = [
    [0, 0, W, 0], [W, 0, W, H / 2], [W, H / 2, W, H], [0, H, W, H], [0, H / 2, 0, H], [0, 0, 0, H / 2], [0, H / 2, W, H / 2],
  ];
  const LIT: Record<string, string> = {
    '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc',
    '8': 'abcdefg', '9': 'abcdfg', '-': 'g', O: 'abcdef', U: 'bcdef', E: 'adefg', r: 'eg', ' ': '',
  };
  // each cell is a character and whether the decimal point after it is lit
  const parsed: { ch: string; dp: boolean }[] = [];
  for (const ch of text) {
    if (ch === '.' && parsed.length) parsed[parsed.length - 1].dp = true;
    else parsed.push({ ch, dp: false });
  }
  while (parsed.length < cells) parsed.unshift({ ch: ' ', dp: false });
  const shown = parsed.slice(-cells);
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1.7;
  for (let i = 0; i < cells; i++) {
    const { ch, dp } = shown[i];
    const lit = LIT[ch] ?? '';
    const left = x - (cells - i) * PITCH + (PITCH - W) / 2;
    // the decimal point, at the foot of the gap after the digit
    ctx.fillStyle = dp ? color : ghost;
    ctx.shadowColor = dp ? color : 'transparent';
    ctx.shadowBlur = dp ? 3 * ppu : 0;
    ctx.beginPath();
    ctx.arc(left + W + 1.6, y + H, 1.7 * 0.6, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 7; k++) {
      const on = lit.includes('abcdefg'[k]);
      const [ax, ay, bx, by] = SEG[k];
      const sl = (yy: number) => (H - yy) * 0.12;
      const gx = ax === bx ? 0 : 1.1;
      const gy = ay === by ? 0 : 1.1;
      ctx.strokeStyle = on ? color : ghost;
      ctx.shadowColor = on ? color : 'transparent';
      ctx.shadowBlur = on ? 3 * ppu : 0;
      ctx.beginPath();
      ctx.moveTo(left + ax + gx + sl(ay + gy), y + ay + gy);
      ctx.lineTo(left + bx - gx + sl(by - gy), y + by - gy);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
}

/** Show a line of text on a green-on-black screen covering `sc`, in the tool's frame, if it isn't already. */
export function phosphor(s: Board, sc: { x0: number; x1: number; y0: number; y1: number }, text: string): void {
  if (s.key !== text) {
    s.key = text;
    s.ctx.setTransform(s.ppu, 0, 0, s.ppu, -sc.x0 * s.ppu, -sc.y0 * s.ppu);
    s.ctx.fillStyle = '#040a06';
    s.ctx.fillRect(sc.x0, sc.y0, sc.x1 - sc.x0, sc.y1 - sc.y0);
    s.ctx.fillStyle = s.ctx.shadowColor = `rgba(${PHOSPHOR}, 0.9)`;
    s.ctx.shadowBlur = 2 * s.ppu;
    s.ctx.font = '8.5px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
    s.ctx.textAlign = 'center';
    s.ctx.textBaseline = 'middle';
    s.ctx.fillText(text, (sc.x0 + sc.x1) / 2, (sc.y0 + sc.y1) / 2 + 0.5);
    s.ctx.shadowBlur = 0;
    s.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    for (let y = sc.y0; y < sc.y1; y += 1.5) s.ctx.fillRect(sc.x0, y, sc.x1 - sc.x0, 0.6);
    s.changed();
  }
}

/** The message's canvas: how wide, its margins, and how far its OK button is from its bottom right. */
export const MSG_PX = 1280;
export const MSG_PAD = 44;
export const OK_PX = { w: 170, h: 64 };

/** Text wrapped to fit `w` pixels in the canvas's current font, by words; explicit newlines and indents kept. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, w: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const indent = /^ */.exec(para)![0];
    let line = indent;
    for (const word of para.slice(indent.length).split(' ')) {
      const next = line.trim() ? `${line} ${word}` : line + word;
      if (line.trim() && ctx.measureText(next).width > w) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/**
 * The notice (see intro/notice.ts) as light projected on the inside of the pod's front: pale blue text on a faint
 * glow, with room at the bottom right for the OK button, which is its own mesh. Returns the canvas, laid out to fit.
 */
export function messageCanvas(blocks: readonly Block[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const sans = (wt: number, px: number) => `${wt} ${px}px "Schibsted Grotesk", sans-serif`;
  const mono = (px: number) => `${px}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
  const inner = MSG_PX - 2 * MSG_PAD;
  type Line = { text: string; font: string; color: string; y: number };
  const lines: Line[] = [];
  const rules: number[] = [];
  const boxes: { y0: number; y1: number }[] = [];
  let y = MSG_PAD;
  for (const b of blocks) {
    if (b.kind === 'hr') {
      y += 16;
      rules.push(y);
      y += 18;
      continue;
    }
    if (b.kind === 'list') {
      y += 30;
      continue;
    }
    const [font, size, color, gap] =
      b.kind === 'brand' ? [sans(600, 24), 24, '#8cc4ff', 14]
      : b.kind === 'h' ? [sans(600, 38), 38, '#f2f8ff', 8]
      : b.kind === 'pre' ? [mono(21), 21, '#cfe7ff', 12]
      : b.kind === 'small' ? [sans(400, 19), 19, '#a9c6e6', 8]
      : [sans(400, 25), 25, '#dcecff', 8];
    ctx.font = font;
    const pad = b.kind === 'pre' ? 14 : 0;
    const y0 = y;
    y += pad;
    for (const t of wrapText(ctx, b.text, inner - 2 * pad)) {
      lines.push({ text: t, font, color, y: y + size * 0.8 });
      y += size * 1.38;
    }
    y += pad;
    if (b.kind === 'pre') boxes.push({ y0, y1: y });
    y += gap;
  }
  y += OK_PX.h + MSG_PAD;
  c.width = MSG_PX;
  c.height = Math.ceil(y);
  // a faint glow where the light falls, brighter at the middle
  const g = ctx.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, c.height * 0.75);
  g.addColorStop(0, 'rgba(40, 110, 200, 0.30)');
  g.addColorStop(1, 'rgba(20, 70, 150, 0.16)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140, 196, 255, 0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = 'rgba(120, 180, 255, 0.14)';
  for (const bx of boxes) {
    ctx.beginPath();
    ctx.roundRect(MSG_PAD, bx.y0, inner, bx.y1 - bx.y0, 10);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(140, 196, 255, 0.35)';
  for (const r of rules) ctx.fillRect(MSG_PAD, r, inner, 2);
  ctx.textBaseline = 'alphabetic';
  for (const l of lines) {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.font.includes('monospace') ? MSG_PAD + 14 : MSG_PAD, l.y);
  }
  return c;
}
/**
 * A sleeper culture's cells, and the sim time each was first seen dead, so it can be shown dying; those dead when the
 * plate was first drawn (as when a save loads) are just dead (see drawCulture).
 */
export interface CultureLook {
  cells: ReturnType<typeof cultureCells>;
  died: number[];
  seen: boolean;
}

/** A new culture's look, none of its cells yet seen dead. */
export const cultureLook = (): CultureLook => ({ cells: cultureCells(), died: [], seen: false });

/**
 * A sleeper culture's cells, on a board covering its plate (its tank's walls, see tankRect) at sim time `clock`: each
 * a pale blue dot with a bright middle while it's alive; swollen and amber for DYING sim seconds from when it dies;
 * and a small brown dot from then on.
 */
export function drawCulture(sc: Board, t: Tool, r: { x0: number; x1: number; y0: number; y1: number }, cu: CultureLook, clock: number): void {
  const dead = t.dead!;
  let dying = false;
  let count = 0;
  cu.cells.forEach((_, i) => {
    if (!dead[i]) return;
    count++;
    cu.died[i] ??= cu.seen ? clock : -Infinity;
    if (clock - cu.died[i] < DYING) dying = true;
  });
  cu.seen = true;
  const key = dying ? `dying ${clock.toFixed(2)}` : `${count}`;
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  ctx.setTransform(ppu, 0, 0, ppu, -r.x0 * ppu, -r.y0 * ppu);
  ctx.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  const dot = (x: number, y: number, rad: number, color: string) => {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  };
  cu.cells.forEach((c, i) => {
    const since = dead[i] ? clock - cu.died[i] : -1;
    if (since < 0) {
      dot(c.x, c.y, 1.15, 'rgba(150, 214, 255, 0.92)');
      dot(c.x - 0.3, c.y - 0.3, 0.42, 'rgba(240, 250, 255, 0.95)');
    } else if (since < DYING) {
      // it swells, amber, then shrinks to what's left of it
      const u = since / DYING;
      dot(c.x, c.y, 1.15 + 0.75 * Math.sin(Math.PI * Math.min(1, 1.4 * u)), `rgba(242, 176, 58, ${0.95 - 0.3 * u})`);
    } else dot(c.x, c.y, 0.8, 'rgba(92, 58, 34, 0.95)');
  });
  sc.changed();
}

/**
 * A flow meter's display, on a board covering it (see METER_BODY.display): its reading (see meterText) in small
 * seven-segment digits like the scale's.
 */
export function drawMeter(s: Board, t: Tool): void {
  const text = meterText(t.rate);
  if (s.key === text) return;
  s.key = text;
  const d = METER_BODY.display;
  s.ctx.setTransform(s.ppu, 0, 0, s.ppu, -d.x0 * s.ppu, -d.y0 * s.ppu);
  s.ctx.fillStyle = '#050603';
  s.ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
  // the digits at half the scale's size, to fit the little display
  const k = 0.5;
  s.ctx.setTransform(s.ppu * k, 0, 0, s.ppu * k, 0, 0);
  const w = (d.x1 - d.x0) / k;
  drawSevenSeg(s.ctx, text, w - 1, ((d.y1 - d.y0) / k - 13) / 2, METER_DIGITS, 'yellowgreen', 'rgba(154, 205, 50, 0.08)', s.ppu * k);
  s.changed();
}

/** A scale's display, on a board covering it (see SCALE_SHAPE.display): its reading in grams, or OUEr over its top. */
export function drawScaleReading(s: Board, sc: Scale): void {
  const g = sc.reading();
  const text = g === null ? 'OUEr' : String(g);
  if (s.key === text) return;
  s.key = text;
  const d = SCALE_SHAPE.display;
  s.ctx.setTransform(s.ppu, 0, 0, s.ppu, -d.x0 * s.ppu, -d.y0 * s.ppu);
  s.ctx.fillStyle = '#050603';
  s.ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
  drawSevenSeg(s.ctx, text, d.x1 - 4, d.y0 + 3.5, 6, 'yellowgreen', 'rgba(154, 205, 50, 0.08)', s.ppu);
  s.changed();
}

/** The pod's message's OK button's face, OK_PX in size, lit brighter when the pointer is on it. */
export function okCanvas(hot: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = OK_PX.w;
  c.height = OK_PX.h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = hot ? 'rgba(110, 180, 255, 0.85)' : 'rgba(60, 130, 230, 0.6)';
  ctx.beginPath();
  ctx.roundRect(2, 2, c.width - 4, c.height - 4, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 228, 255, 0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 32px "Schibsted Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('OK', c.width / 2, c.height / 2 + 1);
  return c;
}

/** The face of the alarms' silence button's plate, 220 by 300 pixels: hazard stripes round the edge, and what it's for. */
export function alarmPlateCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 220;
  c.height = 300;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d9b42a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#1b1d1c';
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, c.width, c.height);
  ctx.rect(16, 16, c.width - 32, c.height - 32);
  ctx.clip('evenodd');
  for (let x = -c.height; x < c.width; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, c.height);
    ctx.lineTo(x + 14, c.height);
    ctx.lineTo(x + 14 + c.height, 0);
    ctx.lineTo(x + c.height, 0);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#3a403e';
  ctx.fillRect(16, 16, c.width - 32, c.height - 32);
  ctx.fillStyle = '#e7ebe6';
  ctx.font = '600 30px "Schibsted Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ALARM', c.width / 2, 52);
  ctx.fillText('SILENCE', c.width / 2, c.height - 48);
  return c;
}

/**
 * How wide the hazard tape round the station's block is, and how far apart its stripes repeat, in world units; and how
 * far its inner edge is from the block's edge, across and up, at each corner (bottom left, bottom right, top right, top
 * left), uneven as if laid on by hand.
 */
export const TAPE = { w: 10, period: 14, gaps: [[2.5, 3.5], [4, 2], [3, 4.5], [2, 3]] as const };

/** Hazard tape's stripes, 64 pixels a side, tiling both ways: one yellow and one black band per tile, along the diagonal. */
export function tapeCanvas(): HTMLCanvasElement {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // one yellow and one black band per tile, along the diagonal
      const yellow = (x + y) % n < n / 2;
      const [r, g, b] = yellow ? [0xd9, 0xb4, 0x2a] : [0x1b, 0x1d, 0x1c];
      img.data.set([r, g, b, 255], (y * n + x) * 4);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Text as printed on a flat face, `h` tall at `ppu` pixels per unit: pale paint, in capitals, spaced out, as signage
 * is; on a canvas just big enough for it, its middle at the canvas's.
 */
export function printedCanvas(text: string, h: number, ppu: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `700 ${h * ppu}px "Schibsted Grotesk", sans-serif`;
  ctx.font = font;
  const label = text.toUpperCase();
  const spacing = 0.12 * h * ppu;
  const w = ctx.measureText(label).width + spacing * (label.length - 1);
  c.width = Math.ceil(w + 4);
  c.height = Math.ceil(h * ppu * 1.3);
  ctx.font = font;
  ctx.fillStyle = '#d5dbd8';
  ctx.textBaseline = 'middle';
  let at = 2;
  for (const ch of label) {
    ctx.fillText(ch, at, c.height / 2);
    at += ctx.measureText(ch).width + spacing;
  }
  return c;
}
