import type { GameEngine } from '../game/engine';

const ITEMS = [
  ['flask', 'Flask'],
  ['dispenser', 'Dispenser'],
  ['exchanger', 'Heat exchanger'],
  ['separator', 'Separator'],
  ['splitter', 'Splitter'],
  ['scale', 'Scale'],
  ['hose', 'Hose'],
] as const;

/** Prototypes to drag onto the bench to make more of them. Dropping anything back here puts it away. */
export function Palette({ engine }: { engine: GameEngine }) {
  return (
    <aside className="palette" aria-label="equipment">
      {ITEMS.map(([kind, label]) => (
        <button
          key={kind}
          title={`Drag onto the bench for a new ${label.toLowerCase()}`}
          onPointerDown={(e) => {
            e.preventDefault();
            engine.spawn(kind, e.clientX, e.clientY);
          }}
        >
          {label}
        </button>
      ))}
      <p>Drag out to add. Drop here to put away.</p>
    </aside>
  );
}
