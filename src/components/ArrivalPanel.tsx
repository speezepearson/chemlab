import { useReducer, useRef, useState } from 'react';
import { WAKE_S, ease } from '../game/airlock';
import { ARRIVAL, ARRIVAL_DEFAULTS } from '../game/view';

type Key = keyof typeof ARRIVAL;

/** Each setting, with what it's called here and how far its slider goes. */
const ROWS: [key: Key, label: string, max: number][] = [
  ['open', 'pod open', 1],
  ['void', 'void brightness', 40],
  ['bloom', 'bloom strength', 6],
  ['radius', 'bloom radius', 1],
  ['threshold', 'bloom threshold', 10],
  ['light', 'light from out front', 40],
  ['ambient', 'light all round', 20],
  ['exposure', 'exposure', 6],
];

/**
 * God mode's preview of the end (see GameEngine.previewArrival): sliders for how far open the pod is and how the white
 * void of Mu Ceti looks (see ARRIVAL), live; Play opens the pod as the end does.
 */
export function ArrivalPanel() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [copied, setCopied] = useState(false);
  const raf = useRef(0);
  const set = (k: Key, v: number) => {
    ARRIVAL[k] = v;
    rerender();
  };
  const play = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      set('open', ease(t / WAKE_S.open));
      if (t < WAKE_S.open) raf.current = requestAnimationFrame(step);
    };
    step();
  };
  const copy = async () => {
    const { open: _, ...look } = ARRIVAL;
    await navigator.clipboard.writeText(JSON.stringify(look));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="arrival-panel">
      <b>Mu Ceti preview</b> <span>= to leave</span>
      <table>
        <tbody>
          {ROWS.map(([k, label, max]) => (
            <tr key={k}>
              <td>{label}</td>
              <td>
                <input type="range" min={0} max={max} step="any" value={ARRIVAL[k]} onChange={(e) => set(k, +e.target.value)} />
              </td>
              <td>{ARRIVAL[k].toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="arrival-buttons">
        <button onClick={play}>Play</button>
        <button
          onClick={() => {
            Object.assign(ARRIVAL, ARRIVAL_DEFAULTS);
            rerender();
          }}
        >
          Defaults
        </button>
        <button onClick={copy}>{copied ? 'Copied' : 'Copy values'}</button>
      </div>
    </div>
  );
}
