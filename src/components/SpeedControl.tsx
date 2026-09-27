const SPEEDS = [
  { s: 0, label: '❚❚', aria: 'pause' },
  { s: 1, label: '1×' },
  { s: 4, label: '4×' },
  { s: 16, label: '16×' },
];

export function SpeedControl({ value, onChange }: { value: number; onChange(s: number): void }) {
  return (
    <div className="seg">
      {SPEEDS.map(({ s, label, aria }) => (
        <button key={s} aria-label={aria} className={s === value ? 'on' : undefined} onClick={() => onChange(s)}>
          {label}
        </button>
      ))}
    </div>
  );
}
