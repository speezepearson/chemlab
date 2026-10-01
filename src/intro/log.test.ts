import { describe, expect, it } from 'vitest';
import { INCIDENT, OPENING, PLAYER, formatLine } from './log';

describe('intro log', () => {
  it('prints lines the way the console does', () => {
    expect(formatLine(OPENING[0])).toBe(
      '[2058-11-08 04:11:11.049Z] [warn] top foreport photo lost stars AGZ1013 - probable ccd malfunction',
    );
    expect(formatLine(INCIDENT[INCIDENT.length - 1])).toBe(
      '[2058-11-08 04:11:59.708Z] [info] initiating transport to R046 - Emergency Chemistry Lab',
    );
  });

  it('runs forward in time, from the opening through the incident', () => {
    const all = [...OPENING, ...INCIDENT];
    for (let i = 1; i < all.length; i++) expect(all[i].s).toBeGreaterThanOrEqual(all[i - 1].s);
    // the chaos fills the gap between the lidar trip and the first timeouts
    const chaos = INCIDENT.filter((l) => l.s > 38.915 && l.s < 46.926);
    expect(chaos.length).toBeGreaterThan(60);
  });

  it('loses more and more stars, each list sorted and holding the last', () => {
    const lists = INCIDENT.filter((l) => l.msg.startsWith('top foreport photo lost stars') && !l.msg.includes(' ALL '))
      .slice(0, 5)
      .map((l) => l.msg.replace('top foreport photo lost stars ', '').replace(' - probable ccd malfunction', '').split(', '));
    expect(lists.map((l) => l.length)).toEqual([2, 4, 6, expect.any(Number), expect.any(Number)]);
    expect(lists[3].length).toBeGreaterThanOrEqual(24);
    expect(lists[4].length).toBeGreaterThanOrEqual(200);
    for (let i = 0; i < lists.length; i++) {
      expect([...lists[i]].sort()).toEqual(lists[i]);
      if (i) for (const id of lists[i - 1]) expect(lists[i]).toContain(id);
    }
  });

  it('fails every cryo pod it checks but the last, lined up in columns', () => {
    const checks = INCIDENT.filter((l) => / checking /.test(l.msg));
    expect(checks).toHaveLength(48);
    expect(checks.slice(0, -1).every((l) => l.level === 'erro' && l.msg.endsWith('ECRYOFAIL'))).toBe(true);
    expect(checks[47].msg).toBe(`48: checking ${PLAYER}               success`);
    expect(checks[0].msg).toBe('01: checking AMARA OKONKWO              ECRYOFAIL');
  });
});
