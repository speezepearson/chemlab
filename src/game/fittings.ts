/**
 * The player's settings for how the clamp stands and the hoses are drawn: whether the stands are drawn at all. Only
 * how they look: a stand that isn't drawn still needs its counter and its room, just as one that is (see
 * GameEngine.rest). Kept in local storage, not in saves: they're preferences, like the outline.
 */
export interface Fittings {
  /** Whether the clamp stands are drawn. */
  stands: boolean;
}

/** Where the settings start: the stands drawn. */
export const DEFAULT_FITTINGS: Readonly<Fittings> = { stands: true };

export function defaultFittings(): Fittings {
  return { ...DEFAULT_FITTINGS };
}

/** Settings from stored JSON, tolerating junk: anything missing or of the wrong kind gets its default. */
export function parseFittings(json: string | null): Fittings {
  const out = defaultFittings();
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const { stands } = raw as Record<string, unknown>;
  if (typeof stands === 'boolean') out.stands = stands;
  return out;
}

const KEY = 'slurry-lab.fittings';

function stored(): Fittings {
  try {
    return parseFittings(localStorage.getItem(KEY));
  } catch {
    return defaultFittings();
  }
}

/** The settings in force, read by the view each frame. */
export const FITTINGS: Fittings = stored();

export function setFittings(f: Partial<Fittings>): void {
  Object.assign(FITTINGS, f);
  try {
    localStorage.setItem(KEY, JSON.stringify(FITTINGS));
  } catch {
    // storage blocked: the settings just reset next time
  }
}
