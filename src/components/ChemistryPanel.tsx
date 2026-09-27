import { useReducer } from 'react';
import { T_ROOM, type BondParams } from '../chem/params';
import type { ReactionNetwork } from '../chem/reactions';
import { SPECIES, TARGET } from '../chem/species';
import { DragNumber } from './DragNumber';

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
                    <DragNumber value={b[f]} onChange={(v) => edit(() => (b[f] = v))} />
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
                <DragNumber value={p.heatCap} onChange={(v) => edit(() => (p.heatCap = v))} />
              </td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
        <p>
          Drag a number sideways to scale it. Target: {SPECIES[TARGET].name}, T_room = {T_ROOM}.
        </p>
      </div>
    </details>
  );
}
