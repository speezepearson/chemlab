/**
 * A machine's rumble, synthesized: low-passed brown noise with a buzzing sawtooth under it. Its loudness and
 * pitch follow a level from 0 to 1 that ramps linearly between the given points, and it falls silent after
 * the last one. Starting it needs a user gesture (browsers keep audio off until one); without audio it's
 * silent. Returns a function that stops it early.
 */
export function rumble(points: readonly { t: number; level: number }[]): () => void {
  const ac = audio();
  if (!ac) return () => {};
  void ac.resume();
  const t0 = ac.currentTime;
  const end = t0 + points[points.length - 1].t;

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
  noise.connect(filter);
  buzz.connect(buzzGain).connect(filter);
  filter.connect(out).connect(ac.destination);

  const pitch = (level: number) => 22 + 60 * level; // Hz
  for (const [i, { t, level }] of points.entries()) {
    const at = t0 + t;
    const ramp = (p: AudioParam, v: number) => (i ? p.linearRampToValueAtTime(v, at) : p.setValueAtTime(v, at));
    ramp(buzz.frequency, pitch(level));
    ramp(filter.frequency, 4 * pitch(level));
    ramp(out.gain, 0.05 + 0.3 * level);
  }
  out.gain.linearRampToValueAtTime(0, end + 0.3);
  noise.start(t0);
  buzz.start(t0);
  noise.stop(end + 0.4);
  buzz.stop(end + 0.4);
  return () => {
    const now = ac.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + 0.1);
    noise.stop(now + 0.15);
    buzz.stop(now + 0.15);
  };
}

let ctx: AudioContext | null | undefined;

function audio(): AudioContext | null {
  if (ctx === undefined) {
    try {
      ctx = new AudioContext();
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
