/**
 * The room's surfaces, made rather than downloaded: each is a color map, a normal map and a roughness map, worked out
 * pixel by pixel from a height field and some noise, and every one tiles seamlessly. This is pure computation, run in
 * a worker (see textures.ts), since the bigger ones take a while.
 *
 * Each surface's texture covers a fixed patch in world units (its tile, in TILES), and the geometry it goes on gets
 * its texture coordinates in those units, so one texture serves every wall or counter, however big, at one scale.
 */

/** The surfaces there are. */
export type SurfaceName = 'deck' | 'walls' | 'ceiling' | 'brushedSteel' | 'grate' | 'epoxy' | 'cabinet';

/** How much world one copy of each surface's texture covers, across (u) and up (v). */
export const TILES: Record<SurfaceName, { u: number; v: number }> = {
  // two grid cells by two (see CELL), so the plates' seams run along cells' edges
  deck: { u: 400, v: 400 },
  // the room's height (see ROOM): three panels from floor to ceiling
  walls: { u: 440, v: 1300 },
  ceiling: { u: 500, v: 500 },
  brushedSteel: { u: 160, v: 160 },
  grate: { u: 160, v: 160 },
  epoxy: { u: 300, v: 300 },
  // one door; callers size it so a whole number fit
  cabinet: { u: 250, v: 396 },
};

/** A surface's maps, as RGBA rows from the bottom up (as a texture's v runs), w by h. */
export interface Baked {
  w: number;
  h: number;
  color: Uint8Array<ArrayBuffer>;
  normal: Uint8Array<ArrayBuffer>;
  rough: Uint8Array<ArrayBuffer>;
}

/** A seeded random in [0, 1) (mulberry32), so the room looks the same every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0, 1) at (u, v) in [0, 1) of the texture, `period` cells across, wrapping at the edges. */
function noise(seed: number, period: number): (u: number, v: number) => number {
  const r = rng(seed);
  const g = Float32Array.from({ length: period * period }, () => r());
  return (u, v) => {
    const x = u * period;
    const y = v * period;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i0 = ((xi % period) + period) % period;
    const j0 = ((yi % period) + period) % period;
    const i1 = (i0 + 1) % period;
    const j1 = (j0 + 1) % period;
    const a = g[j0 * period + i0] + (g[j0 * period + i1] - g[j0 * period + i0]) * sx;
    const b = g[j1 * period + i0] + (g[j1 * period + i1] - g[j1 * period + i0]) * sx;
    return a + (b - a) * sy;
  };
}

/** Fractal noise in [0, 1): `octaves` of noise, each twice as fine and half as strong as the last; it tiles. */
function fbm(seed: number, period: number, octaves: number, px = period, py = period): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, k) => noise(seed + k * 101, period << k));
  // stretched noise (brushed metal) samples one way more finely than the other
  const [kx, ky] = [px / period, py / period];
  return (u, v) => {
    let s = 0;
    let w = 0;
    let a = 1;
    for (const n of layers) {
      s += n(u * kx, v * ky) * a;
      w += a;
      a /= 2;
    }
    return s / w;
  };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hex = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Signed distance from (x, y) to a rectangle with corners rounded by r, centered on (cx, cy), half hw by hh. */
function roundRect(x: number, y: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance from (x, y) to the segment from (ax, ay) to (bx, by). */
function segment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const t = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

/** One pixel of a surface, filled in by its painter: its color (0..255 sRGB), roughness, height and occlusion. */
interface Px {
  rgb: [number, number, number];
  rough: number;
  /** In pixels, for the normal map's slopes. */
  height: number;
  /** 1 open, 0 fully shut in: darkens the color. */
  ao: number;
}

/**
 * Paint a w by h surface pixel by pixel with `paint` (given x, y in pixels, y down, and u, v in [0, 1)), and make its
 * maps. `bump` scales the slopes in the normal map.
 */
function bake(w: number, h: number, bump: number, paint: (x: number, y: number, u: number, v: number, p: Px) => void): Baked {
  const color = new Uint8Array(w * h * 4);
  const rough = new Uint8Array(w * h * 4);
  const normal = new Uint8Array(w * h * 4);
  const height = new Float32Array(w * h);
  const p: Px = { rgb: [0, 0, 0], rough: 0.5, height: 0, ao: 1 };
  const byte = (x: number) => Math.round(Math.max(0, Math.min(255, x)));
  // painted y down, as on a canvas; stored bottom row first
  const out = (x: number, y: number) => ((h - 1 - y) * w + x) * 4;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      p.rgb = [128, 128, 128];
      p.rough = 0.5;
      p.height = 0;
      p.ao = 1;
      paint(x, y, x / w, y / h, p);
      const i = out(x, y);
      for (let c = 0; c < 3; c++) color[i + c] = byte(p.rgb[c] * p.ao);
      color[i + 3] = 255;
      // three.js reads roughness from the green channel
      rough[i] = rough[i + 1] = rough[i + 2] = byte(clamp01(p.rough) * 255);
      rough[i + 3] = 255;
      height[y * w + x] = p.height;
    }
  // slopes across the height field, wrapping, so the normals tile too; y runs down where texture v runs up
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * 0.5 * bump;
      const ny = (at(x, y + 1) - at(x, y - 1)) * 0.5 * bump;
      const l = Math.hypot(nx, ny, 1);
      const i = out(x, y);
      normal[i] = byte((nx / l / 2 + 0.5) * 255);
      normal[i + 1] = byte((ny / l / 2 + 0.5) * 255);
      normal[i + 2] = byte((1 / l / 2 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  return { w, h, color, normal, rough };
}

/**
 * The deck: 2 by 2 steel plates, each 200 across, with raised diamond tread inside a smooth border, a bolt at each
 * corner, worn bright where feet go and grimy in the seams.
 */
function deck(): Baked {
  const N = 1024;
  const P = N / 2;
  const grime = fbm(11, 4, 5);
  const wear = fbm(12, 16, 4);
  const speck = noise(13, 256);
  const base = hex(0x2f3537);
  const bright = hex(0x7d8587);
  const dirt = hex(0x1b1e1d);
  const CELL = 26;
  return bake(N, N, 2.2, (x, y, u, v, p) => {
    const px = x % P;
    const py = y % P;
    const edge = Math.min(px, P - px, py, P - py);
    let hgt = 0;
    let rough = 0.62;
    // a groove between plates, and a little bevel up to each plate's face
    const plate = smooth(2, 7, edge);
    hgt = plate * 2;
    // the tread: lozenges at right angles to their neighbours, inside a border
    let tread = 0;
    if (edge > 30) {
      const [cx, cy] = [Math.floor(px / CELL), Math.floor(py / CELL)];
      const [lx, ly] = [px - (cx + 0.5) * CELL, py - (cy + 0.5) * CELL];
      const s = (cx + cy) % 2 === 0 ? 1 : -1;
      const L = CELL * 0.28;
      const d = segment(lx, ly, -L, -L * s, L, L * s);
      tread = smooth(3.2, 1.6, d) * smooth(30, 34, edge);
      hgt += tread * 2.5;
    }
    // a domed bolt in each plate's corner
    for (const [bx, by] of [[16, 16], [P - 16, 16], [16, P - 16], [P - 16, P - 16]]) {
      const d = Math.hypot(px - bx, py - by);
      if (d < 7) {
        hgt = 2 + Math.sqrt(Math.max(0, 49 - d * d)) * 0.5;
        tread = Math.max(tread, 0.8);
      }
      if (d >= 7 && d < 9) hgt -= 0.5;
    }
    const g = grime(u, v);
    const worn = smooth(0.45, 0.8, wear(u, v)) * tread;
    let c = mix(base, bright, worn * 0.55 + tread * 0.1);
    c = mix(c, dirt, smooth(0.5, 0.8, g) * 0.5 + (1 - plate) * 0.6);
    const sp = (speck(u, v) - 0.5) * 14;
    p.rgb = [c[0] + sp, c[1] + sp, c[2] + sp];
    rough = 0.66 - worn * 0.3 + (g - 0.5) * 0.2;
    p.rough = rough;
    p.height = hgt;
    p.ao = 0.55 + 0.45 * plate;
  });
}

/**
 * The walls: two columns of three light panels, each 220 across and a third of the room high (so the seams meet the
 * floor and ceiling), with a raised field inside a bevel, a screw at each corner of it, and seams between; the top
 * right one has a grille. Faintly mottled.
 */
function walls(): Baked {
  const W = 1024;
  const H = 2048;
  const HP = W / 2;
  const VP = Math.round(H / 3);
  const mottle = fbm(21, 6, 5);
  const fine = noise(22, 512);
  const smudge = fbm(23, 3, 4);
  const field = hex(0xc0c7c4);
  const field2 = hex(0xb6bebb);
  const seam = hex(0x5c6462);
  return bake(W, H, 1.6, (x, y, u, v, p) => {
    const k = x < HP ? 0 : 1;
    const row = Math.min(2, Math.floor(y / VP));
    const px = x - k * HP;
    const py = y - row * VP;
    const ph = row === 2 ? H - 2 * VP : VP;
    const edge = Math.min(px, HP - px, py, ph - py);
    const groove = smooth(1.5, 4, edge);
    // the raised field, inset from the seams
    const d = roundRect(px, py, HP / 2, ph / 2, HP / 2 - 26, ph / 2 - 26, 14);
    const raise = smooth(6, -6, d);
    let hgt = groove * 1.5 + raise * 2.5;
    let ao = 0.6 + 0.4 * groove;
    ao *= 1 - 0.12 * smooth(-2, 6, d) * smooth(14, 6, d);
    // screws in the field's corners
    for (const [sx, sy] of [[40, 40], [HP - 40, 40], [40, ph - 40], [HP - 40, ph - 40]]) {
      const r = Math.hypot(px - sx, py - sy);
      if (r < 6) {
        hgt = 4 + Math.sqrt(36 - r * r) * 0.3;
        // a slot across the head
        if (Math.abs(px - sx - (py - sy)) < 1.2) hgt -= 1.5;
      }
      if (r >= 6 && r < 7.5) ao *= 0.75;
    }
    // a grille of slots near the top of one panel
    if (k === 1 && row === 0)
      for (let j = 0; j < 6; j++) {
        const dd = roundRect(px, py, HP / 2, 110 + j * 18, 120, 4, 4);
        if (dd < 0) {
          hgt -= smooth(0, -3, dd) * 3;
          ao *= 0.35 + 0.65 * smooth(-4, 0, dd);
        }
      }
    const m = mottle(u, v);
    let c = mix((k + row) % 2 ? field2 : field, field2, m * 0.4);
    c = mix(c, hex(0x8f9794), smooth(0.55, 0.85, smudge(u, v)) * 0.25);
    c = mix(c, seam, 1 - groove);
    const f = (fine(u, v) - 0.5) * 6;
    p.rgb = [c[0] + f, c[1] + f, c[2] + f];
    p.rough = 0.62 + (m - 0.5) * 0.15 + (1 - groove) * 0.2;
    p.height = hgt + (fine(u, v) - 0.5) * 0.25;
    p.ao = ao;
  });
}

/** The ceiling: perforated acoustic tiles, 2 by 2, each 250 across, in a dark grid. */
function ceiling(): Baked {
  const N = 1024;
  const P = N / 2;
  const mottle = fbm(31, 5, 4);
  const tileC = hex(0x8a9290);
  const grid = hex(0x353b3a);
  return bake(N, N, 1.4, (x, y, u, v, p) => {
    const px = x % P;
    const py = y % P;
    const edge = Math.min(px, P - px, py, P - py);
    const frame = smooth(8, 11, edge);
    let hgt = frame * 2;
    let ao = 0.7 + 0.3 * frame;
    if (edge > 30) {
      const [dx, dy] = [((px % 16) + 16) % 16 - 8, ((py % 16) + 16) % 16 - 8];
      const r = Math.hypot(dx, dy);
      if (r < 2.6) {
        hgt -= 1.5;
        ao *= 0.35;
      }
    }
    const c = mix(mix(tileC, grid, 1 - frame), hex(0x767e7c), mottle(u, v) * 0.3);
    p.rgb = c;
    p.rough = 0.85;
    p.height = hgt;
    p.ao = ao;
  });
}

/** Brushed stainless steel: fine streaks running across (u), a little wear. 160 across, 160 high. */
function brushedSteel(): Baked {
  const N = 512;
  const streak = fbm(41, 2, 6, 2, 128);
  const blotch = fbm(42, 3, 4);
  const steel = hex(0x9aa3a4);
  return bake(N, N, 0.6, (_x, _y, u, v, p) => {
    const s = streak(u, v);
    const b = blotch(u, v);
    const t = (s - 0.5) * 30 + (b - 0.5) * 16;
    p.rgb = [steel[0] + t, steel[1] + t, steel[2] + t];
    p.rough = 0.32 + (s - 0.5) * 0.25 + smooth(0.55, 0.8, b) * 0.12;
    p.height = s * 1.2;
  });
}

/** A drain grate: slots through dark steel, 160 across. */
function grate(): Baked {
  const N = 512;
  const grime = fbm(51, 4, 4);
  const bar = hex(0x464d4e);
  const hole = hex(0x060707);
  const SX = 64;
  const SY = 32;
  return bake(N, N, 2, (x, y, u, v, p) => {
    const row = Math.floor(y / SY);
    const ox = row % 2 ? SX / 2 : 0;
    const lx = (((x + ox) % SX) + SX) % SX - SX / 2;
    const ly = (y % SY) - SY / 2;
    const d = roundRect(lx, ly, 0, 0, SX / 2 - 9, SY / 2 - 9, 6);
    const open = smooth(1.5, -1.5, d);
    const g = grime(u, v);
    const c = mix(mix(bar, hex(0x2a2f30), g * 0.5), hole, open);
    p.rgb = c;
    p.rough = 0.5 + g * 0.2 + open * 0.4;
    p.height = (1 - open) * 3;
    p.ao = 1 - open * 0.6 - smooth(4, 0, Math.abs(d)) * 0.15;
  });
}

/** Black epoxy resin, as on lab benches: faintly speckled, with a soft, uneven sheen. 300 across. */
function epoxy(): Baked {
  const N = 512;
  const speck = noise(61, 512);
  const speck2 = noise(62, 256);
  const sheen = fbm(63, 3, 4);
  return bake(N, N, 0.3, (_x, _y, u, v, p) => {
    const s = speck(u, v);
    const s2 = speck2(u, v);
    const dot = smooth(0.82, 0.9, s) * 30 + smooth(0.85, 0.95, s2) * 18;
    const b = 26 + dot;
    p.rgb = [b - 2, b + 1, b + 1];
    p.rough = 0.28 + sheen(u, v) * 0.18;
    p.height = s2 * 0.4;
  });
}

/**
 * Cabinet fronts: one door per copy, its edges a narrow gap, painted steel with a fine orange-peel texture; the door
 * spans its tile, which callers size so a whole number fit (see boxUV).
 */
function cabinet(): Baked {
  const W = 512;
  const H = 1024;
  const peel = noise(71, 160);
  const mottle = fbm(72, 4, 4);
  const paint = hex(0x9fa8a4);
  return bake(W, H, 1.5, (x, y, u, v, p) => {
    const edge = Math.min(x, W - x, y, H - y);
    const gap = smooth(3, 6, edge);
    // a shallow pressed panel in the door's middle
    const d = roundRect(x, y, W / 2, H / 2, W / 2 - 46, H / 2 - 60, 20);
    const press = smooth(-4, 4, d);
    let c = mix(paint, hex(0x8b9490), mottle(u, v) * 0.5);
    c = mix(c, hex(0x2a2f2e), (1 - gap) * 0.9);
    const pe = peel(u, v);
    p.rgb = c;
    p.rough = 0.48 + (pe - 0.5) * 0.12 + (1 - gap) * 0.4;
    p.height = gap * 2 + press * 1.5 + pe * 0.35;
    p.ao = (0.4 + 0.6 * gap) * (1 - 0.1 * smooth(0, 4, d) * smooth(8, 4, d));
  });
}

/** Make a surface's maps. */
export function paintSurface(name: SurfaceName): Baked {
  return { deck, walls, ceiling, brushedSteel, grate, epoxy, cabinet }[name]();
}
