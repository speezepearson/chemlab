import { useEffect, useReducer, useRef, useState } from 'react';
import type { GameEngine, PaperEdit } from '../game/engine';
import { PAPER_TEXT_MAX } from '../game/paper';

/**
 * A text field where a line of text on a sticky note is typed, starting where it'll be written: Enter or clicking
 * away keeps it, Escape leaves it as it was, and an empty one rubs it out.
 */
export function PaperTextEditor({ engine, edit, onClose }: { engine: GameEngine; edit: PaperEdit; onClose(): void }) {
  const [text, setText] = useState(() => engine.paperText(edit));
  const done = useRef(false);
  // follow the note if the view moves
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const timer = setInterval(rerender, 100);
    return () => clearInterval(timer);
  }, []);

  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    if (keep) engine.writePaperText(edit, text);
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

  const at = engine.paperTextSpot(edit);
  if (!at) return null;
  return (
    <input
      ref={input}
      className="paper-edit"
      style={{ left: at.x, top: at.y }}
      autoFocus
      value={text}
      maxLength={PAPER_TEXT_MAX}
      placeholder="write here"
      aria-label="sticky note text"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
        e.stopPropagation();
      }}
      onBlur={() => finish(true)}
    />
  );
}
