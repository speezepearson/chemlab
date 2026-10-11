import * as THREE from 'three';
import { temperature, type Fluid } from '../chem/reactions';
import { LOOK, coronaAlpha, coronaRadius, glowFalloff, haloAlpha, haloRadius } from './appearance';
import { FUNNEL_H, FUNNEL_R, NOZZLE_H, TOOL_DEPTH, lx, onTool, openingOf, tankRect, valveLocal, valveZ } from './bodies';
import { CAP, FLASK_L, GOAL_L, TRACE } from './config';
import { Vessel, fluidAlpha, fluidRGB, glowColor, volume, type Flask } from './flask';
import { FLASK_H, FLASK_OUTLINE, fillLevel } from './flaskShape';
import { SCALE_SHAPE, type Scale } from './scale';
import { COUNTERS, LIFT, PAPER_Z, ROOM, groundAt, toWorld, type Vec3 } from './space';
import { PAPER_HANDLE, PAPER_HEADER, PAPER_TEXT, type Paper } from './paper';
import {
  HEATER, HEATER_BOX, HEATER_CELLS, HEATER_TUBE, HELIX, METER_BODY, METER_DIGITS, RECEPTACLE_BODY, RECEPTACLE_LAMPS,
  SCAN_LIGHTS, SORTER_CHUTE, SPECTROMETER, SUMP_TIP, TANK_H, chuteY, cupFillHeight, meterText, sumpFillHeight, tankX,
  type Hose, type Tool,
} from './tools';

/** What the crosshair is on. */
export type Pick =
  | { kind: 'flask'; f: Flask }
  | { kind: 'tool'; t: Tool; part: 'body' | 'tank' | 'valve' | 'button'; k: number }
  | { kind: 'scale'; sc: Scale; part: 'body' | 'tare' }
  | { kind: 'hose'; h: Hose; end: 'inlet' | 'outlet' }
  | { kind: 'faucet'; i: number };

/** A faucet where it is: its spout, where its pipe meets the wall, and what it pours. */
export interface FaucetSpot {
  spout: Vec3;
  wall: Vec3;
  output: Fluid;
  /** The player's note, written above its knob; empty for none. */
  note: string;
}

/** Everything the view needs to draw one frame. */
export interface Frame {
  eye: Vec3;
  yaw: number;
  pitch: number;
  flasks: readonly Flask[];
  tools: readonly Tool[];
  scales: readonly Scale[];
  hoses: readonly Hose[];
  faucets: readonly FaucetSpot[];
  /** What the player is holding, which no arm holds; and flasks standing on scales, which no arm holds either. */
  held: object | null;
  standing: ReadonlySet<Flask>;
  streams: readonly { from: Vec3; toY: number; fluid: Fluid; flow: number }[];
  /**
   * Gray streams for lining things up: solid where fluid would land in a mouth, faint where it would just miss one;
   * each with that mouth, whose rim is outlined to match.
   */
  guides: readonly { from: Vec3; toY: number; solid: boolean; mouth: Vec3 & { hx: number; hz: number; yaw: number } }[];
  drops: readonly { at: Vec3; v: Vessel; hanging: boolean }[];
  /** The scale whose tare key is held down. */
  tarePress: Scale | null;
  /** The key or button under the crosshair, to light it. */
  hot: Pick | null;
  /** How far each running spectrometer shakes, in world units. */
  shake: ReadonlyMap<Tool, number>;
  /** Real seconds since the last frame, for the arms. */
  dt: number;
  /** The target the receptacle has taken so far, by volume, for its screen. */
  delivered: number;
  /**
   * The sticky notes on the back wall: each sheet with its top left corner, on the old flat bench (x across, y down);
   * whether the pencil's in hand (so each shows its handles); and a sheet being marked out, if one is.
   */
  papers: {
    sheets: readonly { paper: Paper; at: { x: number; y: number } }[];
    pencil: boolean;
    draft: { x0: number; y0: number; x1: number; y1: number } | null;
  };
}

/** Width of a stream flowing one flask per second; it goes as the square root of the flow. */
const STREAM_WIDTH = 4.5;
/** Radius of a guide stream (see Frame.guides), about a slow stream's; and how wide the outline round its mouth is. */
const GUIDE_R = 1.6;
const RIM_W = 1.6;
/** Drawn radius of a DROP_R_ATOMS drop; it goes as the cube root of the drop's size. */
const DROP_R = 3;
const DROP_R_ATOMS = 1.5e6;
/** A CRT's phosphor green. */
const PHOSPHOR = '64, 255, 110';
/** How long an arm takes to reach down to what it holds, or back up, in real seconds. */
const ARM_S = 0.28;
/** The separator's splitter, below its valve, in local units (y down). */
const SEP_BODY = { x0: -150, x1: 150, y0: 100, y1: 112 };
/** Height of each line of a label, in world units. */
const LABEL_H = 10;
/** How far above a flask's mouth, a hose's funnel, or a scale's platform its note sits, to the note's middle. */
const NOTE_Y = 13;

/* ---------------- materials ---------------- */

const glassMat = new THREE.MeshStandardMaterial({
  color: 0xd6ecf2, transparent: true, opacity: 0.16, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
});
const edgeMat = new THREE.LineBasicMaterial({ color: 0xbfd4da, transparent: true, opacity: 0.5 });
const pipeMat = new THREE.MeshStandardMaterial({ color: 0x7c8883, metalness: 0.55, roughness: 0.4 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x343b39, metalness: 0.4, roughness: 0.55 });
const panelMat = new THREE.MeshStandardMaterial({ color: 0xb9c1bc, metalness: 0.15, roughness: 0.6 });
const leverMat = new THREE.MeshStandardMaterial({ color: 0x1d2321, metalness: 0.3, roughness: 0.5 });
const keyMats = {
  up: new THREE.MeshStandardMaterial({ color: 0xd8443b, roughness: 0.45 }),
  hot: new THREE.MeshStandardMaterial({ color: 0xf06358, roughness: 0.45, emissive: 0x401010 }),
  down: new THREE.MeshStandardMaterial({ color: 0x9c2d28, roughness: 0.6 }),
};
const hidden = new THREE.MeshBasicMaterial({ visible: false });
const faintMat = new THREE.MeshBasicMaterial({ color: 0xd6ecf2, transparent: true, opacity: 0.3, depthWrite: false });
const armMat = new THREE.MeshStandardMaterial({ color: 0xd2a63a, metalness: 0.5, roughness: 0.35 });

/** Points in a flat frame (x right, y down), placed at depth z, as a vector in an object's own frame (y up). */
const v3 = (x: number, y: number, z = 0) => new THREE.Vector3(x, -y, z);

/** The fluid in a vessel: drawn from a solid the shape of its inside, cut off at the fluid's level. */
class FluidMesh {
  readonly mat: THREE.MeshLambertMaterial;
  readonly plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  readonly meshes: THREE.Mesh[] = [];
  private key = '';

  constructor(geoms: THREE.BufferGeometry[], parent: THREE.Object3D) {
    this.mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, clippingPlanes: [this.plane] });
    for (const g of geoms) {
      const m = new THREE.Mesh(g, this.mat);
      m.castShadow = true;
      parent.add(m);
      this.meshes.push(m);
    }
  }

  /** Show `f` up to height `level` in the room. */
  update(f: Fluid, level: number): void {
    const rgb = f.N > TRACE ? fluidRGB(f) : null;
    for (const m of this.meshes) m.visible = !!rgb;
    if (!rgb) return;
    this.plane.constant = level;
    const a = fluidAlpha(f);
    const key = `${rgb.map(Math.round)}:${a.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    // mostly its own color, lit a little so its shape reads
    const c = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
    this.mat.color.copy(c).multiplyScalar(0.45);
    this.mat.emissive.copy(c).multiplyScalar(0.6);
    this.mat.opacity = a;
    if (this.mat.transparent !== a < 1) {
      // the shader only needs rebuilding when it turns see-through, or back
      this.mat.transparent = a < 1;
      this.mat.depthWrite = a >= 1;
      this.mat.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mat.dispose();
  }
}

/* ---------------- geometry helpers ---------------- */

/** A glass box with no top, edges drawn, x0..x1 by y0..y1 (flat frame, y down), `d` deep. */
function openBox(parent: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, d: number): THREE.Mesh {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, d);
  // faces go +x, −x, +y, −y, +z, −z: no top
  const m = new THREE.Mesh(g, [glassMat, glassMat, hidden, glassMat, glassMat, glassMat]);
  m.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2));
  parent.add(m);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
  e.position.copy(m.position);
  parent.add(e);
  return m;
}

/**
 * A square-sectioned frustum from a top `wTop` wide (by `dTop` deep) at y0 down to `wBot` wide (by `dBot`) at y1,
 * centered on x; open ends if `open`.
 */
function frustum(x: number, y0: number, y1: number, wTop: number, dTop: number, wBot: number, dBot: number, open: boolean): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, y1 - y0, 4, 1, open);
  g.rotateY(Math.PI / 4);
  // stretch the top and bottom rings to their own widths and depths
  const pos = g.attributes.position;
  const h = (y1 - y0) / 2;
  for (let i = 0; i < pos.count; i++) {
    const top = pos.getY(i) > 0;
    pos.setX(i, pos.getX(i) * (top ? wTop : wBot));
    pos.setZ(i, pos.getZ(i) * (top ? dTop : dBot));
    pos.setY(i, top ? h : -h);
  }
  g.computeVertexNormals();
  g.translate(x, -(y0 + y1) / 2, 0);
  return g;
}

function glassFrom(parent: THREE.Object3D, g: THREE.BufferGeometry): void {
  parent.add(new THREE.Mesh(g, glassMat));
  parent.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), edgeMat));
}

/** A box of material `mat` over x0..x1, y0..y1 (flat frame, y down), z0..z1. */
function block(parent: THREE.Object3D, mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, -(y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Let go of the geometry built for one thing (shared geometry is uploaded again if it's used after). */
function disposeGeometry(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) c.geometry.dispose();
  });
}

const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
const unitSphere = new THREE.SphereGeometry(1, 12, 8);
const unitBox = new THREE.BoxGeometry(1, 1, 1);
/** A flat ring of radius 1, lying level, RIM_W thick at radius 14 (about a flask's mouth). */
const unitRing = new THREE.TorusGeometry(1, 0.06, 6, 40).rotateX(Math.PI / 2);

/** A rod of radius r from a to b (in the parent's frame). */
function rod(parent: THREE.Object3D, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.Mesh {
  const m = new THREE.Mesh(unitCylinder, mat);
  const d = b.clone().sub(a);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.scale.set(r, d.length(), r);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Pipes through points in a flat frame (y down), at depth z. */
function pipes(parent: THREE.Object3D, pts: number[][], r = 2, z = 0): void {
  for (let i = 1; i < pts.length; i++) rod(parent, pipeMat, v3(pts[i - 1][0], pts[i - 1][1], z), v3(pts[i][0], pts[i][1], z), r);
  for (let i = 1; i < pts.length - 1; i++) {
    const j = new THREE.Mesh(unitSphere, pipeMat);
    j.position.copy(v3(pts[i][0], pts[i][1], z));
    j.scale.setScalar(r);
    parent.add(j);
  }
}

/* ---------------- text and screens ---------------- */

const textCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();

/** A label that always faces the player, `lines` of text centered on its anchor. */
function textSprite(lines: string[], color = '#c6d0cb'): THREE.Sprite {
  const key = `${color}|${lines.join('\n')}`;
  let t = textCache.get(key);
  if (!t) {
    const px = 48;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    ctx.font = `500 ${px}px "Schibsted Grotesk", sans-serif`;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    c.width = Math.ceil(w);
    c.height = Math.ceil(px * 1.25 * lines.length);
    ctx.font = `500 ${px}px "Schibsted Grotesk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    lines.forEach((l, i) => ctx.fillText(l, c.width / 2, px * 1.25 * (i + 0.5)));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    t = { tex, aspect: c.width / c.height };
    textCache.set(key, t);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthWrite: false }));
  s.scale.set(LABEL_H * lines.length * t.aspect, LABEL_H * lines.length, 1);
  return s;
}

/** A label sprite kept in step with some text: replaced only when the text changes. */
class Label {
  private text = '';
  private sprite: THREE.Sprite | null = null;
  constructor(
    private parent: THREE.Object3D,
    private at: THREE.Vector3,
  ) {}

  /** Move it, in its parent's frame. */
  place(at: THREE.Vector3): void {
    this.at.copy(at);
    this.sprite?.position.copy(at);
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    if (this.sprite) {
      this.parent.remove(this.sprite);
      this.sprite.material.dispose();
      this.sprite = null;
    }
    if (!text) return;
    this.sprite = textSprite([text]);
    this.sprite.position.copy(this.at);
    this.parent.add(this.sprite);
  }
}

/** A flat screen on something's front face, drawn on a canvas `ppu` pixels per world unit. */
class Screen {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  key = '';

  constructor(parent: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, z: number, readonly ppu: number) {
    this.canvas.width = Math.round((x1 - x0) * ppu);
    this.canvas.height = Math.round((y1 - y0) * ppu);
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    m.position.set((x0 + x1) / 2, -(y0 + y1) / 2, z);
    parent.add(m);
  }
}

/**
 * A mass spectrometer's screen: a hexagon per molecule size (1, 2, 3 atoms), each cut into sextants by color (see
 * SEXTANT_ATOMS) that glow as bright as their share of the last sample, lighting up one hexagon at a time as a
 * run goes on. No words, no lines between the sextants: reading it is part of the game.
 */
function drawSpectrum(sc: Screen, t: Tool): void {
  const lit = SCAN_LIGHTS.filter((at) => t.scanAge >= at).length;
  const key = `${lit}|${t.reading?.map((x) => x.toFixed(3)).join(',') ?? ''}`;
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const { screen: s, hexes } = SPECTROMETER;
  const green = (a: number) => `rgba(${PHOSPHOR}, ${a})`;
  ctx.setTransform(ppu, 0, 0, ppu, -s.x0 * ppu, -s.y0 * ppu);
  ctx.fillStyle = '#040a06';
  ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  hexes.xs.forEach((cx, w) => {
    const { y: cy, r } = hexes;
    // flat-topped, so sextant j runs clockwise from the corner at −120° + 60j°
    const corner = (j: number) => {
      const a = ((-120 + 60 * j) * Math.PI) / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
    };
    if (t.reading && t.scanAge >= SCAN_LIGHTS[w])
      for (let j = 0; j < 6; j++) {
        const b = Math.min(1, t.reading[w * 6 + j]);
        if (b <= 0) continue;
        ctx.fillStyle = ctx.shadowColor = green(b);
        ctx.shadowBlur = 5 * ppu;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(...corner(j));
        ctx.lineTo(...corner(j + 1));
        ctx.closePath();
        ctx.fill();
      }
    ctx.shadowColor = green(0.85);
    ctx.shadowBlur = 2 * ppu;
    ctx.strokeStyle = green(0.85);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let j = 0; j < 6; j++) ctx.lineTo(...corner(j));
    ctx.closePath();
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  for (let y = s.y0; y < s.y1; y += 1.5) ctx.fillRect(s.x0, y, s.x1 - s.x0, 0.6);
  sc.tex.needsUpdate = true;
}

/**
 * Text on a seven-segment display, right-aligned in `cells` digit cells ending at x, with its digits' tops at y:
 * lit segments glow, and unlit ones show faintly, as on a real display. Shows digits, '-', and the letters of "OUEr";
 * a '.' lights the decimal point after the digit before it.
 */
function drawSevenSeg(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, cells: number, color: string, ghost: string, ppu: number): void {
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

/* ---------------- glow ---------------- */

const glowTextures = new Map<number, THREE.Texture>();

/** A white disc fading out as glowFalloff does at this sharpness, to tint and add on top of everything. */
function glowTexture(sharpness: number): THREE.Texture {
  let t = glowTextures.get(sharpness);
  if (!t) {
    const N = 128;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
        const i = 4 * (y * N + x);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * glowFalloff(r, sharpness));
      }
    ctx.putImageData(img, 0, 0);
    t = new THREE.CanvasTexture(c);
    glowTextures.set(sharpness, t);
  }
  return t;
}

/** The light a hot vessel gives off: a wide halo and a tight corona, washing out whatever's around it. */
class Glow {
  private halo = new THREE.Sprite(new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
  private corona = new THREE.Sprite(new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));

  constructor(parent: THREE.Object3D) {
    this.halo.renderOrder = this.corona.renderOrder = 10;
    parent.add(this.halo, this.corona);
  }

  update(f: Fluid, cap: number, at: THREE.Vector3): void {
    const color = glowColor(f);
    const T = temperature(f);
    // a trace of hot fluid shouldn't blaze like a full flask
    const amount = Math.sqrt(Math.min(1, (4 * volume(f)) / cap));
    const set = (s: THREE.Sprite, R: number, alpha: number, sharpness: number) => {
      s.visible = !!color && alpha * amount >= 0.002;
      if (!s.visible) return;
      s.position.copy(at);
      s.scale.set(2 * R, 2 * R, 1);
      s.material.map = glowTexture(sharpness);
      s.material.color.setRGB(color![0] / 255, color![1] / 255, color![2] / 255, THREE.SRGBColorSpace);
      s.material.opacity = Math.min(1, alpha * amount);
    };
    set(this.halo, haloRadius(T), haloAlpha(T), LOOK.haloSharpness);
    set(this.corona, coronaRadius(T), coronaAlpha(T), LOOK.coronaSharpness);
  }

  dispose(): void {
    this.halo.removeFromParent();
    this.corona.removeFromParent();
    this.halo.material.dispose();
    this.corona.material.dispose();
  }
}

/* ---------------- flasks ---------------- */

/** The flask's glass and inside, turned about its axis, mouth at the origin. */
const FLASK_PROFILE = FLASK_OUTLINE.filter((p) => p.x >= 0 && !(p.x === 11 && p.y === 0) && p.y > 0)
  .map((p) => new THREE.Vector2(p.x, -p.y))
  .sort((a, b) => a.y - b.y);
const flaskGlassGeom = new THREE.LatheGeometry([new THREE.Vector2(0, -FLASK_H), ...FLASK_PROFILE, new THREE.Vector2(11, 0), new THREE.Vector2(12.5, 0.5)], 28);
const flaskFluidGeom = new THREE.LatheGeometry(
  [new THREE.Vector2(0, -FLASK_H + 0.6), ...FLASK_PROFILE.map((p) => new THREE.Vector2(p.x * 0.95, Math.max(p.y, -FLASK_H + 0.6))), new THREE.Vector2(10.4, -0.4), new THREE.Vector2(0, -0.4)],
  28,
);

class FlaskView {
  readonly root = new THREE.Group();
  private tilt = new THREE.Group();
  private fluid: FluidMesh;
  private label: Label;
  readonly glow: Glow;

  constructor(
    readonly f: Flask,
    scene: THREE.Object3D,
    pickables: Map<THREE.Object3D, Pick>,
  ) {
    const glass = new THREE.Mesh(flaskGlassGeom, glassMat);
    this.tilt.add(glass, new THREE.LineSegments(new THREE.EdgesGeometry(flaskGlassGeom, 25), edgeMat));
    this.fluid = new FluidMesh([flaskFluidGeom], this.tilt);
    this.root.add(this.tilt);
    this.label = new Label(this.root, new THREE.Vector3(0, NOTE_Y, 0));
    this.glow = new Glow(scene);
    scene.add(this.root);
    pickables.set(glass, { kind: 'flask', f });
  }

  update(): void {
    const { f } = this;
    this.root.position.set(f.pose.x, f.pose.y, f.pose.z);
    this.root.rotation.y = f.pose.yaw;
    this.tilt.rotation.z = -f.tilt;
    this.fluid.update(f, f.pose.y + fillLevel(f.tilt, volume(f) / f.cap));
    this.label.set(f.label);
    // centered on its bulb, following any tilt
    const bulb = toWorld(f.pose, { x: -50 * Math.sin(f.tilt), y: -50 * Math.cos(f.tilt), z: 0 });
    this.glow.update(f, f.cap, new THREE.Vector3(bulb.x, bulb.y, bulb.z));
  }

  dispose(): void {
    this.root.removeFromParent();
    this.fluid.dispose();
    this.glow.dispose();
  }
}

/* ---------------- tools ---------------- */

/** The heater's wire as its dial turns up, at even steps from 0 to 1: copper, then glowing red, orange, yellow, white. */
const WIRE_RAMP: readonly (readonly number[])[] = [[184, 115, 51], [196, 62, 38], [255, 96, 30], [255, 192, 84], [255, 250, 236]];

/** The heater's wire's color at dial setting d (see WIRE_RAMP), 0–255 per channel. */
function wireColor(d: number): number[] {
  const x = Math.max(0, Math.min(1, d)) * (WIRE_RAMP.length - 1);
  const i = Math.min(WIRE_RAMP.length - 2, Math.floor(x));
  return WIRE_RAMP[i].map((c, k) => c + (WIRE_RAMP[i + 1][k] - c) * (x - i));
}

const setRGB = (c: THREE.Color, rgb: readonly number[]) => c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);

/** The colors the receptacle's lamps blink in while it thinks. */
const LAMP_COLORS = [0xffb43a, 0x54d0ff, 0xff5a4f, 0x7dff6a, 0xb48cff, 0xfff4c2];

/**
 * A tool, built from its flat outline with depth. Its `art` is mirrored if it's flipped; its valves and its writing
 * are kept in `upright`, which never is, so levers still close to the right and labels still read (see Tool.flipped).
 * Every mesh of it can be hit, glass included, but not the empty space around it.
 */
class ToolView {
  readonly root = new THREE.Group();
  /** Whether the tool was flipped when this was built: it's rebuilt when that changes. */
  readonly flipped: boolean;
  /** Everything but the root's placement, which shakes while a spectrometer runs. */
  private body = new THREE.Group();
  private art = new THREE.Group();
  private upright = new THREE.Group();
  private fluids: { fm: FluidMesh; level: (v: Vessel) => number }[] = [];
  private levers = new Map<number, THREE.Group>();
  private dial?: THREE.Group;
  private lids: THREE.Mesh[] = [];
  private labels: Label[] = [];
  private note: Label;
  private glows: Glow[] = [];
  private button?: THREE.Mesh;
  private lamp?: THREE.Mesh;
  private screen?: Screen;
  private helix?: { geom: THREE.TubeGeometry; colors: THREE.BufferAttribute; k: number }[];
  private films: THREE.Mesh[] = [];
  private filmMats: THREE.MeshBasicMaterial[] = [];
  private cells: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private wire?: THREE.MeshStandardMaterial;
  private lamps: THREE.MeshStandardMaterial[] = [];
  private verdict?: THREE.MeshStandardMaterial;
  private hose?: { outer: THREE.Mesh; core: THREE.Mesh; mat: THREE.MeshBasicMaterial };

  constructor(
    readonly t: Tool,
    scene: THREE.Object3D,
    pickables: Map<THREE.Object3D, Pick>,
  ) {
    const sh = t.shape;
    const { art, upright } = this;
    const D = TOOL_DEPTH[t.kind];
    const pick = (m: THREE.Object3D, part: 'body' | 'tank' | 'valve' | 'button', k = 0) => pickables.set(m, { kind: 'tool', t, part, k });
    /** Where something at local x stands, for what's kept upright. */
    const ux = (x: number) => lx(t, x);
    this.flipped = t.flipped;
    art.scale.x = t.flipped ? -1 : 1;
    this.body.add(art, upright);
    this.root.add(this.body);

    // drain pipes and spouts, from the bottom of the tanks (and their sumps)
    const TH = sh.tankH ?? TANK_H;
    const floor = TH + (sh.sump?.h ?? 0);
    if (t.kind === 'exchanger')
      sh.tanks.forEach((tk, k) => {
        pipes(art, [[tankX(tk), floor], [tankX(tk), HELIX.y - HELIX.r]]);
        pipes(art, [[sh.spouts[k], HELIX.y + HELIX.r], [sh.spouts[k], sh.spoutY - 4]]);
      });
    else if (t.kind === 'separator') {
      // the manifold: one pipe in, five out, with a divider between each two outlets, and a handle on its left end
      // (so it doesn't look the same flipped; it says nothing about which side gets what)
      pipes(art, [[0, floor], [0, SEP_BODY.y0]]);
      for (const x of sh.spouts) pipes(art, [[x, SEP_BODY.y1], [x, sh.spoutY - 4]]);
      block(art, panelMat, SEP_BODY.x0, SEP_BODY.x1, SEP_BODY.y0, SEP_BODY.y1, -10, 10);
      for (let k = 1; k < sh.spouts.length; k++) {
        const x = (sh.spouts[k - 1] + sh.spouts[k]) / 2;
        block(art, darkMat, x - 0.8, x + 0.8, SEP_BODY.y0 + 4, SEP_BODY.y1, 10, 10.6);
      }
      const { x0, y0, y1 } = SEP_BODY;
      pipes(art, [[x0, y0 + 3], [x0 - 6, y0 + 3], [x0 - 6, y1 - 3], [x0, y1 - 3]], 1.3);
    } else if (t.kind === 'splitter') {
      const fork = sh.valveY + 10;
      pipes(art, [[0, TH], [0, fork]]);
      for (const x of sh.spouts) pipes(art, [[0, fork], [x, fork + 16], [x, sh.spoutY - 4]]);
    } else if (t.kind === 'sorter') {
      const x = tankX(sh.tanks[0]);
      pipes(art, [[x, TH], [x, chuteY(x)]]);
      sh.spouts.forEach((x, k) => pipes(art, [[x, k < sh.spouts.length - 1 ? chuteY(x) + 8 : SORTER_CHUTE.y1], [x, sh.spoutY - 4]]));
    } else if (t.kind === 'heater') {
      // the funnel's stem down into the tube, a pipe from the tube down through each tap, and the far end turning
      // down into the last spout
      const { x1, y, r } = HEATER_TUBE;
      const end = sh.spouts[sh.spouts.length - 1];
      pipes(art, [[tankX(sh.tanks[0]), TH], [tankX(sh.tanks[0]), y - r + 1]]);
      for (const x of sh.spouts.slice(0, -1)) pipes(art, [[x, y + r - 1], [x, sh.spoutY - 4]]);
      pipes(art, [[x1 + r - 1, y], [end - 4, y], [end, y + 4], [end, sh.spoutY - 4]]);
    } else if (t.kind === 'spectrometer') pipes(art, [[0, TH], [0, SPECTROMETER.body.y0]]);
    else if (t.kind === 'receptacle') pipes(art, [[sh.spouts[0], TH], [sh.spouts[0], sh.spoutY - 4]]);
    else pipes(art, [[0, floor], [0, sh.spoutY - 4]]);
    for (const x of sh.spouts) block(art, pipeMat, x - 4, x + 4, sh.spoutY - 6, sh.spoutY, -4, 4);

    // tanks, with their fluid
    t.tanks.forEach((_, k) => {
      const r = tankRect(t, k);
      const o = openingOf(t, k);
      const d = D.tank;
      const w = r.x1 - r.x0;
      const cx = (r.x0 + r.x1) / 2;
      let geoms: THREE.BufferGeometry[];
      let level: (v: Vessel) => number;
      const share = (v: Vessel) => Math.min(1, volume(v) / v.cap);
      if (sh.cup) {
        openBox(art, r.x0, r.x1, r.y0, r.y1, d);
        glassFrom(art, frustum(cx, o.y, r.y0, 2 * sh.cup.w, 2 * sh.cup.w, w, d, true));
        geoms = [
          new THREE.BoxGeometry(w - 1, r.y1 - r.y0, d - 1).translate(cx, -(r.y0 + r.y1) / 2, 0),
          frustum(cx, o.y, r.y0, 2 * sh.cup.w - 1, 2 * sh.cup.w - 1, w - 1, d - 1, false),
        ];
        level = (v) => onTool(t, 0, r.y1 - cupFillHeight(share(v), w, r.y1 - r.y0, 2 * sh.cup!.w, sh.cup!.h)).y;
        this.graduations(r, o, sh.cup, d);
      } else if (sh.funnel) {
        glassFrom(art, frustum(cx, r.y0, r.y1, w, d, 6, 6, true));
        geoms = [frustum(cx, r.y0 + 0.5, r.y1 - 0.5, w - 1.5, d - 1.5, 5, 5, false)];
        level = (v) => onTool(t, 0, r.y1 - share(v) * (r.y1 - r.y0)).y;
      } else {
        openBox(art, r.x0, r.x1, r.y0, r.y1, d);
        // a thin metal rim
        const rw = 1.2;
        for (const [x0, x1, z0, z1] of [
          [r.x0 - rw, r.x0, -d / 2 - rw, d / 2 + rw], [r.x1, r.x1 + rw, -d / 2 - rw, d / 2 + rw],
          [r.x0, r.x1, -d / 2 - rw, -d / 2], [r.x0, r.x1, d / 2, d / 2 + rw],
        ])
          block(art, pipeMat, x0, x1, -0.6, 0.6, z0, z1).castShadow = false;
        geoms = [new THREE.BoxGeometry(w - 1, r.y1 - r.y0 - 0.5, d - 1).translate(cx, -(r.y0 + r.y1) / 2 - 0.25, 0)];
        const sump = sh.sump;
        if (sump) {
          // a narrow point under the middle of the floor, which fills first
          const sd = Math.min(d, sump.w);
          glassFrom(art, frustum(cx, r.y1, r.y1 + sump.h, sump.w, sd, SUMP_TIP, SUMP_TIP, true));
          geoms.push(frustum(cx, r.y1 - 0.5, r.y1 + sump.h - 0.3, sump.w - 1, sd - 1, SUMP_TIP - 0.6, SUMP_TIP - 0.6, false));
          level = (v) => onTool(t, 0, r.y1 + sump.h - sumpFillHeight(share(v), w, r.y1 - r.y0, sump)).y;
          if (t.kind === 'tank') this.tankLines(r, sump, d);
        } else level = (v) => onTool(t, 0, r.y1 - share(v) * (r.y1 - r.y0)).y;
      }
      const fm = new FluidMesh(geoms, art);
      for (const m of fm.meshes) pick(m, 'tank', k);
      this.fluids.push({ fm, level });
      // a lid, while nothing may get in
      const lid = block(art, pipeMat, r.x0 - 4, r.x1 + 4, -5, 0, -d / 2 - 3, d / 2 + 3);
      lid.visible = false;
      this.lids.push(lid);
      const lines = sh.label?.length ?? 0;
      this.labels.push(new Label(upright, v3(ux(tankX(sh.tanks[k])), o.y - (lines ? 11 * lines + 10 : 9))));
      this.glows.push(new Glow(scene));
    });
    if (sh.label) {
      const s = textSprite(sh.label);
      s.position.copy(v3(ux(0), -21 + (11 * (sh.label.length - 1)) / 2 - 4));
      upright.add(s);
    }
    if (t.tanks.length > 1)
      sh.tanks.forEach((tk) => {
        const s = textSprite([tk.name], '#e6ece8');
        s.scale.multiplyScalar(0.9);
        s.position.copy(v3(ux(tankX(tk)), 14, D.tank / 2 + 1));
        upright.add(s);
      });
    // a note about the whole tool, centered over it, above its tanks' labels
    const b = sh.box;
    this.note = new Label(upright, v3(ux((b.x0 + b.x1) / 2), b.y0 - 8 - (t.tanks.length > 1 ? 13 : 0)));

    if (t.kind === 'exchanger') this.buildHelix();
    if (t.kind === 'sorter') this.buildChute();
    if (t.kind === 'spectrometer') this.buildSpectrometer(pick);
    if (t.kind === 'heater') this.buildHeater();
    if (t.kind === 'meter') this.buildMeter();
    if (t.kind === 'receptacle') this.buildReceptacle(pick);

    // valves: a round core on the front face, and a lever that points where it was turned; or a dial
    if (!sh.noValve)
      t.valves.forEach((_, k) => {
        const vc = valveLocal(t, k);
        const z = valveZ(t);
        if (k === sh.dial) {
          this.dial = this.buildDial(vc, z);
          upright.traverse((m) => m.parent === this.dial && pick(m, 'valve', k));
          return;
        }
        rod(upright, pipeMat, v3(vc.x, vc.y, 0), v3(vc.x, vc.y, z), 1.5);
        const core = new THREE.Mesh(unitCylinder, panelMat);
        core.rotation.x = Math.PI / 2;
        core.scale.set(5, 4, 5);
        core.position.copy(v3(vc.x, vc.y, z));
        upright.add(core);
        pick(core, 'valve', k);
        const pivot = new THREE.Group();
        pivot.position.copy(v3(vc.x, vc.y, z + 2.5));
        const lever = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 2).translate(6, 0, 0), leverMat);
        lever.castShadow = true;
        pivot.add(lever);
        upright.add(pivot);
        pick(lever, 'valve', k);
        this.levers.set(k, pivot);
      });

    // everything else that's drawn is the tool's body, to grab it by
    this.body.traverse((m) => {
      if (m instanceof THREE.Mesh && !pickables.has(m)) pick(m, 'body');
    });
    scene.add(this.root);
  }

  /** Ten marks up the left wall of a tank with a cup, at each tenth of its capacity as its fluid is shown (see cupFillHeight). */
  private graduations(r: { x0: number; x1: number; y0: number; y1: number }, o: { x0: number }, cup: { w: number; h: number }, d: number): void {
    const tubeW = r.x1 - r.x0;
    const tubeH = r.y1 - r.y0;
    for (let i = 1; i <= 10; i++) {
      const h = cupFillHeight(i / 10, tubeW, tubeH, 2 * cup.w, cup.h);
      const x = h <= tubeH ? r.x0 : r.x0 + ((h - tubeH) / cup.h) * (o.x0 - r.x0);
      const len = i % 5 === 0 ? 5 : 3;
      block(this.art, darkMat, x, x + len, r.y1 - h - 0.35, r.y1 - h + 0.35, d / 2, d / 2 + 0.3).castShadow = false;
    }
  }

  /** Ten thin, faint lines across the big tank's front, one at each tenth of its capacity as its fluid is shown, the last at the brim. */
  private tankLines(r: { x0: number; x1: number; y0: number; y1: number }, sump: { w: number; h: number }, d: number): void {
    for (let i = 1; i <= 10; i++) {
      const y = r.y1 + sump.h - sumpFillHeight(i / 10, r.x1 - r.x0, r.y1 - r.y0, sump);
      block(this.art, faintMat, r.x0, r.x1, y - 0.3, y + 0.3, d / 2, d / 2 + 0.2).castShadow = false;
    }
  }

  /** The exchanger's two hoses, wound around each other, glass so each stream shows going from inlet to outlet color. */
  private buildHelix(): void {
    const { x0, x1, y, r, halfTwists } = HELIX;
    this.helix = [0, 1].map((k) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= halfTwists * 16; i++) {
        const u = i / (halfTwists * 16);
        const th = Math.PI * halfTwists * u;
        const sg = k ? -1 : 1;
        // strand A enters at the left and B at the right
        const x = k ? x1 + (x0 - x1) * u : x0 + (x1 - x0) * u;
        pts.push(v3(x, y - sg * r * Math.cos(th), sg * r * Math.sin(th)));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const glass = new THREE.TubeGeometry(curve, halfTwists * 16, 3.4, 8);
      this.art.add(new THREE.Mesh(glass, glassMat));
      const geom = new THREE.TubeGeometry(curve, halfTwists * 16, 2.1, 6);
      const colors = new THREE.BufferAttribute(new Float32Array(geom.attributes.position.count * 3), 3);
      geom.setAttribute('color', colors);
      const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true }));
      m.visible = false;
      this.art.add(m);
      return { geom, colors, k };
    });
  }

  /** The size sorter's chute: a plain sloping floor with a hopper under each screen, and a film of what's sliding down it. */
  private buildChute(): void {
    const c = SORTER_CHUTE;
    const sp = this.t.shape.spouts;
    const len = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(len, 3, 26), pipeMat);
    floor.position.copy(v3((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2 + 1.5));
    floor.rotation.z = -Math.atan2(c.y1 - c.y0, c.x1 - c.x0);
    floor.castShadow = true;
    this.art.add(floor);
    for (const side of [-1, 1]) {
      const wall = floor.clone();
      wall.scale.set(1, 3, 1 / 13);
      wall.position.z = side * 13;
      wall.position.y += 3;
      this.art.add(wall);
    }
    // the plain floor doesn't give away what the screens let through; hoppers hang under them
    for (const x of sp.slice(0, -1)) this.art.add(new THREE.Mesh(frustum(x, chuteY(x) + 3, chuteY(x) + 10, 24, 22, 6, 6, false), pipeMat));
    const stops = [tankX(this.t.shape.tanks[0]), ...sp.slice(0, -1), c.x1];
    for (let k = 0; k < sp.length; k++) {
      const a = stops[k];
      const b = stops[k + 1];
      const mat = new THREE.MeshBasicMaterial();
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(b - a, chuteY(b) - chuteY(a)), 1.2, 18), mat);
      m.position.copy(v3((a + b) / 2, (chuteY(a) + chuteY(b)) / 2 - 0.8));
      m.rotation.z = floor.rotation.z;
      m.visible = false;
      this.art.add(m);
      this.films.push(m);
      this.filmMats.push(mat);
    }
  }

  /** A sample cup on a cabinet with an old green-on-black screen, a lamp and a red push button, and no words anywhere. */
  private buildSpectrometer(pick: (m: THREE.Object3D, part: 'body' | 'button') => void): void {
    const { body: b, screen: s, button } = SPECTROMETER;
    const D = TOOL_DEPTH.spectrometer.body;
    block(this.art, panelMat, b.x0, b.x1, b.y0, b.y1, -D / 2, D / 2);
    block(this.art, darkMat, s.x0 - 1.5, s.x1 + 1.5, s.y0 - 1.5, s.y1 + 1.5, D / 2, D / 2 + 0.6);
    this.screen = new Screen(this.art, s.x0, s.x1, s.y0, s.y1, D / 2 + 0.7, 5);
    this.lamp = new THREE.Mesh(unitSphere, new THREE.MeshStandardMaterial({ color: 0x5b665f }));
    this.lamp.scale.setScalar(3);
    this.lamp.position.copy(v3(s.x0 + 6, (button.y0 + button.y1) / 2, D / 2 + 1));
    this.art.add(this.lamp);
    this.button = block(this.art, keyMats.up, button.x0, button.x1, button.y0, button.y1, D / 2, D / 2 + 4);
    pick(this.button, 'button');
  }

  /**
   * A heater's tube: glass, with what's in each stretch of it lying along its floor (as deep as that stretch holds
   * when the funnel feeds it flat out), and the wire coiled down its middle, from copper to white-hot as the dial
   * turns up; and the box the dial sits on, with the wire's lead running down into the tube.
   */
  private buildHeater(): void {
    const { x0, x1, y, r } = HEATER_TUBE;
    const tube = new THREE.CapsuleGeometry(r, x1 - x0, 6, 18).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, -y, 0);
    this.art.add(new THREE.Mesh(tube, glassMat));
    const w = (x1 - x0) / HEATER_CELLS;
    for (let c = 0; c < HEATER_CELLS; c++) {
      // the ends run on into the tube's rounded caps
      const a = c === 0 ? x0 - r * 0.7 : x0 + c * w;
      const b = c === HEATER_CELLS - 1 ? x1 + r * 0.7 : x0 + (c + 1) * w;
      const mat = new THREE.MeshBasicMaterial();
      const m = new THREE.Mesh(new THREE.BoxGeometry(b - a + 0.2, 1, 1.5 * r).translate((a + b) / 2, 0.5, 0), mat);
      m.visible = false;
      this.art.add(m);
      this.cells.push({ m, mat });
    }
    const B = HEATER_BOX;
    block(this.art, panelMat, B.x0, B.x1, B.y0, B.y1, -12, 12);
    // the wire, coiled along the tube and up into the box
    const lead = B.x0 + 32;
    const pts: THREE.Vector3[] = [];
    for (let x = x0; x <= lead; x += 0.75) {
      const ph = ((x - x0) / 5) * Math.PI;
      pts.push(v3(x, y + 2.6 * Math.sin(ph), 2.6 * Math.cos(ph)));
    }
    pts.push(v3(lead, y - 4), v3(lead, B.y1));
    this.wire = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.6 });
    this.art.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, 0.65, 5), this.wire));
  }

  /** A dial on the face of a box: a knob on a ring of ticks running clockwise from down-left (off) to down-right (full). */
  private buildDial(vc: { x: number; y: number }, z: number): THREE.Group {
    const at = (d: number) => -0.75 * Math.PI + 1.5 * Math.PI * d; // clockwise from straight up
    for (let i = 0; i <= 6; i++) {
      const a = at(i / 6);
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.5, 0.6), darkMat);
      tick.position.copy(v3(vc.x + 11.75 * Math.sin(a), vc.y - 11.75 * Math.cos(a), z - 2.5));
      tick.rotation.z = -a;
      this.upright.add(tick);
    }
    const knob = new THREE.Mesh(unitCylinder, panelMat);
    knob.rotation.x = Math.PI / 2;
    knob.scale.set(8, 5, 8);
    knob.position.copy(v3(vc.x, vc.y, z - 1));
    const pivot = new THREE.Group();
    pivot.position.copy(v3(vc.x, vc.y, z + 1.6));
    const pointer = new THREE.Mesh(new THREE.BoxGeometry(2.2, 5.5, 1).translate(0, 4.25, 0), leverMat);
    pivot.add(pointer);
    const dial = new THREE.Group();
    dial.add(knob, pivot);
    this.upright.add(dial);
    return dial;
  }

  /** A flow meter's cabinet, with its reading (see meterText) on a seven-segment display like the scale's. */
  private buildMeter(): void {
    const { display: d, ...b } = METER_BODY;
    const z = TOOL_DEPTH.meter.body / 2;
    block(this.art, panelMat, b.x0, b.x1, b.y0, b.y1, -z, z);
    block(this.art, darkMat, d.x0, d.x1, d.y0, d.y1, z, z + 0.5);
    this.screen = new Screen(this.art, d.x0, d.x1, d.y0, d.y1, z + 0.6, 6);
  }

  /**
   * A receptacle's cabinet: a row of lamps that blink with its thinking, a verdict lamp, its button, a green-on-black
   * screen showing the litres it's taken so far of the litres needed, a hose from its foot down to the floor, and the
   * reject valve under the vessel, which has no handle: it opens itself to pour out what the receptacle refused.
   */
  private buildReceptacle(pick: (m: THREE.Object3D, part: 'body' | 'button') => void): void {
    const { lamps, verdict, button, screen: s, ...b } = RECEPTACLE_BODY;
    const z = TOOL_DEPTH.receptacle.body / 2;
    block(this.art, panelMat, b.x0, b.x1, b.y0, b.y1, -z, z);
    for (let i = 0; i < RECEPTACLE_LAMPS; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x5b665f });
      const m = new THREE.Mesh(unitSphere, mat);
      m.scale.setScalar(lamps.r);
      m.position.copy(v3(lamps.x0 + i * lamps.dx, lamps.y, z + 0.5));
      this.art.add(m);
      this.lamps.push(mat);
    }
    this.verdict = new THREE.MeshStandardMaterial({ color: 0x5b665f });
    const v = new THREE.Mesh(unitSphere, this.verdict);
    v.scale.setScalar(verdict.r);
    v.position.copy(v3(verdict.x, verdict.y, z + 0.5));
    this.art.add(v);
    this.button = block(this.art, keyMats.up, button.x0, button.x1, button.y0, button.y1, z, z + 4);
    pick(this.button, 'button');
    block(this.art, darkMat, s.x0 - 1, s.x1 + 1, s.y0 - 1, s.y1 + 1, z, z + 0.5);
    this.screen = new Screen(this.art, s.x0, s.x1, s.y0, s.y1, z + 0.6, 8);
    const sp = this.t.shape;
    const valve = new THREE.Mesh(unitCylinder, panelMat);
    valve.rotation.x = Math.PI / 2;
    valve.scale.set(4.5, 6, 4.5);
    valve.position.copy(v3(sp.spouts[0], sp.valveY, z - 2));
    this.art.add(valve);
    const mat = new THREE.MeshBasicMaterial();
    const outer = new THREE.Mesh(unitCylinder, pipeMat);
    const core = new THREE.Mesh(unitCylinder, mat);
    this.art.add(outer, core);
    this.hose = { outer, core, mat };
  }

  update(hot: Pick | null, shake: number, delivered: number): void {
    const { t } = this;
    this.root.position.set(t.pose.x, t.pose.y, t.pose.z);
    this.root.rotation.y = t.pose.yaw;
    this.body.position.set(shake * (2 * Math.random() - 1), shake * (2 * Math.random() - 1), 0);
    this.body.updateMatrixWorld();
    t.tanks.forEach((v, k) => {
      const { fm, level } = this.fluids[k];
      fm.update(v, level(v));
      this.lids[k].visible = t.lidded;
      this.labels[k].set(v.label);
      const r = tankRect(t, k);
      const c = onTool(t, tankX(t.shape.tanks[k]), (r.y0 + r.y1) / 2);
      this.glows[k].update(v, v.cap, new THREE.Vector3(c.x, c.y, c.z));
    });
    this.note.set(t.note);
    for (const [k, pv] of this.levers)
      // closed points right, open straight up; a splitter's points to the side that gets more
      pv.rotation.z = t.kind === 'splitter' ? Math.PI * (1 - t.valves[k]) : (t.valves[k] * Math.PI) / 2;
    if (this.dial) {
      const d = t.valves[t.shape.dial!];
      this.dial.children[1].rotation.z = -(-0.75 * Math.PI + 1.5 * Math.PI * d);
    }
    if (this.helix)
      for (const { geom, colors, k } of this.helix) {
        const out = t.out[k];
        const m = this.art.children.find((c) => (c as THREE.Mesh).geometry === geom)!;
        m.visible = !!out;
        if (!out) continue;
        const tank = t.tanks[k];
        const ca = setRGB(new THREE.Color(), fluidRGB(tank.N > TRACE ? tank : out)!);
        const cb = setRGB(new THREE.Color(), fluidRGB(out)!);
        // the tube's vertices run ring by ring along it, from the inlet
        const rings = geom.parameters.tubularSegments + 1;
        const per = colors.count / rings;
        const c = new THREE.Color();
        for (let i = 0; i < colors.count; i++) {
          c.copy(ca).lerp(cb, Math.floor(i / per) / (rings - 1));
          colors.setXYZ(i, c.r, c.g, c.b);
        }
        colors.needsUpdate = true;
      }
    this.films.forEach((m, k) => {
      const on = new Vessel(Infinity);
      for (const v of t.out.slice(k)) if (v) on.addFrom(v, volume(v));
      const rgb = on.N > 0 ? fluidRGB(on) : null;
      m.visible = !!rgb;
      if (rgb) setRGB(this.filmMats[k].color, rgb);
    });
    if (this.cells.length) {
      const full = (HEATER.feed * HEATER.transit) / HEATER_CELLS;
      const { y, r } = HEATER_TUBE;
      t.tube.forEach((v, c) => {
        const { m, mat } = this.cells[c];
        const rgb = v.N > TRACE ? fluidRGB(v) : null;
        m.visible = !!rgb;
        if (!rgb) return;
        setRGB(mat.color, rgb);
        const d = Math.max(0.3, 2 * r * Math.min(1, volume(v) / full));
        m.scale.y = d;
        m.position.y = -(y + r);
      });
      const dial = t.valves[t.shape.dial!];
      const rgb = wireColor(dial);
      setRGB(this.wire!.color, rgb);
      setRGB(this.wire!.emissive, rgb).multiplyScalar(Math.min(1, 1.3 * dial));
    }
    if (t.kind === 'spectrometer' && this.screen) drawSpectrum(this.screen, t);
    if (t.kind === 'meter' && this.screen) {
      const s = this.screen;
      const text = meterText(t.rate);
      if (s.key !== text) {
        s.key = text;
        const d = METER_BODY.display;
        s.ctx.setTransform(s.ppu, 0, 0, s.ppu, -d.x0 * s.ppu, -d.y0 * s.ppu);
        s.ctx.fillStyle = '#050603';
        s.ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
        drawSevenSeg(s.ctx, text, d.x1 - 2, d.y0 + 2.5, METER_DIGITS, 'yellowgreen', 'rgba(154, 205, 50, 0.08)', s.ppu);
        s.tex.needsUpdate = true;
      }
    }
    if (t.kind === 'receptacle') this.updateReceptacle(delivered);
    if (this.lamp) {
      const on = t.scanning && Math.floor(t.scanAge * 3) % 2 === 0;
      const m = this.lamp.material as THREE.MeshStandardMaterial;
      m.color.set(on ? 0xffb43a : 0x5b665f);
      m.emissive.set(on ? 0xffa020 : 0x000000);
    }
    if (this.button) {
      const busy = t.kind === 'receptacle' ? !!t.cycle : t.scanning;
      const z = TOOL_DEPTH[t.kind].body / 2;
      const isHot = hot?.kind === 'tool' && hot.t === t && hot.part === 'button';
      this.button.material = busy ? keyMats.down : isHot ? keyMats.hot : keyMats.up;
      this.button.position.z = z + (busy ? 0.6 : 2);
    }
  }

  private updateReceptacle(delivered: number): void {
    const { t } = this;
    const c = t.cycle;
    // a lamp is lit for a moment after each beep that lights it
    this.lamps.forEach((mat, i) => {
      const lit = c?.phase === 'think' && t.beeps.some((bp) => bp.lamp === i && bp.t <= c.age && c.age - bp.t < 0.12);
      mat.color.set(lit ? LAMP_COLORS[i] : 0x5b665f);
      mat.emissive.set(lit ? LAMP_COLORS[i] : 0x000000);
    });
    const v = t.verdict === 'pass' ? 0x5cff7a : t.verdict === 'fail' ? 0xff4a3d : null;
    this.verdict!.color.set(v ?? 0x5b665f);
    this.verdict!.emissive.set(v ?? 0x000000);
    // the screen: accepted / required, in litres
    const s = this.screen!;
    const text = `${((delivered / CAP) * FLASK_L).toFixed(3)} L / ${GOAL_L.toFixed(3)} L`;
    if (s.key !== text) {
      s.key = text;
      const sc = RECEPTACLE_BODY.screen;
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
      s.tex.needsUpdate = true;
    }
    // the hose, from the cabinet's foot straight down to the floor or counter, showing a flush going down it
    const x = RECEPTACLE_BODY.hoseX;
    const top = RECEPTACLE_BODY.y1;
    const foot = onTool(t, x, top);
    const down = Math.max(top + 1, top + foot.y - groundAt(foot.x, foot.z));
    const { outer, core, mat } = this.hose!;
    for (const [m, r] of [[outer, 4.5], [core, 2.6]] as const) {
      m.position.copy(v3(x, (top + down) / 2));
      m.scale.set(r, down - top, r);
    }
    const flushing = c?.phase === 'flush' && t.tanks[0].N > TRACE;
    core.visible = flushing;
    if (flushing) setRGB(mat.color, fluidRGB(t.tanks[0])!);
  }

  dispose(): void {
    this.root.removeFromParent();
    disposeGeometry(this.root);
    for (const { fm } of this.fluids) fm.dispose();
    for (const g of this.glows) g.dispose();
    this.screen?.tex.dispose();
  }
}

/* ---------------- scales ---------------- */

class ScaleView {
  readonly root = new THREE.Group();
  private display: Screen;
  private key: THREE.Mesh;
  private note: Label;

  constructor(
    readonly sc: Scale,
    scene: THREE.Object3D,
    pickables: Map<THREE.Object3D, Pick>,
  ) {
    const { platform: pl, body, display: d, tare, depth } = SCALE_SHAPE;
    pickables.set(block(this.root, panelMat, body.x0, body.x1, 4, body.y1, -depth + 4, depth - 4), { kind: 'scale', sc, part: 'body' });
    pickables.set(block(this.root, pipeMat, pl.x0, pl.x1, 0, 5, -depth, depth), { kind: 'scale', sc, part: 'body' });
    const z = depth - 4;
    block(this.root, darkMat, d.x0, d.x1, d.y0, d.y1, z, z + 0.5);
    this.display = new Screen(this.root, d.x0, d.x1, d.y0, d.y1, z + 0.6, 6);
    this.key = block(this.root, keyMats.up, tare.x0, tare.x1, tare.y0, tare.y1, z, z + 4);
    pickables.set(this.key, { kind: 'scale', sc, part: 'tare' });
    this.note = new Label(this.root, new THREE.Vector3(0, NOTE_Y, 0));
    scene.add(this.root);
  }

  update(pressed: boolean, hot: Pick | null): void {
    const { sc } = this;
    // just above its platform, or above any flasks standing on it, and their notes
    this.note.place(new THREE.Vector3(0, sc.load.length ? FLASK_H + NOTE_Y + 13 : NOTE_Y, 0));
    this.note.set(sc.note);
    this.root.position.set(sc.pose.x, sc.pose.y, sc.pose.z);
    this.root.rotation.y = sc.pose.yaw;
    const g = sc.reading();
    const text = g === null ? 'OUEr' : String(g);
    const s = this.display;
    if (s.key !== text) {
      s.key = text;
      const d = SCALE_SHAPE.display;
      s.ctx.setTransform(s.ppu, 0, 0, s.ppu, -d.x0 * s.ppu, -d.y0 * s.ppu);
      s.ctx.fillStyle = '#050603';
      s.ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
      drawSevenSeg(s.ctx, text, d.x1 - 4, d.y0 + 3.5, 6, 'yellowgreen', 'rgba(154, 205, 50, 0.08)', s.ppu);
      s.tex.needsUpdate = true;
    }
    const isHot = hot?.kind === 'scale' && hot.sc === sc && hot.part === 'tare';
    const z = SCALE_SHAPE.depth - 4;
    this.key.material = pressed ? keyMats.down : isHot ? keyMats.hot : keyMats.up;
    this.key.position.z = z + (pressed ? 0.6 : 2);
  }

  dispose(): void {
    this.root.removeFromParent();
    disposeGeometry(this.root);
    this.display.tex.dispose();
  }
}

/* ---------------- hoses ---------------- */

const funnelGlass = new THREE.CylinderGeometry(FUNNEL_R, 4, FUNNEL_H, 20, 1, true).translate(0, -FUNNEL_H / 2, 0);
const funnelFluid = new THREE.CylinderGeometry(FUNNEL_R - 1, 3.5, FUNNEL_H - 0.5, 20, 1).translate(0, -FUNNEL_H / 2, 0);
const nozzleGeom = new THREE.CylinderGeometry(4, 3, NOZZLE_H, 12).translate(0, NOZZLE_H / 2, 0);

class HoseView {
  private inlet = new THREE.Group();
  private outlet = new THREE.Group();
  private tube: THREE.Mesh;
  private core: THREE.Mesh;
  private coreMat = new THREE.MeshBasicMaterial();
  private fluid: FluidMesh;
  private key = '';
  private note: Label;

  constructor(
    readonly h: Hose,
    scene: THREE.Object3D,
    pickables: Map<THREE.Object3D, Pick>,
  ) {
    const glass = new THREE.Mesh(funnelGlass, glassMat);
    this.inlet.add(glass, new THREE.LineSegments(new THREE.EdgesGeometry(funnelGlass, 30), edgeMat));
    this.fluid = new FluidMesh([funnelFluid], this.inlet);
    pickables.set(glass, { kind: 'hose', h, end: 'inlet' });
    for (const m of this.fluid.meshes) pickables.set(m, { kind: 'hose', h, end: 'inlet' });
    const nozzle = new THREE.Mesh(nozzleGeom, pipeMat);
    nozzle.castShadow = true;
    this.outlet.add(nozzle);
    pickables.set(nozzle, { kind: 'hose', h, end: 'outlet' });
    this.tube = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x7c8883, transparent: true, opacity: 0.45, roughness: 0.3, depthWrite: false }));
    this.core = new THREE.Mesh(new THREE.BufferGeometry(), this.coreMat);
    this.note = new Label(this.inlet, new THREE.Vector3(0, NOTE_Y, 0));
    scene.add(this.inlet, this.outlet, this.tube, this.core);
  }

  update(): void {
    const { h } = this;
    this.inlet.position.set(h.inlet.x, h.inlet.y, h.inlet.z);
    this.outlet.position.set(h.outlet.x, h.outlet.y, h.outlet.z);
    this.inlet.updateMatrixWorld();
    this.note.set(h.note);
    const f = h.funnel;
    this.fluid.update(f, h.inlet.y - FUNNEL_H + Math.min(1, volume(f) / f.cap) * FUNNEL_H);
    const key = [h.inlet.x, h.inlet.y, h.inlet.z, h.outlet.x, h.outlet.y, h.outlet.z].map((x) => x.toFixed(1)).join();
    if (key !== this.key) {
      this.key = key;
      // drooping below the funnel, and coming down into the nozzle from above
      const a = new THREE.Vector3(h.inlet.x, h.inlet.y - FUNNEL_H, h.inlet.z);
      const b = new THREE.Vector3(h.outlet.x, h.outlet.y + NOZZLE_H, h.outlet.z);
      const droop = 70;
      const curve = new THREE.CubicBezierCurve3(a, a.clone().setY(a.y - droop), b.clone().setY(b.y + droop), b);
      this.tube.geometry.dispose();
      this.core.geometry.dispose();
      this.tube.geometry = new THREE.TubeGeometry(curve, 40, 3.5, 8);
      this.core.geometry = new THREE.TubeGeometry(curve, 40, 2, 6);
    }
    const rgb = h.out ? fluidRGB(h.out) : null;
    this.core.visible = !!rgb;
    if (rgb) this.coreMat.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  }

  dispose(): void {
    for (const o of [this.inlet, this.outlet, this.tube, this.core]) o.removeFromParent();
    this.tube.geometry.dispose();
    this.core.geometry.dispose();
    this.fluid.dispose();
  }
}

/* ---------------- sticky notes ---------------- */

/** Pixels per world unit a sticky note is drawn at, and the most pixels across it can have. */
const PAPER_PPU = 4;
const PAPER_MAX_PX = 2048;

/**
 * A sticky note on the back wall: yellow paper with its pencil strokes and text. With the pencil in hand it shows the
 * strip it's moved by, the × that throws it away and the corner it's resized by.
 */
class PaperView {
  private canvas = document.createElement('canvas');
  private tex = new THREE.CanvasTexture(this.canvas);
  private mesh: THREE.Mesh;
  private key = '';

  constructor(
    readonly paper: Paper,
    scene: THREE.Object3D,
  ) {
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9 }));
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  update(at: { x: number; y: number }, pencil: boolean): void {
    const pa = this.paper;
    this.mesh.position.set(at.x + pa.w / 2, -(at.y + pa.h / 2), PAPER_Z);
    this.mesh.scale.set(pa.w, pa.h, 1);
    const points = pa.strokes.reduce((t, st) => t + st.length, 0);
    const key = `${pa.w}x${pa.h}|${pa.strokes.length}:${points}|${pa.texts.map((t) => t.text).join('\n')}|${pencil}`;
    if (key === this.key) return;
    this.key = key;
    const ppu = Math.min(PAPER_PPU, PAPER_MAX_PX / Math.max(pa.w, pa.h));
    const c = this.canvas;
    c.width = Math.ceil(pa.w * ppu);
    c.height = Math.ceil(pa.h * ppu);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(ppu, 0, 0, ppu, 0, 0);
    ctx.fillStyle = '#fbf0a2';
    ctx.fillRect(0, 0, pa.w, pa.h);
    ctx.strokeStyle = '#3b3a36';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const st of pa.strokes) {
      ctx.beginPath();
      ctx.moveTo(st[0], st[1]);
      // a lone point is a dot
      if (st.length === 2) ctx.lineTo(st[0] + 0.01, st[1]);
      for (let i = 2; i < st.length; i += 2) ctx.lineTo(st[i], st[i + 1]);
      ctx.stroke();
    }
    ctx.fillStyle = '#2d2c29';
    ctx.font = `${PAPER_TEXT}px "Schibsted Grotesk", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const t of pa.texts) ctx.fillText(t.text, t.x, t.y);
    if (pencil) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(0, 0, pa.w, PAPER_HEADER);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 1;
      const H = PAPER_HANDLE;
      ctx.beginPath();
      ctx.moveTo(pa.w - H + 2.5, 2.5);
      ctx.lineTo(pa.w - 2.5, H - 2.5);
      ctx.moveTo(pa.w - 2.5, 2.5);
      ctx.lineTo(pa.w - H + 2.5, H - 2.5);
      for (const k of [3, 6]) {
        ctx.moveTo(pa.w - k, pa.h - 1);
        ctx.lineTo(pa.w - 1, pa.h - k);
      }
      ctx.stroke();
    }
    this.tex.dispose();
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    (this.mesh.material as THREE.MeshStandardMaterial).map = this.tex;
    (this.mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}

/* ---------------- arms ---------------- */

/**
 * An arm from the ceiling holding something the player let go of: a carriage on the ceiling and a rod that snaps
 * down to a clamp on the thing, or back up when the player takes it.
 */
class Arm {
  readonly group = new THREE.Group();
  private rod: THREE.Mesh;
  private clamp: THREE.Mesh;
  ext = 0;
  at = new THREE.Vector3();
  holding = true;

  constructor(scene: THREE.Object3D) {
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(26, 10, 26), darkMat);
    carriage.position.y = ROOM.y1 - 5;
    this.rod = new THREE.Mesh(unitCylinder, armMat);
    this.clamp = new THREE.Mesh(new THREE.BoxGeometry(9, 7, 9), darkMat);
    this.rod.castShadow = this.clamp.castShadow = true;
    this.group.add(carriage, this.rod, this.clamp);
    scene.add(this.group);
  }

  /** Step the arm toward holding `at`, or (with null) back up out of the way. Returns false once it's all the way up. */
  update(at: THREE.Vector3 | null, dt: number): boolean {
    this.holding = !!at;
    if (at) this.at.copy(at);
    this.ext = Math.max(0, Math.min(1, this.ext + ((at ? 1 : -1) * dt) / ARM_S));
    // fast at first, settling in at the end
    const e = 1 - (1 - this.ext) ** 3;
    const top = ROOM.y1 - 10;
    const bottom = top - (top - this.at.y) * e;
    this.group.position.set(this.at.x, 0, this.at.z);
    this.rod.position.y = (top + bottom) / 2 + 2;
    this.rod.scale.set(2.2, Math.max(0.1, top - bottom), 2.2);
    this.clamp.position.y = bottom;
    return this.ext > 0 || !!at;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/* ---------------- the room ---------------- */

/** A tiled floor texture: dark ship decking. */
function deckTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a302e';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#1c2120';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 252);
  ctx.fillStyle = '#333a37';
  for (const [x, y] of [[20, 20], [236, 20], [20, 236], [236, 236]]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Wall panels: light, with seams. */
function panelTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#a3afb0';
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = '#8e9a9b';
  ctx.fillRect(0, 0, 4, 512);
  ctx.fillRect(0, 0, 256, 4);
  ctx.fillStyle = '#b1bcbd';
  ctx.fillRect(24, 40, 208, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildRoom(scene: THREE.Scene): { beacon: THREE.PointLight; lamp: THREE.Mesh } {
  const W = ROOM.x1 - ROOM.x0;
  const Dp = ROOM.z1 - ROOM.z0;
  const H = ROOM.y1;
  const cx = (ROOM.x0 + ROOM.x1) / 2;
  const cz = (ROOM.z0 + ROOM.z1) / 2;
  const deck = deckTexture();
  deck.repeat.set(W / 160, Dp / 160);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), new THREE.MeshStandardMaterial({ map: deck, roughness: 0.8, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), new THREE.MeshStandardMaterial({ color: 0x5d6763, emissive: 0x1c2120, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, H, cz);
  scene.add(ceil);
  const wall = (w: number, x: number, z: number, ry: number) => {
    const tex = panelTexture();
    tex.repeat.set(w / 220, H / 440);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.1 }));
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    scene.add(m);
  };
  wall(W, cx, ROOM.z0, 0);
  wall(W, cx, ROOM.z1, Math.PI);
  wall(Dp, ROOM.x0, cz, Math.PI / 2);
  wall(Dp, ROOM.x1, cz, -Math.PI / 2);
  // ceiling light panels, and the gantry rails the arms run on
  for (let x = ROOM.x0 + 300; x < ROOM.x1; x += 500)
    for (let z = 350; z < ROOM.z1; z += 600) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(220, 90), new THREE.MeshBasicMaterial({ color: 0xe8f0ea }));
      p.rotation.x = Math.PI / 2;
      p.position.set(x, H - 1, z);
      scene.add(p);
    }
  for (let z = 60; z < ROOM.z1; z += 160) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(W, 6, 8), darkMat);
    r.position.set(cx, H - 3, z);
    scene.add(r);
  }
  // the sink counters along the back wall and under the faucets: whatever falls past everything ends up there, or on the floor
  for (const c of COUNTERS) {
    const w = c.x1 - c.x0;
    const d = c.z1 - c.z0;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(w, LIFT, d), new THREE.MeshStandardMaterial({ color: 0x6f7975, metalness: 0.5, roughness: 0.4 }));
    counter.position.set((c.x0 + c.x1) / 2, LIFT / 2, (c.z0 + c.z1) / 2);
    counter.receiveShadow = counter.castShadow = true;
    scene.add(counter);
    const grate = new THREE.Mesh(new THREE.PlaneGeometry(w - 16, d - 16), new THREE.MeshStandardMaterial({ color: 0x1a1f1e, metalness: 0.6, roughness: 0.5 }));
    grate.rotation.x = -Math.PI / 2;
    grate.position.set((c.x0 + c.x1) / 2, LIFT + 0.5, (c.z0 + c.z1) / 2);
    grate.receiveShadow = true;
    scene.add(grate);
  }
  // a porthole on the left wall, onto the stars
  const port = new THREE.Group();
  const glassDisc = new THREE.Mesh(new THREE.CircleGeometry(150, 48), new THREE.MeshBasicMaterial({ color: 0x02040a }));
  port.add(glassDisc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(152, 12, 12, 48), darkMat);
  port.add(ring);
  const starPos: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) {
    const r = 145 * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    starPos.push(r * Math.cos(a), r * Math.sin(a), 0.5);
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
    new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false }),
  );
  port.add(stars);
  port.position.set(ROOM.x0 + 1, 760, 900);
  port.rotation.y = Math.PI / 2;
  scene.add(port);
  // an emergency beacon over the door, turning slowly
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 10), new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0xff2010, emissiveIntensity: 0.6 }));
  lamp.position.set(cx, H - 120, ROOM.z1 - 16);
  scene.add(lamp);
  const beacon = new THREE.PointLight(0xff2a14, 0, 2600, 1.4);
  beacon.position.copy(lamp.position).add(new THREE.Vector3(0, 0, -30));
  scene.add(beacon);
  return { beacon, lamp };
}

/** The faucets: a manifold along a wall, and each faucet a pipe out over the counter, a knob of its color, and a spout. */
function buildFaucets(
  scene: THREE.Scene,
  faucets: readonly FaucetSpot[],
  pickables: Map<THREE.Object3D, Pick>,
): { mats: THREE.MeshStandardMaterial[]; notes: Label[] } {
  if (!faucets.length) return { mats: [], notes: [] };
  const g = new THREE.Group();
  const at = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
  const first = at(faucets[0].wall);
  const last = at(faucets[faucets.length - 1].wall);
  const along = last.clone().sub(first).normalize().multiplyScalar(60);
  rod(g, pipeMat, first.clone().sub(along), last.clone().add(along), 6);
  const notes: Label[] = [];
  const mats = faucets.map(({ wall, spout }, i) => {
    const elbow = new THREE.Vector3(spout.x, wall.y, spout.z);
    pickables.set(rod(g, pipeMat, at(wall), elbow, 3.5), { kind: 'faucet', i });
    pickables.set(rod(g, pipeMat, elbow, new THREE.Vector3(spout.x, spout.y + 6, spout.z), 3), { kind: 'faucet', i });
    notes.push(new Label(g, elbow.clone().setY(elbow.y + 16 + LABEL_H / 2)));
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(5, 4, 7, 12), pipeMat);
    tip.position.set(spout.x, spout.y + 3.5, spout.z);
    g.add(tip);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1 });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(10, 18, 12), mat);
    knob.position.copy(elbow);
    knob.castShadow = true;
    g.add(knob);
    pickables.set(knob, { kind: 'faucet', i });
    pickables.set(tip, { kind: 'faucet', i });
    return mat;
  });
  scene.add(g);
  return { mats, notes };
}

/* ---------------- the view ---------------- */

/** Draws the lab with Three.js, from the player's eyes, and says what's under the crosshair. */
export class View {
  readonly camera = new THREE.PerspectiveCamera(72, 1, 2, 8000);
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private pickables = new Map<THREE.Object3D, Pick>();
  private flasks = new Map<Flask, FlaskView>();
  private tools = new Map<Tool, ToolView>();
  private scales = new Map<Scale, ScaleView>();
  private hoses = new Map<Hose, HoseView>();
  private papers = new Map<Paper, PaperView>();
  /** A sticky note being marked out with the pencil. */
  private draft: THREE.LineLoop;
  private arms = new Map<object, Arm>();
  private faucetMats: THREE.MeshStandardMaterial[] = [];
  private faucetNotes: Label[] = [];
  private streams: THREE.Mesh[] = [];
  private guides: THREE.Mesh[] = [];
  private rims: { g: THREE.Group; mat: THREE.MeshBasicMaterial; sides: THREE.Mesh[]; ring: THREE.Mesh }[] = [];
  private drops: THREE.Mesh[] = [];
  private beacon: { beacon: THREE.PointLight; lamp: THREE.Mesh };
  private raycaster = new THREE.Raycaster();
  private clock = 0;

  constructor(canvas: HTMLCanvasElement, faucets: readonly FaucetSpot[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color(0x101414);
    this.scene.add(new THREE.HemisphereLight(0xe4eef0, 0x4a4440, 1.5));
    // the ceiling panels, as one light from overhead, so what hangs casts its shadow on the counter and floor
    const sun = new THREE.DirectionalLight(0xf4f8ff, 1.3);
    sun.position.set(450, ROOM.y1 + 1500, 900);
    sun.target.position.set(500, 0, 700);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -1400;
    sc.right = 1400;
    sc.top = 1400;
    sc.bottom = -1400;
    sc.near = 500;
    sc.far = 4500;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);
    this.beacon = buildRoom(this.scene);
    this.draft = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)),
      new THREE.LineDashedMaterial({ color: 0x8ccbb0, dashSize: 4, gapSize: 3 }),
    );
    this.draft.visible = false;
    this.scene.add(this.draft);
    const fs = buildFaucets(this.scene, faucets, this.pickables);
    this.faucetMats = fs.mats;
    this.faucetNotes = fs.notes;
  }

  resize(w: number, h: number, dpr: number): void {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Keep a view for each of `items`, made with `make`, and drop views of things that are gone. */
  private sync<K, V extends { dispose(): void }>(map: Map<K, V>, items: readonly K[], make: (k: K) => V): void {
    const live = new Set(items);
    for (const [k, v] of map)
      if (!live.has(k)) {
        v.dispose();
        map.delete(k);
        for (const [o, p] of this.pickables) if (Object.values(p).includes(k)) this.pickables.delete(o);
      }
    for (const k of items) if (!map.has(k)) map.set(k, make(k));
  }

  /** Put the camera at the player's eyes, looking their way. */
  look(eye: Vec3, yaw: number, pitch: number): void {
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.camera.updateMatrixWorld();
  }

  render(fr: Frame): void {
    this.clock += fr.dt;
    const { scene, pickables } = this;
    this.look(fr.eye, fr.yaw, fr.pitch);

    this.sync(this.flasks, fr.flasks, (f) => new FlaskView(f, scene, pickables));
    this.sync(this.tools, fr.tools, (t) => new ToolView(t, scene, pickables));
    this.sync(this.scales, fr.scales, (s) => new ScaleView(s, scene, pickables));
    this.sync(this.hoses, fr.hoses, (h) => new HoseView(h, scene, pickables));
    for (const v of this.flasks.values()) v.update();
    // a tool flipped since it was built is built again
    for (const [t, v] of this.tools)
      if (v.flipped !== t.flipped) {
        v.dispose();
        for (const [o, p] of pickables) if (p.kind === 'tool' && p.t === t) pickables.delete(o);
        this.tools.set(t, new ToolView(t, scene, pickables));
      }
    for (const v of this.tools.values()) v.update(fr.hot, fr.shake.get(v.t) ?? 0, fr.delivered);
    for (const v of this.scales.values()) v.update(fr.tarePress === v.sc, fr.hot);
    for (const v of this.hoses.values()) v.update();
    fr.faucets.forEach((fa, i) => {
      const rgb = fluidRGB(fa.output);
      if (rgb && this.faucetMats[i]) setRGB(this.faucetMats[i].color, rgb);
      this.faucetNotes[i]?.set(fa.note);
    });

    this.sync(this.papers, fr.papers.sheets.map((s) => s.paper), (p) => new PaperView(p, scene));
    fr.papers.sheets.forEach(({ paper, at }) => this.papers.get(paper)!.update(at, fr.papers.pencil));
    const d = fr.papers.draft;
    this.draft.visible = !!d;
    if (d) {
      const pos = this.draft.geometry.attributes.position as THREE.BufferAttribute;
      const z = PAPER_Z + 0.4;
      [[d.x0, d.y0], [d.x1, d.y0], [d.x1, d.y1], [d.x0, d.y1]].forEach(([x, y], i) => pos.setXYZ(i, x, -y, z));
      pos.needsUpdate = true;
      this.draft.computeLineDistances();
      this.draft.geometry.computeBoundingSphere();
    }

    this.updateArms(fr);
    this.updateStreams(fr);
    this.updateGuides(fr);

    // the beacon turns slowly; real time, like the alarms it goes with
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 2.4);
    this.beacon.beacon.intensity = 9000 * pulse * pulse;
    (this.beacon.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 1.2 * pulse;

    this.renderer.render(scene, this.camera);
  }

  /** An arm holds everything the player let go of, except flasks standing on scales. */
  private updateArms(fr: Frame): void {
    const want = new Map<object, THREE.Vector3>();
    const at = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
    for (const f of fr.flasks)
      if (f !== fr.held && !fr.standing.has(f)) want.set(f, at(toWorld(f.pose, { x: 0, y: -6, z: -14 })));
    for (const t of fr.tools)
      if (t !== fr.held) want.set(t, at(onTool(t, 0, t.shape.box.y0, -TOOL_DEPTH[t.kind].body / 2 - 6)));
    for (const sc of fr.scales)
      if (sc !== fr.held) want.set(sc, at(toWorld(sc.pose, { x: 0, y: -8, z: -SCALE_SHAPE.depth - 6 })));
    for (const h of fr.hoses) {
      if (h.inlet !== fr.held && h !== fr.held) want.set(h.inlet, at({ ...h.inlet, z: h.inlet.z - FUNNEL_R - 4 }));
      if (h.outlet !== fr.held && h !== fr.held) want.set(h.outlet, at({ ...h.outlet, y: h.outlet.y + NOZZLE_H }));
    }
    for (const [k, p] of want) {
      let arm = this.arms.get(k);
      if (!arm) this.arms.set(k, (arm = new Arm(this.scene)));
      arm.update(p, fr.dt);
    }
    for (const [k, arm] of this.arms)
      if (!want.has(k) && !arm.update(null, fr.dt)) {
        arm.dispose();
        this.arms.delete(k);
      }
  }

  /** Arms are already holding everything at the start, rather than all snapping down at once. */
  settleArms(): void {
    for (const arm of this.arms.values()) arm.ext = 1;
  }

  private updateGuides(fr: Frame): void {
    while (this.guides.length < fr.guides.length) {
      const m = new THREE.Mesh(unitCylinder, new THREE.MeshBasicMaterial({ color: 0xb4bcb8, transparent: true, depthWrite: false }));
      m.renderOrder = 5;
      this.scene.add(m);
      this.guides.push(m);
    }
    this.guides.forEach((m, i) => {
      const g = fr.guides[i];
      m.visible = !!g;
      if (!g) return;
      (m.material as THREE.MeshBasicMaterial).opacity = g.solid ? 0.6 : 0.18;
      const len = Math.max(0.1, g.from.y - g.toY);
      const r = g.solid ? GUIDE_R : GUIDE_R * 0.75;
      m.position.set(g.from.x, g.from.y - len / 2, g.from.z);
      m.scale.set(r, len, r);
    });
    // each mouth a guide ends at, outlined once, solid if any guide into it is
    const mouths = new Map<string, Frame['guides'][number]['mouth'] & { solid: boolean }>();
    for (const g of fr.guides) {
      const m = g.mouth;
      const key = `${m.x},${m.y},${m.z}`;
      const was = mouths.get(key);
      mouths.set(key, { ...m, solid: g.solid || !!was?.solid });
    }
    const want = [...mouths.values()];
    while (this.rims.length < want.length) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xdfe6e2, transparent: true, depthWrite: false });
      const sides = [0, 1, 2, 3].map(() => new THREE.Mesh(unitBox, mat));
      const ring = new THREE.Mesh(unitRing, mat);
      const g = new THREE.Group();
      g.add(...sides, ring);
      for (const sd of [...sides, ring]) sd.renderOrder = 5;
      this.scene.add(g);
      this.rims.push({ g, mat, sides, ring });
    }
    this.rims.forEach(({ g, mat, sides, ring }, i) => {
      const m = want[i];
      g.visible = !!m;
      if (!m) return;
      mat.opacity = m.solid ? 0.85 : 0.4;
      g.position.set(m.x, m.y + 0.6, m.z);
      g.rotation.y = m.yaw;
      // a square mouth is a round one (a flask's, a funnel's), so it gets a ring; a tank's gets a frame
      const round = m.hx === m.hz;
      ring.visible = round;
      for (const sd of sides) sd.visible = !round;
      ring.scale.setScalar(m.hx + RIM_W / 2);
      // a frame RIM_W wide just outside the mouth's edges
      const w = RIM_W;
      const [ax, az] = [m.hx + w / 2, m.hz + w / 2];
      sides[0].position.set(0, 0, az);
      sides[1].position.set(0, 0, -az);
      sides[0].scale.set(2 * ax + w, 0.8, w);
      sides[1].scale.set(2 * ax + w, 0.8, w);
      sides[2].position.set(ax, 0, 0);
      sides[3].position.set(-ax, 0, 0);
      sides[2].scale.set(w, 0.8, 2 * az - w);
      sides[3].scale.set(w, 0.8, 2 * az - w);
    });
  }

  private updateStreams(fr: Frame): void {
    while (this.streams.length < fr.streams.length) {
      const m = new THREE.Mesh(unitCylinder, new THREE.MeshBasicMaterial({ transparent: true }));
      this.scene.add(m);
      this.streams.push(m);
    }
    this.streams.forEach((m, i) => {
      const s = fr.streams[i];
      m.visible = !!s;
      if (!s) return;
      const rgb = fluidRGB(s.fluid);
      if (!rgb) {
        m.visible = false;
        return;
      }
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      mat.opacity = fluidAlpha(s.fluid);
      const r = (STREAM_WIDTH * Math.sqrt(s.flow)) / 2;
      const len = Math.max(0.1, s.from.y - s.toY);
      m.position.set(s.from.x, s.from.y - len / 2, s.from.z);
      m.scale.set(r, len, r);
    });
    while (this.drops.length < fr.drops.length) {
      const m = new THREE.Mesh(unitSphere, new THREE.MeshBasicMaterial({ transparent: true }));
      this.scene.add(m);
      this.drops.push(m);
    }
    this.drops.forEach((m, i) => {
      const d = fr.drops[i];
      const rgb = d && d.v.N > 0 ? fluidRGB(d.v) : null;
      m.visible = !!rgb;
      if (!rgb) return;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      mat.opacity = fluidAlpha(d.v);
      const r = DROP_R * Math.cbrt(d.v.N / DROP_R_ATOMS);
      // a hanging drop swells from the outlet's tip; a falling one is centered where it is
      m.position.set(d.at.x, d.hanging ? d.at.y - r : d.at.y, d.at.z);
      m.scale.setScalar(r);
    });
  }

  /**
   * What's under the crosshair (or under (ndcX, ndcY)), within `reach`, skipping anything belonging to `skip`;
   * with where it was hit.
   */
  pick(reach: number, skip: object | null, ndcX = 0, ndcY = 0): (Pick & { point: Vec3; distance: number }) | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    this.raycaster.far = reach;
    const hits = this.raycaster
      .intersectObjects([...this.pickables.keys()], false)
      .map((h) => ({ h, p: this.pickables.get(h.object)! }))
      .filter(({ p }) => p && !(skip && Object.values(p).includes(skip)));
    if (!hits.length) return null;
    // a tool's hull is hit before its parts: take the part the ray goes on to hit just behind, if there is one
    let best = hits[0];
    if (best.p.kind === 'tool' && best.p.part === 'body') {
      const t = best.p.t;
      const part = hits.find(({ h, p }) => p.kind === 'tool' && p.t === t && p.part !== 'body' && h.distance - best.h.distance < 60);
      if (part) best = part;
    }
    const { point, distance } = best.h;
    return { ...best.p, point: { x: point.x, y: point.y, z: point.z }, distance };
  }

  /** Where a point in the room is on the canvas, in CSS pixels; null if it's behind the player. */
  project(p: Vec3, w: number, h: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  /** A ray from the eye through (ndcX, ndcY). */
  ray(ndcX: number, ndcY: number): { o: Vec3; d: Vec3 } {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    return { o: { x: o.x, y: o.y, z: o.z }, d: { x: d.x, y: d.y, z: d.z } };
  }

  /** A point in the room relative to the player's head: x right, y up, z behind. */
  toHead(p: Vec3): Vec3 {
    const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(this.camera.matrixWorldInverse);
    return { x: v.x, y: v.y, z: v.z };
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

