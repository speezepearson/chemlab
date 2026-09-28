import type { ReactNode } from 'react';
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
  scale: (
    <>
      <path className="pipe" d="M4 20 H36" />
      <rect className="valve" x="6" y="21" width="28" height="13" rx="3" />
      <rect className="lcd" x="10" y="25" width="14" height="5" rx="1" />
      <path className="digits" d="M15 27.5 H22" />
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
  ['exchanger', 'Heat exchanger'],
  ['separator', 'Separator'],
  ['scale', 'Scale'],
  ['hose', 'Hose'],
] as const;

/** Prototypes to drag onto the bench to make more of them. Dropping anything back here puts it away. */
export function Palette({ engine }: { engine: GameEngine }) {
  return (
    <aside className="palette" aria-label="equipment" title="Drag out to add. Drop here to put away.">
      {ITEMS.map(([kind, label]) => (
        <button
          key={kind}
          aria-label={label}
          title={`${label}: drag onto the bench for a new one, or back here to put one away`}
          onPointerDown={(e) => {
            e.preventDefault();
            engine.spawn(kind, e.clientX, e.clientY);
          }}
        >
          <svg viewBox="0 0 40 40" aria-hidden="true">
            {ICONS[kind]}
          </svg>
        </button>
      ))}
    </aside>
  );
}
