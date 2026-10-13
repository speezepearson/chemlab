import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { temperature, type Fluid } from '../chem/reactions';
import { LOOK, coronaAlpha, coronaRadius, glowFalloff, haloAlpha, haloRadius } from './appearance';
import {
  NOZZLE_H, STAND_BASE, STAND_ROD, TOOL_DEPTH, lx, onTool, openingOf, tankNoteY, tankRect, valveLocal, valveZ, type Stand,
} from './bodies';
import { TARGET } from '../chem/species';
import { CAP, FLASK_L, GOAL_L, GOAL_TARGET, TRACE } from './config';
import { Vessel, fluidAlpha, fluidRGB, glowColor, volume, type Flask } from './flask';
import { FLASK_H, FLASK_OUTLINE, fillLevel } from './flaskShape';
import { SCALE_SHAPE, type Scale } from './scale';
import { COUNTERS, LIFT, PAPER_Z, ROOM, groundAt, toWorld, type Vec3 } from './space';
import { PORT_FRAC, PORT_WALL, porthole, type Porthole } from './porthole';
import { AIRLOCK, POD } from './airlock';
import { notice } from '../intro/notice';
import { STATION_POSE } from './presets';
import { boxUV, planeUV, surfaceMat, whenSurfaced } from './textures';
import { PAPER_HANDLE, PAPER_HEADER, PAPER_TEXT, type Paper } from './paper';
import {
  ANALYZER, INSTRUMENT, SPECTROSCOPE, spectroscopeAt, HEATER, HEATER_BOX, HEATER_CELLS, HEATER_TUBE, HELIX, METER_BODY, METER_DIGITS, RECEPTACLE_LAMPS, REFERENCE_CAP,
  FUNNEL_TIP, INLINE_TOOLS, SORTER_CHUTE, STATION, SUMP_TIP, gaugeSegments, TANK_H, chuteY, levelIn, meterText, tankPieces, tankX,
  type Hose, type Piece, type Tool,
} from './tools';

/** What the crosshair is on. */
export type Pick =
  | { kind: 'flask'; f: Flask }
  | { kind: 'tool'; t: Tool; part: 'body' | 'tank' | 'valve' | 'button' | 'spout'; k: number }
  | { kind: 'scale'; sc: Scale; part: 'body' | 'tare' }
  /** A hose's nozzle. */
  | { kind: 'hose'; h: Hose }
  /** A faucet: its spout, or the pipe down to it, if `spout`; else its knob or the pipe from the wall. */
  | { kind: 'faucet'; i: number; spout?: boolean }
  /** The button under the beacon that silences the alarms. */
  | { kind: 'alarm' }
  /** The button by the porthole that shuts its blinds, or opens them. */
  | { kind: 'blinds' }
  /** The OK on the message inside the cryopod. */
  | { kind: 'wake' };

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
  /** Each hose, from the spout or faucet it's pulled out of, with what's running through it. */
  hoses: readonly { h: Hose; from: Vec3; fluid: Fluid | null }[];
  faucets: readonly FaucetSpot[];
  streams: readonly { from: Vec3; toY: number; fluid: Fluid; flow: number }[];
  /**
   * Streams for lining things up: solid gray where fluid would land in a mouth, faint gray where it would just miss
   * one, green for what will snap together when what's held is let go; each with that mouth, whose rim is outlined to
   * match.
   */
  guides: readonly { from: Vec3; toY: number; look: GuideLook; mouth: Vec3 & { hx: number; hz: number; yaw: number } }[];
  /**
   * Where what's held would come to rest if let go, outlined where it'd stand (its footprint, or its stands' bases):
   * pale if it can be set down there, red if it can't.
   */
  footprints: readonly (Vec3 & { hx: number; hz: number; yaw: number; ok: boolean })[];
  /** Every clamp stand, each with what it holds up, to grab that by it. */
  stands: readonly { s: Stand; of: Pick }[];
  drops: readonly { at: Vec3; v: Vessel; hanging: boolean }[];
  /** The scale whose tare key is held down. */
  tarePress: Scale | null;
  /** The key or button under the crosshair, to light it. */
  hot: Pick | null;
  /** Real seconds since the last frame, for the beacon. */
  dt: number;
  /** Sim seconds the lab has run, for what blinks on sim time (the station's gauge). */
  clock: number;
  /** Each bond's energy, in BOND_KEYS order, for the spectroscope's graph. */
  energies: readonly number[];
  /** Whether the alarms are silenced, which the button under the beacon shows. */
  alarmsOff: boolean;
  /** Whether the porthole's blinds are shut, leaving it solid black. */
  blindsShut: boolean;
  airlock: AirlockLook;
  /** How far the ship has turned, in radians, which turns the stars about the room's front-to-back axis. */
  spin: number;
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

export type GuideLook = 'faint' | 'solid' | 'snap';
/**
 * How each look of guide is drawn: the color and opacity of its stream, and of its rim; and the same for the outline
 * of where what's held will stand, `place`, or can't, `bad` (see Frame.footprints), which have no stream.
 */
const GUIDE_LOOKS: Record<GuideLook | 'place' | 'bad', { color: number; stream: number; edge: number; rim: number }> = {
  faint: { color: 0xb4bcb8, stream: 0.18, edge: 0xdfe6e2, rim: 0.4 },
  solid: { color: 0xb4bcb8, stream: 0.6, edge: 0xdfe6e2, rim: 0.85 },
  snap: { color: 0x7fd4ad, stream: 0.8, edge: 0x7fd4ad, rim: 0.95 },
  place: { color: 0, stream: 0, edge: 0xe8eeea, rim: 0.75 },
  bad: { color: 0, stream: 0, edge: 0xe0604c, rim: 0.85 },
};
/** Which look wins where guides of several looks end at the same mouth. */
const LOOK_RANK: Record<GuideLook | 'place' | 'bad', number> = { faint: 0, solid: 1, snap: 2, place: 3, bad: 3 };

/** Width of a stream flowing one flask per second; it goes as the square root of the flow. */
const STREAM_WIDTH = 4.5;
/** Radius of a guide stream (see Frame.guides), about a slow stream's; and how wide the outline round its mouth is. */
const GUIDE_R = 1.6;
/** Marks only how near things are, for hiding guides behind glass (see View.renderGuides). */
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });

/** How long a guide's dashes are, and the gaps between them, in world units. */
const GUIDE_DASH = { on: 9, off: 7 };
/** The layer guides' streams are drawn on, apart from everything else (see View.render). */
const GUIDE_LAYER = 3;

/** Stripes for a guide's dashes, as an alpha map: on at the top of each repeat, off below. */
const dashTexture = (() => {
  const n = GUIDE_DASH.on + GUIDE_DASH.off;
  const data = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) data.fill(i >= GUIDE_DASH.off ? 255 : 0, 4 * i, 4 * i + 4);
  const t = new THREE.DataTexture(data, 1, n);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
})();
const RIM_W = 1.6;
/** Drawn radius of a DROP_R_ATOMS drop; it goes as the cube root of the drop's size. */
const DROP_R = 3;
const DROP_R_ATOMS = 1.5e6;
/** A CRT's phosphor green. */
const PHOSPHOR = '64, 255, 110';
/** The separator's splitter, below its valve, in local units (y down). */
const SEP_BODY = { x0: -210, x1: 210, y0: 100, y1: 112 };
/** Height of each line of a label, in world units. */
const LABEL_H = 10;
/** How far above a flask's mouth or a scale's platform its note sits, to the note's middle. */
const NOTE_Y = 13;

/* ---------------- materials ---------------- */

const glassMat = new THREE.MeshStandardMaterial({
  color: 0xd6ecf2, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, depthWrite: false, side: THREE.DoubleSide,
  envMapIntensity: 1.4, premultipliedAlpha: true,
  // a hair further off than it is, so where fluid lies right against it (a tank's floor), the fluid wins cleanly
  // rather than the two flickering pixel by pixel
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4,
});
// glass: what it reflects is added in full, however clear it is, and only what's behind it is dimmed by its opacity,
// so it glints and shows the room in it as real glass does, and more so edge on
glassMat.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( totalDiffuse * diffuseColor.a + totalSpecular + totalEmissiveRadiance, diffuseColor.a );')
    .replace('#include <premultiplied_alpha_fragment>', '');
};
glassMat.customProgramCacheKey = () => 'glass';
const edgeMat = new THREE.LineBasicMaterial({ color: 0xbfd4da, transparent: true, opacity: 0.3 });
// stainless pipework, dark anodized fittings, light powder-coated cabinets and black plastic levers, all of them
// reflecting the room (see View's environment)
const pipeMat = new THREE.MeshStandardMaterial({ color: 0xa4adac, metalness: 0.9, roughness: 0.28 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x30373a, metalness: 0.6, roughness: 0.42 });
const panelMat = new THREE.MeshPhysicalMaterial({ color: 0xc4cbc7, metalness: 0.1, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35 });
const leverMat = new THREE.MeshPhysicalMaterial({ color: 0x15191a, metalness: 0, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
const keyMats = {
  up: new THREE.MeshStandardMaterial({ color: 0xd8443b, roughness: 0.45 }),
  hot: new THREE.MeshStandardMaterial({ color: 0xf06358, roughness: 0.45, emissive: 0x401010 }),
  down: new THREE.MeshStandardMaterial({ color: 0x9c2d28, roughness: 0.6 }),
};
const hidden = new THREE.MeshBasicMaterial({ visible: false });
const faintMat = new THREE.MeshBasicMaterial({ color: 0xd6ecf2, transparent: true, opacity: 0.3, depthWrite: false });
const rodMat = new THREE.MeshStandardMaterial({ color: 0xc8cfcd, metalness: 1, roughness: 0.18 });
/** Polished chrome, for the faucets. */
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e7e8, metalness: 1, roughness: 0.08 });
/** The steel plate the cryostabilizer station's panes are set in, and the lines marked on it. */
const plateMat = new THREE.MeshStandardMaterial({ color: 0x6f7975, metalness: 0.5, roughness: 0.45 });
const autoflushMat = new THREE.MeshStandardMaterial({ color: 0xd8443b, roughness: 0.5 });
/** The rubber seam round the cryostabilizer station's block of the wall. */
const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1a1d1c, roughness: 0.95, metalness: 0 });
/** How wide the hazard tape round the station's block is, and how far apart its stripes repeat, in world units. */
const TAPE = { w: 10, period: 14 };

/**
 * Hazard tape: yellow and black diagonal stripes, as round the alarms' silence button, as a texture that tiles both
 * ways, one stripe of each per TAPE.period across, so laid on with texture coordinates in world units over
 * TAPE.period, its stripes run on unbroken round corners.
 */
const tapeTexture = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t) return t;
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
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / TAPE.period, 1 / TAPE.period);
    t.anisotropy = 4;
    return t;
  };
})();

/** The station's gauge's segments: lit green for what's held, red for what's wanted (flashing), and dark. */
const SEGMENT_COLORS = { held: 0x3cff6a, wanted: 0xff3a2e, off: 0x1d2a21 } as const;

/**
 * Text printed on a flat face, centered on (x, y) in a flat frame at depth z, `h` tall: pale paint, in capitals, as
 * signage is. Not a sprite: it lies on the face, and is seen from whatever angle the face is.
 */
function printed(parent: THREE.Object3D, text: string, x: number, y: number, z: number, h: number): THREE.Mesh {
  const ppu = 12;
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
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(c.width / ppu, c.height / ppu),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, depthWrite: false }),
  );
  m.position.copy(v3(x, y, z));
  parent.add(m);
  return m;
}

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

/** A box of material `mat` over x0..x1, y0..y1 (flat frame, y down), z0..z1, its edges rounded by `r` if given. */
function block(parent: THREE.Object3D, mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 0): THREE.Mesh {
  const [w, h, d] = [x1 - x0, y1 - y0, z1 - z0];
  const m = new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d), mat);
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
 * A composition analyzer's screen: a hexagon per molecule size (1, 2, 3 atoms), each cut into sextants by color (see
 * SEXTANT_ATOMS) that glow as bright as their share of what it's reading, and dark while it has nothing to read. No
 * words, no lines between the sextants: reading it is part of the game.
 */
function drawAnalysis(sc: Screen, t: Tool): void {
  const key = t.reading?.map((x) => x.toFixed(2)).join(',') ?? '';
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const { screen: s } = INSTRUMENT;
  const { hexes } = ANALYZER;
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
    if (t.reading)
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
 * A spectroscope's screen: a graph of the bonds that passed through it over the last sim second, by energy (see
 * spectroscopeAt), lnE across with its whole numbers marked, and f up, scaled to the tallest peak, with no numbers.
 */
function drawSpectroscope(sc: Screen, t: Tool, energies: readonly number[]): void {
  const key = `${t.bonds.map((c) => c.toPrecision(3)).join(',')}|${energies.join(',')}`;
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const s = INSTRUMENT.screen;
  const green = (a: number) => `rgba(${PHOSPHOR}, ${a})`;
  ctx.setTransform(ppu, 0, 0, ppu, -s.x0 * ppu, -s.y0 * ppu);
  ctx.fillStyle = '#040a06';
  ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  // the plot, inside a margin for the labels
  const p = { x0: s.x0 + 10, x1: s.x1 - 5, y0: s.y0 + 6, y1: s.y1 - 13 };
  const { lnE0, lnE1 } = SPECTROSCOPE;
  const X = (l: number) => p.x0 + ((l - lnE0) / (lnE1 - lnE0)) * (p.x1 - p.x0);
  const n = Math.round((p.x1 - p.x0) * ppu);
  const ys = Array.from({ length: n + 1 }, (_, i) => spectroscopeAt(lnE0 + (i / n) * (lnE1 - lnE0), t.bonds, energies));
  const top = Math.max(...ys);
  const Y = (v: number) => p.y1 - (top > 0 ? (0.9 * v) / top : 0) * (p.y1 - p.y0);
  ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = green(0.75);
  ctx.shadowBlur = 1.5 * ppu;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(p.x0, p.y0);
  ctx.lineTo(p.x0, p.y1);
  ctx.lineTo(p.x1, p.y1);
  ctx.stroke();
  ctx.font = '5px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let l = Math.ceil(lnE0); l <= lnE1; l++) {
    ctx.beginPath();
    ctx.moveTo(X(l), p.y1);
    ctx.lineTo(X(l), p.y1 + 1.5);
    ctx.stroke();
    ctx.fillText(String(l), X(l), p.y1 + 2.5);
  }
  ctx.textAlign = 'right';
  ctx.fillText('lnE', p.x1, p.y1 + 2.5);
  ctx.textAlign = 'center';
  ctx.fillText('f', (s.x0 + p.x0) / 2, p.y0);
  // the curve, glowing, over a faint fill
  ctx.beginPath();
  ctx.moveTo(p.x0, p.y1);
  ys.forEach((v, i) => ctx.lineTo(p.x0 + i / ppu, Y(v)));
  ctx.lineTo(p.x1, p.y1);
  ctx.fillStyle = green(0.12);
  ctx.fill();
  ctx.strokeStyle = ctx.shadowColor = green(0.95);
  ctx.lineWidth = 0.5;
  ctx.stroke();
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
const flaskGlassGeom = new THREE.LatheGeometry([new THREE.Vector2(0, -FLASK_H), ...FLASK_PROFILE, new THREE.Vector2(11, 0), new THREE.Vector2(12.5, 0.5)], 48);
const flaskFluidGeom = new THREE.LatheGeometry(
  [new THREE.Vector2(0, -FLASK_H + 0.6), ...FLASK_PROFILE.map((p) => new THREE.Vector2(p.x * 0.95, Math.max(p.y, -FLASK_H + 0.6))), new THREE.Vector2(10.4, -0.4), new THREE.Vector2(0, -0.4)],
  48,
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
  /** Everything but the root's placement. */
  private body = new THREE.Group();
  private art = new THREE.Group();
  private upright = new THREE.Group();
  /**
   * Each tank's fluid, and how high it stands in the room; `fit`, if given, sizes the fluid's solid to that height
   * itself, so it has a top, rather than leaving it to be cut off open there.
   */
  private fluids: { fm: FluidMesh; level: (v: Vessel) => number; fit?: (v: Vessel) => void }[] = [];
  private levers = new Map<number, THREE.Group>();
  private dial?: THREE.Group;
  private lids: THREE.Mesh[] = [];
  private labels: Label[] = [];
  private note: Label;
  private glows: Glow[] = [];
  private button?: THREE.Mesh;
  private screen?: Screen;
  /** What's running down an inline instrument's tube, shown as a thin thread of its color. */
  private thread?: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial };
  private helix?: { geom: THREE.TubeGeometry; colors: THREE.BufferAttribute; k: number }[];
  private films: THREE.Mesh[] = [];
  private filmMats: THREE.MeshBasicMaterial[] = [];
  private cells: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private wire?: THREE.MeshStandardMaterial;
  private lamps: THREE.MeshStandardMaterial[] = [];
  private verdict?: THREE.MeshStandardMaterial;
  /** How far forward the button's face is when it's out, in local units. */
  private buttonZ = 0;
  /** The cryostabilizer station's gauge's segments, bottom up. */
  private segments: THREE.MeshStandardMaterial[] = [];

  constructor(
    readonly t: Tool,
    scene: THREE.Object3D,
    pickables: Map<THREE.Object3D, Pick>,
  ) {
    const sh = t.shape;
    const { art, upright } = this;
    const D = TOOL_DEPTH[t.kind];
    const pick = (m: THREE.Object3D, part: 'body' | 'tank' | 'valve' | 'button' | 'spout', k = 0) => pickables.set(m, { kind: 'tool', t, part, k });
    /** Where something at local x stands, for what's kept upright. */
    const ux = (x: number) => lx(t, x);
    this.flipped = t.flipped;
    art.scale.x = t.flipped ? -1 : 1;
    this.body.add(art, upright);
    this.root.add(this.body);

    // drain pipes and spouts, from the bottom of the tanks (and their sumps)
    const TH = sh.tankH ?? TANK_H;
    const floor = TH + (sh.sump?.h ?? 0);
    if (sh.wall) this.buildStation(scene, pick);
    else if (t.kind === 'exchanger')
      sh.tanks.forEach((tk, k) => {
        pipes(art, [[tankX(tk), floor], [tankX(tk), HELIX.y - HELIX.r]]);
        pipes(art, [[sh.spouts[k], HELIX.y + HELIX.r], [sh.spouts[k], sh.spoutY - 4]]);
      });
    else if (t.kind === 'separator') {
      // the manifold: one pipe in, five out, with a divider between each two outlets, and a handle on its left end
      // (so it doesn't look the same flipped; it says nothing about which side gets what)
      pipes(art, [[0, floor], [0, SEP_BODY.y0]]);
      for (const x of sh.spouts) pipes(art, [[x, SEP_BODY.y1], [x, sh.spoutY - 4]]);
      block(art, panelMat, SEP_BODY.x0, SEP_BODY.x1, SEP_BODY.y0, SEP_BODY.y1, -10, 10, 2);
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
      // the funnel's stem down into the tube, and a pipe from the tube down through each tap, and from its last
      // stretch down into the last spout
      const { y, r } = HEATER_TUBE;
      pipes(art, [[tankX(sh.tanks[0]), TH], [tankX(sh.tanks[0]), y - r + 1]]);
      for (const x of sh.spouts) pipes(art, [[x, y + r - 1], [x, sh.spoutY - 4]]);
    } else if (INLINE_TOOLS.includes(t.kind)) {
      // straight down from the tube to its spout, with a branch into the cabinet; and the analyzer's out of the
      // cabinet's far side to its waste spout
      const { body: b, inY } = INSTRUMENT;
      pipes(art, [[0, TH], [0, sh.spoutY - 4]]);
      pipes(art, [[0, inY], [b.x0, inY]], 1.3);
      if (t.kind === 'analyzer') {
        const x = sh.spouts[1];
        pipes(art, [[b.x1, ANALYZER.wasteY], [x, ANALYZER.wasteY], [x, sh.spoutY - 4]]);
      }
    } else pipes(art, [[0, floor], [0, sh.spoutY - 4]]);
    sh.spouts.forEach((x, k) => pick(block(art, pipeMat, x - 4, x + 4, sh.spoutY - 6, sh.spoutY, -4, 4), 'spout', k));

    // tanks, with their fluid (the station's are built in buildStation)
    if (!sh.wall) t.tanks.forEach((_, k) => {
      const r = tankRect(t, k);
      const o = openingOf(t, k);
      const d = D.tank;
      const w = r.x1 - r.x0;
      const cx = (r.x0 + r.x1) / 2;
      let geoms: THREE.BufferGeometry[];
      const share = (v: Vessel) => Math.min(1, volume(v) / v.cap);
      // the fluid settles into the tank as it's drawn (see tankPieces), from its bottom up
      const pieces = tankPieces(sh, k, d);
      const bottom = r.y1 + (sh.cup || sh.funnel ? 0 : (sh.sump?.h ?? 0));
      const level = (v: Vessel) => onTool(t, 0, bottom - levelIn(pieces, share(v))).y;
      if (sh.cup) {
        openBox(art, r.x0, r.x1, r.y0, r.y1, d);
        glassFrom(art, frustum(cx, o.y, r.y0, 2 * sh.cup.w, 2 * sh.cup.w, w, d, true));
        geoms = [
          new THREE.BoxGeometry(w - 1, r.y1 - r.y0, d - 1).translate(cx, -(r.y0 + r.y1) / 2, 0),
          frustum(cx, o.y, r.y0, 2 * sh.cup.w - 1, 2 * sh.cup.w - 1, w - 1, d - 1, false),
        ];
        this.graduations(r, o, sh.cup, d, pieces);
      } else if (sh.funnel) {
        glassFrom(art, frustum(cx, r.y0, r.y1, w, d, FUNNEL_TIP, FUNNEL_TIP, true));
        geoms = [frustum(cx, r.y0 + 0.5, r.y1 - 0.5, w - 1.5, d - 1.5, FUNNEL_TIP - 1, FUNNEL_TIP - 1, false)];
      } else if (sh.round) {
        // an upright glass cylinder with a thin metal rim, over a round sump
        const rr = w / 2;
        const mid = -(r.y0 + r.y1) / 2;
        glassFrom(art, new THREE.CylinderGeometry(rr, rr, r.y1 - r.y0, 48, 1, true).translate(cx, mid, 0));
        art.add(new THREE.Mesh(new THREE.CircleGeometry(rr, 48).rotateX(Math.PI / 2).translate(cx, -r.y1, 0), glassMat));
        const rim = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.6, 0.8, 6, 48).rotateX(Math.PI / 2).translate(cx, 0, 0), pipeMat);
        art.add(rim);
        geoms = [new THREE.CylinderGeometry(rr - 0.5, rr - 0.5, r.y1 - r.y0 - 0.5, 48).translate(cx, mid - 0.25, 0)];
        const sump = sh.sump;
        if (sump) {
          const sm = -(r.y1 + sump.h / 2);
          glassFrom(art, new THREE.CylinderGeometry(sump.w / 2, SUMP_TIP / 2, sump.h, 24, 1, true).translate(cx, sm, 0));
          geoms.push(new THREE.CylinderGeometry(sump.w / 2 - 0.5, SUMP_TIP / 2 - 0.3, sump.h - 0.3, 24).translate(cx, sm, 0));
        }
        if (t.kind === 'tank') this.tankLines(r, bottom, d, pieces, rr);
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
          if (t.kind === 'tank') this.tankLines(r, bottom, d, pieces);
        }
      }
      const fm = new FluidMesh(geoms, art);
      for (const m of fm.meshes) pick(m, 'tank', k);
      this.fluids.push({ fm, level });
      // a lid, while nothing may get in
      const lid = block(art, pipeMat, r.x0 - 4, r.x1 + 4, -5, 0, -d / 2 - 3, d / 2 + 3);
      lid.visible = false;
      this.lids.push(lid);
      this.labels.push(new Label(upright, v3(ux(tankX(sh.tanks[k])), tankNoteY(t, k))));
      this.glows.push(new Glow(scene));
    });
    if (sh.label) {
      const s = textSprite(sh.label);
      s.position.copy(v3(ux(0), -21 + (11 * (sh.label.length - 1)) / 2 - 4));
      upright.add(s);
    }
    if (t.tanks.length > 1 && !sh.wall)
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
    if (INLINE_TOOLS.includes(t.kind)) {
      this.buildInstrument();
      this.buildThread(TH);
    }
    if (t.kind === 'heater') this.buildHeater();
    if (t.kind === 'meter') this.buildMeter();

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

  /** Ten marks up the left wall of a tank with a cup, at each tenth of its capacity as its fluid is shown (see levelIn). */
  private graduations(
    r: { x0: number; x1: number; y0: number; y1: number },
    o: { x0: number },
    cup: { w: number; h: number },
    d: number,
    pieces: Piece[],
  ): void {
    const tubeH = r.y1 - r.y0;
    for (let i = 1; i <= 10; i++) {
      const h = levelIn(pieces, i / 10);
      // up the cup, its walls lean out, and its front comes forward
      const f = Math.max(0, (h - tubeH) / cup.h);
      const x = r.x0 + f * (o.x0 - r.x0);
      const z = d / 2 + f * (cup.w - d / 2);
      const len = i % 5 === 0 ? 5 : 3;
      block(this.art, darkMat, x, x + len, r.y1 - h - 0.35, r.y1 - h + 0.35, z, z + 0.3).castShadow = false;
    }
  }

  /** Ten thin, faint lines across the big tank's front, one at each tenth of its capacity as its fluid is shown, the last at the brim. */
  private tankLines(r: { x0: number; x1: number }, bottom: number, d: number, pieces: Piece[], round?: number): void {
    for (let i = 1; i <= 10; i++) {
      const y = bottom - levelIn(pieces, i / 10);
      if (round) {
        // a ring round a round tank
        const ring = new THREE.Mesh(new THREE.TorusGeometry(round + 0.3, 0.3, 4, 64).rotateX(Math.PI / 2), faintMat);
        ring.position.set((r.x0 + r.x1) / 2, -y, 0);
        this.art.add(ring);
        continue;
      }
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

  /**
   * An inline instrument's cabinet, beside its tube, with an old green-on-black screen. The screen is kept upright, so
   * it reads the same way flipped or not.
   */
  private buildInstrument(): void {
    const { body: b, screen: s } = INSTRUMENT;
    const D = TOOL_DEPTH[this.t.kind].body;
    block(this.art, panelMat, b.x0, b.x1, b.y0, b.y1, -D / 2, D / 2, 3);
    block(this.art, darkMat, s.x0 - 1.5, s.x1 + 1.5, s.y0 - 1.5, s.y1 + 1.5, D / 2, D / 2 + 0.6);
    const [x0, x1] = [lx(this.t, s.x0), lx(this.t, s.x1)].sort((a, b) => a - b);
    this.screen = new Screen(this.upright, x0, x1, s.y0, s.y1, D / 2 + 0.7, 5);
  }

  /** A thin thread down the middle of an inline instrument's tube, `h` tall, in the color of what's running through it. */
  private buildThread(h: number): void {
    const mat = new THREE.MeshBasicMaterial();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, h, 8).translate(0, -h / 2, 0), mat);
    m.visible = false;
    this.art.add(m);
    this.thread = { m, mat };
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
    block(this.art, panelMat, B.x0, B.x1, B.y0, B.y1, -12, 12, 2.5);
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
    block(this.art, panelMat, b.x0, b.x1, b.y0, b.y1, -z, z, 3);
    block(this.art, darkMat, d.x0, d.x1, d.y0, d.y1, z, z + 0.5);
    this.screen = new Screen(this.art, d.x0, d.x1, d.y0, d.y1, z + 0.6, 6);
  }

  /**
   * The cryostabilizer station (see STATION): a steel plate, a block of the wall in a rubber seam, with a narrow glass
   * pane for each column, the column's fluid behind it filling it from the bottom as the column fills, and the column's
   * name printed above; a glass funnel low in front of the receptacle, whose stem runs down and back into a pump on the
   * plate; a red line across the receptacle's pane where it flushes itself; a waste nozzle under the tester, whose
   * valve has no handle, since only the station works it; a faucet under the reference (its lever is built with the
   * other valves); the gauge of LCD segments just right of the reference (see gaugeSegments); and between the tester
   * and the reference a panel with a row of lamps that blink with the tester's thinking, a verdict lamp, the button, and a
   * green-on-black screen showing the litres of cryostabilizer in the reference of the litres needed.
   */
  private buildStation(scene: THREE.Object3D, pick: (m: THREE.Object3D, part: 'body' | 'tank' | 'button', k?: number) => void): void {
    const { t, art, upright } = this;
    const sh = t.shape;
    const { paneW, paneH: H, out, plate, funnel: f, autoflush, block: bk, gauge: g, button: bt, lamps: lp, verdict: vd } = STATION;
    // the plate's face is flush with the wall, set into a hole in it (see buildRoom), and the columns are behind
    const face = -out;
    const wall = face - plate;
    // the plate: a block of the wall, lined up with its panels, with a slot for each pane
    const rect = (d: number) =>
      [(bk.x0 + bk.x1) / 2, -(bk.y0 + bk.y1) / 2, bk.x1 - bk.x0 + 2 * d, bk.y1 - bk.y0 + 2 * d] as const;
    const shape = rectPath(...rect(0), new THREE.Shape());
    for (const tk of sh.tanks) shape.holes.push(rectPath(tankX(tk), -H / 2, paneW, H));
    const pl = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: plate, bevelEnabled: false }), plateMat);
    pl.position.z = wall;
    pl.receiveShadow = true;
    art.add(pl);
    // one rubber seam all round its edge, its outside on the wall's panels' seams, as if the block could be pulled and
    // another put in its place (the bevel grows the outline by 1 and shrinks the hole by 1)
    const seam = rectPath(...rect(-1), new THREE.Shape());
    seam.holes.push(rectPath(...rect(-7)));
    const gasket = new THREE.Mesh(new THREE.ExtrudeGeometry(seam, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 1, bevelSegments: 2 }), rubberMat);
    gasket.position.z = face - 0.5;
    art.add(gasket);
    // and hazard tape on the wall round it, just outside the seam
    const band = rectPath(...rect(TAPE.w), new THREE.Shape());
    band.holes.push(rectPath(...rect(0)));
    // a shape's texture coordinates are its own x and y, in world units: the texture's repeat makes them stripes
    const tape = new THREE.Mesh(new THREE.ShapeGeometry(band), new THREE.MeshStandardMaterial({ map: tapeTexture(), roughness: 0.55 }));
    tape.position.z = face + 0.3;
    tape.receiveShadow = true;
    art.add(tape);
    sh.tanks.forEach((tk, k) => {
      const x = tankX(tk);
      // the column's back, its fluid, and the glass in front
      block(art, darkMat, x - paneW / 2, x + paneW / 2, 0, H, wall, wall + 0.5);
      // a box standing on the column's floor, as tall as the fluid stands, so it has a top surface; held a little off
      // the column's back and the pane, so where they'd meet they don't flicker into each other
      const fm = new FluidMesh([new THREE.BoxGeometry(paneW - 1, 1, plate - 4).translate(x, 0.5, wall + 1.5 + (plate - 4) / 2)], art);
      const [solid] = fm.meshes;
      solid.position.y = -H;
      pick(solid, 'tank', k);
      const height = (v: Vessel) => H * Math.min(1, volume(v) / v.cap);
      this.fluids.push({
        fm,
        // never cut off, above the column's top: it's already just as tall as the fluid
        level: () => onTool(t, 0, -1).y,
        fit: (v) => (solid.scale.y = Math.max(0.01, height(v))),
      });
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(paneW, H).translate(x, -H / 2, face - 0.5), glassMat);
      art.add(pane);
      pick(pane, 'tank', k);
      // no lids: the receptacle is open through its funnel, and the others are sealed
      const lid = new THREE.Mesh();
      lid.visible = false;
      this.lids.push(lid);
      if (tk.label) printed(art, tk.label.join(' '), x, STATION.labelY, face + 0.1, 11);
      this.labels.push(new Label(upright, v3(x, tankNoteY(t, k))));
      this.glows.push(new Glow(scene));
    });
    const mark = (x: number, share: number, mat: THREE.Material) =>
      (block(art, mat, x - paneW / 2 - 8, x + paneW / 2 + 8, H * (1 - share) - 0.7, H * (1 - share) + 0.7, face, face + 0.4).castShadow = false);
    mark(tankX(sh.tanks[0]), autoflush, autoflushMat);
    // the gauge beside the reference: an LCD stack of segments, as tall as the panes, on a dark strip
    block(art, darkMat, g.x0 - 2, g.x1 + 2, -2, H + 2, face, face + 1);
    const seg = H / g.segments;
    for (let i = 0; i < g.segments; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: SEGMENT_COLORS.off, roughness: 0.4 });
      block(art, mat, g.x0, g.x1, H - (i + 1) * seg + 1, H - i * seg - 1, face + 1, face + 1.4).castShadow = false;
      this.segments.push(mat);
    }
    // the funnel, over the cell in front of the wall, and its stem down and back into a pump on the plate just below
    // the receptacle's pane (so as not to hide what's at the bottom of it), which pumps whatever lands in it up into
    // the column
    const x0 = tankX(sh.tanks[0]);
    const pump = H + 14;
    glassFrom(art, frustum(x0, f.y, f.y + f.h, 2 * f.w, 2 * f.w, FUNNEL_TIP, FUNNEL_TIP, true));
    rod(art, glassMat, v3(x0, f.y + f.h, 0), v3(x0, pump, 0), FUNNEL_TIP / 2);
    rod(art, glassMat, v3(x0, pump, 0), v3(x0, pump, face), FUNNEL_TIP / 2);
    block(art, panelMat, x0 - 12, x0 + 12, pump - 10, pump + 10, face, face + 10);
    // the tester's waste nozzle and the reference's faucet: out from under their columns, and down
    for (const x of sh.spouts) {
      rod(art, pipeMat, v3(x, H + 10, face), v3(x, H + 10, 0), 2.5);
      pipes(art, [[x, H + 10], [x, sh.spoutY - 4]], 2.5);
    }
    const valve = new THREE.Mesh(unitCylinder, panelMat);
    valve.rotation.x = Math.PI / 2;
    valve.scale.set(4.5, 8, 4.5);
    valve.position.copy(v3(sh.spouts[0], sh.valveY, 0));
    art.add(valve);
    // the lamps, each in a dark bezel, in a column right of the tester, and the verdict lamp under them
    const lamp = (x: number, y: number, r: number) => {
      const bezel = new THREE.Mesh(unitCylinder, darkMat);
      bezel.rotation.x = Math.PI / 2;
      bezel.scale.set(r + 1.5, 1.2, r + 1.5);
      bezel.position.copy(v3(x, y, face + 0.6));
      const mat = new THREE.MeshStandardMaterial({ color: 0x5b665f });
      const m = new THREE.Mesh(unitSphere, mat);
      m.scale.setScalar(r);
      m.position.copy(v3(x, y, face + 0.6));
      art.add(bezel, m);
      return mat;
    };
    for (let i = 0; i < RECEPTACLE_LAMPS; i++) this.lamps.push(lamp(lp.x, lp.y0 + i * lp.dy, lp.r));
    this.verdict = lamp(vd.x, vd.y, vd.r);
    // the flush button: big, round and red, in a dark collar, between the receptacle and the tester
    const collar = new THREE.Mesh(unitCylinder, darkMat);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(bt.r + 4, 2, bt.r + 4);
    collar.position.copy(v3(bt.x, bt.y, face + 1));
    art.add(collar);
    this.buttonZ = face + 1;
    this.button = new THREE.Mesh(unitCylinder, keyMats.up);
    this.button.rotation.x = Math.PI / 2;
    this.button.scale.set(bt.r, 4, bt.r);
    this.button.position.copy(v3(bt.x, bt.y, face + 3));
    this.button.castShadow = true;
    art.add(this.button);
    pick(this.button, 'button');
    // the readout of the litres in the reference, under its label
    const sc = STATION.screen;
    block(art, darkMat, sc.x0 - 1.5, sc.x1 + 1.5, sc.y0 - 1.5, sc.y1 + 1.5, face, face + 0.5);
    this.screen = new Screen(art, sc.x0, sc.x1, sc.y0, sc.y1, face + 0.6, 8);
  }

  update(hot: Pick | null, clock: number, energies: readonly number[]): void {
    const { t } = this;
    this.root.position.set(t.pose.x, t.pose.y, t.pose.z);
    this.root.rotation.y = t.pose.yaw;
    this.body.updateMatrixWorld();
    t.tanks.forEach((v, k) => {
      const { fm, level, fit } = this.fluids[k];
      fm.update(v, level(v));
      fit?.(v);
      this.lids[k].visible = t.lidded;
      this.labels[k].set(v.label);
      const r = tankRect(t, k);
      // the station's columns are behind panes in the wall
      const c = onTool(t, tankX(t.shape.tanks[k]), (r.y0 + r.y1) / 2, t.shape.wall ? -STATION.out : 0);
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
    if (t.kind === 'analyzer' && this.screen) drawAnalysis(this.screen, t);
    if (t.kind === 'spectroscope' && this.screen) drawSpectroscope(this.screen, t, energies);
    if (this.thread) {
      const through = new Vessel(Infinity);
      for (const v of t.out) if (v) through.addFrom(v, volume(v));
      const rgb = through.N > 0 ? fluidRGB(through) : null;
      this.thread.m.visible = !!rgb;
      if (rgb) setRGB(this.thread.mat.color, rgb);
    }
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
    if (t.kind === 'receptacle') this.updateStation(clock);
    if (this.button) {
      const busy = !!t.cycle;
      const z = this.buttonZ || TOOL_DEPTH[t.kind].body / 2;
      const isHot = hot?.kind === 'tool' && hot.t === t && hot.part === 'button';
      this.button.material = busy ? keyMats.down : isHot ? keyMats.hot : keyMats.up;
      this.button.position.z = z + (busy ? 0.6 : 2);
    }
  }

  private updateStation(clock: number): void {
    const { t } = this;
    const c = t.cycle;
    // the gauge: the reference's target, against the goal; what's still wanted flashes, a second on and half off
    const blink = clock % 1.5 < 1;
    gaugeSegments(t.tanks[2].n[TARGET], GOAL_TARGET, REFERENCE_CAP).forEach((st, i) => {
      const lit = st === 'held' || (st === 'wanted' && blink);
      const color = lit ? SEGMENT_COLORS[st] : SEGMENT_COLORS.off;
      this.segments[i].color.set(color);
      this.segments[i].emissive.set(lit ? color : 0x000000);
    });
    // a lamp is lit for a moment after each beep that lights it
    this.lamps.forEach((mat, i) => {
      const lit = c?.phase === 'think' && t.beeps.some((bp) => bp.lamp === i && bp.t <= c.age && c.age - bp.t < 0.12);
      mat.color.set(lit ? LAMP_COLORS[i] : 0x5b665f);
      mat.emissive.set(lit ? LAMP_COLORS[i] : 0x000000);
    });
    const v = t.verdict === 'pass' ? 0x5cff7a : t.verdict === 'fail' ? 0xff4a3d : null;
    this.verdict!.color.set(v ?? 0x5b665f);
    this.verdict!.emissive.set(v ?? 0x000000);
    // the screen: the cryostabilizer in the reference / what's needed, in litres
    const s = this.screen!;
    const text = `${((t.tanks[2].n[TARGET] / CAP) * FLASK_L).toFixed(2)} L / ${GOAL_L.toFixed(2)} L`;
    if (s.key !== text) {
      s.key = text;
      const sc = STATION.screen;
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
    pickables.set(block(this.root, panelMat, body.x0, body.x1, 4, body.y1, -depth + 4, depth - 4, 2.5), { kind: 'scale', sc, part: 'body' });
    pickables.set(block(this.root, pipeMat, pl.x0, pl.x1, 0, 5, -depth, depth, 1.5), { kind: 'scale', sc, part: 'body' });
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

const nozzleGeom = new THREE.CylinderGeometry(4, 3, NOZZLE_H, 12).translate(0, NOZZLE_H / 2, 0);

/**
 * A hose pulled out of a spout or a faucet: a translucent tube drooping from the spout down to its nozzle, showing
 * what's running through it.
 */
class HoseView {
  private outlet = new THREE.Group();
  private tube: THREE.Mesh;
  private core: THREE.Mesh;
  private coreMat = new THREE.MeshBasicMaterial();
  private key = '';

  constructor(
    readonly h: Hose,
    scene: THREE.Object3D,
    pickables: Map<THREE.Object3D, Pick>,
  ) {
    const nozzle = new THREE.Mesh(nozzleGeom, pipeMat);
    nozzle.castShadow = true;
    this.outlet.add(nozzle);
    pickables.set(nozzle, { kind: 'hose', h });
    this.tube = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x7c8883, transparent: true, opacity: 0.45, roughness: 0.3, depthWrite: false }));
    this.core = new THREE.Mesh(new THREE.BufferGeometry(), this.coreMat);
    scene.add(this.outlet, this.tube, this.core);
  }

  update(from: Vec3, fluid: Fluid | null): void {
    const { h } = this;
    this.outlet.position.set(h.outlet.x, h.outlet.y, h.outlet.z);
    const key = [from.x, from.y, from.z, h.outlet.x, h.outlet.y, h.outlet.z].map((x) => x.toFixed(1)).join();
    if (key !== this.key) {
      this.key = key;
      // drooping below the spout, and coming down into the nozzle from above
      const a = new THREE.Vector3(from.x, from.y + 2, from.z);
      const b = new THREE.Vector3(h.outlet.x, h.outlet.y + NOZZLE_H, h.outlet.z);
      const droop = 70;
      const curve = new THREE.CubicBezierCurve3(a, a.clone().setY(a.y - droop), b.clone().setY(b.y + droop), b);
      this.tube.geometry.dispose();
      this.core.geometry.dispose();
      this.tube.geometry = new THREE.TubeGeometry(curve, 40, 3.5, 8);
      this.core.geometry = new THREE.TubeGeometry(curve, 40, 2, 6);
    }
    const rgb = fluid && fluid.N > 0 ? fluidRGB(fluid) : null;
    this.core.visible = !!rgb;
    if (rgb) this.coreMat.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  }

  dispose(): void {
    for (const o of [this.outlet, this.tube, this.core]) o.removeFromParent();
    this.tube.geometry.dispose();
    this.core.geometry.dispose();
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

/* ---------------- stands ---------------- */

/** A clamp stand (see Stand): a base plate, a steel rod up from it, and a clamp out to what it holds. */
class StandView {
  readonly group = new THREE.Group();
  readonly parts: THREE.Mesh[];
  private base: THREE.Mesh;
  private rod: THREE.Mesh;
  private boss: THREE.Mesh;
  private arm: THREE.Mesh;
  private jaw: THREE.Mesh;

  constructor(scene: THREE.Object3D) {
    const { hx, hz, h } = STAND_BASE;
    this.base = new THREE.Mesh(new RoundedBoxGeometry(2 * hx, h, 2 * hz, 3, Math.min(3, h / 2)), darkMat);
    this.rod = new THREE.Mesh(unitCylinder, rodMat);
    this.boss = new THREE.Mesh(new RoundedBoxGeometry(9, 12, 9, 2, 1.5), darkMat);
    this.arm = new THREE.Mesh(unitBox, rodMat);
    this.jaw = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 4), darkMat);
    this.parts = [this.base, this.rod, this.boss, this.arm, this.jaw];
    for (const m of this.parts) m.castShadow = m.receiveShadow = true;
    this.group.add(...this.parts);
    scene.add(this.group);
  }

  /** Stand it with its base on a surface `y` high: its rod always STAND_ROD tall, and its clamp wherever it holds. */
  update(s: Stand, y: number): void {
    const h = STAND_BASE.h;
    this.group.position.set(s.x, 0, s.z);
    this.group.rotation.y = s.yaw;
    this.base.position.y = y + h / 2;
    const top = y + STAND_ROD;
    this.rod.position.y = (y + h + top) / 2;
    this.rod.scale.set(2.4, top - y - h, 2.4);
    this.boss.position.y = s.clampY;
    // the clamp's arm reaches forward, along what it holds' own z, to it
    const len = Math.max(1, Math.hypot(s.to.x - s.x, s.to.z - s.z));
    this.arm.position.set(0, s.clampY, len / 2);
    this.arm.scale.set(2.6, 2.6, len);
    this.jaw.position.set(0, s.clampY, len);
  }
}

/* ---------------- the room ---------------- */

/** How thick the hull is round the porthole (see porthole for its size and shape). */
const PORT_DEPTH = 40;

/**
 * The stars, all round the ship, far enough off that they don't move as the player walks: seen only through the
 * porthole. Kept centered on the eye (see View.render), like a sky. Most are tiny and dim, fewer middling, and a few
 * bright, each a little warm or cool, never strongly colored.
 */
function starField(): THREE.Group {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // tints a star can lean toward: blue-white, white, yellow-white, orange-white
  const tints = [[0.8, 0.88, 1], [1, 1, 1], [1, 0.95, 0.82], [1, 0.86, 0.72]];
  const layer = (count: number, size: number, dim: number, bright: number) => {
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < count; i++) {
      // evenly over the sphere
      const y = 2 * rnd() - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y) * STAR_R;
      pos.push(r * Math.cos(a), y * STAR_R, r * Math.sin(a));
      // dimmer far more often than brighter
      const b = dim + (bright - dim) * rnd() ** 2.5;
      const t = tints[Math.floor(rnd() * tints.length)];
      const k = rnd() * 0.7;
      col.push(...t.map((c) => b * (1 - k + k * c)));
    }
    return new THREE.Points(
      new THREE.BufferGeometry()
        .setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        .setAttribute('color', new THREE.Float32BufferAttribute(col, 3)),
      new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true }),
    );
  };
  const sky = new THREE.Group();
  sky.add(layer(16000, 1, 0.12, 0.45), layer(3500, 1.4, 0.3, 0.75), layer(350, 2, 0.55, 1));
  sky.add(milkyWay(rnd));
  return sky;
}

/** How wide the Milky Way is, as the spread of its stars about its middle, in radians. */
const BAND_SPREAD = 0.13;

/**
 * The Milky Way: a band of countless faint stars, clumped along its length, over a soft glow with a darker lane of
 * dust down its middle, round the sky a little off level.
 */
function milkyWay(rnd: () => number): THREE.Group {
  // how bright the band is at a longitude: uneven, from a few waves of random phase
  const waves = [1, 2, 3, 5, 8].map((k) => ({ k, p: rnd() * Math.PI * 2, a: 1 / k }));
  const clump = (lon: number) => 0.5 + 0.5 * Math.sin(waves.reduce((t, w) => t + w.a * Math.sin(w.k * lon + w.p), 0) * 1.6);
  const band = new THREE.Group();
  // its stars, thickest along its middle
  const pos: number[] = [];
  const col: number[] = [];
  while (pos.length < 30000 * 3) {
    const lon = rnd() * Math.PI * 2;
    if (rnd() > 0.25 + 0.75 * clump(lon)) continue;
    const lat = BAND_SPREAD * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const r = Math.cos(lat) * STAR_R;
    pos.push(r * Math.cos(lon), Math.sin(lat) * STAR_R, r * Math.sin(lon));
    const b = 0.07 + 0.25 * rnd() ** 2;
    col.push(b, b * 0.97, b * (0.9 + 0.15 * rnd()));
  }
  band.add(
    new THREE.Points(
      new THREE.BufferGeometry()
        .setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
        .setAttribute('color', new THREE.Float32BufferAttribute(col, 3)),
      new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true }),
    ),
  );
  // its glow, painted round a sphere just inside the stars: longitude across, latitude down
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    // the canvas covers latitudes from −4 to 4 spreads
    const lat = ((y + 0.5) / c.height - 0.5) * 8 * BAND_SPREAD;
    for (let x = 0; x < c.width; x++) {
      const lon = ((x + 0.5) / c.width) * Math.PI * 2;
      const glow = Math.exp(-((lat / (1.3 * BAND_SPREAD)) ** 2)) * (0.35 + 0.65 * clump(lon));
      // the dust lane wanders a little off the middle
      const lane = 1 - 0.55 * Math.exp(-(((lat - 0.03 * Math.sin(3 * lon + 1)) / (0.25 * BAND_SPREAD)) ** 2)) * clump(lon + 1);
      const v = glow * lane;
      const i = (y * c.width + x) * 4;
      img.data[i] = 255 * v * 0.92;
      img.data[i + 1] = 255 * v * 0.9;
      img.data[i + 2] = 255 * v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const cover = 8 * BAND_SPREAD;
  const glow = new THREE.Mesh(
    // just the strip of sphere the canvas covers, either side of the band's middle
    new THREE.SphereGeometry(STAR_R * 1.01, 96, 16, 0, Math.PI * 2, Math.PI / 2 - cover / 2, cover),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
  );
  glow.renderOrder = -1;
  band.add(glow);
  // a little off level, rising toward the left wall, so it crosses the porthole as seen from the floor
  band.rotation.set(0.06, 0, -0.2);
  return band;
}
/** How far off the stars are drawn: inside the camera's reach, outside the room's. */
const STAR_R = 6000;

/**
 * A wall w long and as tall as the room, standing on its middle, facing +z; with a hole in it if `hole` is given, in
 * the wall's own units from its middle.
 */
function wallMesh(w: number, hole?: THREE.Path): THREE.Mesh {
  const H = ROOM.y1;
  let geom: THREE.BufferGeometry;
  if (hole) {
    const shape = new THREE.Shape().moveTo(-w / 2, -H / 2).lineTo(w / 2, -H / 2).lineTo(w / 2, H / 2).lineTo(-w / 2, H / 2).lineTo(-w / 2, -H / 2);
    shape.holes.push(hole);
    geom = new THREE.ShapeGeometry(shape, 24);
  } else geom = new THREE.PlaneGeometry(w, H, 1, 1);
  // three panels from floor to ceiling, from the wall's left end
  const m = new THREE.Mesh(planeUV(geom, 'walls', -w / 2, -H / 2), wallMat());
  m.receiveShadow = true;
  return m;
}

/** The walls' paneling, shared by every wall. */
const wallMat = (() => {
  let m: THREE.MeshStandardMaterial | null = null;
  return () => (m ??= surfaceMat('walls', { metalness: 0.15, normalScale: new THREE.Vector2(0.9, 0.9) }));
})();

/** A rectangle w by h centered on (x, y), as a path. */
function rectPath<P extends THREE.Path = THREE.Path>(x: number, y: number, w: number, h: number, path?: P): P {
  const p = path ?? (new THREE.Path() as P);
  p.moveTo(x - w / 2, y - h / 2);
  p.lineTo(x + w / 2, y - h / 2);
  p.lineTo(x + w / 2, y + h / 2);
  p.lineTo(x - w / 2, y + h / 2);
  p.lineTo(x - w / 2, y - h / 2);
  return p;
}

/** A rounded rectangle w by h, with corners of radius c, centered on (x, y), drawn into `path`. */
function roundRect<P extends THREE.Path>(path: P, x: number, y: number, w: number, h: number, c: number): P {
  const [hw, hh] = [w / 2, h / 2];
  const r = Math.max(0, Math.min(c, hw, hh));
  path.moveTo(x + hw, y - hh + r);
  path.lineTo(x + hw, y + hh - r);
  path.absarc(x + hw - r, y + hh - r, r, 0, Math.PI / 2, false);
  path.lineTo(x - hw + r, y + hh);
  path.absarc(x - hw + r, y + hh - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x - hw, y - hh + r);
  path.absarc(x - hw + r, y - hh + r, r, Math.PI, (3 * Math.PI) / 2, false);
  path.lineTo(x + hw - r, y - hh);
  path.absarc(x + hw - r, y - hh + r, r, (3 * Math.PI) / 2, Math.PI * 2, false);
  return path;
}

/** The porthole's outline grown by d all round, centered on (0, y). */
function portOutline<P extends THREE.Path>(path: P, p: Porthole, y: number, d: number): P {
  return roundRect(path, 0, y, p.w + 2 * d, p.h + 2 * d, p.c + d);
}

/**
 * The left wall, with a porthole through it onto the stars (see starField) taking up `frac` of it (see porthole): a
 * frame round it, and the hull's thickness behind.
 */
function buildPort(frac: number): THREE.Group {
  const H = ROOM.y1;
  const p = porthole(frac);
  const g = new THREE.Group();
  // turned to face in, the wall's own x runs toward −z
  g.position.set(ROOM.x0, 0, (ROOM.z0 + ROOM.z1) / 2);
  g.rotation.y = Math.PI / 2;
  const w = wallMesh(PORT_WALL.w, portOutline(new THREE.Path(), p, p.cy - H / 2, 0));
  w.position.y = H / 2;
  g.add(w);
  const band = (d0: number, d1: number, depth: number, z: number, mat: THREE.Material, bevel: boolean) => {
    const shape = portOutline(new THREE.Shape(), p, p.cy, d1);
    shape.holes.push(portOutline(new THREE.Path(), p, p.cy, d0));
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel,
      bevelThickness: 4,
      bevelSize: 4,
      bevelSegments: 2,
      curveSegments: 24,
    });
    const m = new THREE.Mesh(geom, mat);
    m.position.z = z;
    g.add(m);
  };
  band(-6, 10, 6, -3, darkMat, true);
  band(0, 4, PORT_DEPTH, -PORT_DEPTH - 1, new THREE.MeshStandardMaterial({ color: 0x2a302e, metalness: 0.5, roughness: 0.6 }), false);
  return g;
}

/** A ceiling fixture's diffuser: bright, with a row of louvers across it and a soft falloff to its edges. */
function diffuserTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 104;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 52, 10, 128, 52, 150);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#d9e4e0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 104);
  ctx.fillStyle = 'rgba(70, 82, 80, 0.55)';
  for (let x = 16; x < 256; x += 20) ctx.fillRect(x, 0, 3, 104);
  ctx.fillRect(0, 50, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A cabinet door's pull: a bar on two posts, standing out from a face at (x, y, z) whose outward normal is (nx, 0, nz). */
function pull(scene: THREE.Object3D, x: number, y: number, z: number, nx: number, nz: number): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = Math.atan2(nx, nz);
  const bar = new THREE.Mesh(unitCylinder, rodMat);
  bar.scale.set(2.6, 70, 2.6);
  bar.rotation.z = Math.PI / 2;
  bar.position.z = 9;
  g.add(bar);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(unitCylinder, rodMat);
    post.scale.set(2.2, 9, 2.2);
    post.rotation.x = Math.PI / 2;
    post.position.set(s * 28, 0, 4.5);
    g.add(post);
  }
  scene.add(g);
}

function buildRoom(scene: THREE.Scene): { beacon: THREE.PointLight; lamp: THREE.Mesh } {
  const W = ROOM.x1 - ROOM.x0;
  const Dp = ROOM.z1 - ROOM.z0;
  const H = ROOM.y1;
  const cx = (ROOM.x0 + ROOM.x1) / 2;
  const cz = (ROOM.z0 + ROOM.z1) / 2;
  // the deck's plates run from the room's back left corner
  const floor = new THREE.Mesh(planeUV(new THREE.PlaneGeometry(W, Dp), 'deck', -W / 2, -Dp / 2), surfaceMat('deck', { metalness: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  scene.add(floor);
  // lit from below by the fixtures' light coming back off everything, which nothing here models, so it glows a little
  const ceil = new THREE.Mesh(
    planeUV(new THREE.PlaneGeometry(W, Dp), 'ceiling', -W / 2, -Dp / 2),
    surfaceMat('ceiling', { emissive: 0x6c7472, glowMap: true, metalness: 0.2 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, H, cz);
  scene.add(ceil);
  const wall = (w: number, x: number, z: number, ry: number) => {
    const m = wallMesh(w);
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    scene.add(m);
  };
  wall(W, cx, ROOM.z0, 0);
  // the front wall has the airlock's doorway in it (see AirlockView); turned to face in, its own x runs toward −x
  const front = wallMesh(W, rectPath(cx - AIRLOCK.x, AIRLOCK.door.h / 2 - H / 2 + 0.25, AIRLOCK.door.w, AIRLOCK.door.h - 0.5));
  front.position.set(cx, H / 2, ROOM.z1);
  front.rotation.y = Math.PI;
  scene.add(front);
  // the left wall, with the porthole through it, is built apart (see buildPort)
  // the right wall, with a hole for the cryostabilizer station's block (see ToolView.buildStation); turned to face in,
  // its own x runs toward +z
  const { block: bk, out } = STATION;
  const [a, b] = [toWorld(STATION_POSE, { x: bk.x0, y: -bk.y1, z: -out }), toWorld(STATION_POSE, { x: bk.x1, y: -bk.y0, z: -out })];
  const right = wallMesh(Dp, rectPath((a.z + b.z) / 2 - cz, (a.y + b.y) / 2 - H / 2, Math.abs(b.z - a.z), b.y - a.y));
  right.position.set(ROOM.x1, H / 2, cz);
  right.rotation.y = -Math.PI / 2;
  scene.add(right);
  // ceiling light fixtures: a dark frame round a glowing diffuser behind louvers
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2c3231, metalness: 0.6, roughness: 0.45 });
  const diffuser = new THREE.MeshBasicMaterial({ map: diffuserTexture(), toneMapped: false });
  for (let x = ROOM.x0 + 300; x < ROOM.x1; x += 500)
    for (let z = 350; z < ROOM.z1; z += 600) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(240, 8, 110), frameMat);
      f.position.set(x, H - 4, z);
      scene.add(f);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(220, 90), diffuser);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, H - 8.5, z);
      scene.add(p);
    }
  // a dark rubber kick strip along the foot of every wall, but across the airlock's doorway
  const kickMat = new THREE.MeshStandardMaterial({ color: 0x1e2322, roughness: 0.8, metalness: 0.1 });
  const KICK = 48;
  const strip = (x0: number, x1: number, z0: number, z1: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, KICK, z1 - z0), kickMat);
    m.position.set((x0 + x1) / 2, KICK / 2, (z0 + z1) / 2);
    m.receiveShadow = true;
    scene.add(m);
  };
  const doorX = [AIRLOCK.x - AIRLOCK.door.w / 2, AIRLOCK.x + AIRLOCK.door.w / 2];
  strip(ROOM.x0, ROOM.x0 + 3, ROOM.z0, ROOM.z1);
  strip(ROOM.x1 - 3, ROOM.x1, ROOM.z0, ROOM.z1);
  strip(ROOM.x0, ROOM.x1, ROOM.z0, ROOM.z0 + 3);
  strip(ROOM.x0, doorX[0], ROOM.z1 - 3, ROOM.z1);
  strip(doorX[1], ROOM.x1, ROOM.z1 - 3, ROOM.z1);
  // the sink counters along the back wall and under the faucets, and the islands out in the room: whatever falls past
  // everything ends up on one of them, or on the floor
  const steel = surfaceMat('brushedSteel', { metalness: 0.85 });
  const doors = surfaceMat('cabinet', { metalness: 0.3 });
  const top = surfaceMat('epoxy', { metalness: 0.05 });
  const drain = surfaceMat('grate', { metalness: 0.7 });
  for (const c of COUNTERS) {
    const w = c.x1 - c.x0;
    const d = c.z1 - c.z0;
    const [x, z] = [(c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2];
    // a dark toe kick, set in under it
    const kick = new THREE.Mesh(new THREE.BoxGeometry(w - 60, KICK, d - 60), kickMat);
    kick.position.set(x, KICK / 2, z);
    scene.add(kick);
    // a cabinet, set in a little at the foot, under a dark epoxy top (the islands) or a steel one with a drain grate
    // in it (the sink counters)
    const th = c.island ? 24 : 30;
    // the sink counters run into the walls, so only their fronts need setting in
    const inset = c.island ? 12 : 6;
    const [bw, bd, bh] = [w - 2 * inset, d - 2 * inset, LIFT - th - KICK];
    // a whole number of doors along each face, from the kick to the top
    const [nx, nz] = [Math.max(1, Math.round(bw / 250)), Math.max(1, Math.round(bd / 250))];
    const body = new THREE.Mesh(boxUV(new THREE.BoxGeometry(bw, bh, bd), 'cabinet', { x: bw / nx, y: bh, z: bd / nz }), doors);
    body.position.set(x, KICK + bh / 2, z);
    const slab = c.island
      ? new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, th, d), 'epoxy'), top)
      : new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, th, d), 'brushedSteel'), steel);
    slab.position.set(x, LIFT - th / 2, z);
    for (const m of [body, slab]) {
      m.receiveShadow = m.castShadow = true;
      scene.add(m);
    }
    // a pull near the top of each door, on every side that's out in the room
    const hy = KICK + bh - 34;
    const faces: [number, number][] = c.island ? [[0, -1], [0, 1], [-1, 0], [1, 0]] : c.z0 === ROOM.z0 && c.x1 < ROOM.x1 ? [[0, 1]] : [[-1, 0]];
    for (const [fx, fz] of faces) {
      if (fz) for (let i = 0; i < nx; i++) pull(scene, x - bw / 2 + (i + 0.5) * (bw / nx), hy, z + fz * (bd / 2), 0, fz);
      else for (let i = 0; i < nz; i++) pull(scene, x + fx * (bw / 2), hy, z - bd / 2 + (i + 0.5) * (bd / nz), fx, 0);
    }
    if (c.island) continue;
    const g = new THREE.Mesh(planeUV(new THREE.PlaneGeometry(w - 16, d - 16), 'grate', 0, 0), drain);
    g.rotation.x = -Math.PI / 2;
    g.position.set(x, LIFT + 0.5, z);
    g.receiveShadow = true;
    scene.add(g);
  }
  // an emergency beacon over the door, turning slowly
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 10), new THREE.MeshStandardMaterial({ color: 0x5a1010, emissive: 0xff2010, emissiveIntensity: 0.6 }));
  lamp.position.set(cx, H - 120, ROOM.z1 - 16);
  scene.add(lamp);
  const beacon = new THREE.PointLight(0xff2a14, 0, 2600, 1.4);
  beacon.position.copy(lamp.position).add(new THREE.Vector3(0, 0, -30));
  scene.add(beacon);
  return { beacon, lamp };
}

/** How far in front of the player's eyes, in the pod, the message projected on its front is, and how wide. */
const MESSAGE_AT = 44;
const MESSAGE_W = 58;
/** The message's canvas: how wide, its margins, and how far its OK button is from its bottom right. */
const MSG_PX = 1280;
const MSG_PAD = 44;
const OK_PX = { w: 170, h: 64 };

/** Text wrapped to fit `w` pixels in the canvas's current font, by words; explicit newlines and indents kept. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, w: number): string[] {
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
function messageCanvas(): HTMLCanvasElement {
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
  for (const b of notice()) {
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

/** The OK button's face, lit brighter when the crosshair is on it. */
function okTexture(hot: boolean): THREE.CanvasTexture {
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** How the airlock looks just now (see AirlockView.update). */
export interface AirlockLook {
  /** How far open the doors are, 0 to 1. */
  door: number;
  /** How far up the pod's front has slid, 0 (shut) to 1. */
  front: number;
  /** How far the room's lights are shut out by the pod, 1 while it's shut: only its emergency lights show inside. */
  dark: number;
  /** Whether the message shows on the inside of its front, with its OK button. */
  message: boolean;
  /** Whether the crosshair is on the OK button. */
  okHot: boolean;
}

/**
 * The airlock (see airlock.ts): its chamber behind the front wall, the doorway's sides, the two doors that slide
 * apart into the wall, and the standing cryopod at the back, with the message projected inside its front, in front of the face of
 * whoever's in it. The doorway itself is a hole in the room's front wall (see buildRoom).
 */
class AirlockView {
  private doors: THREE.Mesh[] = [];
  private front = new THREE.Group();
  private message: THREE.Mesh;
  private ok: THREE.Mesh;
  private okTex = [okTexture(false), okTexture(true)];
  private last: AirlockLook | null = null;

  constructor(scene: THREE.Scene, pickables: Map<THREE.Object3D, Pick>, eye: number) {
    const { x, w, d, h, wall, door } = AIRLOCK;
    const z1 = ROOM.z1;
    const g = new THREE.Group();
    const panel = surfaceMat('walls', { tint: 0xc4cac8, metalness: 0.15 });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    // the chamber, seen from inside, paneled like the lab and on the same deck; its front is the wall with the
    // doorway, below
    const [walls, floor] = [surfaceMat('walls', { tint: 0xc4cac8, metalness: 0.15, side: THREE.BackSide }), surfaceMat('deck', { metalness: 0.55, side: THREE.BackSide })];
    const room = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), 'walls', { z: 440 }), [walls, walls, walls, floor, walls, hidden]);
    room.position.set(x, h / 2, z1 + wall + d / 2);
    g.add(room);
    const shape = rectPath(0, h / 2, w, h, new THREE.Shape());
    shape.holes.push(rectPath(0, door.h / 2 + 0.25, door.w, door.h - 0.5));
    const inside = new THREE.Mesh(planeUV(new THREE.ShapeGeometry(shape), 'walls', -w / 2, 0), panel);
    inside.position.set(x, 0, z1 + wall);
    g.add(inside);
    // the doorway's sides and top, through the wall's thickness: planes only, with nothing lying in either wall's face
    const jambMat = darkMat.clone();
    jambMat.side = THREE.DoubleSide;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wall, door.h).rotateY(Math.PI / 2), jambMat);
      m.position.set(x + (side * door.w) / 2, door.h / 2, z1 + wall / 2);
      g.add(m);
    }
    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(door.w, wall).rotateX(Math.PI / 2), jambMat);
    lintel.position.set(x, door.h, z1 + wall / 2);
    g.add(lintel);
    // the doors, each half the doorway, sliding apart into the wall
    const doorMat = new THREE.MeshPhysicalMaterial({ color: 0xa3ada9, roughness: 0.45, metalness: 0.35, clearcoat: 0.3 });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(door.w / 2, door.h, 12), doorMat);
      m.position.set(x, door.h / 2, z1 + wall / 2);
      m.userData.side = side;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(door.w / 2 - 2, 26, 14), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6 }));
      stripe.position.y = -door.h / 2 + 120;
      m.add(stripe);
      this.doors.push(m);
      g.add(m);
    }
    // the pod: a plinth, and a metal shell whose front half slides up into the ceiling
    const shell = new THREE.MeshStandardMaterial({ color: 0x8c9692, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide });
    const pod = new THREE.Group();
    pod.position.set(POD.x, 0, POD.z);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(POD.r + 10, POD.r + 14, POD.base, 40), darkMat);
    plinth.position.y = POD.base / 2;
    pod.add(plinth);
    const body = POD.top - POD.base;
    // three.js puts theta 0 at +z: the back half faces +z, the front half (toward the room, −z) the other way
    const half = (front: boolean, mat: THREE.Material, r: number) => {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, body, 40, 1, true, front ? Math.PI / 2 : -Math.PI / 2, Math.PI), mat);
      cyl.position.y = POD.base + body / 2;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 12, front ? Math.PI : 0, Math.PI, 0, Math.PI / 2), mat);
      dome.position.y = POD.top;
      return [cyl, dome];
    };
    for (const m of half(false, shell, POD.r + 2)) pod.add(m);
    const band = new THREE.Mesh(new THREE.TorusGeometry(POD.r + 3, 3, 8, 48).rotateX(Math.PI / 2), darkMat);
    band.position.y = POD.top;
    pod.add(band);
    for (const m of half(true, shell, POD.r)) {
      m.castShadow = true;
      this.front.add(m);
    }
    pod.add(this.front);
    // two dim emergency lights on the inside of the front, either side of the message, the only light while it's
    // shut (see View.render); they go up with it
    for (const side of [-1, 1]) {
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(2.5, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0x5a3010, emissive: 0xff9a3c, emissiveIntensity: 0.8 }),
      );
      const at = new THREE.Vector3(side * 42, eye + 20, -Math.sqrt(POD.r * POD.r - 42 * 42) + 2);
      bulb.position.copy(at);
      this.front.add(bulb);
      const light = new THREE.PointLight(0xff9a3c, 300, 260, 2);
      light.position.copy(at).add(new THREE.Vector3(-side * 5, 0, 5));
      this.front.add(light);
    }
    // the message, projected on the inside of the front, in front of the face, facing in
    const tex = new THREE.CanvasTexture(messageCanvas());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const img = tex.image as HTMLCanvasElement;
    const mh = (MESSAGE_W * img.height) / img.width;
    const msgMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    this.message = new THREE.Mesh(new THREE.PlaneGeometry(MESSAGE_W, mh), msgMat);
    // it hangs a little low, so the eyes start on its heading and look down to OK
    const cy = eye + 27 - mh / 2;
    this.message.position.set(0, cy, -MESSAGE_AT);
    pod.add(this.message);
    const unit = MESSAGE_W / MSG_PX;
    this.ok = new THREE.Mesh(
      new THREE.PlaneGeometry(OK_PX.w * unit, OK_PX.h * unit),
      new THREE.MeshBasicMaterial({ map: this.okTex[0], transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.ok.position.set(MESSAGE_W / 2 - (MSG_PAD + OK_PX.w / 2) * unit, cy - mh / 2 + (MSG_PAD + OK_PX.h / 2) * unit, -MESSAGE_AT + 0.3);
    pod.add(this.ok);
    pickables.set(this.ok, { kind: 'wake' });
    g.add(pod);
    scene.add(g);
  }

  update(a: AirlockLook): void {
    const l = this.last;
    if (l && l.door === a.door && l.front === a.front && l.dark === a.dark && l.message === a.message && l.okHot === a.okHot) return;
    this.last = { ...a };
    const { x, door } = AIRLOCK;
    for (const m of this.doors) m.position.x = x + m.userData.side * (door.w / 4 + a.door * (door.w / 2 + 6));
    // up past the ceiling, out of sight
    this.front.position.y = a.front * (AIRLOCK.h + 40);
    // off its layer it's neither drawn nor hit by the crosshair
    for (const m of [this.message, this.ok]) m.layers.set(a.message ? 0 : 1);
    (this.ok.material as THREE.MeshBasicMaterial).map = this.okTex[a.okHot ? 1 : 0];
  }
}

/** How high the middle of the alarms' silence button's plate is: about chest height. */
const ALARM_Y = 480;

/** The face of the silence button's plate: hazard stripes round the edge, and what it's for. */
function alarmPlateTexture(): THREE.CanvasTexture {
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The alarms' silence button, on the wall under the beacon at chest height: a plate with a big red button, which
 * stays pushed in while the alarms are silenced, and a lamp over it that glows amber while they are.
 */
class AlarmButton {
  private button: THREE.Mesh;
  private lamp: THREE.MeshStandardMaterial;
  private off: boolean | null = null;

  constructor(scene: THREE.Scene, pickables: Map<THREE.Object3D, Pick>) {
    const g = new THREE.Group();
    // on the front wall, facing into the room
    g.position.set((ROOM.x0 + ROOM.x1) / 2, ALARM_Y, ROOM.z1);
    g.rotation.y = Math.PI;
    const face = new THREE.MeshStandardMaterial({ map: alarmPlateTexture(), roughness: 0.6, metalness: 0.2 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(110, 150, 8).translate(0, 0, 4), [darkMat, darkMat, darkMat, darkMat, face, darkMat]);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(27, 29, 6, 32).rotateX(Math.PI / 2).translate(0, 0, 11), darkMat);
    this.button = new THREE.Mesh(
      new THREE.CylinderGeometry(21, 22, 14, 32).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xb3221a, roughness: 0.35, metalness: 0.05 }),
    );
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x6b5520, emissive: 0xffa21a, emissiveIntensity: 0 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 10), this.lamp);
    lamp.position.set(0, 34, 9);
    for (const m of [plate, collar, this.button, lamp]) {
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      pickables.set(m, { kind: 'alarm' });
    }
    scene.add(g);
  }

  update(off: boolean): void {
    if (off === this.off) return;
    this.off = off;
    this.button.position.z = off ? 12 : 18;
    this.lamp.emissiveIntensity = off ? 1.6 : 0;
  }
}

/** The blinds button's face: a dark plate with BLINDS under where the button goes, small and muted. */
function blindsPlateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3b4240';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#9aa4a0';
  ctx.font = '500 17px "Schibsted Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BLINDS', c.width / 2, c.height - 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The porthole's blinds: a plain little button on the wall beside it, at chest height, which stays pushed in while
 * they're shut; and the blinds themselves, solid black across the porthole, just behind its frame.
 */
class BlindsButton {
  private button: THREE.Mesh;
  private blind: THREE.Mesh;
  private shut: boolean | null = null;

  constructor(scene: THREE.Scene, pickables: Map<THREE.Object3D, Pick>) {
    const p = porthole(PORT_FRAC);
    // in the porthole's frame (see buildPort): x along the wall toward −z, y up, z out into the room
    const g = new THREE.Group();
    g.position.set(ROOM.x0, 0, (ROOM.z0 + ROOM.z1) / 2);
    g.rotation.y = Math.PI / 2;
    this.blind = new THREE.Mesh(new THREE.ShapeGeometry(portOutline(new THREE.Shape(), p, p.cy, 2), 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.blind.position.z = -1.5;
    g.add(this.blind);
    // to the right of the porthole as you face it
    const at = new THREE.Group();
    at.position.set(p.w / 2 + 90, ALARM_Y, 0);
    const face = new THREE.MeshStandardMaterial({ map: blindsPlateTexture(), roughness: 0.7, metalness: 0.2 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(42, 56, 4).translate(0, 0, 2), [darkMat, darkMat, darkMat, darkMat, face, darkMat]);
    this.button = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8.5, 6, 24).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8a948f, roughness: 0.5, metalness: 0.3 }),
    );
    this.button.position.y = 6;
    for (const m of [plate, this.button]) {
      m.castShadow = m.receiveShadow = true;
      at.add(m);
      pickables.set(m, { kind: 'blinds' });
    }
    g.add(at);
    scene.add(g);
  }

  update(shut: boolean): void {
    if (shut === this.shut) return;
    this.shut = shut;
    this.blind.visible = shut;
    this.button.position.z = shut ? 5 : 7;
  }
}

/** The faucets: a manifold along a wall, and each faucet a pipe out over the counter, a knob of its color, and a spout. */
function buildFaucets(
  scene: THREE.Scene,
  faucets: readonly FaucetSpot[],
  pickables: Map<THREE.Object3D, Pick>,
): { mats: THREE.MeshPhysicalMaterial[]; notes: Label[] } {
  if (!faucets.length) return { mats: [], notes: [] };
  const g = new THREE.Group();
  const at = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
  const first = at(faucets[0].wall);
  const last = at(faucets[faucets.length - 1].wall);
  const along = last.clone().sub(first).normalize().multiplyScalar(60);
  rod(g, chromeMat, first.clone().sub(along), last.clone().add(along), 6);
  // the manifold's end caps, and brackets holding it to the wall
  const out = new THREE.Vector3(faucets[0].spout.x - faucets[0].wall.x, 0, faucets[0].spout.z - faucets[0].wall.z).normalize();
  for (const [end, s] of [[first, -1], [last, 1]] as const) {
    const cap = new THREE.Mesh(unitSphere, chromeMat);
    cap.position.copy(end).addScaledVector(along, s);
    cap.scale.setScalar(6);
    g.add(cap);
    const foot = end.clone().addScaledVector(along, s * 0.5);
    rod(g, darkMat, foot.clone().addScaledVector(out, -12), foot, 3);
    const plate = new THREE.Mesh(unitCylinder, darkMat);
    plate.position.copy(foot).addScaledVector(out, -12);
    plate.scale.set(12, 3, 12);
    plate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
    g.add(plate);
  }
  const notes: Label[] = [];
  const mats = faucets.map(({ wall, spout }, i) => {
    const elbow = new THREE.Vector3(spout.x, wall.y, spout.z);
    pickables.set(rod(g, chromeMat, at(wall), elbow, 3.5), { kind: 'faucet', i });
    pickables.set(rod(g, chromeMat, elbow, new THREE.Vector3(spout.x, spout.y + 6, spout.z), 3), { kind: 'faucet', i, spout: true });
    // a collar where it leaves the manifold
    const collar = new THREE.Mesh(unitCylinder, chromeMat);
    collar.position.copy(at(wall)).addScaledVector(out, 7);
    collar.scale.set(5, 6, 5);
    collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
    g.add(collar);
    pickables.set(collar, { kind: 'faucet', i });
    notes.push(new Label(g, elbow.clone().setY(elbow.y + 16 + LABEL_H / 2)));
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(5, 4, 7, 16), chromeMat);
    tip.position.set(spout.x, spout.y + 3.5, spout.z);
    g.add(tip);
    // a glossy knob in its fluid's color, on a chrome stem
    const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), mat);
    knob.position.copy(elbow);
    knob.castShadow = true;
    g.add(knob);
    pickables.set(knob, { kind: 'faucet', i });
    pickables.set(tip, { kind: 'faucet', i, spout: true });
    return mat;
  });
  scene.add(g);
  return { mats, notes };
}

/* ---------------- the view ---------------- */

/** Draws the lab with Three.js, from the player's eyes, and says what's under the crosshair. */
export class View {
  /** The field of view is 90°, top to bottom. */
  readonly camera = new THREE.PerspectiveCamera(90, 1, 2, 8000);
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
  private stands: StandView[] = [];
  private faucetMats: THREE.MeshStandardMaterial[] = [];
  private faucetNotes: Label[] = [];
  private streams: THREE.Mesh[] = [];
  private guides: THREE.Mesh[] = [];
  private rims: { g: THREE.Group; mat: THREE.MeshBasicMaterial; sides: THREE.Mesh[]; ring: THREE.Mesh }[] = [];
  private drops: THREE.Mesh[] = [];
  private beacon: { beacon: THREE.PointLight; lamp: THREE.Mesh };
  private alarmButton: AlarmButton;
  private blindsButton: BlindsButton;
  private airlock: AirlockView;
  /** The room's lights, and how bright each is, to be dimmed while the cryopod is shut (see AirlockLook.dark). */
  private roomLights: { light: THREE.Light; base: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private clock = 0;
  private stars = starField();

  /** `eye` is how high the player's eyes are standing, for the message inside the cryopod. */
  constructor(canvas: HTMLCanvasElement, faucets: readonly FaucetSpot[], eye: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color(0x010206);
    this.scene.add(this.stars);
    const sky = new THREE.HemisphereLight(0xe4eef0, 0x4a4440, 1.5);
    this.scene.add(sky);
    // the ceiling panels, as one light from overhead, so what hangs casts its shadow on the counter and floor
    const sun = new THREE.DirectionalLight(0xf4f8ff, 1.3);
    const [cx, cz] = [(ROOM.x0 + ROOM.x1) / 2, (ROOM.z0 + ROOM.z1) / 2];
    sun.position.set(cx - 50, ROOM.y1 + 1500, cz + 200);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    const half = Math.max(ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0) / 2 + 100;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 500;
    sc.far = 4500;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);
    this.roomLights = [sky, sun].map((light) => ({ light, base: light.intensity }));
    this.beacon = buildRoom(this.scene);
    this.scene.add(buildPort(PORT_FRAC));
    this.alarmButton = new AlarmButton(this.scene, this.pickables);
    this.blindsButton = new BlindsButton(this.scene, this.pickables);
    this.airlock = new AirlockView(this.scene, this.pickables, eye);
    // what metal and glass reflect: the room itself, seen from its middle at eye height, before anything's in it, and
    // again once its surfaces have their textures (see textures.ts)
    const reflect = () => {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const was = this.scene.environment;
      this.scene.environment = pmrem.fromScene(this.scene, 0.02, 10, 8000, { size: 256, position: new THREE.Vector3(cx, eye, cz) }).texture;
      was?.dispose();
      pmrem.dispose();
    };
    reflect();
    whenSurfaced(reflect);
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
    // the stars are too far off to move as the player does
    this.stars.position.copy(this.camera.position);
    this.camera.rotation.set(pitch, yaw, 0);
    this.camera.updateMatrixWorld();
  }

  render(fr: Frame): void {
    this.clock += fr.dt;
    const { scene, pickables } = this;
    this.look(fr.eye, fr.yaw, fr.pitch);
    this.stars.rotation.z = fr.spin;

    this.sync(this.flasks, fr.flasks, (f) => new FlaskView(f, scene, pickables));
    this.sync(this.tools, fr.tools, (t) => new ToolView(t, scene, pickables));
    this.sync(this.scales, fr.scales, (s) => new ScaleView(s, scene, pickables));
    this.sync(this.hoses, fr.hoses.map((x) => x.h), (h) => new HoseView(h, scene, pickables));
    for (const v of this.flasks.values()) v.update();
    // a tool flipped since it was built is built again
    for (const [t, v] of this.tools)
      if (v.flipped !== t.flipped) {
        v.dispose();
        for (const [o, p] of pickables) if (p.kind === 'tool' && p.t === t) pickables.delete(o);
        this.tools.set(t, new ToolView(t, scene, pickables));
      }
    for (const v of this.tools.values()) v.update(fr.hot, fr.clock, fr.energies);
    for (const v of this.scales.values()) v.update(fr.tarePress === v.sc, fr.hot);
    for (const { h, from, fluid } of fr.hoses) this.hoses.get(h)!.update(from, fluid);
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

    this.updateStands(fr);
    this.updateStreams(fr);
    this.updateGuides(fr);

    this.alarmButton.update(fr.alarmsOff);
    this.blindsButton.update(fr.blindsShut);
    this.airlock.update(fr.airlock);
    // the beacon turns slowly; real time, like the alarms it goes with
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 2.4);
    const lit = 1 - fr.airlock.dark;
    for (const { light, base } of this.roomLights) light.intensity = base * lit;
    scene.environmentIntensity = lit;
    this.beacon.beacon.intensity = 9000 * pulse * pulse * lit;
    (this.beacon.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 1.2 * pulse;

    this.renderer.render(scene, this.camera);
    this.renderGuides();
  }

  /**
   * The guides' streams, over the frame just drawn, hidden behind anything in front of them, glass included. Glass
   * and everything else see-through is drawn without marking how near it is, so first it's drawn again marking only
   * that (no color, no shadows), and then the guides, which are on a layer of their own.
   */
  private renderGuides(): void {
    if (!this.guides.some((m) => m.visible)) return;
    const { renderer, scene, camera } = this;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible || !(o instanceof THREE.Mesh || o instanceof THREE.Sprite || o instanceof THREE.Line || o instanceof THREE.Points)) return;
      // opaque things marked their depth already; sprites (labels) and lines don't hide anything
      const see = o instanceof THREE.Mesh && !Array.isArray(o.material) && o.material.transparent;
      if (!see) {
        o.visible = false;
        hidden.push(o);
      }
    });
    // a colored background would clear the frame on each draw, whatever autoClear says
    const bg = scene.background;
    scene.background = null;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = depthOnly;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    for (const o of hidden) o.visible = true;
    camera.layers.set(GUIDE_LAYER);
    renderer.render(scene, camera);
    camera.layers.set(0);
    renderer.shadowMap.autoUpdate = true;
    renderer.autoClear = true;
    scene.background = bg;
  }

  /** Every stand, its base on whatever's under it: a counter, or the floor under something held out over it. */
  private updateStands(fr: Frame): void {
    while (this.stands.length < fr.stands.length) this.stands.push(new StandView(this.scene));
    this.stands.forEach((v, i) => {
      const st = fr.stands[i];
      v.group.visible = !!st;
      for (const m of v.parts) {
        if (st) this.pickables.set(m, st.of);
        else this.pickables.delete(m);
      }
      if (st) v.update(st.s, groundAt(st.s.x, st.s.z));
    });
  }

  private updateGuides(fr: Frame): void {
    while (this.guides.length < fr.guides.length) {
      // each its own copy of the stripes, since each repeats them over its own length
      const mat = new THREE.MeshBasicMaterial({ color: 0xb4bcb8, transparent: true, depthWrite: false, alphaMap: dashTexture.clone() });
      const m = new THREE.Mesh(unitCylinder, mat);
      m.layers.set(GUIDE_LAYER);
      this.scene.add(m);
      this.guides.push(m);
    }
    this.guides.forEach((m, i) => {
      const g = fr.guides[i];
      m.visible = !!g;
      if (!g) return;
      const look = GUIDE_LOOKS[g.look];
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(look.color);
      mat.opacity = look.stream;
      const len = Math.max(0.1, g.from.y - g.toY);
      const r = g.look === 'faint' ? GUIDE_R * 0.75 : GUIDE_R;
      m.position.set(g.from.x, g.from.y - len / 2, g.from.z);
      m.scale.set(r, len, r);
      // dashes counted from the top, where it's from, so they stay put as its length changes
      const reps = len / (GUIDE_DASH.on + GUIDE_DASH.off);
      mat.alphaMap!.repeat.set(1, reps);
      mat.alphaMap!.offset.set(0, Math.ceil(reps) - reps);
    });
    // each mouth a guide ends at, outlined once, in the look of the strongest guide into it
    const mouths = new Map<string, Frame['guides'][number]['mouth'] & { look: keyof typeof GUIDE_LOOKS }>();
    for (const f of fr.footprints) mouths.set(`f${f.x},${f.y},${f.z}`, { ...f, look: f.ok ? 'place' : 'bad' });
    for (const g of fr.guides) {
      const m = g.mouth;
      const key = `${m.x},${m.y},${m.z}`;
      const was = mouths.get(key);
      mouths.set(key, { ...m, look: was && LOOK_RANK[was.look] > LOOK_RANK[g.look] ? was.look : g.look });
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
      mat.color.setHex(GUIDE_LOOKS[m.look].edge);
      mat.opacity = GUIDE_LOOKS[m.look].rim;
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

