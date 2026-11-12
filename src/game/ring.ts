import type { Partial } from '../chem/modes';
import { Spot, audio, bus, whiteNoise } from './audio';
import type { Placement } from './place';

/**
 * How a tapped vessel sounds:
 * - base: the frequency, in Hz, of a note whose pitch is 1 in the chemistry's units (see modes), so the notes of
 *   the molecules there are land in the middle of what's easy to hear;
 * - glass: the glass's own notes, in Hz, in an empty vessel, which every tap has, with how loud each is and how long
 *   it rings, in seconds;
 * - load: how much what's in it weighs the glass down: full, its notes are 1 / √(1 + load) as high as empty (see
 *   glassHz), a little under two thirds, as a glass rings lower the fuller it is;
 * - damp: how much shorter the glass's notes ring in a full vessel than an empty one, as a share;
 * - level: how loud a fluid's note of loudness 1 is, in a full vessel;
 * - ring: how long a fluid's note at `base` rings, in seconds; higher notes die away sooner, as the square root of
 *   how much higher they are.
 */
export const RING = {
  base: 400,
  glass: [[2350, 0.045, 0.16], [3710, 0.02, 0.09]] as const,
  load: 1.5,
  damp: 0.4,
  level: 0.3,
  ring: 1.9,
};

/** The frequency, in Hz, at which the glass's own note of `hz` when empty rings in a vessel `full` of the way full (see RING.load). */
export const glassHz = (hz: number, full: number) => hz / Math.sqrt(1 + RING.load * Math.max(0, Math.min(1, full)));

/** The frequency, in Hz, a note of pitch w (see modes) sounds at. */
export const ringHz = (w: number) => RING.base * w;

/** How long a note at `hz` rings, in seconds (see RING.ring), between a fifth of a second and three. */
export const ringTime = (hz: number) => Math.max(0.2, Math.min(3, RING.ring * Math.sqrt(RING.base / hz)));

/**
 * The sound of a vessel flicked with a fingernail, from `at`: the tick of the nail; the glass's own short notes, lower
 * and shorter the fuller the vessel is (`full`, 0 to 1; see glassHz); and under them the fluid's (see ringOf), each a
 * sine struck and dying away, as loud as its loudness times how full the vessel is. So how full it is is heard
 * whatever's in it, and a film across the floor of one is hardly heard at all. It plays on the glass channel; without
 * audio it's silent.
 */
export function ring(at: Placement, partials: readonly Partial[], full: number): void {
  const ac = audio();
  const out = bus('glass');
  if (!ac || !out) return;
  const spot = new Spot(ac, out, at);
  const now = ac.currentTime + 0.01;
  const strike = (hz: number, level: number, seconds: number) => {
    if (!(hz > 20) || hz > 16000 || level <= 0) return;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    g.connect(spot.input);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz;
    o.connect(g);
    o.start(now);
    o.stop(now + seconds + 0.05);
  };
  // the nail on the glass: a few milliseconds of bright noise
  const tick = ac.createBufferSource();
  tick.buffer = whiteNoise(ac);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const tg = ac.createGain();
  tg.gain.setValueAtTime(0.09, now);
  tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
  tick.connect(hp).connect(tg).connect(spot.input);
  tick.start(now, Math.random());
  tick.stop(now + 0.03);
  const body = Math.max(0, Math.min(1, full));
  for (const [hz, level, seconds] of RING.glass) strike(glassHz(hz, body), level, seconds * (1 - RING.damp * body));
  let longest = 0.3;
  for (const p of partials) {
    const hz = ringHz(p.w);
    const seconds = ringTime(hz);
    strike(hz, RING.level * p.a * body, seconds);
    longest = Math.max(longest, seconds);
  }
  setTimeout(() => spot.disconnect(), 1000 * (longest + 0.5));
}
