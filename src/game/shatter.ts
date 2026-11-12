import { Spot, audio, bus, whiteNoise } from './audio';
import type { Placement } from './place';

/**
 * A thermometer shattering (see Tool.warm): a sharp crack, a snap of bright noise gone in a tenth of a second, and
 * after it the tinkle of a few shards, short high pings at random pitches, scattered over the next third of a second.
 * It plays on the glass channel (see audio.ts), from the thermometer's bulb; without audio it's silent.
 */
export function shatter(at: Placement): void {
  const ac = audio();
  const out = bus('glass');
  if (!ac || !out) return;
  const spot = new Spot(ac, out, at);
  const now = ac.currentTime + 0.01;
  const noise = ac.createBufferSource();
  noise.buffer = whiteNoise(ac);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2000;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.45, now + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  noise.connect(hp).connect(g).connect(spot.input);
  noise.start(now, Math.random());
  noise.stop(now + 0.12);
  for (let i = 0; i < 7; i++) ping(ac, spot.input, now + 0.015 + Math.random() * 0.3, 2600 + Math.random() * 4800);
  setTimeout(() => spot.disconnect(), 2000);
}

/** One shard's ping at `freq`: a sine with a fainter, inharmonic partial over it, struck and gone in a few tenths of a second. */
function ping(ac: AudioContext, dest: AudioNode, at: number, freq: number): void {
  for (const [ratio, level, ring] of [
    [1, 0.05, 0.25],
    [2.32, 0.02, 0.1],
  ] as const) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.002);
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
