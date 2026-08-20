import type { MetricName } from '@iot/shared';

/** Fixed series colors (spec tokens) — kept as plain hex for Recharts SVG props. */
export const METRIC_COLORS: Record<MetricName, string> = {
  temperature: '#f5a524',
  humidity: '#5b9cf6',
  battery: '#4cc38a',
};

export const METRIC_UNITS: Record<MetricName, string> = {
  temperature: '°C',
  humidity: '%RH',
  battery: '%',
};

export const METRIC_LABELS: Record<MetricName, string> = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  battery: 'Battery',
};

export const METRIC_ORDER: MetricName[] = ['temperature', 'humidity', 'battery'];

/** Locale-independent HH:mm for chart X axes and timestamps. */
export function formatHHmm(ts: string): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Coarse "time ago" for headers/cards; null/undefined ⇒ "never". */
export function formatRelative(ts: string | null | undefined): string {
  if (!ts) return 'never';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0 || ms < 5_000) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatMetric(metric: MetricName, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const digits = metric === 'temperature' ? 1 : 0;
  return `${value.toFixed(digits)}${METRIC_UNITS[metric]}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
