/**
 * A machine's sounds, driven live by whoever runs it (so they follow sim time, pauses included): a rumble,
 * synthesized from low-passed brown noise with a buzzing sawtooth under it, whose loudness and pitch follow a
 * level from 0 (silent) to 1; and a short, quiet, high major chord on cue. Starting it needs a user gesture
 * (browsers keep audio off until one); without audio it's silent.
 */
export interface Rumble {
  /** Rumble at this level from now on, 0 to 1; 0 is silent. */
  level(level: number): void;
  /** Play the chime now. */
  chime(): void;
  /** Fade the rumble out for good (a chime already playing finishes). */
  stop(): void;
}

const SILENT: Rumble = { level() {}, chime() {}, stop() {} };

export function rumble(): Rumble {
  const ac = audio();
  if (!ac) return SILENT;
  void ac.resume();
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
  filter.connect(out).connect(ac.destination);
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
      chord(ac, ac.currentTime);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ac.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.08);
      noise.stop(now + 0.5);
      buzz.stop(now + 0.5);
    },
  };
}

/** A short, quiet C major chord high up (C6, E6, G6), starting at `at`. */
function chord(ac: AudioContext, at: number): void {
  const g = ac.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.05, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0005, at + 0.35);
  g.connect(ac.destination);
  for (const f of [1046.5, 1318.5, 1568]) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(at);
    o.stop(at + 0.4);
  }
}

let ctx: AudioContext | null | undefined;

function audio(): AudioContext | null {
  if (ctx === undefined) {
    try {
      ctx = new AudioContext();
      // the sim stops while the page is hidden, so its sounds should too
      const c = ctx;
      document.addEventListener('visibilitychange', () => void (document.hidden ? c.suspend() : c.resume()));
    } catch {
      ctx = null;
    }
  }
  return ctx;
}

let noiseBuffer: AudioBuffer | null = null;

/** Two seconds of brown noise: a random walk, which is mostly rumble. */
function brownNoise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const buf = ac.createBuffer(1, 2 * ac.sampleRate, ac.sampleRate);
  const d = buf.getChannelData(0);
  let x = 0;
  for (let i = 0; i < d.length; i++) {
    x = (x + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = 3.5 * x;
  }
  return (noiseBuffer = buf);
}
