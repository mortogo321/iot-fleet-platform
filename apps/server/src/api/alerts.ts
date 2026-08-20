import { Hono } from 'hono';
import type { Pool } from 'pg';

export interface AlertsDeps {
  pool: Pool;
}

interface AlertRow {
  id: string;
  rule_id: string;
  rule_name: string;
  device_id: string;
  metric: string;
  value: number;
  threshold: number;
  op: string;
  severity: string;
  message: string;
  triggered_at: Date;
  resolved_at: Date | null;
}

function toApiRow(row: AlertRow) {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    deviceId: row.device_id,
    metric: row.metric,
    value: row.value,
    threshold: row.threshold,
    op: row.op,
    severity: row.severity,
    message: row.message,
    triggeredAt: row.triggered_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

export function createAlertsRouter(deps: AlertsDeps): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const status = c.req.query('status') === 'active' ? 'active' : 'all';
    const limitParam = Number(c.req.query('limit') ?? '100');
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(Math.trunc(limitParam), 1), 1000)
      : 100;

    const where = status === 'active' ? 'WHERE a.resolved_at IS NULL' : '';
    const res = await deps.pool.query<AlertRow>(
      `SELECT a.id, a.rule_id, r.name AS rule_name, a.device_id, a.metric, a.value, a.threshold,
              a.op, a.severity, a.message, a.triggered_at, a.resolved_at
       FROM alerts a
       JOIN alert_rules r ON r.id = a.rule_id
       ${where}
       ORDER BY a.triggered_at DESC
       LIMIT $1`,
      [limit],
    );
    return c.json(res.rows.map(toApiRow));
  });

  return app;
}
