import { useEffect, useReducer, useRef, useState } from 'react';
import type { GameEngine } from '../game/engine';

/** The longest note anything takes: about as wide as a flask's slot on the shelf. */
export const MAX_LABEL = 24;

/**
 * A text field where a note goes (see GameEngine.note for its id), above a flask, tank, tool, scale, hose or faucet:
 * Enter or clicking away keeps it, Escape leaves it as it was, and an empty one clears it.
 */
export function LabelEditor({ engine, id, onClose }: { engine: GameEngine; id: string; onClose(): void }) {
  const found = engine.note(id);
  const [text, setText] = useState(found?.text ?? '');
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
    if (keep) found.set(text.trim());
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
      placeholder="note"
      aria-label="note"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
