import {
  type AlertEvent,
  METRIC_NAMES,
  type MetricName,
  type RuleOp,
  type Severity,
  TOPICS,
  type WsEvent,
} from '@iot/shared';

export interface AlertRuleRow {
  id: string;
  name: string;
  deviceId: string | null;
  kind: string | null;
  metric: MetricName;
  op: RuleOp;
  threshold: number;
  durationSec: number;
  cooldownSec: number;
  severity: Severity;
  webhookUrl: string | null;
  enabled: boolean;
}

export interface NewAlertInput {
  ruleId: string;
  deviceId: string;
  metric: MetricName;
  value: number;
  threshold: number;
  op: RuleOp;
  severity: Severity;
  message: string;
}

export interface AlertEngineDeps {
  loadRules: () => Promise<AlertRuleRow[]>;
  loadDeviceKinds: () => Promise<Map<string, string>>;
  insertAlert: (input: NewAlertInput) => Promise<{ id: string; triggeredAt: string }>;
  resolveAlert: (alertId: string, resolvedAt: Date) => Promise<void>;
  wsPublish: (event: WsEvent) => void;
  mqttPublish: (topic: string, payload: string) => void;
  sendWebhook?: (rule: AlertRuleRow, alert: AlertEvent) => void;
  onFired?: (severity: Severity) => void;
  /** Injectable clock — drives sustained-duration + cooldown bookkeeping. */
  clock?: () => number;
  rulesCacheTtlMs?: number;
}

export interface TelemetryValues {
  temperature: number;
  humidity: number;
  battery: number;
}

interface ActiveAlert {
  id: string;
  triggeredAt: string;
  value: number;
}

interface RuleDeviceState {
  pendingSince?: number;
  active?: ActiveAlert;
  lastFiredAt?: number;
}

interface RulesCache {
  rules: AlertRuleRow[];
  deviceKinds: Map<string, string>;
  loadedAt: number;
}

export interface AlertEngine {
  evaluate(deviceId: string, telemetry: TelemetryValues): Promise<void>;
  invalidateRulesCache(): void;
}

function compare(value: number, op: RuleOp, threshold: number): boolean {
  switch (op) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
  }
}

function formatMessage(rule: AlertRuleRow, value: number): string {
  return `${rule.name}: ${rule.metric} ${rule.op} ${rule.threshold} (current ${value})`;
}

export function createAlertEngine(deps: AlertEngineDeps): AlertEngine {
  const clock = deps.clock ?? Date.now;
  const rulesCacheTtlMs = deps.rulesCacheTtlMs ?? 30_000;

  let cache: RulesCache | undefined;
  let loading: Promise<void> | null = null;
  const states = new Map<string, RuleDeviceState>();

  function invalidateRulesCache(): void {
    cache = undefined;
  }

  async function ensureCache(): Promise<void> {
    const now = clock();
    if (cache && now - cache.loadedAt < rulesCacheTtlMs) return;
    if (!loading) {
      loading = (async () => {
        const [rules, deviceKinds] = await Promise.all([deps.loadRules(), deps.loadDeviceKinds()]);
        cache = { rules, deviceKinds, loadedAt: clock() };
      })().finally(() => {
        loading = null;
      });
    }
    await loading;
  }

  async function fire(
    rule: AlertRuleRow,
    deviceId: string,
    value: number,
    now: number,
    key: string,
  ): Promise<void> {
    const state = states.get(key) ?? {};
    const { id, triggeredAt } = await deps.insertAlert({
      ruleId: rule.id,
      deviceId,
      metric: rule.metric,
      value,
      threshold: rule.threshold,
      op: rule.op,
      severity: rule.severity,
      message: formatMessage(rule, value),
    });

    state.active = { id, triggeredAt, value };
    state.lastFiredAt = now;
    state.pendingSince = undefined;
    states.set(key, state);

    deps.onFired?.(rule.severity);
    const event: AlertEvent = {
      id,
      ruleId: rule.id,
      ruleName: rule.name,
      deviceId,
      metric: rule.metric,
      value,
      threshold: rule.threshold,
      op: rule.op,
      severity: rule.severity,
      message: formatMessage(rule, value),
      triggeredAt,
      resolvedAt: null,
    };
    deps.wsPublish({ type: 'alert', alert: event });
    deps.mqttPublish(TOPICS.alerts(deviceId), JSON.stringify(event));
    if (rule.webhookUrl) deps.sendWebhook?.(rule, event);
  }

  async function resolveActive(
    rule: AlertRuleRow,
    deviceId: string,
    now: number,
    key: string,
  ): Promise<void> {
    const state = states.get(key);
    if (!state?.active) return;
    const active = state.active;
    const resolvedAtIso = new Date(now).toISOString();
    await deps.resolveAlert(active.id, new Date(now));

    state.active = undefined;
    state.pendingSince = undefined;
    states.set(key, state);

    const event: AlertEvent = {
      id: active.id,
      ruleId: rule.id,
      ruleName: rule.name,
      deviceId,
      metric: rule.metric,
      value: active.value,
      threshold: rule.threshold,
      op: rule.op,
      severity: rule.severity,
      message: `${rule.name} resolved`,
      triggeredAt: active.triggeredAt,
      resolvedAt: resolvedAtIso,
    };
    deps.wsPublish({ type: 'alert_resolved', alert: event });
  }

  async function evalOne(rule: AlertRuleRow, deviceId: string, value: number): Promise<void> {
    const key = `${rule.id}:${deviceId}`;
    const now = clock();
    const violated = compare(value, rule.op, rule.threshold);
    const state = states.get(key) ?? {};

    if (!violated) {
      if (state.active) {
        await resolveActive(rule, deviceId, now, key);
      } else if (state.pendingSince !== undefined) {
        state.pendingSince = undefined;
        states.set(key, state);
      }
      return;
    }

    if (state.active) {
      return; // already firing; stays active until back in range
    }

    if (rule.durationSec > 0) {
      if (state.pendingSince === undefined) {
        state.pendingSince = now;
        states.set(key, state);
        return; // sustained-not-yet
      }
      if (now - state.pendingSince < rule.durationSec * 1000) {
        return; // still pending
      }
    }

    if (state.lastFiredAt !== undefined && now - state.lastFiredAt < rule.cooldownSec * 1000) {
      return; // cooldown-suppressed; pendingSince stays frozen so it fires as soon as cooldown clears
    }

    await fire(rule, deviceId, value, now, key);
  }

  async function evaluate(deviceId: string, telemetry: TelemetryValues): Promise<void> {
    await ensureCache();
    const activeCache = cache;
    if (!activeCache) return;
    const kind = activeCache.deviceKinds.get(deviceId);

    for (const metric of METRIC_NAMES) {
      const value = telemetry[metric];
      for (const rule of activeCache.rules) {
        if (!rule.enabled || rule.metric !== metric) continue;
        if (rule.deviceId !== null && rule.deviceId !== deviceId) continue;
        if (rule.kind !== null && rule.kind !== kind) continue;
        await evalOne(rule, deviceId, value);
      }
    }
  }

  return { evaluate, invalidateRulesCache };
}
