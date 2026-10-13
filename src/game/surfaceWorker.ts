import { paintSurface, type SurfaceName } from './surfaces';

/** Paints the room's surfaces off the main thread (see textures.ts): asked for one by name, it sends back its maps. */
const scope = self as unknown as Worker;
scope.addEventListener('message', (e: MessageEvent<SurfaceName>) => {
  const b = paintSurface(e.data);
  scope.postMessage({ name: e.data, baked: b }, [b.color.buffer, b.normal.buffer, b.rough.buffer]);
});
