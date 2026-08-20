import { describe, expect, test } from 'bun:test';
import type { TelemetryRow } from '../src/db';
import { type IngestDeps, type IngestMetricsSink, ingestTelemetry } from '../src/mqtt/ingest';

function makeDeps(clockValue: number = Date.now()) {
  const pushed: TelemetryRow[] = [];
  const results: Array<'accepted' | 'rejected'> = [];
  const metrics: IngestMetricsSink = { incMessages: (r) => results.push(r) };
  const deps: IngestDeps = {
    batcher: { push: (row) => pushed.push(row) },
    metrics,
    clock: () => clockValue,
  };
  return { deps, pushed, results };
}

describe('ingestTelemetry — validation', () => {
  test('accepts a valid payload', () => {
    const { deps, pushed, results } = makeDeps();
    const result = ingestTelemetry(deps, 'dev-1', { temperature: 20, humidity: 50, battery: 80 });
    expect(result.ok).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(results).toEqual(['accepted']);
  });

  test('rejects a payload with an unknown field', () => {
    const { deps, pushed, results } = makeDeps();
    const result = ingestTelemetry(deps, 'dev-1', {
      temperature: 20,
      humidity: 50,
      battery: 80,
      extra: 'nope',
    });
    expect(result.ok).toBe(false);
    expect(pushed).toHaveLength(0);
    expect(results).toEqual(['rejected']);
  });

  test('rejects temperature above the metric bound', () => {
    const { deps, results } = makeDeps();
    expect(ingestTelemetry(deps, 'dev-1', { temperature: 999, humidity: 50, battery: 80 }).ok).toBe(
      false,
    );
    expect(results).toEqual(['rejected']);
  });

  test('rejects temperature below the metric bound', () => {
    const { deps, results } = makeDeps();
    expect(
      ingestTelemetry(deps, 'dev-1', { temperature: -100, humidity: 50, battery: 80 }).ok,
    ).toBe(false);
    expect(results).toEqual(['rejected']);
  });

  test('rejects humidity outside [0, 100]', () => {
    const { deps, results } = makeDeps();
    expect(ingestTelemetry(deps, 'dev-1', { temperature: 20, humidity: 150, battery: 80 }).ok).toBe(
      false,
    );
    expect(results).toEqual(['rejected']);
  });

  test('rejects battery outside [0, 100]', () => {
    const { deps, results } = makeDeps();
    expect(ingestTelemetry(deps, 'dev-1', { temperature: 20, humidity: 50, battery: -1 }).ok).toBe(
      false,
    );
    expect(results).toEqual(['rejected']);
  });

  test('rejects a payload missing a required field', () => {
    const { deps, results } = makeDeps();
    expect(ingestTelemetry(deps, 'dev-1', { temperature: 20, humidity: 50 }).ok).toBe(false);
    expect(results).toEqual(['rejected']);
  });

  test('rejects non-object payloads', () => {
    const { deps, results } = makeDeps();
    expect(ingestTelemetry(deps, 'dev-1', 'not-json').ok).toBe(false);
    expect(ingestTelemetry(deps, 'dev-1', undefined).ok).toBe(false);
    expect(ingestTelemetry(deps, 'dev-1', null).ok).toBe(false);
    expect(results).toEqual(['rejected', 'rejected', 'rejected']);
  });

  test('replaces a wildly skewed device timestamp with server time', () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    const { deps, pushed } = makeDeps(now);
    const skewedTs = new Date(now - 3_600_000).toISOString(); // 1 hour in the past
    ingestTelemetry(deps, 'dev-1', { ts: skewedTs, temperature: 20, humidity: 50, battery: 80 });
    expect(pushed[0]?.time.getTime()).toBe(now);
  });

  test('keeps a device timestamp within the clock-skew tolerance', () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    const { deps, pushed } = makeDeps(now);
    const closeTs = new Date(now - 10_000).toISOString(); // 10s in the past
    ingestTelemetry(deps, 'dev-1', { ts: closeTs, temperature: 20, humidity: 50, battery: 80 });
    expect(pushed[0]?.time.getTime()).toBe(now - 10_000);
  });

  test('invokes onAccepted with the pushed row', () => {
    const { deps, pushed } = makeDeps();
    let seenDeviceId: string | undefined;
    let seenRow: TelemetryRow | undefined;
    const withHook: IngestDeps = {
      ...deps,
      onAccepted: (deviceId, row) => {
        seenDeviceId = deviceId;
        seenRow = row;
      },
    };
    ingestTelemetry(withHook, 'dev-9', { temperature: 1, humidity: 2, battery: 3 });
    expect(seenDeviceId).toBe('dev-9');
    expect(seenRow).toEqual(pushed[0]);
  });

  test('rejects without pushing when isOpen() returns false (shutdown gate)', () => {
    const { deps, pushed, results } = makeDeps();
    const closed: IngestDeps = { ...deps, isOpen: () => false };
    const result = ingestTelemetry(closed, 'dev-1', { temperature: 1, humidity: 2, battery: 3 });
    expect(result.ok).toBe(false);
    expect(pushed).toHaveLength(0);
    expect(results).toEqual([]);
  });
});
