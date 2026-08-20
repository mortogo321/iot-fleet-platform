import { clamp } from '../lib/format';

function batteryColor(value: number): string {
  if (value < 15) return 'var(--crit)';
  if (value < 30) return 'var(--warn)';
  return 'var(--accent)';
}

export function BatteryBar({ value }: { value: number }) {
  const pct = clamp(value, 0, 100);
  return (
    <div className="battery-bar" title={`battery ${pct.toFixed(0)}%`}>
      <div
        className="battery-bar-fill"
        style={{ width: `${pct}%`, background: batteryColor(pct) }}
      />
    </div>
  );
}
