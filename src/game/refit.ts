import type { SaveState, SavedTool } from './save';

/**
 * Bringing the tools in a save from before a tool's shape changed up to the shapes they have now, before the lab is
 * read from it (see flatten). What a tool lost goes, and what it kept keeps its settings:
 * - a resistive heater had three taps along its tube, each a valve over a spout, before its dial, and its end's spout
 *   after theirs: their valves go, the dial keeps its setting (and its lever's side), and a hose or a drop on a tap's
 *   spout is dropped, while the end's are the one spout's now. What an open tap let out runs on to the end.
 *
 * The save given isn't changed.
 */
export function refit(s: SaveState): SaveState {
  const heaters = new Map<number, number>();
  const tools = s.tools.map((st) => {
    if (st.kind !== 'heater' || !Array.isArray(st.valves) || st.valves.length <= 1) return st;
    // its taps' valves, then its dial; its taps' spouts, then its end's
    const end = st.valves.length - 1;
    heaters.set(st.id, end);
    return keepOnly(st, end, end);
  });
  if (!heaters.size) return s;
  const hoses = (s.hoses ?? []).flatMap((sh) => {
    const end = sh.on && Number.isInteger(sh.on.spout) ? heaters.get(sh.on.tool!) : undefined;
    if (end === undefined) return [sh];
    return sh.on!.spout === end ? [{ ...sh, on: { ...sh.on, spout: 0 } }] : [];
  });
  return { ...s, tools, hoses };
}

/** A saved tool with only its valve `valve` (and that valve's side) and spout `spout`'s drop left. */
function keepOnly(st: SavedTool, valve: number, spout: number): SavedTool {
  const out: SavedTool = { ...st, valves: [st.valves[valve] ?? 0] };
  if (Array.isArray(st.sides)) out.sides = [st.sides[valve] ?? 1];
  if (Array.isArray(st.drops)) out.drops = st.drops[spout] ? [st.drops[spout]] : [];
  return out;
}
