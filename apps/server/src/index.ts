import { join } from 'node:path';
import { OtaProgressSchema, ShadowStateSchema } from '@iot/shared';
import { createAlertEngine } from './alerts/engine';
import { createAlertRepo } from './alerts/repo';
import { sendAlertWebhook } from './alerts/webhook';
import { createApp } from './api/router';
import { createStatsProvider } from './api/stats';
import { config } from './config';
import { createDb, type TelemetryRow } from './db';
import { createBatcher } from './ingest/batcher';
import { logger, setLogLevel } from './log';
import { metrics, recordIngest } from './metrics';
import { connectMqtt, type MqttHandlers, type PlatformMqttClient } from './mqtt/client';
import { type IngestDeps, ingestTelemetry, parseJsonPayload } from './mqtt/ingest';
import { createOtaManager } from './ota/manager';
import { handleStatus, type PresenceDeps } from './presence';
import { createRpcManager, type RpcPublisher } from './rpc/manager';
import { createShadowStore } from './shadow/store';
import { createWsHub } from './ws/hub';

setLogLevel(config.logLevel);

async function main(): Promise<void> {
  const startedAt = Date.now();
  let intakeOpen = true;
  let mqttClient: PlatformMqttClient | undefined;

  const mqttPublish = (topic: string, payload: string): void => {
    if (!mqttClient) {
      logger.warn(`dropped mqtt publish to ${topic}: mqtt not connected yet`);
      return;
    }
    mqttClient.publish(topic, payload);
  };

  const db = createDb(config.databaseUrl);
  if (!(await db.ping())) {
    logger.warn('database not reachable at boot; /health will report db:false until it recovers');
  }

  const wsHub = createWsHub();

  const telemetryBatcher = createBatcher<TelemetryRow>({
    writer: async (rows) => {
      await db.insertTelemetryBatch(rows);
      await db.touchLastSeen([...new Set(rows.map((r) => r.deviceId))]);
    },
    onDropped: (n) => metrics.ingestBufferDroppedTotal.inc(n),
    onFlush: (seconds) => metrics.ingestBatchFlushSeconds.observe(seconds),
  });

  const shadowStore = createShadowStore({
    pool: db.pool,
    mqttPublish,
    wsPublish: (event) => wsHub.publish(event),
  });

  const rpcPublisher: RpcPublisher = { publish: mqttPublish };
  const rpcManager = createRpcManager({
    publisher: rpcPublisher,
    metrics: {
      incRequests: (method, outcome) => metrics.rpcRequestsTotal.inc({ method, outcome }),
    },
  });

  const alertRepo = createAlertRepo(db.pool);
  const alertEngine = createAlertEngine({
    ...alertRepo,
    wsPublish: (event) => wsHub.publish(event),
    mqttPublish,
    onFired: (severity) => metrics.alertsFiredTotal.inc({ severity }),
    sendWebhook: (rule, alert) => {
      if (!rule.webhookUrl) return;
      void sendAlertWebhook(rule.webhookUrl, alert, {
        secret: config.webhookSecret,
        onResult: (outcome) => logger.debug(`webhook ${outcome} for rule ${rule.id}`),
      }).catch((err: unknown) => logger.error('unexpected webhook error', err));
    },
  });

  const otaManager = createOtaManager({
    deviceExists: db.deviceExists,
    firmwareExists: db.firmwareExists,
    setDesiredFirmware: async (deviceId, version) => {
      await shadowStore.setDesired(deviceId, { firmwareVersion: version });
    },
    updateDeviceFirmwareVersion: db.updateDeviceFirmwareVersion,
    wsPublish: (event) => wsHub.publish(event),
    onPhaseMetric: (phase) => metrics.otaUpdatesTotal.inc({ phase }),
  });

  const presenceDeps: PresenceDeps = {
    setStatus: db.setDeviceStatus,
    wsPublish: (event) => wsHub.publish(event),
    onOnline: (deviceId) => {
      void shadowStore.refreshAndPublish(deviceId);
    },
  };

  const ingestDeps: IngestDeps = {
    batcher: telemetryBatcher,
    metrics: { incMessages: recordIngest },
    isOpen: () => intakeOpen,
    onAccepted: (deviceId, row) => {
      wsHub.publish({
        type: 'telemetry',
        deviceId,
        point: {
          ts: row.time.toISOString(),
          temperature: row.temperature,
          humidity: row.humidity,
          battery: row.battery,
        },
      });
      void alertEngine
        .evaluate(deviceId, {
          temperature: row.temperature,
          humidity: row.humidity,
          battery: row.battery,
        })
        .catch((err: unknown) => logger.error('alert evaluation failed', err));
    },
  };

  const mqttHandlers: MqttHandlers = {
    onTelemetry: (deviceId, payload) => {
      ingestTelemetry(ingestDeps, deviceId, parseJsonPayload(payload));
    },
    onStatus: (deviceId, payload) => {
      void handleStatus(presenceDeps, deviceId, payload);
    },
    onShadowReported: (deviceId, payload) => {
      const parsed = ShadowStateSchema.safeParse(parseJsonPayload(payload));
      if (!parsed.success) {
        logger.debug(`rejected shadow/reported for ${deviceId}: ${parsed.error.message}`);
        return;
      }
      void shadowStore.applyReported(deviceId, parsed.data);
    },
    onRpcResponse: (_deviceId, requestId, payload) => {
      rpcManager.handleResponse(requestId, parseJsonPayload(payload));
    },
    onOtaProgress: (deviceId, payload) => {
      const parsed = OtaProgressSchema.safeParse(parseJsonPayload(payload));
      if (!parsed.success) {
        logger.debug(`rejected ota/progress for ${deviceId}: ${parsed.error.message}`);
        return;
      }
      void otaManager.handleProgress(deviceId, parsed.data);
    },
  };

  const statsProvider = createStatsProvider({
    pool: db.pool,
    wsClientCount: wsHub.clientCount,
    startedAt,
  });

  const webDistPath = join(import.meta.dir, '../../web/dist');
  const app = createApp({
    health: { pingDb: db.ping },
    statsProvider,
    internal: {
      internalToken: config.internalToken,
      serverUsername: config.mqttServerUsername,
      serverPassword: config.mqttServerPassword,
      findDeviceSecretHash: db.findDeviceSecretHash,
    },
    ingest: { ingest: ingestDeps, findDeviceSecretHash: db.findDeviceSecretHash },
    devices: {
      pool: db.pool,
      provisioningToken: config.provisioningToken,
      shadowStore,
      rpcManager,
      otaManager,
    },
    firmware: { pool: db.pool },
    alerts: { pool: db.pool },
    rules: { pool: db.pool, engine: alertEngine },
    webDistPath,
  });

  // Boot order: HTTP (+WS) must be up before we connect to MQTT, since EMQX's auth/acl
  // delegation calls back into this same server over HTTP.
  const server = Bun.serve({
    port: config.port,
    // Longer than EMQX's HTTP-connector keep-alive recycle (max_inactive 10s): the broker
    // must always be the side that closes an idle auth/acl connection, otherwise its reuse
    // of a socket we just closed surfaces as authentication_failure on device connects.
    idleTimeout: 120,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        return srv.upgrade(req)
          ? undefined
          : new Response('WebSocket upgrade failed', { status: 400 });
      }
      return app.fetch(req);
    },
    websocket: wsHub.websocket,
  });
  wsHub.attach(server);
  const stopStatsLoop = wsHub.startStatsLoop(() => statsProvider.getStats());
  logger.info(`http+ws listening on :${server.port}`);

  mqttClient = connectMqtt({
    url: config.mqttUrl,
    username: config.mqttServerUsername,
    password: config.mqttServerPassword,
    sharedGroup: config.mqttSharedGroup,
    handlers: mqttHandlers,
    onConnectedChange: (connected) => metrics.mqttConnected.set(connected ? 1 : 0),
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    intakeOpen = false;
    stopStatsLoop();
    await telemetryBatcher.stop();
    if (mqttClient) await mqttClient.end();
    await db.end();
    await server.stop();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.error('fatal error during boot', err);
  process.exit(1);
});
