import { describe, expect, it } from 'vitest';
import { NS, SOLVENT_SPECIES, SPECIES } from '../chem/species';
import {
  BANDS, FOLLOWS, LEADS, MASK, NAMED, NOTHINGS, ODORANTS, PACE, STEP, VOLATILITY, bandOf, levelOf, lines, mask, script, smell, span, strengths, waft,
  type Fragment, type Odorant, type Simile, type Smelled,
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
/** What was smelled, as each one's species and band. */
const bands = (smelled: readonly Smelled[]) => smelled.map((s) => [s.odorant.species, bandOf(s.level)]);

describe('ODORANTS', () => {
  it('are the four colors’ free atoms and the six pairs, and nothing else', () => {
    const small = SPECIES.filter((s) => s.size <= 2 && s.i !== SOLVENT_SPECIES).map((s) => s.name);
    expect(small).toHaveLength(10);
    expect(ODORANTS).toHaveLength(10);
    expect(ODORANTS.map((o) => o.species).sort()).toEqual(small.sort());
  });

  /** Every way an odorant is said: its similes, as things and as sorts of smell. */
  const ways = (o: Odorant) => [...new Set(o.similes.flatMap((sim) => [sim.thing, sim.sort]))];
  /** The one thing each smells of, as a word every way of saying it has in it. */
  const THING: Record<string, RegExp> = {
    R: /coat/, G: /wax/, B: /match/, K: /pool/, 'R–G': /pencil/, 'R–B': /banana/, 'G–B': /cough/, 'R–K': /chalk/, 'G–K': /sneaker/, 'B–K': /bubblegum/,
  };

  it('each have a few similes, all of the one thing, and none of another’s', () => {
    expect(Object.keys(THING).sort()).toEqual(ODORANTS.map((o) => o.species).sort());
    for (const o of ODORANTS) {
      expect(o.similes.length).toBeGreaterThanOrEqual(3);
      expect(new Set(o.similes.map((sim) => sim.thing)).size).toBe(o.similes.length);
      for (const w of ways(o))
        for (const other of ODORANTS) expect(THING[other.species].test(w), `${w} / ${other.species}`).toBe(other === o);
    }
    // nor is any way of saying one inside a way of saying another
    for (const a of ODORANTS)
      for (const b of ODORANTS)
        if (a !== b) for (const x of ways(a)) for (const y of ways(b)) expect(y.includes(x), `${x} in ${y}`).toBe(false);
  });

  it('share no word between a pair’s similes and either of its atoms’', () => {
    const SMALL = ['a', 'the', 'of', 'at', 'in', 'on', 'from', 'under'];
    const words = (o: Odorant) => new Set(ways(o).flatMap((w) => w.split(/[ -]/)).filter((w) => !SMALL.includes(w)));
    for (const pair of ODORANTS.filter((o) => o.species.includes('–')))
      for (const atom of pair.species.split('–'))
        for (const w of words(named(atom))) expect([...words(pair)], `${pair.species} / ${atom}`).not.toContain(w);
  });

  it('name no color, atom, species or real chemical', () => {
    for (const o of ODORANTS)
      for (const w of ways(o)) {
        expect(w).not.toMatch(/\bred\b|green|blue|black|white|yellow|orange|purple|pink|brown|gr[ae]y/i);
        expect(w).not.toMatch(/chlor|sul[fp]|solvent|acid|ammonia|alcohol|ether|aceton|bleach|chemical|rubber|burn|smok|\bgas/i);
        expect(w).toMatch(/^[a-z]+([ -][a-z]+)*$/);
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
  it('finds an odorant from its own threshold up, a band stronger for each step over it', () => {
    // a potent one and a weak one
    for (const o of [named('K'), named('R–G')]) {
      expect(smell(fluid({ [o.species]: shareAt(o, -0.2) }))).toEqual([]);
      for (let b = 0; b < BANDS && shareAt(o, b + 0.5) <= 1; b++) {
        const [found, ...others] = smell(fluid({ [o.species]: shareAt(o, b + 0.5) }));
        expect(others).toEqual([]);
        expect(found.odorant).toBe(o);
        expect(found.level).toBeCloseTo(b + 0.5, 3);
        expect(bandOf(found.level)).toBe(b);
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

  it('has five bands, the last for anything stronger still', () => {
    expect(BANDS).toBe(5);
    expect([-0.01, 0, 0.99, 1, 1.99, 2, 2.99, 3, 3.99, 4, 4.99, 5, 7.5].map(bandOf)).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4]);
    const k = named('K');
    expect(shareAt(k, BANDS + 0.3)).toBeLessThan(1);
    expect(bands(smell(fluid({ K: shareAt(k, BANDS + 0.3) })))).toEqual([['K', BANDS - 1]]);
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
    expect(bands(smell(n))).toEqual([['K', 1], ['R–G', 0]]);
    // hot, each is a band stronger; cold, the fainter is gone and the stronger is in the faintest band
    expect(bands(smell(n, 3))).toEqual([['K', 2], ['R–G', 1]]);
    expect(bands(smell(n, 0.5))).toEqual([['K', 0]]);
    // and cold enough, nothing
    expect(smell(n, 0.25)).toEqual([]);
  });
});

describe('mask', () => {
  it('hides a trace under a reek', () => {
    const n = mix({ 'B–K': 4.3, 'R–K': 0.5 });
    expect(bands(smell(n))).toEqual([['B–K', 4]]);
    // though it's there to be found, without the reek
    expect(level('R–K', n)).toBeCloseTo(0.5, 3);
    expect(bands(smell(mix({ 'R–K': 0.5 })))).toEqual([['R–K', 0]]);
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
    expect(bands(found)).toEqual([['K', 3], ['R–B', 2], ['R–K', 1]]);
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

describe('a second sniff', () => {
  it('of the same fluid smells the same, whatever was sniffed in between', () => {
    const n = mix({ K: 2.5, 'G–K': 1.5 });
    const first = smell(n);
    expect(species(first)).toEqual(['K', 'G–K']);
    for (let i = 0; i < 3; i++) expect(smell(n)).toEqual(first);
    smell(mix({ 'B–K': 4.4 }));
    smell(fluid({}));
    expect(smell(n)).toEqual(first);
  });
});

describe('script', () => {
  const at = (species: string, level: number): Smelled => ({ odorant: named(species), level });
  /** A script as its pieces: each one's text, with `/` before it if it starts a line, and how long it waits. */
  const pieces = (says: readonly Fragment[]) => says.map((f) => [`${f.line ? '/' : ''}${f.text}`, f.wait]);
  /** A random source that gives these in turn, and nothing more. */
  const dealt = (rs: readonly number[]) => {
    let k = 0;
    return () => {
      expect(k).toBeLessThan(rs.length);
      return rs[k++];
    };
  };
  /** The random number that picks the ith of n. */
  const ith = (i: number, n: number) => (i + 0.5) / n;
  /** What she says of these, each [species, level, phrasing, simile's thing], whatever their places in the tables. */
  const said = (...things: [string, number, string, string][]) => {
    const rs = things.flatMap(([species, level, phrasing, thing], n) => {
      const pool = (n ? FOLLOWS : LEADS)[bandOf(level)];
      const { similes } = named(species);
      const [i, j] = [pool.indexOf(phrasing), similes.findIndex((sim) => sim.thing === thing)];
      expect(i, phrasing).toBeGreaterThanOrEqual(0);
      expect(j, thing).toBeGreaterThanOrEqual(0);
      return [ith(i, pool.length), ith(j, similes.length)];
    });
    return script(things.map(([species, level]) => at(species, level)), dealt(rs));
  };
  /** Every way the nth thing named can be said: each phrasing of its band with each of its similes. */
  function* everyWay(n: number): Generator<{ band: number; phrasing: string; o: Odorant; sim: Simile; says: Fragment[] }> {
    for (let band = 0; band < BANDS; band++) {
      const pool = (n ? FOLLOWS : LEADS)[band];
      for (const o of ODORANTS)
        for (const [i, phrasing] of pool.entries())
          for (const [j, sim] of o.similes.entries()) {
            // before it, things that reek, each in its first phrasing and simile
            const rs = [...Array(2 * n).fill(0), ith(i, pool.length), ith(j, o.similes.length)];
            const says = script([...Array(n).fill(at('K', 4.5)), { odorant: o, level: band + 0.5 }], dealt(rs));
            yield { band, phrasing, o, sim, says: says.slice(says.length - phrasing.split('|').length) };
          }
    }
  }
  /** mulberry32: a seeded random source. */
  const seeded = (seed: number) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it('has several phrasings for each band, of the first thing named and of those after it', () => {
    for (const table of [LEADS, FOLLOWS]) {
      expect(table).toHaveLength(BANDS);
      for (const pool of table) {
        expect(pool.length).toBeGreaterThanOrEqual(3);
        expect(new Set(pool).size).toBe(pool.length);
        // each names the smell once, as a thing or as a sort of smell
        for (const phrasing of pool) expect(phrasing.match(/\{[Xx]\}/g)).toHaveLength(1);
      }
    }
    for (const phrasing of FOLLOWS.flat()) expect(phrasing).toMatch(/^…(\{with\}|and)[ …]/);
    for (const phrasing of LEADS.flat()) expect(phrasing).toMatch(/^([A-Z]|\{X\})/);
    expect(NOTHINGS.length).toBeGreaterThanOrEqual(3);
  });

  it('tells each band from the others by its own words for how strong, however it’s put', () => {
    // faintest first; the middle band has none of the others' words
    const MARK = [/trace|faintest|maybe|barely|almost nothing/i, /whiff|little|slight|notes/i, null, /strong/i, /reek|stink|concentrated|overpowering/i];
    for (const table of [LEADS, FOLLOWS])
      table.forEach((pool, band) => {
        for (const phrasing of pool) MARK.forEach((mark, b) => mark && expect(mark.test(phrasing), `${phrasing} / band ${b}`).toBe(b === band));
      });
    // and the two faintest trail off, hesitate before the name and end on a question; the rest are flat
    for (const table of [LEADS, FOLLOWS])
      table.forEach((pool, band) => {
        for (const phrasing of pool) {
          if (band < 2) expect(phrasing).toMatch(/…\|\{[Xx]\}\?$/);
          else expect(phrasing).toMatch(/^[^|?]*\.$/);
        }
      });
  });

  it('can say every phrasing of every band with every simile, well-formed, and tell from any line its band and its odorant', () => {
    const from = new Map<string, string>();
    for (const n of [0, 1, 2])
      for (const { band, phrasing, o, sim, says } of everyWay(n)) {
        const [line, ...more] = lines(says);
        expect(more).toEqual([]);
        expect(line).toMatch(n ? (n > 1 ? /^…and[ …]/ : /^…(with|and)[ …]/) : /^[A-Z]/);
        expect(line).toMatch(/^…?[A-Za-z][a-z ,…-]*[a-z][.?]$/);
        expect(line).not.toMatch(/ {2}|[{}|]| [,.?…]/);
        expect(line.endsWith('?')).toBe(band < 2);
        expect(line.toLowerCase()).toContain(phrasing.includes('{x}') ? sim.sort : sim.thing);
        // no pronouns, nothing of what the fluid is, and no real chemistry
        expect(line).not.toMatch(/\b(it|its|this|that|she|her|you|your|i|my)\b/i);
        expect(line).not.toMatch(/chlor|sul[fp]|solvent|acid|ammonia|alcohol|ether|aceton|bleach|chemical|rubber|burn|smok|\bgas/i);
        // its pieces: the first starts the line once she's noticed it, the rest follow along it, the name last
        const parts = phrasing.split('|');
        expect(says.map((f) => f.line)).toEqual(parts.map((_, i) => i === 0));
        expect(says.map((f) => f.wait)).toEqual(parts.map((_, i) => (i === 0 ? PACE.notice[band] : i === parts.length - 1 ? PACE.name[band] : PACE.think)));
        // the same line never comes of another band, or of another odorant
        const key = `${band} ${o.species}`;
        expect(from.get(line) ?? key, line).toBe(key);
        from.set(line, key);
      }
    const ways = (table: readonly (readonly string[])[]) => table.reduce((sum, pool) => sum + pool.length, 0) * ODORANTS.reduce((sum, o) => sum + o.similes.length, 0);
    expect(from.size).toBeGreaterThan((ways(LEADS) + ways(FOLLOWS)) / 2);
  });

  it('says a faint smell after a hesitation, as a question', () => {
    const says = said(['R–K', 1.5, 'A whiff of…|{X}?', 'chalk dust']);
    expect(pieces(says)).toEqual([['/A whiff of…', PACE.notice[1]], ['chalk dust?', PACE.name[1]]]);
    expect(lines(says)).toEqual(['A whiff of… chalk dust?']);
  });

  it('says a reek flatly and at once, and what’s under it on lines of its own, the fainter the more haltingly', () => {
    const says = said(
      ['K', 4.5, 'Concentrated {x} smell.', 'swimming pool'],
      ['R–B', 1.5, '…{with} notes of…|{X}?', 'banana'],
      ['B', 0.5, '…and…|maybe…|{X}?', 'matches'],
    );
    expect(pieces(says)).toEqual([
      ['/Concentrated swimming pool smell.', PACE.notice[4]],
      ['/…with notes of…', PACE.notice[1]], ['banana?', PACE.name[1]],
      ['/…and…', PACE.notice[0]], ['maybe…', PACE.think], ['matches?', PACE.name[0]],
    ]);
    expect(lines(says)).toEqual(['Concentrated swimming pool smell.', '…with notes of… banana?', '…and… maybe… matches?']);
    expect(span(says)).toBeCloseTo(PACE.notice[4] + PACE.notice[1] + PACE.name[1] + PACE.notice[0] + PACE.think + PACE.name[0], 9);
  });

  it('says a simile as a thing, or as a sort of smell, as the phrasing wants', () => {
    expect(lines(said(['B', 4.5, 'Reeks of {X}.', 'a struck match']))).toEqual(['Reeks of a struck match.']);
    expect(lines(said(['B', 4.5, 'Concentrated {x} smell.', 'a struck match']))).toEqual(['Concentrated struck match smell.']);
    expect(lines(said(['B', 2.5, '{X}.', 'a struck match']))).toEqual(['A struck match.']);
    expect(lines(said(['K', 3.5, 'Strong {x} smell.', 'the pool at school'], ['B', 3.2, '…{with} a strong {x} smell.', 'matches']))).toEqual([
      'Strong school pool smell.', '…with a strong match smell.',
    ]);
  });

  it('joins the second thing on with "with", where its phrasing says, and the third with "and"', () => {
    const three = said(
      ['R', 2.8, 'Smells of {X}.', 'wet coats'], ['G', 2.5, '…{with} {X}.', 'floor wax'], ['K', 2.2, '…{with} a smell of {X}.', 'pool water'],
    );
    expect(lines(three)).toEqual(['Smells of wet coats.', '…with floor wax.', '…and a smell of pool water.']);
    expect(lines(said(['R', 2.8, '{X}.', 'damp coats'], ['G', 2.5, '…and {X} too.', 'waxed floors']))).toEqual(['Damp coats.', '…and waxed floors too.']);
  });

  it('picks the phrasing and then the simile of each thing in turn, by the random source it’s given', () => {
    const smelled = [at('K', 3.4), at('R–B', 2.6), at('R–K', 1.1)];
    const told = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const says = script(smelled, seeded(seed));
      // the same again from the same seed
      expect(script(smelled, seeded(seed))).toEqual(says);
      // and just what the same numbers pick out of the tables
      const rand = seeded(seed);
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
      const want = smelled.flatMap(({ odorant, level }, n) => {
        const band = bandOf(level);
        const parts = pick((n ? FOLLOWS : LEADS)[band]).split('|');
        const sim = pick(odorant.similes);
        return parts.map((part, i) => {
          const text = part.replace('{with}', n > 1 ? 'and' : 'with').replace('{X}', sim.thing).replace('{x}', sim.sort);
          return {
            text: n || i ? text : text[0].toUpperCase() + text.slice(1),
            wait: i === 0 ? PACE.notice[band] : i === parts.length - 1 ? PACE.name[band] : PACE.think,
            line: i === 0,
          };
        });
      });
      expect(says).toEqual(want);
      expect(lines(says)).toHaveLength(3);
      told.add(lines(says).join(' '));
    }
    // it's rarely put the same way twice
    expect(told.size).toBeGreaterThan(30);
    // and left to itself, it says something the tables could
    const all = new Set([0, 1, 2].flatMap((n) => [...everyWay(n)].map(({ says }) => lines(says)[0])));
    for (const line of lines(script(smelled))) expect(all.has(line), line).toBe(true);
  });

  it('takes longer the fainter the smell, and never long', () => {
    for (const table of [PACE.notice, PACE.name]) {
      expect(table).toHaveLength(BANDS);
      for (let i = 1; i < BANDS; i++) expect(table[i]).toBeLessThan(table[i - 1]);
    }
    // however each is put, a fainter band's first thing is longer in coming than a stronger one's
    const spans = Array.from({ length: BANDS }, () => ({ least: Infinity, most: 0 }));
    for (const { band, says } of everyWay(0)) {
      spans[band].least = Math.min(spans[band].least, span(says));
      spans[band].most = Math.max(spans[band].most, span(says));
    }
    for (let band = 1; band < BANDS; band++) expect(spans[band].most).toBeLessThan(spans[band - 1].least);
    // one thing that reeks is said in under a second
    expect(spans[BANDS - 1].most).toBeLessThan(1);
    // three, the last of them faint, take a few seconds, however they're put
    const longest = (table: readonly (readonly string[])[], band: number) =>
      Math.max(...table[band].map((ph) => PACE.notice[band] + (ph.split('|').length > 1 ? PACE.name[band] : 0) + PACE.think * Math.max(0, ph.split('|').length - 2)));
    expect(longest(LEADS, 2) + longest(FOLLOWS, 1) + longest(FOLLOWS, 0)).toBeLessThan(11);
    // and at the very longest, three as faint as can be
    expect(longest(LEADS, 0) + 2 * longest(FOLLOWS, 0)).toBeLessThan(15);
  });

  it('says so when there’s nothing, one way or another, after a short sniff', () => {
    NOTHINGS.forEach((nothing, i) => {
      expect(script([], dealt([ith(i, NOTHINGS.length)]))).toEqual([{ text: nothing, wait: PACE.nothing, line: true }]);
      expect(nothing).toMatch(/^[A-Z][a-z’ ]+\.$/);
      expect(nothing).toMatch(/no|n’t/i);
    });
    expect(NOTHINGS).toContain(lines(script(smell(fluid({}))))[0]);
    expect(PACE.nothing).toBeLessThan(2);
  });
});
