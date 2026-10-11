import { it } from 'vitest';
import { flaskRadius, FLASK_H } from './flaskShape';
import { CAP } from './config';
import { SHAPES, TANK_H, TANK_CAP, SUMP_TIP, HOSE_CAP } from './tools';
it('vol', () => {
  let V = 0; const st = 0.01;
  for (let d = st / 2; d < FLASK_H; d += st) V += Math.PI * flaskRadius(d) ** 2 * st;
  const vpa = V / CAP;
  console.log('flask volume', V.toFixed(0));
  for (const [k, sh] of Object.entries(SHAPES)) {
    const tk = sh.tanks[0]; const w = tk.x1 - tk.x0; const H = sh.tankH ?? TANK_H; const cap = sh.tankCap ?? TANK_CAP;
    console.log(k, 'w', w, 'H', H, 'want', (cap * vpa).toFixed(0), 'per depth unit (box)', w * H);
  }
  console.log('hose want', HOSE_CAP * vpa, SUMP_TIP);
});
