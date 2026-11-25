import { Fragment, useReducer, useState } from 'react';
import { LOOK, resetLook, type ColorModel, type Look } from '../game/appearance';
import { DEFAULT_FINISH, FINISH, setFinish } from '../game/finish';
import { DEFAULT_AIM, AIM, AIM_DEG, setAim } from '../game/aim';
import { DEFAULT_OUTLINE, MAX_OUTLINE_WIDTH, OUTLINE, setOutline } from '../game/outline';
import { DEFAULT_FITTINGS, FITTINGS, setFittings } from '../game/fittings';
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
 * how far off the crosshair what C, Q and E act on may be (see game/aim.ts), and how the clamp stands and hoses are
 * drawn (see game/fittings.ts).
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
                <b>Aim</b> <span>how far off the crosshair a spout, a hose's end, a handwheel or a dial may be for C, Q and E to act on it, in degrees</span>
              </td>
            </tr>
            <tr>
              <td>degrees</td>
              <td>
                <label className="slider">
                  <input
                    type="range"
                    aria-label="aim"
                    min={AIM_DEG.min}
                    max={AIM_DEG.max}
                    step={AIM_DEG.step}
                    value={AIM.deg}
                    onChange={(e) => {
                      setAim({ deg: +e.target.value });
                      rerender();
                    }}
                  />
                  <output>{AIM.deg}</output>
                </label>
              </td>
            </tr>
            <tr className="group">
              <td colSpan={2}>
                <b>Stands</b> <span>only how they look: a stand not drawn still needs its counter and its room</span>
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                <label className="tog">
                  <input
                    type="checkbox"
                    aria-label="draw clamp stands"
                    checked={FITTINGS.stands}
                    onChange={(e) => {
                      setFittings({ stands: e.target.checked });
                      rerender();
                    }}
                  />{' '}
                  draw them
                </label>
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                <label className="tog">
                  <input
                    type="checkbox"
                    aria-label="full-height clamp stands"
                    checked={FITTINGS.tall}
                    disabled={!FITTINGS.stands}
                    onChange={(e) => {
                      setFittings({ tall: e.target.checked });
                      rerender();
                    }}
                  />{' '}
                  full height, or else only as high as their clamps
                </label>
              </td>
            </tr>
            <tr className="group">
              <td colSpan={2}>
                <b>Hoses</b> <span>how opaque a hose's tube is, 0 not drawn to 1 solid; the fluid in it shows as ever</span>
              </td>
            </tr>
            <tr>
              <td>opacity</td>
              <td>
                <label className="slider">
                  <input
                    type="range"
                    aria-label="hose opacity"
                    min={0}
                    max={1}
                    step={0.05}
                    value={FITTINGS.hose}
                    onChange={(e) => {
                      setFittings({ hose: +e.target.value });
                      rerender();
                    }}
                  />
                  <output>{FITTINGS.hose}</output>
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
              setAim({ ...DEFAULT_AIM });
              setFittings({ ...DEFAULT_FITTINGS });
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
