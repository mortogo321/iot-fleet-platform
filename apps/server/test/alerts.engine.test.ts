import { describe, expect, test } from 'bun:test';
import type { AlertEvent, WsEvent } from '@iot/shared';
import {
  type AlertEngineDeps,
  type AlertRuleRow,
  createAlertEngine,
  type NewAlertInput,
} from '../src/alerts/engine';

function makeRule(overrides: Partial<AlertRuleRow> = {}): AlertRuleRow {
  return {
    id: 'rule-1',
    name: 'High temperature',
    deviceId: null,
    kind: null,
    metric: 'temperature',
    op: 'gt',
    threshold: 35,
    durationSec: 0,
    cooldownSec: 60,
    severity: 'warning',
    webhookUrl: null,
    enabled: true,
    ...overrides,
  };
}

function makeHarness(rules: AlertRuleRow[]) {
  let now = 0;
  let nextId = 1;
  const inserted: NewAlertInput[] = [];
  const resolved: Array<{ id: string; resolvedAt: Date }> = [];
  const wsEvents: WsEvent[] = [];
  const mqttPublishes: Array<{ topic: string; payload: string }> = [];
  const firedSeverities: string[] = [];

  const deps: AlertEngineDeps = {
    loadRules: async () => rules,
    loadDeviceKinds: async () => new Map(),
    insertAlert: async (input) => {
      inserted.push(input);
      const id = `alert-${nextId++}`;
      return { id, triggeredAt: new Date(now).toISOString() };
    },
    resolveAlert: async (id, resolvedAt) => {
      resolved.push({ id, resolvedAt });
    },
    wsPublish: (event) => wsEvents.push(event),
    mqttPublish: (topic, payload) => mqttPublishes.push({ topic, payload }),
    onFired: (severity) => firedSeverities.push(severity),
    clock: () => now,
    rulesCacheTtlMs: 100_000, // stays cached across a whole (fast) test
  };

  const engine = createAlertEngine(deps);
  return {
    engine,
    setNow: (ms: number) => {
      now = ms;
    },
    inserted,
    resolved,
    wsEvents,
    mqttPublishes,
    firedSeverities,
  };
}

const OK = { temperature: 20, humidity: 50, battery: 80 };
const HOT = { temperature: 40, humidity: 50, battery: 80 };

describe('alert engine', () => {
  test('instant fire: durationSec=0 fires on the first violating point', async () => {
    const h = makeHarness([makeRule({ durationSec: 0 })]);
    await h.engine.evaluate('dev-1', HOT);

    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({
      ruleId: 'rule-1',
      deviceId: 'dev-1',
      metric: 'temperature',
      value: 40,
    });
    expect(h.wsEvents).toHaveLength(1);
    expect(h.wsEvents[0]?.type).toBe('alert');
    expect(h.mqttPublishes).toHaveLength(1);
    expect(h.mqttPublishes[0]?.topic).toBe('alerts/dev-1');
    expect(h.firedSeverities).toEqual(['warning']);
  });

  test('does not fire while the metric is in range', async () => {
    const h = makeHarness([makeRule({ durationSec: 0 })]);
    await h.engine.evaluate('dev-1', OK);
    expect(h.inserted).toHaveLength(0);
  });

  test('sustained-not-yet: durationSec>0 does not fire before the duration elapses', async () => {
    const h = makeHarness([makeRule({ durationSec: 60, cooldownSec: 0 })]);
    h.setNow(0);
    await h.engine.evaluate('dev-1', HOT); // condition starts
    expect(h.inserted).toHaveLength(0);

    h.setNow(30_000); // only 30s of the required 60s
    await h.engine.evaluate('dev-1', HOT);
    expect(h.inserted).toHaveLength(0);
  });

  test('sustained-fire: fires once the duration has elapsed', async () => {
    const h = makeHarness([makeRule({ durationSec: 60, cooldownSec: 0 })]);
    h.setNow(0);
    await h.engine.evaluate('dev-1', HOT);
    h.setNow(30_000);
    await h.engine.evaluate('dev-1', HOT);
    expect(h.inserted).toHaveLength(0);

    h.setNow(61_000); // >= 60s since pendingSince
    await h.engine.evaluate('dev-1', HOT);
    expect(h.inserted).toHaveLength(1);
  });

  test('a sustained condition that clears before the duration elapses never fires', async () => {
    const h = makeHarness([makeRule({ durationSec: 60, cooldownSec: 0 })]);
    h.setNow(0);
    await h.engine.evaluate('dev-1', HOT);
    h.setNow(30_000);
    await h.engine.evaluate('dev-1', OK); // back in range before duration elapses
    h.setNow(70_000);
    await h.engine.evaluate('dev-1', HOT); // condition restarts from here
    expect(h.inserted).toHaveLength(0); // duration hasn't elapsed again yet
  });

  test('cooldown-suppressed: a second crossing within cooldownSec does not re-fire', async () => {
    const h = makeHarness([makeRule({ durationSec: 0, cooldownSec: 120 })]);
    h.setNow(0);
    await h.engine.evaluate('dev-1', HOT); // fires
    expect(h.inserted).toHaveLength(1);

    h.setNow(1_000);
    await h.engine.evaluate('dev-1', OK); // resolves
    h.setNow(2_000);
    await h.engine.evaluate('dev-1', HOT); // within cooldown of the first fire
    expect(h.inserted).toHaveLength(1); // still just the one alert
  });

  test('auto-resolve: back-in-range while active resolves the alert', async () => {
    const h = makeHarness([makeRule({ durationSec: 0, cooldownSec: 0 })]);
    await h.engine.evaluate('dev-1', HOT);
    expect(h.inserted).toHaveLength(1);

    h.setNow(5_000);
    await h.engine.evaluate('dev-1', OK);
    expect(h.resolved).toHaveLength(1);
    expect(h.resolved[0]?.id).toBe('alert-1');
    expect(h.wsEvents.some((e) => e.type === 'alert_resolved')).toBe(true);
  });

  test('re-fire after cooldown: fires again once cooldownSec has elapsed since the last fire', async () => {
    const h = makeHarness([makeRule({ durationSec: 0, cooldownSec: 60 })]);
    h.setNow(0);
    await h.engine.evaluate('dev-1', HOT); // fire #1
    h.setNow(1_000);
    await h.engine.evaluate('dev-1', OK); // resolve
    h.setNow(2_000);
    await h.engine.evaluate('dev-1', HOT); // within cooldown -> suppressed
    expect(h.inserted).toHaveLength(1);

    h.setNow(61_001); // now past cooldown, measured from the fire at t=0
    await h.engine.evaluate('dev-1', HOT);
    expect(h.inserted).toHaveLength(2);
  });

  test('an already-active alert does not fire a second row while still in violation', async () => {
    const h = makeHarness([makeRule({ durationSec: 0, cooldownSec: 0 })]);
    await h.engine.evaluate('dev-1', HOT);
    await h.engine.evaluate('dev-1', HOT);
    await h.engine.evaluate('dev-1', HOT);
    expect(h.inserted).toHaveLength(1);
  });

  test('device-scoped rules do not fire for other devices', async () => {
    const h = makeHarness([
      makeRule({ id: 'rule-temp', metric: 'temperature', threshold: 35, op: 'gt' }),
      makeRule({
        id: 'rule-device-scoped',
        deviceId: 'dev-2',
        metric: 'temperature',
        threshold: 10,
        op: 'gt',
      }),
    ]);
    await h.engine.evaluate('dev-1', HOT);
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]?.ruleId).toBe('rule-temp');
  });

  test('disabled rules never fire', async () => {
    const h = makeHarness([makeRule({ enabled: false })]);
    await h.engine.evaluate('dev-1', HOT);
    expect(h.inserted).toHaveLength(0);
  });

  test('invalidateRulesCache forces the next evaluate() to reload rules', async () => {
    let rules: AlertRuleRow[] = [makeRule({ enabled: false })];
    const inserted: NewAlertInput[] = [];
    const engine = createAlertEngine({
      loadRules: async () => rules,
      loadDeviceKinds: async () => new Map(),
      insertAlert: async (input) => {
        inserted.push(input);
        return { id: 'alert-1', triggeredAt: new Date(0).toISOString() };
      },
      resolveAlert: async () => {},
      wsPublish: () => {},
      mqttPublish: () => {},
      clock: () => 0,
      rulesCacheTtlMs: 100_000,
    });

    await engine.evaluate('dev-1', HOT);
    expect(inserted).toHaveLength(0); // disabled, cached

    rules = [makeRule({ enabled: true, durationSec: 0, cooldownSec: 0 })];
    engine.invalidateRulesCache();
    await engine.evaluate('dev-1', HOT);
    expect(inserted).toHaveLength(1);
  });

  test('sendWebhook fires only for rules with a webhookUrl', async () => {
    const webhookCalls: AlertEvent[] = [];
    const rules = [
      makeRule({ id: 'r-webhook', webhookUrl: 'https://example.com/hook', cooldownSec: 0 }),
    ];
    const engine = createAlertEngine({
      loadRules: async () => rules,
      loadDeviceKinds: async () => new Map(),
      insertAlert: async () => ({ id: 'alert-1', triggeredAt: new Date(0).toISOString() }),
      resolveAlert: async () => {},
      wsPublish: () => {},
      mqttPublish: () => {},
      sendWebhook: (_rule, alert) => webhookCalls.push(alert),
      clock: () => 0,
      rulesCacheTtlMs: 100_000,
    });

    await engine.evaluate('dev-1', HOT);
    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0]?.deviceId).toBe('dev-1');
  });
});
