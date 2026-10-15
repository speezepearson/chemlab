import { Spot, audio, bus } from './audio';
import type { Placement } from './place';

/**
 * The cryostabilizer station's chime, once it has delivered steadily for a sim minute (see DELIVERY) and the airlock
 * opens: a happy major chord rung as bells, a root, third, fifth and octave one after another, each ringing on as the
 * next comes in. It plays on the receptacle channel (see audio.ts), from the station; without audio it's silent.
 */
export function chime(at: Placement): void {
  const ac = audio();
  const out = bus('receptacle');
  if (!ac || !out) return;
  const spot = new Spot(ac, out, at);
  const now = ac.currentTime + 0.02;
  // C major, from C5
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => ding(ac, spot.input, now + i * 0.14, f));
  setTimeout(() => spot.disconnect(), 4000);
}

/** One bell-like ding at `freq`: a sine with a fainter, inharmonic partial over it, struck and dying away. */
function ding(ac: AudioContext, dest: AudioNode, at: number, freq: number): void {
  for (const [ratio, level, ring] of [
    [1, 0.16, 2.2],
    [2.76, 0.04, 0.7],
  ] as const) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + ring);
    g.connect(dest);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    o.connect(g);
    o.start(at);
    o.stop(at + ring + 0.05);
  }
}
