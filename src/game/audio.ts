import { CHANNELS, gainOf, storeVolumes, storedVolumes, type Channel, type Volumes } from './volumes';

/**
 * The one audio context and its mixer: each kind of sound plays into its own channel's bus, each bus into a master
 * bus, and that through a compressor (so a crowd of streams can't clip) to the speakers. Browsers keep audio off
 * until a user gesture, so the context resumes on the first click or key; until then everything is silent.
 */
let ctx: AudioContext | null | undefined;
let buses: Record<Channel, GainNode> | null = null;

/** The current slider positions (see volumes.ts). */
export const VOLUMES: Volumes = storedVolumes();

export function audio(): AudioContext | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    return (ctx = null);
  }
  const c = ctx;
  const resume = () => void c.resume().catch(() => {});
  resume();
  // the sim stops while the page is hidden, so its sounds should too
  document.addEventListener('visibilitychange', () => (document.hidden ? void c.suspend() : resume()));
  for (const ev of ['pointerdown', 'keydown'] as const) document.addEventListener(ev, resume, { capture: true });

  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.connect(c.destination);
  const master = c.createGain();
  master.connect(comp);
  const b = { master } as Record<Channel, GainNode>;
  for (const ch of CHANNELS) {
    if (ch === 'master') continue;
    b[ch] = c.createGain();
    b[ch].connect(master);
  }
  for (const ch of CHANNELS) b[ch].gain.value = gainOf(VOLUMES[ch]);
  buses = b;
  return c;
}

/** Where a channel's sounds go (null without audio). */
export function bus(ch: Exclude<Channel, 'master'>): AudioNode | null {
  return audio() ? buses![ch] : null;
}

/** Move a slider, and remember it. */
export function setVolume(ch: Channel, slider: number): void {
  VOLUMES[ch] = slider;
  storeVolumes(VOLUMES);
  if (ctx && buses) buses[ch].gain.setTargetAtTime(gainOf(slider), ctx.currentTime, 0.02);
}

const noiseBuffers = new Map<string, AudioBuffer>();

/** Two seconds of brown noise: a random walk, which is mostly rumble. */
export function brownNoise(ac: AudioContext): AudioBuffer {
  return cached('brown', ac, (d) => {
    let x = 0;
    for (let i = 0; i < d.length; i++) {
      x = (x + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = 3.5 * x;
    }
  });
}

/** Two seconds of white noise. */
export function whiteNoise(ac: AudioContext): AudioBuffer {
  return cached('white', ac, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  });
}

/** A mono buffer, `seconds` long, filled once by `fill` and kept under `key`. */
export function cached(key: string, ac: AudioContext, fill: (d: Float32Array, rate: number) => void, seconds = 2): AudioBuffer {
  let buf = noiseBuffers.get(key);
  if (!buf) {
    buf = ac.createBuffer(1, Math.round(seconds * ac.sampleRate), ac.sampleRate);
    fill(buf.getChannelData(0), ac.sampleRate);
    noiseBuffers.set(key, buf);
  }
  return buf;
}
