// Headless stand-ins for the Web Audio modules the engine uses (water, diverter, changeover, chime, shatter, ambience).
export class WaterSounds {
  update(): void {}
  stop(): void {}
}
const noop = () => {};
export const diverter = () => ({ place: noop, swing: noop, stop: noop });
export const changeover = () => ({ place: noop, run: noop, clunk: noop, stop: noop });
export const hushAlarms = noop;
export const chime = noop;
export const shatter = noop;
