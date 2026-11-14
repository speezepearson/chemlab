import { ATOMS } from './atoms';
import { roundRandom, type Fluid, type ReactionNetwork } from './reactions';
import { NS, SINGLE, SPECIES } from './species';

/*
 * Chemistry against something fixed in place: atoms of one color, the dye, held fast (in the fibers of a wicking
 * strip's dyed paper), and a liquid running past them. A molecule holding a fixed atom is fixed with it, so there are
 * two fluids in each place: what's loose, which the liquid carries, and what's fixed, the dye and whatever's bonded to
 * it. Loose molecules are kept apart and react with nothing but what's fixed:
 * - a loose molecule and a fixed one can join, or trade an atom (the network's formation and displacement), as
 *   readily as they would in a flask, going by their shares of all the atoms there, loose and fixed together;
 * - a fixed molecule can close a ring, open one, or break (the unimolecular reactions).
 * Whatever comes of it, the product with the dye's atom in it is fixed, and the other, if there is one, is loose: a
 * fixed atom never moves, whatever takes its molecule's other atoms. Since no molecule has two atoms of a color, a
 * fixed molecule has exactly one fixed atom, and a loose molecule with an atom of the dye's color meets nothing it
 * can react with.
 */

interface Meeting {
  /** The loose species, or −1 for a fixed molecule changing on its own. */
  loose: number;
  /** The fixed species. */
  fixed: number;
  /** What it leaves fixed. */
  toFixed: number;
  /** What it leaves loose, or −1 for nothing. */
  toLoose: number;
  /** Its rate constant at the temperature this was built for: A · e^(−barrier / T). */
  k: number;
}

/** The reactions between what's loose and what's fixed to one color of dye, at one temperature (see above). */
export class Mordant {
  private readonly meetings: Meeting[] = [];
  /** The meetings a loose species can have, as [from, to) in `meetings`, which are in order of it; those of none are last. */
  private readonly first = new Int32Array(NS + 2);
  private readonly events: number[] = [];
  private readonly ran: number[] = [];

  constructor(
    net: ReactionNetwork,
    /** The dye's color, as an index into ATOMS. */
    readonly dye: number,
    readonly T: number,
  ) {
    const dyed = (s: number) => s >= 0 && !!((SPECIES[s].has >> dye) & 1);
    const all: Meeting[] = [];
    net.forEach((r) => {
      const k = r.A * Math.exp(-r.bar / Math.max(T, 0.05));
      if (!k) return;
      // the dye's atom is in exactly one of the products, and that one's fixed
      const [toFixed, toLoose] = dyed(r.p1) ? [r.p1, r.p2] : [r.p2, r.p1];
      if (r.rb < 0) {
        if (dyed(r.ra)) all.push({ loose: -1, fixed: r.ra, toFixed, toLoose, k });
      } else if (dyed(r.ra)) all.push({ loose: r.rb, fixed: r.ra, toFixed, toLoose, k });
      else if (dyed(r.rb)) all.push({ loose: r.ra, fixed: r.rb, toFixed, toLoose, k });
    });
    const order = (m: Meeting) => (m.loose < 0 ? NS : m.loose);
    all.sort((a, b) => order(a) - order(b));
    this.meetings = all;
    this.first.fill(all.length);
    for (let i = all.length - 1; i >= 0; i--) this.first[order(all[i])] = i;
    for (let s = NS; s >= 0; s--) this.first[s] = Math.min(this.first[s], this.first[s + 1]);
  }

  /**
   * Let what's loose in one place react with what's fixed there for dt sim seconds (explicit Euler, in whole events,
   * rounded at random, never more than there is of either). The heat of it is lost: neither fluid's heat changes.
   */
  react(loose: Fluid, fixed: Fluid, dt: number): void {
    if (fixed.N <= 0 || dt <= 0) return;
    const N = loose.N + fixed.N;
    const { meetings, first, events, ran } = this;
    // which loose species have anyone to meet; and the fixed molecules on their own, if there are any but bare dye
    let nr = 0;
    if (loose.N > 0) for (let s = 0; s < NS; s++) if (loose.n[s] > 0 && first[s] < first[s + 1]) ran[nr++] = s;
    if (fixed.n[SINGLE[this.dye]] < fixed.N && first[NS] < first[NS + 1]) ran[nr++] = NS;
    // every meeting's expected events at the rates as the step began
    for (let j = 0; j < nr; j++) {
      const s = ran[j];
      const a = s < NS ? loose.n[s] : -1;
      for (let i = first[s]; i < first[s + 1]; i++) {
        const b = fixed.n[meetings[i].fixed];
        events[i] = b > 0 ? (a < 0 ? b : (a * b) / N) * meetings[i].k * dt : 0;
      }
    }
    // then each in turn, as far as what's left allows
    for (let j = 0; j < nr; j++) {
      const s = ran[j];
      for (let i = first[s]; i < first[s + 1]; i++) {
        if (!events[i]) continue;
        const m = meetings[i];
        const v = Math.min(roundRandom(events[i]), fixed.n[m.fixed], m.loose >= 0 ? loose.n[m.loose] : Infinity);
        if (!v) continue;
        move(fixed, m.fixed, -v);
        move(fixed, m.toFixed, v);
        if (m.loose >= 0) move(loose, m.loose, -v);
        if (m.toLoose >= 0) move(loose, m.toLoose, v);
      }
    }
  }
}

function move(f: Fluid, s: number, by: number): void {
  f.n[s] += by;
  f.N += by * SPECIES[s].size;
}

/**
 * A network's mordants, one for each color of dye, built when first asked for and again whenever the chemistry or the
 * temperature they're asked for at has changed.
 */
export class Mordants {
  private readonly made: (Mordant | undefined)[] = ATOMS.map(() => undefined);
  private version = -1;

  constructor(private readonly net: ReactionNetwork) {}

  /** The reactions against dye of color `dye` (an index into ATOMS) at temperature T. */
  of(dye: number, T: number): Mordant {
    if (this.version !== this.net.version) {
      this.made.fill(undefined);
      this.version = this.net.version;
    }
    let m = this.made[dye];
    if (!m || m.T !== T) m = this.made[dye] = new Mordant(this.net, dye, T);
    return m;
  }
}
