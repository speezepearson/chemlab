/**
 * The player's setting for how far off the crosshair a spout or nozzle may be for C to take hold of its hose (see
 * GameEngine.hoseAim): `deg`, the half-angle in degrees of a cone round the crosshair, as seen at the view's normal
 * field of view (see aimCone), from HOSE_DEG.min to HOSE_DEG.max in steps of HOSE_DEG.step. Kept in local storage,
 * not in saves: it's a preference, like the outline and the finish.
 */
export interface HoseAim {
  deg: number;
}

/** The range of the setting, and its step, as the Appearance panel's slider offers it. */
export const HOSE_DEG = { min: 1, max: 30, step: 1 };

/** Where the setting starts. */
export const DEFAULT_HOSE_AIM: Readonly<HoseAim> = { deg: 8 };

export function defaultHoseAim(): HoseAim {
  return { ...DEFAULT_HOSE_AIM };
}

/** Settings from stored JSON, tolerating junk: anything missing or out of range gets its default. */
export function parseHoseAim(json: string | null): HoseAim {
  const out = defaultHoseAim();
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const { deg } = raw as Record<string, unknown>;
  if (typeof deg === 'number' && deg >= HOSE_DEG.min && deg <= HOSE_DEG.max) out.deg = deg;
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

const KEY = 'slurry-lab.hoseAim';

function stored(): HoseAim {
  try {
    return parseHoseAim(localStorage.getItem(KEY));
  } catch {
    return defaultHoseAim();
  }
}

/** The setting in force, read by the engine whenever it looks for a spout to pull a hose out of. */
export const HOSE_AIM: HoseAim = stored();

export function setHoseAim(a: Partial<HoseAim>): void {
  Object.assign(HOSE_AIM, a);
  try {
    localStorage.setItem(KEY, JSON.stringify(HOSE_AIM));
  } catch {
    // storage blocked: the setting just resets next time
  }
}
