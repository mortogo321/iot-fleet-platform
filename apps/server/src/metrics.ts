import client from 'prom-client';
import { logger } from './log';

export const registry = new client.Registry();

try {
  client.collectDefaultMetrics({ register: registry });
} catch (err) {
  // Some default Node collectors may not be fully supported under the Bun runtime;
  // the ingest/business metrics below are unaffected either way.
  logger.warn('collectDefaultMetrics unavailable, continuing without Node default metrics', err);
}

export const metrics = {
  ingestMessagesTotal: new client.Counter({
    name: 'iot_ingest_messages_total',
    help: 'Telemetry messages processed by ingest result',
    labelNames: ['result'] as const,
    registers: [registry],
  }),
  ingestBatchFlushSeconds: new client.Histogram({
    name: 'iot_ingest_batch_flush_seconds',
    help: 'Duration of telemetry batch flush writes',
    registers: [registry],
  }),
  ingestBufferDroppedTotal: new client.Counter({
    name: 'iot_ingest_buffer_dropped_total',
    help: 'Telemetry rows dropped because the ingest buffer was full',
    registers: [registry],
  }),
  wsClients: new client.Gauge({
    name: 'iot_ws_clients',
    help: 'Currently connected WebSocket clients',
    registers: [registry],
  }),
  alertsFiredTotal: new client.Counter({
    name: 'iot_alerts_fired_total',
    help: 'Alerts fired by severity',
    labelNames: ['severity'] as const,
    registers: [registry],
  }),
  mqttConnected: new client.Gauge({
    name: 'iot_mqtt_connected',
    help: '1 if the platform MQTT connection is up, else 0',
    registers: [registry],
  }),
  rpcRequestsTotal: new client.Counter({
    name: 'iot_rpc_requests_total',
    help: 'RPC requests by method and outcome',
    labelNames: ['method', 'outcome'] as const,
    registers: [registry],
  }),
  otaUpdatesTotal: new client.Counter({
    name: 'iot_ota_updates_total',
    help: 'OTA updates by terminal phase',
    labelNames: ['phase'] as const,
    registers: [registry],
  }),
};

/** Cheap in-memory mirror of ingestMessagesTotal for the synchronous /api/stats read. */
export const ingestTally = { accepted: 0, rejected: 0 };

export function recordIngest(result: 'accepted' | 'rejected'): void {
  metrics.ingestMessagesTotal.inc({ result });
  ingestTally[result] += 1;
}
