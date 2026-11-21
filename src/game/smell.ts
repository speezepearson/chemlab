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
 * the most potent after free black, and well within MASK of it: where a few percent of each turn up together, as when
 * R–K and blue are mixed, both are named, whatever else is beside them.
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
 * How each band is said, faintest first: of the first thing named (LEAD), which is the strongest, and of those after
 * it (FOLLOW). In a phrasing, `{X}` is the smell's simile, `{with}` is "with" for the second thing named and "and"
 * for the third, and `|` is where she hesitates (see PACE). The fainter a smell, the less sure she is of it: the two
 * faintest bands trail off, hesitate before the name, and end in a question; the rest are said flatly, all at once.
 */
export const LEAD: readonly string[] = ['A trace of…|{X}?', 'A whiff of…|{X}?', 'Smells of {X}.', 'Smells strongly of {X}.', 'Reeks of {X}.'];
export const FOLLOW: readonly string[] = [
  '…{with} a trace of…|{X}?', '…{with} a whiff of…|{X}?', '…{with} {X}.', '…{with} a strong smell of {X}.', '…{with} a reek of {X}.',
];
/** What she says of what has no smell at all. */
export const NOTHING = 'Nothing.';

/**
 * How what she says of a sniff is paced, in real seconds (it's on the display, not in the lab). By a smell's band,
 * faintest first, since the fainter it is, the longer she takes over it:
 * - `notice`: how long before she starts on it, from her nose reaching the rim, or from the end of the smell before;
 * - `name`: how long she hesitates before its name, where its phrasing has her hesitate (see LEAD).
 * And `think` is any other hesitation, and `nothing` how long before she's sure there's nothing to smell.
 */
export const PACE = { notice: [0.8, 0.65, 0.5, 0.4, 0.3], name: [1.1, 0.6, 0.3, 0.15, 0], think: 0.45, nothing: 0.7 };

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

/** A phrasing (see LEAD) of the nth thing named, n from 0, at a band, by its simile: the pieces it's said in. */
function phrase(phrasing: string, band: number, simile: string, n: number): Fragment[] {
  return phrasing.split('|').map((part, i) => {
    const text = part.replace('{with}', n > 1 ? 'and' : 'with').replace('{X}', simile);
    const wait = i === 0 ? PACE.notice[band] : part.includes('{X}') ? PACE.name[band] : PACE.think;
    return { text: n || i ? text : text[0].toUpperCase() + text.slice(1), wait, line: i === 0 };
  });
}

/**
 * What Nadia says of a sniff, piece by piece (see Fragment): what was made out, strongest first, each on a line of
 * its own, by its simile and a phrasing for its band (see LEAD, FOLLOW), as "Smells strongly of floor wax." and then,
 * under it, "…with a whiff of…" and, after a pause, "struck match?" The pacing says how strong each is as much as the
 * words do (see PACE). It's terse: no pronouns, no numbers, and nothing of what the fluid is or looks like. Nothing
 * smelled is NOTHING.
 */
export function script(smelled: readonly Smelled[]): Fragment[] {
  if (!smelled.length) return [{ text: NOTHING, wait: PACE.nothing, line: true }];
  return smelled.flatMap(({ odorant, level }, n) => phrase((n ? FOLLOW : LEAD)[bandOf(level)], bandOf(level), odorant.simile, n));
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
