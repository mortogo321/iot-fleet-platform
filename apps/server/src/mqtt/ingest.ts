import { LIMITS, TelemetrySchema } from '@iot/shared';
import type { TelemetryRow } from '../db';
import { logger } from '../log';

export interface IngestMetricsSink {
  incMessages(result: 'accepted' | 'rejected'): void;
}

export interface IngestBatcher {
  push(row: TelemetryRow): void;
}

export interface IngestDeps {
  batcher: IngestBatcher;
  metrics: IngestMetricsSink;
  /** Injectable clock for the clock-skew guard; defaults to Date.now. */
  clock?: () => number;
  /** Called after a point is accepted and pushed to the batcher (WS fan-out, alert evaluation). */
  onAccepted?: (deviceId: string, row: TelemetryRow) => void;
  /** Gate for graceful shutdown's "stop intake" step; omitted (or true) means always open. */
  isOpen?: () => boolean;
}

export type IngestResult = { ok: true; row: TelemetryRow } | { ok: false; error: string };

/**
 * Shared validate -> clock-skew-guard -> batch pipeline used by both the MQTT telemetry
 * handler and the HTTP POST /api/ingest path. Unknown fields and out-of-range values are
 * rejected by TelemetrySchema (.strict() + METRIC_BOUNDS).
 */
export function ingestTelemetry(deps: IngestDeps, deviceId: string, raw: unknown): IngestResult {
  if (deps.isOpen && !deps.isOpen()) {
    return { ok: false, error: 'server is shutting down' };
  }

  const parsed = TelemetrySchema.safeParse(raw);
  if (!parsed.success) {
    deps.metrics.incMessages('rejected');
    logger.debug(`telemetry rejected for ${deviceId}: ${parsed.error.message}`);
    return { ok: false, error: 'invalid telemetry payload' };
  }

  const clock = deps.clock ?? Date.now;
  const now = clock();
  const parsedTs = parsed.data.ts ? Date.parse(parsed.data.ts) : Number.NaN;
  const ts =
    Number.isFinite(parsedTs) && Math.abs(parsedTs - now) <= LIMITS.CLOCK_SKEW_MS ? parsedTs : now;

  const row: TelemetryRow = {
    time: new Date(ts),
    deviceId,
    temperature: parsed.data.temperature,
    humidity: parsed.data.humidity,
    battery: parsed.data.battery,
  };

  deps.batcher.push(row);
  deps.metrics.incMessages('accepted');
  deps.onAccepted?.(deviceId, row);
  return { ok: true, row };
}

/** Parse the raw MQTT payload buffer as JSON; malformed JSON is treated as a rejected payload. */
export function parseJsonPayload(payload: Buffer | string): unknown {
  try {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
