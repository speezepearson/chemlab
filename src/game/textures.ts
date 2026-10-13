import * as THREE from 'three';
import { TILES, type Baked, type SurfaceName } from './surfaces';

/**
 * The room's surfaces as materials (see surfaces.ts for how they're painted). Painting them takes a second or more,
 * so a worker does it while the lab starts: each material is plain, in its surface's color, until its maps arrive.
 */

/** Each surface's color while its maps are on their way, near its average. */
const PLAIN: Record<SurfaceName, number> = {
  deck: 0x2c3234,
  walls: 0xb4bcb9,
  ceiling: 0x6f7675,
  brushedSteel: 0x9aa3a4,
  grate: 0x2c3132,
  epoxy: 0x1c1f1f,
  cabinet: 0x949d99,
};

const waiting = new Map<SurfaceName, THREE.MeshStandardMaterial[]>();
const arrived = new Map<SurfaceName, { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }>();
let worker: Worker | null = null;
let onAll: (() => void) | null = null;

function texture(data: Uint8Array<ArrayBuffer>, w: number, h: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  // three.js holds this to what the hardware allows
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function receive(name: SurfaceName, b: Baked): void {
  const maps = {
    map: texture(b.color, b.w, b.h, true),
    normalMap: texture(b.normal, b.w, b.h, false),
    roughnessMap: texture(b.rough, b.w, b.h, false),
  };
  arrived.set(name, maps);
  for (const m of waiting.get(name) ?? []) dress(m, name);
  waiting.delete(name);
  if (!waiting.size && onAll) {
    onAll();
    onAll = null;
  }
}

/** Put a surface's maps on a material, its color now coming from them (times any tint it was given). */
function dress(m: THREE.MeshStandardMaterial, name: SurfaceName): void {
  const maps = arrived.get(name)!;
  Object.assign(m, maps);
  if (m.userData.tint === undefined) m.color.set(0xffffff);
  else m.color.set(m.userData.tint as number);
  m.roughness = 1;
  if (m.userData.glowMap) m.emissiveMap = maps.map;
  m.needsUpdate = true;
}

/**
 * A material for a surface, plain until its maps arrive. `tint` multiplies the maps' color; `glowMap` makes its
 * emissive color come from the color map too.
 */
export function surfaceMat(name: SurfaceName, opts: THREE.MeshStandardMaterialParameters & { tint?: number; glowMap?: boolean } = {}): THREE.MeshStandardMaterial {
  const { tint, glowMap, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({ color: tint ?? PLAIN[name], roughness: 0.6, ...rest });
  m.userData.tint = tint;
  m.userData.glowMap = glowMap;
  if (arrived.has(name)) dress(m, name);
  else {
    const was = waiting.get(name);
    if (was) was.push(m);
    else {
      waiting.set(name, [m]);
      paint(name);
    }
  }
  return m;
}

function paint(name: SurfaceName): void {
  if (typeof Worker === 'undefined') return;
  if (!worker) {
    worker = new Worker(new URL('./surfaceWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<{ name: SurfaceName; baked: Baked }>) => receive(e.data.name, e.data.baked));
  }
  worker.postMessage(name);
}

/** Call `f` once every surface asked for so far has its maps (at once if they all do). */
export function whenSurfaced(f: () => void): void {
  if (!waiting.size) f();
  else onAll = f;
}

/**
 * Give a box-like geometry texture coordinates in world units divided by the surface's tile, projected along each
 * face's normal from the geometry's own lower corner, so a texture keeps its scale on every face of every size of box.
 * `tile` overrides the surface's tile per axis: across on x, up on y, front to back on z (for whole doors, say).
 */
export function boxUV(geom: THREE.BufferGeometry, name: SurfaceName, tile: Partial<{ x: number; y: number; z: number }> = {}): THREE.BufferGeometry {
  geom.computeBoundingBox();
  const lo = geom.boundingBox!.min;
  const pos = geom.attributes.position;
  const nrm = geom.attributes.normal;
  const tx = tile.x ?? TILES[name].u;
  const ty = tile.y ?? TILES[name].v;
  const tz = tile.z ?? TILES[name].u;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i) - lo.x, pos.getY(i) - lo.y, pos.getZ(i) - lo.z];
    const [ax, ay, az] = [Math.abs(nrm.getX(i)), Math.abs(nrm.getY(i)), Math.abs(nrm.getZ(i))];
    if (ay >= ax && ay >= az) [uv[i * 2], uv[i * 2 + 1]] = [x / tx, z / tz];
    else if (ax >= az) [uv[i * 2], uv[i * 2 + 1]] = [z / tz, y / ty];
    else [uv[i * 2], uv[i * 2 + 1]] = [x / tx, y / ty];
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}

/**
 * Give a flat geometry in its own x-y plane texture coordinates in world units divided by the surface's tile, with
 * (x0, y0) at the corner of a copy.
 */
export function planeUV(geom: THREE.BufferGeometry, name: SurfaceName, x0: number, y0: number): THREE.BufferGeometry {
  const pos = geom.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - x0) / TILES[name].u;
    uv[i * 2 + 1] = (pos.getY(i) - y0) / TILES[name].v;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}
