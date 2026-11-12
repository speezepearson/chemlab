import type { ReactNode } from 'react';
import { HOTKEYS, ITEMS, type GameEngine } from '../game/engine';

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
  multiplexer: (
    <>
      <path className="pipe" d="M11 14 V17 L20 23 V37 M29 14 V17 L20 23" />
      <path className="glass" d="M3 4 H19 L12.5 14 H9.5 Z M21 4 H37 L30.5 14 H27.5 Z" />
      <circle className="valve" cx="20" cy="29" r="2.5" />
    </>
  ),
  sorter: (
    <>
      <path className="pipe" d="M7 12 V16 M13 19 V37 M21 22 V37 M29 25 V37 M37 28 V37" />
      <path className="pipe" d="M3 15 L37 28" />
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
  tank: (
    <>
      <path className="pipe" d="M20 29 V37" />
      <rect className="glass" x="3" y="6" width="34" height="23" rx="2" />
      <path d="M4 11 H36 M4 16 H36 M4 20.5 H36 M4 25 H36" style={{ stroke: 'var(--glass)', strokeWidth: 0.5, opacity: 0.5 }} />
      <circle className="valve" cx="20" cy="33" r="2.5" />
    </>
  ),
  meter: (
    <>
      <path className="pipe" d="M20 18 V37" />
      <rect className="glass" x="17" y="3" width="6" height="15" rx="1.5" />
      <rect className="valve" x="11" y="20" width="18" height="9" rx="1.5" />
      <rect className="lcd" x="12.5" y="21.5" width="15" height="6" rx="0.8" style={{ fill: '#050603' }} />
      <path className="digits" d="M14.5 24.5 H25.5" style={{ stroke: 'yellowgreen' }} />
    </>
  ),
  dilatometer: (
    <>
      <path className="pipe" d="M11 27 V30 H5 V37 M29 27 V30 H35 V37" />
      <path className="glass" d="M19.2 3 V27 H5 V17 H16 V3 M20.8 3 V27 H35 V17 H24 V3" />
      <path d="M5 20 H35 M5 23.5 H35" style={{ stroke: '#b87333', strokeWidth: 1.2 }} />
      <circle className="valve" cx="20" cy="33" r="3.5" />
    </>
  ),
  strip: (
    <>
      <path className="glass" d="M12 3 H28 L23 9 H17 Z" />
      <rect x="14.5" y="10" width="11" height="27" rx="0.8" style={{ fill: '#e6dfc8', stroke: 'var(--pipe)', strokeWidth: 0.8 }} />
      <path d="M15.5 17 H24.5 M15.5 24 H24.5 M15.5 27.5 H24.5" style={{ stroke: 'var(--pipe)', strokeWidth: 2.2, opacity: 0.75 }} />
    </>
  ),
  culture: (
    <>
      <path className="glass" d="M14 3 H26 L32 10 V35 H8 V10 Z" />
      <g style={{ fill: '#96d6ff', stroke: 'none' }}>
        {[14, 20, 26].flatMap((x) => [15, 22, 29].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />))}
      </g>
      <circle cx="20" cy="22" r="1.7" style={{ fill: '#8a5a36', stroke: 'none' }} />
    </>
  ),
  thermometer: (
    <>
      <path className="pipe" d="M12 16 V37" />
      <rect className="glass" x="9" y="3" width="6" height="13" rx="1.5" />
      <rect className="valve" x="20" y="3" width="12" height="31" rx="1.5" />
      <path className="pipe" d="M12 28.5 H24" style={{ strokeWidth: 2 }} />
      <path d="M26 7 V26" style={{ stroke: 'var(--glass)', strokeWidth: 3 }} />
      <path d="M26 15 V27" style={{ stroke: '#d8443b', strokeWidth: 1.5 }} />
      <circle cx="26" cy="28.5" r="2.8" style={{ fill: '#d8443b', stroke: 'none' }} />
    </>
  ),
};

/**
 * The equipment that can be made, along the bottom of the view: a key (along the number row, and then from Z along
 * the bottom row of letters) makes one in the player's hands, if they're empty. Clicking one does the same, when the mouse isn't captured. Last is the pencil, for sticky
 * notes.
 */
export function Palette({ engine, pencil }: { engine: GameEngine; pencil: boolean }) {
  return (
    <div className="palette" aria-label="equipment">
      {ITEMS.map((kind, i) => (
        <button
          key={kind}
          aria-label={kind}
          aria-keyshortcuts={HOTKEYS[i]}
          // no name in the tooltip: working out what each tool does is part of the game
          title={`Press ${HOTKEYS[i]} to make one in your hands`}
          onClick={() => {
            engine.lock();
            engine.spawn(kind);
          }}
        >
          <svg viewBox="0 0 40 40" aria-hidden="true">
            {ICONS[kind]}
          </svg>
          <kbd>{HOTKEYS[i]}</kbd>
        </button>
      ))}
      <button
        className={`pencil${pencil ? ' on' : ''}`}
        aria-label="Pencil"
        aria-pressed={pencil}
        aria-keyshortcuts="P"
        title={
          'Pencil (P): the mouse moves a pointer instead of your view. Drag on bare back wall for a sticky note, drag ' +
          'on one to draw, click one to type, right-drag to erase. Drag a note by its top strip, resize it by its ' +
          'corner, × throws it away. P puts it down.'
        }
        onClick={() => {
          engine.lock();
          engine.setPencil(!engine.pencilOn);
        }}
      >
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <rect x="5" y="20" width="18" height="15" rx="1" style={{ fill: '#fbf0a2', stroke: 'var(--glass)' }} />
          <path className="pipe" d="M17 30 L33 9" style={{ strokeWidth: 4 }} />
          <path d="M15.2 32.4 L17 30 L19 31.5 Z" style={{ fill: 'var(--ink)', stroke: 'var(--ink)', strokeWidth: 1 }} />
        </svg>
        <kbd>P</kbd>
      </button>
    </div>
  );
}
