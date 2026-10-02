import { describe, expect, it } from 'vitest';
import { defaultChemParams } from '../chem/params';
import { CAP } from './config';
import { Vessel } from './flask';
import { WASH_FEED, WASH_PRESET, applyFill } from './presets';
import { Route, formatLog, type StageReport } from './route';
import { TANK_CAP } from './tools';

/*
 * The intended route to the target, run on the default chemistry, with the
 * pot's contents printed after every stage (`npm run route` shows just this).
 * The assertions are loose: they only catch the route breaking outright. The
 * printed report is the point.
 */

describe('route', () => {
  it('builds △RGY from the old R–G and C–Y faucets', () => {
    const r = new Route(defaultChemParams());
    const pot = r.mix(...WASH_FEED.map(([rec, flasks]) => r.recipe(rec, flasks * CAP)));
    r.report('R–G + hot C–Y, mixed', pot);
    // held at T = 1, standing in for cooling it with the heat exchanger
    const heat = r.hold([pot], 120, 1);
    const built = r.report('held at T = 1 for 120 s', pot, heat);
    console.log(`Build (the wash preset starts from this mix, settled):\n${formatLog(r.log)}\n`);
    expect(built.top[0][0] === '△RGY' || built.top[1][0] === '△RGY').toBe(true);
  });

  it('washes it with blue in the wash preset', () => {
    // the preset's tools: a separator looped back on itself, hot blue dripping in, and a catch tank
    const [sepSpec, feedSpec] = WASH_PRESET.tools!;
    const tank = new Vessel(TANK_CAP);
    const feed = new Vessel(TANK_CAP);
    const caught = new Vessel(TANK_CAP);
    applyFill(tank, sepSpec.tanks![0]);
    applyFill(feed, feedSpec.tanks![0]);
    const r = new Route(defaultChemParams());
    r.report('start', tank);
    let best: StageReport | null = null;
    for (let i = 0; i < 6; i++) {
      r.strip(tank, { seconds: 100, valve: sepSpec.valves![0], feed, feedValve: feedSpec.valves![0], into: caught });
      const x = r.report(`after ${(i + 1) * 100} s`, tank);
      if (!best || x.target > best.target) best = x;
    }
    r.report('catch tank', caught);
    console.log(`Wash preset:\n${formatLog(r.log)}\n`);
    expect(best!.target).toBeGreaterThan(0.01 * CAP);
  }, 60_000);
});
