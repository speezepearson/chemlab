import { describe, expect, it } from 'vitest';
import { NS, SOLVENT_SPECIES, SPECIES } from '../chem/species';
import {
  MASK, NAMED, ODORANTS, STEP, VOLATILITY, WORDS, levelOf, mask, sentence, smell, strengths, waft, type Odorant,
} from './smell';

const named = (species: string): Odorant => ODORANTS.find((o) => o.species === species)!;
const index = (species: string) => SPECIES.find((s) => s.name === species)!.i;

/** A fluid's molecule counts, a billion in all: these shares of it of these species (by name), and the rest solvent. */
function fluid(shares: Record<string, number>): Float64Array {
  const n = new Float64Array(NS);
  let rest = 1e9;
  for (const [species, share] of Object.entries(shares)) {
    n[index(species)] = Math.round(share * 1e9);
    rest -= n[index(species)];
  }
  n[SOLVENT_SPECIES] += rest;
  return n;
}

/** The share of a fluid an odorant is at `steps` steps over its threshold, at room temperature. */
const shareAt = (o: Odorant, steps: number) => o.threshold * STEP ** steps;
/** A fluid of these odorants (by species' name), each at this many steps over its threshold, in solvent. */
const mix = (steps: Record<string, number>) =>
  fluid(Object.fromEntries(Object.entries(steps).map(([species, at]) => [species, shareAt(named(species), at)])));
/** How strong an odorant is in a fluid at temperature T, as a level. */
const level = (species: string, n: Float64Array, T?: number) => levelOf(strengths(n, T)[ODORANTS.indexOf(named(species))]);
const species = (smelled: readonly { odorant: Odorant }[]) => smelled.map((s) => s.odorant.species);

describe('ODORANTS', () => {
  it('are the four colors’ free atoms and the six pairs, and nothing else', () => {
    const small = SPECIES.filter((s) => s.size <= 2 && s.i !== SOLVENT_SPECIES).map((s) => s.name);
    expect(small).toHaveLength(10);
    expect(ODORANTS).toHaveLength(10);
    expect(ODORANTS.map((o) => o.species).sort()).toEqual(small.sort());
  });

  it('each have a simile of their own, none inside another’s', () => {
    const similes = ODORANTS.map((o) => o.simile);
    expect(new Set(similes).size).toBe(similes.length);
    for (const a of similes) for (const b of similes) if (a !== b) expect(b.includes(a), `${a} in ${b}`).toBe(false);
  });

  it('share no word between a pair’s simile and either of its atoms’', () => {
    const words = (o: Odorant) => o.simile.split(' ');
    for (const pair of ODORANTS.filter((o) => o.species.includes('–')))
      for (const atom of pair.species.split('–'))
        for (const w of words(named(atom))) expect(words(pair), `${pair.simile} / ${named(atom).simile}`).not.toContain(w);
  });

  it('name no color, atom or species', () => {
    for (const { simile } of ODORANTS) {
      expect(simile).not.toMatch(/\b(red|green|blue|black|white|yellow|orange|purple|pink|brown|gr[ae]y)\b/i);
      expect(simile).toMatch(/^[a-z ]+$/);
    }
  });

  it('mark the three pairs with a blue atom sweet, and nothing else', () => {
    expect(ODORANTS.filter((o) => o.sweet).map((o) => o.species).sort()).toEqual(['B–K', 'G–B', 'R–B']);
  });

  it('span about three orders of magnitude of potency, free black the most potent', () => {
    const ts = ODORANTS.map((o) => o.threshold);
    const decades = Math.log10(Math.max(...ts) / Math.min(...ts));
    expect(decades).toBeGreaterThan(2.5);
    expect(decades).toBeLessThan(3.5);
    expect(named('K').threshold).toBe(Math.min(...ts));
    expect(named('K').threshold).toBeLessThanOrEqual(1e-4);
  });

  it('make what’s waded through in bulk weak', () => {
    const bulk = ['R', 'G', 'B', 'R–G'];
    for (const s of bulk) expect(named(s).threshold).toBeGreaterThanOrEqual(100 * named('K').threshold);
    const weakest = Math.min(...bulk.map((s) => named(s).threshold));
    for (const s of ['K', 'R–B', 'G–B', 'G–K', 'B–K']) expect(named(s).threshold).toBeLessThan(weakest);
  });
});

describe('smell', () => {
  it('finds an odorant from its own threshold up, a word stronger for each step over it', () => {
    // a potent one and a weak one
    for (const o of [named('K'), named('R–G')]) {
      expect(smell(fluid({ [o.species]: shareAt(o, -0.2) }))).toEqual([]);
      for (let w = 0; w < WORDS.length && shareAt(o, w + 0.5) <= 1; w++) {
        const [found, ...others] = smell(fluid({ [o.species]: shareAt(o, w + 0.5) }));
        expect(others).toEqual([]);
        expect(found.odorant).toBe(o);
        expect(found.level).toBeCloseTo(w + 0.5, 3);
        expect(sentence([found]).toLowerCase()).toBe(`${WORDS[w]} ${o.simile}.`);
      }
    }
  });

  it('finds a potent odorant where as much of a weak one goes unnoticed', () => {
    const share = Math.sqrt(named('K').threshold * named('R–G').threshold);
    expect(species(smell(fluid({ K: share })))).toEqual(['K']);
    expect(smell(fluid({ 'R–G': share }))).toEqual([]);
    // free black, at one molecule in ten thousand
    expect(species(smell(fluid({ K: 1.01e-4 })))).toEqual(['K']);
  });

  it('keeps its last word for anything stronger', () => {
    const k = named('K');
    expect(shareAt(k, WORDS.length + 0.3)).toBeLessThan(1);
    expect(sentence(smell(fluid({ K: shareAt(k, WORDS.length + 0.3) })))).toBe(`Reeks of ${k.simile}.`);
  });

  it('finds nothing in the solvent, or in any molecule of three atoms or four, or in nothing at all', () => {
    for (const s of SPECIES) {
      if (ODORANTS.some((o) => o.species === s.name)) continue;
      expect(s.size > 2 || s.i === SOLVENT_SPECIES).toBe(true);
      const n = new Float64Array(NS);
      n[s.i] = 1e9;
      expect(smell(n), s.name).toEqual([]);
      // however hot
      expect(smell(n, 50), s.name).toEqual([]);
    }
    expect(smell(new Float64Array(NS))).toEqual([]);
    expect(sentence([])).toBe('Nothing.');
  });

  it('goes by the share of the fluid’s molecules, so the solvent weakens a smell, and so does anything else', () => {
    const o = named('R');
    const pure = level('R', fluid({ R: 1 }));
    expect(level('R', fluid({ R: 1 / STEP }))).toBeCloseTo(pure - 1, 6);
    expect(level('R', fluid({ R: 1 / STEP, '△RGB': 1 - 1 / STEP }))).toBeCloseTo(pure - 1, 6);
    // however much of it there is
    const few = fluid({ R: 1 / STEP }).map((x) => Math.round(x / 1000));
    expect(levelOf(strengths(few)[ODORANTS.indexOf(o)])).toBeCloseTo(pure - 1, 3);
    // thinned far enough, it's gone
    expect(smell(fluid({ R: o.threshold / 2 }))).toEqual([]);
  });

  it('lists what it finds strongest first', () => {
    expect(species(smell(mix({ R: 1.0, K: 2.5, 'G–B': 1.5 })))).toEqual(['K', 'G–B', 'R']);
  });
});

describe('waft', () => {
  it('is 1 at room temperature, nothing at absolute zero, and more the warmer, leveling off', () => {
    expect(waft(1)).toBe(1);
    expect(waft(0)).toBe(0);
    expect(waft(1e-3)).toBeLessThan(1e-9);
    for (let T = 0.05; T < 40; T *= 1.1) expect(waft(T * 1.1)).toBeGreaterThan(waft(T));
    expect(waft(1e6)).toBeLessThan(Math.exp(VOLATILITY));
    expect(waft(1e6)).toBeCloseTo(Math.exp(VOLATILITY), 3);
    // heat alone never adds as much as a whole step
    expect(Math.exp(VOLATILITY)).toBeLessThan(STEP);
  });

  it('makes a warm fluid smell stronger and a cold one fainter, every odorant alike', () => {
    const n = mix({ K: 1.6, 'R–G': 0.5 });
    for (const T of [0.5, 0.8, 1.5, 3]) {
      const by = levelOf(waft(T));
      expect(by > 0).toBe(T > 1);
      for (const s of ['K', 'R–G']) expect(level(s, n, T)).toBeCloseTo(level(s, n) + by, 9);
    }
    expect(sentence(smell(n))).toBe(`A whiff of ${named('K').simile} and a trace of ${named('R–G').simile}.`);
    // hot, each is a word stronger; cold, the fainter is gone and the stronger is a trace
    expect(sentence(smell(n, 3))).toBe(`Smells of ${named('K').simile}, with a whiff of ${named('R–G').simile}.`);
    expect(sentence(smell(n, 0.5))).toBe(`A trace of ${named('K').simile}.`);
    // and cold enough, nothing
    expect(smell(n, 0.25)).toEqual([]);
  });
});

describe('mask', () => {
  it('hides a trace under a reek', () => {
    const n = mix({ 'B–K': 4.3, 'R–K': 0.5 });
    expect(sentence(smell(n))).toBe(`Reeks of ${named('B–K').simile}.`);
    // though it's there to be found, without the reek
    expect(level('R–K', n)).toBeCloseTo(0.5, 3);
    expect(sentence(smell(mix({ 'R–K': 0.5 })))).toBe(`A trace of ${named('R–K').simile}.`);
  });

  it('isn’t got round by thinning, which weakens everything alike', () => {
    const n = fluid({ 'B–K': 0.5, 'R–K': 0.4 });
    expect(species(smell(n))).toEqual(['B–K']);
    for (const thin of [3, 10, 30, 100, 300]) {
      const thinned = fluid({ 'B–K': 0.5 / thin, 'R–K': 0.4 / thin });
      expect(species(smell(thinned)), `1 in ${thin}`).toEqual(['B–K']);
    }
    // nor by warming or cooling it
    for (const T of [0.6, 2, 5]) expect(species(smell(n, T))).toEqual(['B–K']);
  });

  it('reports a second smell that’s nearly as strong, and one just within its reach, but nothing past it', () => {
    expect(species(smell(mix({ 'B–K': 4.3, K: 4.1 })))).toEqual(['B–K', 'K']);
    expect(species(smell(mix({ 'B–K': 3.3, 'R–K': 3.3 - MASK + 0.1 })))).toEqual(['B–K', 'R–K']);
    expect(species(smell(mix({ 'B–K': 3.3, 'R–K': 3.3 - MASK - 0.1 })))).toEqual(['B–K']);
  });

  it('names three at most, the strongest', () => {
    expect(NAMED).toBe(3);
    const found = smell(mix({ K: 3.0, 'R–B': 2.8, 'G–K': 2.6, 'B–K': 2.4, 'G–B': 2.2 }));
    expect(species(found)).toEqual(['K', 'R–B', 'G–K']);
    const at = (s: string, l: number) => ({ odorant: named(s), level: l });
    expect(species(mask([at('R', 1), at('G', 1.2), at('B', 1.4), at('K', 1.6)]))).toEqual(['K', 'B', 'G']);
    expect(mask([])).toEqual([]);
  });

  it('names the antinucleant where R–K and blue, mixed one to one, have made a few percent of it, and of free black', () => {
    // the antinucleant is the most potent thing but free black
    const potent = [...ODORANTS].sort((a, b) => a.threshold - b.threshold).map((o) => o.species);
    expect(potent.slice(0, 2)).toEqual(['K', 'R–B']);
    const n = fluid({ 'R–K': 0.47, B: 0.47, 'R–B': 0.03, K: 0.03 });
    const found = smell(n);
    expect(species(found).slice(0, 2)).toEqual(['K', 'R–B']);
    // a clear step above a trace, and clearly within free black's reach
    const rb = found[1];
    expect(rb.level).toBeGreaterThan(2);
    expect(found[0].level - rb.level).toBeLessThan(MASK - 0.5);
    expect(sentence(found)).toBe('Smells strongly of swimming pool and smells of overripe banana, with a whiff of chalk dust.');
    // and still named with half as much of it beside the same free black, or a third the free black beside as much
    expect(species(smell(fluid({ 'R–K': 0.47, B: 0.47, 'R–B': 0.015, K: 0.03 })))).toContain('R–B');
    expect(species(smell(fluid({ 'R–K': 0.47, B: 0.47, 'R–B': 0.03, K: 0.09 })))).toContain('R–B');
    // or with a few percent of other things beside them, B–K and free red, as there may be; or cold, with a third as much of each
    const more = fluid({ 'R–K': 0.43, B: 0.44, K: 0.04, R: 0.04, 'R–B': 0.025, 'B–K': 0.022 });
    expect(species(smell(more))).toEqual(['K', 'R–B', 'B–K']);
    const cold = fluid({ 'R–K': 0.478, B: 0.478, K: 0.012, R: 0.01, 'R–B': 0.012, 'B–K': 0.01 });
    expect(species(smell(cold, 0.7)).slice(0, 2)).toEqual(['K', 'R–B']);
    expect(smell(cold, 0.7)[1].level).toBeGreaterThan(1.5);
  });
});

describe('sentence', () => {
  const at = (species: string, level: number) => ({ odorant: named(species), level });
  const [a, b, c] = [named('R').simile, named('G').simile, named('K').simile];

  it('says one odorant by its strength', () => {
    expect(sentence([at('R', 0.2)])).toBe(`A trace of ${a}.`);
    expect(sentence([at('R', 1.9)])).toBe(`A whiff of ${a}.`);
    expect(sentence([at('R', 2)])).toBe(`Smells of ${a}.`);
    expect(sentence([at('R', 3.5)])).toBe(`Smells strongly of ${a}.`);
    expect(sentence([at('R', 4.1)])).toBe(`Reeks of ${a}.`);
  });

  it('says two, the fainter after the stronger', () => {
    expect(sentence([at('R', 4.5), at('G', 2.6)])).toBe(`Reeks of ${a} and smells of ${b}.`);
    expect(sentence([at('R', 3.5), at('G', 1.6)])).toBe(`Smells strongly of ${a}, with a whiff of ${b}.`);
    expect(sentence([at('R', 2.5), at('G', 0.6)])).toBe(`Smells of ${a}, with a trace of ${b}.`);
    expect(sentence([at('R', 1.5), at('G', 0.5)])).toBe(`A whiff of ${a} and a trace of ${b}.`);
    // as strong as each other, they share the word
    expect(sentence([at('R', 2.6), at('G', 2.1)])).toBe(`Smells of ${a} and ${b}.`);
    expect(sentence([at('R', 0.6), at('G', 0.1)])).toBe(`A trace of ${a} and ${b}.`);
  });

  it('says three', () => {
    expect(sentence([at('R', 2.5), at('G', 1.5), at('K', 0.6)])).toBe(`Smells of ${a}, with a whiff of ${b} and a trace of ${c}.`);
    expect(sentence([at('R', 4.5), at('G', 3.5), at('K', 2.6)])).toBe(`Reeks of ${a}, smells strongly of ${b} and smells of ${c}.`);
    expect(sentence([at('R', 3.5), at('G', 2.5), at('K', 1.6)])).toBe(`Smells strongly of ${a} and smells of ${b}, with a whiff of ${c}.`);
    expect(sentence([at('R', 3.2), at('G', 1.8), at('K', 1.3)])).toBe(`Smells strongly of ${a}, with a whiff of ${b} and ${c}.`);
    expect(sentence([at('R', 1.8), at('G', 1.5), at('K', 1.2)])).toBe(`A whiff of ${a}, ${b} and ${c}.`);
    // a comma keeps two "and"s apart
    expect(sentence([at('R', 3.8), at('G', 3.5), at('K', 2.2)])).toBe(`Smells strongly of ${a} and ${b}, and smells of ${c}.`);
    expect(sentence([at('R', 1.8), at('G', 1.5), at('K', 0.2)])).toBe(`A whiff of ${a} and ${b}, and a trace of ${c}.`);
  });

  it('has no numbers, pronouns, colors or species’ names in it', () => {
    for (const o of ODORANTS)
      for (let w = 0; w < WORDS.length; w++) {
        const line = sentence([{ odorant: o, level: w + 0.5 }]);
        expect(line).toMatch(/^[A-Z][a-z ]+\.$/);
        expect(line).not.toMatch(/\b(it|its|this|that|she|her|you|your|i|my)\b/i);
      }
  });
});
