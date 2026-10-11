import { Spot, audio, bus, whiteNoise } from './audio';
import type { Placement } from './place';

/**
 * A receptacle's sounds, driven live by the engine as its cycle goes (so they follow sim time, pauses included):
 * the short blips of its thinking, a happy rising pair of tones or a low error buzz for its verdict, and the rush of
 * a flush down its hose, whose loudness follows a level from 0 (silent) to 1. It plays on the receptacle channel
 * (see audio.ts), from wherever the receptacle is placed, and without audio it is silent.
 */
export interface Beeper {
  /** A short computer blip at this pitch, now. */
  beep(freq: number): void;
  /** The verdict, now: a happy rising pair of tones, or a low error buzz. */
  verdict(pass: boolean): void;
  /** Rush at this level from now on, 0 to 1; 0 is silent. */
  flush(level: number): void;
  /** Where it's heard from, as the receptacle or the view moves (see placement). */
  place(at: Placement): void;
  /** Fade out for good (a tone already playing finishes). */
  stop(): void;
}

const SILENT: Beeper = { beep() {}, verdict() {}, flush() {}, place() {}, stop() {} };

export function beeper(at: Placement): Beeper {
  const ac = audio();
  const out0 = bus('receptacle');
  if (!ac || !out0) return SILENT;
  const spot = new Spot(ac, out0, at);
  const dest = spot.input;

  // the flush: white noise, low-passed and a little resonant, like water rushing down a pipe
  const noise = ac.createBufferSource();
  noise.buffer = whiteNoise(ac);
  noise.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 3;
  filter.frequency.value = 500;
  const rush = ac.createGain();
  rush.gain.value = 0;
  noise.connect(filter).connect(rush).connect(dest);
  noise.start();

  let current = -1;
  let stopped = false;
  return {
    beep(freq) {
      tone(ac, dest, ac.currentTime, freq, 0.06, 'triangle', 0.07);
    },
    verdict(pass) {
      const now = ac.currentTime;
      if (pass) {
        tone(ac, dest, now, 1047, 0.12, 'sine', 0.09);
        tone(ac, dest, now + 0.13, 1568, 0.22, 'sine', 0.09);
      } else {
        tone(ac, dest, now, 196, 0.18, 'square', 0.05);
        tone(ac, dest, now + 0.24, 147, 0.32, 'square', 0.05);
      }
    },
    flush(level) {
      if (stopped || level === current) return;
      current = level;
      const now = ac.currentTime;
      // it gurgles lower as it runs out
      filter.frequency.setTargetAtTime(250 + 650 * level, now, 0.05);
      rush.gain.setTargetAtTime(0.35 * level, now, 0.05);
    },
    place(at) {
      if (!stopped) spot.place(at);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ac.currentTime;
      rush.gain.cancelScheduledValues(now);
      rush.gain.setTargetAtTime(0, now, 0.08);
      noise.stop(now + 0.5);
      // after any verdict has rung out
      setTimeout(() => spot.disconnect(), 1000);
    },
  };
}

/** A plain tone at `freq`, `length` seconds long from `at`, with a quick attack and decay. */
function tone(
  ac: AudioContext, dest: AudioNode, at: number, freq: number, length: number, type: OscillatorType, peak: number,
): void {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.005);
  g.gain.setValueAtTime(peak, at + length * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0005, at + length);
  g.connect(dest);
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  o.start(at);
  o.stop(at + length + 0.02);
}
