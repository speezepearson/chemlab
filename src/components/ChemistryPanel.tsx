import { useReducer } from 'react';
import { THERMO, T_ROOM, restoreDefaultChem, type BondParams } from '../chem/params';
import type { ReactionNetwork } from '../chem/reactions';
import { SPECIES, TARGET } from '../chem/species';
import { VOLUME } from '../game/flask';
import { CAP } from '../game/config';
import { COOLING, restoreDefaultCooling } from '../game/cooling';
import {
  DRIP, HEATER, METER, SEPARATOR, SORTER, restoreDefaultDrip, restoreDefaultHeater, restoreDefaultMeter,
  restoreDefaultSeparator, restoreDefaultSorter, SEPARATOR_PERFECT, separatorShares, sorterShares,
} from '../game/tools';
import { DragNumber } from './DragNumber';

const FIELDS: (keyof BondParams)[] = ['E', 'Ea', 'A'];

/** A row of the table with one live-editable number in it. */
function NumberRow({ label, value, min, onChange }: { label: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <tr>
      <td>{label}</td>
      <td>
        <DragNumber typeable min={min} value={value} onChange={onChange} />
      </td>
      <td />
      <td />
    </tr>
  );
}

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
            <tr className="group">
              <td colSpan={4}>
                <b>Resistive heater</b> <span>fluid closes 1 − e^(−rate·t) of the gap to the wire; the wire is maxT^dial</span>
              </td>
            </tr>
            <NumberRow label="feed, flasks/s" min={0} value={HEATER.feed / CAP} onChange={(v) => edit(() => (HEATER.feed = v * CAP))} />
            <NumberRow label="transit, s" min={0.01} value={HEATER.transit} onChange={(v) => edit(() => (HEATER.transit = v))} />
            <NumberRow label="heating rate, /s" min={0} value={HEATER.rate} onChange={(v) => edit(() => (HEATER.rate = v))} />
            <NumberRow label="max wire T" min={1} value={HEATER.maxT} onChange={(v) => edit(() => (HEATER.maxT = v))} />
            <tr className="group">
              <td colSpan={4}>
                <b>Cooling</b> <span>each second, fluid closes 1 − e^(−rate·exposure) of the gap to ambient</span>
              </td>
            </tr>
            <NumberRow label="rate" min={0} value={COOLING.rate} onChange={(v) => edit(() => (COOLING.rate = v))} />
            <NumberRow label="ambient T" min={0} value={COOLING.ambient} onChange={(v) => edit(() => (COOLING.ambient = v))} />
            <tr className="group">
              <td colSpan={4}>
                <b>Separator</b> <span>a molecule goes to outlet j ∝ e^(−sharpness·(j − its own)²)</span>
              </td>
            </tr>
            <tr>
              <td colSpan={4}>
                <label className="slider" title="0 splits everything evenly five ways; higher sorts more cleanly, and the top is perfect">
                  <span>sharpness</span>
                  <input
                    type="range"
                    min={0}
                    max={SEPARATOR_PERFECT}
                    step={0.1}
                    value={Math.min(SEPARATOR_PERFECT, SEPARATOR.sharpness)}
                    onChange={(e) => edit(() => (SEPARATOR.sharpness = +e.target.value))}
                  />
                  <output>{SEPARATOR.sharpness.toFixed(1)}</output>
                </label>
                <span>
                  {' '}
                  middle outlets keep {(100 * separatorShares()[2][2]).toFixed(1)}%, ends {(100 * separatorShares()[0][0]).toFixed(1)}%
                </span>
              </td>
            </tr>
            <tr className="group">
              <td colSpan={4}>
                <b>Size sorter</b> <span>from 0, an even three-way split, to 1, every size out its own spout</span>
              </td>
            </tr>
            <tr>
              <td colSpan={4}>
                <label className="slider" title="0 splits every size evenly among the spouts; 1 sorts perfectly">
                  <span>strength</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={SORTER.strength}
                    onChange={(e) => edit(() => (SORTER.strength = +e.target.value))}
                  />
                  <output>{SORTER.strength.toFixed(2)}</output>
                </label>
                <span> each size goes {(100 * sorterShares()[0][0]).toFixed(1)}% out its own spout</span>
              </td>
            </tr>
            <tr className="group">
              <td colSpan={4}>
                <b>Flow meter</b> <span>its reading closes 1 − e^(−t/τ) of the gap to a new flow in t seconds</span>
              </td>
            </tr>
            <NumberRow label="averaging τ, s" min={0.001} value={METER.tau} onChange={(v) => edit(() => (METER.tau = v))} />
          </tbody>
        </table>
        <p>
          Drag a number sideways to scale it; double-click a bond energy to flip its sign, or any other number to type
          it (0 included). Target: {SPECIES[TARGET].name}, T_room = {T_ROOM}.
        </p>
        <div className="actions">
          <button
            onClick={() =>
              edit(() => {
                restoreDefaultChem(p);
                VOLUME.molecules = true;
                restoreDefaultDrip();
                restoreDefaultHeater();
                restoreDefaultCooling();
                restoreDefaultMeter();
                restoreDefaultSeparator();
                restoreDefaultSorter();
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
