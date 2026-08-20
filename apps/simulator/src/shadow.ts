import type { ShadowState } from '@iot/shared';

/** Baseline shadow state a freshly (re)provisioned device reports before any delta arrives. */
export const INITIAL_REPORTING_INTERVAL_MS = 3000;
export const INITIAL_FIRMWARE_VERSION = '1.0.0';

export function initialShadowState(): ShadowState {
  return {
    reportingIntervalMs: INITIAL_REPORTING_INTERVAL_MS,
    ledOn: false,
    firmwareVersion: INITIAL_FIRMWARE_VERSION,
  };
}

export interface ApplyShadowDeltaResult {
  /** The new reported state to publish (firmwareVersion is NOT bumped here — OTA does that on completion). */
  reported: ShadowState;
  /** True when reportingIntervalMs changed and the telemetry timer must restart. */
  restartTimer: boolean;
  /** True when ledOn changed (caller logs it — there's no physical LED to drive). */
  ledChanged: boolean;
  /** Set when firmwareVersion in the delta differs from what's currently reported — start an OTA run. */
  triggerOta: { fromVersion: string; toVersion: string } | null;
}

/**
 * Pure decision function for applying a shadow delta to the device's reported state.
 * firmwareVersion is deliberately excluded from the immediate merge: per spec, the reported
 * firmwareVersion only advances once the simulated OTA run reaches its 'complete' phase.
 */
export function applyShadowDelta(current: ShadowState, delta: ShadowState): ApplyShadowDeltaResult {
  const restartTimer =
    delta.reportingIntervalMs !== undefined &&
    delta.reportingIntervalMs !== current.reportingIntervalMs;
  const ledChanged = delta.ledOn !== undefined && delta.ledOn !== current.ledOn;
  const triggerOta =
    delta.firmwareVersion !== undefined && delta.firmwareVersion !== current.firmwareVersion
      ? { fromVersion: current.firmwareVersion ?? 'unknown', toVersion: delta.firmwareVersion }
      : null;

  const reported: ShadowState = {
    ...current,
    ...(delta.reportingIntervalMs !== undefined
      ? { reportingIntervalMs: delta.reportingIntervalMs }
      : {}),
    ...(delta.ledOn !== undefined ? { ledOn: delta.ledOn } : {}),
  };

  return { reported, restartTimer, ledChanged, triggerOta };
}
