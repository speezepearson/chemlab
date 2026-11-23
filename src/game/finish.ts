/**
 * The player's setting for how the lab's metal is finished: its shine, from 0 (fully matte) through 0.5 (as it was
 * built) to 1 (mirror-smooth). It sets the roughness of every metal material (see `metal` in textures.ts). Kept in
 * local storage, not in saves: it's a preference, like the outline.
 */
export interface Finish {
  shine: number;
}

export const DEFAULT_FINISH: Readonly<Finish> = { shine: 0.5 };

export function defaultFinish(): Finish {
  return { ...DEFAULT_FINISH };
}

/** Settings from stored JSON, tolerating junk: anything missing or out of range gets its default. */
export function parseFinish(json: string | null): Finish {
  const out = defaultFinish();
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const { shine } = raw as Record<string, unknown>;
  if (typeof shine === 'number' && shine >= 0 && shine <= 1) out.shine = shine;
  return out;
}

/**
 * A metal's roughness at shine `s`, given the roughness `base` it was authored with: straight from 1 at shine 0 to
 * `base` at 0.5, and on to 0 at 1, so the default leaves it as built and the ends are the same for every metal.
 * A `dressed` metal's roughness is only a multiplier on its roughness map's (see dress in textures.ts), so on its
 * matte half it goes up to 2 at shine 0 instead, which the shader clamps where the product passes 1: 1 couldn't
 * make it any more matte than its map.
 */
export function roughnessAt(base: number, s: number, dressed = false): number {
  const top = dressed ? 2 : 1;
  return s <= 0.5 ? top + (base - top) * 2 * s : base * 2 * (1 - s);
}

const KEY = 'slurry-lab.finish';

function stored(): Finish {
  try {
    return parseFinish(localStorage.getItem(KEY));
  } catch {
    return defaultFinish();
  }
}

/** The setting in force, read by the view each frame (and applied when it changes). */
export const FINISH: Finish = stored();

export function setFinish(f: Partial<Finish>): void {
  Object.assign(FINISH, f);
  try {
    localStorage.setItem(KEY, JSON.stringify(FINISH));
  } catch {
    // storage blocked: the setting just resets next time
  }
}
