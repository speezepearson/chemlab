import { useReducer } from 'react';
import { ATOMS } from '../chem/atoms';
import { ATOM_MASS, MIXING, restoreDefaultMixing, updateMasses } from '../chem/mixing';
import type { DistParam } from '../chem/randomize';
import { Slider } from './RandomizerControls';

type Spec = Pick<DistParam, 'min' | 'max' | 'log'>;

const MIX_ROWS: [label: string, key: keyof typeof MIXING, spec: Spec][] = [
  ['color', 'color', { min: 0, max: 4 }],
  ['openness', 'open', { min: 0, max: 4 }],
  ['rate /s', 'rate', { min: 0.1, max: 100, log: true }],
  ['gravity', 'gravity', { min: 0, max: 0.5 }],
  ['calm s', 'calm', { min: 0.1, max: 10, log: true }],
  ['churn', 'churn', { min: 0, max: 5 }],
];

const MASS: Spec = { min: 0.25, max: 2 };

/** God-mode sliders for how fluids layer (see MIXING in chem/mixing.ts) and the atoms' masses. */
export function PhysicsPanel() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const edit = (apply: () => void) => {
    apply();
    rerender();
  };
  return (
    <details>
      <summary>Physics</summary>
      <div className="wide">
        <p className="lead">
          <b>Mixing</b> A molecule escapes a layer as e^((color·|Δcolor|² + openness·Δopen²) / T); neighboring layers
          trade a share <i>rate</i> of the smaller per second, biased e^(∓gravity·density). Landing fluid stirs a layer
          by <i>churn</i> × its volume over the layer's, and stirring dies down by e every <i>calm</i> seconds.
        </p>
        {MIX_ROWS.map(([label, key, spec]) => (
          <Slider key={key} label={label} value={MIXING[key]} spec={spec} onChange={(v) => edit(() => (MIXING[key] = v))} />
        ))}
        <p className="lead">
          <b>Atom masses</b> A layer's density is its mass per unit of volume, and the scale weighs mass.
        </p>
        {ATOMS.map((a) => (
          <Slider
            key={a}
            label={a}
            value={ATOM_MASS[a]}
            spec={MASS}
            onChange={(v) =>
              edit(() => {
                ATOM_MASS[a] = v;
                updateMasses();
              })
            }
          />
        ))}
        <div className="actions">
          <button onClick={() => edit(restoreDefaultMixing)}>Restore defaults</button>
        </div>
      </div>
    </details>
  );
}
