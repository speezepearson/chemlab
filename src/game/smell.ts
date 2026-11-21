import { T_ROOM } from '../chem/params';
import { NS, SPECIES } from '../chem/species';

/**
 * A way Nadia has of saying what something smells like: as a `thing`, to go after "of" or "like" or to stand alone
 * ("a struck match"), and as the `sort` of smell it is, to go before "smell" ("struck match").
 */
export interface Simile {
  thing: string;
  sort: string;
}

/**
 * Something that smells: a species, by its name (see species.ts), what it smells like to Nadia, in each of the ways
 * she has of saying it, and how potent it is: the share of a fluid's molecules it has to be, at room temperature, for
 * her to smell it at all. `sweet` marks the one kinship written into the table (see ODORANTS).
 */
export interface Odorant {
  species: string;
  similes: readonly Simile[];
  threshold: number;
  sweet: boolean;
}

/** An odorant, each of its similes given as its thing, or as its thing and its sort where they differ. */
const odorant = (species: string, threshold: number, sweet: boolean, ...similes: (string | readonly [thing: string, sort: string])[]): Odorant => ({
  species,
  similes: similes.map((s) => (typeof s === 'string' ? { thing: s, sort: s } : { thing: s[0], sort: s[1] })),
  threshold,
  sweet,
});

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
 * Each odorant smells of one thing, which she has a few ways of saying, one picked at each sniff (see script), so that
 * it reads as a nose and not a gauge. They're all plainly the one thing, and none could be taken for another
 * odorant's: the three sweet ones stay a banana, a cough syrup and a bubblegum.
 *
 * The thresholds span three orders of magnitude. Free black is the most potent, since a trace of it is what spoils the
 * cryostabilizer, and nothing else in the lab shows a trace well. What's waded through in bulk (the faucets' R, G and
 * B, R–G, and the R–K the antinucleant is made from) is weak, so it doesn't drown the rest. The antinucleant, R–B, is
 * the most potent after free black, and well within MASK of it: where a few percent of each turn up together, as when
 * R–K and blue are mixed, both are named, whatever else is beside them.
 */
export const ODORANTS: readonly Odorant[] = [
  odorant('R', 0.02, false, ['wet coats', 'wet coat'], ['damp coats', 'damp coat'], ['rained-on coats', 'rained-on coat']),
  odorant('G', 0.06, false, 'floor wax', ['waxed floors', 'waxed floor'], ['a freshly waxed hallway', 'waxed hallway']),
  odorant('B', 0.025, false, ['a struck match', 'struck match'], ['matches', 'match'], ['a just-lit match', 'just-lit match']),
  odorant('K', 1e-4, false, 'swimming pool', ['the pool at school', 'school pool'], 'pool water'),
  odorant('R–G', 0.1, false, 'pencil shavings', ['a pencil sharpener', 'pencil sharpener'], ['sharpened pencils', 'sharpened pencil']),
  odorant('R–B', 3e-4, true, 'overripe banana', 'banana', ['a banana left in a lunchbox', 'lunchbox banana']),
  odorant('G–B', 3e-3, true, 'cough syrup', 'cough medicine', ['a spoonful of cough syrup', 'cough syrup']),
  odorant('R–K', 0.02, false, 'chalk dust', 'chalk', ['chalkboard erasers', 'chalkboard eraser']),
  odorant('G–K', 1.5e-3, false, ['new sneakers', 'new sneaker'], ['brand-new sneakers', 'brand-new sneaker'], ['a new pair of sneakers', 'new sneaker']),
  odorant('B–K', 5e-4, true, 'bubblegum', 'chewed bubblegum', ['bubblegum from under a desk', 'bubblegum']),
];

/** Each odorant's species, as an index into SPECIES. */
const INDEX: readonly number[] = ODORANTS.map((o) => {
  const s = SPECIES.find((sp) => sp.name === o.species);
  if (!s) throw new Error(`no species ${o.species}`);
  return s.i;
});

/**
 * How strong a smell is, as one of BANDS bands: by how many times over its own threshold the odorant is, on a log
 * scale, a band for each factor of STEP, from the first at the threshold itself up to the last. STEP is a little under
 * ten, so that something reeks from a thousand times its threshold.
 */
export const STEP = 10 ** 0.75;
export const BANDS = 5;

/**
 * How much more a warm fluid gives off than one at room temperature, and how much less a cold one: exp(VOLATILITY ×
 * (1 − T_ROOM / T)), as a vapor's pressure goes. That's 1 at room temperature, falls smoothly to nothing as T goes to
 * 0 (a fifth at half the room's), and levels off when hot (twice at double the room's, never more than e^VOLATILITY,
 * four and a half times: a little under one step of STEP). It's the same for every odorant, so warming a fluid makes
 * all its smells stronger together, and never changes which masks which.
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

/** The band of a level (see BANDS), from 0, the faintest: the last of them for anything past it. */
export function bandOf(level: number): number {
  return Math.max(0, Math.min(BANDS - 1, Math.floor(level)));
}

/** An odorant smelled, and how strongly, as a level (see levelOf). */
export interface Smelled {
  odorant: Odorant;
  level: number;
}

/**
 * A strong smell wipes out much fainter ones: of what's smelled, only what's within MASK steps of the strongest is
 * made out, and never more than NAMED of them. Thinning a fluid weakens all its smells alike, so it never brings out
 * what's masked: a trace of one thing under a reek of another has to be found by taking the fluid apart.
 */
export const MASK = 2;
export const NAMED = 3;

/** What's made out of everything smelled (see MASK), strongest first. */
export function mask(smelled: readonly Smelled[]): Smelled[] {
  const sorted = [...smelled].sort((a, b) => b.level - a.level);
  return sorted.filter((s) => s.level > sorted[0].level - MASK).slice(0, NAMED);
}

/**
 * What Nadia makes out of a fluid, by its molecule counts and temperature: every odorant at or over its threshold,
 * masked (see mask), strongest first. It goes by the fluid alone: the same fluid always smells the same.
 */
export function smell(n: ArrayLike<number>, T = T_ROOM): Smelled[] {
  const smelled: Smelled[] = [];
  strengths(n, T).forEach((s, i) => {
    const level = levelOf(s);
    if (level >= 0) smelled.push({ odorant: ODORANTS[i], level });
  });
  return mask(smelled);
}

/**
 * The ways each band is said, faintest band first: of the first thing named (LEADS), which is the strongest, and of
 * those after it (FOLLOWS). One is picked at each sniff (see script). In a phrasing, `{X}` is the smell's simile as a
 * thing and `{x}` as a sort of smell (see Simile), `{with}` is "with" for the second thing named and "and" for the
 * third, and `|` is where she hesitates (see PACE).
 *
 * However it's put, a phrasing tells its band from every other's, so that any two from different bands can be put in
 * order, by its own words for how strong:
 * - the faintest doubts there's anything there: a trace, the faintest hint, maybe, barely, almost nothing;
 * - the next is slight but there: a whiff, a little, slight, notes of;
 * - the middle one just says it, with no word for how strong;
 * - the next is always strong, or strongly;
 * - the strongest reeks, stinks, or is concentrated or overpowering.
 * And the fainter a smell, the less sure she is what it is: the two faintest bands trail off, hesitate before the
 * name, and end in a question; the rest are said flatly, all at once.
 */
export const LEADS: readonly (readonly string[])[] = [
  ['A trace of…|{X}?', 'The faintest hint of…|{X}?', 'Maybe…|{X}?', 'Barely anything…|maybe…|{X}?', 'Almost nothing…|{X}?'],
  ['A whiff of…|{X}?', 'A slight smell of…|{X}?', 'A little…|{X}?', 'Smells a little like…|{X}?'],
  ['Smells of {X}.', 'Smells like {X}.', '{X}.', 'A smell of {X}.'],
  ['Smells strongly of {X}.', 'A strong smell of {X}.', 'Strong {x} smell.'],
  ['Reeks of {X}.', 'Stinks of {X}.', 'Concentrated {x} smell.', 'An overpowering smell of {X}.'],
];
export const FOLLOWS: readonly (readonly string[])[] = [
  ['…{with} a trace of…|{X}?', '…{with} the faintest hint of…|{X}?', '…and…|maybe…|{X}?', '…and barely…|{X}?'],
  ['…{with} notes of…|{X}?', '…{with} a whiff of…|{X}?', '…{with} a little…|{X}?', '…{with} a slight smell of…|{X}?'],
  ['…{with} {X}.', '…and {X} too.', '…{with} a smell of {X}.'],
  ['…{with} a strong smell of {X}.', '…{with} a strong {x} smell.', '…and {X}, strong.'],
  ['…{with} a reek of {X}.', '…{with} a stink of {X}.', '…{with} an overpowering smell of {X}.'],
];
/** The ways she says that something has no smell at all. */
export const NOTHINGS: readonly string[] = ['Nothing.', 'No smell.', 'Nothing at all.', 'Doesn’t smell of anything.'];

/**
 * How what she says of a sniff is paced, in real seconds (it's on the display, not in the lab). By a smell's band,
 * faintest first, since the fainter it is, the longer she takes over it:
 * - `notice`: how long before she starts on it, from her nose reaching the rim, or from the end of the smell before;
 * - `name`: how long she hesitates before its name, where its phrasing has her hesitate (see LEADS).
 * And `think` is any other hesitation, and `nothing` how long before she's sure there's nothing to smell.
 */
export const PACE = { notice: [1.6, 1.3, 1, 0.8, 0.6], name: [2.2, 1.2, 0.6, 0.3, 0], think: 0.9, nothing: 1.4 };

/**
 * A piece of what she says of a sniff, which comes up all at once: its text, how many real seconds after the piece
 * before it (or, the first, after her nose reaches the rim) it comes up, and whether it starts a new line under what's
 * been said so far, rather than going on along the last one.
 */
export interface Fragment {
  text: string;
  wait: number;
  line: boolean;
}

/** One of xs, by a random number from 0 up to 1. */
const pick = <T>(xs: readonly T[], rand: () => number): T => xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];

/** A phrasing (see LEADS) of the nth thing named, n from 0, at a band, by a simile: the pieces it's said in. */
function phrase(phrasing: string, band: number, simile: Simile, n: number): Fragment[] {
  return phrasing.split('|').map((part, i) => {
    const text = part.replace('{with}', n > 1 ? 'and' : 'with').replace('{X}', simile.thing).replace('{x}', simile.sort);
    const wait = i === 0 ? PACE.notice[band] : /\{[Xx]\}/.test(part) ? PACE.name[band] : PACE.think;
    return { text: n || i ? text : text[0].toUpperCase() + text.slice(1), wait, line: i === 0 };
  });
}

/**
 * What Nadia says of a sniff, piece by piece (see Fragment): what was made out, strongest first, each on a line of
 * its own, in one of the phrasings for its band (see LEADS, FOLLOWS) and by one of its odorant's similes, each picked
 * by `rand` (the phrasing first, then the simile, for each thing in turn). As "Concentrated swimming pool smell." and
 * then, under it, "…with notes of…" and, after a pause, "banana?" The pacing says how strong each is as much as the
 * words do (see PACE). It's terse: no pronouns, no numbers, and nothing of what the fluid is or looks like. Nothing
 * smelled is one of NOTHINGS.
 */
export function script(smelled: readonly Smelled[], rand: () => number = Math.random): Fragment[] {
  if (!smelled.length) return [{ text: pick(NOTHINGS, rand), wait: PACE.nothing, line: true }];
  return smelled.flatMap(({ odorant, level }, n) => {
    const band = bandOf(level);
    const phrasing = pick((n ? FOLLOWS : LEADS)[band], rand);
    return phrase(phrasing, band, pick(odorant.similes, rand), n);
  });
}

/** A script's lines, each as it reads once all of it has come up. */
export function lines(script: readonly Fragment[]): string[] {
  const out: string[] = [];
  for (const f of script) {
    if (f.line || !out.length) out.push(f.text);
    else out[out.length - 1] += ` ${f.text}`;
  }
  return out;
}

/** How many real seconds a script takes, from her nose reaching the rim to its last piece coming up. */
export function span(script: readonly Fragment[]): number {
  return script.reduce((t, f) => t + f.wait, 0);
}
