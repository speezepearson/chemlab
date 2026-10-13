import { Spot, audio, bus } from './audio';
import type { Placement } from './place';

/**
 * The cryostabilizer station's sounds, played by the engine as its diverter turns (so they follow sim time, pauses
 * included): a happy rising pair of tones as the flow starts going into the reference, or a low error buzz as it
 * starts going to waste. It plays on the receptacle channel (see audio.ts), from wherever the station's lamp is, and
 * without audio it is silent.
 */
export interface Beeper {
  /** The diverter has just turned, now: into the reference, or to waste. */
  divert(keep: boolean): void;
  /** Where it's heard from, as the view moves (see placement). */
  place(at: Placement): void;
  /** Fade out for good (a tone already playing finishes). */
  stop(): void;
}

const SILENT: Beeper = { divert() {}, place() {}, stop() {} };

export function beeper(at: Placement): Beeper {
  const ac = audio();
  const out0 = bus('receptacle');
  if (!ac || !out0) return SILENT;
  const spot = new Spot(ac, out0, at);
  const dest = spot.input;
  let stopped = false;
  return {
    divert(keep) {
      if (stopped) return;
      const now = ac.currentTime;
      if (keep) {
        tone(ac, dest, now, 1047, 0.12, 'sine', 0.09);
        tone(ac, dest, now + 0.13, 1568, 0.22, 'sine', 0.09);
      } else {
        tone(ac, dest, now, 196, 0.18, 'square', 0.05);
        tone(ac, dest, now + 0.24, 147, 0.32, 'square', 0.05);
      }
    },
    place(at) {
      if (!stopped) spot.place(at);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      // after any tone has rung out
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
