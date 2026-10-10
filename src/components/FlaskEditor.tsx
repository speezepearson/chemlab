import { useEffect, useReducer, useState } from 'react';
import { temperature } from '../chem/reactions';
import { NS, SPECIES, TARGET } from '../chem/species';
import { CAP } from '../game/config';
import type { GameEngine } from '../game/engine';
import { volume, volumeUnit } from '../game/flask';
import { fmtCount } from '../game/format';
import { DragNumber } from './DragNumber';
import { MAX_LABEL } from './LabelEditor';

/** Molecules of a species added from the "add species" menu. */
const ADDED = CAP / 30;
/** The most reactions listed at once; the rest are only counted. */
const REACTIONS_SHOWN = 15;
/** Whether the reactions list is showing, kept from one opening of the editor to the next. */
let reactionsOn = false;

const side = (species: number[]) => species.map((s) => SPECIES[s].name).join(' + ');
/** A molecule count in full, every digit: 1,234,567. */
const exact = (n: number) => n.toLocaleString('en');

/**
 * God-mode editor for one vessel's temperature and composition: a flask or a
 * tool's tank. The vessel keeps reacting while this is open, so the numbers
 * update live.
 */
export function FlaskEditor({ engine, id, onClose }: { engine: GameEngine; id: string; onClose(): void }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [showReactions, setShowReactions] = useState(reactionsOn);

  useEffect(() => {
    const id = setInterval(rerender, 100);
    return () => clearInterval(id);
  }, []);

  const found = engine.vessel(id);
  if (!found) return null;
  const f = found.vessel;

  // every species there is, down to a single molecule
  const present = SPECIES.filter((s) => f.n[s.i] > 0);
  const absent = SPECIES.filter((s) => f.n[s.i] <= 0);
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
        <span>label</span>
        <input
          value={f.label}
          maxLength={MAX_LABEL}
          placeholder="none"
          aria-label="label"
          onChange={(e) => edit(() => (f.label = e.target.value))}
        />
      </div>
      <div className="line">
        <span>T</span>
        <DragNumber typeable min={0} value={temperature(f)} onChange={(v) => edit(() => f.setTemperature(v))} />
        <span className="muted">
          {fmtCount(volume(f))} / {fmtCount(f.cap)} {volumeUnit()}
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
                <DragNumber
                  typeable
                  min={0}
                  value={f.n[s.i]}
                  format={exact}
                  onChange={(v) => edit(() => f.setMolecules(s.i, v))}
                />
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
          disabled={volume(f) >= f.cap}
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
      <div className="line">
        <button
          title="react to full equilibrium at this temperature, at once"
          disabled={!f.N}
          onClick={() => edit(() => engine.equilibrate(id))}
        >
          Equilibrate
        </button>
        <button
          aria-pressed={showReactions}
          className={showReactions ? 'on' : undefined}
          onClick={() => setShowReactions((reactionsOn = !showReactions))}
        >
          Reactions
        </button>
      </div>
      {showReactions && <Reactions engine={engine} id={id} />}
      <p className="muted">Drag a number to scale it, or double-click to type. It keeps reacting while you edit. Equilibrate runs every reaction to its end at once, even ones too slow ever to happen. Reactions lists what's reacting, each net of its reverse, in events per sim second.</p>
    </div>
  );
}

/** What's reacting in the vessel right now, busiest first, each net of its reverse, in events per sim second. */
function Reactions({ engine, id }: { engine: GameEngine; id: string }) {
  const all = engine.reactions(id);
  return (
    <table className="rx">
      <thead>
        <tr>
          <th>reaction</th>
          <th>per s</th>
        </tr>
      </thead>
      <tbody>
        {all.slice(0, REACTIONS_SHOWN).map((r) => (
          <tr key={`${r.from}>${r.to}`}>
            <td>
              {side(r.from)} → {side(r.to)}
            </td>
            <td>{fmtCount(r.rate)}</td>
          </tr>
        ))}
        {all.length > REACTIONS_SHOWN && (
          <tr>
            <td className="muted" colSpan={2}>
              and {all.length - REACTIONS_SHOWN} more
            </td>
          </tr>
        )}
        {!all.length && (
          <tr>
            <td className="muted" colSpan={2}>
              nothing
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
