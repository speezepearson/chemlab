import { NOZZLE_H } from './bodies';
import { CABINET, CABINET_BUILD, type Stock, type Stocked } from './cabinet';
import { CAP } from './config';
import { Flask, fluidAlpha, fluidColor, fluidRGB } from './flask';
import { drawFlask, drawScale, drawTool, scaleDisplay, type ToolArt } from './flatTools';
import { STATION_POSE } from './presets';
import { Scale } from './scale';
import { alarmPlateCanvas, type Board } from './screens';
import { bound, circle, INK, line, rect, type Sketch } from './sketch';
import { COUNTERS, LIFT, ROOM, WALL_PANEL, type Pose } from './space';
import { STATION, Tool } from './tools';
import type { FaucetSpot, Frame, GuideLook, Pick } from './view';

/**
 * How the view draws the room and what isn't a tool, flask or scale (see view.ts), in the wall's frame (x
 * along the wall, y down from the floor: the room's height negated): the back wall's panels, the counter along its
 * foot, the equipment cabinet and what's in it, the faucets and their supply line, the alarms' silence button, the
 * arms out of the wall, hoses, streams, drops and the guides.
 */

/** Height of the dark kick strip along the foot of the walls, the counter and the cabinet. */
const KICK = 48;
/** How thick the counter's steel top is. */
const COUNTER_TOP = 30;
/** Width of a stream flowing one flask per second; it goes as the square root of the flow. */
const STREAM_WIDTH = 4.5;
/** Drawn radius of a DROP_R_ATOMS drop; it goes as the cube root of the drop's size. */
const DROP_R = 3;
const DROP_R_ATOMS = 1.5e6;
/** How high the supply line the faucets are fed from runs, its radius, how close faucets share a manifold, and how far apart its brackets are. */
const SUPPLY = { y: 1240, r: 6, gap: 150, bracket: 600 };
/** How the guides are drawn: each look's stream and rim, their width, and their dashes. */
const GUIDE_LOOKS: Record<GuideLook, { stream: string; rim: string }> = {
  solid: { stream: 'rgba(180, 188, 184, 0.75)', rim: 'rgba(223, 230, 226, 0.95)' },
  snap: { stream: 'rgba(127, 212, 173, 0.9)', rim: 'rgba(127, 212, 173, 0.95)' },
};
const GUIDE_W = 3.2;
const GUIDE_DASH = [9, 7];
const RIM_W = 1.6;
/** An arm's plate on the back wall, and its clamp on the back of what it holds, across and up. */
const ARM = { plate: { w: 22, h: 26 }, jaw: { w: 14, h: 10 } };

/**
 * The alarms' silence button: on the back wall, 160 above the supply station's warning lamp, its plate drawn at
 * `scale` of its own size (see drawAlarm).
 */
export function alarmAt(station: Pose = STATION_POSE): { x: number; y: number; scale: number } {
  return { x: station.x + STATION.lamp.x, y: station.y - STATION.lamp.y + 160, scale: 0.7 };
}

/** The stretch of the wall in view, across and up, in the room's units. */
export interface Span {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * The back wall, as far as it's in view: its panels, two columns of three light ones in each pair, alternating in
 * shade, each with a raised field, a screw in each of its corners and a grille in the top one of every other column,
 * seams between; the floor's deck below it and the ceiling above, and the end walls beyond.
 */
export function drawWall(sk: Sketch, view: Span): void {
  const { ctx } = sk;
  const { w: PW, h: PH } = WALL_PANEL;
  ctx.fillStyle = '#1b1f20';
  ctx.fillRect(view.x0 - 10, -view.y1 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
  const c0 = Math.max(0, Math.floor((view.x0 - ROOM.x0) / PW));
  const c1 = Math.min(Math.ceil((ROOM.x1 - ROOM.x0) / PW) - 1, Math.floor((view.x1 - ROOM.x0) / PW));
  for (let c = c0; c <= c1; c++)
    for (let row = 0; row < 3; row++) {
      const x = ROOM.x0 + c * PW;
      const y = -(row + 1) * PH;
      const top = row === 2;
      ctx.fillStyle = (c + row) % 2 ? '#aab3b0' : '#b4bcb9';
      ctx.fillRect(x, y, PW, PH);
      const field = rect(x + 11, x + PW - 11, y + 16, y + PH - 16, 6);
      sk.fill(field, 'rgba(255, 255, 255, 0.05)');
      sk.stroke(field, 'rgba(60, 68, 66, 0.18)', sk.w(1.2, 1));
      ctx.fillStyle = 'rgba(70, 78, 76, 0.55)';
      for (const [sx, sy] of [[17, 25], [PW - 17, 25], [17, PH - 25], [PW - 17, PH - 25]]) ctx.fill(circle(x + sx, y + sy, 2.4));
      if (top && c % 2 === 1)
        for (let j = 0; j < 6; j++) sk.fill(rect(x + PW / 2 - 52, x + PW / 2 + 52, y + 68 + j * 11.4, y + 73 + j * 11.4, 2.5), 'rgba(40, 46, 45, 0.55)');
      ctx.strokeStyle = '#5c6462';
      ctx.lineWidth = sk.w(1.6, 1);
      ctx.strokeRect(x, y, PW, PH);
    }
  // the deck, and the ceiling's tiles' dark grid
  ctx.fillStyle = '#2f3537';
  ctx.fillRect(view.x0 - 10, 0, view.x1 - view.x0 + 20, Math.max(0, -view.y0) + 10);
  ctx.fillStyle = '#5d6563';
  ctx.fillRect(view.x0 - 10, -view.y1 - 10, view.x1 - view.x0 + 20, Math.max(0, view.y1 - ROOM.y1) + 10);
  // a dark kick strip along the wall's foot
  ctx.fillStyle = '#1e2322';
  ctx.fillRect(ROOM.x0, -KICK, ROOM.x1 - ROOM.x0, KICK);
}

/**
 * The counter along the foot of the back wall, under the bench: a steel top over a row of cabinet doors, each with a
 * pull near its top, set on a dark kick.
 */
export function drawCounter(sk: Sketch): void {
  const { ctx } = sk;
  for (const c of COUNTERS) {
    const w = c.x1 - c.x0;
    ctx.fillStyle = '#1e2322';
    ctx.fillRect(c.x0, -KICK, w, KICK);
    const nx = Math.max(1, Math.round((w - 12) / 250));
    const dw = (w - 12) / nx;
    const [y0, y1] = [-(LIFT - COUNTER_TOP), -KICK];
    for (let i = 0; i < nx; i++) {
      const x = c.x0 + 6 + i * dw;
      sk.box(x + 1.5, x + dw - 1.5, y0 + 1.5, y1, '#9fa8a4', null, 2, '#59625f');
      sk.box(x + 30, x + dw - 30, y0 + 70, y1 - 40, 'rgba(255, 255, 255, 0.04)', null, 8, 'rgba(60, 68, 66, 0.2)');
      sk.box(x + dw / 2 - 30, x + dw / 2 + 30, y0 + 28, y0 + 38, '#cfd5d3', null, 4, '#6b7472');
    }
    sk.box(c.x0, c.x1, -LIFT, -(LIFT - COUNTER_TOP), '#9aa3a4', null, 2, '#646d6d');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(c.x0, -LIFT, w, sk.w(1.5, 1));
  }
}

/** A new one of each kind the cabinet holds, to draw it from, and what's kept of each between frames. */
export interface Specimens {
  flask: Flask;
  scale: Scale;
  display: Board;
  tools: Map<Stocked, { t: Tool; art: ToolArt }>;
}

export function specimens(): Specimens {
  return { flask: new Flask(CAP), scale: new Scale(), display: scaleDisplay(), tools: new Map() };
}

/** One of a kind, new and empty, drawn in the frame in force as it would be in the lab (see drawTool, drawFlask, drawScale). */
export function drawSpecimen(sk: Sketch, k: Stocked, sp: Specimens): void {
  if (k === 'flask') return drawFlask(sk, sp.flask);
  if (k === 'scale') return drawScale(sk, sp.scale, sp.display, false, false);
  let s = sp.tools.get(k);
  if (!s) sp.tools.set(k, (s = { t: new Tool(k, -1), art: {} }));
  drawTool(sk, s.t, s.art, 0, []);
}

/**
 * The equipment cabinet (see cabinet.ts): open steel shelving on a dark plinth, with a dark back, and what stands
 * on its shelves, drawn as it would be in the lab. Its slots stand one behind another, so where several are, only
 * the front-most filled one shows. Its open front, which isn't drawn, is hit while something's held, to put it in
 * (see View.pick).
 */
export function drawCabinet(sk: Sketch, stock: Stock, sp: Specimens): void {
  const C = CABINET;
  const B = CABINET_BUILD;
  const cab: Pick = { kind: 'cabinet' };
  const metal = '#b4bdb9';
  const edge = '#6f7976';
  sk.box(C.x0, C.x1, -48, 0, '#1e2322', cab);
  sk.box(C.x0, C.x1, -B.base, -48, metal, cab, 0, edge);
  sk.box(C.x0, C.x1, -C.y1, -B.base, '#4d5653', cab);
  for (const s of C.shelves) if (s.y > B.base) sk.box(s.x0, s.x1, -s.y, -(s.y - B.board), metal, cab, 0, edge);
  // what's in it: in each place, the front-most one there that's filled
  for (const k of Object.keys(C.slots) as Stocked[]) {
    const front = new Map<string, number>();
    C.slots[k].forEach((p, i) => {
      if (!stock[k][i]) return;
      const at = `${Math.round(p.x)},${Math.round(p.y)}`;
      const was = front.get(at);
      if (was === undefined || C.slots[k][was].z < p.z) front.set(at, i);
    });
    for (const i of front.values()) {
      const p = C.slots[k][i];
      sk.as = { kind: 'stock', item: k, slot: i };
      sk.frame(p.x, -p.y, () => drawSpecimen(sk, k, sp));
      sk.as = null;
    }
  }
  const ends = [C.x0, ...C.bays.map((b) => b.x1)];
  for (const x of ends) sk.box(x, x + B.side, -(C.y1 - B.top / 2), -B.base, metal, cab, 0, edge);
  sk.box(C.x0, C.x1, -C.y1, -(C.y1 - B.top / 2), metal, cab, 0, edge);
  sk.hit(rect(C.x0, C.x1, -C.y1, -B.base), { kind: 'cabinet', front: true });
}

/**
 * The faucets on the back wall and what feeds them: the supply line along the wall
 * high up, from the right end wall, with a riser down to each faucet, or to a short manifold along the wall that a row
 * of them come out of, held by brackets; and each faucet, seen from in front: a glossy knob in its fluid's color (the
 * solvent's clear) where its pipe comes out from the wall, its neck down to its spout's chrome tip, and its note.
 */
export function drawFaucets(sk: Sketch, faucets: readonly FaucetSpot[]): void {
  if (!faucets.length) return;
  const chrome = (pts: number[][], r: number, pick?: Pick) => {
    const p = line(pts);
    sk.stroke(p, INK.chromeEdge, 2 * r, pick);
    sk.stroke(p, INK.chrome, Math.max(r, 2 * r - sk.px(1.6)));
    sk.ctx.globalAlpha = 0.8;
    sk.stroke(p, '#ffffff', r * 0.4);
    sk.ctx.globalAlpha = 1;
  };
  const ball = (x: number, y: number) => {
    sk.fill(circle(x, y, SUPPLY.r), INK.chrome);
    sk.stroke(circle(x, y, SUPPLY.r), INK.chromeEdge, sk.px(1));
  };
  const bracket = (x: number, y: number, along: boolean) =>
    along ? sk.box(x - 3, x + 3, y - SUPPLY.r - 1.2, y + SUPPLY.r + 1.2, INK.dark, null, 1) : sk.box(x - SUPPLY.r - 1.2, x + SUPPLY.r + 1.2, y - 3, y + 3, INK.dark, null, 1);
  // the rows of faucets along the wall, each fed by one riser
  const order = faucets.map((fa) => fa.wall).sort((a, b) => a.x - b.x);
  const rows: { x: number; y: number }[][] = [];
  for (const w of order) {
    const row = rows[rows.length - 1];
    if (row && w.x - row[row.length - 1].x <= SUPPLY.gap) row.push(w);
    else rows.push([w]);
  }
  const top = -SUPPLY.y;
  const risers = rows.map((row) => {
    const [first, last] = [row[0], row[row.length - 1]];
    if (row.length === 1) return { x: first.x, y: -first.y, cap: true };
    const [a, b] = [first.x - 60, last.x + 60];
    chrome([[a, -first.y], [b, -first.y]], SUPPLY.r);
    ball(a, -first.y);
    ball(b, -first.y);
    bracket(a + 18, -first.y, true);
    return { x: b, y: -first.y, cap: false };
  });
  chrome([[risers[0].x, top], [ROOM.x1, top]], SUPPLY.r);
  ball(risers[0].x, top);
  sk.box(ROOM.x1 - 6, ROOM.x1, top - SUPPLY.r - 6, top + SUPPLY.r + 6, INK.dark);
  for (const r of risers) {
    chrome([[r.x, r.y], [r.x, top]], SUPPLY.r);
    ball(r.x, top);
    if (r.cap) ball(r.x, r.y);
    bracket(r.x, (r.y + top) / 2, false);
  }
  const stops = [...risers.map((r) => r.x), ROOM.x1];
  for (let i = 0; i + 1 < stops.length; i++) {
    const n = Math.max(1, Math.round((stops[i + 1] - stops[i]) / SUPPLY.bracket));
    for (let k = 0; k < n; k++) bracket(stops[i] + ((k + 0.5) * (stops[i + 1] - stops[i])) / n, top, true);
  }
  faucets.forEach((fa, i) => {
    const { spout, wall } = fa;
    const elbow = { x: spout.x, y: -wall.y };
    chrome([[elbow.x, elbow.y], [spout.x, -(spout.y + 6)]], 3, { kind: 'faucet', i, spout: true });
    const tip = bound(new Path2D(), spout.x - 5, -(spout.y + 7), spout.x + 5, -spout.y);
    tip.moveTo(spout.x - 5, -(spout.y + 7));
    tip.lineTo(spout.x + 5, -(spout.y + 7));
    tip.lineTo(spout.x + 4, -spout.y);
    tip.lineTo(spout.x - 4, -spout.y);
    tip.closePath();
    sk.fill(tip, INK.chrome, { kind: 'faucet', i, spout: true });
    sk.stroke(tip, INK.chromeEdge, sk.px(1));
    // the knob, as clear as its fluid at most, never so clear it's hard to see
    const rgb = fluidRGB(fa.output);
    const knob = circle(elbow.x, elbow.y, 10);
    sk.fill(knob, 'rgba(236, 242, 243, 0.35)', { kind: 'faucet', i });
    if (rgb) sk.fill(knob, `rgba(${rgb.map(Math.round).join(', ')}, ${Math.max(0.6, fluidAlpha(fa.output))})`);
    const shine = sk.ctx.createRadialGradient(elbow.x - 3.5, elbow.y - 3.5, 0.5, elbow.x - 3.5, elbow.y - 3.5, 7);
    shine.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
    sk.fill(knob, shine);
    sk.stroke(knob, 'rgba(30, 36, 38, 0.55)', sk.px(1));
    sk.text(fa.note, elbow.x, elbow.y - 16 - 5);
  });
}

/**
 * The alarms' silence button (see alarmAt): a plate with hazard stripes round it and what it's for, and a big red
 * button that stays pushed in while the alarms are silenced, under a lamp that glows amber while they are.
 */
export function drawAlarm(sk: Sketch, at: { x: number; y: number; scale: number }, off: boolean, plate: HTMLCanvasElement): void {
  const pick: Pick = { kind: 'alarm' };
  sk.frame(at.x, -at.y, () => {
    sk.ctx.scale(at.scale, at.scale);
    sk.box(-57, 57, -77, 77, INK.dark, pick, 3);
    sk.image(plate, -55, 55, -75, 75, pick);
    sk.fill(circle(0, 0, 29), INK.dark, pick);
    sk.fill(circle(0, 0, off ? 19 : 22), off ? '#861a14' : '#b3221a', pick);
    if (!off) sk.fill(circle(-6, -6, 8), 'rgba(255, 255, 255, 0.18)');
    if (off) {
      const g = sk.ctx.createRadialGradient(0, -34, 0, 0, -34, 26);
      g.addColorStop(0, 'rgba(255, 162, 26, 0.7)');
      g.addColorStop(1, 'rgba(255, 162, 26, 0)');
      sk.fill(circle(0, -34, 26), g);
    }
    sk.fill(circle(0, -34, 6), off ? '#ffc35c' : '#6b5520', pick);
  });
}

/** The alarms' silence button's plate's face, made once. */
let alarmFace: HTMLCanvasElement | null = null;
export const alarmPlate = () => (alarmFace ??= alarmPlateCanvas());

/**
 * A faint mark for each arm out of the back wall (see Frame.arms), seen end on: its plate on the wall behind, and its
 * clamp on the back of what it holds, both mostly hidden behind that, and hit as it.
 */
export function drawArms(sk: Sketch, arms: Frame['arms']): void {
  const { plate: p, jaw: j } = ARM;
  for (const { at, of } of arms) {
    sk.box(at.x - p.w / 2, at.x + p.w / 2, -at.y - p.h / 2, -at.y + p.h / 2, 'rgba(48, 55, 58, 0.22)', of, 2, 'rgba(27, 32, 34, 0.3)');
    sk.box(at.x - j.w / 2, at.x + j.w / 2, -at.y - j.h / 2, -at.y + j.h / 2, 'rgba(48, 55, 58, 0.4)', of, 1);
  }
}

/**
 * Each hose: a translucent tube drooping from its spout or faucet down to its nozzle, showing what's running through
 * it. Drawn behind everything in the plane, as if bowed back toward the wall; their nozzles are drawn
 * apart (see drawNozzles).
 */
export function drawHoses(sk: Sketch, hoses: Frame['hoses']): void {
  for (const { h, from, fluid } of hoses) {
    const [ax, ay] = [from.x, -(from.y + 2)];
    const [bx, by] = [h.outlet.x, -(h.outlet.y + NOZZLE_H)];
    const p = new Path2D();
    p.moveTo(ax, ay);
    p.bezierCurveTo(ax, ay + 70, bx, by - 70, bx, by);
    sk.stroke(p, 'rgba(70, 82, 78, 0.55)', 7.6);
    sk.stroke(p, 'rgba(160, 172, 167, 0.55)', 6.2);
    if (fluid && fluid.N > 0 && fluidRGB(fluid)) sk.stroke(p, fluidColor(fluid), 4);
  }
}

/** Each hose's nozzle, at its tip: a little steel cone, hit as the hose. */
export function drawNozzles(sk: Sketch, hoses: Frame['hoses']): void {
  for (const { h } of hoses) {
    const { x, y } = h.outlet;
    const p = bound(new Path2D(), x - 4, -(y + NOZZLE_H), x + 4, -y);
    p.moveTo(x - 4, -(y + NOZZLE_H));
    p.lineTo(x + 4, -(y + NOZZLE_H));
    p.lineTo(x + 3, -y);
    p.lineTo(x - 3, -y);
    p.closePath();
    sk.fill(p, INK.pipe, { kind: 'hose', h });
    sk.stroke(p, INK.pipeEdge, sk.px(1));
  }
}

/** The streams, falling from where they leave straight down to where they land, as wide as their flow, and the drops. */
export function drawFlows(sk: Sketch, fr: Frame): void {
  for (const s of fr.streams) {
    if (!fluidRGB(s.fluid)) continue;
    const w = STREAM_WIDTH * Math.sqrt(s.flow);
    sk.ctx.fillStyle = fluidColor(s.fluid);
    sk.ctx.fillRect(s.from.x - w / 2, -s.from.y, w, Math.max(0.1, s.from.y - s.toY));
  }
  for (const d of fr.drops) {
    if (d.v.N <= 0 || !fluidRGB(d.v)) continue;
    const r = DROP_R * Math.cbrt(d.v.N / DROP_R_ATOMS);
    sk.fill(circle(d.at.x, -(d.hanging ? d.at.y - r : d.at.y), r), fluidColor(d.v));
  }
}

/**
 * The guides, while something's held (see Frame.guides): dashed streams, gray where a held flask would pour, green for
 * what lines up, the dashes counted from the top; and each mouth they end at marked across its rim once, in the look of
 * the strongest guide into it.
 */
export function drawGuides(sk: Sketch, guides: Frame['guides']): void {
  const { ctx } = sk;
  ctx.save();
  ctx.setLineDash(GUIDE_DASH);
  ctx.lineCap = 'butt';
  for (const g of guides) {
    ctx.strokeStyle = GUIDE_LOOKS[g.look].stream;
    ctx.lineWidth = sk.w(GUIDE_W, 2);
    ctx.beginPath();
    ctx.moveTo(g.from.x, -g.from.y);
    ctx.lineTo(g.from.x, -g.toY);
    ctx.stroke();
  }
  ctx.restore();
  const mouths = new Map<string, Frame['guides'][number]['mouth'] & { look: GuideLook }>();
  for (const g of guides) {
    const m = g.mouth;
    const key = `${m.x},${m.y},${m.z}`;
    const was = mouths.get(key);
    mouths.set(key, { ...m, look: was?.look === 'snap' ? 'snap' : g.look });
  }
  for (const m of mouths.values()) {
    const h = sk.w(RIM_W, 2);
    sk.box(m.x - m.hx - RIM_W, m.x + m.hx + RIM_W, -m.y - 0.6 - h / 2, -m.y - 0.6 + h / 2, GUIDE_LOOKS[m.look].rim, null, h / 2);
  }
}
