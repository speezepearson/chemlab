import { Spot, audio, bus, whiteNoise } from './audio';
import type { Placement } from './place';

/**
 * The cryostabilizer station's diverter's sound, driven live by the engine as it runs (so it follows sim time, pauses
 * included): a clunk as it swings to the reservoir or the waste. It plays on the receptacle channel (see audio.ts), from
 * where the station's display is, and without audio it is silent.
 */
export interface Diverter {
  /** A clunk, now, as it swings: a little higher toward the reservoir than toward the waste. */
  swing(toReservoir: boolean): void;
  /** Where it's heard from, as the view moves (see placement). */
  place(at: Placement): void;
  /** Fade out for good (a clunk already playing finishes). */
  stop(): void;
}

const SILENT: Diverter = { swing() {}, place() {}, stop() {} };

export function diverter(at: Placement): Diverter {
  const ac = audio();
  const out0 = bus('receptacle');
  if (!ac || !out0) return SILENT;
  const spot = new Spot(ac, out0, at);
  const dest = spot.input;
  let stopped = false;
  return {
    swing(toReservoir) {
      if (stopped) return;
      const now = ac.currentTime;
      // the click of the flap seating, then the thump of it in its pipe
      const click = ac.createBufferSource();
      click.buffer = whiteNoise(ac);
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2400;
      band.Q.value = 2;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 0.03);
      click.connect(band).connect(g).connect(dest);
      click.start(now, Math.random(), 0.05);
      thump(ac, dest, now + 0.01, toReservoir ? 150 : 95);
    },
    place(at) {
      if (!stopped) spot.place(at);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      // after any clunk has rung out
      setTimeout(() => spot.disconnect(), 1000);
    },
  };
}

/** A short, dull thump at `freq` from `at`: a sine dropping a little in pitch as it dies away. */
function thump(ac: AudioContext, dest: AudioNode, at: number, freq: number): void {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.3, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0005, at + 0.12);
  g.connect(dest);
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, at);
  o.frequency.exponentialRampToValueAtTime(freq * 0.7, at + 0.12);
  o.connect(g);
  o.start(at);
  o.stop(at + 0.14);
}
