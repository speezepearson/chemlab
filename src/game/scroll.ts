/**
 * The player's setting for which way scrolling moves the view: by default scrolling down (or a trackpad's two fingers
 * drawn toward you) moves it further out, and inverted, nearer in. Only scrolling: a pinch, on a trackpad or a touch
 * screen, always goes the way the fingers do. Kept in local storage, not in saves: it's a preference, like the outline.
 */
export interface Scroll {
  invert: boolean;
}

export const DEFAULT_SCROLL: Readonly<Scroll> = { invert: false };

export function defaultScroll(): Scroll {
  return { ...DEFAULT_SCROLL };
}

/** The setting from stored JSON, tolerating junk: anything missing or of the wrong type gets its default. */
export function parseScroll(json: string | null): Scroll {
  const out = defaultScroll();
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const { invert } = raw as Record<string, unknown>;
  if (typeof invert === 'boolean') out.invert = invert;
  return out;
}

const KEY = 'slurry-lab.scroll';

function stored(): Scroll {
  try {
    return parseScroll(localStorage.getItem(KEY));
  } catch {
    return defaultScroll();
  }
}

/** The setting in force, read by the engine at each wheel event. */
export const SCROLL: Scroll = stored();

export function setScroll(s: Partial<Scroll>): void {
  Object.assign(SCROLL, s);
  try {
    localStorage.setItem(KEY, JSON.stringify(SCROLL));
  } catch {
    // storage blocked: the setting just resets next time
  }
}
