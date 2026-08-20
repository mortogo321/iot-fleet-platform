import type { AlertEvent, RuleOp, Severity } from '@iot/shared';
import { useEffect, useState } from 'react';
import { RuleDrawer } from '../components/alerts/RuleDrawer';
import { EmptyState } from '../components/EmptyState';
import {
  type DeviceSummary,
  deleteRule,
  listAlerts,
  listDevices,
  listRules,
  type Rule,
  updateRule,
} from '../lib/api';
import { classNames, METRIC_LABELS } from '../lib/format';
import { useWsEvent } from '../lib/ws';
import { useToast } from '../toast/ToastProvider';

const OP_LABELS: Record<RuleOp, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

export function AlertsView() {
  const { push } = useToast();
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [alertsRes, rulesRes, devicesRes] = await Promise.all([
          listAlerts('all', 100),
          listRules(),
          listDevices(),
        ]);
        if (cancelled) return;
        setAlerts(alertsRes);
        setRules(rulesRes);
        setDevices(devicesRes);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load alerts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useWsEvent((event) => {
    if (event.type !== 'alert' && event.type !== 'alert_resolved') return;
    setAlerts((prev) => {
      const idx = prev.findIndex((a) => a.id === event.alert.id);
      if (idx === -1) return [event.alert, ...prev];
      const next = [...prev];
      next[idx] = event.alert;
      return next;
    });
  });

  const active = [...alerts]
    .filter((a) => !a.resolvedAt)
    .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  const history = [...alerts].sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]));

  function scopeLabel(rule: Rule): string {
    if (rule.deviceId) return deviceNameById.get(rule.deviceId) ?? rule.deviceId;
    if (rule.kind) return `kind: ${rule.kind}`;
    return 'All devices';
  }

  async function handleToggleRule(rule: Rule) {
    const nextEnabled = !rule.enabled;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: nextEnabled } : r)));
    try {
      await updateRule(rule.id, { enabled: nextEnabled });
    } catch (err) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      push(err instanceof Error ? err.message : 'failed to update rule', 'error');
    }
  }

  async function handleDeleteRule(rule: Rule) {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    const previous = rules;
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    try {
      await deleteRule(rule.id);
      push('rule deleted', 'success');
    } catch (err) {
      setRules(previous);
      push(err instanceof Error ? err.message : 'failed to delete rule', 'error');
    }
  }

  function handleSaved(rule: Rule) {
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.id === rule.id);
      if (idx === -1) return [rule, ...prev];
      const next = [...prev];
      next[idx] = rule;
      return next;
    });
  }

  return (
    <div className="view">
      {error && <div className="banner banner-error">{error}</div>}

      <div className="panel">
        <h3>Active alerts</h3>
        {!loading && active.length === 0 ? (
          <EmptyState title="No active alerts" hint="Your fleet is healthy right now." />
        ) : (
          <ul className="alert-list">
            {active.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h3>Alert history</h3>
        {!loading && history.length === 0 ? (
          <EmptyState title="No alerts recorded yet" />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Device</th>
                  <th>Rule</th>
                  <th>Condition</th>
                  <th>Value</th>
                  <th>Severity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{new Date(a.triggeredAt).toLocaleString()}</td>
                    <td>{a.deviceId}</td>
                    <td>{a.ruleName}</td>
                    <td className="mono">
                      {a.metric} {a.op} {a.threshold}
                    </td>
                    <td className="mono">{a.value}</td>
                    <td>
                      <SeverityBadge severity={a.severity} />
                    </td>
                    <td>{a.resolvedAt ? 'resolved' : 'active'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Rules</h3>
          <button
            type="button"
            onClick={() => {
              setEditingRule(null);
              setDrawerOpen(true);
            }}
          >
            New rule
          </button>
        </div>
        {!loading && rules.length === 0 ? (
          <EmptyState
            title="No rules configured yet"
            hint="Create one to start monitoring your fleet."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                  <th>Condition</th>
                  <th>Duration</th>
                  <th>Cooldown</th>
                  <th>Severity</th>
                  <th>Enabled</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="muted">{scopeLabel(r)}</td>
                    <td className="mono">
                      {METRIC_LABELS[r.metric]} {OP_LABELS[r.op]} {r.threshold}
                    </td>
                    <td className="mono">{r.durationSec}s</td>
                    <td className="mono">{r.cooldownSec}s</td>
                    <td>
                      <SeverityBadge severity={r.severity} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={classNames('toggle', r.enabled && 'toggle-on')}
                        onClick={() => handleToggleRule(r)}
                      >
                        {r.enabled ? 'on' : 'off'}
                      </button>
                    </td>
                    <td className="row-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRule(r);
                          setDrawerOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDeleteRule(r)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RuleDrawer
        open={drawerOpen}
        initial={editingRule}
        devices={devices}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}

function AlertRow({ alert }: { alert: AlertEvent }) {
  return (
    <li className={classNames('alert-row', `severity-${alert.severity}`)}>
      <span className="alert-row-severity" />
      <div className="alert-row-body">
        <div>{alert.message}</div>
        <div className="muted">
          {alert.deviceId} · {new Date(alert.triggeredAt).toLocaleTimeString()}
        </div>
      </div>
    </li>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={classNames('severity-badge', `severity-${severity}`)}>{severity}</span>;
}
