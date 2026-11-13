import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Fluid } from '../chem/reactions';
import { OUTLINE } from './outline';
import { glowFalloff } from './appearance';
import {
  NOZZLE_H, STAND_BASE, STAND_ROD, TOOL_DEPTH, onTool, openingOf, tankNoteY, tankRect, valveLocal, valveZ, type Stand,
} from './bodies';
import { SPECIES, TARGET } from '../chem/species';
import { CAP, DELIVERY, FLASK_L, GOAL_L, GOAL_PURITY, GOAL_TARGET, TRACE } from './config';
import { Vessel, fluidAlpha, fluidRGB, volume, type Flask } from './flask';
import { FLASK_H, FLASK_OUTLINE, fillLevel } from './flaskShape';
import { SCALE_SHAPE, type Scale } from './scale';
import { COUNTERS, LIFT, ROOM, groundAt, toWorld, type Vec3 } from './space';
import { PORT_FRAC, PORT_WALL, porthole, type Porthole } from './porthole';
import { AIRLOCK, POD } from './airlock';
import { arrival, notice, type Block } from '../intro/notice';
import { STATION_POSE } from './presets';
import { boxUV, planeUV, surfaceMat, whenSurfaced } from './textures';
import {
  clockText, ANALYZER, analyzerSector, BOND_ENDS, bondPoint, SECTOR_ATOMS, INSTRUMENT, SPECTROSCOPE, spectroscopeAt, spectroscopeTop, spectroscopeUnit, spectroscopeY, HEATER, HEATER_BOX, HEATER_CELLS, HEATER_TUBE, HELIX, METER_BODY, METER_DIGITS, REFERENCE_CAP,
  DIVERTER_HOLD, FUNNEL_TIP, INLINE_TOOLS, SORTER_CHUTE, STATION, STATION_FUNNEL, SUMP_TIP, gaugeSegments, needleAt, BULB, STRIP, stripInk, COLUMN, columnInk, wetness, cultureCells, TANK_H, THERMOMETER, THERMOMETERS, THERMOMETER_ROD, isThermometer, thermometerAt, type ThermometerKind, chuteY, levelIn, meterText, tankPieces, tankX,
  type Hose, type Piece, type Tool,
} from './tools';

/** What the crosshair is on. */
export type Pick =
  | { kind: 'flask'; f: Flask }
  | { kind: 'tool'; t: Tool; part: 'body' | 'tank' | 'valve' | 'spout'; k: number }
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
   * Streams for lining things up: gray where a held flask would pour, green for what will line up when what's held is
   * let go; each with the mouth it lands in, whose rim is outlined to match, and whose vessel, `v`, flashes green.
   */
  guides: readonly {
    from: Vec3;
    toY: number;
    look: GuideLook;
    mouth: Vec3 & { hx: number; hz: number; yaw: number };
    v: Vessel;
  }[];
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
  /** Real seconds since the last frame, for the guides' flash, which isn't part of the lab. */
  dt: number;
  /** Sim seconds the lab has run, for what blinks on sim time (the station's gauge, the beacon). */
  clock: number;
  /** Each bond's energy, in BOND_KEYS order, for the spectroscope's graph. */
  energies: readonly number[];
  /** Whether the alarms are silenced, which the button under the beacon shows. */
  alarmsOff: boolean;
  /** Whether the porthole's blinds are shut, leaving it solid black. */
  blindsShut: boolean;
  airlock: AirlockLook;
  /** How far the ship has turned, in radians, which turns the stars about the axis straight out of the porthole. */
  spin: number;
}

export type GuideLook = 'solid' | 'snap';
/**
 * How each look of guide is drawn: the color and opacity of its stream, and of its rim; and the same for the outline
 * of where what's held will stand, `place`, or can't, `bad` (see Frame.footprints), which have no stream.
 */
const GUIDE_LOOKS: Record<GuideLook | 'place' | 'bad', { color: number; stream: number; edge: number; rim: number }> = {
  solid: { color: 0xb4bcb8, stream: 0.6, edge: 0xdfe6e2, rim: 0.85 },
  snap: { color: 0x7fd4ad, stream: 0.8, edge: 0x7fd4ad, rim: 0.95 },
  place: { color: 0, stream: 0, edge: 0xe8eeea, rim: 0.75 },
  bad: { color: 0, stream: 0, edge: 0xe0604c, rim: 0.85 },
};
/** Which look wins where guides of several looks end at the same mouth. */
const LOOK_RANK: Record<GuideLook | 'place' | 'bad', number> = { solid: 1, snap: 2, place: 3, bad: 3 };

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
/** The layer of what's seen at Mu Ceti (see View.renderArrival): the pod, and the white light round it. */
const VOID_LAYER = 4;
/**
 * The layer what's outlined is put on, for the moment its silhouette is drawn (see Outliner). Nothing else may be on
 * it, or it's outlined too.
 */
const OUTLINE_LAYER = 5;

/**
 * How the light of Mu Ceti looks as the pod opens on it at the end (see AirlockLook.arrival): a white void, `void` times
 * as bright as white, so that it blooms over everything (`bloom` strength, `radius`, from a brightness of `threshold`
 * up); the light pouring into the pod from it, from out in front (`light`) and all round (`ambient`); and how bright it
 * all comes out on the screen (`exposure`, through ACES tone mapping). Tunable in god mode's preview of it, along with
 * how far open the pod is there (`open`, which the game itself doesn't use).
 */
export const ARRIVAL = { void: 8, bloom: 1.16, radius: 0.08, threshold: 1, light: 6, ambient: 2.5, exposure: 1.3, open: 1 };
export const ARRIVAL_DEFAULTS = { ...ARRIVAL };

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
/** A thermometer's white enamel backing (see THERMOMETER_ROD). */
const enamelMat = new THREE.MeshStandardMaterial({ color: 0xf1efe6, roughness: 0.4 });
const keyMats = {
  up: new THREE.MeshStandardMaterial({ color: 0xd8443b, roughness: 0.45 }),
  hot: new THREE.MeshStandardMaterial({ color: 0xf06358, roughness: 0.45, emissive: 0x401010 }),
  down: new THREE.MeshStandardMaterial({ color: 0x9c2d28, roughness: 0.6 }),
};
/** Blotting paper, for the wicking strip. */
const paperMat = new THREE.MeshStandardMaterial({ color: 0xe6dfc8, roughness: 0.95, metalness: 0 });
const hidden = new THREE.MeshBasicMaterial({ visible: false });
const faintMat = new THREE.MeshBasicMaterial({ color: 0xd6ecf2, transparent: true, opacity: 0.3, depthWrite: false });
const rodMat = new THREE.MeshStandardMaterial({ color: 0xc8cfcd, metalness: 1, roughness: 0.18 });
/** How see-through a faucet's knob is at the most, for a clear fluid's (the solvent's). */
const KNOB_ALPHA = 0.6;
/** Polished chrome, for the faucets. */
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e7e8, metalness: 1, roughness: 0.08 });
/** The steel plate the cryostabilizer station's panes are set in, and the lines marked on it. */
const plateMat = new THREE.MeshStandardMaterial({ color: 0x6f7975, metalness: 0.5, roughness: 0.45 });
/** The rubber seam round the cryostabilizer station's block of the wall. */
const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1a1d1c, roughness: 0.95, metalness: 0 });
/**
 * How wide the hazard tape round the station's block is, and how far apart its stripes repeat, in world units; and how
 * far its inner edge is from the block's edge, across and up, at each corner (bottom left, bottom right, top right, top
 * left), uneven as if laid on by hand.
 */
const TAPE = { w: 10, period: 14, gaps: [[2.5, 3.5], [4, 2], [3, 4.5], [2, 3]] as const };

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

/**
 * How a see-through fluid shows its body and surface (see FluidMesh): how much it thickens toward opaque where it's
 * seen edge on; and the line along its surface, how far down it fades (by 1/e), in world units, and how opaque it is.
 */
const FLUID_EDGE = { edge: 0.7, line: 1.2, lineAlpha: 0.8 };

/**
 * How what's seen through a see-through fluid is bent, as through water in glass (see FluidMesh's `bent`): at most
 * `shift` world units sideways at the fluid's own distance, where the fluid's far side is seen edge on, and less as it
 * faces the eye, so a round flask acts as a lens; at full strength from opacity 1 − `fade` down, and fading to nothing
 * as the fluid turns opaque. What's behind is drawn again for it, at `scale` of the screen's resolution each way, once
 * a frame and only while some see-through fluid is in view.
 */
export const REFRACT = { shift: 14, fade: 0.3, scale: 0.5 };
/** The layer the bent views behind see-through fluids are on, drawn only in the frame itself (see View.render). */
const REFRACT_LAYER = 6;
/** The drawing buffer's size in pixels, shared by every `bent` material, set each frame (see View.render). */
const refractScreen = { value: new THREE.Vector2(1, 1) };

/**
 * What's behind a see-through fluid, bent: each pixel of the fluid's far side (its back faces, which cover all of it
 * from any side, the open top included) shows what's behind the fluid a little toward the fluid's middle, by how far
 * its surface there turns away from the eye. It uses three.js's transmission, which draws everything opaque to a
 * texture once a frame whenever something transmissive is in view; this then replaces what's behind with that
 * texture, shifted, and the fluid itself is blended over it as ever. Glass and other see-through things are drawn
 * after it, so they're seen straight.
 */
function bentMat(plane: THREE.Plane): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ transmission: 1, side: THREE.BackSide, depthWrite: false, clippingPlanes: [plane] });
  const shift = { value: 0 };
  mat.userData.shift = shift;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.refractScreen = refractScreen;
    sh.uniforms.refractShift = shift;
    sh.fragmentShader = /* glsl */ `
      uniform sampler2D transmissionSamplerMap;
      uniform mat4 projectionMatrix;
      uniform vec2 refractScreen;
      uniform float refractShift;
      varying vec3 vViewPosition;
      varying vec3 vNormal;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        // the far side's normal, turned to face the eye (three.js flips it for a back side): toward the fluid's middle
        vec3 n = normalize( vNormal );
        vec2 perUnit = 0.5 * vec2( projectionMatrix[ 0 ][ 0 ], projectionMatrix[ 1 ][ 1 ] ) / max( vViewPosition.z, 1.0 );
        vec2 uv = gl_FragCoord.xy / refractScreen + n.xy * refractShift * perUnit;
        gl_FragColor = vec4( textureLod( transmissionSamplerMap, uv, 0.0 ).rgb, 1.0 );
        #include <colorspace_fragment>
      }`;
  };
  mat.customProgramCacheKey = () => 'bent';
  return mat;
}

/** The fluid in a vessel: drawn from a solid the shape of its inside, cut off at the fluid's level. */
class FluidMesh {
  readonly mat: THREE.MeshLambertMaterial;
  readonly plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  readonly meshes: THREE.Mesh[] = [];
  /** What's behind it, bent, while it's see-through (see bentMat). */
  private bent: THREE.MeshPhysicalMaterial;
  private bents: THREE.Mesh[] = [];
  private key = '';

  constructor(geoms: THREE.BufferGeometry[], parent: THREE.Object3D) {
    this.mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, clippingPlanes: [this.plane] });
    // a see-through fluid (one thinned by the solvent) thickens toward its edges, seen edge on, and shows a bright
    // line where its surface meets the glass, as clear liquid in glass does, so even pure solvent reads as a body of
    // liquid with a surface rather than nothing; an opaque one is unchanged
    this.mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <opaque_fragment>',
        `float edgeOn = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        float clear = 1.0 - diffuseColor.a;
        diffuseColor.a += clear * ${FLUID_EDGE.edge.toFixed(2)} * edgeOn * edgeOn * edgeOn;
        #if NUM_CLIPPING_PLANES > 0
          float under = clippingPlanes[ 0 ].w - dot( vClipPosition, clippingPlanes[ 0 ].xyz );
          float line = exp( -max( under, 0.0 ) / ${FLUID_EDGE.line.toFixed(2)} );
          diffuseColor.a += clear * ${FLUID_EDGE.lineAlpha.toFixed(2)} * line;
          outgoingLight = mix( outgoingLight, vec3( 1.0 ), clear * 0.5 * line );
        #endif
        #include <opaque_fragment>`,
      );
    };
    this.mat.customProgramCacheKey = () => 'fluid';
    this.bent = bentMat(this.plane);
    for (const g of geoms) {
      const m = new THREE.Mesh(g, this.mat);
      m.castShadow = true;
      parent.add(m);
      this.meshes.push(m);
      // drawn only in the frame itself: never hit, outlined, reflected or in the end's white void
      const b = new THREE.Mesh(g, this.bent);
      b.layers.set(REFRACT_LAYER);
      b.raycast = () => {};
      b.userData.bent = true;
      b.visible = false;
      parent.add(b);
      this.bents.push(b);
    }
  }

  /** Show `f` up to height `level` in the room. */
  update(f: Fluid, level: number): void {
    const rgb = f.N > TRACE ? fluidRGB(f) : null;
    for (const m of this.meshes) m.visible = !!rgb;
    const a = rgb ? fluidAlpha(f) : 1;
    // bent as far as it's clear (see REFRACT), and not at all, nor drawn, once it's all but opaque
    const shift = REFRACT.shift * Math.min(1, (1 - a) / REFRACT.fade);
    (this.bent.userData.shift as { value: number }).value = shift;
    for (const b of this.bents) b.visible = shift > 0.01;
    if (!rgb) return;
    this.plane.constant = level;
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
    this.bent.dispose();
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

/**
 * The faint green a vessel that a guide ends at flashes (see Frame.guides): added over its glass, pulsing FLASH.hz
 * times a real second between FLASH.lo and FLASH.hi opacity.
 */
const flashMat = new THREE.MeshBasicMaterial({
  color: 0x5cff9a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const FLASH = { hz: 1.5, lo: 0.05, hi: 0.22 };

/**
 * A copy of a glass mesh in flashMat, laid over it and hidden until its vessel is to flash; null for anything that
 * isn't glass. It's never hit by the crosshair.
 */
function flashOver(o: THREE.Object3D): THREE.Mesh | null {
  if (!(o instanceof THREE.Mesh)) return null;
  const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
  if (!mats.includes(glassMat)) return null;
  const m = new THREE.Mesh(o.geometry, Array.isArray(o.material) ? mats.map((x) => (x === glassMat ? flashMat : hidden)) : flashMat);
  m.position.copy(o.position);
  m.quaternion.copy(o.quaternion);
  m.scale.copy(o.scale);
  m.visible = false;
  m.raycast = () => {};
  o.parent!.add(m);
  return m;
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

  /** If `clear`, what isn't drawn on shows what's behind. */
  constructor(parent: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, z: number, readonly ppu: number, clear = false) {
    this.canvas.width = Math.round((x1 - x0) * ppu);
    this.canvas.height = Math.round((y1 - y0) * ppu);
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, transparent: clear }));
    m.position.set((x0 + x1) / 2, -(y0 + y1) / 2, z);
    parent.add(m);
  }
}

/**
 * The cryostabilizer station's diverter's LCD: a pipe down from the funnel, branching off toward the reservoir, with
 * the diverter's flap across whichever way it isn't sending what comes through, and that way lit while anything's
 * going through: green into the reservoir, red down to the waste spigot, filling the pipe right up to its walls; the
 * rest of the pipes black inside. Only the pipes, the flap and what's in them are drawn, straight on the plate.
 */
function drawDiverter(sc: Screen, gate: 'reservoir' | 'waste', flowing: boolean): void {
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
  sc.tex.needsUpdate = true;
}

/**
 * A gradient down a canvas L tall through C stretches of a strip's paper or a column's bed, each `color(c)` at its
 * middle, `at(c)` of the way down, blended smoothly between them, and the ends held out to the canvas's.
 */
function cellGradient(ctx: CanvasRenderingContext2D, L: number, C: number, at: (c: number) => number, color: (c: number) => string): CanvasGradient {
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
function entryWet(wet: number[]): number[] {
  if (wet.length > 1) wet[0] = Math.max(wet[0], wet[1]);
  return wet;
}

/**
 * A wicking strip's paper's outline on its canvas, W across and L tall, foot at the bottom: its sides straight down,
 * and its last STRIP.paper.point narrowing to a point at its foot.
 */
function paperOutline(ctx: CanvasRenderingContext2D, W: number, L: number): void {
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
 * (see wetness), by what's on it, until it's dry; each species on each stretch of it (see Tool.paper) as ink of its own
 * color, as opaque as stripInk says, single atoms first, so what's left in bands lies over the carrier's tint; both
 * blended smoothly from one stretch's middle to the next, except for a spot that has yet to move, a round blot at the
 * foot's point; and browned over by how scorched it is, where it's wet, or all over once it's drying, since by then
 * it's all been wet. Nothing's drawn outside its outline.
 */
function drawStrip(sc: Screen, t: Tool): void {
  const { paper } = t;
  const C = paper.length;
  let sum = 0;
  paper.forEach((v, c) => (sum += v.N * (c + 1)));
  const key = `${sum} ${t.soaked > 0} ${t.dryness.toFixed(2)} ${t.scorch.toFixed(2)}`;
  if (key === sc.key) return;
  sc.key = key;
  const { ctx, ppu } = sc;
  const [W, L] = [2 * STRIP.paper.w, STRIP.paper.len];
  const at = (c: number) => 1 - (c + 0.5) / C;
  const wet = entryWet(paper.map((v) => wetness(volume(v), STRIP.cap, C)));
  ctx.setTransform(ppu, 0, 0, ppu, 0, 0);
  ctx.clearRect(0, 0, W, L);
  ctx.save();
  paperOutline(ctx, W, L);
  ctx.clip();
  ctx.fillStyle = '#e6dfc8';
  ctx.fillRect(0, 0, W, L);
  if (t.dryness < 1 && wet.some((w) => w > 0)) {
    ctx.fillStyle = cellGradient(ctx, L, C, at, (c) => `rgba(96, 92, 78, ${0.28 * wet[c] * (1 - t.dryness)})`);
    ctx.fillRect(0, 0, W, L);
  }
  const here = SPECIES.map((_, s) => s).filter((s) => paper.some((v) => v.n[s] > 0));
  here.sort((a, b) => SPECIES[a].size - SPECIES[b].size);
  // the spot's a blot at the foot's point till the paper's drunk anything
  const blot = t.soaked === 0 && paper[0].N > 0;
  const r = STRIP.paper.point / 2;
  for (const s of here) {
    const rgb = SPECIES[s].color.slice(4, -1);
    if (blot) {
      ctx.fillStyle = `rgba(${rgb}, ${stripInk(s, paper[0].n[s], t.dryness)})`;
      ctx.beginPath();
      ctx.ellipse(W / 2, L - r, r * 1.3, r, 0, 0, 2 * Math.PI);
      ctx.fill();
      continue;
    }
    ctx.fillStyle = cellGradient(ctx, L, C, at, (c) => `rgba(${rgb}, ${stripInk(s, paper[c].n[s], t.dryness)})`);
    ctx.fillRect(0, 0, W, L);
  }
  if (t.scorch > 0) {
    ctx.fillStyle = cellGradient(ctx, L, C, at, (c) => `rgba(46, 28, 14, ${0.92 * t.scorch * (t.dryness > 0 ? 1 : wet[c])})`);
    ctx.fillRect(0, 0, W, L);
  }
  ctx.restore();
  sc.tex.needsUpdate = true;
}

/** Where a thermometer's capillary runs across its rod, in its own frame, left of the middle, with its scale's ticks right of it. */
const CAPILLARY_X = -1.4;

/**
 * A column's bed, its top at the top: the paper's cream, darker as far as each stretch of it is wet (see wetness), by
 * what's on it; each species on each stretch (see Tool.bed) as ink of its own color, as opaque as columnInk says,
 * single atoms first, so bands lie over the carrier's tint; both blended smoothly from one stretch's middle to the next.
 */
function drawColumn(sc: Screen, t: Tool): void {
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
  sc.tex.needsUpdate = true;
}

/**
 * A thermometer's scale, on the white enamel backing inside its rod (see THERMOMETER_ROD): from 0 at its foot to the
 * kind's top at its top, evenly (see thermometerAt), a tick every `tick` right of where the capillary runs, those at
 * every `long` longer, and those at every `num` numbered at the backing's right edge (see THERMOMETERS). It's drawn
 * once.
 */
function drawThermometerScale(sc: Screen, kind: ThermometerKind): void {
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
  sc.tex.needsUpdate = true;
}

/** How long a sleeper culture's cell is shown dying, swollen and amber, in sim seconds. */
const DYING = 1.2;

/** How far the station's needle swings, from its left stop to its right, in radians, about straight up. */
const NEEDLE_SWEEP = (140 * Math.PI) / 180;

/**
 * The cryostabilizer station's needle: an enamel dial with no words or numbers, a needle swinging across it from its
 * left stop (see needleAt), evenly spaced ticks, and a red line where the diverter's line is, with a green band from
 * there to the right stop. `u` is how far across the needle stands, from 0 to 1 (see Tool.needle).
 */
function drawNeedle(sc: Screen, u: number): void {
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
  sc.tex.needsUpdate = true;
}

/**
 * A composition analyzer's screen: a triangle per molecule size (1 to 4 atoms), each cut into four smaller ones, one
 * per color (see analyzerSector): its three corners, and the upside-down one in the middle. Each glows as bright as its
 * share of what it's reading, and is dark while it has nothing to read. No words, no lines between the sectors: reading
 * it is part of the game.
 */
function drawAnalysis(sc: Screen, t: Tool): void {
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
  sc.tex.needsUpdate = true;
}

/**
 * A bond visualizer's screen: four points, one per atom, at the corners and the middle of a triangle (see bondPoint), and a line between two of them
 * for each bond between those atoms going by, glowing as bright as the share of what's passing that has that bond (see
 * bondShares); just the points while it has nothing to read. No words: reading it is part of the game.
 */
function drawBonds(sc: Screen, t: Tool): void {
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
  sc.tex.needsUpdate = true;
}

/** The spectroscope's number for 10^k of its f axis's unit: 1, 10, 100, ..., and under 1, .1, .01, .... */
function fLabel(k: number): string {
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
  private flash: THREE.Mesh;

  constructor(
    readonly f: Flask,
    scene: THREE.Object3D,
    pickables: Map<THREE.Object3D, Pick>,
  ) {
    const glass = new THREE.Mesh(flaskGlassGeom, glassMat);
    this.tilt.add(glass, new THREE.LineSegments(new THREE.EdgesGeometry(flaskGlassGeom, 25), edgeMat));
    this.flash = flashOver(glass)!;
    this.fluid = new FluidMesh([flaskFluidGeom], this.tilt);
    this.root.add(this.tilt);
    this.label = new Label(this.root, new THREE.Vector3(0, NOTE_Y, 0));
    scene.add(this.root);
    pickables.set(glass, { kind: 'flask', f });
  }

  /** Draw it as it is now, flashing if it's in `targets` (see Frame.guides). */
  update(targets: ReadonlySet<Vessel>): void {
    const { f } = this;
    this.flash.visible = targets.has(f);
    this.root.position.set(f.pose.x, f.pose.y, f.pose.z);
    this.root.rotation.y = f.pose.yaw;
    this.tilt.rotation.z = -f.tilt;
    this.fluid.update(f, f.pose.y + fillLevel(f.tilt, volume(f) / f.cap));
    this.label.set(f.label);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.fluid.dispose();
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

/**
 * Make a material as see-through as fluid f looks (see fluidAlpha: the solvent thins it), turning it transparent only
 * while it needs to be, since that rebuilds its shader.
 */
function fluidOpacity(mat: THREE.Material, f: Fluid): void {
  const a = fluidAlpha(f);
  mat.opacity = a;
  if (mat.transparent !== a < 1) {
    mat.transparent = a < 1;
    mat.depthWrite = a >= 1;
    mat.needsUpdate = true;
  }
}

/**
 * A tool, built from its flat outline with depth, in `art`. Every mesh of it can be hit, glass included, but not the
 * empty space around it.
 */
class ToolView {
  readonly root = new THREE.Group();
  /** Everything but the root's placement. */
  private body = new THREE.Group();
  private art = new THREE.Group();
  /**
   * Each tank's fluid, and how high it stands in the room; `fit`, if given, sizes the fluid's solid to that height
   * itself, so it has a top, rather than leaving it to be cut off open there.
   */
  private fluids: { fm: FluidMesh; level: (v: Vessel) => number; fit?: (v: Vessel) => void }[] = [];
  private levers = new Map<number, THREE.Group>();
  /** Each tank's glass's flash overlays (see flashOver). */
  private flashes: THREE.Mesh[][] = [];
  private dial?: THREE.Group;
  private lids: THREE.Mesh[] = [];
  private labels: Label[] = [];
  private note: Label;
  private screen?: Screen;
  /** The station's screen showing how long it's been delivering steadily. */
  private steadyScreen?: Screen;
  /** The cryostabilizer station's diverter's LCD (see drawDiverter). */
  private diverter?: Screen;
  /** The cryostabilizer station's purity needle's dial (see drawNeedle). */
  private needle?: Screen;
  /** What's running down an inline instrument's tube, shown as a thin thread of its color. */
  private thread?: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial };
  private helix?: { geom: THREE.TubeGeometry; colors: THREE.BufferAttribute; k: number }[];
  private films: THREE.Mesh[] = [];
  private filmMats: THREE.MeshBasicMaterial[] = [];
  private cells: { m: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private wire?: THREE.MeshStandardMaterial;
  /** The floats in the swell bulbs' necks, and how high each rides, in the tool's own frame, for what its tank holds. */
  private floats: { m: THREE.Mesh; at: (v: Vessel) => number }[] = [];
  /**
   * A sleeper culture's cells (see cultureCells), and the sim time each was first seen dead, so it can be shown dying;
   * those dead when the plate was first drawn (as when a save loads) are just dead.
   */
  private culture?: { cells: ReturnType<typeof cultureCells>; died: number[]; seen: boolean };
  /**
   * A thermometer's column of spirit, what's drawn of it only while it's whole (its rod below where it snaps, its bulb
   * and its column), and the jagged end it's left with once it's shattered (see buildThermometer).
   */
  private spirit?: { column: THREE.Mesh; whole: THREE.Group; stump: THREE.Group };
  /** The cryostabilizer station's gauge's segments, bottom up. */
  private segments: THREE.MeshStandardMaterial[] = [];

  constructor(
    readonly t: Tool,
    scene: THREE.Object3D,
    pickables: Map<THREE.Object3D, Pick>,
  ) {
    const sh = t.shape;
    const { art } = this;
    const D = TOOL_DEPTH[t.kind];
    const pick = (m: THREE.Object3D, part: 'body' | 'tank' | 'valve' | 'spout', k = 0) => pickables.set(m, { kind: 'tool', t, part, k });
    this.body.add(art);
    this.root.add(this.body);

    // drain pipes and spouts, from the bottom of the tanks (and their sumps)
    const TH = sh.tankH ?? TANK_H;
    const floor = TH + (sh.sump?.h ?? 0);
    if (sh.wall) this.buildStation(pick);
    else if (t.kind === 'exchanger')
      sh.tanks.forEach((tk, k) => {
        pipes(art, [[tankX(tk), floor], [tankX(tk), HELIX.y - HELIX.r]]);
        pipes(art, [[sh.spouts[k], HELIX.y + HELIX.r], [sh.spouts[k], sh.spoutY - 4]]);
      });
    else if (t.kind === 'separator') {
      // the manifold: one pipe in, five out, with a divider between each two outlets, and a handle on its left end
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
    } else if (t.kind === 'multiplexer') {
      // the splitter's fork upside down: each funnel's stem in to where they join, over the valve
      const join = sh.valveY - 12;
      for (const tk of sh.tanks) pipes(art, [[tankX(tk), TH], [tankX(tk), join - 16], [0, join]]);
      pipes(art, [[0, join], [0, sh.spoutY - 4]]);
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
      // straight down from the tube to its spout, with a branch into the cabinet, if it has one; and the analyzer's
      // out of the cabinet's far side to its waste spout
      const { body: b, inY } = INSTRUMENT;
      pipes(art, [[0, TH], [0, sh.spoutY - 4]]);
      if (t.kind !== 'meter') pipes(art, [[0, inY], [b.x0, inY]], 1.3);
      if (t.kind === 'analyzer') {
        const x = sh.spouts[1];
        pipes(art, [[b.x1, ANALYZER.wasteY], [x, ANALYZER.wasteY], [x, sh.spoutY - 4]]);
      }
    } else if (sh.neck) {
      // from under each bulb, out to its spout, under its inlet
      sh.neck.bodies.forEach((bx, k) => pipes(art, [[bx, floor], [bx, floor + 4], [sh.spouts[k], floor + 4], [sh.spouts[k], sh.spoutY - 4]]));
    }
    else if (t.kind === 'strip') this.buildStrip();
    else if (t.kind === 'dish') {
      // a little base under the dish, for its stand to clamp
      block(art, darkMat, -12, 12, TH + 0.6, sh.box.y1, -D.body / 2, D.body / 2, 1);
    }
    else if (isThermometer(t.kind)) this.buildThermometer(t.kind);
    else if (t.kind === 'column') {
      this.buildColumn();
      // the funnel's stem down into the tube, and from the tube's foot down through the tap to the spout
      pipes(art, [[0, TH], [0, COLUMN.tube.y0]]);
      pipes(art, [[0, COLUMN.tube.y1], [0, sh.spoutY - 4]]);
    }
    else if (t.kind === 'culture') {
      this.buildCulture();
      // its drain, down from under the plate's frame
      pipes(art, [[0, floor + 2.5], [0, sh.spoutY - 4]]);
    }
    else pipes(art, [[0, floor], [0, sh.spoutY - 4]]);
    sh.spouts.forEach((x, k) => pick(block(art, pipeMat, x - 4, x + 4, sh.spoutY - 6, sh.spoutY, -4, 4), 'spout', k));

    // tanks, with their fluid (the station's are built in buildStation)
    if (!sh.wall) t.tanks.forEach((_, k) => {
      const built = art.children.length;
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
      if (sh.neck) geoms = this.buildBulb(k, bottom, pieces, share);
      else if (sh.cup) {
        openBox(art, r.x0, r.x1, r.y0, r.y1, d);
        glassFrom(art, frustum(cx, o.y, r.y0, 2 * sh.cup.w, 2 * sh.cup.w, w, d, true));
        geoms = [
          new THREE.BoxGeometry(w - 1, r.y1 - r.y0, d - 1).translate(cx, -(r.y0 + r.y1) / 2, 0),
          frustum(cx, o.y, r.y0, 2 * sh.cup.w - 1, 2 * sh.cup.w - 1, w - 1, d - 1, false),
        ];
        if (t.kind === 'pipette') this.graduations(r, o, sh.cup, d, pieces);
      } else if (sh.funnel) {
        glassFrom(art, frustum(cx, r.y0, r.y1, w, d, FUNNEL_TIP, FUNNEL_TIP, true));
        geoms = [frustum(cx, r.y0 + 0.5, r.y1 - 0.5, w - 1.5, d - 1.5, FUNNEL_TIP - 1, FUNNEL_TIP - 1, false)];
      } else if (sh.round) {
        // an upright glass cylinder with a thin metal rim, over a round sump
        const rr = w / 2;
        const mid = -(r.y0 + r.y1) / 2;
        glassFrom(art, new THREE.CylinderGeometry(rr, rr, r.y1 - r.y0, 48, 1, true).translate(cx, mid, 0));
        art.add(new THREE.Mesh(new THREE.CircleGeometry(rr, 48).rotateX(Math.PI / 2).translate(cx, -r.y1, 0), glassMat));
        geoms = [new THREE.CylinderGeometry(rr - 0.5, rr - 0.5, r.y1 - r.y0 - 0.5, 48).translate(cx, mid - 0.25, 0)];
        const rim = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.6, 0.8, 6, 48).rotateX(Math.PI / 2).translate(cx, 0, 0), pipeMat);
        art.add(rim);
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
      // its glass and rim are the tank too, as much as its fluid, so an empty one can be looked at as one
      for (const m of art.children.slice(built)) if (m instanceof THREE.Mesh) pick(m, 'tank', k);
      this.fluids.push({ fm, level });
      // a lid, while nothing may get in
      const lid = block(art, pipeMat, r.x0 - 4, r.x1 + 4, -5, 0, -d / 2 - 3, d / 2 + 3);
      lid.visible = false;
      this.lids.push(lid);
      this.labels.push(new Label(art, v3(tankX(sh.tanks[k]), tankNoteY(t, k))));
      this.flashFrom(art, built, k);
    });
    if (sh.label) {
      const s = textSprite(sh.label);
      s.position.copy(v3(0, -21 + (11 * (sh.label.length - 1)) / 2 - 4));
      art.add(s);
    }
    if (t.tanks.length > 1 && !sh.wall)
      sh.tanks.forEach((tk, k) => {
        const s = textSprite([tk.name], '#e6ece8');
        s.scale.multiplyScalar(0.9);
        s.position.copy(v3(sh.neck ? sh.neck.bodies[k] : tankX(tk), 14, D.tank / 2 + 1));
        art.add(s);
      });
    // a note about the whole tool, centered over it, above its tanks' labels
    const b = sh.box;
    this.note = new Label(art, v3((b.x0 + b.x1) / 2, b.y0 - 8 - (t.tanks.length > 1 ? 13 : 0)));

    if (t.kind === 'exchanger') this.buildHelix();
    if (t.kind === 'sorter') this.buildChute();
    if (INLINE_TOOLS.includes(t.kind)) {
      if (t.kind === 'meter') this.buildMeter();
      else this.buildInstrument();
      this.buildThread(TH);
    }
    if (t.kind === 'heater') this.buildHeater();
    if (t.kind === 'dilatometer') this.buildBulbs();

    // valves: a round core on the front face, and a lever that points where it was turned; or a dial
    if (!sh.noValve)
      t.valves.forEach((_, k) => {
        const vc = valveLocal(t, k);
        const z = valveZ(t);
        if (k === sh.dial) {
          this.dial = this.buildDial(vc, z);
          art.traverse((m) => m.parent === this.dial && pick(m, 'valve', k));
          return;
        }
        rod(art, pipeMat, v3(vc.x, vc.y, 0), v3(vc.x, vc.y, z), 1.5);
        const core = new THREE.Mesh(unitCylinder, panelMat);
        core.rotation.x = Math.PI / 2;
        core.scale.set(5, 4, 5);
        core.position.copy(v3(vc.x, vc.y, z));
        art.add(core);
        pick(core, 'valve', k);
        const pivot = new THREE.Group();
        pivot.position.copy(v3(vc.x, vc.y, z + 2.5));
        const lever = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 2).translate(6, 0, 0), leverMat);
        lever.castShadow = true;
        pivot.add(lever);
        art.add(pivot);
        pick(lever, 'valve', k);
        this.levers.set(k, pivot);
      });

    // everything else that's drawn is the tool's body, to grab it by
    this.body.traverse((m) => {
      if (m instanceof THREE.Mesh && !pickables.has(m) && !m.userData.bent) pick(m, 'body');
    });
    scene.add(this.root);
  }

  /** Lay flash overlays (see flashOver) over the glass among `parent`'s children from `from` on, as tank k's. */
  private flashFrom(parent: THREE.Object3D, from: number, k: number): void {
    for (const o of parent.children.slice(from)) {
      const m = flashOver(o);
      if (m) (this.flashes[k] ??= []).push(m);
    }
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

  /** An inline instrument's cabinet, beside its tube, with an old green-on-black screen. */
  private buildInstrument(): void {
    const { body: b, screen: s } = INSTRUMENT;
    const D = TOOL_DEPTH[this.t.kind].body;
    block(this.art, panelMat, b.x0, b.x1, b.y0, b.y1, -D / 2, D / 2, 3);
    block(this.art, darkMat, s.x0 - 1.5, s.x1 + 1.5, s.y0 - 1.5, s.y1 + 1.5, D / 2, D / 2 + 0.6);
    this.screen = new Screen(this.art, s.x0, s.x1, s.y0, s.y1, D / 2 + 0.7, 5);
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

  /**
   * A wicking strip: its paper hanging from a little clip at its top (which its stand holds), its foot cut to a point,
   * with what's on it shown on its front (see drawStrip).
   */
  private buildStrip(): void {
    const { w, top, len, point } = STRIP.paper;
    const c = STRIP.clip;
    const foot = top + len;
    // the paper, a thin sheet of its outline, flat side to the front
    const shape = new THREE.Shape([
      new THREE.Vector2(-w, -top), new THREE.Vector2(w, -top), new THREE.Vector2(w, -(foot - point)),
      new THREE.Vector2(0, -foot), new THREE.Vector2(-w, -(foot - point)),
    ]);
    const sheet = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false }).translate(0, 0, -0.3), paperMat);
    sheet.castShadow = true;
    this.art.add(sheet);
    // the clip: two jaws over the paper's top, and a bar across above them
    block(this.art, darkMat, -c.w, c.w, top - 1, c.h, -c.d / 2, -0.35, 0.4);
    block(this.art, darkMat, -c.w, c.w, top - 1, c.h, 0.35, c.d / 2, 0.4);
    block(this.art, darkMat, -c.w, c.w, 0, top - 1, -c.d / 2, c.d / 2, 0.6);
    this.screen = new Screen(this.art, -w, w, top, foot, 0.31, 6, true);
  }

  /**
   * A column's tube: glass, with a metal collar at each end, and its bed filling it, what's on it shown round it (see
   * drawColumn).
   */
  private buildColumn(): void {
    const { w, y0, y1 } = COLUMN.tube;
    const r = w / 2;
    const mid = -(y0 + y1) / 2;
    glassFrom(this.art, new THREE.CylinderGeometry(r, r, y1 - y0, 32, 1, true).translate(0, mid, 0));
    for (const y of [y0, y1]) rod(this.art, pipeMat, v3(0, y - 1.5, 0), v3(0, y + 1.5, 0), r + 0.8);
    // its canvas runs round the bed and down it, the top of the canvas at the bed's top
    const ppu = 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(4 * ppu);
    canvas.height = Math.round((y1 - y0) * ppu);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const bed = new THREE.Mesh(
      new THREE.CylinderGeometry(r - 0.8, r - 0.8, y1 - y0 - 3, 32).translate(0, mid, 0),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }),
    );
    bed.receiveShadow = true;
    this.art.add(bed);
    this.screen = { canvas, ctx: canvas.getContext('2d')!, tex, key: '', ppu };
  }

  /**
   * A sleeper culture's plate: a dark backing behind the glass, in a frame, and the cells drawn over its front (see
   * drawCulture), so they show against the dark through whatever's in with them.
   */
  private buildCulture(): void {
    const r = tankRect(this.t, 0);
    const d = TOOL_DEPTH[this.t.kind].tank;
    block(this.art, darkMat, r.x0 - 2.5, r.x1 + 2.5, r.y0, r.y1 + 2.5, -d / 2 - 1.6, -d / 2 - 0.3, 0.6);
    for (const x of [r.x0 - 2.5, r.x1 + 0.5]) block(this.art, darkMat, x, x + 2, r.y0, r.y1 + 2.5, -d / 2 - 0.3, d / 2 + 0.8, 0.6);
    block(this.art, darkMat, r.x0 - 2.5, r.x1 + 2.5, r.y1 + 0.5, r.y1 + 2.5, -d / 2 - 0.3, d / 2 + 0.8, 0.6);
    this.screen = new Screen(this.art, r.x0, r.x1, r.y0, r.y1, d / 2 + 0.3, 10, true);
    this.culture = { cells: cultureCells(), died: [], seen: false };
  }

  /**
   * A sleeper culture's cells: each a pale blue dot with a bright middle while it's alive; swollen and amber for
   * DYING sim seconds from when it dies; and a small brown dot from then on.
   */
  private drawCulture(clock: number): void {
    const { t } = this;
    const sc = this.screen!;
    const cu = this.culture!;
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
    const r = tankRect(t, 0);
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
    sc.tex.needsUpdate = true;
  }

  /**
   * Tank k of a tool whose tanks have necks (see ToolShape.neck), a swell bulb: a closed glass bulb over its sump; its
   * neck up from where it is on the bulb's top, open on top, with a little black float riding the fluid in it, so its
   * level is plain whatever its color; and its inlet, a little funnel up and out from the neck's top, on a thin tube
   * leaning down and in to it. With the first, the marks across all the necks' fronts, every fifth one longer.
   * Returns the solids its fluid is drawn from.
   */
  private buildBulb(k: number, bottom: number, pieces: Piece[], share: (v: Vessel) => number): THREE.BufferGeometry[] {
    const { art, t } = this;
    const sh = t.shape;
    const neck = sh.neck!;
    const H = sh.tankH ?? TANK_H;
    const [bx, nx, ix] = [neck.bodies[k], neck.necks[k], tankX(sh.tanks[k])];
    const [rr, nr] = [neck.body / 2, neck.w / 2];
    glassFrom(art, new THREE.CylinderGeometry(rr, rr, H, 48, 1, true).translate(bx, -H / 2, 0));
    for (const y of [0, H]) art.add(new THREE.Mesh(new THREE.CircleGeometry(rr, 48).rotateX(Math.PI / 2).translate(bx, -y, 0), glassMat));
    glassFrom(art, new THREE.CylinderGeometry(nr, nr, neck.h, 20, 1, true).translate(nx, neck.h / 2, 0));
    const geoms = [
      new THREE.CylinderGeometry(rr - 0.5, rr - 0.5, H - 0.5, 48).translate(bx, -H / 2 - 0.25, 0),
      new THREE.CylinderGeometry(nr - 0.4, nr - 0.4, neck.h, 16).translate(nx, neck.h / 2, 0),
    ];
    const sump = sh.sump;
    if (sump) {
      const sm = -(H + sump.h / 2);
      glassFrom(art, new THREE.CylinderGeometry(sump.w / 2, SUMP_TIP / 2, sump.h, 24, 1, true).translate(bx, sm, 0));
      geoms.push(new THREE.CylinderGeometry(sump.w / 2 - 0.5, SUMP_TIP / 2 - 0.3, sump.h - 0.3, 24).translate(bx, sm, 0));
    }
    // the inlet's funnel, and the tube from it leaning down and in to the neck's top
    const { h: ih, y: iy } = neck.inlet;
    const iw = sh.tanks[k].x1 - sh.tanks[k].x0;
    glassFrom(art, frustum(ix, iy, iy + ih, iw, iw, 3, 3, true));
    rod(art, glassMat, v3(ix, iy + ih), v3(nx, -neck.h), 1.6);
    const float = new THREE.Mesh(new THREE.CylinderGeometry(nr - 0.7, nr - 0.7, 1.6, 16), leverMat);
    float.position.x = nx;
    art.add(float);
    this.floats.push({ m: float, at: (v) => -Math.min(0, bottom - levelIn(pieces, share(v))) + 0.8 });
    if (k === 0) {
      const [x0, x1] = [Math.min(...neck.necks) - nr, Math.max(...neck.necks) + nr];
      for (let i = 0; i <= BULB.marks; i++) {
        const y = -(i / BULB.marks) * neck.h;
        const out = i % 5 === 0 ? 3 : 0;
        block(art, darkMat, x0 - out, x1 + out, y - 0.22, y + 0.22, nr - 0.1, nr + 0.25).castShadow = false;
      }
    }
    return geoms;
  }

  /**
   * The swell bulbs' heating: a box under the bulbs with the dial on its face, and one wire up from it wound three
   * times round both bulbs together, from copper to white-hot as the dial turns up.
   */
  private buildBulbs(): void {
    const { t } = this;
    const sh = t.shape;
    const neck = sh.neck!;
    const dial = valveLocal(t, sh.dial!);
    block(this.art, panelMat, dial.x - 14, dial.x + 14, dial.y - 14, dial.y + 14, -10, valveZ(t) - 3, 2.5);
    this.wire = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.6 });
    // round both: along the front, round the right bulb's far side, along the back, round the left bulb's, and on
    const R = neck.body / 2 + 1.3;
    const a = Math.max(...neck.bodies);
    const lap = 4 * a + 2 * Math.PI * R;
    const at = (d: number): [number, number] => {
      if (d < a) return [d, R];
      if (d < a + Math.PI * R) return [a + R * Math.sin((d - a) / R), R * Math.cos((d - a) / R)];
      if (d < 3 * a + Math.PI * R) return [a - (d - a - Math.PI * R), -R];
      if (d < 3 * a + 2 * Math.PI * R) return [-a - R * Math.sin((d - 3 * a - Math.PI * R) / R), -R * Math.cos((d - 3 * a - Math.PI * R) / R)];
      return [-a + (d - 3 * a - 2 * Math.PI * R), R];
    };
    const H = sh.tankH ?? TANK_H;
    const [turns, n] = [3, 64];
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= turns * n; i++) {
      const [x, z] = at(((i % n) / n) * lap);
      pts.push(v3(x, 3 + (i / (turns * n)) * (H - 6), z));
    }
    // and down from its low end, at the front, into the top of the box
    pts.push(v3(0, dial.y - 14, R - 1));
    this.art.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.7, 5), this.wire));
  }

  /** A dial on the face of a box: a knob on a ring of ticks running clockwise from down-left (off) to down-right (full). */
  private buildDial(vc: { x: number; y: number }, z: number): THREE.Group {
    const at = (d: number) => -0.75 * Math.PI + 1.5 * Math.PI * d; // clockwise from straight up
    for (let i = 0; i <= 6; i++) {
      const a = at(i / 6);
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.5, 0.6), darkMat);
      tick.position.copy(v3(vc.x + 11.75 * Math.sin(a), vc.y - 11.75 * Math.cos(a), z - 2.5));
      tick.rotation.z = -a;
      this.art.add(tick);
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
    this.art.add(dial);
    return dial;
  }

  /**
   * A flow meter's readout: a slim box clipped round the pipe under its tube, nearly all display, with its reading (see
   * meterText) in small seven-segment digits like the scale's.
   */
  private buildMeter(): void {
    const { display: d, hz, ...b } = METER_BODY;
    block(this.art, panelMat, b.x0, b.x1, b.y0, b.y1, -hz, hz, 1.5);
    block(this.art, darkMat, d.x0, d.x1, d.y0, d.y1, hz, hz + 0.3);
    this.screen = new Screen(this.art, d.x0, d.x1, d.y0, d.y1, hz + 0.4, 16);
  }

  /**
   * A thermometer: an upright glass rod with rounded ends (see THERMOMETER_ROD), a white enamel backing inside it
   * along its upper part with its scale printed on it (see drawThermometerScale), a fine glass capillary up it in front
   * of the backing, from a bulb of red spirit at its foot, and the column of spirit in the capillary, as long as its
   * reading (see thermometerAt). Shattered, it's the rod snapped off short, a little way up from its foot, its end
   * jagged, with no bulb and no column.
   */
  private buildThermometer(kind: ThermometerKind): void {
    const { h, r, bulb, backing: b, foot, top, snap } = THERMOMETER_ROD;
    const art = this.art;
    const whole = new THREE.Group();
    const stump = new THREE.Group();
    art.add(whole, stump);
    const cap = (y: number, up: boolean) =>
      new THREE.SphereGeometry(r, 20, 6, 0, 2 * Math.PI, up ? 0 : Math.PI / 2, Math.PI / 2).translate(0, -y, 0);
    const tube = (y0: number, y1: number) => new THREE.CylinderGeometry(r, r, y1 - y0, 20, 1, true).translate(0, -(y0 + y1) / 2, 0);
    glassFrom(art, tube(r, snap));
    art.add(new THREE.Mesh(cap(r, true), glassMat));
    glassFrom(whole, tube(snap, h - r));
    whole.add(new THREE.Mesh(cap(h - r, false), glassMat));
    // the backing, white enamel all round behind its printed face
    block(art, enamelMat, -b.w / 2, b.w / 2, b.y0, b.y1, -0.75, -0.35).castShadow = false;
    const sc = new Screen(art, -b.w / 2, b.w / 2, b.y0, b.y1, -0.3, 28);
    drawThermometerScale(sc, kind);
    // the capillary, up to the burst point above the scale's top (see THERMOMETER.burst), and its spirit
    const capTop = foot - THERMOMETER.burst * (foot - top);
    const z = 0.25;
    rod(art, glassMat, v3(CAPILLARY_X, capTop, z), v3(CAPILLARY_X, snap, z), 0.55);
    rod(whole, glassMat, v3(CAPILLARY_X, snap, z), v3(CAPILLARY_X, bulb.y0 + 1, z), 0.55);
    const spiritMat = new THREE.MeshStandardMaterial({ color: 0xc92f27, roughness: 0.3, emissive: 0x300806 });
    const ball = new THREE.Mesh(new THREE.CapsuleGeometry(bulb.r, bulb.y1 - bulb.y0 - 2 * bulb.r, 4, 12), spiritMat);
    ball.position.copy(v3(0, (bulb.y0 + bulb.y1) / 2));
    whole.add(ball);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1, 8).translate(0, 0.5, 0), spiritMat);
    column.position.copy(v3(CAPILLARY_X, bulb.y0 + 1, z));
    whole.add(column);
    // the jagged end it snaps to: shards of the glass round where it broke, of uneven lengths
    for (let i = 0; i < 7; i++) {
      const a = (2 * Math.PI * i) / 7;
      const len = 1.5 + 2.5 * Math.abs(Math.sin(i * 2.3 + 1));
      const shard = new THREE.Mesh(new THREE.ConeGeometry(1.1, len, 3).rotateX(Math.PI).translate(0, -len / 2, 0), glassMat);
      shard.position.copy(v3(r * 0.85 * Math.cos(a), snap, r * 0.85 * Math.sin(a)));
      shard.rotation.y = -a;
      stump.add(shard);
    }
    stump.visible = false;
    this.spirit = { column, whole, stump };
  }

  /**
   * The cryostabilizer station (see STATION): a steel plate, a block of the wall in a rubber seam, with a narrow glass
   * pane for the reservoir's column, its fluid behind it filling it from the bottom as the column fills, and its name
   * printed above; a glass funnel low beside it, whose stem runs down and back into the plate, over the diverter's LCD
   * (see drawDiverter) and the waste spigot, whose valve has no handle, since only the diverter works it; a faucet
   * under the reservoir (its lever is built with the other valves); the gauge of LCD segments just right of the
   * reservoir (see gaugeSegments); and a green-on-black screen under its label showing the litres of cryostabilizer in
   * it of the litres needed.
   */
  private buildStation(pick: (m: THREE.Object3D, part: 'body' | 'tank' | 'spout', k?: number) => void): void {
    const { t, art } = this;
    const sh = t.shape;
    const { paneW, paneH: H, out, plate, funnel: f, block: bk, gauge: g, display: dp } = STATION;
    // the plate's face is flush with the wall, set into a hole in it (see buildRoom), and the column is behind
    const face = -out;
    const wall = face - plate;
    const [fx, x] = sh.tanks.map(tankX);
    // the plate: a block of the wall, lined up with its panels, with a slot for the pane
    const rect = (d: number) =>
      [(bk.x0 + bk.x1) / 2, -(bk.y0 + bk.y1) / 2, bk.x1 - bk.x0 + 2 * d, bk.y1 - bk.y0 + 2 * d] as const;
    const shape = rectPath(...rect(0), new THREE.Shape());
    shape.holes.push(rectPath(x, -H / 2, paneW, H));
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
    // and hazard tape on the wall round it, a little way outside the seam, laid on by hand: its inner edge is a few
    // units out from each corner, by TAPE.gaps, so each side runs not quite parallel to the seam
    const [cx, cy, bw, bh] = rect(0);
    const taped = <P extends THREE.Path>(d: number, path: P): P => {
      const corners = TAPE.gaps.map(([gx, gy], i) => {
        const [sx, sy] = [i === 0 || i === 3 ? -1 : 1, i < 2 ? -1 : 1];
        return [cx + sx * (bw / 2 + gx + d), cy + sy * (bh / 2 + gy + d)] as const;
      });
      path.moveTo(...corners[3]);
      for (const c of corners) path.lineTo(...c);
      return path;
    };
    const band = taped(TAPE.w, new THREE.Shape());
    band.holes.push(taped(0, new THREE.Path()));
    // a shape's texture coordinates are its own x and y, in world units: the texture's repeat makes them stripes
    const tape = new THREE.Mesh(new THREE.ShapeGeometry(band), new THREE.MeshStandardMaterial({ map: tapeTexture(), roughness: 0.55 }));
    tape.position.z = face + 0.3;
    tape.receiveShadow = true;
    art.add(tape);
    // no lids: the funnel is open, and the reservoir is sealed
    const noLid = () => {
      const lid = new THREE.Mesh();
      lid.visible = false;
      this.lids.push(lid);
    };

    // the funnel, over the cell in front of the wall, with its fluid settling into it as drawn (see STATION_FUNNEL)
    const built = art.children.length;
    glassFrom(art, frustum(fx, f.y, f.y + f.h, 2 * f.w, 2 * f.w, FUNNEL_TIP, FUNNEL_TIP, true));
    const fm = new FluidMesh([frustum(fx, f.y + 0.5, f.y + f.h - 0.5, 2 * f.w - 1.5, 2 * f.w - 1.5, FUNNEL_TIP - 1, FUNNEL_TIP - 1, false)], art);
    for (const m of art.children.slice(built)) if (m instanceof THREE.Mesh) pick(m, 'tank', 0);
    this.flashFrom(art, built, 0);
    this.fluids.push({ fm, level: (v) => onTool(t, 0, f.y + f.h - levelIn(STATION_FUNNEL, Math.min(1, volume(v) / v.cap))).y });
    noLid();
    this.labels.push(new Label(art, v3(fx, tankNoteY(t, 0))));
    // its stem, down and back into the plate, above the diverter's LCD
    const stem = f.y + f.h + 6;
    rod(art, glassMat, v3(fx, f.y + f.h, 0), v3(fx, stem, 0), FUNNEL_TIP / 2);
    rod(art, glassMat, v3(fx, stem, 0), v3(fx, stem, face), FUNNEL_TIP / 2);
    block(art, pipeMat, fx - 5, fx + 5, stem - 5, stem + 5, face, face + 1.5);
    this.diverter = new Screen(art, dp.x0, dp.x1, dp.y0, dp.y1, face + 0.3, 8, true);
    // the purity needle's dial, beside it: an enamel face in a dark bezel
    const nd = STATION.needle;
    block(art, darkMat, nd.x0 - 2, nd.x1 + 2, nd.y0 - 2, nd.y1 + 2, face, face + 0.8, 1.5);
    this.needle = new Screen(art, nd.x0, nd.x1, nd.y0, nd.y1, face + 0.9, 10);

    // the reservoir's column: its back, its fluid, and the glass in front
    block(art, darkMat, x - paneW / 2, x + paneW / 2, 0, H, wall, wall + 0.5);
    // a box standing on the column's floor, as tall as the fluid stands, so it has a top surface; held a little off
    // the column's back and the pane, so where they'd meet they don't flicker into each other
    const column = new FluidMesh([new THREE.BoxGeometry(paneW - 1, 1, plate - 4).translate(x, 0.5, wall + 1.5 + (plate - 4) / 2)], art);
    const [solid] = column.meshes;
    solid.position.y = -H;
    pick(solid, 'tank', 1);
    const height = (v: Vessel) => H * Math.min(1, volume(v) / v.cap);
    this.fluids.push({
      fm: column,
      // never cut off, above the column's top: it's already just as tall as the fluid
      level: () => onTool(t, 0, -1).y,
      fit: (v) => (solid.scale.y = Math.max(0.01, height(v))),
    });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(paneW, H).translate(x, -H / 2, face - 0.5), glassMat);
    art.add(pane);
    pick(pane, 'tank', 1);
    this.flashFrom(art, art.children.length - 1, 1);
    noLid();
    const label = sh.tanks[1].label;
    if (label) printed(art, label.join(' '), x, STATION.labelY, face + 0.1, 11);
    this.labels.push(new Label(art, v3(x, tankNoteY(t, 1))));
    // the gauge beside the reservoir: an LCD stack of segments, as tall as the pane, on a dark strip
    block(art, darkMat, g.x0 - 2, g.x1 + 2, -2, H + 2, face, face + 1);
    const seg = H / g.segments;
    for (let i = 0; i < g.segments; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: SEGMENT_COLORS.off, roughness: 0.4 });
      block(art, mat, g.x0, g.x1, H - (i + 1) * seg + 1, H - i * seg - 1, face + 1, face + 1.4).castShadow = false;
      this.segments.push(mat);
    }

    // the waste spigot and the reservoir's faucet: out from the plate, and down; all of each pipe counts as its spout,
    // as a faucet's does, and so does the spigot's handleless valve
    sh.spouts.forEach((sx, k) => {
      const from = art.children.length;
      rod(art, pipeMat, v3(sx, H + 10, face), v3(sx, H + 10, 0), 2.5);
      pipes(art, [[sx, H + 10], [sx, sh.spoutY - 4]], 2.5);
      for (const m of art.children.slice(from)) pick(m, 'spout', k);
    });
    const valve = new THREE.Mesh(unitCylinder, panelMat);
    valve.rotation.x = Math.PI / 2;
    valve.scale.set(4.5, 8, 4.5);
    valve.position.copy(v3(sh.spouts[0], sh.valveY, 0));
    art.add(valve);
    pick(valve, 'spout', 0);
    // the readout of the litres in the reservoir, under its label, and beside it, how long it's been delivering steadily
    const screen = (sc: { x0: number; x1: number; y0: number; y1: number }) => {
      block(art, darkMat, sc.x0 - 1.5, sc.x1 + 1.5, sc.y0 - 1.5, sc.y1 + 1.5, face, face + 0.5);
      return new Screen(art, sc.x0, sc.x1, sc.y0, sc.y1, face + 0.6, 8);
    };
    this.screen = screen(STATION.screen);
    this.steadyScreen = screen(STATION.steadyScreen);
  }

  update(clock: number, energies: readonly number[], targets: ReadonlySet<Vessel>): void {
    const { t } = this;
    this.flashes.forEach((ms, k) => ms.forEach((m) => (m.visible = targets.has(t.tanks[k]))));
    this.root.position.set(t.pose.x, t.pose.y, t.pose.z);
    this.root.rotation.y = t.pose.yaw;
    this.body.updateMatrixWorld();
    t.tanks.forEach((v, k) => {
      const { fm, level, fit } = this.fluids[k];
      fm.update(v, level(v));
      fit?.(v);
      this.lids[k].visible = t.lidded;
      this.labels[k].set(v.label);
    });
    this.note.set(t.note);
    for (const [k, pv] of this.levers)
      // closed points right, open straight up; a splitter's points to the side that gets more, and a multiplexer's to
      // the side it takes more from
      pv.rotation.z = t.kind === 'splitter' || t.kind === 'multiplexer' ? Math.PI * (1 - t.valves[k]) : (t.valves[k] * Math.PI) / 2;
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
        fluidOpacity((m as THREE.Mesh).material as THREE.Material, out);
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
      if (!rgb) return;
      setRGB(this.filmMats[k].color, rgb);
      fluidOpacity(this.filmMats[k], on);
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
        fluidOpacity(mat, v);
        const d = Math.max(0.3, 2 * r * Math.min(1, volume(v) / full));
        m.scale.y = d;
        m.position.y = -(y + r);
      });
    }
    if (this.wire) {
      const dial = t.valves[t.shape.dial!];
      const rgb = wireColor(dial);
      setRGB(this.wire.color, rgb);
      setRGB(this.wire.emissive, rgb).multiplyScalar(Math.min(1, 1.3 * dial));
    }
    if (t.kind === 'analyzer' && this.screen) drawAnalysis(this.screen, t);
    if (t.kind === 'spectroscope' && this.screen) drawSpectroscope(this.screen, t, energies);
    if (t.kind === 'visualizer' && this.screen) drawBonds(this.screen, t);
    if (this.thread) {
      const through = new Vessel(Infinity);
      for (const v of t.out) if (v) through.addFrom(v, volume(v));
      const rgb = through.N > 0 ? fluidRGB(through) : null;
      this.thread.m.visible = !!rgb;
      if (rgb) {
        setRGB(this.thread.mat.color, rgb);
        fluidOpacity(this.thread.mat, through);
      }
    }
    this.floats.forEach((f, k) => (f.m.position.y = f.at(t.tanks[k])));
    if (this.spirit) {
      const { column, whole, stump } = this.spirit;
      if (t.broken && whole.visible) {
        // shattered: only the stump is left, and what's gone can't be looked at
        whole.visible = false;
        whole.traverse((m) => (m.raycast = () => {}));
        stump.visible = true;
      }
      // the column runs from the bulb up to its reading on the scale
      const { bulb, foot, top } = THERMOMETER_ROD;
      const T = t.reads;
      if (T !== null) column.scale.y = bulb.y0 + 1 - foot + (foot - top) * thermometerAt(t.kind as ThermometerKind, T);
    }
    if (t.kind === 'strip' && this.screen) drawStrip(this.screen, t);
    if (t.kind === 'column' && this.screen) drawColumn(this.screen, t);
    if (t.kind === 'culture') this.drawCulture(clock);
    if (t.kind === 'meter' && this.screen) {
      const s = this.screen;
      const text = meterText(t.rate);
      if (s.key !== text) {
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
        s.tex.needsUpdate = true;
      }
    }
    if (t.kind === 'receptacle') this.updateStation(clock);
  }

  private updateStation(clock: number): void {
    const { t } = this;
    // the gauge: the reservoir's target, against the goal; what's still wanted flashes, a second on and half off
    const blink = clock % 1.5 < 1;
    gaugeSegments(t.tanks[1].n[TARGET], GOAL_TARGET, REFERENCE_CAP).forEach((st, i) => {
      const lit = st === 'held' || (st === 'wanted' && blink);
      const color = lit ? SEGMENT_COLORS[st] : SEGMENT_COLORS.off;
      this.segments[i].color.set(color);
      this.segments[i].emissive.set(lit ? color : 0x000000);
    });
    drawDiverter(this.diverter!, t.gate, t.sinceFlow < DIVERTER_HOLD);
    drawNeedle(this.needle!, t.needle);
    // the screens: the cryostabilizer in the reservoir / what's needed, in litres; and how long it's been delivering
    // steadily
    phosphor(this.screen!, STATION.screen, `${((t.tanks[1].n[TARGET] / CAP) * FLASK_L).toFixed(2)} L / ${GOAL_L.toFixed(2)} L`);
    phosphor(this.steadyScreen!, STATION.steadyScreen, t.steady >= DELIVERY.streak ? 'AIRLOCK OPEN' : `STEADY ${clockText(t.steady)}`);
  }

  dispose(): void {
    this.root.removeFromParent();
    disposeGeometry(this.root);
    for (const { fm } of this.fluids) fm.dispose();
    this.screen?.tex.dispose();
    this.steadyScreen?.tex.dispose();
    this.needle?.tex.dispose();
  }
}

/** Show a line of text on a green-on-black screen covering `sc`, in the tool's frame, if it isn't already. */
function phosphor(s: Screen, sc: { x0: number; x1: number; y0: number; y1: number }, text: string): void {
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
      s.tex.needsUpdate = true;
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
    if (rgb && fluid) {
      this.coreMat.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      fluidOpacity(this.coreMat, fluid);
    }
  }

  dispose(): void {
    for (const o of [this.outlet, this.tube, this.core]) o.removeFromParent();
    this.tube.geometry.dispose();
    this.core.geometry.dispose();
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
 * How far the Milky Way's middle passes from straight out of the porthole, in radians (50°). The stars turn about that
 * line, so it stays this far off: in view only from up close to the porthole, round its edge, never across its middle.
 */
const BAND_OFF = 0.87;

/**
 * The Milky Way: a band of countless faint stars, clumped along its length, over a soft glow with a darker lane of
 * dust down its middle, round the sky, passing BAND_OFF from straight out of the porthole.
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
  // tipped toward the left wall, so that its middle passes BAND_OFF from the porthole's axis (−x), whichever way the
  // stars have turned about it
  band.rotation.z = -BAND_OFF;
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
function messageCanvas(blocks: readonly Block[]): HTMLCanvasElement {
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
  /**
   * What the message says: the notice that wakes the player, with the litres of cryostabilizer on board; or, once
   * there's enough, the one welcoming them to Mu Ceti.
   */
  notice: { arrival: true } | { arrival: false; litres: number };
  /** Whether the green lamp over the doorway is lit: it flashes while the doors stand open to sleep. */
  lamp: boolean;
  /** Whether the pod is in the white void of Mu Ceti, at the end, with nothing of the lab to be seen (see ARRIVAL). */
  arrival: boolean;
}

/**
 * The airlock (see airlock.ts): its chamber behind the front wall, the doorway's sides, the two doors that slide
 * apart into the wall, and the standing cryopod at the back, with the message projected inside its front, in front of the face of
 * whoever's in it. The doorway itself is a hole in the room's front wall (see buildRoom).
 */
class AirlockView {
  private doors: THREE.Mesh[] = [];
  private front = new THREE.Group();
  private message!: THREE.Mesh;
  private ok: THREE.Mesh;
  /** The pod, which the message hangs in, and what the message says now (see setMessage). */
  private pod: THREE.Group;
  private said = '';
  private okTex = [okTexture(false), okTexture(true)];
  private lamp: THREE.MeshStandardMaterial;
  private lampGlow: THREE.Sprite;
  private eye: number;
  private last: AirlockLook | null = null;

  constructor(scene: THREE.Scene, pickables: Map<THREE.Object3D, Pick>, eye: number) {
    const { x, w, d, h, wall, door } = AIRLOCK;
    const z1 = ROOM.z1;
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x737a78, roughness: 0.42, metalness: 0.6 });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    // the chamber, seen from inside: plain gray metal, on the lab's deck; its front is the wall with the doorway, below
    const [walls, floor] = [metal.clone(), surfaceMat('deck', { metalness: 0.55, side: THREE.BackSide })];
    walls.side = THREE.BackSide;
    const room = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), 'walls', { z: 440 }), [walls, walls, walls, floor, walls, hidden]);
    room.position.set(x, h / 2, z1 + wall + d / 2);
    g.add(room);
    const shape = rectPath(0, h / 2, w, h, new THREE.Shape());
    shape.holes.push(rectPath(0, door.h / 2 + 0.25, door.w, door.h - 0.5));
    const inside = new THREE.Mesh(new THREE.ShapeGeometry(shape), metal);
    inside.position.set(x, 0, z1 + wall);
    g.add(inside);
    // red lights in its ceiling: lenses and their glow (not lights, which would cost every surface in the lab)
    const red = new THREE.MeshStandardMaterial({ color: 0x3a0a08, emissive: 0xff2a1a, emissiveIntensity: 1.4 });
    for (const side of [-1, 1]) {
      const at = new THREE.Vector3(x + side * (w / 4), h - 3, z1 + wall + d / 2);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(46, 6, 22), red);
      lens.position.copy(at);
      g.add(lens);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture(2), color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      glow.scale.set(160, 160, 1);
      glow.position.copy(at).add(new THREE.Vector3(0, -12, 0));
      g.add(glow);
    }
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
    // and its sill, the deck through the wall's thickness, between the lab's floor and the chamber's, so nothing shows
    // through under the doors
    const sill = new THREE.Mesh(planeUV(new THREE.PlaneGeometry(door.w, wall), 'deck', -door.w / 2, -wall / 2), surfaceMat('deck', { metalness: 0.55 }));
    sill.rotation.x = -Math.PI / 2;
    sill.position.set(x, 0, z1 + wall / 2);
    sill.receiveShadow = true;
    g.add(sill);
    // the doors, each half the doorway, sliding apart into the wall, with a dark gasket down the edge where they meet;
    // and another pair, just like them, across the chamber's far end, always shut, to the outside
    const doorMat = new THREE.MeshPhysicalMaterial({ color: 0xa3ada9, roughness: 0.45, metalness: 0.35, clearcoat: 0.3 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6 });
    const gasketMat = new THREE.MeshStandardMaterial({ color: 0x141817, roughness: 0.85 });
    const half = (side: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(door.w / 2, door.h, 12), doorMat);
      m.userData.side = side;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(door.w / 2 - 2, 26, 14), stripeMat);
      stripe.position.y = -door.h / 2 + 120;
      m.add(stripe);
      const gasket = new THREE.Mesh(new THREE.BoxGeometry(1.5, door.h, 13), gasketMat);
      gasket.position.x = (-side * door.w) / 4 + side * 0.75;
      m.add(gasket);
      return m;
    };
    for (const side of [-1, 1]) {
      const m = half(side);
      m.position.set(x, door.h / 2, z1 + wall / 2);
      this.doors.push(m);
      g.add(m);
      const far = half(side);
      far.position.set(x + (side * door.w) / 4, door.h / 2, z1 + wall + d - 6);
      g.add(far);
    }
    // the green lamp over the doorway, on the lab's side: a lens in a dark housing, and a glow round it (a glow, not a
    // light, since every light in the scene costs every surface it might fall on)
    const housing = new THREE.Mesh(new THREE.BoxGeometry(70, 30, 12), darkMat);
    housing.position.set(x, door.h + 70, z1 - 6);
    g.add(housing);
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x15361c, emissive: 0x3dff6a, emissiveIntensity: 0 });
    const lens = new THREE.Mesh(new THREE.BoxGeometry(56, 18, 4), this.lamp);
    lens.position.set(x, door.h + 70, z1 - 13);
    g.add(lens);
    this.lampGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(2), color: 0x3dff6a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.lampGlow.scale.set(220, 220, 1);
    this.lampGlow.position.set(x, door.h + 70, z1 - 20);
    g.add(this.lampGlow);
    // the pod: a plinth, a metal shell, its body round all but its door, under a whole dome, and its door: POD.arc of
    // the body's round, facing the lab, hinged on its edge toward +x, swinging out
    const shell = new THREE.MeshStandardMaterial({ color: 0x8c9692, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide });
    const pod = new THREE.Group();
    pod.position.set(POD.x, 0, POD.z);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(POD.r + 10, POD.r + 14, POD.base, 48), darkMat);
    plinth.position.y = POD.base / 2;
    pod.add(plinth);
    const body = POD.top - POD.base;
    // three.js puts theta 0 at +z, and the door faces the lab, −z: theta π
    const [d0, d1] = [Math.PI - POD.arc / 2, Math.PI + POD.arc / 2];
    const back = new THREE.Mesh(new THREE.CylinderGeometry(POD.r + 2, POD.r + 2, body, 48, 1, true, d1, 2 * Math.PI - POD.arc), shell);
    back.position.y = POD.base + body / 2;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(POD.r + 2, 48, 16, 0, 2 * Math.PI, 0, Math.PI / 2), shell);
    dome.position.y = POD.top;
    pod.add(back, dome);
    const band = new THREE.Mesh(new THREE.TorusGeometry(POD.r + 3, 3, 8, 48).rotateX(Math.PI / 2), darkMat);
    band.position.y = POD.top;
    pod.add(band);
    const hinge = new THREE.Vector3(POD.r * Math.sin(d0), 0, POD.r * Math.cos(d0));
    const leaf = new THREE.Mesh(new THREE.CylinderGeometry(POD.r, POD.r, body, 16, 1, true, d0, POD.arc), shell);
    leaf.castShadow = true;
    leaf.position.set(-hinge.x, POD.base + body / 2, -hinge.z);
    this.front.position.copy(hinge);
    this.front.add(leaf);
    pod.add(this.front);
    // two dim emergency lights in the pod's ceiling, either side, a little in front of the face: the only light while
    // it's shut (see View.render)
    for (const side of [-1, 1]) {
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(3, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0x5a3010, emissive: 0xff9a3c, emissiveIntensity: 0.8 }),
      );
      const at = new THREE.Vector3(side * 36, POD.top + 25, -40);
      bulb.position.copy(at);
      pod.add(bulb);
      const light = new THREE.PointLight(0xff9a3c, 300, 300, 2);
      light.position.copy(at).add(new THREE.Vector3(0, -8, 0));
      pod.add(light);
    }
    // the message, projected on the inside of the front, in front of the face, facing in (see setMessage), with its OK
    // button
    this.pod = pod;
    this.eye = eye;
    const unit = MESSAGE_W / MSG_PX;
    this.ok = new THREE.Mesh(
      new THREE.PlaneGeometry(OK_PX.w * unit, OK_PX.h * unit),
      new THREE.MeshBasicMaterial({ map: this.okTex[0], transparent: true, depthWrite: false, toneMapped: false }),
    );
    pod.add(this.ok);
    pickables.set(this.ok, { kind: 'wake' });
    this.setMessage(notice());
    // the pod is all that's left at Mu Ceti (see View.renderArrival)
    pod.traverse((o) => o.layers.enable(VOID_LAYER));
    g.add(pod);
    scene.add(g);
  }

  /** Project these blocks as the message, its OK button at its bottom right. */
  private setMessage(blocks: readonly Block[]): void {
    if (this.message) {
      this.message.removeFromParent();
      this.message.geometry.dispose();
      const m = this.message.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    }
    const tex = new THREE.CanvasTexture(messageCanvas(blocks));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const img = tex.image as HTMLCanvasElement;
    const mh = (MESSAGE_W * img.height) / img.width;
    const msgMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    this.message = new THREE.Mesh(new THREE.PlaneGeometry(MESSAGE_W, mh), msgMat);
    // it hangs a little low, so the eyes start on its heading and look down to OK; a short one, at the eyes
    const cy = this.eye + Math.min(27, 2 + mh / 2) - mh / 2;
    this.message.position.set(0, cy, -MESSAGE_AT);
    this.message.layers.set(this.ok.layers.mask === 1 ? 0 : 1);
    this.pod.add(this.message);
    const unit = MESSAGE_W / MSG_PX;
    this.ok.position.set(MESSAGE_W / 2 - (MSG_PAD + OK_PX.w / 2) * unit, cy - mh / 2 + (MSG_PAD + OK_PX.h / 2) * unit, -MESSAGE_AT + 0.3);
  }

  update(a: AirlockLook): void {
    const said = a.notice.arrival ? 'arrival' : a.notice.litres.toFixed(2);
    if (said !== this.said) {
      this.said = said;
      this.setMessage(a.notice.arrival ? arrival() : notice(a.notice.litres));
    }
    const l = this.last;
    if (l && l.door === a.door && l.front === a.front && l.dark === a.dark && l.message === a.message && l.okHot === a.okHot && l.lamp === a.lamp) return;
    this.last = { ...a };
    this.lamp.emissiveIntensity = a.lamp ? 1.6 : 0;
    this.lampGlow.visible = a.lamp;
    const { x, door } = AIRLOCK;
    for (const m of this.doors) m.position.x = x + m.userData.side * (door.w / 4 + a.door * (door.w / 2 + 6));
    // its door swings out on its hinge
    this.front.rotation.y = -a.front * POD.swing;
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

/**
 * The faucets: a manifold along a wall, and each faucet a pipe out over the counter, a knob of its color (the
 * solvent's clear, see View.update), and a spout.
 */
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

/**
 * The thing a pick is part of, to outline all of it: a tool for any of its parts, a faucet for its knob or spout. The
 * cryostabilizer station, built into the wall, is outlined a part at a time: its funnel, its reservoir's window, or one
 * of its two faucets (its spout's pipe, with its valve); its plate, nothing. Null for nothing.
 */
function thingOf(p: Pick): unknown {
  switch (p.kind) {
    case 'flask': return p.f;
    case 'tool': {
      const { t } = p;
      if (!t.shape.wall) return t;
      if (p.part === 'tank') return `tool ${t.id} tank ${p.k}`;
      if (p.part === 'spout') return `tool ${t.id} spout ${p.k}`;
      if (p.part === 'valve') return `tool ${t.id} spout ${t.shape.spouts.indexOf(valveLocal(t, p.k).x)}`;
      return null;
    }
    case 'scale': return p.sc;
    case 'hose': return p.h;
    case 'faucet': return `faucet ${p.i}`;
    default: return p.kind;
  }
}

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * The outline round whatever the crosshair is on (see OUTLINE in outline.ts), drawn over the finished frame. Its
 * silhouette, the whole of it whatever's in front, goes into a mask; then each pixel finds how far it is from the
 * mask, along its row and then down its column (the nearest along each row first, so the second pass gets the true
 * distance), and the pixels within the outline's width of it are painted, the outermost blended for a smooth edge.
 */
class Outliner {
  private mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private rows = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private silhouette = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  /** Along each row: how many pixels off the nearest masked pixel is, over 255; 0 in the mask, 1 for none in reach. */
  private across = new THREE.ShaderMaterial({
    uniforms: { mask: { value: null }, texel: { value: new THREE.Vector2() }, reach: { value: 1 } },
    vertexShader: quadVertex,
    fragmentShader: /* glsl */ `
      uniform sampler2D mask;
      uniform vec2 texel;
      uniform int reach;
      varying vec2 vUv;
      bool on(float dx) { return texture2D(mask, vUv + vec2(dx * texel.x, 0.0)).r > 0.5; }
      void main() {
        float d = 255.0;
        if (on(0.0)) d = 0.0;
        else for (int i = 1; i <= reach; i++) if (on(float(i)) || on(-float(i))) { d = float(i); break; }
        gl_FragColor = vec4(d / 255.0, 0.0, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  /** Down each column: the distance to the mask, and the outline's color as far out as its width. */
  private down = new THREE.ShaderMaterial({
    uniforms: {
      rows: { value: null }, texel: { value: new THREE.Vector2() }, reach: { value: 1 }, width: { value: 1 },
      color: { value: new THREE.Color() },
    },
    vertexShader: quadVertex,
    fragmentShader: /* glsl */ `
      uniform sampler2D rows;
      uniform vec2 texel;
      uniform int reach;
      uniform float width;
      uniform vec3 color;
      varying vec2 vUv;
      void main() {
        float best = 1e4;
        for (int j = -reach; j <= reach; j++) {
          float h = texture2D(rows, vUv + vec2(0.0, float(j) * texel.y)).r * 255.0;
          if (h < 254.5) best = min(best, length(vec2(h, float(j))));
        }
        float a = clamp(width + 0.5 - best, 0.0, 1.0);
        if (best < 0.5 || a <= 0.0) discard;
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.across);
  private quadScene = new THREE.Scene().add(this.quad);
  private quadCamera = new THREE.Camera();
  private size = new THREE.Vector2();
  private clear = new THREE.Color();

  constructor() {
    this.quad.frustumCulled = false;
  }

  /** Outline `meshes` over what `renderer` last drew of `scene`. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, meshes: THREE.Object3D[]): void {
    const width = OUTLINE.width * renderer.getPixelRatio();
    if (width <= 0 || !meshes.length) return;
    const reach = Math.min(254, Math.ceil(width + 0.5));
    const { x: w, y: h } = renderer.getDrawingBufferSize(this.size);
    if (this.mask.width !== w || this.mask.height !== h) {
      this.mask.setSize(w, h);
      this.rows.setSize(w, h);
    }

    // the silhouette, alone on a layer of its own, with no background, shadows or lights
    for (const m of meshes) m.layers.enable(OUTLINE_LAYER);
    const bg = scene.background;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    scene.background = null;
    scene.overrideMaterial = this.silhouette;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);
    camera.layers.set(OUTLINE_LAYER);
    renderer.setRenderTarget(this.mask);
    renderer.render(scene, camera);
    camera.layers.set(0);
    scene.overrideMaterial = null;
    scene.background = bg;
    renderer.shadowMap.autoUpdate = true;
    for (const m of meshes) m.layers.disable(OUTLINE_LAYER);

    const texel = new THREE.Vector2(1 / w, 1 / h);
    const a = this.across.uniforms;
    a.mask.value = this.mask.texture;
    a.texel.value = texel;
    a.reach.value = reach;
    this.quad.material = this.across;
    renderer.setRenderTarget(this.rows);
    renderer.render(this.quadScene, this.quadCamera);

    const u = this.down.uniforms;
    u.rows.value = this.rows.texture;
    u.texel.value = texel;
    u.reach.value = reach;
    u.width.value = width;
    (u.color.value as THREE.Color).set(OUTLINE.color);
    this.quad.material = this.down;
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = true;
    renderer.setClearColor(this.clear, clearAlpha);
  }

  dispose(): void {
    this.mask.dispose();
    this.rows.dispose();
  }
}

/** Draws the lab with Three.js, from the player's eyes, and says what's under the crosshair. */
export class View {
  /** The field of view is 90°, top to bottom. */
  readonly camera = new THREE.PerspectiveCamera(90, 1, 2, 8000);
  private renderer: THREE.WebGLRenderer;
  /** What the white void of Mu Ceti is drawn with (see renderArrival), once it's needed. */
  private void?: ReturnType<View['buildVoid']>;
  private scene = new THREE.Scene();
  private pickables = new Map<THREE.Object3D, Pick>();
  private flasks = new Map<Flask, FlaskView>();
  private tools = new Map<Tool, ToolView>();
  private scales = new Map<Scale, ScaleView>();
  private hoses = new Map<Hose, HoseView>();
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
  private outliner = new Outliner();
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
    this.stars.rotation.x = fr.spin;

    this.sync(this.flasks, fr.flasks, (f) => new FlaskView(f, scene, pickables));
    this.sync(this.tools, fr.tools, (t) => new ToolView(t, scene, pickables));
    this.sync(this.scales, fr.scales, (s) => new ScaleView(s, scene, pickables));
    this.sync(this.hoses, fr.hoses.map((x) => x.h), (h) => new HoseView(h, scene, pickables));
    // the vessels guides end at flash
    const targets = new Set(fr.guides.map((g) => g.v));
    flashMat.opacity = FLASH.lo + (FLASH.hi - FLASH.lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * FLASH.hz * this.clock));
    for (const v of this.flasks.values()) v.update(targets);
    for (const v of this.tools.values()) v.update(fr.clock, fr.energies, targets);
    for (const v of this.scales.values()) v.update(fr.tarePress === v.sc, fr.hot);
    for (const { h, from, fluid } of fr.hoses) this.hoses.get(h)!.update(from, fluid);
    fr.faucets.forEach((fa, i) => {
      const rgb = fluidRGB(fa.output);
      const mat = this.faucetMats[i];
      if (rgb && mat) {
        setRGB(mat.color, rgb);
        // a knob for a clear fluid is clear too, like glossy acrylic, but never so clear it's hard to see
        mat.opacity = Math.max(KNOB_ALPHA, fluidAlpha(fa.output));
        if (mat.transparent !== mat.opacity < 1) {
          mat.transparent = mat.opacity < 1;
          mat.needsUpdate = true;
        }
      }
      this.faucetNotes[i]?.set(fa.note);
    });

    this.updateStands(fr);
    this.updateStreams(fr);
    this.updateGuides(fr);

    this.alarmButton.update(fr.alarmsOff);
    this.blindsButton.update(fr.blindsShut);
    this.airlock.update(fr.airlock);
    // the beacon turns slowly, on sim time like everything else in the lab
    const pulse = 0.5 + 0.5 * Math.sin(fr.clock * 2.4);
    const lit = 1 - fr.airlock.dark;
    for (const { light, base } of this.roomLights) light.intensity = base * lit;
    scene.environmentIntensity = lit;
    this.beacon.beacon.intensity = 9000 * pulse * pulse * lit;
    (this.beacon.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 1.2 * pulse;

    if (fr.airlock.arrival) {
      this.renderArrival(fr.airlock.front);
      return;
    }
    // the views behind see-through fluids, bent (see bentMat), are on a layer of their own, drawn only here
    this.renderer.getDrawingBufferSize(refractScreen.value);
    this.renderer.transmissionResolutionScale = REFRACT.scale;
    this.camera.layers.enable(REFRACT_LAYER);
    this.renderer.render(scene, this.camera);
    this.camera.layers.disable(REFRACT_LAYER);
    this.renderGuides();
    this.renderOutline(fr.hot);
  }

  /**
   * The pod in the white void of Mu Ceti, and nothing else (see ARRIVAL): it's drawn on a layer of its own, inside a
   * sphere far brighter than white, lit by white light from out in front and all round, pouring in as far as its front
   * is `open`, with what's brighter than the bloom's threshold bleeding over everything, and toned down to the screen.
   */
  private renderArrival(open: number): void {
    const { renderer, scene, camera } = this;
    const v = (this.void ??= this.buildVoid());
    v.sky.material.color.setScalar(ARRIVAL.void);
    v.sun.intensity = ARRIVAL.light * open;
    v.fill.intensity = ARRIVAL.ambient * open;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (size.x !== v.size.x || size.y !== v.size.y) {
      v.size.copy(size);
      v.composer.setPixelRatio(1);
      v.composer.setSize(size.x, size.y);
    }
    Object.assign(v.bloom, { strength: ARRIVAL.bloom, radius: ARRIVAL.radius, threshold: ARRIVAL.threshold });
    const [bg, env, envI] = [scene.background, scene.environment, scene.environmentIntensity];
    scene.background = null;
    scene.environment = v.env;
    scene.environmentIntensity = open;
    camera.layers.set(VOID_LAYER);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = ARRIVAL.exposure;
    v.composer.render();
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    camera.layers.set(0);
    [scene.background, scene.environment, scene.environmentIntensity] = [bg, env, envI];
  }

  /** What renderArrival draws with, made the first time it's needed. */
  private buildVoid() {
    const { renderer, scene, camera } = this;
    const at = new THREE.Vector3(POD.x, 600, POD.z);
    const onVoid = <T extends THREE.Object3D>(o: T): T => {
      o.layers.set(VOID_LAYER);
      scene.add(o);
      return o;
    };
    // the void: a sphere round the pod, seen from inside, brighter than white
    const sky = onVoid(
      new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false })),
    );
    sky.position.copy(at);
    // the light pouring in from out in front, and from all round
    const sun = onVoid(new THREE.DirectionalLight(0xffffff, 0));
    sun.position.set(at.x, at.y + 300, at.z - 3000);
    sun.target.position.copy(at);
    scene.add(sun.target);
    const fill = onVoid(new THREE.HemisphereLight(0xffffff, 0xffffff, 0));
    // what its metal reflects: white all round
    const white = new THREE.Scene();
    white.background = new THREE.Color(0xffffff);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(white).texture;
    pmrem.dispose();
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), ARRIVAL.bloom, ARRIVAL.radius, ARRIVAL.threshold);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return { sky, sun, fill, env, composer, bloom, size: new THREE.Vector2() };
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

  /** The outline round everything that's part of what the crosshair is on (see Outliner). */
  private renderOutline(hot: Pick | null): void {
    if (!hot) return;
    const thing = thingOf(hot);
    if (thing === null) return;
    const meshes = [...this.pickables].filter(([, p]) => thingOf(p) === thing).map(([o]) => o);
    this.outliner.render(this.renderer, this.scene, this.camera, meshes);
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
      m.position.set(g.from.x, g.from.y - len / 2, g.from.z);
      m.scale.set(GUIDE_R, len, GUIDE_R);
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
    this.outliner.dispose();
    this.renderer.dispose();
  }
}

