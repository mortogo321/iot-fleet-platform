import { randomBytes } from 'node:crypto';
import {
  DEVICE_ID_PREFIX,
  DEVICE_SECRET_PREFIX,
  LIMITS,
  ProvisionRequestSchema,
  RpcRequestBodySchema,
  ShadowStateSchema,
} from '@iot/shared';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { OtaManager } from '../ota/manager';
import type { RpcManager } from '../rpc/manager';
import { computeDelta } from '../shadow/delta';
import type { ShadowStore } from '../shadow/store';
import {
  badRequest,
  conflict,
  gatewayTimeout,
  notFound,
  parseJsonBody,
  unauthorized,
} from './helpers';

export interface DevicesDeps {
  pool: Pool;
  provisioningToken: string;
  shadowStore: ShadowStore;
  rpcManager: RpcManager;
  otaManager: OtaManager;
}

interface DeviceListRow {
  id: string;
  name: string;
  kind: string;
  location: string | null;
  status: string;
  firmware_version: string;
  shadow_version: string | number;
  first_seen: Date;
  last_seen: Date | null;
  latest_time: Date | null;
  temperature: number | null;
  humidity: number | null;
  battery: number | null;
}

function toApiDevice(row: DeviceListRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    location: row.location,
    status: row.status,
    firmwareVersion: row.firmware_version,
    shadowVersion: Number(row.shadow_version),
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
    latest:
      row.latest_time !== null
        ? {
            ts: row.latest_time.toISOString(),
            temperature: row.temperature,
            humidity: row.humidity,
            battery: row.battery,
          }
        : null,
  };
}

const DEVICE_LIST_COLUMNS = `d.id, d.name, d.kind, d.location, d.status, d.firmware_version, d.shadow_version,
       d.first_seen, d.last_seen, t.time AS latest_time, t.temperature, t.humidity, t.battery`;

const ShadowPatchBodySchema = z
  .object({ version: z.number().int().nonnegative(), desired: ShadowStateSchema })
  .strict();

const FirmwareDeployBodySchema = z.object({ version: z.string().min(1).max(64) }).strict();

export function createDevicesRouter(deps: DevicesDeps): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const token = c.req.header('x-provisioning-token');
    if (!token || token !== deps.provisioningToken) return unauthorized(c);

    const raw = await parseJsonBody(c);
    const parsed = ProvisionRequestSchema.safeParse(raw);
    if (!parsed.success) return badRequest(c, parsed.error.message);

    const id = `${DEVICE_ID_PREFIX}${randomBytes(4).toString('hex')}`;
    const secret = `${DEVICE_SECRET_PREFIX}${randomBytes(16).toString('hex')}`;
    const secretHash = await Bun.password.hash(secret, 'argon2id');

    const res = await deps.pool.query<{
      id: string;
      name: string;
      kind: string;
      location: string | null;
      status: string;
      firmware_version: string;
      first_seen: Date;
    }>(
      `INSERT INTO devices (id, name, kind, location, secret_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, kind, location, status, firmware_version, first_seen`,
      [id, parsed.data.name, parsed.data.kind, parsed.data.location ?? null, secretHash],
    );
    const row = res.rows[0];
    if (!row) return badRequest(c, 'device provisioning failed');

    return c.json(
      {
        device: {
          id: row.id,
          name: row.name,
          kind: row.kind,
          location: row.location,
          status: row.status,
          firmwareVersion: row.firmware_version,
          firstSeen: row.first_seen.toISOString(),
        },
        secret,
      },
      201,
    );
  });

  app.get('/', async (c) => {
    const res = await deps.pool.query<DeviceListRow>(
      `SELECT ${DEVICE_LIST_COLUMNS}
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT time, temperature, humidity, battery FROM telemetry
         WHERE device_id = d.id ORDER BY time DESC LIMIT 1
       ) t ON true
       ORDER BY d.id`,
    );
    return c.json(res.rows.map(toApiDevice));
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');
    const res = await deps.pool.query<DeviceListRow>(
      `SELECT ${DEVICE_LIST_COLUMNS}
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT time, temperature, humidity, battery FROM telemetry
         WHERE device_id = d.id ORDER BY time DESC LIMIT 1
       ) t ON true
       WHERE d.id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return notFound(c, 'device not found');
    return c.json(toApiDevice(row));
  });

  app.get('/:id/telemetry', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');

    const minutesParam = Number(c.req.query('minutes') ?? '60');
    const minutes =
      Number.isFinite(minutesParam) && minutesParam > 0 ? Math.trunc(minutesParam) : 60;
    const bucket = c.req.query('bucket') ?? 'raw';
    if (bucket !== 'raw' && bucket !== '1m') return badRequest(c, 'bucket must be raw or 1m');

    if (bucket === 'raw') {
      const res = await deps.pool.query(
        `SELECT time, temperature, humidity, battery FROM telemetry
         WHERE device_id = $1 AND time > now() - make_interval(mins => $2::int)
         ORDER BY time ASC LIMIT $3`,
        [id, minutes, LIMITS.TELEMETRY_QUERY_MAX_ROWS],
      );
      return c.json(res.rows.map((r) => ({ ...r, time: (r.time as Date).toISOString() })));
    }

    const res = await deps.pool.query(
      `SELECT bucket AS time, temperature_avg, temperature_min, temperature_max,
              humidity_avg, humidity_min, humidity_max, battery_avg, battery_min, battery_max
       FROM telemetry_1m
       WHERE device_id = $1 AND bucket > now() - make_interval(mins => $2::int)
       ORDER BY bucket ASC LIMIT $3`,
      [id, minutes, LIMITS.TELEMETRY_QUERY_MAX_ROWS],
    );
    return c.json(res.rows.map((r) => ({ ...r, time: (r.time as Date).toISOString() })));
  });

  app.get('/:id/shadow', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');
    const record = await deps.shadowStore.get(id);
    if (!record) return notFound(c, 'device not found');
    const delta = computeDelta(record.desired, record.reported);
    return c.json({
      desired: record.desired,
      reported: record.reported,
      delta,
      version: record.version,
    });
  });

  app.patch('/:id/shadow', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');

    const raw = await parseJsonBody(c);
    const parsed = ShadowPatchBodySchema.safeParse(raw);
    if (!parsed.success) return badRequest(c, parsed.error.message);

    const result = await deps.shadowStore.patchDesired(
      id,
      parsed.data.version,
      parsed.data.desired,
    );
    if (!result.ok) {
      if (result.reason === 'not_found') return notFound(c, 'device not found');
      return conflict(c, 'shadow version mismatch');
    }
    const { record } = result;
    const delta = computeDelta(record.desired, record.reported);
    return c.json({
      desired: record.desired,
      reported: record.reported,
      delta,
      version: record.version,
    });
  });

  app.post('/:id/rpc', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');

    const raw = await parseJsonBody(c);
    const parsed = RpcRequestBodySchema.safeParse(raw);
    if (!parsed.success) return badRequest(c, parsed.error.message);

    try {
      const response = await deps.rpcManager.sendRpc(
        id,
        parsed.data.method,
        parsed.data.params,
        parsed.data.timeoutMs,
      );
      return c.json({ ok: response.ok, result: response.result, error: response.error });
    } catch {
      return gatewayTimeout(c, 'device did not respond');
    }
  });

  app.post('/:id/firmware', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');

    const raw = await parseJsonBody(c);
    const parsed = FirmwareDeployBodySchema.safeParse(raw);
    if (!parsed.success) return badRequest(c, parsed.error.message);

    const result = await deps.otaManager.deploy(id, parsed.data.version);
    if (!result.ok) {
      return notFound(
        c,
        result.reason === 'device_not_found' ? 'device not found' : 'firmware not found',
      );
    }
    return c.json({ ok: true });
  });

  return app;
}
