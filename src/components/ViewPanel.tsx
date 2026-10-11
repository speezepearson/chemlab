import { useReducer } from 'react';
import { DEFAULT_SIGHT, FOV_RANGE, PORT_MAX, SIGHT, storeSight } from '../game/sight';

/** Steps along the porthole's slider, from nothing to as much of the wall as it can take. */
const PORT_STEPS = 200;

/** Sliders for the field of view and the porthole's size (see SIGHT), and a button to put them back. */
export function ViewPanel() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const set = (apply: () => void) => {
    apply();
    storeSight();
    rerender();
  };
  return (
    <details>
      <summary>View</summary>
      <div className="sight">
        <label className="slider">
          <span>field of view</span>
          <input
            type="range"
            min={FOV_RANGE.min}
            max={FOV_RANGE.max}
            value={Math.round(SIGHT.fov)}
            onChange={(e) => set(() => (SIGHT.fov = +e.target.value))}
          />
          <output>{Math.round(SIGHT.fov)}°</output>
        </label>
        <label className="slider">
          <span>porthole</span>
          <input
            type="range"
            min={0}
            max={PORT_STEPS}
            value={Math.round((PORT_STEPS * SIGHT.port) / PORT_MAX)}
            onChange={(e) => set(() => (SIGHT.port = (+e.target.value / PORT_STEPS) * PORT_MAX))}
          />
          <output>{(100 * SIGHT.port).toFixed(SIGHT.port < 0.1 ? 1 : 0)}%</output>
        </label>
        <p>The field of view is top to bottom. The porthole is how much of the left wall it takes up.</p>
        <div className="actions">
          <button onClick={() => set(() => Object.assign(SIGHT, DEFAULT_SIGHT))}>Restore defaults</button>
        </div>
      </div>
    </details>
  );
}
