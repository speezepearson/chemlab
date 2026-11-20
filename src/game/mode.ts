/**
 * How the lab is seen and worked, which the player can switch between, to try them against each other:
 * - wall: a view square on to the bench, with perspective, worked with the mouse's own pointer;
 * - walk: walking round the room and looking about, as it once was, with a crosshair in the middle of the view;
 *   the equipment is still all on the wall;
 * - iso: as wall, but with no perspective, seen a little from above and one side, so that what's dragged across the
 *   wall goes just as far across the view wherever it is;
 * - flat: the bench drawn flat, on a plain 2D canvas, with nothing three-dimensional about it.
 */
export type ViewMode = 'wall' | 'walk' | 'iso' | 'flat';

/** The modes that are offered, in the order they're offered, each with its name as the player sees it. */
export const VIEW_MODES: readonly { id: ViewMode; name: string }[] = [
  { id: 'wall', name: 'Wall' },
  { id: 'walk', name: 'Walk round' },
  { id: 'iso', name: 'Isometric' },
  { id: 'flat', name: 'Flat' },
];

/** Every mode there is, offered or not. */
const KNOWN: readonly ViewMode[] = ['wall', 'walk', 'iso', 'flat'];

const KEY = 'slurry-lab.view';

/** The mode the player last chose, kept in local storage (not in saves, which load in any of them); wall to start with. */
export function storedMode(): ViewMode {
  try {
    const m = localStorage.getItem(KEY);
    return KNOWN.includes(m as ViewMode) ? (m as ViewMode) : 'wall';
  } catch {
    return 'wall';
  }
}

export function storeMode(m: ViewMode): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // storage blocked: it's just wall again next time
  }
}
