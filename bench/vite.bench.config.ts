// Builds bench/sim.ts into a plain Node script (bench/dist/sim.js), with the View and the Web Audio modules swapped
// for stubs, so the engine's sim loop runs without a browser. Run with: npm run bench (see package.json).
import { defineConfig } from 'vite';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const STUBS: Record<string, string> = {
  view: 'stubs/view.ts',
  water: 'stubs/audio.ts',
  rumble: 'stubs/audio.ts',
  beeper: 'stubs/audio.ts',
  ambience: 'stubs/audio.ts',
};

export default defineConfig({
  plugins: [
    {
      name: 'headless-stubs',
      enforce: 'pre',
      resolveId(id, importer) {
        if (!importer || !importer.includes('/src/game/')) return null;
        const m = /^\.\/(view|water|rumble|beeper|ambience)$/.exec(id);
        return m ? path.join(here, STUBS[m[1]]) : null;
      },
      // let the bench try other substep lengths (--substep=); the game's own is 0.02
      transform(code, id) {
        // and let it try Vessels whose counts are views into a shared slab (--slab), since a 400-byte Float64Array
        // gets an off-heap backing store, which costs ~2 us to allocate
        if (id.endsWith('/src/game/flask.ts')) {
          const out = code.replace('n = new Float64Array(NS);', 'n = (globalThis as any).__slab ? (globalThis as any).__slab() : new Float64Array(NS);');
          if (out === code) this.warn('Vessel hook not found in flask.ts');
          return out;
        }
        if (!id.endsWith('/src/game/engine.ts')) return null;
        const out = code.replace('Math.ceil(simDt / 0.02)', 'Math.ceil(simDt / ((globalThis as any).__SUBSTEP ?? 0.02))');
        if (out === code) this.warn('substep hook not found in engine.ts');
        return out;
      },
    },
  ],
  build: {
    ssr: path.join(here, 'sim.ts'),
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
  },
});
