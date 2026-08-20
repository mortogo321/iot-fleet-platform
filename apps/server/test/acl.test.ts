import { describe, expect, test } from 'bun:test';
import { checkAcl } from '../src/mqtt/acl';

const DEVICE = 'dev-aaaaaaaa';
const OTHER_DEVICE = 'dev-bbbbbbbb';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_USERNAME = 'platform-server';

describe('checkAcl — publish', () => {
  test('allows telemetry publish for its own device', () => {
    expect(checkAcl(DEVICE, 'publish', `telemetry/${DEVICE}`)).toBe(true);
  });

  test('allows status publish for its own device', () => {
    expect(checkAcl(DEVICE, 'publish', `devices/${DEVICE}/status`)).toBe(true);
  });

  test('allows shadow/reported publish for its own device', () => {
    expect(checkAcl(DEVICE, 'publish', `devices/${DEVICE}/shadow/reported`)).toBe(true);
  });

  test('allows ota/progress publish for its own device', () => {
    expect(checkAcl(DEVICE, 'publish', `devices/${DEVICE}/ota/progress`)).toBe(true);
  });

  test('allows rpc/response publish with a concrete requestId', () => {
    expect(checkAcl(DEVICE, 'publish', `devices/${DEVICE}/rpc/response/${REQUEST_ID}`)).toBe(true);
  });

  test('denies rpc/response publish with a wildcard requestId', () => {
    expect(checkAcl(DEVICE, 'publish', `devices/${DEVICE}/rpc/response/+`)).toBe(false);
  });

  test('denies cross-device telemetry publish', () => {
    expect(checkAcl(DEVICE, 'publish', `telemetry/${OTHER_DEVICE}`)).toBe(false);
  });

  test('denies cross-device status publish', () => {
    expect(checkAcl(DEVICE, 'publish', `devices/${OTHER_DEVICE}/status`)).toBe(false);
  });

  test('denies publish to the platform->device shadow/delta topic', () => {
    expect(checkAcl(DEVICE, 'publish', `devices/${DEVICE}/shadow/delta`)).toBe(false);
  });

  test('denies publish to the platform->device rpc/request topic', () => {
    expect(checkAcl(DEVICE, 'publish', `devices/${DEVICE}/rpc/request/${REQUEST_ID}`)).toBe(false);
  });

  test('denies publish to alerts (platform-only topic)', () => {
    expect(checkAcl(DEVICE, 'publish', `alerts/${DEVICE}`)).toBe(false);
  });

  test('denies publish to an unrecognized topic shape', () => {
    expect(checkAcl(DEVICE, 'publish', 'not/a/contract/topic')).toBe(false);
  });
});

describe('checkAcl — subscribe', () => {
  test('allows shadow/delta subscribe for its own device', () => {
    expect(checkAcl(DEVICE, 'subscribe', `devices/${DEVICE}/shadow/delta`)).toBe(true);
  });

  test('allows the rpc/request wildcard subscribe for its own device', () => {
    expect(checkAcl(DEVICE, 'subscribe', `devices/${DEVICE}/rpc/request/+`)).toBe(true);
  });

  test('denies subscribing to a concrete rpc/request/{id} (wildcard-only contract)', () => {
    expect(checkAcl(DEVICE, 'subscribe', `devices/${DEVICE}/rpc/request/${REQUEST_ID}`)).toBe(
      false,
    );
  });

  test('denies cross-device shadow/delta subscribe', () => {
    expect(checkAcl(DEVICE, 'subscribe', `devices/${OTHER_DEVICE}/shadow/delta`)).toBe(false);
  });

  test('denies subscribing to its own telemetry topic (device->platform only)', () => {
    expect(checkAcl(DEVICE, 'subscribe', `telemetry/${DEVICE}`)).toBe(false);
  });

  test('denies subscribing to its own status topic (device->platform only)', () => {
    expect(checkAcl(DEVICE, 'subscribe', `devices/${DEVICE}/status`)).toBe(false);
  });

  test('denies subscribing to alerts', () => {
    expect(checkAcl(DEVICE, 'subscribe', `alerts/${DEVICE}`)).toBe(false);
  });
});

describe('checkAcl — server-user case', () => {
  // EMQX never calls the ACL endpoint for the superuser (is_superuser bypasses ACL entirely,
  // granted purely by the /auth response) — these prove checkAcl itself has no special-cased
  // knowledge of the server's own username and would NOT grant it broad access on its own.
  test('denies the shared-subscription telemetry filter for the server username', () => {
    expect(checkAcl(SERVER_USERNAME, 'subscribe', '$share/ingest/telemetry/+')).toBe(false);
  });

  test('denies the plain wildcard telemetry filter for the server username', () => {
    expect(checkAcl(SERVER_USERNAME, 'subscribe', 'telemetry/+')).toBe(false);
  });

  test('still applies ordinary device rules symmetrically to the server username', () => {
    // Only true because the topic happens to be shaped like "this device's own" topic —
    // not because the function recognizes SERVER_USERNAME as special.
    expect(checkAcl(SERVER_USERNAME, 'subscribe', `devices/${SERVER_USERNAME}/shadow/delta`)).toBe(
      true,
    );
    expect(checkAcl(SERVER_USERNAME, 'publish', `devices/${SERVER_USERNAME}/status`)).toBe(true);
  });
});
