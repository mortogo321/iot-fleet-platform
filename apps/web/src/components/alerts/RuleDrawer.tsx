import { type MetricName, RuleInputSchema, type RuleOp, type Severity } from '@iot/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { createRule, type DeviceSummary, type Rule, updateRule } from '../../lib/api';
import { METRIC_LABELS, METRIC_ORDER } from '../../lib/format';
import { useToast } from '../../toast/ToastProvider';

interface FormState {
  name: string;
  deviceId: string; // '' = all devices
  kind: string;
  metric: MetricName;
  op: RuleOp;
  threshold: string;
  durationSec: string;
  cooldownSec: string;
  severity: Severity;
  webhookUrl: string;
  enabled: boolean;
}

const DEFAULT_FORM: FormState = {
  name: '',
  deviceId: '',
  kind: '',
  metric: 'temperature',
  op: 'gt',
  threshold: '',
  durationSec: '0',
  cooldownSec: '60',
  severity: 'warning',
  webhookUrl: '',
  enabled: true,
};

function ruleToForm(rule: Rule): FormState {
  return {
    name: rule.name,
    deviceId: rule.deviceId ?? '',
    kind: rule.kind ?? '',
    metric: rule.metric,
    op: rule.op,
    threshold: String(rule.threshold),
    durationSec: String(rule.durationSec),
    cooldownSec: String(rule.cooldownSec),
    severity: rule.severity,
    webhookUrl: rule.webhookUrl ?? '',
    enabled: rule.enabled,
  };
}

interface RuleDrawerProps {
  open: boolean;
  initial: Rule | null;
  devices: DeviceSummary[];
  onClose: () => void;
  onSaved: (rule: Rule) => void;
}

export function RuleDrawer({ open, initial, devices, onClose, onSaved }: RuleDrawerProps) {
  const { push } = useToast();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initial ? ruleToForm(initial) : DEFAULT_FORM);
  }, [initial]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const candidate = {
      name: form.name.trim(),
      deviceId: form.deviceId || null,
      kind: form.kind.trim() || null,
      metric: form.metric,
      op: form.op,
      threshold: Number(form.threshold),
      durationSec: Number(form.durationSec),
      cooldownSec: Number(form.cooldownSec),
      severity: form.severity,
      webhookUrl: form.webhookUrl.trim() || null,
      enabled: form.enabled,
    };
    const parsed = RuleInputSchema.safeParse(candidate);
    if (!parsed.success) {
      push(parsed.error.issues[0]?.message ?? 'invalid rule', 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = initial
        ? await updateRule(initial.id, parsed.data)
        : await createRule(parsed.data);
      onSaved(saved);
      push(initial ? 'rule updated' : 'rule created', 'success');
      onClose();
    } catch (err) {
      push(err instanceof Error ? err.message : 'failed to save rule', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="drawer-root">
      <button type="button" className="drawer-backdrop" aria-label="Close" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true">
        <h3>{initial ? 'Edit rule' : 'New rule'}</h3>
        <form onSubmit={handleSubmit} className="rule-form">
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label>
            Device
            <select
              value={form.deviceId}
              onChange={(e) => setForm({ ...form, deviceId: e.target.value })}
            >
              <option value="">All devices</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind (optional)
            <input
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              placeholder="e.g. env-sensor"
            />
          </label>
          <label>
            Metric
            <select
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value as MetricName })}
            >
              {METRIC_ORDER.map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <div className="rule-form-row">
            <label>
              Operator
              <select
                value={form.op}
                onChange={(e) => setForm({ ...form, op: e.target.value as RuleOp })}
              >
                <option value="gt">&gt;</option>
                <option value="gte">&gt;=</option>
                <option value="lt">&lt;</option>
                <option value="lte">&lt;=</option>
              </select>
            </label>
            <label>
              Threshold
              <input
                type="number"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                required
              />
            </label>
          </div>
          <div className="rule-form-row">
            <label>
              Duration (sec)
              <input
                type="number"
                min={0}
                value={form.durationSec}
                onChange={(e) => setForm({ ...form, durationSec: e.target.value })}
              />
            </label>
            <label>
              Cooldown (sec)
              <input
                type="number"
                min={0}
                value={form.cooldownSec}
                onChange={(e) => setForm({ ...form, cooldownSec: e.target.value })}
              />
            </label>
          </div>
          <label>
            Severity
            <select
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Webhook URL (optional)
            <input
              value={form.webhookUrl}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
              placeholder="https://…"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
          <div className="drawer-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
