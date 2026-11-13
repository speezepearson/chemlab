import { describe, expect, it } from 'vitest';
import { ANTINUCLEANT, ANTINUCLEANT_L, GOAL_L, VOYAGE } from '../game/config';
import { arrival, notice } from './notice';

const text = (b: unknown) => (b && typeof b === 'object' && 'text' in b ? String(b.text) : '');
/** The figures for the cryostabilizer, and for the antinucleant if it's still to be made. */
const figures = (litres?: number, first?: number | null) => {
  const pre = notice(litres, first).filter((b) => b.kind === 'pre' && b.text.includes('DEFICIT'));
  return { cryo: text(pre.find((b) => text(b).startsWith('Cryostabilizer:'))), first: text(pre.find((b) => text(b).startsWith('Antinucleant:'))) };
};
const L = (l: number) => `${l.toFixed(2)} L`;

describe('the notice in the pod', () => {
  it("says what's left on board at first, and what must be made", () => {
    const f = figures().cryo;
    expect(f).toContain(`Present:  ${L(VOYAGE.presentL)}`);
    expect(f).toContain(`DEFICIT:  ${L(GOAL_L - VOYAGE.presentL)}`);
  });

  it('sets out each sum the same way, a line to each factor, the litres lined up', () => {
    expect(figures().cryo.split('\n')).toEqual([
      'Cryostabilizer:',
      '',
      'Required: 50.22 L  =   32,210 passengers',
      '                     x 0.3499 uL/pass/day',
      '                     x 4,456 days',
      'Present:  28.10 L',
      '',
      'DEFICIT:  22.12 L',
    ]);
    expect(figures().first.split('\n')).toEqual([
      'Antinucleant:',
      '',
      'Required: 9.20 L  =   32,210 passengers',
      '                    x 0.0641 uL/pass/day',
      '                    x 4,456 days',
      'Present:  8.30 L',
      '',
      'DEFICIT:  0.90 L',
    ]);
    // a shorter figure is padded to line up with the others
    expect(figures(5).cryo).toContain('Present:   5.00 L');
  });

  it('puts the antinucleant first while it is still to be made, and says nothing else about it', () => {
    const { first, cryo } = figures();
    expect(first).toContain(`${ANTINUCLEANT.mlPerPassengerDay * 1000} uL/pass/day`);
    expect(first).toContain(L(ANTINUCLEANT_L));
    const all = notice().map(text);
    expect(all.indexOf(first)).toBe(all.indexOf(cryo) - 1);
    // with what the station's reservoir holds of it since
    expect(figures(undefined, 9).first).toContain(`Present:  ${L(9)}`);
    // and once there's enough, only the cryostabilizer
    expect(figures(30, null).first).toBe('');
    // the rest of it is the same however many problems there are: it wasn't written for this
    const rest = (bs: ReturnType<typeof notice>) => bs.map(text).filter((t) => !t.includes('DEFICIT'));
    expect(rest(notice())).toEqual(rest(notice(30, null)));
    expect(rest(notice()).join(' ')).not.toMatch(/antinucleant/i);
    expect(all.some((t) => t.endsWith('following problem(s):'))).toBe(true);
  });

  it('can say what the reservoir holds since, and never that less than nothing must be made', () => {
    const f = figures(40, null).cryo;
    expect(f).toContain(L(40));
    expect(f).toContain(L(GOAL_L - 40));
    expect(figures(GOAL_L + 5, null).cryo).toContain(`DEFICIT:   ${L(0)}`);
  });

  it('welcomes them to Mu Ceti at the end, and says no more', () => {
    expect(arrival().map((b) => ('text' in b ? b.text : ''))).toContain('Welcome to Mu Ceti.');
  });
});
