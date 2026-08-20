import { describe, expect, test } from 'bun:test';
import { computeDelta } from '../src/shadow/delta';

describe('computeDelta', () => {
  test('returns empty delta when both are empty', () => {
    expect(computeDelta({}, {})).toEqual({});
  });

  test('includes a desired key the device has not reported yet', () => {
    expect(computeDelta({ reportingIntervalMs: 5000 }, {})).toEqual({ reportingIntervalMs: 5000 });
  });

  test('omits keys where desired equals reported', () => {
    expect(computeDelta({ ledOn: true }, { ledOn: true })).toEqual({});
  });

  test('includes keys where desired differs from reported', () => {
    expect(computeDelta({ firmwareVersion: '1.1.0' }, { firmwareVersion: '1.0.0' })).toEqual({
      firmwareVersion: '1.1.0',
    });
  });

  test('only returns the differing subset across multiple keys', () => {
    const desired = { reportingIntervalMs: 3000, ledOn: false, firmwareVersion: '1.1.0' };
    const reported = { reportingIntervalMs: 3000, ledOn: true, firmwareVersion: '1.1.0' };
    expect(computeDelta(desired, reported)).toEqual({ ledOn: false });
  });

  test('ignores reported keys that are not present in desired', () => {
    expect(computeDelta({}, { ledOn: true, firmwareVersion: '1.0.0' })).toEqual({});
  });

  test('is not mutated by repeated calls (pure)', () => {
    const desired = { reportingIntervalMs: 1000 };
    const reported = { reportingIntervalMs: 2000 };
    const first = computeDelta(desired, reported);
    const second = computeDelta(desired, reported);
    expect(first).toEqual(second);
    expect(desired).toEqual({ reportingIntervalMs: 1000 });
    expect(reported).toEqual({ reportingIntervalMs: 2000 });
  });
});
