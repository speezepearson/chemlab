import { Fragment, useReducer, useState } from 'react';
import { LOOK, resetLook, type ColorModel, type Look } from '../game/appearance';
import { DEFAULT_FINISH, FINISH, setFinish } from '../game/finish';
import { DEFAULT_HOSE_AIM, HOSE_AIM, HOSE_DEG, setHoseAim } from '../game/hoseAim';
import { DEFAULT_OUTLINE, MAX_OUTLINE_WIDTH, OUTLINE, setOutline } from '../game/outline';
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
  ['paint', '1: paint', 'atoms multiply like paints, rescaled to the average\'s brightness; R–G olive, R–B purple', 'paintMix'],
  ['light', '2: light', 'atoms add like spotlights, clipped; R–G yellow, △RGB white', 'lightMix'],
];

const GROUPS: Group[] = [
  { title: 'Cold', formula: 'value = 1 − e^(−rate·T)', rows: [['rate', 'coldRate']] },
  {
    title: 'Whitening',
    formula: 's = min(1, ln(1+T) / ln(1+ref))^pow; fluid ← fluid·s',
    rows: [['ref', 'whiteRef'], ['pow', 'whitePow'], ['fluid', 'fluidWhite']],
  },
];

/**
 * Debug panel: live-tune the temperature appearance curves and how composition looks (see game/appearance.ts), and
 * the outline round what the crosshair is on (see game/outline.ts), how shiny the lab's metal is (see game/finish.ts),
 * and how far off the crosshair a spout may be for C to pull out its hose (see game/hoseAim.ts).
 */
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
                {numRow('α 3 or 4', 'alpha3')}
              </>
            )}
            <tr className="group">
              <td colSpan={2}>
                <b>Outline</b> <span>round the part the crosshair is on, and faintly round the whole thing; thickness in pixels, faint as a share of full strength, 0 for none</span>
              </td>
            </tr>
            <tr>
              <td>color</td>
              <td>
                <input
                  type="color"
                  aria-label="outline color"
                  value={OUTLINE.color}
                  onChange={(e) => {
                    setOutline({ color: e.target.value });
                    rerender();
                  }}
                />
              </td>
            </tr>
            <tr>
              <td>thickness</td>
              <td>
                <label className="slider">
                  <input
                    type="range"
                    aria-label="outline thickness"
                    min={0}
                    max={MAX_OUTLINE_WIDTH}
                    step={0.5}
                    value={OUTLINE.width}
                    onChange={(e) => {
                      setOutline({ width: +e.target.value });
                      rerender();
                    }}
                  />
                  <output>{OUTLINE.width}</output>
                </label>
              </td>
            </tr>
            <tr>
              <td>faint</td>
              <td>
                <label className="slider">
                  <input
                    type="range"
                    aria-label="faint outline opacity"
                    min={0}
                    max={1}
                    step={0.05}
                    value={OUTLINE.faint}
                    onChange={(e) => {
                      setOutline({ faint: +e.target.value });
                      rerender();
                    }}
                  />
                  <output>{OUTLINE.faint}</output>
                </label>
              </td>
            </tr>
            <tr className="group">
              <td colSpan={2}>
                <b>Finish</b> <span>how the lab's metal is finished: 0 matte, 1 mirror-smooth, 0.5 as built</span>
              </td>
            </tr>
            <tr>
              <td>metal</td>
              <td>
                <label className="slider">
                  <input
                    type="range"
                    aria-label="metal shine"
                    min={0}
                    max={1}
                    step={0.05}
                    value={FINISH.shine}
                    onChange={(e) => {
                      setFinish({ shine: +e.target.value });
                      rerender();
                    }}
                  />
                  <output>{FINISH.shine}</output>
                </label>
              </td>
            </tr>
            <tr className="group">
              <td colSpan={2}>
                <b>Hose aim</b> <span>how far off the crosshair a spout may be for C to pull out its hose, in degrees</span>
              </td>
            </tr>
            <tr>
              <td>degrees</td>
              <td>
                <label className="slider">
                  <input
                    type="range"
                    aria-label="hose aim"
                    min={HOSE_DEG.min}
                    max={HOSE_DEG.max}
                    step={HOSE_DEG.step}
                    value={HOSE_AIM.deg}
                    onChange={(e) => {
                      setHoseAim({ deg: +e.target.value });
                      rerender();
                    }}
                  />
                  <output>{HOSE_AIM.deg}</output>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Drag a number sideways to scale it. Try the Temperature range preset to see every temperature at once. Mix runs from 0 (current) to 1 (full model).
        </p>
        <div className="actions">
          <button
            onClick={() => {
              resetLook();
              setOutline({ ...DEFAULT_OUTLINE });
              setFinish({ ...DEFAULT_FINISH });
              setHoseAim({ ...DEFAULT_HOSE_AIM });
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
