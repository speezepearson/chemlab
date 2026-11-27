import { describe, expect, it } from 'vitest';
import {
  BURN, ENDURANCE, FAR, HEAT, HEAT_PACE, HOLD_FAR, HOLD_OUCH, HOLD_SAYS, HOT, QUITE, SNIFF_FAR, SNIFF_OUCH, SNIFF_SAYS, TOSS, WARM, drain, felt, holdHeat, ouches, sniffHeat, toss,
} from './heat';
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

describe('holdHeat', () => {
  const pieces = (says: ReturnType<typeof holdHeat>) => says.map((f) => [`${f.line ? '/' : ''}${f.text}`, f.wait]);

  it('says nothing of what she doesn’t feel', () => {
    expect(holdHeat(0, dealt([]))).toEqual([]);
  });

  it('says how warm on a line of its own, the hotter the sooner', () => {
    for (const band of [WARM, QUITE, HOT])
      HOLD_SAYS[band].forEach((text, i) => {
        expect(pieces(holdHeat(band, dealt([ith(i, HOLD_SAYS[band].length)])))).toEqual([[`/${text}`, HEAT_PACE.feel[band]]]);
      });
    expect(HOLD_SAYS.slice(1).map((says) => says[0])).toEqual(['Kinda warm.', 'Quite warm.', 'Yikes, hot.']);
  });

  it('says all of what burns her on one line, at once, for the engine to show as much of as it will', () => {
    expect(pieces(holdHeat(BURN, dealt([])))).toEqual(HOLD_OUCH.map((t, i) => [`${i ? '' : '/'}${t}`, 0]));
  });

  it('says what she won’t touch in two lines, the second a beat after the first', () => {
    expect(pieces(holdHeat(FAR, dealt([])))).toEqual([[`/${HOLD_FAR[0]}`, 0], [`/${HOLD_FAR[1]}`, HEAT_PACE.far]]);
  });
});

describe('drain', () => {
  it('runs her endurance out in ENDURANCE.hold seconds at the burning point, proportionally sooner hotter', () => {
    expect(ENDURANCE.hold * drain(HEAT.burn)).toBeCloseTo(1, 12);
    expect((ENDURANCE.hold / 2) * drain(2 * HEAT.burn)).toBeCloseTo(1, 12);
    expect((ENDURANCE.hold / 3) * drain(3 * HEAT.burn)).toBeCloseTo(1, 12);
  });
});

describe('ouches', () => {
  it('has one piece up at full endurance, more as it runs out, and all of them just before it’s gone', () => {
    expect(ouches(1)).toBe(1);
    expect(ouches(1e-6)).toBe(HOLD_OUCH.length);
    expect(ouches(0)).toBe(HOLD_OUCH.length);
    let was = ouches(1);
    for (let e = 1; e >= 0; e -= 0.001) {
      const n = ouches(e);
      expect(n).toBeGreaterThanOrEqual(was);
      expect(n - was).toBeLessThanOrEqual(1);
      was = n;
    }
  });
});

describe('toss', () => {
  it('goes from one hand to the other and back, smoothly, hopping between them', () => {
    expect(toss(0).across).toBeCloseTo(-TOSS.across, 9);
    expect(toss(TOSS.s).across).toBeCloseTo(TOSS.across, 9);
    expect(toss(2 * TOSS.s).across).toBeCloseTo(-TOSS.across, 9);
    for (const k of [0, 1, 2]) {
      expect(toss(k * TOSS.s).up).toBeCloseTo(0, 9);
      expect(toss((k + 0.5) * TOSS.s).up).toBeCloseTo(TOSS.hop, 9);
      expect(toss((k + 0.5) * TOSS.s).across).toBeCloseTo(0, 9);
    }
    // continuous through each catch, and on its way across in between
    for (const k of [1, 2, 3]) {
      const [a, b] = [toss(k * TOSS.s - 1e-7), toss(k * TOSS.s + 1e-7)];
      expect(Math.abs(a.across - b.across)).toBeLessThan(1e-4);
      expect(Math.abs(a.up - b.up)).toBeLessThan(1e-4);
      expect(Math.abs(a.lean - b.lean)).toBeLessThan(1e-4);
    }
    // it leans toward the hand it's going to, most in the middle
    expect(toss(0.5 * TOSS.s).lean).toBeCloseTo(1, 9);
    expect(toss(1.5 * TOSS.s).lean).toBeCloseTo(-1, 9);
  });
});
