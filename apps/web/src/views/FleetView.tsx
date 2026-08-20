import type { PlatformStats } from '@iot/shared';
import { useEffect, useState } from 'react';
import { BatteryBar } from '../components/BatteryBar';
import { EmptyState } from '../components/EmptyState';
import { Sparkline } from '../components/Sparkline';
import { StatusDot } from '../components/StatusDot';
import { type DeviceSummary, getStats, listDevices } from '../lib/api';
import { formatMetric, formatRelative, METRIC_COLORS } from '../lib/format';
import { useWsEvent } from '../lib/ws';

const SPARKLINE_MAX_POINTS = 20;
const DEVICE_REFRESH_MS = 30_000;

export function FleetView({ onSelectDevice }: { onSelectDevice: (deviceId: string) => void }) {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const rows = await listDevices();
        if (cancelled) return;
        setDevices(rows);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load devices');
      }
    }
    (async () => {
      try {
        const [statsRes] = await Promise.all([getStats(), refresh()]);
        if (cancelled) return;
        setStats(statsRes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load fleet');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Safety-net poll: self-heals from a missed WS event and picks up devices
    // provisioned after this view's initial load (e.g. a newly-run simulator).
    const interval = setInterval(refresh, DEVICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useWsEvent((event) => {
    if (event.type === 'stats') {
      setStats(event.stats);
      return;
    }
    if (event.type === 'telemetry') {
      const { deviceId, point } = event;
      setDevices((prev) =>
        prev.map((d) =>
          d.id === deviceId
            ? {
                ...d,
                latest: {
                  ts: point.ts,
                  temperature: point.temperature,
                  humidity: point.humidity,
                  battery: point.battery,
                },
              }
            : d,
        ),
      );
      setHistory((prev) => {
        const next = [...(prev[deviceId] ?? []), point.temperature];
        if (next.length > SPARKLINE_MAX_POINTS) next.splice(0, next.length - SPARKLINE_MAX_POINTS);
        return { ...prev, [deviceId]: next };
      });
      return;
    }
    if (event.type === 'presence') {
      setDevices((prev) =>
        prev.map((d) => (d.id === event.deviceId ? { ...d, status: event.status } : d)),
      );
    }
  });

  return (
    <div className="view">
      <div className="stats-bar">
        <StatTile label="Devices" value={stats?.devices ?? devices.length} />
        <StatTile
          label="Online"
          value={stats?.online ?? devices.filter((d) => d.status === 'online').length}
        />
        <StatTile label="Ingest rate" value={stats ? `${stats.ingestRate1m}/min` : '—'} />
        <StatTile
          label="Active alerts"
          value={stats?.activeAlerts ?? '—'}
          accent={stats && stats.activeAlerts > 0 ? 'crit' : undefined}
        />
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {!loading && devices.length === 0 ? (
        <EmptyState title="no devices yet — the simulator provisions on first run" />
      ) : (
        <div className="device-grid">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              history={history[device.id] ?? []}
              onSelect={() => onSelectDevice(device.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: 'crit';
}) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label muted">{label}</div>
      <div className={`stat-tile-value ${accent === 'crit' ? 'text-crit' : ''}`}>{value}</div>
    </div>
  );
}

function DeviceCard({
  device,
  history,
  onSelect,
}: {
  device: DeviceSummary;
  history: number[];
  onSelect: () => void;
}) {
  return (
    <button type="button" className="device-card" onClick={onSelect}>
      <div className="device-card-head">
        <StatusDot online={device.status === 'online'} />
        <div className="device-card-title">
          <div className="device-card-name">{device.name}</div>
          <div className="muted device-card-meta">
            {device.id} · {device.kind}
          </div>
        </div>
      </div>

      {device.latest ? (
        <div className="device-card-metrics">
          <span>{formatMetric('temperature', device.latest.temperature)}</span>
          <span>{formatMetric('humidity', device.latest.humidity)}</span>
          <span>{formatMetric('battery', device.latest.battery)}</span>
        </div>
      ) : (
        <div className="muted device-card-metrics">no telemetry yet</div>
      )}

      <Sparkline data={history} color={METRIC_COLORS.temperature} />
      <BatteryBar value={device.latest?.battery ?? 0} />

      <div className="device-card-footer muted">
        <span>fw {device.firmwareVersion ?? '—'}</span>
        <span>{formatRelative(device.lastSeen)}</span>
      </div>
    </button>
  );
}
