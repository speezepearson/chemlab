import { Spot, audio, bus, whiteNoise } from './audio';
import type { Placement } from './place';

/**
 * The cryostabilizer station's diverter's sounds, driven live by the engine as it runs (so they follow sim time,
 * pauses included): a clunk as it swings to the reservoir or the waste, and the rush of what it lets into the
 * reservoir, whose loudness follows a level from 0 (silent) to 1. It plays on the receptacle channel (see audio.ts),
 * from where the station's display is, and without audio it is silent.
 */
export interface Diverter {
  /** A clunk, now, as it swings: a little higher toward the reservoir than toward the waste. */
  swing(toReservoir: boolean): void;
  /** Rush at this level from now on, 0 to 1; 0 is silent. */
  flush(level: number): void;
  /** Where it's heard from, as the view moves (see placement). */
  place(at: Placement): void;
  /** Fade out for good (a clunk already playing finishes). */
  stop(): void;
}

const SILENT: Diverter = { swing() {}, flush() {}, place() {}, stop() {} };

export function diverter(at: Placement): Diverter {
  const ac = audio();
  const out0 = bus('receptacle');
  if (!ac || !out0) return SILENT;
  const spot = new Spot(ac, out0, at);
  const dest = spot.input;

  // the rush: white noise, low-passed and a little resonant, like water rushing up a pipe
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
    flush(level) {
      if (stopped || level === current) return;
      current = level;
      const now = ac.currentTime;
      filter.frequency.setTargetAtTime(250 + 650 * level, now, 0.05);
      rush.gain.setTargetAtTime(0.25 * level, now, 0.08);
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
