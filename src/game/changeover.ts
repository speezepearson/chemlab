import { Spot, audio, brownNoise, bus, whiteNoise } from './audio';
import type { Placement } from './place';

/**
 * The sounds of the station's changeover (see CHANGEOVER in tools.ts), driven live by the engine as it runs (so they
 * follow sim time, pauses included): a warning alarm beside the block, two harsh notes a fifth apart, on and off; the
 * rumble of the block and the door sliding, and of the machinery behind the door, duller; and a clunk as each comes to
 * rest. It plays on the receptacle channel (see audio.ts), from where the station is, and without audio it is silent.
 */
export interface ChangeoverSound {
  /** From now on: the alarm sounding or not; and the machinery rumbling at this level, 0 (silent) to 1, muffled if it's behind the door. */
  run(alarm: boolean, rumble: number, muffled: boolean): void;
  /** A clunk, now, of something heavy coming to rest: the door, or the block; duller if it's behind the door. */
  clunk(muffled: boolean): void;
  /** Where it's heard from, as the view moves (see placement). */
  place(at: Placement): void;
  /** Fade out for good (a clunk already playing finishes). */
  stop(): void;
}

const SILENT: ChangeoverSound = { run() {}, clunk() {}, place() {}, stop() {} };

export function changeover(at: Placement): ChangeoverSound {
  const ac = audio();
  const out0 = bus('receptacle');
  if (!ac || !out0) return SILENT;
  const spot = new Spot(ac, out0, at);
  const dest = spot.input;
  const t0 = ac.currentTime;

  // the alarm: two square waves a fifth apart, through a band that takes the edge off, gated on and off
  const alarmGain = ac.createGain();
  alarmGain.gain.value = 0;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1100;
  band.Q.value = 0.9;
  band.connect(alarmGain).connect(dest);
  const tones = [622, 933].map((f) => {
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(band);
    o.start(t0);
    return o;
  });

  // the rumble: brown noise and a low growl under it, through a low-pass that shuts further when it's behind the door
  const noise = ac.createBufferSource();
  noise.buffer = brownNoise(ac);
  noise.loop = true;
  const growl = ac.createOscillator();
  growl.type = 'sawtooth';
  growl.frequency.value = 41;
  const growlGain = ac.createGain();
  growlGain.gain.value = 0.3;
  const low = ac.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 260;
  low.Q.value = 1.5;
  const rumbleGain = ac.createGain();
  rumbleGain.gain.value = 0;
  noise.connect(low);
  growl.connect(growlGain).connect(low);
  low.connect(rumbleGain).connect(dest);
  noise.start(t0);
  growl.start(t0);

  let state = '';
  let stopped = false;
  return {
    run(alarm, rumble, muffled) {
      const key = `${alarm} ${rumble} ${muffled}`;
      if (stopped || key === state) return;
      state = key;
      // quick steps, not clicks
      const now = ac.currentTime;
      alarmGain.gain.setTargetAtTime(alarm ? 0.11 : 0, now, 0.012);
      rumbleGain.gain.setTargetAtTime(rumble > 0 ? 0.25 + 0.75 * rumble : 0, now, 0.08);
      low.frequency.setTargetAtTime(muffled ? 110 : 260, now, 0.1);
      growl.frequency.setTargetAtTime(34 + 14 * rumble, now, 0.1);
    },
    clunk(muffled) {
      if (stopped) return;
      const now = ac.currentTime;
      // the knock of metal on metal, and the thud of the weight behind it
      const knock = ac.createBufferSource();
      knock.buffer = whiteNoise(ac);
      const f = ac.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = muffled ? 300 : 900;
      f.Q.value = 1.2;
      const g = ac.createGain();
      g.gain.setValueAtTime(muffled ? 0.25 : 0.5, now);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 0.09);
      knock.connect(f).connect(g).connect(dest);
      knock.start(now, Math.random(), 0.12);
      const tg = ac.createGain();
      tg.gain.setValueAtTime(0, now);
      tg.gain.linearRampToValueAtTime(muffled ? 0.4 : 0.7, now + 0.005);
      tg.gain.exponentialRampToValueAtTime(0.0005, now + 0.35);
      tg.connect(dest);
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, now);
      o.frequency.exponentialRampToValueAtTime(38, now + 0.3);
      o.connect(tg);
      o.start(now);
      o.stop(now + 0.4);
    },
    place(at) {
      if (!stopped) spot.place(at);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ac.currentTime;
      for (const g of [alarmGain, rumbleGain]) {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, 0.05);
      }
      for (const n of [...tones, noise, growl]) n.stop(now + 0.5);
      setTimeout(() => spot.disconnect(), 1000);
    },
  };
}
