import { describe, expect, it } from 'vitest';

/** The source of every module in the game and its chemistry and intro, by path from here (./view2d.ts, ../chem/...). */
const SOURCES = {
  ...import.meta.glob<string>('./*.ts', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob<string>('../chem/*.ts', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob<string>('../intro/*.ts', { eager: true, query: '?raw', import: 'default' }),
};

/** A path from this directory, `spec` resolved from the module at `from`. */
function resolve(from: string, spec: string): string {
  const parts = from.split('/').slice(0, -1).filter((s) => s !== '.');
  for (const s of spec.split('/')) {
    if (s === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push('..');
    } else if (s !== '.') parts.push(s);
  }
  // (this directory is game/: back up out of it and into it again is here)
  const p = parts.join('/').replace(/^\.\.\/game\//, '');
  return p.startsWith('..') ? p : `./${p}`;
}

/** What a module imports at runtime (not with `import type`): the modules here by path, and packages by name. */
function runtimeImports(path: string): string[] {
  const out: string[] = [];
  for (const m of SOURCES[path].matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gms)) {
    if (m[1]) continue;
    out.push(m[2].startsWith('.') ? `${resolve(path, m[2])}.ts` : m[2]);
  }
  return out;
}

describe('the flat view', () => {
  it('draws without three.js: nothing it imports at runtime, nor anything they do, imports it', () => {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const todo = ['./view2d.ts'];
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      expect(SOURCES[f], f).toBeDefined();
      for (const i of runtimeImports(f)) (i.endsWith('.ts') ? todo.push(i) : packages.add(i));
    }
    expect(seen.has('./screens.ts')).toBe(true);
    expect(seen.has('./view.ts')).toBe(false);
    expect([...packages].filter((p) => p === 'three' || p.startsWith('three/'))).toEqual([]);
  });
});
