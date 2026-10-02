import { audio, brownNoise, bus, cached } from './audio';

/**
 * The ship's background, from the end of the intro's console log on: a warm low hum, and far off down the
 * corridors a klaxon whooping and a fire alarm blaring its three-beat pattern, both muffled and echoing. It's
 * atmosphere rather than anything happening on the bench, so unlike every other sound it plays on in real time,
 * through pauses and the intro's notice. Each part plays into its own channel (see volumes.ts).
 */
export function ambience(on: boolean): void {
  const ac = audio();
  for (const f of build()) {
    const now = ac!.currentTime;
    f.gain.cancelScheduledValues(now);
    f.gain.setTargetAtTime(on ? 1 : 0, now, on ? 1.2 : 0.3);
  }
}

/** Where each part fades in and out (none without audio), built the first time the ambience is wanted. */
let faders: GainNode[] | undefined;

function build(): GainNode[] {
  if (faders) return faders;
  const ac = audio();
  const hum = bus('hum');
  const klaxon = bus('klaxon');
  const alarm = bus('alarm');
  if (!ac || !hum || !klaxon || !alarm) return (faders = []);
  faders = [hum, klaxon, alarm].map((dest) => {
    const f = ac.createGain();
    f.gain.value = 0;
    f.connect(dest);
    return f;
  });
  const [toHum, toKlaxon, toAlarm] = faders;
  buildHum(ac, toHum);
  loop(ac, cached('klaxon', ac, klaxonWave, KLAXON_PERIOD), distant(ac, toKlaxon, 0.03, 1400), 0);
  loop(ac, cached('alarm', ac, alarmWave, ALARM_PERIOD), distant(ac, toAlarm, 0.02, 2200), 0.7);
  return faders;
}

/** Mains-like partials around 48 Hz, beating slowly against near-twins, over muffled air handling. */
function buildHum(ac: AudioContext, dest: AudioNode): void {
  const warm = ac.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = 500;
  const level = ac.createGain();
  level.gain.value = 0.16;
  warm.connect(level).connect(dest);
  const partials: [hz: number, amp: number][] = [
    [48, 0.5], [48.2, 0.15], [96, 0.4], [96.5, 0.1], [144, 0.25], [192, 0.15], [240, 0.08], [288, 0.04],
  ];
  for (const [hz, amp] of partials) {
    const o = ac.createOscillator();
    o.frequency.value = hz;
    const g = ac.createGain();
    g.gain.value = amp;
    o.connect(g).connect(warm);
    o.start();
  }
  // air through ducts
  const air = ac.createBufferSource();
  air.buffer = brownNoise(ac);
  air.loop = true;
  const airLp = ac.createBiquadFilter();
  airLp.type = 'lowpass';
  airLp.frequency.value = 160;
  const airG = ac.createGain();
  airG.gain.value = 0.5;
  air.connect(airLp).connect(airG).connect(warm);
  air.start();
  // a slow swell, so it breathes
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.09;
  const depth = ac.createGain();
  depth.gain.value = 0.03;
  lfo.connect(depth).connect(level.gain);
  lfo.start();
}

/** Play a buffer on loop into `dest`, `offset` seconds in. */
function loop(ac: AudioContext, buf: AudioBuffer, dest: AudioNode, offset: number): void {
  const s = ac.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.connect(dest);
  s.start(ac.currentTime, offset);
}

/** Somewhere else on the ship: muffled through a wall, quiet, with an echo off the corridor. Returns its input. */
function distant(ac: AudioContext, dest: AudioNode, level: number, cutoff: number): AudioNode {
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  const g = ac.createGain();
  g.gain.value = level;
  lp.connect(g).connect(dest);
  const delay = ac.createDelay(1);
  delay.delayTime.value = 0.17;
  const fb = ac.createGain();
  fb.gain.value = 0.35;
  g.connect(delay).connect(fb).connect(delay);
  fb.connect(dest);
  return lp;
}

/** One klaxon cycle, in seconds: a whoop and a breath. */
const KLAXON_PERIOD = 2.2;
const WHOOP = 1.3;

/** A harsh horn sweeping up from 280 to 760 Hz, then silence until the next. */
function klaxonWave(d: Float32Array, rate: number): void {
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    if (t >= WHOOP) {
      d[i] = 0;
      continue;
    }
    const f = 280 * (760 / 280) ** (t / WHOOP);
    phase += (2 * Math.PI * f) / rate;
    d[i] = envelope(t, WHOOP, 0.03) * horn(phase, 9);
  }
}

/** The fire alarm's temporal-three pattern, in seconds: three half-second blares, then a long gap. */
const ALARM_PERIOD = 4;

/** A buzzing 520 Hz square-ish horn, sounding for half a second on each of the first three seconds. */
function alarmWave(d: Float32Array, rate: number): void {
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    const beat = Math.floor(t);
    const u = t - beat;
    if (beat >= 3 || u >= 0.5) {
      d[i] = 0;
      continue;
    }
    const phase = 2 * Math.PI * 520 * t;
    let sq = 0;
    for (let k = 1; k <= 11; k += 2) sq += Math.sin(k * phase) / k;
    const buzz = 0.75 + 0.25 * Math.sign(Math.sin(2 * Math.PI * 90 * t));
    d[i] = envelope(u, 0.5, 0.01) * buzz * sq;
  }
}

/** A sawtooth from its first `n` harmonics, about ±1. */
function horn(phase: number, n: number): number {
  let s = 0;
  for (let k = 1; k <= n; k++) s += Math.sin(k * phase) / k;
  return 0.6 * s;
}

/** 1 in the middle of a `len`-second sound, ramping from and to 0 over `ramp` seconds at its ends. */
function envelope(t: number, len: number, ramp: number): number {
  return Math.min(1, t / ramp, (len - t) / ramp);
}
