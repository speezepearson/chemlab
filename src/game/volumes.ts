/**
 * The player's volume settings, one slider per kind of sound plus one for everything. A slider runs from 0 to 1 and
 * starts at the middle; its gain goes as the square of its position, so the middle is the sound as designed, the
 * top is four times that, and the bottom is silent. Kept in local storage, not in saves: it's a preference.
 */
export const CHANNELS = ['master', 'hum', 'klaxon', 'alarm', 'spectrometer'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_NAMES: Record<Channel, string> = {
  master: 'everything',
  hum: 'hum',
  klaxon: 'klaxon',
  alarm: 'fire alarm',
  spectrometer: 'spectrometer',
};

export type Volumes = Record<Channel, number>;

export const DEFAULT_VOLUME = 0.5;

export function defaultVolumes(): Volumes {
  return Object.fromEntries(CHANNELS.map((c) => [c, DEFAULT_VOLUME])) as Volumes;
}

/** A slider's gain: 1 at the default, 4 at the top, 0 at the bottom. */
export function gainOf(slider: number): number {
  return (Math.max(0, Math.min(1, slider)) / DEFAULT_VOLUME) ** 2;
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
