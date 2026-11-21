import { THERMO, defaultChemParams, type ChemParams } from '../chem/params';
import { NS, SPECIES } from '../chem/species';
import { roomFor, volume, type Vessel } from './flask';
import type { ToolKind } from './tools';

/**
 * A saved lab: everything in it, plus the chemistry parameters. Across and up are stored as they were on the old
 * flat bench (see fromFrac): everything is on one wall, so that's all there is to where a thing is. A save from when
 * the lab was a room to walk round also says how far out from the back wall things were and which way they faced;
 * its lab is laid out afresh along the wall, still hooked up as it was (see flatten.ts).
 */
export interface SaveState {
  v: 1;
  /**
   * Whether the lab is laid out on the wall, as it's been since it stopped being a room to walk round. A save without
   * this is from before, and is laid out afresh (see flatten.ts).
   */
  wall?: boolean;
  /** The preset Reset goes back to. */
  preset: string;
  flasks: SavedFlask[];
  tools: SavedTool[];
  scales: SavedScale[];
  hoses: SavedHose[];
  /**
   * Each faucet's note, with where it was on the old flat bench. The lab's faucets are fixed to the wall, so where is
   * ignored; it's kept so saves still load on the old bench.
   */
  faucets?: { x: number; y: number; note?: string }[];
  chem?: { bonds: ChemParams['bonds']; swapA: number; heatCap: number };
  /** The target the receptacle has taken so far, by volume, toward the goal; none if left out. */
  delivered?: number;
  /** Whether the alarms are silenced (see GameEngine); not if left out. */
  alarmsOff?: boolean;
  /** Whether a porthole's blinds were shut, in saves from when there was one to see; no longer written, and ignored. */
  blindsShut?: unknown;
  /** Whether the player has been told they can nap (see GameEngine.nap); not if left out. */
  nap?: boolean;
  /** The sticky notes of saves from when there was a pencil to write them with; no longer written, and ignored. */
  papers?: unknown;
  /**
   * What's in the equipment cabinet (see cabinet.ts): for each kind it holds a limited supply of, the slots that are
   * filled. Left out (as in saves from before the cabinet), it's full but for what's out in the lab.
   */
  cabinet?: Record<string, number[]>;
  /**
   * Where the player stood and looked, in saves from when the lab could be walked round in; no longer written, and
   * ignored.
   */
  player?: unknown;
  /** Where the view is (see GameEngine): across the wall, up it, and out from it; where it starts if left out. */
  view?: { x: number; y: number; z: number };
}

/** Contents by species name (names outlast reorderings of the species list), and whole quanta of heat. */
export interface SavedVessel {
  n: Record<string, number>;
  Q: number;
  label?: string;
}

/**
 * From when the lab was a room to walk round: how far out from the back wall something was, in world units, and
 * which way it faced (see Pose). No longer written.
 */
export interface SavedDepth {
  z?: number;
  yaw?: number;
}

export interface SavedFlask extends SavedVessel, SavedDepth {
  /** Where its mouth is: across as a fraction of the home area's width (see HOME_W), up from the counter in world units. */
  x: number;
  up: number;
  glass: number;
}

export interface SavedTool extends SavedDepth {
  kind: ToolKind;
  id: number;
  fx: number;
  fy: number;
  valves: number[];
  tanks: SavedVessel[];
  /** Per spout, the drop hanging there, if any. */
  drops?: SavedVessel[];
  /** A heater's tube, stretch by stretch (see Tool.tube). */
  tube?: SavedVessel[];
  /** From when tools could be flipped left to right; ignored now. */
  flipped?: boolean;
  /** The player's note about it (see Tool.note), if any. */
  note?: string;
  /** A spectrometer's last reading, if it's been run (see spectrum). */
  reading?: number[];
  /**
   * An instrument's own state, if it has any (see Tool.memory): a thermometer's bulb's temperature, and whether it's
   * broken; how much a wicking strip's paper has drunk and how scorched it is; how much a column's bed has
   * drunk; which of a sleeper culture's cells are dead; what the station is fitted for, and how far into its
   * changeover it is (a save from before it was fitted for anything but the cryostabilizer has none).
   */
  memory?: number[];
  /** What's on a wicking strip's paper, stretch by stretch from its foot (see Tool.paper). */
  paper?: SavedVessel[];
  /** What's on a column's bed, stretch by stretch from its top (see Tool.bed). */
  bed?: SavedVessel[];
  /** From when a wicking strip's paper took up a sample from a pad on top of it, as one vessel; ignored now. */
  sample?: SavedVessel;
}

export interface SavedScale extends SavedDepth {
  fx: number;
  fy: number;
  tare: number;
  /** Flasks standing on it, by index into `flasks`. */
  load: { f: number; dx: number }[];
  /** The player's note about it, if any. */
  note?: string;
}

/**
 * A hose pulled out of a spout or a faucet. Older saves' hoses had a funnel inlet anywhere, hung under a spout, a
 * faucet or another hose's nozzle or on a stand of its own, so the fields they kept for it (inlet, funnel, drop, note,
 * and on.hose) are only read to tell which spout or faucet a hose is on.
 */
export interface SavedHose {
  /**
   * Its nozzle as fractions of the home area (see HOME_W); and from when the lab was a room to walk round, how far out
   * from the back wall it was, which way it faced and how far behind it its stand was, no longer written.
   */
  outlet: { x: number; y: number; z?: number; yaw?: number; reach?: number };
  /** The spout (a tool by its id, and a spout) or faucet it's on; an older save's hose with neither is dropped. */
  on?: { tool?: number; spout?: number; faucet?: number; hose?: number };
  inlet?: { x: number; y: number; z?: number; yaw?: number };
  funnel?: SavedVessel;
  drop?: SavedVessel;
  note?: string;
}

const BY_NAME = new Map(SPECIES.map((s) => [s.name, s.i]));

export function saveVessel(v: Vessel): SavedVessel {
  const n: Record<string, number> = {};
  for (let s = 0; s < NS; s++) if (v.n[s] > 0) n[SPECIES[s].name] = v.n[s];
  return { n, Q: v.Q, ...(v.label ? { label: v.label } : {}) };
}

/** Fill a vessel from a save: whole, non-negative counts only, dropping unknown species and whatever won't fit. */
export function loadVessel(v: Vessel, saved: SavedVessel): void {
  v.n.fill(0);
  v.N = 0;
  for (const [name, count] of Object.entries(saved.n ?? {})) {
    const s = BY_NAME.get(name);
    if (s === undefined) continue;
    const m = Math.max(0, Math.min(Math.round(Number(count) || 0), Math.floor((v.cap - volume(v)) / roomFor(s))));
    v.n[s] = m;
    v.N += m * SPECIES[s].size;
  }
  v.Q = v.N > 0 ? Math.max(0, Math.round(Number(saved.Q) || 0)) : 0;
  v.label = typeof saved.label === 'string' ? saved.label : '';
}

/**
 * Copy saved chemistry parameters over the live ones (known bonds and fields only). A bond the save doesn't have, as
 * a save from the six-atom chemistry has no black bonds, gets the default chemistry's.
 */
export function loadChem(params: ChemParams, chem: SaveState['chem']): void {
  if (!chem) return;
  const defaults = defaultChemParams().bonds;
  for (const [k, b] of Object.entries(params.bonds)) {
    const s = chem.bonds?.[k];
    Object.assign(b, defaults[k]);
    if (!s) continue;
    for (const f of ['E', 'Ea', 'A'] as const) if (Number.isFinite(s[f])) b[f] = s[f];
  }
  if (Number.isFinite(chem.swapA)) params.swapA = chem.swapA;
  if (Number.isFinite(chem.heatCap) && chem.heatCap > 0) THERMO.heatCap = chem.heatCap;
}

export function saveChem(params: ChemParams): NonNullable<SaveState['chem']> {
  return { bonds: structuredClone(params.bonds), swapA: params.swapA, heatCap: THERMO.heatCap };
}

/* ---------------- export strings ---------------- */

/** A save as a pasteable string: base64 of its JSON. */
export function encodeSave(s: SaveState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Read a string from encodeSave (or the bare JSON). Throws if it isn't a save. */
export function decodeSave(text: string): SaveState {
  text = text.trim();
  let json = text;
  if (!text.startsWith('{')) {
    const bin = atob(text.replace(/\s+/g, ''));
    json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  const s = JSON.parse(json) as SaveState;
  if (!s || s.v !== 1 || !Array.isArray(s.flasks) || !Array.isArray(s.tools)) throw new Error('not a Slurry Lab save');
  s.scales ??= [];
  s.hoses ??= [];
  return s;
}

/* ---------------- local storage ---------------- */

const KEY = 'slurry-lab.save';

export function storeSave(s: SaveState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the bench just won't survive a refresh
  }
}

export function storedSave(): SaveState | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? decodeSave(text) : null;
  } catch {
    return null;
  }
}

export function clearStoredSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

const GOD_KEY = 'slurry-lab.god';

/**
 * Whether god mode was on when the player last left it, kept beside the save (but not in it, so exporting a bench
 * doesn't carry it): off if it's never been set, or storage is blocked.
 */
export function storedGod(): boolean {
  try {
    return localStorage.getItem(GOD_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeGod(on: boolean): void {
  try {
    localStorage.setItem(GOD_KEY, on ? '1' : '0');
  } catch {
    // storage blocked: god mode just starts off next time
  }
}
