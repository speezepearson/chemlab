/**
 * Where a sound on the bench is heard from, given where it is on screen: full volume anywhere in view, fading
 * out as it gets further off screen until it's silent a whole view's width (or height) past the edge; and panned
 * toward its side, gently across the view and fully once it's well off to one side. Up and down only fade.
 */
export interface Placement {
  /** 0 (silent) to 1 (in view). */
  gain: number;
  /** −1 (hard left) to 1 (hard right). */
  pan: number;
}

/** Where every sound is heard from when nothing places it: in view, straight ahead. */
export const CENTER: Placement = { gain: 1, pan: 0 };

/** How far the pan swings at the view's left and right edges; it reaches all the way a half view further out. */
const EDGE_PAN = 0.5;

/** A sound at (x, y) on a view of w × h, in CSS pixels from its top left. */
export function placement(x: number, y: number, w: number, h: number): Placement {
  if (!(w > 0 && h > 0)) return CENTER;
  // how far outside the view, in view widths and heights
  const ox = Math.max(0, -x, x - w) / w;
  const oy = Math.max(0, -y, y - h) / h;
  const off = Math.hypot(ox, oy);
  const gain = (1 - Math.min(1, off)) ** 2;
  const across = (x - w / 2) / (w / 2); // −1 at the left edge, 1 at the right
  const pan = Math.max(-1, Math.min(1, EDGE_PAN * across));
  return { gain, pan };
}
