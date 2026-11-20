import { describe, expect, it } from 'vitest';
import { NS, SOLVENT_SPECIES, SPECIES } from '../chem/species';
import { ODORANTS, STEP, WORDS, levelOf, sentence, smell, strengths, type Odorant } from './smell';

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

/** The share of a fluid an odorant is at `steps` steps over its threshold. */
const shareAt = (o: Odorant, steps: number) => o.threshold * STEP ** steps;
/** A fluid of these odorants (by species' name), each at this many steps over its threshold, in solvent. */
const mix = (steps: Record<string, number>) =>
  fluid(Object.fromEntries(Object.entries(steps).map(([species, at]) => [species, shareAt(named(species), at)])));
/** How strong an odorant is in a fluid, as a level. */
const level = (species: string, n: Float64Array) => levelOf(strengths(n)[ODORANTS.indexOf(named(species))]);
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
