import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e5) return v.toExponential(2).replace('e+', 'e');
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

/**
 * A number you drag sideways to scale: 1% per pixel, continuously, so 100px
 * left is a factor of 1/e. Scaling keeps the sign, and since it can't leave
 * zero, a drag starting from a magnitude below 0.01 starts from 0.01.
 *
 * With `typeable`, double-clicking turns it into a text box: Enter or
 * clicking away commits, Escape cancels. Values below `min` are rejected.
 */
export function DragNumber({
  value,
  onChange,
  onDoubleClick,
  typeable = false,
  min = -Infinity,
}: {
  value: number;
  onChange(v: number): void;
  onDoubleClick?(): void;
  typeable?: boolean;
  min?: number;
}) {
  const [live, setLive] = useState(false);
  const [editing, setEditing] = useState(false);

  if (editing) {
    const commit = (text: string) => {
      const v = Number(text);
      if (text.trim() !== '' && Number.isFinite(v) && v >= min) onChange(v);
      setEditing(false);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') commit(e.currentTarget.value);
      if (e.key === 'Escape') setEditing(false);
    };
    return (
      <input
        className="num-input"
        autoFocus
        defaultValue={String(+value.toPrecision(6))}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKeyDown}
        onBlur={(e) => commit(e.currentTarget.value)}
      />
    );
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const base = (value < 0 ? -1 : 1) * Math.max(Math.abs(value), 0.01);
    el.setPointerCapture(e.pointerId);
    setLive(true);
    const move = (ev: PointerEvent) => onChange(base * Math.exp((ev.clientX - x0) / 100));
    const up = () => {
      setLive(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <span
      className={live ? 'num live' : 'num'}
      title={typeable ? 'drag to scale, double-click to type' : undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick ?? (typeable ? () => setEditing(true) : undefined)}
    >
      {fmt(value)}
    </span>
  );
}
