/**
 * The game was called Slurry Lab, and kept everything in local storage under `slurry-lab.` (the save, god mode, the
 * settings, whether the intro's been seen). It's Chemlab now, and keeps them under `chemlab.`: this moves whatever's
 * under the old prefix to the new, once, as the page loads, before anything reads storage (main.tsx imports it
 * first), so a returning player keeps their lab and settings. What's already under the new prefix is left alone.
 */
const OLD = 'slurry-lab.';
const NEW = 'chemlab.';

try {
  const old: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(OLD)) old.push(k);
  }
  for (const k of old) {
    const to = NEW + k.slice(OLD.length);
    const v = localStorage.getItem(k);
    if (v !== null && localStorage.getItem(to) === null) localStorage.setItem(to, v);
    localStorage.removeItem(k);
  }
} catch {
  // storage blocked or full: nothing to move, or it stays where it was
}
