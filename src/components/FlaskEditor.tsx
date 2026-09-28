import { useEffect, useReducer } from 'react';
import { temperature } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { CAP } from '../game/config';
import type { GameEngine } from '../game/engine';
import { fmtCount } from '../game/format';
import { DragNumber } from './DragNumber';

/** Smallest molecule count worth listing; reactions leave dust below this. */
const SHOWN = CAP * 1e-5;
/** Molecules of a species added from the "add species" menu. */
const ADDED = CAP / 30;

/**
 * God-mode editor for one vessel's temperature and composition: a flask or a
 * tool's tank. The vessel keeps reacting while this is open, so the numbers
 * update live.
 */
export function FlaskEditor({ engine, id, onClose }: { engine: GameEngine; id: string; onClose(): void }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const id = setInterval(rerender, 100);
    return () => clearInterval(id);
  }, []);

  const found = engine.vessel(id);
  if (!found) return null;
  const f = found.vessel;

  const present = SPECIES.filter((s) => f.n[s.i] >= SHOWN);
  const absent = SPECIES.filter((s) => f.n[s.i] < SHOWN);
  const edit = (apply: () => void) => {
    apply();
    rerender();
  };

  return (
    <div id="editor" onPointerDown={(e) => e.stopPropagation()}>
      <div className="hd">
        <b>{found.title}</b>
        <button aria-label="close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="line">
        <span>T</span>
        <DragNumber typeable min={0} value={temperature(f)} onChange={(v) => edit(() => f.setTemperature(v))} />
        <span className="muted">
          {fmtCount(f.N)} / {fmtCount(f.cap)} atoms
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
      <p className="muted">Drag a number to scale it, or double-click to type. It keeps reacting while you edit.</p>
    </div>
  );
}
