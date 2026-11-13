import { TARGET, pairOf } from '../chem/species';
import { ANTINUCLEANT, ANTINUCLEANT_L, CAP, FLASK_L, GOAL_L, GOAL_TARGET, VOYAGE } from './config';

/**
 * Something the ship is short of, which the station's block of the wall is fitted for (see STATION in tools.ts): a
 * reservoir of it, short of what the voyage needs, to be topped up through the block's funnel.
 */
export interface Supply {
  /** What it's called, in lower case: printed on its block's plate over its reservoir, and said in the pod's notice. */
  name: string;
  /** The species it is. */
  species: number;
  /** How much of it the voyage needs, in litres; and in molecules, which is the goal for its reservoir. */
  goalL: number;
  goal: number;
  /** How much of it is on board to start with, in litres; and in molecules, which is what its reservoir starts with. */
  startL: number;
  start: number;
  /** How much its reservoir holds, by volume: about three times the goal, so the goal is a third of the way up its gauge. */
  cap: number;
  /**
   * Whether delivering it steadily for long enough opens the airlock (see DELIVERY), to sleep in the pod until there's
   * enough: only where that takes years.
   */
  airlock: boolean;
}

/** How many molecules make `l` litres of anything (see FLASK_L), whole. */
const molecules = (l: number) => Math.round((l / FLASK_L) * CAP);

/**
 * What the ship is short of, in the order the station is fitted for them: a little antinucleant, R–B, which is soon
 * made; and then the cryostabilizer, the R–G–B triangle, which is the game. Once the reservoir holds
 * enough of one, the station's block is changed for the next one's (see CHANGEOVER in tools.ts).
 */
export const SUPPLIES: readonly Supply[] = [
  {
    name: 'antinucleant',
    species: pairOf('R', 'B'),
    goalL: ANTINUCLEANT_L,
    goal: molecules(ANTINUCLEANT_L),
    startL: ANTINUCLEANT.presentL,
    start: molecules(ANTINUCLEANT.presentL),
    cap: 100 * CAP,
    airlock: false,
  },
  {
    name: 'cryostabilizer',
    species: TARGET,
    goalL: GOAL_L,
    goal: GOAL_TARGET,
    startL: VOYAGE.presentL,
    start: molecules(VOYAGE.presentL),
    // room for the goal even if everything let in is only just pure enough, and the rest of it single atoms
    cap: 540 * CAP,
    airlock: true,
  },
];

/** The first thing the station is fitted for, in a new lab: the antinucleant. */
export const FIRST_SUPPLY = SUPPLIES[0];
/** The last, and the one the game is won by: the cryostabilizer. Labs saved before there was any other are on it. */
export const CRYOSTABILIZER = SUPPLIES[SUPPLIES.length - 1];

/** What the station is fitted for once there's enough of `s`, or null if `s` is the last. */
export function nextSupply(s: Supply): Supply | null {
  return SUPPLIES[SUPPLIES.indexOf(s) + 1] ?? null;
}

/** How many litres `n` molecules of anything make (see FLASK_L). */
export function litresOf(n: number): number {
  return (n / CAP) * FLASK_L;
}
