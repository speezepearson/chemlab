import { Fragment, useReducer, useState } from 'react';
import { LOOK, resetLook, type ColorModel, type Look } from '../game/appearance';
import { DragNumber } from './DragNumber';

/** The numeric settings in Look, the ones a DragNumber can edit. */
type NumKey = { [K in keyof Look]: Look[K] extends number ? K : never }[keyof Look];

interface Group {
  title: string;
  formula: string;
  rows: [label: string, key: NumKey][];
}

const MODELS: [model: ColorModel, label: string, formula: string, mix?: NumKey][] = [
  ['atoms', 'current', 'a molecule is the average of its atoms, so reactions never change a fluid\'s color'],
  ['paint', '1: paint', 'atoms multiply like paints, rescaled to the average\'s brightness; C–Y green, M–Y red', 'paintMix'],
  ['light', '2: light', 'atoms add like spotlights, clipped; R–G yellow, △RGB white', 'lightMix'],
];

const GROUPS: Group[] = [
  { title: 'Cold', formula: 'value = 1 − e^(−rate·T)', rows: [['rate', 'coldRate']] },
  { title: 'Glow strength', formula: 'g = ln(1+T) / ln(1+ref)', rows: [['ref', 'glowRef']] },
  {
    title: 'Whitening',
    formula: 's = min(1, ln(1+T) / ln(1+ref))^pow; fluid ← fluid·s, glow color ← glow·s',
    rows: [['ref', 'whiteRef'], ['pow', 'whitePow'], ['fluid', 'fluidWhite'], ['glow', 'glowWhite']],
  },
  {
    title: 'Corona',
    formula: 'α = min(max, gain·g), r = r₀ + r₁·g',
    rows: [['gain', 'coronaGain'], ['max', 'coronaMax'], ['r₀', 'coronaR0'], ['r₁', 'coronaR1'], ['sharpness', 'coronaSharpness']],
  },
  {
    title: 'Halo',
    formula: 'α = min(max, lin·g + quad·g²), r = r₀ + r₁·g^pow',
    rows: [
      ['lin', 'haloLin'], ['quad', 'haloQuad'], ['max', 'haloMax'],
      ['r₀', 'haloR0'], ['r₁', 'haloR1'], ['pow', 'haloPow'], ['sharpness', 'haloSharpness'],
    ],
  },
];

/** Debug panel: live-tune the temperature appearance curves and how composition looks (see game/appearance.ts). */
export function AppearancePanel() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const numRow = (label: string, key: NumKey) => (
    <tr key={key}>
      <td>{label}</td>
      <td>
        <DragNumber
          value={LOOK[key]}
          onChange={(v) => {
            LOOK[key] = v;
            rerender();
          }}
        />
      </td>
    </tr>
  );
  const model = MODELS.find(([m]) => m === LOOK.colorModel)!;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(LOOK, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <details>
      <summary>Appearance</summary>
      <div className="wide">
        <table>
          <tbody>
            {GROUPS.map((g) => (
              <Fragment key={g.title}>
                <tr className="group">
                  <td colSpan={2}>
                    <b>{g.title}</b> <span>{g.formula}</span>
                  </td>
                </tr>
                {g.rows.map(([label, key]) => numRow(label, key))}
              </Fragment>
            ))}
            <tr className="group">
              <td colSpan={2}>
                <b>Color</b> <span>{model[2]}; a fluid is the atom-weighted average of its molecules</span>
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                {MODELS.map(([m, label]) => (
                  <label key={m} className="tog">
                    <input
                      type="radio"
                      name="color-model"
                      checked={LOOK.colorModel === m}
                      onChange={() => {
                        LOOK.colorModel = m;
                        rerender();
                      }}
                    />{' '}
                    {label}
                  </label>
                ))}
              </td>
            </tr>
            {model[3] && numRow('mix', model[3])}
            <tr className="group">
              <td colSpan={2}>
                <label className="tog">
                  <input
                    type="checkbox"
                    checked={LOOK.cloudy}
                    onChange={(e) => {
                      LOOK.cloudy = e.target.checked;
                      rerender();
                    }}
                  />{' '}
                  <b>Cloudiness</b>
                </label>{' '}
                <span>opacity = atom-weighted average of α by molecule size</span>
              </td>
            </tr>
            {LOOK.cloudy && (
              <>
                {numRow('α single', 'alpha1')}
                {numRow('α pair', 'alpha2')}
                {numRow('α triple', 'alpha3')}
              </>
            )}
          </tbody>
        </table>
        <p>
          Drag a number sideways to scale it. Try the Temperature range preset to see every temperature at once, and
          the Wash route preset to see color change as it reacts. Mix runs from 0 (current) to 1 (full model).
        </p>
        <div className="actions">
          <button
            onClick={() => {
              resetLook();
              rerender();
            }}
          >
            Restore defaults
          </button>
          <button onClick={copy}>{copied ? 'Copied' : 'Copy values'}</button>
        </div>
      </div>
    </details>
  );
}
