import type { Fragment } from './smell';

/**
 * What Nadia feels of a fluid's heat, pure and DOM-free: on her face, as she sniffs a vessel, and in her hand, as she
 * picks up and carries a flask. She has no thermometer in her skin: she tells five bands apart, by how hot the fluid
 * seems to her (its temperature misjudged a little, see sense.ts), and says which, in the same voice and on the same
 * part of the display as what she smells (see smell.ts). The engine does the rest (see GameEngine.sniff, stepHeat and
 * fumble): this is the bands, her words, how long she can hold what burns her, and how she juggles it meanwhile.
 */

/**
 * How hot a fluid has to seem, more than each of these, for each band: `warm`, `quite` warm, `hot`, hot enough to
 * `burn` her, and so hot she feels it from `far` off and won't go near. Room temperature is 1.
 */
export const HEAT = { warm: 1.5, quite: 3, hot: 5, burn: 10, far: 30 };

/** The bands, from nothing felt (0) up (see HEAT). */
export const WARM = 1;
export const QUITE = 2;
export const HOT = 3;
export const BURN = 4;
export const FAR = 5;

/** The band of a temperature as it seems to her (see HEAT): 0 for nothing felt. */
export function felt(T: number): number {
  return T > HEAT.far ? FAR : T > HEAT.burn ? BURN : T > HEAT.hot ? HOT : T > HEAT.quite ? QUITE : T > HEAT.warm ? WARM : 0;
}

/**
 * How full a flask has to be, more than this share of what it holds, for its heat to reach the hand that holds it: it's
 * held by its neck, over the fluid, and one less full than this is picked up and carried like a cold one.
 */
export const GRIP = 0.5;

/**
 * What she says of the heat on her face as her nose reaches a vessel's rim, by band (see felt), one picked at each
 * sniff: before anything she smells, on a line of its own. However it's put, a band's words tell it from every
 * other's, as a smell's do (see LEADS in smell.ts).
 */
export const SNIFF_SAYS: readonly (readonly string[])[] = [[], ['Kinda warm.'], ['Quite warm.', 'Kinda hot.'], ['Very hot.', 'Really hot.']];
/** And picking up a flask, of the heat in her hand, likewise. */
export const HOLD_SAYS: readonly (readonly string[])[] = [[], ['Kinda warm.'], ['Quite warm.'], ['Yikes, hot.']];
/**
 * What burns her: at a vessel's rim, all of SNIFF_OUCH, a piece at a time, as she jerks her head back, smelling
 * nothing. In her hand, HOLD_OUCH, of which only as much is up as she's had of it (see ouches): its first piece as it
 * starts to burn, the rest one by one as her endurance runs out.
 */
export const SNIFF_OUCH: readonly string[] = ['OW HOT', 'ow', 'ow', 'ow'];
export const HOLD_OUCH: readonly string[] = ['OW HOT', 'ow', 'ow', 'ow', 'OW', 'OW', 'OW'];
/** What she says of what she feels the heat of from where she stands, and won't sniff, or won't pick up: two lines. */
export const SNIFF_FAR: readonly string[] = ['I can feel the heat from here.', 'I’m not putting my face near that.'];
export const HOLD_FAR: readonly string[] = ['I can feel the heat from here.', 'I’m not touching that.'];

/**
 * How what she says of heat is paced, in real seconds (it's on the display, not in the lab): how long after her nose
 * reaches the rim, or her hand takes the flask, she says which band it is (`feel`, by band: the hotter, the sooner);
 * how long between the pieces of SNIFF_OUCH (`ow`); and between the two lines of what's too hot to go near (`far`).
 */
export const HEAT_PACE = { feel: [0, 0.6, 0.45, 0.3], ow: 0.22, far: 0.9 };

/** One of xs, by a random number from 0 up to 1. */
const pick = <T>(xs: readonly T[], rand: () => number): T => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];

/** The two lines of what's too hot to go near, as pieces. */
const far = (says: readonly string[]): Fragment[] => says.map((text, i) => ({ text, wait: i ? HEAT_PACE.far : 0, line: true }));

/**
 * What she says of the heat at a vessel's rim, for a band (see felt), as pieces to go before what she smells (see
 * script in smell.ts): nothing for band 0; a line for WARM, QUITE and HOT; all of SNIFF_OUCH for BURN, which is all
 * she says, since she smells nothing; and for FAR, which she never leans in to, SNIFF_FAR.
 */
export function sniffHeat(band: number, rand: () => number = Math.random): Fragment[] {
  if (band >= FAR) return far(SNIFF_FAR);
  if (band === BURN) return SNIFF_OUCH.map((text, i) => ({ text, wait: i ? HEAT_PACE.ow : 0, line: !i }));
  return band > 0 ? [{ text: pick(SNIFF_SAYS[band], rand), wait: HEAT_PACE.feel[band], line: true }] : [];
}

/**
 * What she says of the heat of a flask she picks up, for a band, likewise: nothing for band 0; a line for WARM, QUITE
 * and HOT; for BURN, all of HOLD_OUCH on one line, of which the engine shows as much as ouches says; and for FAR,
 * which she doesn't pick up, HOLD_FAR.
 */
export function holdHeat(band: number, rand: () => number = Math.random): Fragment[] {
  if (band >= FAR) return far(HOLD_FAR);
  if (band === BURN) return HOLD_OUCH.map((text, i) => ({ text, wait: 0, line: !i }));
  return band > 0 ? [{ text: pick(HOLD_SAYS[band], rand), wait: HEAT_PACE.feel[band], line: true }] : [];
}

/**
 * Her endurance, of a flask that burns her hands: from 1, fresh, down to 0, when she lets go of it. It runs out in
 * `hold` real seconds at the burning point (it's her own body, like her walking, so it isn't on sim time), sooner the
 * hotter the flask seems (see drain), and comes back, over `recover` real seconds from nothing, whenever she isn't
 * carrying something that burns her. Letting go, she sets the flask down on the counter under it if that's no more
 * than `drop` below where she holds it; any further, or over the floor, it falls and smashes.
 */
export const ENDURANCE = { hold: 6, recover: 12, drop: 180 };

/** How fast her endurance runs out, per real second, holding a flask that seems as hot as T (see ENDURANCE). */
export function drain(T: number): number {
  return T / HEAT.burn / ENDURANCE.hold;
}

/**
 * How many pieces of HOLD_OUCH are up with her endurance at e: the first from the start, and one more for each even
 * share of it gone, so the last comes up a share before she lets go.
 */
export function ouches(e: number): number {
  const n = HOLD_OUCH.length;
  return Math.max(1, Math.min(n, 1 + Math.floor((1 - e) * n)));
}

/**
 * How she juggles a flask that burns her, tossing it from hand to hand: each toss takes `s` real seconds, from
 * `across` to one side of where she'd hold it still to as far to the other, along an arc `hop` high in the middle; the
 * flask leans `roll` radians toward the hand it's going to; and it all eases in, and out again, over `ease` seconds.
 * Only how the flask is drawn: where it is, for everything else, is where she'd hold it still.
 */
export const TOSS = { across: 15, hop: 12, s: 0.3, roll: 0.14, ease: 0.15 };

/**
 * Where a juggled flask is, t real seconds into it (see TOSS): how far across from where it'd be held still, to her
 * right, and how far up; and how far it leans, as a share of TOSS.roll (positive toward her right, negative her left).
 */
export function toss(t: number): { across: number; up: number; lean: number } {
  const u = Math.max(0, t) / TOSS.s;
  const k = Math.floor(u);
  const v = u - k;
  const way = k % 2 ? -1 : 1;
  // (upright in each hand, leaning most in the middle of the toss, toward the hand it's going to)
  return { across: way * TOSS.across * (2 * v - 1), up: TOSS.hop * 4 * v * (1 - v), lean: way * (1 - 2 * Math.abs(v - 0.5)) };
}

/**
 * A flask smashed on the floor: what's left of it, a few shards in a pool of what it held, lies there `fade` sim
 * seconds, fading all the while, drawn `r` across from its middle.
 */
export const WRECK = { fade: 4, r: 85 };
