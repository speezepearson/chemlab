import type { Vec3 } from './space';

/**
 * Where the view is from, in the room: the camera's place, which way it looks (a yaw of 0 is square at the back wall,
 * where the bench is, and π at the wall behind; pitch is up, in radians), and its field of view, top to bottom, in
 * degrees. If it has an `ortho`, it has no perspective: it sees a stretch that many world units up and down from its
 * middle, the same however far off things are, along parallel lines of sight, and its field of view isn't used.
 */
export interface Camera {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
  ortho?: number;
}

/** Which ways are right, up and ahead for a camera, in the room: tipped up by its pitch, then turned by its yaw. */
export function axes(cam: Pick<Camera, 'yaw' | 'pitch'>): { right: Vec3; up: Vec3; ahead: Vec3 } {
  const [cp, sp] = [Math.cos(cam.pitch), Math.sin(cam.pitch)];
  const [cy, sy] = [Math.cos(cam.yaw), Math.sin(cam.yaw)];
  return {
    right: { x: cy, y: 0, z: -sy },
    up: { x: sp * sy, y: cp, z: sp * cy },
    ahead: { x: -cp * sy, y: sp, z: -cp * cy },
  };
}

/**
 * The line of sight through a point of a camera's view: (nx, ny) is where on the view, each from −1 to 1, across and
 * up, and `aspect` is the view's width over its height. With perspective, every line starts at the camera and they
 * fan out; without (see Camera.ortho), they start side by side and all go the way it faces. `d` isn't a unit vector.
 */
export function sightAt(cam: Camera, nx: number, ny: number, aspect: number): { o: Vec3; d: Vec3 } {
  const { right, up, ahead } = axes(cam);
  const along = (a: Vec3, r: number, u: number): Vec3 => ({
    x: a.x + right.x * r + up.x * u, y: a.y + right.y * r + up.y * u, z: a.z + right.z * r + up.z * u,
  });
  if (cam.ortho !== undefined) return { o: along(cam, nx * cam.ortho * aspect, ny * cam.ortho), d: ahead };
  const t = Math.tan((cam.fov * Math.PI) / 360);
  return { o: { x: cam.x, y: cam.y, z: cam.z }, d: along(ahead, nx * t * aspect, ny * t) };
}

/** Where a line of sight (see sightAt) meets the upright plane `z` out from the back wall; null if it never does, going that way. */
export function onPlaneZ(sight: { o: Vec3; d: Vec3 }, z: number): Vec3 | null {
  const { o, d } = sight;
  if (Math.abs(d.z) < 1e-9) return null;
  const s = (z - o.z) / d.z;
  return s > 0 ? { x: o.x + d.x * s, y: o.y + d.y * s, z } : null;
}
