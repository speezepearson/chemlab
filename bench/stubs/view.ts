// Headless stand-in for src/game/view.ts: no Three.js, no WebGL. Only what GameEngine calls.

/** The end's look; the engine reads only how far open the pod is in god mode's preview of it. */
export const ARRIVAL = { open: 1 };

export class View {
  constructor(..._args: unknown[]) {}
  resize(): void {}
  look(): void {}
  pick(): null {
    return null;
  }
  ray(): { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } } {
    return { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 } };
  }
  project(): null {
    return null;
  }
  toHead(p: { x: number; y: number; z: number }) {
    return { x: p.x, y: p.y, z: p.z };
  }
  render(): void {}
  dispose(): void {}
}
