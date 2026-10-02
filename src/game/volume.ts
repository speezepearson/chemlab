import type { Fluid } from '../chem/reactions';
import { NS, SPECIES } from '../chem/species';

/**
 * What takes up room in a vessel: molecules (the default), or atoms. With molecules, bonding shrinks a fluid
 * and breaking bonds swells it, so a full vessel can overflow as it reacts. Toggled from the Chemistry panel.
 * Mass, heat capacity and reaction rates stay per atom either way.
 */
export const VOLUME = { molecules: true };

/** A fluid's volume: its atoms, or its molecules if VOLUME.molecules. */
export function volume(f: Fluid): number {
  if (!VOLUME.molecules) return f.N;
  let m = 0;
  for (let s = 0; s < NS; s++) m += f.n[s];
  return m;
}

/** The units volume is counted in, for display. */
export const volumeUnit = () => (VOLUME.molecules ? 'molecules' : 'atoms');

/** How much room one molecule of species s takes: its atoms, or 1 if VOLUME.molecules. */
export const roomFor = (s: number) => (VOLUME.molecules ? 1 : SPECIES[s].size);
