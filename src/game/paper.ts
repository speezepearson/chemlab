import type { Point } from './flask';

/**
 * A sticky note: a sheet of paper on the bench for the player's own notes, drawn behind all the equipment, which
 * the pencil (see the engine) draws and writes on. Everything on it is in world units from its top left corner, so
 * it moves with the sheet.
 */
export class Paper {
  /** Pencil strokes, each a run of points as [x0, y0, x1, y1, ...]. */
  strokes: number[][] = [];
  /** Lines of typed text, each with the left end of its baseline at (x, y). */
  texts: PaperText[] = [];

  constructor(
    /** Its top left corner, as fractions of the home area's width and height (see HOME_W). */
    public fx: number,
    public fy: number,
    /** Its size, in world units. */
    public w: number,
    public h: number,
  ) {}
}

export interface PaperText {
  x: number;
  y: number;
  text: string;
}

/** The smallest a sheet can be, in world units: a rectangle marked out smaller than this makes none. */
export const PAPER_MIN = { w: 40, h: 30 };
/** The strip along a sheet's top, in world units, by which the pencil moves it. */
export const PAPER_HEADER = 9;
/** The size of the square at a sheet's top right corner that throws it away, and at its bottom right that resizes it. */
export const PAPER_HANDLE = 9;
/** How far apart a stroke's points are kept, in world units: closer ones add nothing but bulk to a save. */
export const PENCIL_STEP = 1.5;
/** The height of typed text, in world units. */
export const PAPER_TEXT = 10;
/** The longest line of text the pencil writes. */
export const PAPER_TEXT_MAX = 60;
/** How near the pointer a stroke has to pass for the eraser to take it, in world units. */
export const ERASER = 5;

/** Keep a point inside a w × h sheet. */
export function clampTo(paper: Paper, p: Point): Point {
  return { x: Math.max(0, Math.min(paper.w, p.x)), y: Math.max(0, Math.min(paper.h, p.y)) };
}

/**
 * Add a point to the end of a stroke, kept inside the sheet, unless it's within PENCIL_STEP of the last one; returns
 * whether it was added.
 */
export function extend(paper: Paper, stroke: number[], p: Point): boolean {
  const q = clampTo(paper, p);
  const n = stroke.length;
  if (n >= 2 && Math.hypot(q.x - stroke[n - 2], q.y - stroke[n - 1]) < PENCIL_STEP) return false;
  stroke.push(Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10);
  return true;
}

/** Roughly how wide a line of typed text is, in world units. */
export const textWidth = (text: string) => text.length * PAPER_TEXT * 0.55;

/** The line of typed text under p (in sheet units), the last written first; -1 if none. */
export function textAt(paper: Paper, p: Point): number {
  for (let i = paper.texts.length - 1; i >= 0; i--) {
    const t = paper.texts[i];
    if (p.x >= t.x - 2 && p.x <= t.x + textWidth(t.text) + 2 && p.y >= t.y - PAPER_TEXT && p.y <= t.y + 3) return i;
  }
  return -1;
}

/** Rub out whatever the eraser at p (in sheet units) touches: strokes passing within ERASER, and text under it. */
export function eraseAt(paper: Paper, p: Point): boolean {
  const near = (s: number[]) => {
    for (let i = 0; i < s.length; i += 2) if (Math.hypot(s[i] - p.x, s[i + 1] - p.y) < ERASER) return true;
    return false;
  };
  const strokes = paper.strokes.filter((s) => !near(s));
  const t = textAt(paper, p);
  const changed = strokes.length !== paper.strokes.length || t >= 0;
  paper.strokes = strokes;
  if (t >= 0) paper.texts.splice(t, 1);
  return changed;
}

/** A sheet as saved: where it is, its size, and what's on it. */
export interface SavedPaper {
  fx: number;
  fy: number;
  w: number;
  h: number;
  strokes?: number[][];
  texts?: PaperText[];
}

export function savePaper(p: Paper): SavedPaper {
  return { fx: p.fx, fy: p.fy, w: p.w, h: p.h, strokes: p.strokes.map((s) => [...s]), texts: p.texts.map((t) => ({ ...t })) };
}

/** A sheet from a save, or null if it isn't one; anything malformed on it is dropped. */
export function loadPaper(s: SavedPaper): Paper | null {
  const ok = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  if (!s || !ok(s.fx) || !ok(s.fy) || !ok(s.w) || !ok(s.h)) return null;
  const p = new Paper(s.fx, s.fy, Math.max(PAPER_MIN.w, s.w), Math.max(PAPER_MIN.h, s.h));
  if (Array.isArray(s.strokes))
    p.strokes = s.strokes.filter((st) => Array.isArray(st) && st.length >= 2 && st.length % 2 === 0 && st.every(ok));
  if (Array.isArray(s.texts))
    p.texts = s.texts
      .filter((t) => t && ok(t.x) && ok(t.y) && typeof t.text === 'string' && t.text)
      .map((t) => ({ x: t.x, y: t.y, text: t.text.slice(0, PAPER_TEXT_MAX) }));
  return p;
}
