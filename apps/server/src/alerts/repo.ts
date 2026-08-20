import type { MetricName, RuleOp, Severity } from '@iot/shared';
import type { Pool } from 'pg';
import type { AlertEngineDeps, AlertRuleRow, NewAlertInput } from './engine';

interface RuleRow {
  id: string;
  name: string;
  device_id: string | null;
  kind: string | null;
  metric: MetricName;
  op: RuleOp;
  threshold: number;
  duration_sec: number;
  cooldown_sec: number;
  severity: Severity;
  webhook_url: string | null;
  enabled: boolean;
}

function toRuleRow(row: RuleRow): AlertRuleRow {
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
  };
}

/** DB-backed implementation of the alert engine's repo dependencies (production wiring). */
export function createAlertRepo(
  pool: Pool,
): Pick<AlertEngineDeps, 'loadRules' | 'loadDeviceKinds' | 'insertAlert' | 'resolveAlert'> {
  async function loadRules(): Promise<AlertRuleRow[]> {
    const res = await pool.query<RuleRow>(
      `SELECT id, name, device_id, kind, metric, op, threshold, duration_sec, cooldown_sec,
              severity, webhook_url, enabled
       FROM alert_rules`,
    );
    return res.rows.map(toRuleRow);
  }

  async function loadDeviceKinds(): Promise<Map<string, string>> {
    const res = await pool.query<{ id: string; kind: string }>('SELECT id, kind FROM devices');
    return new Map(res.rows.map((r) => [r.id, r.kind]));
  }

  async function insertAlert(input: NewAlertInput): Promise<{ id: string; triggeredAt: string }> {
    const res = await pool.query<{ id: string; triggered_at: Date }>(
      `INSERT INTO alerts (rule_id, device_id, metric, value, threshold, op, severity, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, triggered_at`,
      [
        input.ruleId,
        input.deviceId,
        input.metric,
        input.value,
        input.threshold,
        input.op,
        input.severity,
        input.message,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('insertAlert: INSERT returned no row');
    return { id: row.id, triggeredAt: row.triggered_at.toISOString() };
  }

  async function resolveAlert(alertId: string, resolvedAt: Date): Promise<void> {
    await pool.query('UPDATE alerts SET resolved_at = $2 WHERE id = $1', [alertId, resolvedAt]);
  }

  return { loadRules, loadDeviceKinds, insertAlert, resolveAlert };
}
