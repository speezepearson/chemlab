import { arrival, notice } from '../intro/notice';
import type { Stocked } from './cabinet';
import {
  alarmAt, alarmPlate, drawAlarm, drawArms, drawCabinet, drawCounter, drawFaucets, drawFlows, drawGuides, drawHoses, drawNozzles, drawSpecimen,
  drawWall, specimens, type Span,
} from './flatRoom';
import { drawFlask, drawScale, drawTool, scaleDisplay, type ToolArt } from './flatTools';
import { OUTLINE } from './outline';
import type { Scale } from './scale';
import { messageCanvas, MSG_PAD, MSG_PX, OK_PX, okCanvas, type Board } from './screens';
import { boxThrough, FLASH, hits, Sketch, type Region } from './sketch';
import { PLANE_Z, type Vec3 } from './space';
import { thingOf } from './thing';
import { SHAPES, THERMOMETER_ROD, type Tool } from './tools';
import type { Camera, Frame, Icons, LabView, Pick } from './view';
import { WHEEL, WHEELS } from './wheel';

/** The outline's color round something held where it can't be let go of (see Frame.bad): a clear red, as the wall view's. */
const BAD_OUTLINE = '#ff3b2f';
/** The wall view's field of view, top to bottom, in degrees: how far back its camera would be to see as much as this view does. */
const FOV = 45;
/** How much of the view the pod's message may cover, at most, each way; and how wide it's drawn, at most, in CSS pixels. */
const MESSAGE_FIT = { share: 0.9, w: 820 };
/** An icon's margin, as a share of its side (as the wall view's). */
const ICON_MARGIN = 0.04;

/**
 * Draws the lab flat, on a plain 2D canvas, with nothing three-dimensional about it: the bench as it is in its own
 * plane (see PLANE_Z), seen square on with no perspective (see Camera.ortho), x across and y up, everything drawn from
 * its flat outline as it's defined (see flatTools.ts and flatRoom.ts). It's the view of the `flat` mode (see mode.ts),
 * and stands in for View wherever the engine draws or asks what the pointer is on, which it works out from what it
 * drew, topmost first (see Sketch). There's no wall behind the bench in it, and no pod to be seen: the pod's message
 * is shown over the bench, darkened as the pod is.
 */
export class FlatView implements LabView {
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: FOV, ortho: 500 };
  /** The canvas's size in CSS pixels, and device pixels to each. */
  private w = 1;
  private h = 1;
  private dpr = 1;
  /** Everything that can be hit in the last frame drawn, bottom first. */
  private regions: Region[] = [];
  /** What's kept of each tool and scale between frames (its screens). */
  private arts = new Map<Tool, ToolArt>();
  private displays = new Map<Scale, Board>();
  /** A new one of each kind, for the equipment cabinet and the icons. */
  private specimens = specimens();
  /** Real seconds drawn, for the guides' flash, which isn't part of the lab. */
  private real = 0;
  /** The canvases the outline's drawn with: the outlined thing's silhouette, and the ring round it. */
  private mask = document.createElement('canvas');
  private ring = document.createElement('canvas');
  /** The pod's message, as last laid out, for what it says; and its OK button, in CSS pixels, while it's up. */
  private message: { said: string; c: HTMLCanvasElement } | null = null;
  private ok: { x0: number; x1: number; y0: number; y1: number } | null = null;
  /** The OK button's faces, unlit and lit. */
  private okFaces = [okCanvas(false), okCanvas(true)];
  private drawnIcons: Icons | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** A little picture of each kind the equipment wheels make, drawn as it is in the lab (see drawIcons). */
  icons(): Readonly<Icons> {
    return (this.drawnIcons ??= this.drawIcons());
  }

  resize(w: number, h: number, dpr: number): void {
    [this.w, this.h, this.dpr] = [Math.max(1, w), Math.max(1, h), dpr];
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }

  look(cam: Camera): void {
    this.cam = cam;
  }

  /** CSS pixels to a world unit. */
  private scale(): number {
    return this.h / 2 / (this.cam.ortho ?? 500);
  }

  /** What puts the wall's frame (x along the wall, y down: see Sketch) on the canvas, in device pixels, as the view is now. */
  private base(): DOMMatrix {
    const [s, d] = [this.scale(), this.dpr];
    return new DOMMatrix([d * s, 0, 0, d * s, d * (this.w / 2 - this.cam.x * s), d * (this.h / 2 + this.cam.y * s)]);
  }

  /** The stretch of the wall in view. */
  private span(): Span {
    const s = this.scale();
    const [hw, hh] = [this.w / 2 / s, this.h / 2 / s];
    return { x0: this.cam.x - hw, x1: this.cam.x + hw, y0: this.cam.y - hh, y1: this.cam.y + hh };
  }

  render(fr: Frame): void {
    const { ctx } = this;
    this.cam = fr.cam;
    this.real += fr.dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // the end, at Mu Ceti: nothing of the lab, only white
    if (fr.airlock.arrival) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.regions = [];
      this.ok = null;
      return;
    }
    const flash = FLASH.lo + (FLASH.hi - FLASH.lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * FLASH.hz * this.real));
    const sk = new Sketch(ctx, this.base(), this.scale(), true, new Set(fr.guides.map((g) => g.v)), flash);
    drawWall(sk, this.span());
    drawCabinet(sk, fr.stock, this.specimens);
    drawCounter(sk);
    drawFaucets(sk, fr.faucets);
    const station = fr.tools.find((t) => t.shape.wall);
    drawAlarm(sk, alarmAt(station?.pose), fr.alarmsOff, alarmPlate());
    drawArms(sk, fr.arms);
    drawHoses(sk, fr.hoses);
    // the station in the wall, behind everything else in the plane; then the rest of the tools, the scales and the
    // flasks, each with what's outlined (what's held, or what the pointer's on) over the rest of its kind
    const h = fr.hot;
    const up = h?.kind === 'tool' ? h.t : h?.kind === 'flask' ? h.f : h?.kind === 'scale' ? h.sc : null;
    const order = <T extends object>(xs: readonly T[], under: (x: T) => boolean = () => false) =>
      [...xs].sort((a, b) => Number(under(b)) - Number(under(a)) || Number(a === up) - Number(b === up));
    for (const t of order(fr.tools, (t) => !!t.shape.wall)) sk.frame(t.pose.x, -t.pose.y, () => drawTool(sk, t, this.artOf(t), fr.clock, fr.energies));
    for (const sc of order(fr.scales)) {
      const hot = h?.kind === 'scale' && h.sc === sc && h.part === 'tare';
      sk.frame(sc.pose.x, -sc.pose.y, () => drawScale(sk, sc, this.displayOf(sc), fr.tarePress === sc, hot));
    }
    for (const f of order(fr.flasks)) sk.frame(f.pose.x, -f.pose.y, () => drawFlask(sk, f));
    drawNozzles(sk, fr.hoses);
    drawFlows(sk, fr);
    drawGuides(sk, fr.guides);
    this.forget(fr);
    this.regions = sk.regions;
    this.outline(fr.hot, fr.bad);
    this.pod(fr);
  }

  /** What's kept of a tool between frames, made the first time it's drawn. */
  private artOf(t: Tool): ToolArt {
    let a = this.arts.get(t);
    if (!a) this.arts.set(t, (a = {}));
    return a;
  }

  private displayOf(sc: Scale): Board {
    let d = this.displays.get(sc);
    if (!d) this.displays.set(sc, (d = scaleDisplay()));
    return d;
  }

  /** Let go of what was kept of tools and scales that are gone. */
  private forget(fr: Frame): void {
    const tools = new Set(fr.tools);
    for (const t of this.arts.keys()) if (!tools.has(t)) this.arts.delete(t);
    const scales = new Set(fr.scales);
    for (const sc of this.displays.keys()) if (!scales.has(sc)) this.displays.delete(sc);
  }

  /**
   * The outline round everything drawn of what's outlined (see Frame.hot): a ring OUTLINE.width wide round its
   * silhouette, the whole of it whatever's in front, white or as the player set it, or red if it's held where it can't
   * be left. As the wall view's, it's the whole of a tool for any of its parts, the station a part at a time (see
   * thingOf), and one thing in the cabinet alone.
   */
  private outline(hot: Pick | null, bad: boolean): void {
    const width = OUTLINE.width;
    if (!hot || width <= 0) return;
    let mine: (p: Pick) => boolean;
    if (hot.kind === 'stock') mine = (p) => p.kind === 'stock' && p.item === hot.item && p.slot === hot.slot;
    else {
      const thing = thingOf(hot);
      if (thing === null) return;
      mine = (p) => p.kind !== 'stock' && thingOf(p) === thing;
    }
    const parts = this.regions.filter((r) => mine(r.pick));
    if (!parts.length) return;
    const base = this.base();
    const reach = width * this.dpr;
    // the stretch of the canvas it's in, with room for the ring round it; all of it, if any part's bounds aren't known
    const { width: CW, height: CH } = this.canvas;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of parts) {
      if (!r.box) {
        [x0, y0, x1, y1] = [0, 0, CW, CH];
        break;
      }
      const b = boxThrough(base, r.box);
      [x0, y0, x1, y1] = [Math.min(x0, b[0]), Math.min(y0, b[1]), Math.max(x1, b[2]), Math.max(y1, b[3])];
    }
    x0 = Math.max(0, Math.floor(x0 - reach - 2));
    y0 = Math.max(0, Math.floor(y0 - reach - 2));
    x1 = Math.min(CW, Math.ceil(x1 + reach + 2));
    y1 = Math.min(CH, Math.ceil(y1 + reach + 2));
    const [W, H] = [x1 - x0, y1 - y0];
    if (W <= 0 || H <= 0) return;
    for (const c of [this.mask, this.ring])
      if (c.width < W || c.height < H) [c.width, c.height] = [Math.max(c.width, W), Math.max(c.height, H)];
    const shift = new DOMMatrix().translate(-x0, -y0).multiply(base);
    const m = this.mask.getContext('2d')!;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, W, H);
    m.fillStyle = m.strokeStyle = '#ffffff';
    m.lineCap = m.lineJoin = 'round';
    for (const r of parts) {
      m.setTransform(shift.multiply(r.m));
      if (r.width > 0) {
        m.lineWidth = r.width;
        m.stroke(r.path);
      } else m.fill(r.path);
    }
    const g = this.ring.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    for (const q of reach > 2 ? [reach, reach / 2] : [reach])
      for (let i = 0; i < 16; i++) g.drawImage(this.mask, 0, 0, W, H, q * Math.cos((i * Math.PI) / 8), q * Math.sin((i * Math.PI) / 8), W, H);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = bad ? BAD_OUTLINE : OUTLINE.color;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(this.mask, 0, 0, W, H, 0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.ring, 0, 0, W, H, x0, y0, W, H);
  }

  /**
   * The cryopod: the lab darkened as far as it's shut out by the pod (see AirlockLook.dark), and while the pod's
   * message is up, the message over it all (see messageCanvas), fitted to the view, its OK button lit while the
   * pointer's on it.
   */
  private pod(fr: Frame): void {
    const { ctx } = this;
    const a = fr.airlock;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (a.dark > 0) {
      ctx.fillStyle = `rgba(1, 2, 6, ${0.94 * Math.min(1, a.dark)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    this.ok = null;
    if (!a.message) return;
    const said = a.notice.arrival ? 'arrival' : `${a.notice.litres.toFixed(2)} ${a.notice.first?.toFixed(2)}`;
    if (this.message?.said !== said)
      this.message = { said, c: messageCanvas(a.notice.arrival ? arrival() : notice(a.notice.litres, a.notice.first)) };
    const c = this.message.c;
    const k = Math.min((MESSAGE_FIT.share * this.w) / c.width, (MESSAGE_FIT.share * this.h) / c.height, MESSAGE_FIT.w / c.width);
    const [mw, mh] = [c.width * k, c.height * k];
    const [x, y] = [(this.w - mw) / 2, (this.h - mh) / 2];
    ctx.drawImage(c, x, y, mw, mh);
    const ok = { x0: x + (MSG_PX - MSG_PAD - OK_PX.w) * k, y0: y + mh - (MSG_PAD + OK_PX.h) * k };
    this.ok = { ...ok, x1: ok.x0 + OK_PX.w * k, y1: ok.y0 + OK_PX.h * k };
    ctx.drawImage(this.okFaces[a.okHot ? 1 : 0], ok.x0, ok.y0, OK_PX.w * k, OK_PX.h * k);
  }

  /**
   * What's under (ndcX, ndcY), skipping anything belonging to `skip` (what's held): the topmost thing drawn there, as
   * it was drawn (see Sketch), but where the view is now; the equipment cabinet's open front only while something's
   * held. While the pod's message is up, only its OK button. Where on the wall's plane it is, at no distance.
   */
  pick(ndcX: number, ndcY: number, skip: object | null): (Pick & { point: Vec3; distance: number }) | null {
    const [px, py] = [((ndcX + 1) / 2) * this.w, ((1 - ndcY) / 2) * this.h];
    const s = this.scale();
    const point = { x: this.cam.x + (px - this.w / 2) / s, y: this.cam.y - (py - this.h / 2) / s, z: PLANE_Z };
    if (this.message && this.ok !== null) {
      const o = this.ok;
      return px >= o.x0 && px <= o.x1 && py >= o.y0 && py <= o.y1 ? { kind: 'wake', point, distance: 0 } : null;
    }
    const base = this.base();
    const at = { x: point.x, y: -point.y };
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      const p = r.pick;
      if (skip && Object.values(p).includes(skip)) continue;
      if (p.kind === 'cabinet' && p.front && !skip) continue;
      if (hits(this.ctx, base, r, px * this.dpr, py * this.dpr, at)) return { ...p, point, distance: 0 };
    }
    return null;
  }

  project(p: Vec3, w: number, h: number): { x: number; y: number } | null {
    const s = h / 2 / (this.cam.ortho ?? 500);
    return { x: w / 2 + (p.x - this.cam.x) * s, y: h / 2 - (p.y - this.cam.y) * s };
  }

  /**
   * A point in the room relative to where the player hears from: a head at the view's middle, as far back from the
   * bench as the wall view's camera would be to see as much of it; x right, y up, z behind.
   */
  toHead(p: Vec3): Vec3 {
    const back = (this.cam.ortho ?? 500) / Math.tan((FOV * Math.PI) / 360);
    return { x: p.x - this.cam.x, y: p.y - this.cam.y, z: p.z - (PLANE_Z + back) };
  }

  dispose(): void {
    this.regions = [];
    this.arts.clear();
    this.displays.clear();
  }

  /**
   * A little picture of each kind the equipment wheels make, on a canvas of its own WHEEL.icon.size CSS pixels a side:
   * a new one of it, drawn as it is in the lab, filling the picture but for a margin. A thermometer is so long and
   * thin that its scale's numbers, all that tells the fine one from the wide one, would be lost: it lies aslant, and
   * only its lower end is in the picture, its bulb and the first numbers of its scale (as the wall view's).
   */
  private drawIcons(): Icons {
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const n = Math.round(WHEEL.icon.size * scale);
    const icons: Icons = {};
    for (const k of new Set(WHEELS.flat())) {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      const [base, s] = iconFrame(k, n);
      drawSpecimen(new Sketch(ctx, base, s / scale, false), k, this.specimens);
      icons[k] = c;
    }
    return icons;
  }
}

/**
 * Where a kind's picture is drawn from on an icon n pixels a side: what puts its own frame on the icon, and how many
 * pixels to a unit.
 */
function iconFrame(k: Stocked, n: number): [DOMMatrix, number] {
  const fit = n * (1 - 2 * ICON_MARGIN);
  if (k === 'thermometer' || k === 'thermometerWide') {
    const { foot, h, r } = THERMOMETER_ROD;
    const [y0, y1] = [foot - 22, h];
    const s = fit / ((y1 - y0) / Math.SQRT2 + 2 * r);
    return [new DOMMatrix().translate(n / 2, n / 2).rotate(-45).scale(s).translate(0, -(y0 + y1) / 2), s];
  }
  const b =
    k === 'flask' ? { x0: -28, x1: 28, y0: -1, y1: 70 }
    : k === 'scale' ? { x0: -92, x1: 92, y0: -2, y1: 42 }
    : SHAPES[k].box;
  const s = fit / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  return [new DOMMatrix().translate(n / 2, n / 2).scale(s).translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2), s];
}
