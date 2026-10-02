import { useReducer } from 'react';
import { ATOMS } from '../chem/atoms';
import { ATOM_MASS, MIXING, restoreDefaultMixing, updateMasses } from '../chem/mixing';
import { COOLING, restoreDefaultCooling } from '../game/flask';
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

const COOL_ROWS: [label: string, key: keyof typeof COOLING, spec: Spec][] = [
  ['ambient T', 'ambient', { min: 0, max: 10 }],
  ['tau s', 'tau', { min: 1, max: 3600, log: true }],
];

/** God-mode sliders for how fluids layer (see MIXING in chem/mixing.ts), the atoms' masses, and cooling. */
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
        <p className="lead">
          <b>Cooling</b> Fluid heads for the ambient temperature, a full flask of single atoms by a factor e every{' '}
          <i>tau</i> seconds; time constants go as atoms / volume^⅔.
        </p>
        {COOL_ROWS.map(([label, key, spec]) => (
          <Slider key={key} label={label} value={COOLING[key]} spec={spec} onChange={(v) => edit(() => (COOLING[key] = v))} />
        ))}
        <div className="actions">
          <button
            onClick={() =>
              edit(() => {
                restoreDefaultMixing();
                restoreDefaultCooling();
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
