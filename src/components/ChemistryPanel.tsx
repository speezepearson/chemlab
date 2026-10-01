import { useReducer } from 'react';
import { THERMO, T_ROOM, restoreDefaultChem, type BondParams } from '../chem/params';
import { RANDOMIZER, randomizeBonds } from '../chem/randomize';
import type { ReactionNetwork } from '../chem/reactions';
import { SPECIES, TARGET } from '../chem/species';
import { VOLUME } from '../game/flask';
import { DRIP, restoreDefaultDrip } from '../game/tools';
import { DragNumber } from './DragNumber';
import { RandomizerControls } from './RandomizerControls';

const FIELDS: (keyof BondParams)[] = ['E', 'Ea', 'A'];

/** Live-editable parameter table. Edits mutate the params and rebuild all reactions. */
export function ChemistryPanel({ network }: { network: ReactionNetwork }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const p = network.params;
  const edit = (apply: () => void) => {
    apply();
    network.rebuild();
    rerender();
  };

  return (
    <details>
      <summary>Chemistry</summary>
      <div>
        <table>
          <thead>
            <tr>
              <th>bond</th>
              {FIELDS.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(p.bonds).map(([k, b]) => (
              <tr key={k}>
                <td>
                  {k[0]}–{k[1]}
                </td>
                {FIELDS.map((f) => (
                  <td key={f}>
                    <DragNumber
                      value={b[f]}
                      onChange={(v) => edit(() => (b[f] = v))}
                      onDoubleClick={f === 'E' ? () => edit(() => (b.E = -b.E)) : undefined}
                      typeable={f !== 'E'}
                      min={0}
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="sep">
              <td>swap A</td>
              <td>
                <DragNumber value={p.swapA} onChange={(v) => edit(() => (p.swapA = v))} />
              </td>
              <td />
              <td />
            </tr>
            <tr>
              <td>heat capacity</td>
              <td>
                <DragNumber value={THERMO.heatCap} onChange={(v) => edit(() => (THERMO.heatCap = v))} />
              </td>
              <td />
              <td />
            </tr>
            <tr>
              <td colSpan={4}>
                <label className="tog" title="Capacity, fill level, pouring and flow count molecules instead of atoms">
                  <input
                    type="checkbox"
                    checked={VOLUME.molecules}
                    onChange={(e) => edit(() => (VOLUME.molecules = e.target.checked))}
                  />{' '}
                  volume counts molecules, not atoms
                </label>
              </td>
            </tr>
            <tr className="group">
              <td colSpan={4}>
                <b>Dripping</b> <span>a hanging drop falls at e^((atoms − size) / spread) per second</span>
              </td>
            </tr>
            <tr>
              <td>drop size</td>
              <td>
                <DragNumber typeable min={0} value={DRIP.atoms} onChange={(v) => edit(() => (DRIP.atoms = v))} />
              </td>
              <td />
              <td />
            </tr>
            <tr>
              <td>spread</td>
              <td>
                <DragNumber typeable min={1} value={DRIP.spread} onChange={(v) => edit(() => (DRIP.spread = v))} />
              </td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
        <p>
          Drag a number sideways to scale it; double-click a bond energy to flip its sign, or any other number to type
          it (0 included). Target: {SPECIES[TARGET].name}, T_room = {T_ROOM}.
        </p>
        <RandomizerControls E={RANDOMIZER.E} Ea={RANDOMIZER.Ea} />
        <div className="actions">
          <button onClick={() => edit(() => randomizeBonds(p, RANDOMIZER.E, RANDOMIZER.Ea))}>Randomize E, Ea</button>
          <button
            onClick={() =>
              edit(() => {
                restoreDefaultChem(p);
                VOLUME.molecules = false;
                restoreDefaultDrip();
              })
            }
          >
            Restore defaults
          </button>
        </div>
      </div>
    </details>
  );
}
