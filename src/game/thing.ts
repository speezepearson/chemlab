import { valveLocal } from './bodies';
import type { Pick } from './view';

/**
 * The thing a pick is part of, to outline all of it: a tool for any of its parts, a faucet for its knob or spout. The
 * supply station, built into the wall, is outlined a part at a time: its funnel, its reservoir's window, or one
 * of its two faucets (its spout's pipe, with its valve); its plate, nothing. Null for nothing.
 */
export function thingOf(p: Pick): unknown {
  switch (p.kind) {
    case 'flask': return p.f;
    case 'tool': {
      const { t } = p;
      if (!t.shape.wall) return t;
      if (p.part === 'tank') return `tool ${t.id} tank ${p.k}`;
      if (p.part === 'spout') return `tool ${t.id} spout ${p.k}`;
      if (p.part === 'valve') return `tool ${t.id} spout ${t.shape.spouts.indexOf(valveLocal(t, p.k).x)}`;
      return null;
    }
    case 'scale': return p.sc;
    case 'hose': return p.h;
    case 'faucet': return `faucet ${p.i}`;
    default: return p.kind;
  }
}
