import { ANTINUCLEANT, ANTINUCLEANT_L, GOAL_L, VOYAGE } from '../game/config';
import { PLAYER } from './log';

/**
 * The cheerful notice from Celestia Starlines that wakes the player, projected on the inside of their cryopod's
 * front (see view.ts's AirlockView), as blocks of text: a heading, paragraphs, preformatted figures, an empty list
 * (the crew who'll guide them, of whom there are none), small print, and rules between its sections.
 */
export type Block =
  | { kind: 'brand' | 'h' | 'p' | 'small' | 'pre'; text: string }
  | { kind: 'list' }
  | { kind: 'hr' };

const num = (x: number, digits = 0) => x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * The figures for one thing the ship is short of, as the system's template prints them for anything: its name; the
 * litres the voyage needs, set out as the sum they come from, a line to each factor; the litres present; and the
 * deficit, never less than nothing. The litres are right-aligned together.
 */
function figures(name: string, mlPerPassengerDay: number, goalL: number, presentL: number): Block {
  const ls = [goalL, presentL, Math.max(0, goalL - presentL)].map((l) => `${num(l, 2)} L`);
  const w = Math.max(...ls.map((l) => l.length));
  const [needed, present, short] = ls.map((l) => l.padStart(w));
  const required = `Required: ${needed}`;
  // each factor after the first on a line of its own, its x under the gap after the =
  const by = `\n${' '.repeat(required.length + 4)}x `;
  // microlitres, to the digits the rate is given in
  const ul = Number((mlPerPassengerDay * 1000).toPrecision(6));
  return {
    kind: 'pre',
    text:
      `${name}:\n\n` +
      `${required}  =   ${num(VOYAGE.passengers)} passengers${by}${ul} uL/pass/day${by}${num(VOYAGE.days)} days\n` +
      `Present:  ${present}\n\nDEFICIT:  ${short}`,
  };
}

/**
 * The notice, with `presentL` litres of cryostabilizer on board: at first what's left after the incident, and when
 * the player wakes from a sleep that ended with the station no longer delivering, what the reservoir holds then.
 * While the antinucleant is still to be made (see SUPPLIES), `firstL` is the litres of it on board, and its figures
 * come first, in the same template as the cryostabilizer's; with enough of it (null), only the cryostabilizer's.
 * The notice was written for the happy path: nothing in it is worded for what it's reporting, and it says
 * "problem(s)" however many there are.
 */
export function notice(presentL: number = VOYAGE.presentL, firstL: number | null = ANTINUCLEANT.presentL): Block[] {
  const first: Block[] = firstL === null ? [] : [figures('Antinucleant', ANTINUCLEANT.mlPerPassengerDay, ANTINUCLEANT_L, firstL)];
  return [
    { kind: 'brand', text: '✦ Celestia Starlines' },
    { kind: 'h', text: `Good morning, passenger ${PLAYER}!` },
    { kind: 'p', text: 'An unknown error occurred en route to Mu Ceti. We will arrive shortly, in 12.2 years. Thank you for your understanding!' },
    { kind: 'hr' },
    {
      kind: 'p',
      text:
        'Congratulations! On the basis of the incomparable expertise demonstrated by your career as a(n) ELEMENTARY SCHOOL ' +
        'SOCIAL STUDIES TEACHER, our intelligent automated systems have identified you as the most competent ' +
        'currently-capable passenger in the fields of CHEMISTRY, BIOLOGY!',
    },
    {
      kind: 'p',
      text:
        'In the absence of any more capable crew members or passengers, you have been selected (per Passenger Agreement ' +
        'Sec. 041 - Understaffing) to be proactively depreserved to assist in solving the following problem(s):',
    },
    ...first,
    figures('Cryostabilizer', VOYAGE.mlPerPassengerDay, GOAL_L, presentL),
    { kind: 'p', text: "If this sounds intimidating, please don't worry! You will have guidance from the following highly experienced crew members:" },
    { kind: 'list' },
    { kind: 'hr' },
    { kind: 'p', text: 'In absence of your assistance, the predicted outcomes are:' },
    { kind: 'pre', text: 'F003 - crew fatality - total\nF004 - passenger fatality - total' },
    { kind: 'hr' },
    {
      kind: 'p',
      text: 'Your cryo pod has been transported to R046 - Emergency Chemistry Lab. Please select OK to meet your teammates and begin your valuable contributions!',
    },
    { kind: 'hr' },
    { kind: 'p', text: 'Thank you for flying with Celestia Starlines! We look forward to flying with you again soon.' },
    { kind: 'hr' },
    {
      kind: 'small',
      text:
        'Before you go, ask any of our friendly associates about the Celestia Starlines Rewards Platinum card, where you ' +
        'can earn 70,000 bonus lightyears plus our exclusive Cosmic Companion Pass™ when you\'re approved and meet the ' +
        'spending requirements. Apply on your way out today!',
    },
  ];
}

/** The notice that wakes the player once there's enough cryostabilizer for the rest of the voyage. */
export function arrival(): Block[] {
  return [
    { kind: 'brand', text: '✦ Celestia Starlines' },
    { kind: 'h', text: 'Welcome to Mu Ceti.' },
  ];
}
