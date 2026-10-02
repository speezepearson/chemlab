/**
 * The player's volume settings, one slider per kind of sound plus one for everything. A slider runs from 0 to 1;
 * its gain goes as the square of its position, so the middle is the sound as synthesized, the top is four times
 * that, and the bottom is silent. Each starts where it sounds right (DEFAULT_VOLUMES). Kept in local storage, not
 * in saves: it's a preference.
 */
export const CHANNELS = ['master', 'hum', 'klaxon', 'alarm', 'drips', 'trickle', 'spectrometer'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_NAMES: Record<Channel, string> = {
  master: 'everything',
  hum: 'hum',
  klaxon: 'klaxon',
  alarm: 'fire alarm',
  drips: 'drips',
  trickle: 'streams',
  spectrometer: 'spectrometer',
};

export type Volumes = Record<Channel, number>;

/** The slider position that plays a sound as synthesized. */
export const MIDDLE = 0.5;

/** Where each slider starts, as the user tuned them: the far-off alarms well under the rest. */
export const DEFAULT_VOLUMES: Readonly<Volumes> = {
  master: MIDDLE,
  hum: MIDDLE,
  klaxon: 0.23,
  alarm: 0.26,
  drips: MIDDLE,
  trickle: MIDDLE,
  spectrometer: MIDDLE,
};

export function defaultVolumes(): Volumes {
  return { ...DEFAULT_VOLUMES };
}

/** A slider's gain: 1 at the middle, 4 at the top, 0 at the bottom. */
export function gainOf(slider: number): number {
  return (Math.max(0, Math.min(1, slider)) / MIDDLE) ** 2;
}

/** Volumes from stored JSON, tolerating junk: anything missing or not a number in [0, 1] gets its default. */
export function parseVolumes(json: string | null): Volumes {
  const out = defaultVolumes();
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    return out;
  }
  if (raw && typeof raw === 'object')
    for (const c of CHANNELS) {
      const v = (raw as Record<string, unknown>)[c];
      if (typeof v === 'number' && v >= 0 && v <= 1) out[c] = v;
    }
  return out;
}

const KEY = 'slurry-lab.volumes';

export function storedVolumes(): Volumes {
  try {
    return parseVolumes(localStorage.getItem(KEY));
  } catch {
    return defaultVolumes();
  }
}

export function storeVolumes(v: Volumes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // storage blocked: the sliders just reset next time
  }
}
