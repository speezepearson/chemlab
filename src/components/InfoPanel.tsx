import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SPECIES, TARGET } from '../chem/species';
import type { Inspection } from '../game/engine';
import { fmtCount } from '../game/format';

const PIE = 176; // backing pixels; drawn at half size
const MAX_ROWS = 8;

/** God-mode readout for one vessel: temperature, fill, species pie and top species. */
export function InfoPanel({ info }: { info: Inspection }) {
  const ref = useRef<HTMLDivElement>(null);
  const pieRef = useRef<HTMLCanvasElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const total = info.rows.reduce((t, r) => t + r.atoms, 0);

  useEffect(() => {
    const pc = pieRef.current!.getContext('2d')!;
    const line = getComputedStyle(document.documentElement).getPropertyValue('--line').trim();
    const c = PIE / 2;
    pc.clearRect(0, 0, PIE, PIE);
    pc.strokeStyle = line;
    pc.lineWidth = 1.5;
    if (!info.rows.length) {
      pc.beginPath();
      pc.arc(c, c, c - 4, 0, Math.PI * 2);
      pc.stroke();
      return;
    }
    // a fixed order (singles, then pairs, then triples, counterclockwise from north), so sectors
    // don't jump around as amounts shift; the list beside it is what's sorted by amount
    const order = [...info.rows].sort((x, y) => SPECIES[x.species].size - SPECIES[y.species].size || x.species - y.species);
    let a0 = -Math.PI / 2;
    for (const { species, atoms } of order) {
      const a1 = a0 - (Math.PI * 2 * atoms) / total;
      pc.beginPath();
      pc.moveTo(c, c);
      pc.arc(c, c, c - 4, a0, a1, true);
      pc.closePath();
      pc.fillStyle = SPECIES[species].color;
      pc.fill();
      pc.stroke();
      a0 = a1;
    }
  }, [info, total]);

  useLayoutEffect(() => {
    const el = ref.current!;
    const { x0, x1, y, stageW: W, stageH: H } = info;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    let left = x1 + 8;
    let top = y - 10;
    if (left + pw > W - 6) left = x0 - pw - 8;
    if (left < 6) left = 6;
    if (top + ph > H - 6) top = H - 6 - ph;
    if (top < 6) top = 6;
    setPos({ left, top });
  }, [info]);

  return (
    <div id="info" ref={ref} style={pos}>
      <div className="hd">
        <span>T {info.T.toFixed(2)}</span>
        <span>
          {fmtCount(info.N)} / {fmtCount(info.cap)} atoms
        </span>
      </div>
      <div className="row">
        <canvas ref={pieRef} width={PIE} height={PIE} />
        <ul>
          {info.rows.slice(0, MAX_ROWS).map(({ species, atoms }) => (
            <li key={species}>
              <b>
                <i style={{ background: SPECIES[species].color }} />
                {SPECIES[species].name}
                {species === TARGET ? ' ✓' : ''}
              </b>
              <span>{Math.round((100 * atoms) / total)}%</span>
            </li>
          ))}
          {info.rows.length > MAX_ROWS && (
            <li>
              <b>+{info.rows.length - MAX_ROWS} more</b>
            </li>
          )}
          {!info.rows.length && (
            <li>
              <b>empty</b>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
