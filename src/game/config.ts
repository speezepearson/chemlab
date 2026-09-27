import type { Atom } from '../chem/atoms';

export interface Faucet {
  atom: Atom;
  T: number;
}

export const FAUCETS: readonly Faucet[] = [
  { atom: 'R', T: 1.0 }, { atom: 'G', T: 1.0 }, { atom: 'B', T: 0.4 },
  { atom: 'Y', T: 1.0 }, { atom: 'C', T: 1.0 }, { atom: 'M', T: 2.5 },
];

export const CAP = 300; // flask capacity, atoms
export const POUR_RATE = 70; // atoms/s, flask to flask
export const FILL_RATE = 110; // atoms/s, from faucet
export const N_FLASKS = 8;
export const SUPPLY_MOLECULES = 40;
export const GOAL_ATOMS = 600;
