import { useEffect, useReducer } from 'react';
import { NS, SPECIES, TARGET } from '../chem/species';
import type { GameEngine } from '../game/engine';
import { DragNumber } from './DragNumber';

/** Smallest molecule count worth listing; reactions leave dust below this. */
const SHOWN = 0.005;
const ADDED = 10;

/**
 * God-mode editor for one flask's temperature and composition. The flask
 * keeps reacting while this is open, so the numbers update live.
 */
export function FlaskEditor({ engine, index, onClose }: { engine: GameEngine; index: number; onClose(): void }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const id = setInterval(rerender, 100);
    return () => clearInterval(id);
  }, []);

  const f = engine.flaskAt(index);
  if (!f) return null;

  const present = SPECIES.filter((s) => f.n[s.i] >= SHOWN);
  const absent = SPECIES.filter((s) => f.n[s.i] < SHOWN);
  const edit = (apply: () => void) => {
    apply();
    rerender();
  };

  return (
    <div id="editor" onPointerDown={(e) => e.stopPropagation()}>
      <div className="hd">
        <b>
          Flask {index + 1}
          {f.label ? ` (${f.label})` : ''}
        </b>
        <button aria-label="close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="line">
        <span>T</span>
        <DragNumber typeable min={0} value={f.T} onChange={(v) => edit(() => (f.T = Math.max(0, v)))} />
        <span className="muted">
          {Math.round(f.N)} / {f.cap} atoms
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>species</th>
            <th>molecules</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {present.map((s) => (
            <tr key={s.i}>
              <td>
                <i style={{ background: s.color }} />
                {s.name}
                {s.i === TARGET ? ' ✓' : ''}
              </td>
              <td>
                <DragNumber typeable min={0} value={f.n[s.i]} onChange={(v) => edit(() => f.setMolecules(s.i, v))} />
              </td>
              <td>
                <button aria-label={`remove ${s.name}`} onClick={() => edit(() => f.setMolecules(s.i, 0))}>
                  ×
                </button>
              </td>
            </tr>
          ))}
          {!present.length && (
            <tr>
              <td className="muted" colSpan={3}>
                empty
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="line">
        <select
          aria-label="add species"
          value=""
          onChange={(e) => edit(() => f.setMolecules(+e.target.value, ADDED))}
          disabled={f.N >= f.cap}
        >
          <option value="" disabled>
            + add species…
          </option>
          {absent.map((s) => (
            <option key={s.i} value={s.i}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={() => edit(() => { for (let s = 0; s < NS; s++) f.setMolecules(s, 0); })}>Empty</button>
      </div>
      <p className="muted">Drag a number to scale it, or double-click to type. The flask keeps reacting while you edit.</p>
    </div>
  );
}
