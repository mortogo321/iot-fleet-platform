import { type RuleInput, RuleInputSchema } from '@iot/shared';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import type { AlertEngine } from '../alerts/engine';
import { badRequest, notFound, parseJsonBody } from './helpers';

export interface RulesDeps {
  pool: Pool;
  engine: AlertEngine;
}

interface RuleRow {
  id: string;
  name: string;
  device_id: string | null;
  kind: string | null;
  metric: string;
  op: string;
  threshold: number;
  duration_sec: number;
  cooldown_sec: number;
  severity: string;
  webhook_url: string | null;
  enabled: boolean;
  created_at: Date;
}

function toApiRow(row: RuleRow) {
  return {
    id: row.id,
    name: row.name,
    deviceId: row.device_id,
    kind: row.kind,
    metric: row.metric,
    op: row.op,
    threshold: row.threshold,
    durationSec: row.duration_sec,
    cooldownSec: row.cooldown_sec,
    severity: row.severity,
    webhookUrl: row.webhook_url,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
  };
}

/** field name (RuleInput) -> DB column, in insertion/update order. */
const COLUMNS: Array<[keyof RuleInput, string]> = [
  ['name', 'name'],
  ['deviceId', 'device_id'],
  ['kind', 'kind'],
  ['metric', 'metric'],
  ['op', 'op'],
  ['threshold', 'threshold'],
  ['durationSec', 'duration_sec'],
  ['cooldownSec', 'cooldown_sec'],
  ['severity', 'severity'],
  ['webhookUrl', 'webhook_url'],
  ['enabled', 'enabled'],
];

export function createRulesRouter(deps: RulesDeps): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const res = await deps.pool.query<RuleRow>(
      'SELECT * FROM alert_rules ORDER BY created_at DESC',
    );
    return c.json(res.rows.map(toApiRow));
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');
    const res = await deps.pool.query<RuleRow>('SELECT * FROM alert_rules WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) return notFound(c, 'rule not found');
    return c.json(toApiRow(row));
  });

  app.post('/', async (c) => {
    const raw = await parseJsonBody(c);
    const parsed = RuleInputSchema.safeParse(raw);
    if (!parsed.success) return badRequest(c, parsed.error.message);
    const input = parsed.data;
    const values = COLUMNS.map(([field]) => input[field] ?? null);
    const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const columnNames = COLUMNS.map(([, col]) => col).join(', ');
    const res = await deps.pool.query<RuleRow>(
      `INSERT INTO alert_rules (${columnNames}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    const row = res.rows[0];
    if (!row) return badRequest(c, 'rule insert failed');
    deps.engine.invalidateRulesCache();
    return c.json(toApiRow(row), 201);
  });

  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');

    const raw = await parseJsonBody(c);
    if (typeof raw !== 'object' || raw === null) return badRequest(c, 'invalid body');
    const parsed = RuleInputSchema.partial().safeParse(raw);
    if (!parsed.success) return badRequest(c, parsed.error.message);

    // .partial() re-applies each field's own default when the key is entirely absent, so we
    // only honor fields the caller actually sent (checked against the raw body's own keys) —
    // otherwise every PATCH would silently reset durationSec/cooldownSec/severity/enabled.
    const presentKeys = new Set(Object.keys(raw as Record<string, unknown>));
    const setColumns: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of COLUMNS) {
      if (!presentKeys.has(field)) continue;
      values.push(parsed.data[field] ?? null);
      setColumns.push(`${column} = $${values.length}`);
    }
    if (setColumns.length === 0) return badRequest(c, 'no fields to update');

    values.push(id);
    const res = await deps.pool.query<RuleRow>(
      `UPDATE alert_rules SET ${setColumns.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    const row = res.rows[0];
    if (!row) return notFound(c, 'rule not found');
    deps.engine.invalidateRulesCache();
    return c.json(toApiRow(row));
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!id) return badRequest(c, 'missing id');
    const res = await deps.pool.query('DELETE FROM alert_rules WHERE id = $1', [id]);
    if (res.rowCount === 0) return notFound(c, 'rule not found');
    deps.engine.invalidateRulesCache();
    return c.body(null, 204);
  });

  return app;
}
