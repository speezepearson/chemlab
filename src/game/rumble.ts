import { Spot, audio, brownNoise, bus } from './audio';
import type { Placement } from './place';

/**
 * A machine's sounds, driven live by whoever runs it (so they follow sim time, pauses included): a rumble,
 * synthesized from low-passed brown noise with a buzzing sawtooth under it, whose loudness and pitch follow a
 * level from 0 (silent) to 1; and a short, quiet, high major chord on cue. It plays on the spectrometer channel (see
 * audio.ts), from wherever the machine is placed, and without audio it is silent.
 */
export interface Rumble {
  /** Rumble at this level from now on, 0 to 1; 0 is silent. */
  level(level: number): void;
  /** Play the chime now. */
  chime(): void;
  /** Where it's heard from, as the machine or the view moves (see placement). */
  place(at: Placement): void;
  /** Fade the rumble out for good (a chime already playing finishes). */
  stop(): void;
}

const SILENT: Rumble = { level() {}, chime() {}, place() {}, stop() {} };

export function rumble(at: Placement): Rumble {
  const ac = audio();
  const out0 = bus('spectrometer');
  if (!ac || !out0) return SILENT;
  const spot = new Spot(ac, out0, at);
  const dest = spot.input;
  const t0 = ac.currentTime;

  const noise = ac.createBufferSource();
  noise.buffer = brownNoise(ac);
  noise.loop = true;
  const buzz = ac.createOscillator();
  buzz.type = 'sawtooth';
  const buzzGain = ac.createGain();
  buzzGain.gain.value = 0.35;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 4;
  const out = ac.createGain();
  out.gain.value = 0;
  noise.connect(filter);
  buzz.connect(buzzGain).connect(filter);
  filter.connect(out).connect(dest);
  noise.start(t0);
  buzz.start(t0);

  const pitch = (level: number) => 22 + 60 * level; // Hz
  let current = -1;
  let stopped = false;
  return {
    level(level) {
      if (stopped || level === current) return;
      current = level;
      // a quick step, not a click
      const now = ac.currentTime;
      if (level > 0) {
        buzz.frequency.setTargetAtTime(pitch(level), now, 0.03);
        filter.frequency.setTargetAtTime(4 * pitch(level), now, 0.03);
      }
      out.gain.setTargetAtTime(level > 0 ? 0.05 + 0.3 * level : 0, now, 0.03);
    },
    chime() {
      chord(ac, dest, ac.currentTime);
    },
    place(at) {
      if (!stopped) spot.place(at);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ac.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.08);
      noise.stop(now + 0.5);
      buzz.stop(now + 0.5);
      // after any chime has rung out
      setTimeout(() => spot.disconnect(), 1000);
    },
  };
}

/** A short, quiet C major chord high up (C6, E6, G6), starting at `at`. */
function chord(ac: AudioContext, dest: AudioNode, at: number): void {
  const g = ac.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.05, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0005, at + 0.35);
  g.connect(dest);
  for (const f of [1046.5, 1318.5, 1568]) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(at);
    o.stop(at + 0.4);
  }
}
