import { describe, expect, it } from 'vitest';
import { ERASER, PAPER_MIN, PAPER_TEXT, PENCIL_STEP, Paper, eraseAt, extend, loadPaper, savePaper, textAt } from './paper';

describe('paper', () => {
  it('keeps a stroke inside the sheet, and drops points too close to the last', () => {
    const p = new Paper(0, 0, 100, 60);
    const s: number[] = [];
    expect(extend(p, s, { x: 10, y: 10 })).toBe(true);
    expect(extend(p, s, { x: 10 + PENCIL_STEP / 2, y: 10 })).toBe(false);
    expect(extend(p, s, { x: 20, y: 10 })).toBe(true);
    expect(extend(p, s, { x: 500, y: -40 })).toBe(true);
    expect(s).toEqual([10, 10, 20, 10, 100, 0]);
  });

  it('erases strokes that pass near the eraser, and text under it, and nothing else', () => {
    const p = new Paper(0, 0, 200, 100);
    p.strokes = [[10, 10, 20, 10], [100, 80, 110, 80]];
    p.texts = [{ x: 50, y: 50, text: 'hello' }];
    expect(eraseAt(p, { x: 150, y: 20 })).toBe(false);
    expect(eraseAt(p, { x: 20, y: 10 + ERASER / 2 })).toBe(true);
    expect(p.strokes).toEqual([[100, 80, 110, 80]]);
    expect(eraseAt(p, { x: 55, y: 50 - PAPER_TEXT / 2 })).toBe(true);
    expect(p.texts).toEqual([]);
  });

  it('finds the line of text under a point, the last written first', () => {
    const p = new Paper(0, 0, 200, 100);
    p.texts = [{ x: 10, y: 30, text: 'first' }, { x: 12, y: 32, text: 'second' }];
    expect(textAt(p, { x: 15, y: 27 })).toBe(1);
    expect(textAt(p, { x: 15, y: 80 })).toBe(-1);
  });

  it('round-trips through a save, and drops what is malformed', () => {
    const p = new Paper(0.2, 0.3, 120, 80);
    p.strokes = [[1, 2, 3, 4]];
    p.texts = [{ x: 5, y: 15, text: 'note' }];
    const back = loadPaper(JSON.parse(JSON.stringify(savePaper(p))))!;
    expect(back).toEqual(p);
    const junk = loadPaper({ fx: 0, fy: 0, w: 1, h: 1, strokes: [[1, 2, 3], [1, 'x' as unknown as number]], texts: [{ x: 1, y: 2, text: '' }] })!;
    expect([junk.w, junk.h]).toEqual([PAPER_MIN.w, PAPER_MIN.h]);
    expect(junk.strokes).toEqual([]);
    expect(junk.texts).toEqual([]);
    expect(loadPaper({ fx: NaN, fy: 0, w: 50, h: 50 })).toBeNull();
  });
});
