import type { Fluid } from '../chem/reactions';
import { TRACE } from './config';
import { fluidAlpha, fluidColor, fluidRGB } from './flask';
import { lampLight, ringShare } from './tools';
import type { Pick } from './view';

/**
 * The view's drawing kit (see view.ts): a 2D canvas context, drawn on in the lab's flat frames, that remembers
 * everything it draws that can be hit as the shape it was drawn (see Region), so that what the pointer is on is
 * worked out from just what's drawn, topmost first, and empty space inside something's bounds isn't it.
 *
 * Its frames are all y down. The wall's frame is the room's x across and its height, negated, down; a thing's own
 * flat frame (a tool's, a flask's, a scale's: see onTool and friends in bodies.ts) is the wall's moved to its
 * origin, so the numbers its shape is given in are used as they are.
 */

/**
 * Something drawn that can be hit: its shape, filled (width 0) or stroked `width` wide with round ends, in the frame it
 * was drawn in, which `m` puts in the wall's frame; and what it's part of.
 */
export interface Region {
  path: Path2D;
  m: DOMMatrix;
  width: number;
  pick: Pick;
  /** The box round it in the wall's frame, if its path's bounds are known (see bound), to pass it by quickly. */
  box?: Box;
}

/** A box: x0, y0, x1, y1. */
export type Box = [number, number, number, number];

/** The bounds of the paths made here, and of those others give theirs (see bound). */
const BOUNDS = new WeakMap<Path2D, Box>();

/** Say what a path's bounds are (in its own frame), so what's drawn with it can be passed by quickly; returns the path. */
export function bound(p: Path2D, x0: number, y0: number, x1: number, y1: number): Path2D {
  BOUNDS.set(p, [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]);
  return p;
}

/** The bounds of points. */
export function boundPts(p: Path2D, pts: readonly (readonly number[])[]): Path2D {
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return bound(p, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

/** A box, as `m` puts it, and grown by `pad` all round. */
export function boxThrough(m: DOMMatrix, [x0, y0, x1, y1]: Box, pad = 0): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const q = m.transformPoint({ x, y });
    xs.push(q.x);
    ys.push(q.y);
  }
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** The view's colors: its materials', flat, and the glass and fluid's look. */
export const INK = {
  glass: 'rgba(222, 240, 246, 0.16)',
  glassEdge: 'rgba(244, 251, 253, 0.95)',
  glassShade: 'rgba(48, 66, 72, 0.5)',
  pipe: '#a4adac',
  pipeEdge: '#6f7a79',
  pipeShine: '#d3dad9',
  dark: '#30373a',
  darkEdge: '#1b2022',
  panel: '#c4cbc7',
  panelEdge: '#838d8a',
  lever: '#15191a',
  enamel: '#f1efe6',
  paper: '#e6dfc8',
  plate: '#6f7975',
  rubber: '#1a1d1c',
  recess: '#15181a',
  shutter: '#b4bcb9',
  chrome: '#e2e7e8',
  chromeEdge: '#8b9597',
  rod: '#c8cfcd',
  text: '#1d2426',
  textHalo: 'rgba(214, 222, 219, 0.75)',
  flash: '92, 255, 154',
} as const;

/** How the green flash over a vessel a guide ends at pulses (see Frame.guides): FLASH.hz times a real second, between lo and hi opacity. */
export const FLASH = { hz: 1.5, lo: 0.05, hi: 0.22 };

/** Height of each line of a label or note, in world units. */
export const LABEL_H = 10;

/**
 * How deep a body of fluid is front to back, for how much of the shadow lamp's light it lets through (see
 * Sketch.shade): `flat`, the same all across, as in a box of a tank; or `round`, a round body whose radius at each
 * height y (y down, in the frame in force) it gives, as in a flask, so that it's deepest down its middle.
 */
export type Deep = { flat: number } | { round: (y: number) => number };

export class Sketch {
  readonly regions: Region[] = [];
  /**
   * What everything hittable drawn is part of instead, while it's set: a thing in the equipment cabinet is drawn as
   * one in the lab would be, but it's all the one thing in its slot.
   */
  as: Pick | null = null;
  /**
   * Whether it's drawing what casts a shadow in the shadow lamp's light (see View.exposure), rather than how things
   * look: then what's opaque is drawn as it is, of which only how opaque it is counts; glass, labels and notes not at
   * all; and fluid as dark as it dims the light (see lampLight), by its share of rings and how deep it is.
   */
  shade = false;
  private inv: DOMMatrix;

  /**
   * Drawing on `ctx`, whose transform `base` puts the wall's frame on its canvas, `s` CSS pixels to a world unit. With
   * `record` false, nothing's remembered for hitting (as for the equipment wheels' icons). `flash` is how strongly
   * the vessels in `targets` flash just now (see FLASH).
   */
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly base: DOMMatrix,
    readonly s: number,
    readonly record = true,
    readonly targets: ReadonlySet<object> = new Set(),
    readonly flash = 0,
  ) {
    this.inv = base.inverse();
    ctx.setTransform(base);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  /** `n` CSS pixels, in world units. */
  px(n: number): number {
    return n / this.s;
  }

  /** A width of `u` world units, but never under `min` CSS pixels, so fine lines stay seen when zoomed out. */
  w(u: number, min = 1): number {
    return Math.max(u, min / this.s);
  }

  /** Remember a shape as drawn in the frame now in force, filled or stroked `width` wide, as part of `pick`. */
  hit(path: Path2D, pick: Pick | null | undefined, width = 0): void {
    if (!this.record || !pick) return;
    const m = this.inv.multiply(this.ctx.getTransform());
    const b = BOUNDS.get(path);
    const box = b && boxThrough(m, b, (width / 2) * Math.hypot(m.a, m.b));
    this.regions.push({ path, m, width, pick: this.as ?? pick, box });
  }

  /** Draw in a frame moved to (x, y) of the current one, and rotated by `turn` (clockwise, in radians). */
  frame(x: number, y: number, draw: () => void, turn = 0): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    if (turn) ctx.rotate(turn);
    draw();
    ctx.restore();
  }

  fill(path: Path2D, style: string | CanvasGradient | CanvasPattern, pick?: Pick | null): void {
    this.ctx.fillStyle = style;
    this.ctx.fill(path);
    this.hit(path, pick);
  }

  stroke(path: Path2D, style: string | CanvasGradient, width: number, pick?: Pick | null): void {
    const { ctx } = this;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.stroke(path);
    this.hit(path, pick, width);
  }

  /** A box x0..x1 by y0..y1, its corners rounded by r: filled, edged a pixel wide in `edge` if given. */
  box(x0: number, x1: number, y0: number, y1: number, fill: string, pick?: Pick | null, r = 0, edge?: string): Path2D {
    const p = rect(x0, x1, y0, y1, r);
    this.fill(p, fill, pick);
    if (edge) this.stroke(p, edge, this.px(1));
    return p;
  }

  /** A steel pipe `r` in radius through points: edged darker, with a shine down it. */
  pipe(pts: readonly (readonly number[])[], r = 2, pick?: Pick | null, color: string = INK.pipe): void {
    const p = line(pts);
    this.stroke(p, INK.pipeEdge, 2 * r, pick);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = Math.max(2 * r - this.px(1.6), r);
    this.ctx.stroke(p);
    this.ctx.strokeStyle = INK.pipeShine;
    this.ctx.lineWidth = r * 0.45;
    this.ctx.globalAlpha = 0.6;
    this.ctx.stroke(p);
    this.ctx.globalAlpha = 1;
  }

  /** Glass in the shape of `p`: a faint fill and pale edges, flashing green while `v` is one of the targets. */
  glass(p: Path2D, pick?: Pick | null, v?: object, outline: Path2D = p): void {
    // (glass casts no shadow)
    if (this.shade) return;
    this.fill(p, INK.glass, pick);
    if (v && this.targets.has(v) && this.flash > 0) this.fill(p, `rgba(${INK.flash}, ${this.flash})`);
    this.stroke(outline, INK.glassShade, this.w(1.4, 1.6));
    this.stroke(outline, INK.glassEdge, this.w(0.7, 0.8));
  }

  /**
   * Fluid `f` in a vessel whose inside is `inside`, standing from `bottom` up to `top` (y down, so top < bottom),
   * across x0..x1: its color, as see-through as it is, with a bright line along its surface where it's clear, so even
   * clear solvent reads as fluid with a surface. Nothing for a trace.
   */
  fluid(inside: Path2D, f: Fluid, top: number, bottom: number, x0: number, x1: number, deep?: Deep): void {
    if (f.N <= TRACE || top >= bottom) return;
    if (this.shade) return this.shadeFluid(inside, f, top, bottom, x0, x1, deep);
    const { ctx } = this;
    ctx.save();
    ctx.clip(inside);
    ctx.fillStyle = fluidColor(f);
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
    const clear = 1 - fluidAlpha(f);
    const rgb = fluidRGB(f);
    if (clear > 0.02 && rgb) {
      // thicker toward its edges, where it's seen through more of itself, and a bright line along
      // its surface, in its own color washed toward white
      ctx.beginPath();
      ctx.rect(x0, top, x1 - x0, bottom - top);
      ctx.clip();
      ctx.strokeStyle = `rgba(${rgb.map(Math.round).join(', ')}, ${0.6 * clear})`;
      ctx.lineWidth = this.w(3, 3);
      ctx.stroke(inside);
      const wash = rgb.map((c) => Math.round(c + (255 - c) * 0.5)).join(', ');
      ctx.fillStyle = `rgba(${wash}, ${0.9 * clear})`;
      ctx.fillRect(x0, top, x1 - x0, this.w(0.8, 1.5));
    }
    ctx.restore();
  }

  /**
   * Fluid's shadow (see shade): as dark as it dims the lamp's light, through as deep a body of it as `deep` says, or,
   * if that's left out, a round one as wide as x0..x1.
   */
  private shadeFluid(inside: Path2D, f: Fluid, top: number, bottom: number, x0: number, x1: number, deep?: Deep): void {
    const ring = ringShare(f);
    if (ring <= 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.clip(inside);
    if (deep && 'flat' in deep) {
      ctx.fillStyle = dimness(ring, deep.flat);
      ctx.fillRect(x0, top, x1 - x0, bottom - top);
    } else {
      const cx = (x0 + x1) / 2;
      const radius = deep && 'round' in deep ? deep.round : () => (x1 - x0) / 2;
      // a band at a time, each as deep as a round body that wide is through each line of sight across it
      const step = 1;
      for (let y = top; y < bottom; y += step) {
        const R = radius(y + step / 2);
        if (!(R > 0)) continue;
        const g = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
        for (let i = 0; i <= 8; i++) {
          const u = -1 + i / 4;
          g.addColorStop(i / 8, dimness(ring, 2 * R * Math.sqrt(Math.max(0, 1 - u * u))));
        }
        ctx.fillStyle = g;
        ctx.fillRect(cx - R, y, 2 * R, step + 0.05);
      }
    }
    ctx.restore();
  }

  /**
   * What to paint fluid `f` with, `depth` deep front to back: its color; or, drawing what casts a shadow (see shade),
   * as dark as it dims the lamp's light.
   */
  ink(f: Fluid, depth: number): string {
    return this.shade ? dimness(ringShare(f), depth) : fluidColor(f);
  }

  /**
   * A label or note: lines of text centered on (x, y), LABEL_H tall each, dark with a pale halo so it reads over
   * whatever's behind it; or pale over a dark halo, if `light`. It's never hit.
   */
  text(lines: string | readonly string[], x: number, y: number, h = LABEL_H, light = false): void {
    const ls = typeof lines === 'string' ? [lines] : lines;
    // (a label isn't a thing, and casts no shadow)
    if (this.shade) return;
    if (!ls.length || (ls.length === 1 && !ls[0])) return;
    const { ctx } = this;
    ctx.font = `500 ${h * 0.8}px "Schibsted Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = h * 0.22;
    ctx.strokeStyle = light ? 'rgba(20, 26, 28, 0.7)' : INK.textHalo;
    ctx.fillStyle = light ? '#e6ece8' : INK.text;
    ls.forEach((l, i) => {
      const ly = y + (i - (ls.length - 1) / 2) * h * 1.05;
      ctx.strokeText(l, x, ly);
      ctx.fillText(l, x, ly);
    });
  }

  /** A canvas drawn over x0..x1 by y0..y1, hit as `pick` all over. */
  image(c: CanvasImageSource, x0: number, x1: number, y0: number, y1: number, pick?: Pick | null): void {
    this.ctx.drawImage(c, x0, y0, x1 - x0, y1 - y0);
    this.hit(rect(x0, x1, y0, y1), pick);
  }
}

/** Black, as opaque as fluid `depth` deep with `ring` of its molecules ringed takes the lamp's light away (see lampLight). */
function dimness(ring: number, depth: number): string {
  return `rgba(0, 0, 0, ${1 - lampLight(ring, depth)})`;
}

/** A box x0..x1 by y0..y1 as a path, its corners rounded by r. */
export function rect(x0: number, x1: number, y0: number, y1: number, r = 0): Path2D {
  const p = new Path2D();
  if (r > 0) p.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  else p.rect(x0, y0, x1 - x0, y1 - y0);
  return bound(p, x0, y0, x1, y1);
}

/** A line through points, as a path. */
export function line(pts: readonly (readonly number[])[]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  return boundPts(p, pts);
}

/** A closed polygon through points, as a path. */
export function poly(pts: readonly (readonly number[])[]): Path2D {
  const p = line(pts);
  p.closePath();
  return boundPts(p, pts);
}

/** A circle as a path. */
export function circle(x: number, y: number, r: number): Path2D {
  const p = new Path2D();
  p.arc(x, y, r, 0, 2 * Math.PI);
  return bound(p, x - r, y - r, x + r, y + r);
}

/**
 * Whether a region is under the point (x, y) of the canvas, in device pixels, with `base` putting the wall's frame on
 * it now; `at` is that point in the wall's frame.
 */
export function hits(ctx: CanvasRenderingContext2D, base: DOMMatrix, r: Region, x: number, y: number, at: { x: number; y: number }): boolean {
  if (r.box && (at.x < r.box[0] || at.x > r.box[2] || at.y < r.box[1] || at.y > r.box[3])) return false;
  ctx.save();
  ctx.setTransform(base.multiply(r.m));
  let on: boolean;
  if (r.width > 0) {
    ctx.lineWidth = r.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    on = ctx.isPointInStroke(r.path, x, y);
  } else on = ctx.isPointInPath(r.path, x, y);
  ctx.restore();
  return on;
}
