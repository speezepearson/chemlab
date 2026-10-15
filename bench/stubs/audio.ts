// Headless stand-ins for the Web Audio modules the engine uses (water, rumble, diverter, chime, ambience).
export class WaterSounds {
  update(): void {}
  stop(): void {}
}
const noop = () => {};
export const rumble = () => ({ place: noop, level: noop, stop: noop });
export const diverter = () => ({ place: noop, swing: noop, stop: noop });
export const hushAlarms = noop;
export const chime = noop;
