/**
 * The player's setting for how far off the crosshair what C, Q and E act on may be: a spout or nozzle, for C to take
 * hold of its hose (see GameEngine.hoseAim), or a handwheel or dial, for Q and E to turn it (see
 * GameEngine.aimedValve): `deg`, the half-angle in degrees of a cone round the crosshair, as seen at the view's normal
 * field of view (see aimCone), from AIM_DEG.min to AIM_DEG.max in steps of AIM_DEG.step. Kept in local storage,
 * not in saves: it's a preference, like the outline and the finish.
 */
export interface Aim {
  deg: number;
}

/** The range of the setting, and its step, as the Appearance panel's slider offers it. */
export const AIM_DEG = { min: 1, max: 30, step: 1 };

/** Where the setting starts. */
export const DEFAULT_AIM: Readonly<Aim> = { deg: 8 };

export function defaultAim(): Aim {
  return { ...DEFAULT_AIM };
}

/** Settings from stored JSON, tolerating junk: anything missing or out of range gets its default. */
export function parseAim(json: string | null): Aim {
  const out = defaultAim();
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const { deg } = raw as Record<string, unknown>;
  if (typeof deg === 'number' && deg >= AIM_DEG.min && deg <= AIM_DEG.max) out.deg = deg;
  return out;
}

/**
 * The tangent of the cone's half-angle round the crosshair, for a setting of `deg` degrees (as seen at the normal
 * field of view, `normalFov`) in a view whose field of view is now `fov` (both top to bottom, in degrees): zoomed in,
 * the cone narrows so that it covers the same part of the screen.
 */
export function aimCone(deg: number, fov: number, normalFov: number): number {
  const t = (d: number) => Math.tan((d * Math.PI) / 180);
  return (t(deg) * t(fov / 2)) / t(normalFov / 2);
}

const KEY = 'slurry-lab.aim';

function stored(): Aim {
  try {
    return parseAim(localStorage.getItem(KEY));
  } catch {
    return defaultAim();
  }
}

/** The setting in force, read by the engine whenever it looks for what C, Q and E would act on. */
export const AIM: Aim = stored();

export function setAim(a: Partial<Aim>): void {
  Object.assign(AIM, a);
  try {
    localStorage.setItem(KEY, JSON.stringify(AIM));
  } catch {
    // storage blocked: the setting just resets next time
  }
}
