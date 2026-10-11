import { GOAL_L, VOYAGE } from '../game/config';
import { PLAYER } from './log';

/**
 * The cheerful notice from Celestia Starlines that wakes the player, projected on their cryopod's glass (see
 * view.ts's AirlockView), as blocks of text: a heading, paragraphs, preformatted figures, an empty list (the crew
 * who'll guide them, of whom there are none), and rules between its sections.
 */
export type Block =
  | { kind: 'brand' | 'h' | 'p' | 'pre'; text: string }
  | { kind: 'list' }
  | { kind: 'hr' };

const num = (x: number, digits = 0) => x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** The litres needed and present, right-aligned together. */
function litres(): [needed: string, present: string] {
  const [a, b] = [`${num(GOAL_L, 3)} L`, `${num(VOYAGE.presentL, 3)} L`];
  const w = Math.max(a.length, b.length) + 2;
  return [a.padStart(w), b.padStart(w)];
}

export function notice(): Block[] {
  const [needed, present] = litres();
  return [
    { kind: 'brand', text: '✦ Celestia Starlines' },
    { kind: 'h', text: `Good morning, passenger ${PLAYER}!` },
    { kind: 'p', text: 'An unknown error occurred en route to Mu Ceti. We will arrive shortly, in 12.2 years. Thank you for your understanding!' },
    { kind: 'hr' },
    {
      kind: 'p',
      text:
        'Congratulations! On the basis of the incomparable expertise demonstrated by your career as a ELEMENTARY SCHOOL ' +
        'GEOLOGY TEACHER, our intelligent automated systems have identified you as the most competent ' +
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
        `${needed}\nCryostabilizer present:\n${present}`,
    },
    { kind: 'p', text: "If this sounds intimidating, please don't worry! You will have guidance from the following highly experienced crew members:" },
    { kind: 'list' },
    { kind: 'hr' },
    { kind: 'p', text: 'In absence of your assistance, the predicted effects are:' },
    { kind: 'pre', text: 'F003 - crew fatality - total\nF004 - passenger fatality - total' },
    { kind: 'hr' },
    {
      kind: 'p',
      text: 'Your cryo pod has been transported to R046 - Emergency Chemistry Lab. Please select OK to meet your teammates and begin your valuable contributions!',
    },
    { kind: 'hr' },
    { kind: 'p', text: 'Thank you for flying with Celestia Starlines! We look forward to seeing you again soon!' },
  ];
}
