/**
 * The player's settings for how the clamp stands and the hoses are drawn: whether the stands are drawn at all, and
 * if they are, whether their rods are full height, STAND_ROD (see bodies.ts), or end just over their clamps; and how
 * opaque a hose's tube is (not the fluid in it, which shows as ever). Only how they look: a stand that isn't drawn still needs its counter and its room, just as one that is (see
 * GameEngine.rest). Kept in local storage, not in saves: they're preferences, like the outline.
 */
export interface Fittings {
  /** Whether the clamp stands are drawn. */
  stands: boolean;
  /** Whether a stand's rod is full height, STAND_ROD; if not, it ends SHORT_ROD over its clamp. */
  tall: boolean;
  /** How opaque a hose's tube is, from 0 (not drawn) to 1 (solid). */
  hose: number;
}

/** Where the settings start, as the user chose: the stands drawn, only as high as their clamps, and the hoses' tubes fairly opaque. */
export const DEFAULT_FITTINGS: Readonly<Fittings> = { stands: true, tall: false, hose: 0.75 };

/** How far a stand's rod reaches over its clamp when it isn't full height (see Fittings.tall). */
export const SHORT_ROD = 20;

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
  const { stands, tall, hose } = raw as Record<string, unknown>;
  if (typeof stands === 'boolean') out.stands = stands;
  if (typeof tall === 'boolean') out.tall = tall;
  if (typeof hose === 'number' && hose >= 0 && hose <= 1) out.hose = hose;
  return out;
}

const KEY = 'chemlab.fittings';

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
