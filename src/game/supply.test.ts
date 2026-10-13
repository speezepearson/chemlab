import { describe, expect, it } from 'vitest';
import { CONSUMPTION, SUPPLY, Supply, supplyText } from './supply';

/** Run a supply for `secs` sim seconds in steps of h, adding `added(t)` and drawing `drawn(t)` at each step's end. */
function run(s: Supply, secs: number, added: (t: number) => number, drawn: (t: number) => number = () => 0, h = 0.02) {
  for (let i = 1; i <= Math.round(secs / h); i++) s.record(h, added(i * h), drawn(i * h));
  return s;
}

/** A drop of `n` every `every` sim seconds, at the step ending on it. */
const drops = (n: number, every: number) => (t: number) => (Math.abs(t / every - Math.round(t / every)) < 1e-6 ? n : 0);

describe('supply', () => {
  it('keeps up once a steady flow has run for its window, and not before', () => {
    const s = run(new Supply(), SUPPLY.window - 0.1, () => 1e6);
    expect(s.flowing).toBe(true);
    expect(s.keepingUp).toBe(false);
    run(s, 0.2, () => 1e6);
    expect(s.keepingUp).toBe(true);
  });

  it('counts drops as a flow, as long as no gap between them is longer than its limit', () => {
    // the run starts with the first drop
    const s = run(new Supply(), SUPPLY.window + SUPPLY.gap, drops(5e5, SUPPLY.gap - 0.1));
    expect(s.keepingUp).toBe(true);
    const t = run(new Supply(), SUPPLY.window + SUPPLY.gap, drops(5e5, SUPPLY.gap + 0.1));
    expect(t.keepingUp).toBe(false);
    expect(t.run).toBeLessThan(SUPPLY.gap + 0.2);
  });

  it('stops once nothing has gone in for longer than the gap, and starts its run over', () => {
    const s = run(new Supply(), SUPPLY.window + 1, () => 1e6);
    run(s, SUPPLY.gap - 0.1, () => 0);
    expect(s.keepingUp).toBe(true);
    run(s, 0.2, () => 0);
    expect(s.flowing).toBe(false);
    expect(s.keepingUp).toBe(false);
    expect(s.run).toBe(0);
    run(s, SUPPLY.window / 2, () => 1e6);
    expect(s.keepingUp).toBe(false);
  });

  it('needs at least what the passengers use, net of what was let out of the reservoir', () => {
    const per = CONSUMPTION * 0.02;
    expect(run(new Supply(), SUPPLY.window + 1, () => 1.01 * per).keepingUp).toBe(true);
    expect(run(new Supply(), SUPPLY.window + 1, () => 0.99 * per).keepingUp).toBe(false);
    // pouring the reservoir's own faucet back into its funnel adds nothing
    expect(run(new Supply(), SUPPLY.window + 1, () => 1e6, () => 1e6).keepingUp).toBe(false);
  });

  it('only counts the last window toward the net', () => {
    const s = run(new Supply(), SUPPLY.window, () => 1e6);
    run(s, SUPPLY.window + 0.1, () => 1);
    expect(s.net).toBeCloseTo(SUPPLY.window / 0.02, -1);
  });

  it("says how it stands on the station's screen", () => {
    const s = new Supply();
    expect(supplyText(s)).toBe('SUPPLY: NONE');
    run(s, 23.5, () => 1e6);
    expect(supplyText(s)).toBe('SUPPLY: STEADY 0:23 / 1:00');
    run(s, SUPPLY.window, () => 1e6);
    expect(supplyText(s)).toBe('SUPPLY: SUSTAINED');
    expect(supplyText(run(new Supply(), SUPPLY.window + 1, () => 1, () => 1))).toBe('SUPPLY: TOO SLOW');
  });
});
