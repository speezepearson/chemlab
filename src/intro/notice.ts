import { GOAL_L, VOYAGE } from '../game/config';
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

/** The litres needed, present, and so still to be made, right-aligned together. */
function litres(presentL: number): [needed: string, present: string, short: string] {
  const ls = [GOAL_L, presentL, Math.max(0, GOAL_L - presentL)].map((l) => `${num(l, 2)} L`);
  const w = Math.max(...ls.map((l) => l.length)) + 2;
  const [a, b, c] = ls.map((l) => l.padStart(w));
  return [a, b, c];
}

/**
 * The notice that wakes the player: the first time, with the litres of cryostabilizer present (`presentL`) left on
 * board; and again, the same with what's present now, when their supply stopped while they slept. At Mu Ceti, it's
 * welcomeNotice instead.
 */
export function notice(presentL = VOYAGE.presentL): Block[] {
  const [needed, present, short] = litres(presentL);
  return [
    { kind: 'brand', text: '✦ Celestia Starlines' },
    { kind: 'h', text: `Good morning, passenger ${PLAYER}!` },
    { kind: 'p', text: 'An unknown error occurred en route to Mu Ceti. We will arrive shortly, in 12.2 years. Thank you for your understanding!' },
    { kind: 'hr' },
    {
      kind: 'p',
      text:
        'Congratulations! On the basis of the incomparable expertise demonstrated by your career as a(n) ELEMENTARY SCHOOL ' +
        'GEOGRAPHY TEACHER, our intelligent automated systems have identified you as the most competent ' +
        'currently-capable passenger in the fields of CHEMISTRY, BIOLOGY!',
    },
    {
      kind: 'p',
      text:
        'In the absence of any more capable crew members or passengers, you have been selected (per Passenger Agreement ' +
        'Sec. 041 - Understaffing) to be proactively depreserved to assist in solving the following problem:',
    },
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

/** The notice that wakes the player at Mu Ceti, with the litres of cryostabilizer they added to the ship's (`madeL`). */
export function welcomeNotice(madeL: number): Block[] {
  return [
    { kind: 'brand', text: '✦ Celestia Starlines' },
    { kind: 'h', text: 'Welcome to Mu Ceti!' },
    { kind: 'p', text: `Good morning, passenger ${PLAYER}! We have arrived at Mu Ceti, right on schedule. Thank you for your patience!` },
    { kind: 'hr' },
    {
      kind: 'p',
      text:
        `All ${num(VOYAGE.passengers)} passengers in cryostasis were kept in excellent condition for the remainder of the ` +
        'journey, thanks in part to the following volunteer contribution:',
    },
    { kind: 'pre', text: `Cryostabilizer contributed by passenger ${PLAYER}:\n  ${num(madeL, 2)} L` },
    { kind: 'p', text: 'Celestia Starlines values your feedback! A short survey about your journey will be sent to you shortly.' },
    { kind: 'hr' },
    { kind: 'p', text: 'Please select OK to disembark and begin your new life!' },
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
