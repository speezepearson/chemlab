const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });

/** A count of atoms or molecules, short enough for a label: 0, 950, 12.3K, 400M, 2B. */
export function fmtCount(n: number): string {
  return compact.format(n);
}
