import { CAP, FLASK_L, VOYAGE } from './config';

/**
 * How the ship judges the flow of cryostabilizer into its reservoir, in sim seconds: it keeps up once it's run for
 * `window` with no gap between deliveries longer than `gap`, and has added at least CONSUMPTION over the last
 * `window`.
 */
export const SUPPLY = { window: 60, gap: 2 };

/**
 * What the passengers asleep use, in molecules of the target per sim second: the intro's sum, a day's worth (passengers
 * × mL a day each) over a day's seconds. It's tiny: about 460 molecules a second, where a drop is about half a million.
 */
export const CONSUMPTION = ((VOYAGE.passengers * VOYAGE.mlPerPassengerDay) / 1000 / FLASK_L) * (CAP / 86_400);

/**
 * The flow of the target into the cryostabilizer reservoir (see Tool.receive), step by step, for the ship to judge
 * whether it keeps up with what the passengers use (see SUPPLY).
 */
export class Supply {
  /** Sim seconds since the target last went in. */
  since = Infinity;
  /** Sim seconds the flow has run with no gap longer than SUPPLY.gap; 0 while it's stopped. */
  run = 0;
  /** The target added over the last SUPPLY.window, net of what's been let out of the reservoir meanwhile. */
  net = 0;
  /** Sim seconds since this began, and what each step since SUPPLY.window ago added, net, oldest first. */
  private t = 0;
  private recent: { t: number; n: number }[] = [];

  /**
   * A step of h sim seconds, in which `added` molecules of the target went into the reservoir and `drawn` were let
   * out of it.
   */
  record(h: number, added: number, drawn: number): void {
    this.t += h;
    this.since += h;
    // a gap too long ends the run; a delivery after one starts the next
    this.run = this.since > SUPPLY.gap ? 0 : this.run + h;
    if (added > 0) this.since = 0;
    if (added || drawn) {
      this.recent.push({ t: this.t, n: added - drawn });
      this.net += added - drawn;
    }
    const r = this.recent;
    let old = 0;
    while (old < r.length && r[old].t <= this.t - SUPPLY.window) this.net -= r[old++].n;
    if (old) r.splice(0, old);
    if (!r.length) this.net = 0;
  }

  /** Whether the flow is running: the target has gone in within the last SUPPLY.gap. */
  get flowing(): boolean {
    return this.since <= SUPPLY.gap;
  }

  /** Whether the flow keeps up with what the passengers use (see SUPPLY). */
  get keepingUp(): boolean {
    return this.run >= SUPPLY.window && this.net >= CONSUMPTION * SUPPLY.window;
  }
}

/**
 * What the cryostabilizer station's status screen says about a supply, and the reference, if it holds `enough` to reach
 * Mu Ceti: either way, the ship asks the player back to the cryopod.
 */
export function supplyText(s: Supply, enough = false): string {
  if (enough) return 'RESERVOIR FULL - RETURN TO CRYOPOD';
  if (s.keepingUp) return 'SUPPLY SUSTAINED - RETURN TO CRYOPOD';
  if (!s.flowing) return 'SUPPLY: NONE';
  if (s.run >= SUPPLY.window) return 'SUPPLY: TOO SLOW';
  const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return `SUPPLY: STEADY ${clock(s.run)} / ${clock(SUPPLY.window)}`;
}
