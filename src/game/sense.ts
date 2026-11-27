/**
 * Nadia is merely human, an imperfect judge: whenever something she senses is held up against a threshold (how warm a
 * fluid is, how strong a smell), what she goes by is the real thing misjudged a little, by up to JUDGE / 2 either way,
 * evenly, afresh each time. So what's well clear of a threshold reads the same every time, and what's right at one can
 * go either way from one try to the next. Pure and DOM-free.
 */
export const JUDGE = 0.2;

/** `x` as she judges it this time (see JUDGE), by a random number from 0 up to 1. */
export function misjudge(x: number, rand: () => number = Math.random): number {
  return x * (1 + JUDGE * (rand() - 0.5));
}
