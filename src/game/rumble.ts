/**
 * A machine working through phases: a rumble, synthesized from low-passed brown noise with a buzzing sawtooth
 * under it, whose loudness and pitch step up to each phase's level (from 0 to 1) and hold there, with a short,
 * quiet, high major chord as each phase ends. It falls silent after the last. Starting it needs a user
 * gesture (browsers keep audio off until one); without audio it's silent. Returns a function that stops it
 * early.
 */
export function rumble(phases: readonly { end: number; level: number }[]): () => void {
  const ac = audio();
  if (!ac) return () => {};
  void ac.resume();
  const t0 = ac.currentTime;
  const end = t0 + phases[phases.length - 1].end;

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
  buzz.frequency.value = pitch(phases[0].level);
  filter.frequency.value = 4 * pitch(phases[0].level);
  out.gain.value = 0;
  const chimes: GainNode[] = [];
  let start = t0;
  for (const { end: phaseEnd, level } of phases) {
    // a quick step, not a click
    buzz.frequency.setTargetAtTime(pitch(level), start, 0.03);
    filter.frequency.setTargetAtTime(4 * pitch(level), start, 0.03);
    out.gain.setTargetAtTime(0.05 + 0.3 * level, start, 0.03);
    start = t0 + phaseEnd;
    chimes.push(chord(ac, start));
  }
  out.gain.setTargetAtTime(0, end, 0.08);
  noise.start(t0);
  buzz.start(t0);
  noise.stop(end + 0.5);
  buzz.stop(end + 0.5);
  return () => {
    const now = ac.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + 0.1);
    noise.stop(now + 0.15);
    buzz.stop(now + 0.15);
    for (const g of chimes) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(0, now);
    }
  };
}

/** A short, quiet C major chord high up (C6, E6, G6), starting at `at`. Returns its volume, to silence it. */
function chord(ac: AudioContext, at: number): GainNode {
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
  return g;
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
