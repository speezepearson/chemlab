/**
 * The player's settings for the outline drawn round whatever the crosshair is on: its color, and how thick it is in
 * CSS pixels (0 for none). Kept in local storage, not in saves: it's a preference, like the volumes.
 */
export interface Outline {
  /** A CSS hex color, #rrggbb. */
  color: string;
  width: number;
}

/** The thickest the slider goes, in CSS pixels. */
export const MAX_OUTLINE_WIDTH = 8;

export const DEFAULT_OUTLINE: Readonly<Outline> = { color: '#ffffff', width: 2 };

export function defaultOutline(): Outline {
  return { ...DEFAULT_OUTLINE };
}

/** Settings from stored JSON, tolerating junk: anything missing or out of range gets its default. */
export function parseOutline(json: string | null): Outline {
  const out = defaultOutline();
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const { color, width } = raw as Record<string, unknown>;
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) out.color = color.toLowerCase();
  if (typeof width === 'number' && width >= 0 && width <= MAX_OUTLINE_WIDTH) out.width = width;
  return out;
}

const KEY = 'slurry-lab.outline';

function stored(): Outline {
  try {
    return parseOutline(localStorage.getItem(KEY));
  } catch {
    return defaultOutline();
  }
}

/** The settings in force, read by the view every frame. */
export const OUTLINE: Outline = stored();

export function setOutline(o: Partial<Outline>): void {
  Object.assign(OUTLINE, o);
  try {
    localStorage.setItem(KEY, JSON.stringify(OUTLINE));
  } catch {
    // storage blocked: the settings just reset next time
  }
}
