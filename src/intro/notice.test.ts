import { describe, expect, it } from 'vitest';
import { SUPPLIES } from '../game/supply';
import { arrival, notice } from './notice';

const text = (b: unknown) => (b && typeof b === 'object' && 'text' in b ? String(b.text) : '');
/** The block of figures, a line to each thing the ship is short of. */
const figures = (present?: number[]) => text(notice(present).find((b) => b.kind === 'pre' && b.text.includes('DEFICIT')));
const L = (l: number) => `${l.toFixed(2)} L`;
const title = (name: string) => `${name[0].toUpperCase()}${name.slice(1)}:`;

describe('the notice in the pod', () => {
  it("gives a line to each thing the ship is short of, in order: what's on board of it at first, what's needed, and the deficit", () => {
    const lines = figures().split('\n');
    expect(lines).toHaveLength(SUPPLIES.length);
    SUPPLIES.forEach((s, i) => {
      expect(lines[i].startsWith(title(s.name))).toBe(true);
      expect(lines[i]).toMatch(new RegExp(` ${L(s.startL)} / +${L(s.goalL)} +DEFICIT: +${L(s.goalL - s.startL)}$`));
    });
  });

  it('lines up each column, the litres right-aligned', () => {
    const lines = figures(SUPPLIES.map((s, i) => (i === 0 ? 5 : s.startL))).split('\n');
    const ends = (re: RegExp) => lines.map((l) => [...l.matchAll(re)].map((m) => m.index! + m[0].length));
    // where each litres ends, and where DEFICIT starts, is the same on every line
    expect(new Set(ends(/ L/g).map((e) => e.join()))).toHaveLength(1);
    expect(new Set(lines.map((l) => l.indexOf('DEFICIT')))).toHaveLength(1);
    // and the names are padded to the longest
    const w = Math.max(...SUPPLIES.map((s) => title(s.name).length));
    for (const l of lines) expect(l[w]).toBe(' ');
    expect(lines[0]).toContain(' 5.00 L / ');
  });

  it("can say what's on board since, and never that less than nothing must be made", () => {
    const last = SUPPLIES.length - 1;
    const goal = SUPPLIES[last].goalL;
    const said = (l: number) => figures(SUPPLIES.map((s, i) => (i === last ? l : s.goalL))).split('\n')[last];
    expect(said(goal - 3)).toContain(`${L(goal - 3)} / ${L(goal)}`);
    expect(said(goal - 3)).toMatch(new RegExp(`DEFICIT: +${L(3)}$`));
    expect(said(goal + 5)).toMatch(new RegExp(`DEFICIT: +${L(0)}$`));
  });

  it('says the same otherwise, whatever the figures: it was written for the happy path', () => {
    const rest = (bs: ReturnType<typeof notice>) => bs.map(text).filter((t) => !t.includes('DEFICIT'));
    expect(rest(notice())).toEqual(rest(notice(SUPPLIES.map((s) => s.goalL))));
    expect(notice().map(text).some((t) => t.endsWith('following problem(s):'))).toBe(true);
  });

  it('welcomes them to Mu Ceti at the end, and says no more', () => {
    expect(arrival().map((b) => ('text' in b ? b.text : ''))).toContain('Welcome to Mu Ceti.');
  });
});
