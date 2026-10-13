import { describe, expect, it } from 'vitest';
import { GOAL_L, VOYAGE } from '../game/config';
import { notice, welcomeNotice } from './notice';

const text = (bs: ReturnType<typeof notice>) => bs.map((b) => ('text' in b ? b.text : '')).join('\n');

describe('notice', () => {
  it("first says what's left on board, and what's short", () => {
    const t = text(notice());
    expect(t).toContain(`${VOYAGE.presentL.toFixed(2)} L`);
    expect(t).toContain(`${(GOAL_L - VOYAGE.presentL).toFixed(2)} L`);
  });

  it("says what's on board now, waking again", () => {
    const t = text(notice(31.5));
    expect(t).toContain('31.50 L');
    expect(t).toContain(`${(GOAL_L - 31.5).toFixed(2)} L`);
    expect(t).not.toContain(`${VOYAGE.presentL.toFixed(2)} L`);
  });

  it('welcomes them to Mu Ceti, with what they added', () => {
    const t = text(welcomeNotice(22.123));
    expect(t).toContain('Welcome to Mu Ceti!');
    expect(t).toContain('22.12 L');
  });
});
