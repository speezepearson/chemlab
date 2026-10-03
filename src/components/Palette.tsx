import { useEffect, type ReactNode } from 'react';
import type { GameEngine } from '../game/engine';

/** Small drawings of each item, echoing how the bench draws it, in a 40 × 40 box. */
const ICONS: Record<string, ReactNode> = {
  flask: <path className="glass" d="M16 6 H24 L23 15 L31 32 Q32 35 29 35 H11 Q8 35 9 32 L17 15 Z" />,
  dispenser: (
    <>
      <path className="pipe" d="M20 26 V35" />
      <rect className="glass" x="9" y="4" width="22" height="22" rx="2" />
      <circle className="valve" cx="20" cy="31" r="2.5" />
    </>
  ),
  pipette: (
    <>
      <path className="pipe" d="M20 28 V36" />
      <path className="glass" d="M13 4 L18 10 V27 Q18 29 20 29 Q22 29 22 27 V10 L27 4" />
      <circle className="valve" cx="20" cy="32" r="2.5" />
    </>
  ),
  exchanger: (
    <>
      <path className="pipe" d="M9 22 V27 M31 22 V27 M29 31 V37 M11 31 V37" />
      <path className="pipe" d="M9 27 C14 35 16 35 20 29 S26 23 31 31 M11 31 C15 23 18 23 20 29 S26 35 31 27" />
      <rect className="glass" x="3" y="4" width="13" height="18" rx="2" />
      <rect className="glass" x="24" y="4" width="13" height="18" rx="2" />
    </>
  ),
  separator: (
    <>
      <path className="pipe" d="M20 24 V28 M11 31 V37 M29 31 V37" />
      <rect className="glass" x="11" y="4" width="18" height="20" rx="2" />
      <rect className="valve" x="6" y="28" width="28" height="4" rx="2" />
    </>
  ),
  splitter: (
    <>
      <path className="pipe" d="M20 14 V23 L11 29 V37 M20 23 L29 29 V37" />
      <path className="glass" d="M8 4 H32 L21.5 14 H18.5 Z" />
      <circle className="valve" cx="20" cy="19" r="2.5" />
    </>
  ),
  sorter: (
    <>
      <path className="pipe" d="M7 12 V16 M15 20 V37 M26 24 V37 M36 27 V37" />
      <path className="pipe" d="M3 15 L36 27" />
      <path className="glass" d="M1 3 H13 L8 11 H6 Z" />
    </>
  ),
  heater: (
    <>
      <path className="pipe" d="M9 27 V37 M20 27 V37 M31 27 V37 M36 23 Q39 23 39 27 V37" />
      <path className="glass" d="M1 3 H11 L7 8 H5 Z" />
      <rect className="glass" x="2" y="18" width="35" height="9" rx="4.5" />
      <path d="M4 22.5 Q5.5 20 7 22.5 T10 22.5 T13 22.5 T16 22.5 T19 22.5 T22 22.5 T25 22.5 T28 22.5 V12" style={{ stroke: '#b87333', strokeWidth: 1.2 }} />
      <rect className="valve" x="22" y="4" width="14" height="9" rx="2" />
      <circle className="valve" cx="29" cy="8.5" r="2.5" />
    </>
  ),
  scale: (
    <>
      <path className="pipe" d="M4 20 H36" />
      <rect className="valve" x="6" y="21" width="28" height="13" rx="3" />
      <rect className="lcd" x="9" y="24.5" width="15" height="6" rx="1" style={{ fill: '#050603' }} />
      <path className="digits" d="M15 27.5 H22" style={{ stroke: 'yellowgreen' }} />
      <rect x="26" y="25" width="6" height="5" rx="1.2" style={{ fill: '#d8443b', stroke: 'none' }} />
    </>
  ),
  hose: (
    <>
      <path className="pipe" d="M10 12 C10 34 30 12 30 30" />
      <path className="glass" d="M4 6 H16 L12 12 H8 Z" />
      <rect className="valve" x="28" y="30" width="4" height="5" />
    </>
  ),
};

const ITEMS = [
  ['flask', 'Flask'],
  ['dispenser', 'Dispenser'],
  ['pipette', 'Pipette'],
  ['exchanger', 'Heat exchanger'],
  ['separator', 'Separator'],
  ['splitter', 'Splitter'],
  ['sorter', 'Size sorter'],
  ['heater', 'Resistive heater'],
  ['scale', 'Scale'],
  ['hose', 'Hose'],
] as const;

/** The key that puts down each item, in ITEMS order: 1 to 9, then 0. */
const hotkey = (i: number) => String((i + 1) % 10);

/** Whether a key press is meant for a text field, not the bench. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/**
 * Prototypes to drag onto the bench to make more of them. Dropping anything back here puts it away. Each has a
 * number key too, which puts a new one down under the pointer.
 */
export function Palette({ engine }: { engine: GameEngine }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e.target)) return;
      const i = ITEMS.findIndex((_, j) => hotkey(j) === e.key);
      if (i >= 0 && engine.placeAt(ITEMS[i][0])) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  return (
    <aside className="palette" aria-label="equipment" title="Drag out to add. Drop here to put away.">
      {ITEMS.map(([kind, label], i) => (
        <button
          key={kind}
          aria-label={label}
          aria-keyshortcuts={hotkey(i)}
          // no name in the tooltip: working out what each tool does is part of the game
          title={`Drag onto the bench for a new one, or back here to put one away. Press ${hotkey(i)} to put one under the pointer.`}
          onPointerDown={(e) => {
            e.preventDefault();
            engine.spawn(kind, e.clientX, e.clientY);
          }}
        >
          <svg viewBox="0 0 40 40" aria-hidden="true">
            {ICONS[kind]}
          </svg>
          <span className="key" aria-hidden="true">
            {hotkey(i)}
          </span>
        </button>
      ))}
    </aside>
  );
}
