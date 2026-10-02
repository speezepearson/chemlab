import { Spot, audio, brownNoise, bus, whiteNoise } from './audio';
import type { Vessel } from './flask';
import type { Placement } from './place';
import { MAX_FLOW } from './tools';

/**
 * Fluid's sounds, driven by the engine from sim time (so paused is silent): a plink for each drop landing in a
 * vessel, and a trickle for each vessel a stream is running into. A trickle is louder the faster it flows, and like
 * a bottle under a tap it rises in pitch as its vessel fills. Each is heard from where it happens (see placement),
 * so ones well off screen are silent.
 */
export class WaterSounds {
  private voices = new Map<Vessel, Trickle>();
  /** Real seconds until the next plink may play, so a crowd of drops at 16× doesn't turn into a buzz. */
  private plinkWait = 0;

  /**
   * Once a frame, `dt` real seconds after the last: `drops` holds where each drop that landed in a vessel is heard
   * from, and `streams` maps each vessel a stream ran into to its flow (by volume per sim second), how full it now
   * is (0 to 1), and where it's heard from.
   */
  update(dt: number, drops: Placement[], streams: Map<Vessel, { flow: number; full: number; at: Placement }>): void {
    if (drops.length === 0 && streams.size === 0 && this.voices.size === 0) return;
    const ac = audio();
    if (!ac) return;
    this.plinkWait -= dt;
    const audible = drops.filter((at) => at.gain > 0).sort((a, b) => b.gain - a.gain);
    for (let i = 0; i < Math.min(audible.length, 2) && this.plinkWait <= 0; i++) {
      plink(ac, ac.currentTime + i * 0.6 * dt, audible[i]);
      this.plinkWait = 0.07;
    }
    // the loudest few streams, as heard from here, get a voice
    const loud = [...streams]
      .map(([v, s]) => ({ v, s, heard: streamLevel(s.flow) * s.at.gain }))
      .filter(({ heard }) => heard > 0)
      .sort((a, b) => b.heard - a.heard)
      .slice(0, MAX_VOICES);
    const heard = new Set(loud.map(({ v }) => v));
    for (const { v, s } of loud) {
      let t = this.voices.get(v);
      if (!t) this.voices.set(v, (t = new Trickle(ac, s.at)));
      t.set(streamLevel(s.flow), s.full, s.at, dt);
    }
    for (const [v, t] of this.voices)
      if (!heard.has(v) && t.quiet(dt)) {
        t.stop();
        this.voices.delete(v);
      }
  }

  stop(): void {
    for (const t of this.voices.values()) t.stop();
    this.voices.clear();
  }
}

const MAX_VOICES = 6;

/** How loud a stream of `flow` (by volume per sim second) is, from 0 to 1: a flask a second is full loudness. */
export function streamLevel(flow: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, flow) / MAX_FLOW));
}

/** The resonance of a vessel `full` of the way up, in Hz: the air left above the fluid rings higher as it shrinks. */
export function streamPitch(full: number): number {
  return 240 / (1 - 0.9 * Math.max(0, Math.min(1, full)));
}

/** A drop landing: a short sine whose pitch leaps upward as it dies, like a bubble ringing. */
function plink(ac: AudioContext, at: number, where: Placement): void {
  const out = bus('drips');
  if (!out) return;
  const spot = new Spot(ac, out, where);
  const dest = spot.input;
  const f = 700 + 500 * Math.random();
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(f, at);
  o.frequency.exponentialRampToValueAtTime(2.6 * f, at + 0.06);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.12, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.11);
  o.connect(g).connect(dest);
  o.onended = () => spot.disconnect();
  o.start(at);
  o.stop(at + 0.12);
}

/**
 * One vessel's stream: rushing noise, rung through a resonance at the vessel's pitch and burbling unevenly, with
 * bubbles popping near that pitch, more of them the harder it flows.
 */
class Trickle {
  private out: GainNode;
  private spot: Spot;
  private band: BiquadFilterNode;
  private sources: AudioScheduledSourceNode[] = [];
  private level = 0;
  private pitch = 0;
  private silentFor = 0;

  constructor(
    private ac: AudioContext,
    where: Placement,
  ) {
    this.spot = new Spot(ac, bus('trickle')!, where);
    this.out = ac.createGain();
    this.out.gain.value = 0;
    this.out.connect(this.spot.input);
    // the rush
    const hiss = ac.createBufferSource();
    hiss.buffer = whiteNoise(ac);
    hiss.loop = true;
    this.band = ac.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.Q.value = 4;
    // the burble: the rush's loudness wanders, quickly and unevenly
    const burble = ac.createGain();
    burble.gain.value = 0.5;
    const wobble = ac.createBufferSource();
    wobble.buffer = brownNoise(ac);
    wobble.loop = true;
    wobble.playbackRate.value = 6;
    const wobbleLp = ac.createBiquadFilter();
    wobbleLp.type = 'lowpass';
    wobbleLp.frequency.value = 30;
    const depth = ac.createGain();
    depth.gain.value = 0.45;
    wobble.connect(wobbleLp).connect(depth).connect(burble.gain);
    const rush = ac.createGain();
    rush.gain.value = 0.35;
    hiss.connect(this.band).connect(burble).connect(rush).connect(this.out);
    const t = ac.currentTime;
    hiss.start(t, 2 * Math.random());
    wobble.start(t, 2 * Math.random());
    this.sources = [hiss, wobble];
  }

  /** Flow at `level` (0 to 1) into a vessel `full` of the way up, heard from `where`, for the next `dt` real seconds. */
  set(level: number, full: number, where: Placement, dt: number): void {
    const { ac } = this;
    const now = ac.currentTime;
    this.spot.place(where);
    const pitch = streamPitch(full);
    if (level !== this.level) this.out.gain.setTargetAtTime(level, now, 0.06);
    if (Math.abs(pitch - this.pitch) > 0.5) this.band.frequency.setTargetAtTime(pitch, now, 0.1);
    this.level = level;
    this.pitch = pitch;
    this.silentFor = 0;
    // bubbles, as a Poisson process
    const rate = 4 + 40 * level;
    let at = 0;
    for (;;) {
      at += -Math.log(1 - Math.random()) / rate;
      if (at >= dt) break;
      this.bubble(now + at, pitch * (0.8 + 0.6 * Math.random()));
    }
  }

  /** Nothing flowed this frame: fade out, and say whether it's been quiet long enough to let the voice go. */
  quiet(dt: number): boolean {
    if (this.level !== 0) this.out.gain.setTargetAtTime(0, this.ac.currentTime, 0.06);
    this.level = 0;
    return (this.silentFor += dt) > 0.5;
  }

  stop(): void {
    const now = this.ac.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, 0.03);
    for (const s of this.sources) s.stop(now + 0.2);
    this.sources[0].onended = () => this.spot.disconnect();
  }

  private bubble(at: number, f: number): void {
    const { ac } = this;
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(1.8 * f, at + 0.03);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.03 + 0.09 * Math.random(), at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    o.connect(g).connect(this.out);
    o.start(at);
    o.stop(at + 0.05);
  }
}
