/*
 * The intro's console log: what the ship's computer printed as it hit something, lost its bridge, crew and
 * cryostabilizer, and woke the one passenger it could.
 */

export type Level = 'info' | 'warn' | 'erro' | 'CRIT';

export interface LogLine {
  /** Seconds past 2058-11-08 04:11:00Z. */
  s: number;
  level: Level;
  msg: string;
}

/** A line as the console prints it. */
export function formatLine({ s, level, msg }: LogLine): string {
  const sec = s.toFixed(3).padStart(6, '0');
  return `[2058-11-08 04:11:${sec}Z] [${level}] ${msg}`;
}

/** A seeded generator (mulberry32), so the chaos comes out the same every time. */
function seeded(seed: number): () => number {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const rand = seeded(20581108);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** `n` star idents (like AGZ1013), including all of `known`, sorted. */
function stars(known: readonly string[], n: number): string[] {
  const out = new Set(known);
  while (out.size < n) out.add(pick(['A', 'B']) + pick([...LETTERS]) + pick([...LETTERS]) + pad(int(1000, 9999), 4));
  return [...out].sort();
}

const lost = (ids: readonly string[]) => `top foreport photo lost stars ${ids.join(', ')} - probable ccd malfunction`;

const FEW = ['AAF5850', 'AEE3030', 'AFQ5065', 'AGZ1013', 'BEE1022', 'BEM2033'];
const DOZENS = stars(FEW, 38);
const HUNDREDS = stars(DOZENS, 260);

/** Shown as soon as the player presses start. */
export const OPENING: readonly LogLine[] = [
  { s: 11.049, level: 'warn', msg: lost(['AGZ1013']) },
  { s: 15.103, level: 'info', msg: 'VEL: v_sol = 0.501549       v_cet = 0.512494         t_rem = 498023401' },
  { s: 15.103, level: 'info', msg: 'POW: o2 / o2_req = 1.1833   h2 / h2_req = 1.2001     plut / plut_req = 1.5102' },
  { s: 15.103, level: 'info', msg: 'BIO: cryo / cryo_req = 1.0381' },
];

/** The impact and its aftermath: lines in the console's own words, as fast as the ship can print them. */
function chaos(from: number, to: number): LogLine[] {
  const out: LogLine[] = [];
  const deck = () => `deck ${int(1, 9)} section ${int(1, 40)}`;
  const early: (() => [Level, string])[] = [
    () => ['CRIT', 'UNEXPECTED LIDAR RANGE TRIP'],
    () => ['CRIT', `hull strain gauge HS-${pad(int(1, 4800), 4)}: ${int(2, 90) * 100} µε exceeds limit`],
    () => ['erro', `hull strain gauge HS-${pad(int(1, 4800), 4)}: no response`],
    () => ['warn', `attitude control: unexpected torque ${(1 + rand() * 8).toFixed(2)}e${int(6, 9)} N·m about ${pick(['X', 'Y', 'Z'])}`],
    () => ['CRIT', `${deck()} pressure ${(98 + rand() * 4).toFixed(1)} kPa -> ${(rand() * 60).toFixed(1)} kPa`],
    () => ['erro', `RCS thruster quad ${int(1, 16)}: no ack`],
    () => ['warn', lost(['ALL'])],
    () => ['CRIT', `bridge connect: ${pick(['ECONNRESET', 'EHOSTUNREACH'])}`],
    () => ['CRIT', `accelerometer IMU-${int(1, 4)}: ${(2 + rand() * 30).toFixed(1)} g`],
  ];
  const middle: (() => [Level, string])[] = [
    () => ['CRIT', `bulkhead B-${pad(int(1, 96), 2)} emergency seal engaged`],
    () => ['erro', `bulkhead B-${pad(int(1, 96), 2)} seal: ESTUCK`],
    () => ['CRIT', `fire suppression zone ${pad(int(1, 64), 2)} discharged`],
    () => ['CRIT', `cryostabilizer reservoir CS-${int(1, 6)} pressure ${(180 + rand() * 40).toFixed(1)} kPa -> 0.0 kPa`],
    () => ['erro', `cryo bank C-${pad(int(1, 48), 2)} stabilizer feed: no flow`],
    () => ['warn', `o2 reserve tank O-${int(1, 12)}: flow anomaly`],
    () => ['CRIT', `power bus ${pick(['A', 'B', 'C', 'D'])}: undervoltage`],
    () => ['erro', `crew quarter connect: ${pick(['ECONNRESET', 'EHOSTUNREACH', 'ETIMEOUT'])}`],
    () => ['erro', `autonomous maintenance bay: drone ${pad(int(1, 64), 2)} lost`],
    () => ['CRIT', `${deck()} pressure ${(rand() * 20).toFixed(1)} kPa`],
  ];
  const late: (() => [Level, string])[] = [
    () => ['info', `power bus ${pick(['A', 'B', 'C', 'D'])}: switched to reserve`],
    () => ['erro', `cryo bank C-${pad(int(1, 48), 2)} pod ${pad(int(1, 700), 3)}: stabilizer level 0.0%`],
    () => ['warn', `cryo bank C-${pad(int(1, 48), 2)}: switching to reserve stabilizer`],
    () => ['erro', `cryo bank C-${pad(int(1, 48), 2)}: reserve stabilizer: ENOENT`],
    () => ['info', `bulkhead B-${pad(int(1, 96), 2)}: sealed`],
    () => ['warn', `attitude control: residual spin ${(rand() * 0.4).toFixed(3)} rad/s, correcting`],
    () => ['CRIT', `bridge connect: ${pick(['ETIMEOUT', 'EHOSTUNREACH'])}`],
    () => ['info', `passenger section connect: ${(1.2 + rand() * 0.6).toFixed(2)}us ping`],
  ];
  let s = from;
  while (true) {
    // bursts: often several lines in the same millisecond, sometimes a breath between them
    s += rand() < 0.4 ? 0 : rand() < 0.85 ? rand() * 0.06 : rand() * 0.4;
    if (s >= to) break;
    const p = (s - from) / (to - from);
    const [level, msg] = pick(p < 0.3 ? early : p < 0.7 ? middle : late)();
    out.push({ s: Math.round(s * 1000) / 1000, level, msg });
  }
  return out;
}

const PASSENGERS = [
  'AMARA OKONKWO', 'LUKAS BRANDT', 'SAKURA NAKAMURA', 'MATEO HERRERA', 'PRIYA RAGHAVAN', 'SVEN LINDQVIST',
  'FATIMA EL-AMRANI', 'DMITRI VOLKOV', 'CHLOÉ MARCHAND', 'KWAME MENSAH', 'NGUYEN THI LAN', "SEAN O'DONNELL",
  'ISABELLA ROSSI', 'TARIQ HAMDAN', 'MIN-JUN PARK', 'ASTRID HALVORSEN', 'RAFAEL OLIVEIRA', 'ZEYNEP AYDIN',
  'TANE WIREMU', 'HANNA KOWALSKA', 'OMAR FAROUK', 'LI WEI', 'SIOBHAN MURPHY', 'JOÃO PEREIRA', 'AIKO TANAKA',
  'BONGANI DLAMINI', 'ELENI PAPADOPOULOU', 'ARJUN MEHTA', 'KATARINA HORVAT', 'YUSUF ÇELIK', 'MARIE DUBOIS',
  'SANTIAGO GÓMEZ', 'INGRID JOHANSSON', 'ADEBAYO ADEYEMI', 'MAYA COHEN', 'PHAM VAN DUC', 'NIAMH KELLY',
  'GIORGI BERIDZE', 'LEILANI KAHALE', 'FERNANDO CASTILLO', 'OKSANA SHEVCHENKO', 'HIROSHI WATANABE',
  'AYESHA SIDDIQUI', 'JANNE VIRTANEN', 'CAMILA FERREIRA', 'TENZIN DORJE', 'MARKO PETROVIĆ', 'NADIA HASSAN',
];
const CHECKED_AT = [
  50.3, 50.487, 50.712, 50.893, 51.104, 51.296, 51.519, 51.701, 51.894, 52.12, 52.305, 52.497, 52.716, 52.903,
  53.098, 53.322, 53.508, 53.701, 53.912, 54.089, 54.302, 54.497, 54.718, 54.902, 55.115, 55.296, 55.509, 55.703,
  55.921, 56.108, 56.297, 56.524, 56.711, 56.893, 57.106, 57.318, 57.497, 57.702, 57.926, 58.11, 58.304, 58.519,
  58.698, 58.913, 59.101, 59.297, 59.522, 59.704,
];

/** The passenger the computer wakes. */
export const PLAYER = PASSENGERS[PASSENGERS.length - 1];

/** Played after a pause, each line when its timestamp comes around, counting from the first. */
export const INCIDENT: readonly LogLine[] = [
  { s: 36.221, level: 'warn', msg: lost(['AEE3030', 'AGZ1013']) },
  { s: 37.584, level: 'warn', msg: lost(['AEE3030', 'AGZ1013', 'BEE1022', 'BEM2033']) },
  { s: 38.404, level: 'warn', msg: lost(FEW) },
  { s: 38.708, level: 'warn', msg: lost(DOZENS) },
  { s: 38.815, level: 'warn', msg: lost(HUNDREDS) },
  { s: 38.915, level: 'CRIT', msg: 'UNEXPECTED LIDAR RANGE TRIP' },
  ...chaos(39.52, 46.9),
  { s: 46.926, level: 'CRIT', msg: 'bridge connect: ETIMEOUT' },
  { s: 46.926, level: 'CRIT', msg: 'crew quarter connect: ETIMEOUT' },
  { s: 46.926, level: 'info', msg: 'passenger section connect: 1.48us ping' },
  { s: 47.816, level: 'info', msg: 'VEL: v_sol = 0.501308       v_cet = 0.512734         t_rem = 522055824' },
  { s: 47.816, level: 'info', msg: 'POW: o2 / o2_req = 1.0811   h2 / h2_req = 1.1851     plut / plut_req = 1.5102' },
  { s: 47.816, level: 'info', msg: 'BIO: cryo / cryo_req = 0.0000' },
  { s: 47.816, level: 'warn', msg: 'cryosustenance KPI below warning threshold' },
  { s: 47.816, level: 'CRIT', msg: 'cryosustenance KPI below alert threshold; firing alert' },
  { s: 47.816, level: 'CRIT', msg: 'bridge connect: ETIMEOUT' },
  { s: 47.816, level: 'CRIT', msg: 'crew quarter connect: ETIMEOUT' },
  { s: 47.816, level: 'CRIT', msg: 'autonomous maintenance bay connect: ETIMEOUT' },
  { s: 48.588, level: 'warn', msg: 'sorting passengers by expected expertise in tags CHEM, BIO ...' },
  { s: 49.588, level: 'warn', msg: '... sorting ...' },
  ...PASSENGERS.map((name, i): LogLine => {
    const ok = name === PLAYER;
    return { s: CHECKED_AT[i], level: ok ? 'info' : 'erro', msg: `${pad(i + 1, 2)}: checking ${name.padEnd(27)}${ok ? 'success' : 'ECRYOFAIL'}` };
  }),
  { s: 59.706, level: 'info', msg: 'starting defrost' },
  { s: 59.708, level: 'info', msg: 'initiating transport to R046 - Emergency Chemistry Lab' },
];
