import { Hono } from 'hono';
import type { IngestDeps } from '../mqtt/ingest';
import { ingestTelemetry } from '../mqtt/ingest';
import { badRequest, parseJsonBody, unauthorized } from './helpers';

export interface IngestRouterDeps {
  ingest: IngestDeps;
  findDeviceSecretHash: (deviceId: string) => Promise<string | null>;
}

/** HTTP telemetry path for non-MQTT devices: Authorization: Bearer {deviceId}.{secret}. */
export function createIngestRouter(deps: IngestRouterDeps): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const auth = c.req.header('authorization');
    if (!auth?.startsWith('Bearer ')) return unauthorized(c);
    const token = auth.slice('Bearer '.length);
    const sep = token.indexOf('.');
    if (sep <= 0 || sep === token.length - 1) return unauthorized(c);
    const deviceId = token.slice(0, sep);
    const secret = token.slice(sep + 1);

    const hash = await deps.findDeviceSecretHash(deviceId);
    if (!hash || !(await Bun.password.verify(secret, hash))) return unauthorized(c);

    const raw = await parseJsonBody(c);
    const result = ingestTelemetry(deps.ingest, deviceId, raw);
    if (!result.ok) return badRequest(c, result.error);
    return c.json({ ok: true });
  });

  return app;
}
