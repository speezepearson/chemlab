import { describe, expect, it } from 'vitest';
import { GOAL_L, VOYAGE } from '../game/config';
import { arrival, notice } from './notice';

const figures = (litres?: number) => notice(litres).find((b) => b.kind === 'pre' && b.text.includes('present'));
const L = (l: number) => `${l.toFixed(2)} L`;

describe('the notice in the pod', () => {
  it("says what's left on board at first, and what must be made", () => {
    const f = figures();
    expect(f && 'text' in f && f.text).toContain(L(VOYAGE.presentL));
    expect(f && 'text' in f && f.text).toContain(L(GOAL_L - VOYAGE.presentL));
  });

  it('can say what the reservoir holds since, and never that less than nothing must be made', () => {
    const f = figures(40);
    expect(f && 'text' in f && f.text).toContain(L(40));
    expect(f && 'text' in f && f.text).toContain(L(GOAL_L - 40));
    const done = figures(GOAL_L + 5);
    expect(done && 'text' in done && done.text).toContain(L(0));
  });

  it('welcomes them to Mu Ceti at the end, and says no more', () => {
    expect(arrival().map((b) => ('text' in b ? b.text : ''))).toContain('Welcome to Mu Ceti.');
  });
});
