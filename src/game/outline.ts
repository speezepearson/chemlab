/**
 * The player's settings for the outlines drawn round whatever the crosshair is on (the part of it, and faintly the whole
 * thing it's part of): their color, how thick they are in CSS pixels (0 for none), and how strong the faint one is.
 * Kept in local storage, not in saves: it's a preference, like the volumes.
 */
export interface Outline {
  /** A CSS hex color, #rrggbb. */
  color: string;
  width: number;
  /** The opacity of the outline round the whole thing, from 0 (none) to 1 (as strong as the part's). */
  faint: number;
}

/** The thickest the slider goes, in CSS pixels. */
export const MAX_OUTLINE_WIDTH = 8;

export const DEFAULT_OUTLINE: Readonly<Outline> = { color: '#ffffff', width: 2, faint: 0.25 };

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
  const { color, width, faint } = raw as Record<string, unknown>;
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) out.color = color.toLowerCase();
  if (typeof width === 'number' && width >= 0 && width <= MAX_OUTLINE_WIDTH) out.width = width;
  if (typeof faint === 'number' && faint >= 0 && faint <= 1) out.faint = faint;
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
