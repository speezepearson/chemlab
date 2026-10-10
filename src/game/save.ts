import { THERMO, type ChemParams } from '../chem/params';
import { NS, SPECIES } from '../chem/species';
import { roomFor, volume, type Vessel } from './flask';
import type { ToolKind } from './tools';
import type { SavedPaper } from './paper';

/**
 * A saved lab: everything in it, plus the chemistry parameters. Across and up are stored as they were on the old
 * flat bench, which is now the lab's back wall (see fromFrac), so saves from before the lab was 3D still load.
 * How far out from the wall things are, and which way they face, are optional, since those saves lack them.
 */
export interface SaveState {
  v: 1;
  /** The preset Reset goes back to. */
  preset: string;
  flasks: SavedFlask[];
  tools: SavedTool[];
  scales: SavedScale[];
  hoses: SavedHose[];
  /**
   * Each faucet's note, with where it was on the old flat bench. The lab's faucets are fixed to its right wall, so
   * where is ignored; it's kept so saves still load on the old bench.
   */
  faucets?: { x: number; y: number; note?: string }[];
  chem?: { bonds: ChemParams['bonds']; swapA: number; heatCap: number };
  /** The target the receptacle has taken so far, by volume, toward the goal; none if left out. */
  delivered?: number;
  /** The player's sticky notes, the one on top last; none if left out. */
  papers?: SavedPaper[];
  /** Where the player stood and looked (see GameEngine); where they start if left out. */
  player?: { x: number; z: number; yaw: number; pitch: number };
}

/** Contents by species name (names outlast reorderings of the species list), and whole quanta of heat. */
export interface SavedVessel {
  n: Record<string, number>;
  Q: number;
  label?: string;
}

/** How far out from the back wall something is, in world units, and which way it faces (see Pose); optional. */
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
  /** Whether it's flipped left to right (see Tool.flipped). */
  flipped?: boolean;
  /** The player's note about it (see Tool.note), if any. */
  note?: string;
  /** A spectrometer's last reading, if it's been run (see spectrum). */
  reading?: number[];
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

export interface SavedHose {
  /** Each end as fractions of the home area (see HOME_W), and how far out from the back wall (optional). */
  inlet: { x: number; y: number; z?: number };
  outlet: { x: number; y: number; z?: number };
  funnel: SavedVessel;
  /** The drop hanging at the outlet, if any. */
  drop?: SavedVessel;
  /** The player's note about it, if any. */
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

/** Copy saved chemistry parameters over the live ones (known bonds and fields only). */
export function loadChem(params: ChemParams, chem: SaveState['chem']): void {
  if (!chem) return;
  for (const [k, b] of Object.entries(params.bonds)) {
    const s = chem.bonds?.[k];
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
 * doesn't carry it): on if it's never been set, or storage is blocked.
 */
export function storedGod(): boolean {
  try {
    return localStorage.getItem(GOD_KEY) !== '0';
  } catch {
    return true;
  }
}

export function storeGod(on: boolean): void {
  try {
    localStorage.setItem(GOD_KEY, on ? '1' : '0');
  } catch {
    // storage blocked: god mode just starts on next time
  }
}
