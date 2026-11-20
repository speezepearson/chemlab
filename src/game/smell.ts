import { T_ROOM } from '../chem/params';
import { NS, SPECIES } from '../chem/species';

/**
 * Something that smells: a species, by its name (see species.ts), what it smells like to Nadia, and how potent it is:
 * the share of a fluid's molecules it has to be, at room temperature, for her to smell it at all. `sweet` marks the
 * one kinship written into the table (see ODORANTS).
 */
export interface Odorant {
  species: string;
  simile: string;
  threshold: number;
  sweet: boolean;
}

const odorant = (species: string, simile: string, threshold: number, sweet = false): Odorant => ({ species, simile, threshold, sweet });

/**
 * Everything that smells: only the small molecules are volatile, the four colors' free atoms and the six pairs. The
 * solvent has no smell, nor has any molecule of three atoms or four, so a clean batch of the cryostabilizer smells of
 * nothing, and any smell on it is its impurities'.
 *
 * The similes are Nadia's, from school and home, and are assigned so as to give nothing away: none goes with its
 * species' colors, and a pair's has nothing to do with its two atoms'. The one kinship is that the three pairs with a
 * blue atom smell cloyingly sweet, each of a different sweet thing, while the other three are dry or plain. That's
 * written in here, against the default chemistry's uphill bonds: it doesn't follow edits to the chemistry.
 *
 * The thresholds span three orders of magnitude. Free black is the most potent, since a trace of it is what spoils the
 * cryostabilizer, and nothing else in the lab shows a trace well. What's waded through in bulk (the faucets' R, G and
 * B, R–G, and the R–K the antinucleant is made from) is weak, so it doesn't drown the rest. The antinucleant, R–B, is
 * the most potent after free black.
 */
export const ODORANTS: readonly Odorant[] = [
  odorant('R', 'wet coats', 0.02),
  odorant('G', 'floor wax', 0.06),
  odorant('B', 'struck match', 0.025),
  odorant('K', 'swimming pool', 1e-4),
  odorant('R–G', 'pencil shavings', 0.1),
  odorant('R–B', 'overripe banana', 3e-4, true),
  odorant('G–B', 'cough syrup', 3e-3, true),
  odorant('R–K', 'chalk dust', 0.02),
  odorant('G–K', 'new sneakers', 1.5e-3),
  odorant('B–K', 'bubblegum', 5e-4, true),
];

/** Each odorant's species, as an index into SPECIES. */
const INDEX: readonly number[] = ODORANTS.map((o) => {
  const s = SPECIES.find((sp) => sp.name === o.species);
  if (!s) throw new Error(`no species ${o.species}`);
  return s.i;
});

/**
 * How strong a smell is put into words: by how many times over its own threshold the odorant is, on a log scale, a
 * word for each factor of STEP, from WORDS' first at the threshold itself up to its last. STEP is a little under ten,
 * so that something reeks from a thousand times its threshold.
 */
export const STEP = 10 ** 0.75;
export const WORDS = ['a trace of', 'a whiff of', 'smells of', 'smells strongly of', 'reeks of'] as const;
/** The first of WORDS that's a verb: the fainter ones are things, which a sentence says differently (see sentence). */
const VERBS = 2;

/**
 * How much more a warm fluid gives off than one at room temperature, and how much less a cold one: exp(VOLATILITY ×
 * (1 − T_ROOM / T)), as a vapor's pressure goes. That's 1 at room temperature, falls smoothly to nothing as T goes to
 * 0 (a fifth at half the room's), and levels off when hot (twice at double the room's, never more than e^VOLATILITY,
 * four and a half times: a little under one step of STEP). It's the same for every odorant, so warming a fluid makes
 * all its smells stronger together.
 */
export const VOLATILITY = 1.5;
export function waft(T: number): number {
  return T > 0 ? Math.exp(VOLATILITY * (1 - T_ROOM / T)) : 0;
}

/**
 * How strong each of ODORANTS is in a fluid at temperature T, in multiples of its threshold: its share of the fluid's
 * molecules (the solvent's count too, so diluting weakens a smell), times what the warmth does (see waft), over that
 * threshold. All 0 for no fluid.
 */
export function strengths(n: ArrayLike<number>, T = T_ROOM): number[] {
  let all = 0;
  for (let s = 0; s < NS; s++) all += Math.max(0, n[s]);
  const warm = waft(T);
  return ODORANTS.map((o, i) => (all > 0 ? (Math.max(0, n[INDEX[i]]) / all) * warm / o.threshold : 0));
}

/** A strength (see strengths) as a level: the steps of STEP it is over the threshold, 0 at it and negative under it. */
export function levelOf(strength: number): number {
  return strength > 0 ? Math.log(strength) / Math.log(STEP) : -Infinity;
}

/** The words for a level (see WORDS): the last of them for anything past it. */
export function wordFor(level: number): number {
  return Math.max(0, Math.min(WORDS.length - 1, Math.floor(level)));
}

/** An odorant smelled, and how strongly, as a level (see levelOf). */
export interface Smelled {
  odorant: Odorant;
  level: number;
}

/** What can be smelled in a fluid, from its molecule counts and temperature: every odorant at or over its threshold, strongest first. */
export function smell(n: ArrayLike<number>, T = T_ROOM): Smelled[] {
  const smelled: Smelled[] = [];
  strengths(n, T).forEach((x, i) => {
    if (x >= 1) smelled.push({ odorant: ODORANTS[i], level: levelOf(x) });
  });
  return smelled.sort((a, b) => b.level - a.level);
}

/** "a", "a and b", "a, b and c"; with a comma before the "and" if something before it has an "and" of its own. */
function list(xs: readonly string[]): string {
  if (xs.length < 2) return xs.join('');
  const head = xs.slice(0, -1).join(', ');
  return `${head}${head.includes(' and ') ? ',' : ''} and ${xs[xs.length - 1]}`;
}

/**
 * What Nadia makes of a sniff, in a line: what was smelled, strongest first (see smell), each by its simile and a word for its
 * strength (see WORDS), as "Smells strongly of floor wax, with a whiff of struck match." Odorants as strong as each
 * other share the word, as "A whiff of wet coats and floor wax." It's terse: no pronouns, no numbers, and nothing of
 * what the fluid is or looks like. Nothing smelled is "Nothing."
 */
export function sentence(smelled: readonly Smelled[]): string {
  if (!smelled.length) return 'Nothing.';
  const groups: { word: number; similes: string[] }[] = [];
  for (const { odorant, level } of smelled) {
    const word = wordFor(level);
    const last = groups[groups.length - 1];
    if (last?.word === word) last.similes.push(odorant.simile);
    else groups.push({ word, similes: [odorant.simile] });
  }
  const said = (verbs: boolean) => groups.filter((g) => g.word >= VERBS === verbs).map((g) => `${WORDS[g.word]} ${list(g.similes)}`);
  const strong = said(true);
  const faint = said(false);
  const line = strong.length && faint.length ? `${list(strong)}, with ${list(faint)}` : list(strong.length ? strong : faint);
  return line[0].toUpperCase() + line.slice(1) + '.';
}
