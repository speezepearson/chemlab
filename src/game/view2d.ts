import type { Vec3 } from './space';
import type { Camera, FaucetSpot, Frame, Icons, LabView, Pick } from './view';

/**
 * Draws the lab flat, on a plain 2D canvas, with nothing three-dimensional about it: the bench as it is in its own
 * plane (see PLANE_Z), seen square on with no perspective (see Camera.ortho), x across and y up. It's the view of
 * the `flat` mode (see mode.ts), and stands in for View wherever the engine draws or asks what the pointer is on.
 */
export class FlatView implements LabView {
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 45, ortho: 500 };
  /** The canvas's size in CSS pixels, and device pixels to each. */
  private w = 1;
  private h = 1;
  private dpr = 1;

  /** `eye` is how high the player's eyes are standing, which only the cryopod's message needs. */
  constructor(
    private canvas: HTMLCanvasElement,
    private faucets: readonly FaucetSpot[],
    private eye: number,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  icons(): Readonly<Icons> {
    return {};
  }

  resize(w: number, h: number, dpr: number): void {
    [this.w, this.h, this.dpr] = [w, h, dpr];
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  look(cam: Camera): void {
    this.cam = cam;
  }

  /** CSS pixels to a world unit. */
  private scale(): number {
    return this.h / 2 / (this.cam.ortho ?? 500);
  }

  render(fr: Frame): void {
    const { ctx } = this;
    this.cam = fr.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#c9cfcb';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#30373a';
    ctx.font = '16px sans-serif';
    ctx.fillText(`flat view: ${fr.tools.length} tools, ${fr.flasks.length} flasks, ${this.faucets.length} faucets, eyes ${this.eye}`, 20, 30);
  }

  pick(_ndcX: number, _ndcY: number, _skip: object | null): (Pick & { point: Vec3; distance: number }) | null {
    return null;
  }

  project(p: Vec3, w: number, h: number): { x: number; y: number } | null {
    const s = this.scale();
    return { x: w / 2 + (p.x - this.cam.x) * s, y: h / 2 - (p.y - this.cam.y) * s };
  }

  toHead(p: Vec3): Vec3 {
    return { x: p.x - this.cam.x, y: p.y - this.cam.y, z: p.z - this.cam.z };
  }

  dispose(): void {}
}
