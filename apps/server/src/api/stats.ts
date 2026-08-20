import type { PlatformStats } from '@iot/shared';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { ingestTally } from '../metrics';

export interface StatsDeps {
  pool: Pool;
  wsClientCount: () => number;
  startedAt: number;
}

export function createStatsProvider(deps: StatsDeps): { getStats(): Promise<PlatformStats> } {
  async function getStats(): Promise<PlatformStats> {
    const [devicesRes, alertsRes, ingestRes] = await Promise.all([
      deps.pool.query<{ total: string; online: string }>(
        `SELECT count(*) AS total, count(*) FILTER (WHERE status = 'online') AS online FROM devices`,
      ),
      deps.pool.query<{ count: string }>('SELECT count(*) FROM alerts WHERE resolved_at IS NULL'),
      deps.pool.query<{ count: string }>(
        `SELECT count(*) FROM telemetry WHERE time > now() - interval '1 minute'`,
      ),
    ]);

    const devicesRow = devicesRes.rows[0];
    const alertsRow = alertsRes.rows[0];
    const ingestRow = ingestRes.rows[0];

    return {
      devices: devicesRow ? Number(devicesRow.total) : 0,
      online: devicesRow ? Number(devicesRow.online) : 0,
      ingestRate1m: ingestRow ? Number(ingestRow.count) : 0,
      accepted: ingestTally.accepted,
      rejected: ingestTally.rejected,
      activeAlerts: alertsRow ? Number(alertsRow.count) : 0,
      wsClients: deps.wsClientCount(),
      uptimeSec: Math.floor((Date.now() - deps.startedAt) / 1000),
    };
  }

  return { getStats };
}

export function createStatsRouter(provider: { getStats(): Promise<PlatformStats> }): Hono {
  const app = new Hono();
  app.get('/', async (c) => c.json(await provider.getStats()));
  return app;
}
