import { describe, expect, it } from 'vitest';
import { ANTINUCLEANT, ANTINUCLEANT_L, GOAL_L, VOYAGE } from '../game/config';
import { arrival, notice } from './notice';

const text = (b: unknown) => (b && typeof b === 'object' && 'text' in b ? String(b.text) : '');
/** The figures for the cryostabilizer, and for the antinucleant if it's still to be made. */
const figures = (litres?: number, first?: number | null) => {
  const pre = notice(litres, first).filter((b) => b.kind === 'pre' && b.text.includes('present'));
  return { cryo: text(pre.find((b) => text(b).startsWith('Cryostabilizer'))), first: text(pre.find((b) => text(b).startsWith('Antinucleant'))) };
};
const L = (l: number) => `${l.toFixed(2)} L`;

describe('the notice in the pod', () => {
  it("says what's left on board at first, and what must be made", () => {
    const f = figures().cryo;
    expect(f).toContain(L(VOYAGE.presentL));
    expect(f).toContain(L(GOAL_L - VOYAGE.presentL));
  });

  it('sets out the antinucleant first, as a warm-up, while it is still to be made', () => {
    const { first, cryo } = figures();
    expect(notice().map(text).join(' ')).toContain(`${ANTINUCLEANT.mlPerPassengerDay} mL`);
    expect(first).toContain(L(ANTINUCLEANT_L));
    expect(first).toContain(L(ANTINUCLEANT.presentL));
    expect(first).toContain(L(ANTINUCLEANT_L - ANTINUCLEANT.presentL));
    const all = notice().map(text);
    expect(all.indexOf(first)).toBeLessThan(all.indexOf(cryo));
    expect(all.some((t) => t.endsWith('following problems:'))).toBe(true);
    // with what the station's reservoir holds of it since
    expect(figures(undefined, 9).first).toContain(L(9));
    // and once there's enough, only the cryostabilizer
    expect(figures(30, null).first).toBe('');
    expect(notice(30, null).map(text).some((t) => t.endsWith('following problem:'))).toBe(true);
    expect(notice(30, null).map(text).join(' ')).not.toMatch(/antinucleant/i);
  });

  it('can say what the reservoir holds since, and never that less than nothing must be made', () => {
    const f = figures(40, null).cryo;
    expect(f).toContain(L(40));
    expect(f).toContain(L(GOAL_L - 40));
    expect(figures(GOAL_L + 5, null).cryo).toContain(L(0));
  });

  it('welcomes them to Mu Ceti at the end, and says no more', () => {
    expect(arrival().map((b) => ('text' in b ? b.text : ''))).toContain('Welcome to Mu Ceti.');
  });
});
