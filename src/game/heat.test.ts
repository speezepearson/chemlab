import { describe, expect, it } from 'vitest';
import { BURN, FAR, HEAT, HEAT_PACE, HOT, QUITE, SNIFF_FAR, SNIFF_OUCH, SNIFF_SAYS, WARM, felt, sniffHeat } from './heat';
import { lines, span } from './smell';

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

describe('felt', () => {
  it('feels nothing at room temperature, and each band from just past its threshold', () => {
    expect(felt(1)).toBe(0);
    expect(felt(0)).toBe(0);
    const steps: [number, number][] = [[HEAT.warm, WARM], [HEAT.quite, QUITE], [HEAT.hot, HOT], [HEAT.burn, BURN], [HEAT.far, FAR]];
    for (const [T, band] of steps) {
      expect(felt(T), `${T}`).toBe(band - 1);
      expect(felt(T * 1.0001), `${T}+`).toBe(band);
      expect(felt(T * 0.9999), `${T}-`).toBe(band - 1);
    }
    expect(felt(1e6)).toBe(FAR);
    expect([WARM, QUITE, HOT, BURN, FAR]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('sniffHeat', () => {
  const pieces = (says: ReturnType<typeof sniffHeat>) => says.map((f) => [`${f.line ? '/' : ''}${f.text}`, f.wait]);

  it('says nothing of what she doesn’t feel', () => {
    expect(sniffHeat(0, dealt([]))).toEqual([]);
  });

  it('says how warm on a line of its own, the hotter the sooner, in one of its band’s ways, by the random source', () => {
    for (const band of [WARM, QUITE, HOT]) {
      SNIFF_SAYS[band].forEach((text, i) => {
        expect(pieces(sniffHeat(band, dealt([ith(i, SNIFF_SAYS[band].length)])))).toEqual([[`/${text}`, HEAT_PACE.feel[band]]]);
      });
      if (band > WARM) expect(HEAT_PACE.feel[band]).toBeLessThan(HEAT_PACE.feel[band - 1]);
    }
    expect(SNIFF_SAYS[WARM]).toEqual(['Kinda warm.']);
    expect(SNIFF_SAYS[QUITE]).toEqual(['Quite warm.', 'Kinda hot.']);
    expect(SNIFF_SAYS[HOT]).toEqual(['Very hot.', 'Really hot.']);
  });

  it('says what burns her as an OW HOT and three ows, on one line, quickly', () => {
    const says = sniffHeat(BURN, dealt([]));
    expect(pieces(says)).toEqual([['/OW HOT', 0], ['ow', HEAT_PACE.ow], ['ow', HEAT_PACE.ow], ['ow', HEAT_PACE.ow]]);
    expect(lines(says)).toEqual([SNIFF_OUCH.join(' ')]);
    expect(span(says)).toBeCloseTo(3 * HEAT_PACE.ow, 9);
  });

  it('says what she won’t go near in two lines, the second a beat after the first', () => {
    for (const band of [FAR, FAR + 1]) {
      const says = sniffHeat(band, dealt([]));
      expect(pieces(says)).toEqual([[`/${SNIFF_FAR[0]}`, 0], [`/${SNIFF_FAR[1]}`, HEAT_PACE.far]]);
      expect(lines(says)).toEqual([...SNIFF_FAR]);
    }
  });

  it('never says one band’s words of another', () => {
    const words = (band: number): string[] => (band === BURN ? [...SNIFF_OUCH] : band === FAR ? [...SNIFF_FAR] : [...SNIFF_SAYS[band]]);
    for (let a = WARM; a <= FAR; a++)
      for (let b = WARM; b <= FAR; b++) if (a !== b) for (const w of words(a)) expect(words(b), `${w}: ${a} / ${b}`).not.toContain(w);
  });
});
