import type { MetricName } from '@iot/shared';
import { type CSSProperties, useEffect, useState } from 'react';
import { OtaPanel } from '../components/device/OtaPanel';
import { RpcPanel } from '../components/device/RpcPanel';
import { ShadowPanel } from '../components/device/ShadowPanel';
import { TelemetryChart } from '../components/device/TelemetryChart';
import { EmptyState } from '../components/EmptyState';
import { StatusDot } from '../components/StatusDot';
import {
  type DeviceSummary,
  getDevice,
  getTelemetry,
  type TelemetryBucket,
  type TelemetryPoint,
} from '../lib/api';
import {
  classNames,
  formatRelative,
  METRIC_COLORS,
  METRIC_LABELS,
  METRIC_ORDER,
} from '../lib/format';
import { useWsEvent } from '../lib/ws';

interface RangeConfig {
  minutes: number;
  bucket: TelemetryBucket;
  label: string;
}

const RANGE_CONFIG = {
  '15m': { minutes: 15, bucket: 'raw', label: '15m' },
  '1h': { minutes: 60, bucket: '1m', label: '1h' },
  '6h': { minutes: 360, bucket: '1m', label: '6h' },
} satisfies Record<string, RangeConfig>;

type RangeKey = keyof typeof RANGE_CONFIG;
const RANGE_KEYS = Object.keys(RANGE_CONFIG) as RangeKey[];

export function DeviceView({ deviceId }: { deviceId: string | null }) {
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('15m');
  const [activeMetrics, setActiveMetrics] = useState<ReadonlySet<MetricName>>(
    () => new Set(METRIC_ORDER),
  );
  const [points, setPoints] = useState<TelemetryPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) {
      setDevice(null);
      return;
    }
    let cancelled = false;
    getDevice(deviceId)
      .then((d) => {
        if (!cancelled) {
          setDevice(d);
          setDeviceError(null);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setDeviceError(err instanceof Error ? err.message : 'failed to load device');
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    setChartLoading(true);
    const config = RANGE_CONFIG[range];
    getTelemetry(deviceId, config.minutes, config.bucket)
      .then((rows) => {
        if (!cancelled) {
          setPoints(rows);
          setChartError(null);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setChartError(err instanceof Error ? err.message : 'failed to load telemetry');
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, range]);

  useWsEvent((event) => {
    if (!deviceId) return;
    if (event.type === 'telemetry' && event.deviceId === deviceId && range === '15m') {
      setPoints((prev) => {
        const next = [
          ...prev,
          {
            ts: event.point.ts,
            temperature: event.point.temperature,
            humidity: event.point.humidity,
            battery: event.point.battery,
          },
        ];
        const cutoff = Date.now() - RANGE_CONFIG['15m'].minutes * 60_000;
        return next.filter((p) => new Date(p.ts).getTime() >= cutoff);
      });
      return;
    }
    if (event.type === 'presence' && event.deviceId === deviceId) {
      setDevice((prev) => (prev ? { ...prev, status: event.status } : prev));
      return;
    }
    if (
      event.type === 'ota_progress' &&
      event.deviceId === deviceId &&
      event.progress.phase === 'complete'
    ) {
      setDevice((prev) => (prev ? { ...prev, firmwareVersion: event.progress.version } : prev));
    }
  });

  function toggleMetric(metric: MetricName) {
    setActiveMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(metric)) {
        if (next.size === 1) return prev; // always keep at least one series visible
        next.delete(metric);
      } else {
        next.add(metric);
      }
      return next;
    });
  }

  if (!deviceId) {
    return (
      <div className="view">
        <EmptyState
          title="No device selected"
          hint="Pick a device from the Fleet view to see its telemetry, shadow, RPC, and OTA panels."
        />
      </div>
    );
  }

  if (deviceError) {
    return (
      <div className="view">
        <EmptyState title="Device not found" hint={deviceError} />
      </div>
    );
  }

  return (
    <div className="view">
      <div className="device-header">
        <div>
          <h2>{device?.name ?? deviceId}</h2>
          <div className="muted">
            {deviceId} · {device?.kind ?? 'unknown kind'}
          </div>
        </div>
        <div className="device-header-meta">
          <span>
            <StatusDot online={device?.status === 'online'} /> {device?.status ?? 'unknown'}
          </span>
          <span>fw {device?.firmwareVersion ?? '—'}</span>
          <span>{device?.location ?? 'no location set'}</span>
          <span>last seen {formatRelative(device?.lastSeen)}</span>
        </div>
      </div>

      <div className="panel">
        <div className="chart-toolbar">
          <div className="range-picker">
            {RANGE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={classNames('range-btn', range === key && 'range-btn-active')}
                onClick={() => setRange(key)}
              >
                {RANGE_CONFIG[key].label}
              </button>
            ))}
          </div>
          <div className="metric-chips">
            {METRIC_ORDER.map((metric) => (
              <button
                key={metric}
                type="button"
                className={classNames(
                  'metric-chip',
                  activeMetrics.has(metric) && 'metric-chip-active',
                )}
                style={{ '--chip-color': METRIC_COLORS[metric] } as CSSProperties}
                onClick={() => toggleMetric(metric)}
              >
                <span className="metric-chip-dot" />
                {METRIC_LABELS[metric]}
              </button>
            ))}
          </div>
        </div>

        {chartError ? (
          <div className="banner banner-error">{chartError}</div>
        ) : !chartLoading && points.length === 0 ? (
          <EmptyState title="No telemetry in this range yet" />
        ) : (
          <TelemetryChart points={points} activeMetrics={activeMetrics} />
        )}
      </div>

      {/* key={deviceId} remounts each panel on device switch so their internal
          state (RPC log, OTA progress, shadow form) doesn't leak across devices. */}
      <div className="device-panels">
        <ShadowPanel key={deviceId} deviceId={deviceId} />
        <RpcPanel key={deviceId} deviceId={deviceId} />
        <OtaPanel
          key={deviceId}
          deviceId={deviceId}
          currentVersion={device?.firmwareVersion ?? null}
        />
      </div>
    </div>
  );
}
