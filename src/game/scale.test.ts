import { describe, expect, it } from 'vitest';
import { singleOf } from '../chem/species';
import { CAP, N_FLASKS } from './config';
import { Flask } from './flask';
import { GLASS_ERROR, GLASS_GRAMS, SCALE_MAX, Scale, flaskGrams, glassGrams } from './scale';

const flask = (i: number, atoms = 0) => {
  const f = new Flask({ x: 0, y: 0 }, CAP);
  f.glass = glassGrams(i);
  f.setMolecules(singleOf('R'), atoms);
  return f;
};

describe('flask weights', () => {
  it('are near 100 g, differ from flask to flask, and stay the same between games', () => {
    const w = Array.from({ length: N_FLASKS }, (_, i) => glassGrams(i));
    for (const g of w) expect(Math.abs(g - GLASS_GRAMS)).toBeLessThanOrEqual(GLASS_ERROR);
    expect(new Set(w.map(Math.round)).size).toBeGreaterThan(N_FLASKS / 2);
    expect(glassGrams(3)).toBe(w[3]);
  });

  it('count fluid at 1 kg per billion atoms', () => {
    const f = flask(0, CAP);
    expect(flaskGrams(f) - f.glass).toBeCloseTo(1000);
  });
});

describe('Scale', () => {
  it('reads whole grams of everything on it', () => {
    const sc = new Scale(0, 0);
    expect(sc.reading()).toBe(0);
    sc.spots[0] = flask(0, CAP / 4);
    sc.spots[2] = flask(1);
    expect(sc.reading()).toBe(Math.round(glassGrams(0) + 250 + glassGrams(1)));
    sc.remove(sc.spots[0]!);
    expect(sc.reading()).toBe(Math.round(glassGrams(1)));
  });

  it('tares to weigh just the fluid', () => {
    const sc = new Scale(0, 0);
    const f = flask(5);
    sc.spots[1] = f;
    sc.zero();
    expect(sc.reading()).toBe(0);
    f.setMolecules(singleOf('R'), CAP * 0.123);
    expect(sc.reading()).toBe(123);
    sc.remove(f);
    expect(sc.reading()).toBe(-Math.round(glassGrams(5)));
  });

  it('reads OVER past its capacity, and will not tare there', () => {
    const sc = new Scale(0, 0);
    const heavy = { ...flask(0, CAP), glass: SCALE_MAX } as Flask;
    sc.spots[0] = heavy;
    expect(sc.reading()).toBeNull();
    sc.zero();
    expect(sc.tare).toBe(0);
  });
});
