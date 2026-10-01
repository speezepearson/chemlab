import { THERMO, type ChemParams } from '../chem/params';
import { NS, SPECIES } from '../chem/species';
import { roomFor, volume, type Vessel } from './flask';
import type { ToolKind } from './tools';

/**
 * A saved bench: everything on it, plus the chemistry parameters. Positions
 * are stored the way the engine keeps them across resizes, so a save loads
 * sensibly into a different window size.
 */
export interface SaveState {
  v: 1;
  /** The preset Reset goes back to. */
  preset: string;
  flasks: SavedFlask[];
  tools: SavedTool[];
  scales: SavedScale[];
  hoses: SavedHose[];
  /** Where each faucet joins its pipe, as fractions of the home area (see HOME_W); where they start if left out. */
  faucets?: { x: number; y: number }[];
  chem?: { bonds: ChemParams['bonds']; swapA: number; heatCap: number };
}

/** Contents by species name (names outlast reorderings of the species list), and whole quanta of heat. */
export interface SavedVessel {
  n: Record<string, number>;
  Q: number;
  label?: string;
}

export interface SavedFlask extends SavedVessel {
  /** Resting place: across as a fraction of the home area's width (see HOME_W), up from the floor in world units. */
  x: number;
  up: number;
  glass: number;
}

export interface SavedTool {
  kind: ToolKind;
  id: number;
  fx: number;
  fy: number;
  valves: number[];
  tanks: SavedVessel[];
  /** Per spout, the drop hanging there, if any. */
  drops?: SavedVessel[];
  /** A spectrometer's last reading, if it's been run (see spectrum). */
  reading?: number[];
}

export interface SavedScale {
  fx: number;
  fy: number;
  tare: number;
  /** Flasks standing on it, by index into `flasks`. */
  load: { f: number; dx: number }[];
}

export interface SavedHose {
  inlet: { x: number; y: number };
  outlet: { x: number; y: number };
  funnel: SavedVessel;
  /** The drop hanging at the outlet, if any. */
  drop?: SavedVessel;
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
