// Headless stand-ins for the Web Audio modules the engine uses (water, rumble, diverter, ambience).
export class WaterSounds {
  update(): void {}
  stop(): void {}
}
const noop = () => {};
export const rumble = () => ({ place: noop, level: noop, stop: noop });
export const diverter = () => ({ place: noop, swing: noop, flush: noop, stop: noop });
export const hushAlarms = noop;
