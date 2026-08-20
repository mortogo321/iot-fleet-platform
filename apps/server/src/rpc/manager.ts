import {
  LIMITS,
  type RpcMethod,
  type RpcRequest,
  type RpcResponse,
  RpcResponseSchema,
  TOPICS,
} from '@iot/shared';

export type RpcOutcome = 'ok' | 'error' | 'timeout';

export interface RpcPublisher {
  publish(topic: string, payload: string): void;
}

export interface RpcMetricsSink {
  incRequests(method: string, outcome: RpcOutcome): void;
}

export interface RpcManagerDeps {
  publisher: RpcPublisher;
  metrics: RpcMetricsSink;
  randomId?: () => string;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface RpcManager {
  sendRpc(
    deviceId: string,
    method: RpcMethod,
    params: Record<string, unknown> | undefined,
    timeoutMs?: number,
  ): Promise<RpcResponse>;
  /** Feed a response arriving on devices/{id}/rpc/response/{requestId}. */
  handleResponse(requestId: string, raw: unknown): void;
  pendingCount(): number;
}

interface PendingRpc {
  method: RpcMethod;
  resolve: (res: RpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createRpcManager(deps: RpcManagerDeps): RpcManager {
  const pending = new Map<string, PendingRpc>();
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;

  function sendRpc(
    deviceId: string,
    method: RpcMethod,
    params: Record<string, unknown> | undefined,
    timeoutMs: number = LIMITS.RPC_TIMEOUT_MS,
  ): Promise<RpcResponse> {
    const requestId = randomId();
    const request: RpcRequest = { id: requestId, method, params };

    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeoutFn(() => {
        pending.delete(requestId);
        deps.metrics.incRequests(method, 'timeout');
        reject(new Error('device did not respond'));
      }, timeoutMs);
      (timer as { unref?: () => void }).unref?.();

      pending.set(requestId, { method, resolve, reject, timer });
      deps.publisher.publish(TOPICS.rpcRequest(deviceId, requestId), JSON.stringify(request));
    });
  }

  function handleResponse(requestId: string, raw: unknown): void {
    const entry = pending.get(requestId);
    if (!entry) return; // no matching pending request (late/duplicate delivery)

    const parsed = RpcResponseSchema.safeParse(raw);
    if (!parsed.success) return; // malformed response; let the timeout handle it

    pending.delete(requestId);
    clearTimeoutFn(entry.timer);
    deps.metrics.incRequests(entry.method, parsed.data.ok ? 'ok' : 'error');
    entry.resolve(parsed.data);
  }

  return { sendRpc, handleResponse, pendingCount: () => pending.size };
}
