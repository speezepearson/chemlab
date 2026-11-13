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

/** The litres needed (`goalL`), present, and so still to be made, right-aligned together. */
function litres(goalL: number, presentL: number): [needed: string, present: string, short: string] {
  const ls = [goalL, presentL, Math.max(0, goalL - presentL)].map((l) => `${num(l, 2)} L`);
  const w = Math.max(...ls.map((l) => l.length)) + 2;
  const [a, b, c] = ls.map((l) => l.padStart(w));
  return [a, b, c];
}

/**
 * The notice, with `presentL` litres of cryostabilizer on board: at first what's left after the incident, and when
 * the player wakes from a sleep that ended with the station no longer delivering, what the reservoir holds then.
 * While the antinucleant is still to be made (see SUPPLIES), `firstL` is the litres of it on board, and the notice
 * sets out both problems, the antinucleant first and briefly, as a warm-up; with enough of it (null), only the
 * cryostabilizer.
 */
export function notice(presentL: number = VOYAGE.presentL, firstL: number | null = ANTINUCLEANT.presentL): Block[] {
  const [needed, present, short] = litres(GOAL_L, presentL);
  const first: Block[] = [];
  if (firstL !== null) {
    const rows: [string, string][] = [
      ['Antinucleant required to complete journey:', ''],
      ['Antinucleant present:', ''],
      ['Must synthesize more antinucleant:', ''],
    ];
    litres(ANTINUCLEANT_L, firstL).forEach((l, i) => (rows[i][1] = l));
    const w = Math.max(...rows.map(([label]) => label.length));
    first.push(
      {
        kind: 'p',
        text:
          'First, a quick one to help you find your feet! Each passenger enjoys a trace of antinucleant daily ' +
          `(${ANTINUCLEANT.mlPerPassengerDay} mL), to stay delightfully free of ice crystals:`,
      },
      { kind: 'pre', text: rows.map(([label, l]) => label.padEnd(w) + l).join('\n') },
    );
  }
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
        `Sec. 041 - Understaffing) to be proactively depreserved to assist in solving the following ${firstL === null ? 'problem' : 'problems'}:`,
    },
    ...first,
    {
      kind: 'pre',
      text:
        `Cryostabilizer required to complete journey: (${num(VOYAGE.passengers)} passengers) x ` +
        `(${VOYAGE.mlPerPassengerDay} mL/pass/day) x (${num(VOYAGE.days)} days) =\n` +
        `  ${needed}\nCryostabilizer present:\n  ${present}\n\nMust synthesize more cryostabilizer:\n  ${short}`,
    },
    { kind: 'p', text: "If this sounds intimidating, please don't worry! You will have guidance from the following highly experienced crew members:" },
    { kind: 'list' },
    { kind: 'hr' },
    { kind: 'p', text: 'In absence of your assistance, the predicted outcomes are:' },
    { kind: 'pre', text: 'F003 - crew fatality - total\nF004 - passenger fatality - total' },
    { kind: 'hr' },
    {
      kind: 'p',
      text:
        'Your cryo pod has been transported to R046 - Emergency Chemistry Lab' +
        (firstL === null ? '' : ', whose supply station will be refitted for cryostabilizer as soon as the antinucleant is topped up') +
        '. Please select OK to meet your teammates and begin your valuable contributions!',
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
