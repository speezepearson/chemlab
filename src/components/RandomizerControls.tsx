import { useReducer } from 'react';
import { DISTS, PINNED_E, type Dist, type DistKind, type DistParam } from '../chem/randomize';
import { fmt } from './DragNumber';

const STEPS = 1000;

/** A slider for one number, linear or logarithmic between min and max, with its value beside it. */
function Slider({ label, value, spec, onChange }: { label: string; value: number; spec: DistParam; onChange(v: number): void }) {
  const { min, max, log } = spec;
  const toPos = (v: number) =>
    Math.round(STEPS * (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)));
  const fromPos = (pos: number) => {
    const u = pos / STEPS;
    const v = log ? min * (max / min) ** u : min + u * (max - min);
    return Number(v.toPrecision(3));
  };
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={STEPS}
        value={Math.max(0, Math.min(STEPS, toPos(value)))}
        onChange={(e) => onChange(fromPos(+e.target.value))}
      />
      <output>{fmt(value)}</output>
    </label>
  );
}

const FLIP: DistParam = { key: 'flip', label: 'P(negate)', min: 0, max: 1 };

/** Choose a distribution and set its parameters, and the chance of negating each draw. */
function DistControl({ title, dist, onChange }: { title: string; dist: Dist; onChange(): void }) {
  return (
    <fieldset className="dist">
      <legend>
        {title} ~{' '}
        <select
          value={dist.kind}
          onChange={(e) => {
            dist.kind = e.target.value as DistKind;
            onChange();
          }}
        >
          {Object.entries(DISTS).map(([k, d]) => (
            <option key={k} value={k}>
              {d.name}
            </option>
          ))}
        </select>{' '}
        × ±1
      </legend>
      {DISTS[dist.kind].params.map((spec) => (
        <Slider
          key={spec.key}
          label={spec.label}
          value={dist.p[spec.key]}
          spec={spec}
          onChange={(v) => {
            dist.p[spec.key] = v;
            onChange();
          }}
        />
      ))}
      <Slider
        label={FLIP.label}
        value={dist.flip}
        spec={FLIP}
        onChange={(v) => {
          dist.flip = v;
          onChange();
        }}
      />
    </fieldset>
  );
}

/** The randomizer's settings: a distribution each for bond energies and activation energies. */
export function RandomizerControls({ E, Ea }: { E: Dist; Ea: Dist }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  return (
    <div className="randomizer">
      <DistControl title="E" dist={E} onChange={rerender} />
      <DistControl title="Ea" dist={Ea} onChange={rerender} />
      <p>Each bond's E and Ea is drawn independently, then negated with probability P(negate). E stays {PINNED_E.RB} for every bond to B, and {PINNED_E.RG} for R–G.</p>
    </div>
  );
}
