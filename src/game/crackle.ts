import { Spot, audio, bus, whiteNoise } from './audio';
import type { Placement } from './place';

/**
 * How an ear trumpet turns what's reacting into sound: a click for some of the events of each kind of reaction
 * (see ReactionNetwork.activity), far fewer than there are.
 * - top: the activity, in events a sim second per molecule, at which a kind of reaction clicks as fast as it gets;
 * - most: how fast that is, in clicks a sim second;
 * - power: how the clicks fall off below that: as the activity over `top`, to this power. Activity runs over many
 *   powers of ten, from a fresh mix to one all but at rest, so the clicks go by well under its square root: a mix a
 *   million times quieter than the liveliest still ticks over, a click every second or two;
 * - real: the most clicks played in a real second, of all kinds together, however fast the sim is running: beyond
 *   that they're thinned, each kind alike.
 */
export const CRACKLE = { top: 0.05, most: 60, power: 0.35, real: 120 };

/** How many clicks a sim second an ear trumpet makes of a kind of reaction going at `activity` events per molecule a sim second. */
export function crackleRate(activity: number): number {
  return activity > 0 ? CRACKLE.most * Math.min(1, activity / CRACKLE.top) ** CRACKLE.power : 0;
}

/**
 * How many clicks of each kind to play over `simDt` sim seconds that take `dt` real ones, on average, for the
 * `activity` of each kind of reaction: each kind's rate for that long, all thinned alike if together they'd come to
 * more than CRACKLE.real a real second.
 */
export function crackleClicks(activity: readonly number[], simDt: number, dt: number): number[] {
  const want = activity.map((a) => crackleRate(a) * simDt);
  const all = want.reduce((a, b) => a + b, 0);
  const most = CRACKLE.real * dt;
  return all > most ? want.map((w) => (w * most) / all) : want;
}

/** A whole number drawn at random with the given mean, as the counts of things that happen independently are. */
function poisson(mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()));
  const limit = Math.exp(-mean);
  let n = 0;
  for (let p = Math.random(); p > limit; p *= Math.random()) n++;
  return n;
}

function gauss(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/**
 * An ear trumpet's sound, driven live by whoever runs it, a frame at a time (so it follows sim time, pauses
 * included): clicks at random, each kind of reaction's its own, so a fluid is heard by what's going on in it:
 * - a bond forming between two molecules is a soft low knock;
 * - a ring closing is a dry tick;
 * - a bond breaking is a sharp snap of noise;
 * - a displacement is a high ping that rings a moment.
 * It plays on the ear trumpet's channel (see audio.ts), from wherever it's placed; without audio it's silent.
 */
export interface Crackle {
  /**
   * The next `dt` real seconds, in which `simDt` sim seconds pass: the fluid's `activity`, per kind of reaction (see
   * ReactionNetwork.activity), heard from `at`, `level` loud (1 is as synthesized).
   */
  play(activity: readonly number[], simDt: number, dt: number, at: Placement, level: number): void;
  /** Let go of it: what's already sounding rings out. */
  stop(): void;
}

const SILENT: Crackle = { play() {}, stop() {} };

export function crackle(at: Placement): Crackle {
  const ac = audio();
  const out = bus('trumpet');
  if (!ac || !out) return SILENT;
  const spot = new Spot(ac, out, at);
  const gain = ac.createGain();
  gain.connect(spot.input);
  return {
    play(activity, simDt, dt, where, level) {
      spot.place(where);
      const now = ac.currentTime;
      gain.gain.setTargetAtTime(level, now, 0.05);
      if (where.gain <= 0 || level <= 0) return;
      crackleClicks(activity, simDt, dt).forEach((mean, kind) => {
        for (let n = poisson(mean); n > 0; n--) CLICKS[kind]?.(ac, gain, now + Math.random() * dt);
      });
    },
    stop() {
      setTimeout(() => {
        gain.disconnect();
        spot.disconnect();
      }, 500);
    },
  };
}

/** A sine struck at `f`, sliding to `to` times that, `peak` loud, gone in `ring` seconds. */
function tone(ac: AudioContext, dest: AudioNode, at: number, f: number, to: number, peak: number, ring: number): void {
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(f, at);
  if (to !== 1) o.frequency.exponentialRampToValueAtTime(f * to, at + ring);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + ring);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + ring + 0.01);
}

const vary = (lo: number, hi: number) => lo + (hi - lo) * Math.random();

/** Each kind of reaction's click, in REACTION_KINDS order (see Crackle). */
const CLICKS: readonly ((ac: AudioContext, dest: AudioNode, at: number) => void)[] = [
  // formation: a soft low knock, falling as it dies
  (ac, dest, at) => tone(ac, dest, at, vary(210, 290), 0.6, vary(0.1, 0.16), 0.07),
  // ring closure: a dry tick
  (ac, dest, at) => tone(ac, dest, at, vary(1250, 1650), 1, vary(0.05, 0.08), 0.02),
  // breaking: a snap of bright noise
  (ac, dest, at) => {
    const noise = ac.createBufferSource();
    noise.buffer = whiteNoise(ac);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = vary(3200, 4800);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vary(0.12, 0.2), at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.014);
    noise.connect(hp).connect(g).connect(dest);
    noise.start(at, 1.9 * Math.random());
    noise.stop(at + 0.02);
  },
  // displacement: a high ping with a fainter partial over it, ringing a moment
  (ac, dest, at) => {
    const f = vary(2300, 3100);
    const peak = vary(0.035, 0.055);
    tone(ac, dest, at, f, 1, peak, 0.09);
    tone(ac, dest, at, 2.32 * f, 1, 0.4 * peak, 0.04);
  },
];
