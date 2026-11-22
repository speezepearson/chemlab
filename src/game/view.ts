import type { Fluid } from '../chem/reactions';
import { arrival, notice } from '../intro/notice';
import type { Stock, Stocked } from './cabinet';
import type { Flask, Vessel } from './flask';
import {
  alarmAt, alarmPlate, drawAlarm, drawStands, drawCabinet, drawCounter, drawFaucets, drawFlows, drawGuides, drawHoses, drawNozzles, drawSpecimen,
  drawWall, specimens, type Span,
} from './flatRoom';
import { drawFlask, drawLampSlot, drawScale, drawTool, scaleDisplay, type ToolArt } from './flatTools';
import { OUTLINE } from './outline';
import type { Scale } from './scale';
import { messageCanvas, MSG_PAD, MSG_PX, OK_PX, okCanvas, type Board } from './screens';
import { boxThrough, FLASH, hits, Sketch, type Region } from './sketch';
import { PLANE_Z, type Vec3 } from './space';
import { inSlot } from './bodies';
import { thingOf } from './thing';
import { LAMP, SHAPES, SHEET, THERMOMETER_ROD, type Hose, type Tool } from './tools';
import { WHEEL, WHEELS } from './wheel';

/**
 * Where the view is: the middle of the stretch of the wall it shows, across and up, and how far it shows up and down
 * from there (`half`), in world units. It's always square on to the bench, with no perspective.
 */
export interface Camera {
  x: number;
  y: number;
  half: number;
}

/** What the pointer is on. */
export type Pick =
  | { kind: 'flask'; f: Flask }
  /** A tool, or a part of it: a tank, a valve, a spout, or a button (the shadow lamp's). */
  | { kind: 'tool'; t: Tool; part: 'body' | 'tank' | 'valve' | 'spout' | 'button'; k: number }
  | { kind: 'scale'; sc: Scale; part: 'body' | 'tare' }
  /** A hose's nozzle. */
  | { kind: 'hose'; h: Hose }
  /** A faucet: its spout, or the pipe down to it, if `spout`; else its knob or the pipe from the wall. */
  | { kind: 'faucet'; i: number; spout?: boolean }
  /** The button above the supply station's warning lamp that silences the alarms (see alarmAt). */
  | { kind: 'alarm' }
  /** The OK on the message inside the cryopod. */
  | { kind: 'wake' }
  /**
   * The equipment cabinet itself: its shelves, uprights, back and top; or if `front`, its open front, which is only
   * hit while something's held, to put it in.
   */
  | { kind: 'cabinet'; front?: boolean }
  /** One of the things standing in the equipment cabinet: the one in its kind's `slot`. */
  | { kind: 'stock'; item: Stocked; slot: number };

/**
 * A faucet where it is: its spout, where its pipe leaves the supply line along the back wall (see faucetPipes in
 * bodies.ts), and what it pours.
 */
export interface FaucetSpot {
  spout: Vec3;
  wall: Vec3;
  output: Fluid;
  /** The player's note, written above its knob; empty for none. */
  note: string;
}

/** Everything the view needs to draw one frame. */
export interface Frame {
  cam: Camera;
  flasks: readonly Flask[];
  tools: readonly Tool[];
  scales: readonly Scale[];
  /** Each hose, from the spout or faucet it's pulled out of, with what's running through it. */
  hoses: readonly { h: Hose; from: Vec3; fluid: Fluid | null }[];
  faucets: readonly FaucetSpot[];
  /** What's in the equipment cabinet. */
  stock: Stock;
  streams: readonly { from: Vec3; toY: number; fluid: Fluid; flow: number }[];
  /**
   * Streams for lining things up, while something's held: gray where a held flask would pour, green for what lines up
   * with what's held where it is; each with the mouth it lands in, whose rim is outlined to match, and whose vessel,
   * `v`, flashes green.
   */
  guides: readonly {
    from: Vec3;
    toY: number;
    look: GuideLook;
    mouth: Vec3 & { hx: number; hz: number; yaw: number };
    v: Vessel;
  }[];
  /**
   * Every clamp stand holding something up where it was left (see the grips in bodies.ts): where its clamp grips what
   * it holds, straight above where its base stands on the counter, and what that is, to grab it by its stand.
   */
  stands: readonly { at: Vec3; of: Pick }[];
  drops: readonly { at: Vec3; v: Vessel; hanging: boolean }[];
  /** The scale whose tare key is held down. */
  tarePress: Scale | null;
  /** What's outlined: what the pointer is on, or what's held. */
  hot: Pick | null;
  /** Whether what's outlined is held where it can't be let go of: then it's outlined in red. */
  bad: boolean;
  /** Real seconds since the last frame, for the guides' flash, which isn't part of the lab. */
  dt: number;
  /** Sim seconds the lab has run, for what blinks on sim time (the station's gauge). */
  clock: number;
  /** Each bond's energy, in BOND_KEYS order, for the spectroscope's graph. */
  energies: readonly number[];
  /** Whether the alarms are silenced, which their button shows. */
  alarmsOff: boolean;
  airlock: AirlockLook;
  /** What's in hand (a flask, tool, scale or hose), drawn over everything else in the lab. */
  held: object | null;
}

export type GuideLook = 'solid' | 'snap';

/** How the cryopod looks just now, from in it (see GameEngine.airlockLook). */
export interface AirlockLook {
  /** How far the room's light is shut out by the pod, 1 while it's shut: the bench is darkened that far. */
  dark: number;
  /** Whether the message shows on the inside of its front, with its OK button. */
  message: boolean;
  /** Whether the pointer is on the OK button. */
  okHot: boolean;
  /**
   * What the message says: the notice that wakes the player, with the litres of cryostabilizer on board, and of
   * what's to be made first, while it is (`first`, else null); or, once there's enough, the one welcoming them to Mu Ceti.
   */
  notice: { arrival: true } | { arrival: false; litres: number; first: number | null };
  /** Whether the pod has opened onto the white of Mu Ceti, at the end, with nothing of the lab to be seen. */
  arrival: boolean;
}

/** A little picture of each kind of thing the equipment wheels make, each on a canvas of its own (see View.icons). */
export type Icons = Partial<Record<Stocked, HTMLCanvasElement>>;

/**
 * What the engine asks of whatever draws the lab (see View; the bench stubs it out):
 * - icons: a little picture of each kind of thing the equipment wheels make;
 * - resize: the canvas is now w by h CSS pixels, at dpr device pixels to each;
 * - look: where the view is now (see Camera), for what follows until the next frame's;
 * - render: draw a frame;
 * - pick: what's under (ndcX, ndcY) on the view, each from −1 to 1 across and up, skipping anything belonging to
 *   `skip` (what's held), with where on it, in the room, and how far off;
 * - project: where a point in the room is on the canvas, in CSS pixels; null if it's behind the view;
 * - toHead: a point in the room relative to where the player hears from: x right, y up, z behind;
 * - dispose: let go of everything.
 */
export interface LabView {
  icons(): Readonly<Icons>;
  resize(w: number, h: number, dpr: number): void;
  look(cam: Camera): void;
  render(fr: Frame): void;
  pick(ndcX: number, ndcY: number, skip: object | null): (Pick & { point: Vec3; distance: number }) | null;
  project(p: Vec3, w: number, h: number): { x: number; y: number } | null;
  toHead(p: Vec3): Vec3;
  dispose(): void;
}

/** The outline's color round something held where it can't be let go of (see Frame.bad): a clear red. */
const BAD_OUTLINE = '#ff3b2f';
/**
 * Where the player hears from (see toHead): as far back from the bench as a camera with this field of view, top to
 * bottom, in degrees, would be to see as much of it as the view does (the same as the engine's).
 */
const FOV = 45;
/** How much of the view the pod's message may cover, at most, each way; and how wide it's drawn, at most, in CSS pixels. */
const MESSAGE_FIT = { share: 0.9, w: 820 };
/** How many pixels a side each of a sheet of shadow paper's cells is drawn over, before it's averaged down to one (see View.shadows). */
const SHADOW_OVERSAMPLE = 2;
/** How much of its picture a sheet of paper's icon fills, of what anything else's would (see iconFrame). */
const PAPER_ICON = 0.72;
/** An icon's margin, as a share of its side. */
const ICON_MARGIN = 0.04;

/**
 * Draws the lab flat, on a plain 2D canvas: the bench as it is in its own plane (see PLANE_Z), seen square on with no
 * perspective (see Camera), x across and y up, everything drawn from its flat outline as it's defined (see flatTools.ts
 * and flatRoom.ts). It works out what the pointer is on from what it drew, topmost first (see Sketch). There's no pod
 * to be seen: the pod's message is shown over the bench, darkened as the pod is.
 */
export class View implements LabView {
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { x: 0, y: 0, half: 500 };
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
  /** The canvases the shadow lamp's shadows are worked out on (see shadows). */
  private shadeCanvas: HTMLCanvasElement | null = null;
  private shadeSmall: HTMLCanvasElement | null = null;

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
    return this.h / 2 / this.cam.half;
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
    // what's part of the wall, behind the hoses and everything in the plane: the shadow lamp, with the slot behind its
    // pane and the sheet in it (whose foot is behind the counter); and after the counter, the faucets, the alarms'
    // button, the supply station's whole block, and the sheets pinned to the wall
    const held = fr.held;
    const lamp = fr.tools.find((t) => t.kind === 'shadowlamp');
    const slotted = fr.tools.find((t) => t.kind === 'sheet' && t !== held && inSlot(t.pose));
    if (lamp) {
      sk.frame(lamp.pose.x, -lamp.pose.y, () => drawLampSlot(sk, lamp));
      if (slotted) this.drawTool(sk, slotted, fr);
      this.drawTool(sk, lamp, fr);
    }
    drawCounter(sk);
    drawFaucets(sk, fr.faucets);
    const station = fr.tools.find((t) => t.shape.wall);
    drawAlarm(sk, alarmAt(station?.pose), fr.alarmsOff, alarmPlate());
    if (station) this.drawTool(sk, station, fr);
    for (const t of fr.tools) if (t.shape.pinned && t !== slotted && t !== held) this.drawTool(sk, t, fr);
    drawStands(sk, fr.stands);
    drawHoses(sk, fr.hoses);
    // then what stands free in the plane, in front of the hoses: the rest of the tools, the scales and the flasks, each
    // with what the pointer's on over the rest of its kind; the nozzles and what's falling; and last of all, over
    // everything, what's in hand
    const h = fr.hot;
    const up = h?.kind === 'tool' ? h.t : h?.kind === 'flask' ? h.f : h?.kind === 'scale' ? h.sc : null;
    const order = <T extends object>(xs: readonly T[]) => xs.filter((x) => x !== held).sort((a, b) => Number(a === up) - Number(b === up));
    for (const t of order(fr.tools)) if (!this.onWall(t)) this.drawTool(sk, t, fr);
    for (const sc of order(fr.scales)) this.drawScale(sk, sc, fr);
    for (const f of order(fr.flasks)) sk.frame(f.pose.x, -f.pose.y, () => drawFlask(sk, f));
    drawNozzles(sk, fr.hoses);
    drawFlows(sk, fr);
    for (const t of fr.tools) if (t === held) this.drawTool(sk, t, fr);
    for (const sc of fr.scales) if (sc === held) this.drawScale(sk, sc, fr);
    for (const f of fr.flasks) if (f === held) sk.frame(f.pose.x, -f.pose.y, () => drawFlask(sk, f));
    drawGuides(sk, fr.guides);
    this.exposure(fr);
    this.forget(fr);
    this.regions = sk.regions;
    this.outline(fr.hot, fr.bad);
    this.pod(fr);
  }

  /** Whether a tool is part of the wall, drawn with it, behind hoses: the station, the shadow lamp and the pinned sheets. */
  private onWall(t: Tool): boolean {
    return !!(t.shape.wall || t.shape.pinned || t.kind === 'shadowlamp');
  }

  private drawTool(sk: Sketch, t: Tool, fr: Frame): void {
    sk.frame(t.pose.x, -t.pose.y, () => drawTool(sk, t, this.artOf(t), fr.clock, fr.energies));
  }

  private drawScale(sk: Sketch, sc: Scale, fr: Frame): void {
    const h = fr.hot;
    const hot = h?.kind === 'scale' && h.sc === sc && h.part === 'tare';
    sk.frame(sc.pose.x, -sc.pose.y, () => drawScale(sk, sc, this.displayOf(sc), fr.tarePress === sc, hot));
  }

  /**
   * The shadow lamp's light, for as long as the sheet in its slot is owed it (see Tool.owed): the sheet is darkened,
   * cell by cell, by as much of it as gets past whatever's in front of the pane just now, and nothing's owed any more.
   * What's in front casts its shadow the same size as itself, since the light is a beam square on to the wall (see
   * LAMP): it's drawn again, as what casts a shadow (see Sketch.shade), square on over the pane, onto a picture with a
   * pixel to each of the sheet's cells, and softened by LAMP.soft; the clamp stands, and the wall and what's
   * built into it, cast none. A sheet that's as dark as it gets all over has nothing left to show, so what it's owed
   * is just dropped.
   */
  private exposure(fr: Frame): void {
    for (const lamp of fr.tools) {
      if (lamp.kind !== 'shadowlamp' || !(lamp.owed > 0)) continue;
      const sheet = lamp.sheet;
      if (!sheet) continue;
      if (!sheet.spent) sheet.expose(this.shadows(lamp, fr), lamp.owed);
      lamp.owed = 0;
    }
  }

  /**
   * How much of the shadow lamp's light reaches each cell of the sheet in its slot, from 0 to 1, in the order of
   * Tool.dose (rows from the bottom up, each from the left), as things stand in front of its pane now (see exposure).
   */
  private shadows(lamp: Tool, fr: Frame): Float32Array {
    const n = SHEET.cells;
    const over = SHADOW_OVERSAMPLE * n;
    const side = 2 * LAMP.pane.r;
    const [x0, top] = [lamp.pose.x - LAMP.pane.r, lamp.pose.y - LAMP.pane.y];
    const big = (this.shadeCanvas ??= document.createElement('canvas'));
    big.width = big.height = over;
    const ctx = big.getContext('2d')!;
    ctx.clearRect(0, 0, over, over);
    const k = over / side;
    const sk = new Sketch(ctx, new DOMMatrix([k, 0, 0, k, -k * x0, k * top]), k, false);
    sk.shade = true;
    for (const t of fr.tools) if (!this.onWall(t) || (t === fr.held && !t.shape.wall && t.kind !== 'shadowlamp')) this.drawTool(sk, t, fr);
    for (const sc of fr.scales) this.drawScale(sk, sc, fr);
    for (const f of fr.flasks) sk.frame(f.pose.x, -f.pose.y, () => drawFlask(sk, f));
    drawHoses(sk, fr.hoses);
    drawNozzles(sk, fr.hoses);
    drawFlows(sk, fr);
    // softened as the light's stray rays soften a shadow's edge, onto a pixel a cell
    const small = (this.shadeSmall ??= document.createElement('canvas'));
    small.width = small.height = n;
    const s = small.getContext('2d', { willReadFrequently: true })!;
    s.clearRect(0, 0, n, n);
    s.filter = `blur(${(LAMP.soft / 2) * (n / side)}px)`;
    s.drawImage(big, 0, 0, n, n);
    s.filter = 'none';
    const px = s.getImageData(0, 0, n, n).data;
    const light = new Float32Array(n * n);
    for (let i = 0; i < light.length; i++) {
      const [row, col] = [Math.floor(i / n), i % n];
      light[i] = 1 - px[4 * ((n - 1 - row) * n + col) + 3] / 255;
    }
    return light;
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
   * be left. It's the whole of a tool for any of its parts, the station a part at a time (see thingOf), and one
   * thing in the cabinet alone.
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
    const s = h / 2 / this.cam.half;
    return { x: w / 2 + (p.x - this.cam.x) * s, y: h / 2 - (p.y - this.cam.y) * s };
  }

  /**
   * A point in the room relative to where the player hears from: a head at the view's middle, as far back from the
   * bench as a camera with a field of view of FOV would be to see as much of it; x right, y up, z behind.
   */
  toHead(p: Vec3): Vec3 {
    const back = this.cam.half / Math.tan((FOV * Math.PI) / 360);
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
   * only its lower end is in the picture, its bulb and the first numbers of its scale.
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
  // (a sheet of paper, square and solid, would look bigger than the rest filling its picture: it fills less of it)
  const s = ((k !== 'flask' && k !== 'scale' && SHAPES[k].pinned ? PAPER_ICON : 1) * fit) / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  return [new DOMMatrix().translate(n / 2, n / 2).scale(s).translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2), s];
}
