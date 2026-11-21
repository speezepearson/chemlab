import { TOOL_DEPTH, openingOf, tankInside, tankNoteY, tankRect, valveLocal } from './bodies';
import { DELIVERY, TRACE } from './config';
import { Vessel, fluidColor, fluidRGB, volume, type Flask } from './flask';
import { FLASK_H, FLASK_OUTLINE, fillLevel, flaskRadius } from './flaskShape';
import { SCALE_SHAPE, type Scale } from './scale';
import {
  board, CAPILLARY_X, drawBondPaper, drawColumn, drawDiverter, drawMeter, drawNeedle, drawScaleReading, drawSheet, drawSpectroscope, drawStrip,
  drawTestPaper, drawThermometerScale, paperBoard, phosphor, printedCanvas, SEGMENT_COLORS, sheetBoard, TAPE, tapeCanvas, wireColor, type Board,
} from './screens';
import { bound, boundPts, circle, INK, LABEL_H, line, poly, rect, type Deep, type Sketch } from './sketch';
import { litresOf, type Supply } from './supply';
import {
  BULB, changeoverAt, chuteY, clockText, COLUMN, DIVERTER_HOLD, FUNNEL_TIP, gaugeSegments, HEATER, HEATER_BOX, HEATER_CELLS,
  HEATER_TUBE, HELIX, INLINE_TOOLS, INSTRUMENT, isThermometer, levelIn, METER_BODY, SORTER_CHUTE, STATION, STATION_FUNNEL, STRIP, SUMP_TIP,
  LAMP, SHEET, TANK_H, tankX, TEST_PAPER, THERMOMETER, THERMOMETER_ROD, thermometerAt, type ThermometerKind, type Tool,
} from './tools';
import type { Pick } from './view';

/**
 * How the view draws each tool, flask and scale (see view.ts): from its flat outline, as it's defined (see SHAPES in
 * tools.ts), in its own frame, x right and y down from its origin, seen from in front, square on.
 */

/** The separator's manifold, below its valve, in its frame. */
const SEP_BODY = { x0: -210, x1: 210, y0: 100, y1: 112 };
/** How far above a flask's mouth or a scale's platform its note sits, to the note's middle. */
const NOTE_Y = 13;
/** How long a valve's lever is from its pivot, and how wide; and the radius of the round core it turns on. */
const LEVER = { len: 13, back: 1, w: 3, core: 5 };
/** A dial's ticks' radius, its knob's, and how far its pointer reaches out from its middle. */
const DIAL = { ticks: 11.75, knob: 8, from: 1.5, to: 7 };

/**
 * What the view keeps of a tool between frames: the boards its screens and printed parts are drawn on (see
 * screens.ts), made as they're needed: a sheet of paper's face is its `screen`.
 */
export interface ToolArt {
  screen?: Board;
  steady?: Board;
  diverter?: Board;
  needle?: Board;
  /** The station's reservoir's name, printed for the supply it was last printed for. */
  plate?: { supply: Supply; c: HTMLCanvasElement };
}

/** A board covering x0..x1 by y0..y1 of a tool's frame, made the first time it's asked for. */
function boardOf(art: ToolArt, key: 'screen' | 'steady' | 'diverter' | 'needle', r: { x0: number; x1: number; y0: number; y1: number }, ppu: number): Board {
  return (art[key] ??= board(r.x1 - r.x0, r.y1 - r.y0, ppu));
}

/** How full a vessel is, by volume, from 0 to 1. */
const share = (v: Vessel) => Math.min(1, volume(v) / v.cap);

/** A trapezoid: a top `wTop` wide at y0, centered on x, narrowing (or widening) to `wBot` wide at y1. */
function trap(x: number, y0: number, y1: number, wTop: number, wBot: number): number[][] {
  return [[x - wTop / 2, y0], [x + wTop / 2, y0], [x + wBot / 2, y1], [x - wBot / 2, y1]];
}

/** Everything a tool shows, in its own frame (the frame in force), at sim time `clock`. */
export function drawTool(sk: Sketch, t: Tool, art: ToolArt, clock: number, energies: readonly number[]): void {
  if (t.shape.wall) return drawStation(sk, t, art, clock);
  if (t.kind === 'shadowlamp') return drawLamp(sk, t);
  if (t.shape.pinned) return drawPaper(sk, t, art);
  const sh = t.shape;
  const pk = (part: 'body' | 'tank' | 'valve' | 'spout', k = 0): Pick => ({ kind: 'tool', t, part, k });
  const body = pk('body');
  const TH = sh.tankH ?? TANK_H;
  const floor = TH + (sh.sump?.h ?? 0);

  // the pipes, from the tanks down to the spouts
  if (t.kind === 'exchanger')
    sh.tanks.forEach((tk, k) => {
      sk.pipe([[tankX(tk), floor], [tankX(tk), HELIX.y - HELIX.r]], 2, body);
      sk.pipe([[sh.spouts[k], HELIX.y + HELIX.r], [sh.spouts[k], sh.spoutY - 4]], 2, body);
    });
  else if (t.kind === 'separator') {
    sk.pipe([[0, floor], [0, SEP_BODY.y0]], 2, body);
    for (const x of sh.spouts) sk.pipe([[x, SEP_BODY.y1], [x, sh.spoutY - 4]], 2, body);
    const { x0, y0, y1 } = SEP_BODY;
    sk.pipe([[x0, y0 + 3], [x0 - 6, y0 + 3], [x0 - 6, y1 - 3], [x0, y1 - 3]], 1.3, body);
  } else if (t.kind === 'splitter') {
    const fork = sh.valveY + 10;
    sk.pipe([[0, TH], [0, fork]], 2, body);
    for (const x of sh.spouts) sk.pipe([[0, fork], [x, fork + 16], [x, sh.spoutY - 4]], 2, body);
  } else if (t.kind === 'multiplexer') {
    const join = sh.valveY - 12;
    for (const tk of sh.tanks) sk.pipe([[tankX(tk), TH], [tankX(tk), join - 16], [0, join]], 2, body);
    sk.pipe([[0, join], [0, sh.spoutY - 4]], 2, body);
  } else if (t.kind === 'sorter') {
    const x = tankX(sh.tanks[0]);
    sk.pipe([[x, TH], [x, chuteY(x)]], 2, body);
    sh.spouts.forEach((x, k) => sk.pipe([[x, k < sh.spouts.length - 1 ? chuteY(x) + 8 : SORTER_CHUTE.y1], [x, sh.spoutY - 4]], 2, body));
  } else if (t.kind === 'heater') {
    const { y, r } = HEATER_TUBE;
    sk.pipe([[tankX(sh.tanks[0]), TH], [tankX(sh.tanks[0]), y - r + 1]], 2, body);
    for (const x of sh.spouts) sk.pipe([[x, y + r - 1], [x, sh.spoutY - 4]], 2, body);
  } else if (INLINE_TOOLS.includes(t.kind)) {
    const { body: b, inY } = INSTRUMENT;
    sk.pipe([[0, TH], [0, sh.spoutY - 4]], 2, body);
    if (t.kind !== 'meter') sk.pipe([[0, inY], [b.x0 + 2, inY]], 1.3, body);
  } else if (sh.neck) sh.neck.bodies.forEach((bx, k) => sk.pipe([[bx, floor], [bx, floor + 4], [sh.spouts[k], floor + 4], [sh.spouts[k], sh.spoutY - 4]], 2, body));
  else if (t.kind === 'column') {
    sk.pipe([[0, TH], [0, COLUMN.tube.y0]], 2, body);
    sk.pipe([[0, COLUMN.tube.y1], [0, sh.spoutY - 4]], 2, body);
  } else if (t.kind !== 'strip' && !isThermometer(t.kind)) sk.pipe([[0, floor], [0, sh.spoutY - 4]], 2, body);

  // what's behind the tanks' fronts, or part of the tool's frame
  if (t.kind === 'dilatometer') bulbsHeating(sk, t, false);
  if (t.kind === 'strip') strip(sk, t, art);
  if (isThermometer(t.kind)) thermometer(sk, t);
  if (t.kind === 'column') column(sk, t);
  if (t.kind === 'sorter') chute(sk, t);
  if (t.kind === 'heater') heater(sk, t);

  // the tanks, each with its fluid
  t.tanks.forEach((v, k) => tank(sk, t, k, v));
  if (t.kind === 'dilatometer') bulbsHeating(sk, t, true);
  if (t.kind === 'exchanger') helix(sk, t);
  if (INLINE_TOOLS.includes(t.kind)) {
    thread(sk, t, TH);
    if (t.kind === 'meter') meter(sk, t, art);
    else instrument(sk, t, art, energies);
  }
  if (t.kind === 'separator') {
    const { x0, x1, y0, y1 } = SEP_BODY;
    sk.box(x0, x1, y0, y1, INK.panel, body, 2, INK.panelEdge);
    for (let k = 1; k < sh.spouts.length; k++) {
      const x = (sh.spouts[k - 1] + sh.spouts[k]) / 2;
      sk.box(x - 0.8, x + 0.8, y0 + 4, y1, INK.dark, body);
    }
  }
  // the spouts' tips, and the valves
  sh.spouts.forEach((x, k) => sk.box(x - 4, x + 4, sh.spoutY - 6, sh.spoutY, INK.pipe, pk('spout', k), 0.8, INK.pipeEdge));
  if (!sh.noValve)
    t.valves.forEach((v, k) => {
      const vc = valveLocal(t, k);
      if (k === sh.dial) return dial(sk, vc, v, pk('valve', k));
      valve(sk, vc, t.kind === 'splitter' || t.kind === 'multiplexer' ? -Math.PI * (1 - v) : (-v * Math.PI) / 2, pk('valve', k));
    });
  // lids, while nothing may get in; the player's labels, and the tanks' names on their fronts; and the note over it all
  t.tanks.forEach((v, k) => {
    const r = tankRect(t, k);
    if (t.lidded) sk.box(r.x0 - 4, r.x1 + 4, -5, 0, INK.pipe, pk('tank', k), 1, INK.pipeEdge);
    sk.text(v.label, tankX(sh.tanks[k]), tankNoteY(t, k));
  });
  if (t.tanks.length > 1) sh.tanks.forEach((tk, k) => sk.text(tk.name, sh.neck ? sh.neck.bodies[k] : tankX(tk), 14, 9, true));
  // (above the tanks' labels, if there are any, rather than over them)
  const b = sh.box;
  const over = t.tanks.flatMap((v, k) => (v.label ? [tankNoteY(t, k) - LABEL_H - 1] : []));
  sk.text(t.note, (b.x0 + b.x1) / 2, Math.min(b.y0 - 8 - (t.tanks.length > 1 ? 13 : 0), ...over));
}

/** A valve's round core, and its lever, from its pivot at `vc`, at angle `a` (clockwise from pointing right). */
function valve(sk: Sketch, vc: { x: number; y: number }, a: number, pick: Pick): void {
  sk.fill(circle(vc.x, vc.y, LEVER.core), INK.panel, pick);
  sk.stroke(circle(vc.x, vc.y, LEVER.core), INK.panelEdge, sk.px(1));
  sk.frame(vc.x, vc.y, () => sk.box(-LEVER.back, LEVER.len, -LEVER.w / 2, LEVER.w / 2, INK.lever, pick, 1), a);
}

/** A dial on a box's face, set to `d`: a knob on a ring of ticks running clockwise from down-left (0) to down-right (1). */
function dial(sk: Sketch, vc: { x: number; y: number }, d: number, pick: Pick): void {
  const at = (u: number) => -0.75 * Math.PI + 1.5 * Math.PI * u;
  const dir = (a: number, q: number) => [vc.x + q * Math.sin(a), vc.y - q * Math.cos(a)];
  for (let i = 0; i <= 6; i++) sk.stroke(line([dir(at(i / 6), DIAL.ticks - 1.25), dir(at(i / 6), DIAL.ticks + 1.25)]), INK.dark, 0.8, pick);
  sk.fill(circle(vc.x, vc.y, DIAL.knob), INK.panel, pick);
  sk.stroke(circle(vc.x, vc.y, DIAL.knob), INK.panelEdge, sk.px(1));
  sk.stroke(line([dir(at(d), DIAL.from), dir(at(d), DIAL.to)]), INK.lever, 2.2, pick);
}

/**
 * Tank k, its fluid at its level as drawn (see tankInside), in its glass: a box with a thin metal rim, an upright
 * cylinder (round) with a metal ring at its top, either with its sump; a funnel; a tube with a little funnel on top
 * (a cup), its graduations if it's the pipette's; or a swell bulb, with its neck, inlet and float.
 */
function tank(sk: Sketch, t: Tool, k: number, v: Vessel): void {
  const sh = t.shape;
  const pick: Pick = { kind: 'tool', t, part: 'tank', k };
  const r = tankRect(t, k);
  const o = openingOf(t, k);
  const cx = (r.x0 + r.x1) / 2;
  const { pieces, bottom } = tankInside(t, k);
  const top = bottom - levelIn(pieces, share(v));
  if (sh.neck) return bulb(sk, t, k, v, top, pick);
  let inside: Path2D;
  let outline: Path2D;
  // how deep it is front to back, for its fluid's shadow (see Sketch.shade): a box as deep as its tanks, a funnel round
  // and narrowing, and anything else round
  let deep: Deep | undefined = sh.round || sh.cup ? undefined : { flat: TOOL_DEPTH[t.kind].tank };
  if (sh.cup) {
    const pts = [[o.x0, o.y], [r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0], [o.x1, o.y]];
    inside = poly(pts);
    outline = line(pts);
  } else if (sh.funnel) {
    const pts = [[r.x0, r.y0], [cx - FUNNEL_TIP / 2, r.y1], [cx + FUNNEL_TIP / 2, r.y1], [r.x1, r.y0]];
    inside = poly(pts);
    outline = line(pts);
    const [w0, w1] = [(r.x1 - r.x0) / 2, FUNNEL_TIP / 2];
    deep = { round: (y) => w0 + ((w1 - w0) * (y - r.y0)) / Math.max(1, r.y1 - r.y0) };
  } else {
    const s = sh.sump;
    const pts = s
      ? [[r.x0, r.y0], [r.x0, r.y1], [cx - s.w / 2, r.y1], [cx - SUMP_TIP / 2, r.y1 + s.h], [cx + SUMP_TIP / 2, r.y1 + s.h], [cx + s.w / 2, r.y1], [r.x1, r.y1], [r.x1, r.y0]]
      : [[r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0]];
    inside = poly(pts);
    outline = line(pts);
  }
  const x0 = Math.min(r.x0, o.x0) - 1;
  const x1 = Math.max(r.x1, o.x1) + 1;
  sk.fluid(inside, v, top, bottom + 1, x0, x1, deep);
  sk.glass(inside, pick, v, outline);
  // a thin metal rim round the top of a box or a cylinder
  if (!sh.cup && !sh.funnel) sk.box(r.x0 - 1.2, r.x1 + 1.2, -0.8, 0.8, INK.pipe, pick, 0.6, INK.pipeEdge);
  // the big tank's ten faint lines, and the pipette's ten marks up its left wall
  if (t.kind === 'tank' && !sk.shade)
    for (let i = 1; i <= 10; i++) {
      const y = bottom - levelIn(pieces, i / 10);
      sk.stroke(line([[r.x0, y], [r.x1, y]]), 'rgba(214, 236, 242, 0.45)', sk.w(0.6, 1));
    }
  if (t.kind === 'pipette' && sh.cup)
    for (let i = 1; i <= 10; i++) {
      const h = levelIn(pieces, i / 10);
      const f = Math.max(0, (h - (r.y1 - r.y0)) / sh.cup.h);
      const x = r.x0 + f * (o.x0 - r.x0);
      const y = r.y1 - h;
      sk.stroke(line([[x, y], [x + (i % 5 === 0 ? 5 : 3), y]]), INK.dark, sk.w(0.7, 1));
    }
}

/**
 * A swell bulb (see ToolShape.neck): its round bulb over its sump, its neck up from the bulb's top with a little black
 * float riding its fluid, and its inlet, a little funnel, on a thin tube leaning down and in to the neck's top. With
 * the first, the marks printed across both necks, every fifth one longer.
 */
function bulb(sk: Sketch, t: Tool, k: number, v: Vessel, top: number, pick: Pick): void {
  const sh = t.shape;
  const neck = sh.neck!;
  const H = sh.tankH ?? TANK_H;
  const [bx, nx, ix] = [neck.bodies[k], neck.necks[k], tankX(sh.tanks[k])];
  const [rr, nr] = [neck.body / 2, neck.w / 2];
  const s = sh.sump!;
  const inside = bound(new Path2D(), bx - rr, -neck.h, bx + rr, H + s.h);
  inside.addPath(rect(bx - rr, bx + rr, 0, H, 3));
  inside.addPath(poly(trap(bx, H - 0.5, H + s.h, s.w, SUMP_TIP)));
  inside.addPath(rect(nx - nr, nx + nr, -neck.h, 0.5));
  // the inlet's funnel and the thin tube from it
  const { h: ih, y: iy } = neck.inlet;
  const iw = sh.tanks[k].x1 - sh.tanks[k].x0;
  if (!sk.shade) {
    sk.stroke(line([[ix, iy + ih], [nx, -neck.h]]), INK.glassShade, 3.6, pick);
    sk.stroke(line([[ix, iy + ih], [nx, -neck.h]]), 'rgba(236, 248, 251, 0.7)', 2.2);
  }
  const funnel = trap(ix, iy, iy + ih, iw, 3);
  sk.glass(poly(funnel), pick, v, line(funnel));
  sk.fluid(inside, v, top, H + s.h + 1, bx - rr - 1, bx + rr + 1);
  sk.glass(inside, pick, v);
  // the float, on the fluid if it's up in the neck, else at the neck's foot
  const fy = Math.min(0, top) - 0.8;
  sk.box(nx - nr + 0.7, nx + nr - 0.7, fy - 0.8, fy + 0.8, INK.lever, pick, 0.4);
  if (k === 0) {
    const ink = 'rgba(48, 55, 58, 0.9)';
    const mid = (neck.necks[0] + neck.necks[neck.necks.length - 1]) / 2;
    for (const n of neck.necks) {
      const outer = Math.sign(n - mid) || 1;
      for (let i = 0; i <= BULB.marks; i++) {
        const y = -(i / BULB.marks) * neck.h;
        const out = i % 5 === 0 ? 3 : 0;
        const [a, b] = outer > 0 ? [n - nr, n + nr + out] : [n - nr - out, n + nr];
        sk.stroke(line([[a, y], [b, y]]), ink, sk.w(0.44, 0.8));
      }
    }
  }
}

/**
 * The swell bulbs' heating: a box under the bulbs with the dial on its face, and one wire wound three times round
 * both bulbs together, from copper to white-hot as the dial turns up: what's behind the bulbs, or (`front`) what's in
 * front of them.
 */
function bulbsHeating(sk: Sketch, t: Tool, front: boolean): void {
  const sh = t.shape;
  const neck = sh.neck!;
  const d = valveLocal(t, sh.dial!);
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  if (!front) sk.box(d.x - 14, d.x + 14, d.y - 14, d.y + 14, INK.panel, body, 2.5, INK.panelEdge);
  const R = neck.body / 2 + 1.3;
  const a = Math.max(...neck.bodies);
  const lap = 4 * a + 2 * Math.PI * R;
  const at = (s: number): [number, number] => {
    if (s < a) return [s, R];
    if (s < a + Math.PI * R) return [a + R * Math.sin((s - a) / R), R * Math.cos((s - a) / R)];
    if (s < 3 * a + Math.PI * R) return [a - (s - a - Math.PI * R), -R];
    if (s < 3 * a + 2 * Math.PI * R) return [-a - R * Math.sin((s - 3 * a - Math.PI * R) / R), -R * Math.cos((s - 3 * a - Math.PI * R) / R)];
    return [-a + (s - 3 * a - 2 * Math.PI * R), R];
  };
  const H = sh.tankH ?? TANK_H;
  const [turns, n] = [3, 64];
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= turns * n; i++) {
    const [x, z] = at(((i % n) / n) * lap);
    pts.push([x, 3 + (i / (turns * n)) * (H - 6), z]);
  }
  pts.push([0, d.y - 14, R - 1]);
  wire(sk, t.valves[sh.dial!], pts, front, body);
}

/**
 * A heating wire through points (x, y, z: z toward the front): only its stretches in front (or behind, if not
 * `front`), from copper to glowing white-hot as `dial` turns up.
 */
function wire(sk: Sketch, dialAt: number, pts: readonly [number, number, number][], front: boolean, pick: Pick): void {
  const rgb = wireColor(dialAt);
  const color = `rgb(${rgb.map(Math.round).join(', ')})`;
  const p = boundPts(new Path2D(), pts);
  let on = false;
  for (let i = 1; i < pts.length; i++) {
    const z = (pts[i - 1][2] + pts[i][2]) / 2;
    if (z >= 0 !== front) {
      on = false;
      continue;
    }
    if (!on) p.moveTo(pts[i - 1][0], pts[i - 1][1]);
    p.lineTo(pts[i][0], pts[i][1]);
    on = true;
  }
  const { ctx } = sk;
  const glow = Math.min(1, 1.3 * dialAt);
  if (glow > 0.05 && !sk.shade) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 1.5 * glow * ctx.getTransform().a;
  }
  sk.stroke(p, front ? color : `rgba(${rgb.map(Math.round).join(', ')}, 0.55)`, 1.2, pick);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/** The exchanger's two hoses, wound round each other, each showing its stream going from its tank's color to its outlet's. */
function helix(sk: Sketch, t: Tool): void {
  const { x0, x1, y, r, halfTwists } = HELIX;
  const n = halfTwists * 16;
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  const strands = [0, 1].map((k) => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const th = Math.PI * halfTwists * u;
      const sg = k ? -1 : 1;
      const x = k ? x1 + (x0 - x1) * u : x0 + (x1 - x0) * u;
      pts.push([x, y - sg * r * Math.cos(th), sg * r * Math.sin(th)]);
    }
    const out = t.out[k];
    let paint: string | CanvasGradient | null = null;
    if (out) {
      const tank = t.tanks[k];
      const from = tank.N > TRACE ? tank : out;
      const g = sk.ctx.createLinearGradient(pts[0][0], 0, pts[n][0], 0);
      g.addColorStop(0, fluidColor(from) === 'transparent' ? sk.ink(out, 3.6) : sk.ink(from, 3.6));
      g.addColorStop(1, sk.ink(out, 3.6));
      paint = g;
    }
    return { pts, paint };
  });
  // the stretches behind first, then those in front
  for (const front of [false, true])
    for (const { pts, paint } of strands) {
      const p = boundPts(new Path2D(), pts);
      let on = false;
      for (let i = 1; i < pts.length; i++) {
        if ((pts[i - 1][2] + pts[i][2]) / 2 >= 0 !== front) {
          on = false;
          continue;
        }
        if (!on) p.moveTo(pts[i - 1][0], pts[i - 1][1]);
        p.lineTo(pts[i][0], pts[i][1]);
        on = true;
      }
      if (!sk.shade) {
        sk.stroke(p, INK.glassShade, 6.8, body);
        sk.stroke(p, 'rgba(232, 246, 250, 0.55)', 5.6);
      }
      if (paint) sk.stroke(p, paint, 3.6);
    }
}

/**
 * The size sorter's chute: a sloping steel floor, its back wall behind what's sliding down it, a hopper under each
 * screen, and a film of what's on each stretch of it.
 */
function chute(sk: Sketch, t: Tool): void {
  const c = SORTER_CHUTE;
  const sp = t.shape.spouts;
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  sk.fill(poly([[c.x0, c.y0 - 6], [c.x1, c.y1 - 6], [c.x1, c.y1], [c.x0, c.y0]]), 'rgba(140, 150, 149, 0.55)', body);
  for (const x of sp.slice(0, -1)) sk.fill(poly(trap(x, chuteY(x) + 3, chuteY(x) + 10, 24, 6)), INK.pipe, body);
  const stops = [tankX(t.shape.tanks[0]), ...sp.slice(0, -1), c.x1];
  for (let k = 0; k < sp.length; k++) {
    const on = new Vessel(Infinity);
    for (const v of t.out.slice(k)) if (v) on.addFrom(v, volume(v));
    if (on.N <= 0) continue;
    const [a, b] = [stops[k], stops[k + 1]];
    sk.stroke(line([[a, chuteY(a) - 1], [b, chuteY(b) - 1]]), sk.ink(on, 2 * HELIX.r), sk.w(2, 2));
  }
  const floor = poly([[c.x0, c.y0], [c.x1, c.y1], [c.x1, c.y1 + 3], [c.x0, c.y0 + 3]]);
  sk.fill(floor, INK.pipe, body);
  sk.stroke(floor, INK.pipeEdge, sk.px(1));
}

/**
 * A heater's tube: glass, with what's in each stretch lying along its floor (as deep as that stretch holds when the
 * funnel feeds it flat out), the wire coiled down its middle from copper to white-hot as the dial turns up, and the
 * box the dial sits on, with the wire's lead up into it.
 */
function heater(sk: Sketch, t: Tool): void {
  const { x0, x1, y, r } = HEATER_TUBE;
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  const B = HEATER_BOX;
  sk.box(B.x0, B.x1, B.y0, B.y1, INK.panel, body, 2.5, INK.panelEdge);
  const tube = rect(x0 - r, x1 + r, y - r, y + r, r);
  const w = (x1 - x0) / HEATER_CELLS;
  const full = (HEATER.feed * HEATER.transit) / HEATER_CELLS;
  sk.ctx.save();
  sk.ctx.clip(tube);
  t.tube.forEach((v, c) => {
    if (v.N <= TRACE) return;
    const a = c === 0 ? x0 - r : x0 + c * w;
    const b = c === HEATER_CELLS - 1 ? x1 + r : x0 + (c + 1) * w;
    const d = Math.max(0.3, 2 * r * Math.min(1, volume(v) / full));
    sk.ctx.fillStyle = sk.ink(v, 2 * r);
    sk.ctx.fillRect(a, y + r - d, b - a + 0.2, d);
  });
  sk.ctx.restore();
  const lead = B.x0 + 32;
  const pts: [number, number, number][] = [];
  for (let x = x0; x <= lead; x += 0.75) {
    const ph = ((x - x0) / 5) * Math.PI;
    pts.push([x, y + 2.6 * Math.sin(ph), 2.6 * Math.cos(ph)]);
  }
  pts.push([lead, y - 4, 1], [lead, B.y1, 1]);
  const dialAt = t.valves[t.shape.dial!];
  wire(sk, dialAt, pts, false, body);
  sk.glass(tube, body);
  wire(sk, dialAt, pts, true, body);
}

/** A thin thread down the middle of an inline instrument's tube, `h` tall, in the color of what's running through it. */
function thread(sk: Sketch, t: Tool, h: number): void {
  const through = new Vessel(Infinity);
  for (const v of t.out) if (v) through.addFrom(v, volume(v));
  if (through.N <= 0 || !fluidRGB(through)) return;
  sk.stroke(line([[0, 0], [0, h]]), sk.ink(through, 2.4), 2.4);
}

/** An inline instrument's cabinet beside its tube, with its old green-on-black screen (see screens.ts). */
function instrument(sk: Sketch, t: Tool, art: ToolArt, energies: readonly number[]): void {
  const { body: b, screen: s } = INSTRUMENT;
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  sk.box(b.x0, b.x1, b.y0, b.y1, INK.panel, body, 3, INK.panelEdge);
  sk.box(s.x0 - 1.5, s.x1 + 1.5, s.y0 - 1.5, s.y1 + 1.5, INK.dark, body, 0.6);
  // black, as an old screen is, till it's first drawn on
  const fresh = !art.screen;
  const sc = boardOf(art, 'screen', s, 6);
  if (fresh) {
    sc.ctx.fillStyle = '#000';
    sc.ctx.fillRect(0, 0, sc.canvas.width, sc.canvas.height);
  }
  if (t.kind === 'spectroscope') drawSpectroscope(sc, t, energies);
  sk.image(sc.canvas, s.x0, s.x1, s.y0, s.y1, body);
}

/** A flow meter's readout, round the pipe under its tube, nearly all display (see drawMeter). */
function meter(sk: Sketch, t: Tool, art: ToolArt): void {
  const { display: d, x0, x1, y0, y1 } = METER_BODY;
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  sk.box(x0, x1, y0, y1, INK.panel, body, 1.5, INK.panelEdge);
  const sc = boardOf(art, 'screen', d, 16);
  drawMeter(sc, t);
  sk.image(sc.canvas, d.x0, d.x1, d.y0, d.y1, body);
}

/**
 * A thermometer: its glass rod with rounded ends, the white enamel backing inside it with its scale (see
 * drawThermometerScale), the capillary up it from a bulb of red spirit at its foot, and the spirit's column, as long as
 * its reading. Shattered, it's the rod snapped off short a little way up from its foot, its end jagged, with no
 * bulb and no column.
 */
function thermometer(sk: Sketch, t: Tool): void {
  const kind = t.kind as ThermometerKind;
  const { h, r, bulb: bl, backing: b, foot, top, snap } = THERMOMETER_ROD;
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  const sc = scaleBoard(kind);
  sk.box(-b.w / 2, b.w / 2, b.y0, b.y1, INK.enamel, body);
  sk.image(sc.canvas, -b.w / 2, b.w / 2, b.y0, b.y1);
  const capTop = foot - THERMOMETER.burst * (foot - top);
  const capillary = 'rgba(214, 236, 242, 0.85)';
  if (!sk.shade) sk.stroke(line([[CAPILLARY_X, capTop], [CAPILLARY_X, t.broken ? snap : bl.y0 + 1]]), capillary, 1.1);
  const spirit = '#c92f27';
  if (!t.broken) {
    const T = t.reads;
    if (T !== null) {
      const y = foot - (foot - top) * thermometerAt(kind, T);
      sk.stroke(line([[CAPILLARY_X, bl.y0 + 1], [CAPILLARY_X, y]]), spirit, 0.64);
    }
    sk.fill(rect(-bl.r, bl.r, bl.y0, bl.y1, bl.r), spirit, body);
    sk.glass(rect(-r, r, 0, h, r), body);
    return;
  }
  // snapped: the rod down to a jagged end
  const jag: number[][] = [[-r, 0]];
  for (let i = 0; i <= 6; i++) jag.push([-r + (2 * r * i) / 6, snap + 1.5 + 2.5 * Math.abs(Math.sin(i * 2.3 + 1)) * (i % 2 ? 1 : 0.4)]);
  jag.push([r, 0]);
  const p = bound(new Path2D(), -r, 0, r, snap);
  p.roundRect(-r, 0, 2 * r, snap, [r, r, 0, 0]);
  sk.glass(p, body, undefined, poly(jag));
}

/** Each thermometer kind's scale, drawn once, shared by every one of that kind. */
const scales = new Map<ThermometerKind, Board>();
function scaleBoard(kind: ThermometerKind): Board {
  let sc = scales.get(kind);
  if (!sc) {
    const b = THERMOMETER_ROD.backing;
    sc = board(b.w, b.y1 - b.y0, 28);
    drawThermometerScale(sc, kind);
    scales.set(kind, sc);
  }
  return sc;
}

/** A wicking strip: its paper hanging from a clip at its top, its foot cut to a point, what's on it shown on it (see drawStrip). */
function strip(sk: Sketch, t: Tool, art: ToolArt): void {
  const { w, top, len, point } = STRIP.paper;
  const c = STRIP.clip;
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  const sc = (art.screen ??= board(2 * w, len, 6));
  drawStrip(sc, t);
  const foot = top + len;
  const paper = poly([[-w, top], [w, top], [w, foot - point], [0, foot], [-w, foot - point]]);
  sk.hit(paper, body);
  sk.ctx.drawImage(sc.canvas, -w, top, 2 * w, len);
  sk.stroke(paper, 'rgba(120, 112, 92, 0.5)', sk.px(1));
  sk.box(-c.w, c.w, 0, top - 1, INK.dark, body, 0.6);
  sk.box(-c.w, c.w, top - 1, c.h, '#262c2e', body, 0.4);
}

/** A column's tube: glass, a metal collar at each end, and its bed filling it, what's on it shown on it (see drawColumn). */
function column(sk: Sketch, t: Tool): void {
  const { w, y0, y1 } = COLUMN.tube;
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  const sc = columnBoard(t);
  drawColumn(sc, t);
  const W = w - 1.6;
  sk.image(sc.canvas, -W / 2, W / 2, y0 + 1.5, y1 - 1.5, body);
  sk.glass(rect(-w / 2, w / 2, y0, y1), body);
  for (const y of [y0, y1]) sk.box(-w / 2 - 0.8, w / 2 + 0.8, y - 1.5, y + 1.5, INK.pipe, body, 0.5, INK.pipeEdge);
}

/** Each column's bed's board, kept with the column. */
const beds = new WeakMap<Tool, Board>();
function columnBoard(t: Tool): Board {
  let sc = beds.get(t);
  if (!sc) {
    const { w, y0, y1 } = COLUMN.tube;
    sc = board(w - 1.6, y1 - y0 - 3, 5);
    beds.set(t, sc);
  }
  return sc;
}

/**
 * A sheet pinned to the wall (see ToolShape.pinned), face on: a sheet of test paper or bond paper, its face as far as
 * what it shows has come up (see drawTestPaper and drawBondPaper), held up by a pin in each top corner; or a sheet of
 * shadow paper, its image (see drawSheet) under the dark bar clipped along its top, which pins it. All of it is hit
 * as it.
 */
function drawPaper(sk: Sketch, t: Tool, art: ToolArt): void {
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  const edge = 'rgba(120, 112, 92, 0.6)';
  if (t.kind === 'sheet') {
    const { side, top, clip } = SHEET;
    const sc = (art.screen ??= sheetBoard());
    drawSheet(sc, t);
    sk.image(sc.canvas, -side / 2, side / 2, top, top + side, body);
    sk.stroke(rect(-side / 2, side / 2, top, top + side), edge, sk.px(1));
    const b = t.shape.box;
    sk.box(b.x0, b.x1, 0, clip.h, INK.dark, body, 1.2, INK.darkEdge);
  } else {
    const { w, h } = TEST_PAPER;
    const sc = (art.screen ??= paperBoard());
    if (t.kind === 'testpaper') drawTestPaper(sc, t);
    else drawBondPaper(sc, t);
    sk.image(sc.canvas, -w / 2, w / 2, 0, h, body);
    sk.stroke(rect(-w / 2, w / 2, 0, h), edge, sk.px(1));
    for (const x of [-w / 2 + 4, w / 2 - 4]) {
      sk.fill(circle(x, 4, 1.6), '#9a3a32', body);
      sk.fill(circle(x - 0.5, 3.5, 0.5), 'rgba(255, 255, 255, 0.6)');
    }
  }
  sk.text(t.note, 0, -8);
}

/** The colors of the shadow lamp's frame: its steel, its edge, the glow of its pane while it's lit, and its button's. */
const LAMP_INK = { frame: '#3c4447', edge: '#20262a', glow: 'rgba(255, 244, 214, 0.22)', on: '#ffd27a', off: '#8a5a1c' };

/**
 * The shadow lamp's slot, behind its pane (see LAMP): dark, but for a sheet of shadow paper in it, which is drawn over
 * this, and then the lamp's frame over that (see drawLamp).
 */
export function drawLampSlot(sk: Sketch, t: Tool): void {
  const { pane } = LAMP;
  sk.box(-pane.r, pane.r, pane.y, LAMP.h, INK.recess, { kind: 'tool', t, part: 'body', k: 0 });
}

/**
 * The shadow lamp, built into the wall (see LAMP): a steel frame round its pane, and on the frame's right its dial
 * (how long it shines) and its button, lit while the lamp is; the pane's square washed with its light while it
 * shines. The slot behind the pane, and the sheet in it, are drawn before this (see drawLampSlot). Nothing is
 * written on it.
 */
function drawLamp(sk: Sketch, t: Tool): void {
  const body: Pick = { kind: 'tool', t, part: 'body', k: 0 };
  const { pane, button: bt } = LAMP;
  const b = t.shape.box;
  const frame = new Path2D();
  frame.addPath(rect(b.x0, b.x1, b.y0, b.y1, 3));
  frame.addPath(rect(-pane.r, pane.r, pane.y, LAMP.h + 1));
  sk.ctx.fillStyle = LAMP_INK.frame;
  sk.ctx.fill(frame, 'evenodd');
  // (hit only on the frame itself, not on its hole, so the sheet behind it can be taken out)
  for (const [x0, x1, y0, y1] of [[b.x0, -pane.r, b.y0, b.y1], [pane.r, b.x1, b.y0, b.y1], [-pane.r, pane.r, b.y0, pane.y]])
    sk.hit(rect(x0, x1, y0, y1), body);
  sk.stroke(rect(b.x0, b.x1, b.y0, b.y1 + 4, 3), LAMP_INK.edge, sk.px(1));
  sk.stroke(rect(-pane.r, pane.r, pane.y, LAMP.h + 4), LAMP_INK.edge, sk.w(1.2, 1));
  if (t.lit) sk.box(-pane.r, pane.r, pane.y, LAMP.h, LAMP_INK.glow);
  dial(sk, valveLocal(t, 0), t.valves[0], { kind: 'tool', t, part: 'valve', k: 0 });
  const button: Pick = { kind: 'tool', t, part: 'button', k: 0 };
  sk.fill(circle(bt.x, bt.y, bt.r + 2), LAMP_INK.edge, button);
  sk.fill(circle(bt.x, bt.y, bt.r), t.lit ? LAMP_INK.on : LAMP_INK.off, button);
  sk.fill(circle(bt.x - bt.r * 0.35, bt.y - bt.r * 0.35, bt.r * 0.3), t.lit ? 'rgba(255, 252, 236, 0.9)' : 'rgba(255, 220, 160, 0.25)');
  sk.text(t.note, (b.x0 + b.x1) / 2, b.y0 - 8);
}

/**
 * The supply station (see STATION), built into the wall: what stays on the wall (the dark recess, the rubber seam and
 * hazard tape round the hole, the warning lamp above it, and the door that comes down over the hole through a
 * changeover), and its block: a steel plate with the reservoir's narrow pane, its fluid filling it from the bottom,
 * and its name printed above; the funnel low beside it, over the diverter's LCD and the waste spigot; the purity
 * needle's dial; the reservoir's faucet; the gauge of segments beside the reservoir; and the two readouts. Through a
 * changeover the block sinks back into the dark, as far as it's slid back (see changeoverAt), and the door slides
 * down over it.
 */
function drawStation(sk: Sketch, t: Tool, art: ToolArt, clock: number): void {
  const sh = t.shape;
  const pk = (part: 'body' | 'tank' | 'valve' | 'spout', k = 0): Pick => ({ kind: 'tool', t, part, k });
  const body = pk('body');
  const { block: bk, lamp: lp } = STATION;
  const [fx, x] = sh.tanks.map(tankX);
  const { ctx } = sk;
  const co = changeoverAt(t.swap);
  const [bw, bh] = [bk.x1 - bk.x0, bk.y1 - bk.y0];
  const [cx, cy] = [(bk.x0 + bk.x1) / 2, (bk.y0 + bk.y1) / 2];
  // the hole: the dark recess the block slides back into
  sk.box(bk.x0, bk.x1, bk.y0, bk.y1, INK.recess, body);
  // the hazard tape round it, its inner edge a few units out from each corner, as if laid on by hand
  const taped = (d: number) =>
    TAPE.gaps.map(([gx, gy], i) => {
      const [sx, sy] = [i === 0 || i === 3 ? -1 : 1, i < 2 ? 1 : -1];
      return [cx + sx * (bw / 2 + gx + d), cy + sy * (bh / 2 + gy + d)];
    });
  const band = new Path2D();
  band.addPath(poly(taped(TAPE.w)));
  band.addPath(poly(taped(0)));
  const pattern = ctx.createPattern(tape(), 'repeat');
  if (pattern) {
    pattern.setTransform(new DOMMatrix().scale(TAPE.period / 64));
    ctx.fillStyle = pattern;
    ctx.fill(band, 'evenodd');
  }
  // the block, as far back into the wall as it's slid: smaller and darker the further back it is
  if (co.part !== 'away' && co.door < 1) {
    const k = 1 - 0.12 * co.back;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bk.x0, bk.y0, bw, bh);
    ctx.clip();
    sk.frame(cx, cy, () => {
      ctx.scale(k, k);
      sk.frame(-cx, -cy, () => stationBlock(sk, t, art, clock, fx, x));
    });
    if (co.back > 0) {
      ctx.fillStyle = `rgba(8, 10, 11, ${0.7 * co.back})`;
      ctx.fillRect(bk.x0, bk.y0, bw, bh);
    }
    ctx.restore();
  }
  // the rubber seam round the hole
  sk.stroke(rect(bk.x0 + 4, bk.x1 - 4, bk.y0 + 4, bk.y1 - 4), INK.rubber, 6);
  // the door, down from inside the wall above as far as it's shut: slats, each with a rib, and a rubber foot
  if (co.door > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(bk.x0, bk.y0, bw, bh);
    ctx.clip();
    const dy = bk.y0 - bh + co.door * bh;
    sk.box(bk.x0, bk.x1, dy, dy + bh, INK.shutter, body);
    const slat = bh / 6;
    for (let i = 0; i < 6; i++) {
      const y = dy + i * slat;
      sk.box(cx - (bw - 16) / 2, cx + (bw - 16) / 2, y + slat / 2 - 3, y + slat / 2 + 3, '#c3cac7', body, 1, '#97a09d');
      if (i) sk.box(bk.x0, bk.x1, y - 0.8, y + 0.8, INK.rubber, body);
    }
    sk.box(bk.x0, bk.x1, dy + bh - 7, dy + bh, INK.rubber, body);
    ctx.restore();
  }
  // the warning lamp above: its base, and its dome, glowing amber while the alarm sounds
  sk.fill(circle(lp.x, lp.y, lp.r + 3), INK.dark, body);
  if (co.alarm) {
    const glow = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, 85);
    glow.addColorStop(0, 'rgba(255, 162, 26, 0.75)');
    glow.addColorStop(1, 'rgba(255, 162, 26, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(lp.x - 85, lp.y - 85, 170, 170);
  }
  sk.fill(circle(lp.x, lp.y, lp.r), co.alarm ? '#ffc35c' : '#5c3a08', body);
  sk.fill(circle(lp.x - lp.r * 0.35, lp.y - lp.r * 0.35, lp.r * 0.3), co.alarm ? 'rgba(255, 250, 230, 0.9)' : 'rgba(255, 220, 160, 0.25)');
  // the notes: the player's labels above the block, and the note over it
  t.tanks.forEach((v, k) => sk.text(v.label, tankX(sh.tanks[k]), tankNoteY(t, k)));
  sk.text(t.note, (sh.box.x0 + sh.box.x1) / 2, sh.box.y0 - 8);
}

/** The station's hazard tape's stripes, made once. */
let tapeStripes: HTMLCanvasElement | null = null;
const tape = () => (tapeStripes ??= tapeCanvas());

/** The station's block, as it is when it's in place (see drawStation); fx and x are the funnel's and the reservoir's middles. */
function stationBlock(sk: Sketch, t: Tool, art: ToolArt, clock: number, fx: number, x: number): void {
  const sh = t.shape;
  const pk = (part: 'body' | 'tank' | 'valve' | 'spout', k = 0): Pick => ({ kind: 'tool', t, part, k });
  const body = pk('body');
  const { paneW, paneH: H, block: bk, funnel: f, gauge: g, display: dp, needle: nd } = STATION;
  const { supply } = t;
  const held = t.tanks[1].n[supply.species];
  // the plate, a block of the wall, with a slot for the pane
  sk.box(bk.x0, bk.x1, bk.y0, bk.y1, INK.plate, body);
  // the reservoir's column: its back, its fluid as high as it's full, and the pane in front
  sk.box(x - paneW / 2, x + paneW / 2, 0, H, INK.dark, pk('tank', 1));
  const res = t.tanks[1];
  const pane = rect(x - paneW / 2, x + paneW / 2, 0, H);
  sk.fluid(pane, res, H - H * share(res), H, x - paneW / 2, x + paneW / 2);
  sk.glass(pane, pk('tank', 1), res);
  // its name, printed above it, for whatever the station is fitted for
  if (art.plate?.supply !== supply) art.plate = { supply, c: printedCanvas(`${supply.name} reservoir`, 11, 12) };
  const pc = art.plate.c;
  const [pw, ph] = [pc.width / 12, pc.height / 12];
  sk.ctx.drawImage(pc, x - pw / 2, STATION.labelY - ph / 2, pw, ph);
  // the gauge: what's held against the goal; what's still wanted flashes, a second on and half off
  const blink = clock % 1.5 < 1;
  const seg = H / g.segments;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  gaugeSegments(held, supply.goal, supply.cap).forEach((st, i) => {
    const lit = st === 'held' || (st === 'wanted' && blink);
    const color = hex(lit ? SEGMENT_COLORS[st] : SEGMENT_COLORS.off);
    if (lit) {
      sk.ctx.shadowColor = color;
      sk.ctx.shadowBlur = 6 * sk.ctx.getTransform().a;
    }
    sk.box(g.x0, g.x1, H - (i + 1) * seg + 1, H - i * seg - 1, color, body);
    sk.ctx.shadowBlur = 0;
  });
  // the funnel, its fluid settling into it as drawn (see STATION_FUNNEL), over its stem into the plate
  const stem = f.y + f.h + 6;
  sk.stroke(line([[fx, f.y + f.h], [fx, stem]]), 'rgba(222, 240, 246, 0.6)', FUNNEL_TIP);
  sk.box(fx - 5, fx + 5, stem - 5, stem + 5, INK.pipe, body, 1, INK.pipeEdge);
  const funnel = trap(fx, f.y, f.y + f.h, 2 * f.w, FUNNEL_TIP);
  const fv = t.tanks[0];
  sk.fluid(poly(funnel), fv, f.y + f.h - levelIn(STATION_FUNNEL, share(fv)), f.y + f.h, fx - f.w, fx + f.w);
  sk.glass(poly(funnel), pk('tank', 0), fv, line([funnel[0], funnel[3], funnel[2], funnel[1]]));
  // the diverter's LCD, and the needle's dial in its bezel
  const div = boardOf(art, 'diverter', dp, 8);
  drawDiverter(div, t.gate, t.sinceFlow < DIVERTER_HOLD);
  sk.image(div.canvas, dp.x0, dp.x1, dp.y0, dp.y1);
  sk.box(nd.x0 - 2, nd.x1 + 2, nd.y0 - 2, nd.y1 + 2, INK.dark, body, 1.5);
  const needle = boardOf(art, 'needle', nd, 10);
  drawNeedle(needle, t.needle);
  sk.image(needle.canvas, nd.x0, nd.x1, nd.y0, nd.y1, body);
  // the readouts: the litres of what it's for in the reservoir, of what's needed; and how long it's been delivering steadily
  const screen = (r: { x0: number; x1: number; y0: number; y1: number }, key: 'screen' | 'steady', text: string) => {
    sk.box(r.x0 - 1.5, r.x1 + 1.5, r.y0 - 1.5, r.y1 + 1.5, INK.dark, body);
    const sc = boardOf(art, key, r, 8);
    phosphor(sc, r, text);
    sk.image(sc.canvas, r.x0, r.x1, r.y0, r.y1, body);
  };
  screen(STATION.screen, 'screen', `${litresOf(held).toFixed(2)} L / ${supply.goalL.toFixed(2)} L`);
  const open = supply.airlock && t.steady >= DELIVERY.streak;
  screen(STATION.steadyScreen, 'steady', open ? 'AIRLOCK OPEN' : `STEADY ${clockText(t.steady)}`);
  // the waste spigot and the reservoir's faucet: out of the plate, and down; all of each is its spout
  sh.spouts.forEach((sx, k) => {
    sk.pipe([[sx, H + 10], [sx, sh.spoutY - 4]], 2.5, pk('spout', k));
    sk.fill(circle(sx, H + 10, 3.6), INK.pipe, pk('spout', k));
    sk.stroke(circle(sx, H + 10, 3.6), INK.pipeEdge, sk.px(1));
    sk.box(sx - 4, sx + 4, sh.spoutY - 6, sh.spoutY, INK.pipe, pk('spout', k), 0.8, INK.pipeEdge);
  });
  // the spigot's valve, with no handle (only the diverter works it), and the faucet's lever
  sk.fill(circle(sh.spouts[0], sh.valveY, 4.5), INK.panel, pk('spout', 0));
  sk.stroke(circle(sh.spouts[0], sh.valveY, 4.5), INK.panelEdge, sk.px(1));
  t.valves.forEach((v, k) => valve(sk, valveLocal(t, k), (-v * Math.PI) / 2, pk('valve', k)));
}

/* ---------------- flasks and scales ---------------- */

/** A flask's glass, closed for its inside and open at its mouth for its outline, with a little lip flaring out. */
const FLASK_INSIDE = poly(FLASK_OUTLINE.map((p) => [p.x, p.y]));
const FLASK_GLASS = line([[12.5, -0.5], ...FLASK_OUTLINE.slice(1).map((p) => [p.x, p.y]), [-11, 0], [-12.5, -0.5]]);
/** How deep a trace in an upright flask is drawn, at least, over its floor, so a trace in a flask shows. */
const FLASK_FILM = 0.75;

/** A flask, in its frame at its mouth, tipped by its tilt about the mouth, its fluid lying level; and its label. */
export function drawFlask(sk: Sketch, f: Flask): void {
  const pick: Pick = { kind: 'flask', f };
  const level = fillLevel(f.tilt, volume(f) / f.cap);
  const top = -Math.max(level, f.tilt === 0 ? -FLASK_H + FLASK_FILM : -Infinity);
  const { ctx } = sk;
  if (f.N > TRACE) {
    ctx.save();
    ctx.rotate(f.tilt);
    ctx.clip(FLASK_INSIDE);
    ctx.rotate(-f.tilt);
    sk.fluid(rect(-90, 90, -90, 90), f, top, 90, -90, 90, { round: flaskRadius });
    ctx.restore();
  }
  sk.frame(0, 0, () => sk.glass(FLASK_INSIDE, pick, f, FLASK_GLASS), f.tilt);
  sk.text(f.label, 0, -NOTE_Y);
}

/**
 * A scale, in its frame at its platform's top middle: its body, its steel platform, its seven-segment display (see
 * drawScaleReading) and its red tare key, sunk while it's held down and lit while the pointer's on it; and its note.
 */
export function drawScale(sk: Sketch, sc: Scale, display: Board, pressed: boolean, hot: boolean): void {
  const { platform: pl, body, display: d, tare } = SCALE_SHAPE;
  const pick: Pick = { kind: 'scale', sc, part: 'body' };
  sk.box(body.x0, body.x1, 4, body.y1, INK.panel, pick, 2.5, INK.panelEdge);
  sk.box(pl.x0, pl.x1, 0, 5, INK.pipe, pick, 1.5, INK.pipeEdge);
  sk.box(d.x0 - 0.5, d.x1 + 0.5, d.y0 - 0.5, d.y1 + 0.5, INK.dark, pick);
  drawScaleReading(display, sc);
  sk.image(display.canvas, d.x0, d.x1, d.y0, d.y1, pick);
  const key = pressed ? '#9c2d28' : hot ? '#f06358' : '#d8443b';
  const sink = pressed ? 0.8 : 0;
  sk.box(tare.x0 + sink, tare.x1 - sink, tare.y0 + sink, tare.y1 - sink, key, { kind: 'scale', sc, part: 'tare' }, 1.5, '#7a221e');
  if (!pressed) sk.box(tare.x0 + 2, tare.x1 - 2, tare.y0 + 1.5, tare.y0 + 3, 'rgba(255, 255, 255, 0.25)', null, 1);
  sk.text(sc.note, 0, -(sc.load.length ? FLASK_H + NOTE_Y + 13 : NOTE_Y));
}

/** A new board for a scale's display. */
export const scaleDisplay = (): Board => board(SCALE_SHAPE.display.x1 - SCALE_SHAPE.display.x0, SCALE_SHAPE.display.y1 - SCALE_SHAPE.display.y0, 6);
