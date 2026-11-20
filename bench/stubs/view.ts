// Headless stand-in for src/game/view.ts: no Three.js, no WebGL. Only what GameEngine calls, with the same signatures.

type Vec3 = { x: number; y: number; z: number };

/** The end's look; the engine reads only how far open the pod is in god mode's preview of it. */
export const ARRIVAL = { open: 1 };

export class View {
  constructor(..._args: unknown[]) {}
  resize(_w: number, _h: number, _dpr: number): void {}
  look(_cam: unknown): void {}
  pick(_ndcX: number, _ndcY: number, _skip: object | null): null {
    return null;
  }
  project(_p: Vec3, _w: number, _h: number): null {
    return null;
  }
  toHead(p: Vec3): Vec3 {
    return { x: p.x, y: p.y, z: p.z };
  }
  icons(): Record<string, never> {
    return {};
  }
  render(_fr: unknown): void {}
  dispose(): void {}
}

/** The flat view (src/game/view2d.ts) is stood in for the same way. */
export { View as FlatView };
