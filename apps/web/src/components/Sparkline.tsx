import { Line, LineChart, ResponsiveContainer } from 'recharts';

interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
}

/** Minimal trend line for device cards — no axes, no grid, no tooltip. */
export function Sparkline({ data, color, height = 32 }: SparklineProps) {
  if (data.length < 2) {
    return <div className="sparkline-placeholder muted">not enough data yet</div>;
  }
  const chartData = data.map((value, i) => ({ i, value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
