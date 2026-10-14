// Headless stand-ins for the Web Audio modules the engine uses (water, rumble, beeper, ambience).
export class WaterSounds {
  update(): void {}
  stop(): void {}
}
const noop = () => {};
export const rumble = () => ({ place: noop, level: noop, stop: noop });
export const beeper = () => ({ place: noop, beep: noop, verdict: noop, flush: noop, stop: noop });
export const hushAlarms = noop;
