import { parseTopic, sharedSub, TOPICS } from '@iot/shared';
import mqtt from 'mqtt';
import { logger } from '../log';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export interface MqttHandlers {
  onTelemetry(deviceId: string, payload: Buffer): void;
  onStatus(deviceId: string, payload: Buffer): void;
  onShadowReported(deviceId: string, payload: Buffer): void;
  onRpcResponse(deviceId: string, requestId: string, payload: Buffer): void;
  onOtaProgress(deviceId: string, payload: Buffer): void;
}

export interface ConnectMqttOptions {
  url: string;
  username: string;
  password: string;
  sharedGroup: string;
  handlers: MqttHandlers;
  onConnectedChange?: (connected: boolean) => void;
  clientId?: string;
}

export interface PublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export interface PlatformMqttClient {
  publish(topic: string, payload: string, opts?: PublishOptions): void;
  end(): Promise<void>;
}

function routeMessage(topic: string, payload: Buffer, handlers: MqttHandlers): void {
  const parsed = parseTopic(topic);
  if (!parsed) return;
  switch (parsed.kind) {
    case 'telemetry':
      handlers.onTelemetry(parsed.deviceId, payload);
      break;
    case 'status':
      handlers.onStatus(parsed.deviceId, payload);
      break;
    case 'shadow_reported':
      handlers.onShadowReported(parsed.deviceId, payload);
      break;
    case 'rpc_response':
      if (parsed.requestId) handlers.onRpcResponse(parsed.deviceId, parsed.requestId, payload);
      break;
    case 'ota_progress':
      handlers.onOtaProgress(parsed.deviceId, payload);
      break;
    default:
      // shadow_delta / rpc_request / alerts are platform->device (or platform->any); the
      // server never subscribes to them, so nothing should route here.
      break;
  }
}

/**
 * Connects to the broker with a custom exponential backoff (1s..30s) — mqtt.js's own
 * `reconnectPeriod` is a fixed interval, so automatic reconnection is disabled. Each
 * backoff attempt disposes the old client and dials a brand-new one: `client.reconnect()`
 * reuses stale connection state (including the previously resolved broker address), which
 * strands the client on ECONNREFUSED forever when the broker restarts with a new IP —
 * exactly what happens to a docker-compose service.
 */
export function connectMqtt(options: ConnectMqttOptions): PlatformMqttClient {
  let backoffMs = MIN_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let intentionalEnd = false;
  let client: mqtt.MqttClient;

  function clearReconnectTimer(): void {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function scheduleReconnect(previous: mqtt.MqttClient): void {
    if (intentionalEnd || reconnectTimer !== undefined) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (intentionalEnd) return;
      previous.removeAllListeners();
      previous.end(true);
      createClient();
    }, backoffMs);
    reconnectTimer.unref?.();
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  function createClient(): void {
    const c = mqtt.connect(options.url, {
      username: options.username,
      password: options.password,
      clientId: options.clientId ?? `platform-server-${crypto.randomUUID().slice(0, 8)}`,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
    });
    client = c;

    c.on('connect', () => {
      backoffMs = MIN_BACKOFF_MS;
      clearReconnectTimer();
      options.onConnectedChange?.(true);
      const subs: Array<[string, 0 | 1 | 2]> = [
        [sharedSub(options.sharedGroup, TOPICS.telemetryAll), 1],
        [TOPICS.statusAll, 1],
        [TOPICS.shadowReportedAll, 1],
        [TOPICS.rpcResponseAll, 1],
        [TOPICS.otaProgressAll, 1],
      ];
      for (const [topic, qos] of subs) {
        c.subscribe(topic, { qos }, (err) => {
          if (err) logger.error(`mqtt subscribe failed for ${topic}`, err);
        });
      }
    });

    c.on('close', () => {
      options.onConnectedChange?.(false);
      scheduleReconnect(c);
    });

    c.on('error', (err) => logger.error('mqtt client error', err));

    c.on('message', (topic, payload) => routeMessage(topic, payload, options.handlers));
  }

  createClient();

  return {
    publish(topic, payload, opts) {
      client.publish(
        topic,
        payload,
        { qos: opts?.qos ?? 1, retain: opts?.retain ?? false },
        (err) => {
          if (err) logger.error(`mqtt publish failed for ${topic}`, err);
        },
      );
    },
    async end() {
      intentionalEnd = true;
      clearReconnectTimer();
      await client.endAsync(true);
    },
  };
}
