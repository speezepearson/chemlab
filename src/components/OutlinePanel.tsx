import { useReducer } from 'react';
import { DEFAULT_OUTLINE, MAX_OUTLINE_WIDTH, OUTLINE, setOutline } from '../game/outline';

/** The outline round what the crosshair is on: its color and thickness, and a button to put them back. */
export function OutlinePanel() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const set = (o: Parameters<typeof setOutline>[0]) => {
    setOutline(o);
    rerender();
  };
  return (
    <details>
      <summary>Outline</summary>
      <div className="sound">
        <label className="slider">
          <span>color</span>
          <input type="color" value={OUTLINE.color} onChange={(e) => set({ color: e.target.value })} />
        </label>
        <label className="slider">
          <span>thickness</span>
          <input
            type="range"
            min={0}
            max={MAX_OUTLINE_WIDTH}
            step={0.5}
            value={OUTLINE.width}
            onChange={(e) => set({ width: +e.target.value })}
          />
          <output>{OUTLINE.width}</output>
        </label>
        <p>Thickness is in pixels; 0 draws no outline.</p>
        <div className="actions">
          <button onClick={() => set({ ...DEFAULT_OUTLINE })}>Restore defaults</button>
        </div>
      </div>
    </details>
  );
}
