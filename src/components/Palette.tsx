import type { ReactNode } from 'react';
import { HOTKEYS, ITEMS, type GameEngine } from '../game/engine';

/** A thermometer's icon: ticks every `gap` up its backing, every fifth longer, and its column of spirit up to `top`. */
function thermometerIcon(gap: number, top: number): ReactNode {
  const ticks = Array.from({ length: Math.floor(20 / gap) + 1 }, (_, i) => `M19.6 ${27 - i * gap} H${i % 5 ? 21.4 : 22.6}`).join(' ');
  return (
    <>
      <rect className="glass" x="15.5" y="2" width="9" height="36" rx="4.5" />
      <rect x="17.5" y="5" width="5.5" height="24" style={{ fill: '#f1efe6', stroke: 'none' }} />
      <path d={ticks} style={{ stroke: '#2a2925', strokeWidth: 0.6 }} />
      <path d={`M18.6 32 V${top}`} style={{ stroke: '#d8443b', strokeWidth: 1.3 }} />
      <rect x="17.2" y="30" width="5.6" height="6" rx="2.8" style={{ fill: '#d8443b', stroke: 'none' }} />
    </>
  );
}

/** Small drawings of each item, echoing how the bench draws it, in a 40 × 40 box. */
export const ICONS: Record<string, ReactNode> = {
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
      <path className="pipe" d="M11 30 V32 H5 V38 M29 30 V32 H35 V38" />
      <path className="glass" d="M2 2 H10 L7 6 H5 Z M30 2 H38 L35 6 H33 Z" />
      <path className="glass" d="M6 6 L18 12 M34 6 L22 12" />
      <path className="glass" d="M19.2 11 V30 H5 V22 H16 V11 M20.8 11 V30 H35 V22 H24 V11" />
      <path d="M5 24.5 H35 M5 27.5 H35" style={{ stroke: '#b87333', strokeWidth: 1.2 }} />
      <circle className="valve" cx="20" cy="35" r="3" />
    </>
  ),
  strip: (
    <>
      <path d="M15 5 H25 V32 L20 38 L15 32 Z" style={{ fill: '#e6dfc8', stroke: 'var(--pipe)', strokeWidth: 0.8 }} />
      <path d="M16 13 H24 M16 21 H24 M16 24.5 H24" style={{ stroke: 'var(--pipe)', strokeWidth: 2.2, opacity: 0.75 }} />
      <rect x="16.5" y="2" width="7" height="6" rx="0.8" style={{ fill: 'var(--pipe)', stroke: 'none' }} />
    </>
  ),
  dish: (
    <>
      <rect x="15" y="25" width="10" height="9" rx="1" style={{ fill: 'var(--pipe)', stroke: 'none' }} />
      <path className="glass" d="M4 16 V24 H36 V16" />
    </>
  ),
  column: (
    <>
      <path className="pipe" d="M20 7.5 V9 M20 30 V38" />
      <path className="glass" d="M14 1.5 H26 L21 7.5 H19 Z" />
      <rect x="17" y="9" width="6" height="21" rx="1" style={{ fill: '#e6dfc8', stroke: 'var(--glass)', strokeWidth: 0.8 }} />
      <path d="M17.6 15 H22.4 M17.6 22 H22.4" style={{ stroke: 'var(--pipe)', strokeWidth: 1.6, opacity: 0.6 }} />
      <circle className="valve" cx="20" cy="33" r="2.5" />
    </>
  ),
  culture: (
    <>
      <path className="pipe" d="M20 30 V38" />
      <path className="glass" d="M15 2 H25 L31 7 V30 H9 V7 Z" />
      <g style={{ fill: '#96d6ff', stroke: 'none' }}>
        {[14.5, 20, 25.5].flatMap((x) => [12, 18.5, 25].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" />))}
      </g>
      <circle cx="20" cy="18.5" r="1.7" style={{ fill: '#8a5a36', stroke: 'none' }} />
      <circle className="valve" cx="20" cy="34" r="2.5" />
    </>
  ),
  // the thermometers: a glass rod with a white backing, a scale on it, and a column of red spirit up from its bulb;
  // the fine one's ticks close together, the wide one's further apart
  thermometer: thermometerIcon(2, 21),
  thermometerWide: thermometerIcon(5, 14),
};

/**
 * The equipment that can be made, along the bottom of the view: a key (along the number row, and then from Z along
 * the bottom row of letters) makes one in the player's hands, if they're empty. Clicking one does the same, when the mouse isn't captured.
 * The equipment wheel (see Wheel in Hud.tsx) makes the same things, in the same order.
 */
export function Palette({ engine }: { engine: GameEngine }) {
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
    </div>
  );
}
