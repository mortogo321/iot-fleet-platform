import {
  parseTopic,
  RpcRequestSchema,
  type RpcResponse,
  RpcResponseSchema,
  ShadowDeltaSchema,
  type ShadowState,
  ShadowStateSchema,
  type Telemetry,
  TelemetrySchema,
  TOPICS,
} from '@iot/shared';
import { connect, type MqttClient } from 'mqtt';
import type { Logger } from './log';
import { runOtaSequence } from './ota';
import { applyShadowDelta, initialShadowState } from './shadow';
import { createSignalState, type SignalState, sampleTelemetry, stepSignal } from './signal';
import { sleep } from './time';

export interface DeviceOptions {
  deviceId: string;
  secret: string;
  mqttUrl: string;
  anomalyChance: number;
  log: Logger;
}

export interface DeviceHandle {
  shutdown(): Promise<void>;
}

const OTA_REBOOT_DISCONNECT_MS = 3000;
const RPC_REBOOT_DISCONNECT_MS = 5000;
const RECONNECT_PERIOD_MS = 2000;
const MIN_TICK_DELAY_MS = 50;
const JITTER_FRACTION = 0.1; // ±10%

/** Owns one device's mqtt connection, telemetry loop, shadow sync, OTA and RPC handling. */
export function startDevice(options: DeviceOptions): DeviceHandle {
  const { deviceId, secret, mqttUrl, anomalyChance, log } = options;

  let reported: ShadowState = initialShadowState();
  let reportingIntervalMs = reported.reportingIntervalMs ?? 3000;
  let signalState: SignalState = createSignalState();
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTickMs = Date.now();
  let otaInFlight = false;
  let shuttingDown = false;

  function createAndWireClient(): MqttClient {
    const c = connect(mqttUrl, {
      username: deviceId,
      clientId: deviceId,
      password: secret,
      clean: true,
      reconnectPeriod: RECONNECT_PERIOD_MS,
      will: {
        topic: TOPICS.status(deviceId),
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    });
    c.on('connect', () => void onConnect());
    c.on('message', (topic, payload) => onMessage(topic, payload));
    c.on('error', (err) => log.warn('mqtt error', { deviceId, error: String(err) }));
    c.on('close', () => log.debug('mqtt connection closed', { deviceId }));
    return c;
  }

  let client = createAndWireClient();

  async function onConnect(): Promise<void> {
    log.info('device connected', { deviceId });
    try {
      await client.subscribeAsync([TOPICS.shadowDelta(deviceId), TOPICS.rpcRequestSub(deviceId)], {
        qos: 1,
      });
    } catch (err) {
      log.warn('subscribe failed', { deviceId, error: String(err) });
    }
    try {
      await client.publishAsync(TOPICS.status(deviceId), 'online', { qos: 1, retain: true });
      await publishReportedState();
    } catch (err) {
      log.warn('post-connect publish failed', { deviceId, error: String(err) });
    }
    restartTelemetryTimer();
  }

  function onMessage(topic: string, payload: Buffer): void {
    const parsed = parseTopic(topic);
    if (!parsed || parsed.deviceId !== deviceId) return;
    if (parsed.kind === 'shadow_delta') {
      handleShadowDelta(payload).catch((err) =>
        log.error('shadow delta handling failed', { deviceId, error: String(err) }),
      );
    } else if (parsed.kind === 'rpc_request' && parsed.requestId) {
      handleRpcRequest(parsed.requestId, payload).catch((err) =>
        log.error('rpc handling failed', { deviceId, error: String(err) }),
      );
    }
  }

  async function publishTelemetry(values: Telemetry): Promise<void> {
    const payload = TelemetrySchema.parse({ ts: new Date().toISOString(), ...values });
    await client.publishAsync(TOPICS.telemetry(deviceId), JSON.stringify(payload), { qos: 1 });
  }

  async function publishReportedState(): Promise<void> {
    const payload = ShadowStateSchema.parse(reported);
    await client.publishAsync(TOPICS.shadowReported(deviceId), JSON.stringify(payload), {
      qos: 1,
    });
  }

  function scheduleNextTick(): void {
    const jitter = 1 + (Math.random() * 2 - 1) * JITTER_FRACTION;
    const delay = Math.max(MIN_TICK_DELAY_MS, Math.round(reportingIntervalMs * jitter));
    tickTimer = setTimeout(tick, delay);
  }

  function tick(): void {
    const now = Date.now();
    const deltaSec = Math.max(0.001, (now - lastTickMs) / 1000);
    lastTickMs = now;
    signalState = stepSignal(signalState, deltaSec, Math.random, anomalyChance);
    publishTelemetry(sampleTelemetry(signalState)).catch((err) =>
      log.warn('telemetry publish failed', { deviceId, error: String(err) }),
    );
    scheduleNextTick();
  }

  function restartTelemetryTimer(): void {
    if (tickTimer) clearTimeout(tickTimer);
    lastTickMs = Date.now();
    scheduleNextTick();
  }

  function stopTelemetryTimer(): void {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = undefined;
  }

  async function handleShadowDelta(payload: Buffer): Promise<void> {
    let delta: ReturnType<typeof ShadowDeltaSchema.parse>;
    try {
      delta = ShadowDeltaSchema.parse(JSON.parse(payload.toString()));
    } catch (err) {
      log.warn('invalid shadow delta', { deviceId, error: String(err) });
      return;
    }

    const result = applyShadowDelta(reported, delta.state);
    reported = result.reported;

    if (result.ledChanged) log.info('led state changed', { deviceId, ledOn: reported.ledOn });
    if (result.restartTimer) {
      reportingIntervalMs = reported.reportingIntervalMs ?? reportingIntervalMs;
      restartTelemetryTimer();
    }

    await publishReportedState();

    if (result.triggerOta && !otaInFlight) {
      runOta(result.triggerOta.toVersion).catch((err) =>
        log.error('ota run failed', { deviceId, error: String(err) }),
      );
    } else if (result.triggerOta) {
      log.warn('ignoring firmware delta — ota already in flight', { deviceId });
    }
  }

  async function runOta(targetVersion: string): Promise<void> {
    otaInFlight = true;
    log.info('ota starting', { deviceId, targetVersion });
    try {
      const iterator = runOtaSequence(targetVersion, { sleep });
      let step = await iterator.next();
      while (!step.done) {
        const progress = step.value;
        await client
          .publishAsync(TOPICS.otaProgress(deviceId), JSON.stringify(progress), { qos: 1 })
          .catch((err) =>
            log.warn('ota progress publish failed', { deviceId, error: String(err) }),
          );
        if (progress.phase === 'rebooting') {
          await simulateDisconnect(OTA_REBOOT_DISCONNECT_MS);
        }
        step = await iterator.next();
      }
      reported = { ...reported, firmwareVersion: targetVersion };
      await publishReportedState();
      log.info('ota complete', { deviceId, targetVersion });
    } finally {
      otaInFlight = false;
    }
  }

  /** Force-disconnect (fires the LWT), wait, then reconnect with a fresh client. */
  async function simulateDisconnect(ms: number): Promise<void> {
    stopTelemetryTimer();
    await client
      .endAsync(true)
      .catch((err) =>
        log.warn('disconnect during simulated reboot failed', { deviceId, error: String(err) }),
      );
    await sleep(ms);
    if (shuttingDown) return;
    client = createAndWireClient();
    await new Promise<void>((resolve) => client.once('connect', () => resolve()));
  }

  async function handleRpcRequest(requestId: string, payload: Buffer): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString());
    } catch {
      raw = undefined;
    }

    const parsed = RpcRequestSchema.safeParse(raw);
    if (!parsed.success) {
      await respondRpc(requestId, { id: requestId, ok: false, error: 'unknown method' });
      return;
    }

    const { id, method } = parsed.data;
    switch (method) {
      case 'identify': {
        log.info('identify requested', { deviceId });
        await publishTelemetry(sampleTelemetry(signalState));
        await respondRpc(requestId, { id, ok: true, result: { identified: true } });
        break;
      }
      case 'readNow': {
        await respondRpc(requestId, { id, ok: true, result: sampleTelemetry(signalState) });
        break;
      }
      case 'getState': {
        await respondRpc(requestId, { id, ok: true, result: reported });
        break;
      }
      case 'reboot': {
        await respondRpc(requestId, { id, ok: true, result: { rebooting: true } });
        simulateDisconnect(RPC_REBOOT_DISCONNECT_MS).catch((err) =>
          log.error('reboot simulation failed', { deviceId, error: String(err) }),
        );
        break;
      }
      default: {
        // Unreachable given RpcMethodSchema today; kept as a defensive fallback.
        await respondRpc(requestId, { id, ok: false, error: 'unknown method' });
      }
    }
  }

  async function respondRpc(requestId: string, response: RpcResponse): Promise<void> {
    try {
      const payload = RpcResponseSchema.parse(response);
      await client.publishAsync(TOPICS.rpcResponse(deviceId, requestId), JSON.stringify(payload), {
        qos: 1,
      });
    } catch (err) {
      log.warn('rpc response invalid or publish failed', {
        deviceId,
        requestId,
        error: String(err),
      });
    }
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    stopTelemetryTimer();
    try {
      await client.publishAsync(TOPICS.status(deviceId), 'offline', { qos: 1, retain: true });
    } catch (err) {
      log.warn('graceful offline publish failed', { deviceId, error: String(err) });
    }
    await client.endAsync().catch(() => undefined);
  }

  return { shutdown };
}
