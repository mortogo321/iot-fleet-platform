import { describe, expect, test } from 'bun:test';
import net from 'node:net';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import type { TelemetryRow } from '../src/db';
import { createBatcher } from '../src/ingest/batcher';
import { connectMqtt } from '../src/mqtt/client';
import { type IngestDeps, ingestTelemetry, parseJsonPayload } from '../src/mqtt/ingest';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MQTT ingest integration (in-process aedes broker)', () => {
  test('a real telemetry publish flows through to the batcher writer', async () => {
    const aedes = await Aedes.createBroker();
    const tcpServer = net.createServer(aedes.handle);
    await new Promise<void>((resolve) => tcpServer.listen(0, resolve));
    const address = tcpServer.address();
    if (!address || typeof address === 'string') throw new Error('expected a TCP AddressInfo');
    const port = address.port;

    const writtenBatches: TelemetryRow[][] = [];
    const batcher = createBatcher<TelemetryRow>({
      writer: async (rows) => {
        writtenBatches.push(rows);
      },
      maxRows: 500,
      flushMs: 50,
      bufferCap: 10_000,
    });

    const ingestDeps: IngestDeps = {
      batcher,
      metrics: { incMessages: () => {} },
    };

    // MQTT_SHARED_GROUP='' -> plain subscribe (aedes has no $share support).
    const platformClient = connectMqtt({
      url: `mqtt://127.0.0.1:${port}`,
      username: 'platform-server',
      password: 'platform-secret-dev',
      sharedGroup: '',
      handlers: {
        onTelemetry: (deviceId, payload) => {
          ingestTelemetry(ingestDeps, deviceId, parseJsonPayload(payload));
        },
        onStatus: () => {},
        onShadowReported: () => {},
        onRpcResponse: () => {},
        onOtaProgress: () => {},
      },
    });

    let publisher: mqtt.MqttClient | undefined;
    try {
      await sleep(200); // let the platform client connect and its subscriptions land

      publisher = mqtt.connect(`mqtt://127.0.0.1:${port}`, { clientId: 'test-device-1' });
      await new Promise<void>((resolve, reject) => {
        publisher?.on('connect', () => resolve());
        publisher?.on('error', reject);
      });

      const payload = JSON.stringify({ temperature: 23.5, humidity: 44.1, battery: 91 });
      await new Promise<void>((resolve, reject) => {
        publisher?.publish('telemetry/dev-test1', payload, { qos: 1 }, (err) =>
          err ? reject(err) : resolve(),
        );
      });

      await sleep(300); // let the message arrive, validate, and the batcher's timer flush

      expect(writtenBatches.length).toBeGreaterThanOrEqual(1);
      const row = writtenBatches.flat().find((r) => r.deviceId === 'dev-test1');
      expect(row).toBeDefined();
      expect(row?.temperature).toBe(23.5);
      expect(row?.humidity).toBe(44.1);
      expect(row?.battery).toBe(91);
    } finally {
      await publisher?.endAsync(true).catch(() => {});
      await platformClient.end();
      await new Promise<void>((resolve) => aedes.close(() => resolve()));
      await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
    }
  }, 10_000);
});
