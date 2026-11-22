import { onTool, spoutAt } from './bodies';
import { landing, readLab, tops } from './flatten';
import type { SaveState, SavedHose, SavedTool } from './save';
import { CELL, toFrac } from './space';

/** Where the separator's five spouts were across its frame, at the same height, before it had two (see refit). */
const OLD_SEPARATOR_SPOUTS = [-2 * CELL, -CELL, 0, CELL, 2 * CELL];
/**
 * Which of those each of the separator's two spouts takes the place of: the left, for what has a black atom in it, the
 * old right end's, which let out only black; the right, for the rest, the old left end's, which let out just that.
 */
const SEPARATOR_FROM = [4, 0];

/**
 * Bringing the tools in a save from before a tool's shape changed up to the shapes they have now, before the lab is
 * read from it (see flatten). What a tool lost goes, and what it kept keeps its settings:
 * - a resistive heater had three taps along its tube, each a valve over a spout, before its dial, and its end's spout
 *   after theirs: their valves go, the dial keeps its setting (and its lever's side), and a hose or a drop on a tap's
 *   spout is dropped, while the end's are the one spout's now. What an open tap let out runs on to the end.
 * - a separator had five spouts, by the share of a molecule's atoms that were black, from none on the left to all on
 *   the right, where it has two now (see SEPARATOR_FROM): each takes the place of the old end spout that let out what
 *   it lets out, or the nearest to it, so its hose and its drop are that spout's, and the middle three's are dropped.
 *   So that it still pours where that spout did, and into nothing new, one with no hose gets one, its nozzle where
 *   that spout's tip was, unless it would pour into the same vessel (or none) from where it is anyway. Its valve keeps
 *   its setting. A save says it's from after this (SaveState.twoSpoutSeparator), since its separators' valves and
 *   spouts are numbered alike either way.
 *
 * The save given isn't changed.
 */
export function refit(s: SaveState): SaveState {
  const heaters = new Map<number, number>();
  const separators = new Set<number>();
  const tools = s.tools.map((st) => {
    if (st.kind === 'separator' && !s.twoSpoutSeparator) {
      separators.add(st.id);
      return Array.isArray(st.drops) ? { ...st, drops: SEPARATOR_FROM.map((j) => st.drops![j] ?? { n: {}, Q: 0 }) } : st;
    }
    if (st.kind !== 'heater' || !Array.isArray(st.valves) || st.valves.length <= 1) return st;
    // its taps' valves, then its dial; its taps' spouts, then its end's
    const end = st.valves.length - 1;
    heaters.set(st.id, end);
    return keepOnly(st, end, end);
  });
  if (!heaters.size && !separators.size) return s;
  const hoses = (s.hoses ?? []).flatMap((sh) => {
    const on = sh.on;
    if (!on || !Number.isInteger(on.spout) || on.tool === undefined) return [sh];
    const end = heaters.get(on.tool);
    if (end !== undefined) return on.spout === end ? [{ ...sh, on: { ...on, spout: 0 } }] : [];
    if (!separators.has(on.tool)) return [sh];
    const j = SEPARATOR_FROM.indexOf(on.spout!);
    return j >= 0 ? [{ ...sh, on: { ...on, spout: j } }] : [];
  });
  const out: SaveState = { ...s, tools, hoses, ...(separators.size ? { twoSpoutSeparator: true } : {}) };
  if (separators.size) out.hoses = [...hoses, ...keepPouring(out, separators)];
  return out;
}

/**
 * For each of these separators' spouts with no hose, one that keeps it pouring where the old spout it takes the place
 * of did (see SEPARATOR_FROM), if it would pour anywhere else from where it is.
 */
function keepPouring(s: SaveState, separators: Set<number>): SavedHose[] {
  const lab = readLab(s);
  const all = tops(lab);
  const hosed = new Set(lab.hoses.flatMap((h) => ('tool' in h.on ? [`${h.on.tool}.${h.on.spout}`] : [])));
  const added: SavedHose[] = [];
  for (const t of lab.tools) {
    if (!separators.has(t.id)) continue;
    SEPARATOR_FROM.forEach((from, j) => {
      if (hosed.has(`${t.id}.${j}`)) return;
      const was = onTool(t, OLD_SEPARATOR_SPOUTS[from], t.shape.spoutY);
      if (landing(all, was)?.key === landing(all, spoutAt(t, j))?.key) return;
      added.push({ outlet: { ...toFrac(was), ...(s.wall ? {} : { z: was.z }) }, on: { tool: t.id, spout: j } });
    });
  }
  return added;
}

/** A saved tool with only its valve `valve` (and that valve's side) and spout `spout`'s drop left. */
function keepOnly(st: SavedTool, valve: number, spout: number): SavedTool {
  const out: SavedTool = { ...st, valves: [st.valves[valve] ?? 0] };
  if (Array.isArray(st.sides)) out.sides = [st.sides[valve] ?? 1];
  if (Array.isArray(st.drops)) out.drops = st.drops[spout] ? [st.drops[spout]] : [];
  return out;
}
