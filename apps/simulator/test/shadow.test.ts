import { describe, expect, it } from 'bun:test';
import type { ShadowState } from '@iot/shared';
import { applyShadowDelta } from '../src/shadow';

const BASE: ShadowState = { reportingIntervalMs: 3000, ledOn: false, firmwareVersion: '1.0.0' };

describe('applyShadowDelta (pure decision function)', () => {
  it('flags a timer restart when reportingIntervalMs changes', () => {
    const result = applyShadowDelta(BASE, { reportingIntervalMs: 1000 });
    expect(result.restartTimer).toBe(true);
    expect(result.reported.reportingIntervalMs).toBe(1000);
    expect(result.ledChanged).toBe(false);
    expect(result.triggerOta).toBeNull();
  });

  it('does not flag a restart when reportingIntervalMs is unchanged', () => {
    const result = applyShadowDelta(BASE, { reportingIntervalMs: 3000 });
    expect(result.restartTimer).toBe(false);
    expect(result.reported.reportingIntervalMs).toBe(3000);
  });

  it('detects ledOn toggles and applies them to reported state', () => {
    const result = applyShadowDelta(BASE, { ledOn: true });
    expect(result.ledChanged).toBe(true);
    expect(result.reported.ledOn).toBe(true);
    expect(result.restartTimer).toBe(false);
    expect(result.triggerOta).toBeNull();
  });

  it('does not flag ledChanged when ledOn matches current state', () => {
    const result = applyShadowDelta(BASE, { ledOn: false });
    expect(result.ledChanged).toBe(false);
  });

  it('triggers OTA on a firmwareVersion mismatch but leaves reported firmwareVersion untouched', () => {
    const result = applyShadowDelta(BASE, { firmwareVersion: '2.0.0' });
    expect(result.triggerOta).toEqual({ fromVersion: '1.0.0', toVersion: '2.0.0' });
    // Reported firmwareVersion only advances once the OTA run reaches 'complete'.
    expect(result.reported.firmwareVersion).toBe('1.0.0');
  });

  it('does not trigger OTA when firmwareVersion matches current', () => {
    const result = applyShadowDelta(BASE, { firmwareVersion: '1.0.0' });
    expect(result.triggerOta).toBeNull();
  });

  it('applies combined deltas independently in one pass', () => {
    const result = applyShadowDelta(BASE, {
      reportingIntervalMs: 5000,
      ledOn: true,
      firmwareVersion: '3.1.4',
    });
    expect(result.restartTimer).toBe(true);
    expect(result.ledChanged).toBe(true);
    expect(result.triggerOta).toEqual({ fromVersion: '1.0.0', toVersion: '3.1.4' });
    expect(result.reported).toEqual({
      reportingIntervalMs: 5000,
      ledOn: true,
      firmwareVersion: '1.0.0',
    });
  });

  it('is a no-op for an empty delta', () => {
    const result = applyShadowDelta(BASE, {});
    expect(result.restartTimer).toBe(false);
    expect(result.ledChanged).toBe(false);
    expect(result.triggerOta).toBeNull();
    expect(result.reported).toEqual(BASE);
  });
});
