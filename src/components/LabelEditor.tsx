import { useEffect, useReducer, useRef, useState } from 'react';
import type { GameEngine } from '../game/engine';

/** The longest label a flask or tank takes: about as wide as a flask's slot on the shelf. */
export const MAX_LABEL = 20;

/**
 * A text field over a flask's or a tool tank's label, for naming what's in it: Enter or clicking away keeps it, Escape leaves it
 * as it was, and an empty one clears the label.
 */
export function LabelEditor({ engine, id, onClose }: { engine: GameEngine; id: string; onClose(): void }) {
  const found = engine.vessel(id);
  const [text, setText] = useState(found?.vessel.label ?? '');
  const done = useRef(false);
  // follow the flask if the view moves
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const timer = setInterval(rerender, 100);
    return () => clearInterval(timer);
  }, []);

  const finish = (keep: boolean) => {
    if (done.current || !found) return;
    done.current = true;
    if (keep) found.vessel.label = text.trim();
    onClose();
  };
  // clicking anywhere else keeps it; the canvas doesn't take focus, so the field wouldn't blur on its own
  const input = useRef<HTMLInputElement>(null);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (e.target !== input.current) finishRef.current(true);
    };
    document.addEventListener('pointerdown', away, { capture: true });
    return () => document.removeEventListener('pointerdown', away, { capture: true });
  }, []);

  const at = engine.labelSpot(id);
  if (!found || !at) return null;
  return (
    <input
      ref={input}
      className="label-edit"
      style={{ left: at.x, top: at.y }}
      autoFocus
      value={text}
      maxLength={MAX_LABEL}
      placeholder="label"
      aria-label="label"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
