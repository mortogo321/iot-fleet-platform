import type { MetricName } from '@iot/shared';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TelemetryPoint } from '../../lib/api';
import { formatHHmm, METRIC_COLORS, METRIC_LABELS, METRIC_ORDER } from '../../lib/format';

interface TelemetryChartProps {
  points: TelemetryPoint[];
  activeMetrics: ReadonlySet<MetricName>;
}

export function TelemetryChart({ points, activeMetrics }: TelemetryChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={points} margin={{ top: 8, right: 20, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#1e2430" vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={(value: string) => formatHHmm(value)}
          stroke="#8b93a7"
          tick={{ fontSize: 12 }}
          minTickGap={40}
        />
        <YAxis stroke="#8b93a7" tick={{ fontSize: 12 }} width={40} domain={['auto', 'auto']} />
        <Tooltip
          isAnimationActive={false}
          labelFormatter={(label) => formatHHmm(String(label))}
          contentStyle={{
            background: 'var(--panel)',
            border: '1px solid var(--panel-border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
          cursor={{ stroke: 'var(--panel-border)', strokeWidth: 1 }}
        />
        {METRIC_ORDER.filter((metric) => activeMetrics.has(metric)).map((metric) => (
          <Line
            key={metric}
            type="monotone"
            dataKey={metric}
            name={METRIC_LABELS[metric]}
            stroke={METRIC_COLORS[metric]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
