import { useState, type PointerEvent as ReactPointerEvent } from 'react';

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

/**
 * A number you drag sideways to scale: 1% per pixel, continuously, so 100px
 * left is a factor of 1/e. Multiplicative scaling can't leave zero, so a
 * drag starting from below 0.01 starts from 0.01.
 */
export function DragNumber({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [live, setLive] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const base = Math.max(value, 0.01);
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
    <span className={live ? 'num live' : 'num'} onPointerDown={onPointerDown}>
      {fmt(value)}
    </span>
  );
}
