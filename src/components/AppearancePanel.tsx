import { Fragment, useReducer, useState } from 'react';
import { LOOK, resetLook, type Look } from '../game/appearance';
import { DragNumber } from './DragNumber';

interface Group {
  title: string;
  formula: string;
  rows: [label: string, key: keyof Look][];
}

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

/** Debug panel: live-tune the temperature appearance curves (see game/appearance.ts). */
export function AppearancePanel() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
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
                {g.rows.map(([label, key]) => (
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
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        <p>
          Drag a number sideways to scale it. Try the Temperature range preset to see every temperature at once.
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
