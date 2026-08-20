import type { ShadowState } from '@iot/shared';

type ShadowKey = keyof ShadowState;
const SHADOW_KEYS: ShadowKey[] = ['reportingIntervalMs', 'firmwareVersion', 'ledOn'];

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * PURE: keys present in `desired` whose value differs from `reported` (deep-equal per key).
 * Keys the device hasn't reported yet (undefined in `reported`) are included whenever desired
 * has a value for them.
 */
export function computeDelta(desired: ShadowState, reported: ShadowState): ShadowState {
  const delta: ShadowState = {};
  for (const key of SHADOW_KEYS) {
    const desiredValue = desired[key];
    if (desiredValue === undefined) continue;
    if (!valuesEqual(desiredValue, reported[key])) {
      (delta as Record<ShadowKey, unknown>)[key] = desiredValue;
    }
  }
  return delta;
}
