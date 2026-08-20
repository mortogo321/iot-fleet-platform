import { describe, expect, test } from 'bun:test';
import { createRpcManager, type RpcOutcome } from '../src/rpc/manager';

const REQ_1 = '11111111-1111-4111-8111-111111111111';
const REQ_2 = '22222222-2222-4222-8222-222222222222';
const REQ_3 = '33333333-3333-4333-8333-333333333333';
const REQ_4 = '44444444-4444-4444-8444-444444444444';
const REQ_5 = '55555555-5555-4555-8555-555555555555';

function fakeMetrics() {
  const calls: Array<{ method: string; outcome: RpcOutcome }> = [];
  return {
    sink: { incRequests: (method: string, outcome: RpcOutcome) => calls.push({ method, outcome }) },
    calls,
  };
}

describe('createRpcManager', () => {
  test('publishes the request and resolves when a matching response arrives', async () => {
    const published: Array<{ topic: string; payload: string }> = [];
    const { sink, calls } = fakeMetrics();
    const manager = createRpcManager({
      publisher: { publish: (topic, payload) => published.push({ topic, payload }) },
      metrics: sink,
      randomId: () => REQ_1,
    });

    const promise = manager.sendRpc('dev-1', 'identify', undefined, 5000);
    expect(manager.pendingCount()).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.topic).toBe(`devices/dev-1/rpc/request/${REQ_1}`);
    expect(JSON.parse(published[0]?.payload ?? '{}')).toEqual({ id: REQ_1, method: 'identify' });

    manager.handleResponse(REQ_1, { id: REQ_1, ok: true, result: { foo: 'bar' } });

    const res = await promise;
    expect(res).toEqual({ id: REQ_1, ok: true, result: { foo: 'bar' } });
    expect(calls).toEqual([{ method: 'identify', outcome: 'ok' }]);
    expect(manager.pendingCount()).toBe(0);
  });

  test('records an "error" outcome when the device reports ok:false', async () => {
    const { sink, calls } = fakeMetrics();
    const manager = createRpcManager({
      publisher: { publish: () => {} },
      metrics: sink,
      randomId: () => REQ_2,
    });

    const promise = manager.sendRpc('dev-1', 'reboot', undefined, 5000);
    manager.handleResponse(REQ_2, { id: REQ_2, ok: false, error: 'busy' });

    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('busy');
    expect(calls).toEqual([{ method: 'reboot', outcome: 'error' }]);
  });

  test('rejects with a timeout when no response arrives in time', async () => {
    const { sink, calls } = fakeMetrics();
    const manager = createRpcManager({
      publisher: { publish: () => {} },
      metrics: sink,
      randomId: () => REQ_3,
    });

    const promise = manager.sendRpc('dev-1', 'readNow', undefined, 20);
    await expect(promise).rejects.toThrow('device did not respond');
    expect(calls).toEqual([{ method: 'readNow', outcome: 'timeout' }]);
    expect(manager.pendingCount()).toBe(0);
  });

  test('ignores a response for a requestId that is not pending', () => {
    const { sink } = fakeMetrics();
    const manager = createRpcManager({ publisher: { publish: () => {} }, metrics: sink });
    expect(() => manager.handleResponse('not-pending-id', { id: REQ_4, ok: true })).not.toThrow();
  });

  test('ignores a malformed response body and lets the timeout handle it', async () => {
    const { sink, calls } = fakeMetrics();
    const manager = createRpcManager({
      publisher: { publish: () => {} },
      metrics: sink,
      randomId: () => REQ_5,
    });

    const promise = manager.sendRpc('dev-1', 'getState', undefined, 20);
    manager.handleResponse(REQ_5, { totally: 'wrong shape' });

    await expect(promise).rejects.toThrow('device did not respond');
    expect(calls).toEqual([{ method: 'getState', outcome: 'timeout' }]);
  });

  test('defaults timeoutMs when not provided', async () => {
    const { sink } = fakeMetrics();
    const manager = createRpcManager({
      publisher: { publish: () => {} },
      metrics: sink,
      randomId: () => REQ_1,
    });
    const promise = manager.sendRpc('dev-1', 'identify', undefined);
    expect(manager.pendingCount()).toBe(1);
    // Resolve immediately rather than waiting out the real 10s default timeout.
    manager.handleResponse(REQ_1, { id: REQ_1, ok: true });
    await promise;
  });
});
