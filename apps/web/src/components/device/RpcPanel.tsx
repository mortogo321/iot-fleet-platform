import type { RpcMethod } from '@iot/shared';
import { useRef, useState } from 'react';
import { callRpc } from '../../lib/api';
import { classNames, formatHHmm } from '../../lib/format';
import { useToast } from '../../toast/ToastProvider';

const METHODS: Array<{ id: RpcMethod; label: string }> = [
  { id: 'identify', label: 'Identify' },
  { id: 'readNow', label: 'Read now' },
  { id: 'reboot', label: 'Reboot' },
  { id: 'getState', label: 'Get state' },
];

const LOG_MAX = 20;

interface LogEntry {
  id: number;
  method: RpcMethod;
  at: string;
  status: 'ok' | 'error';
  detail: string;
}

function summarizeResult(result: unknown): string {
  if (result === undefined) return 'ok';
  try {
    const text = JSON.stringify(result);
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  } catch {
    return 'ok';
  }
}

export function RpcPanel({ deviceId }: { deviceId: string }) {
  const { push } = useToast();
  const [pending, setPending] = useState<RpcMethod | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const nextId = useRef(0);

  function appendLog(entry: Omit<LogEntry, 'id' | 'at'>) {
    setLog((prev) =>
      [{ id: ++nextId.current, at: new Date().toISOString(), ...entry }, ...prev].slice(0, LOG_MAX),
    );
  }

  async function invoke(method: RpcMethod) {
    setPending(method);
    try {
      const res = await callRpc(deviceId, method);
      const detail = summarizeResult(res.result);
      push(`${method}: ${detail}`, 'success');
      appendLog({ method, status: 'ok', detail });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'request failed';
      push(`${method}: ${detail}`, 'error');
      appendLog({ method, status: 'error', detail });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="panel">
      <h3>RPC</h3>
      <div className="rpc-buttons">
        {METHODS.map((m) => (
          <button key={m.id} type="button" disabled={pending !== null} onClick={() => invoke(m.id)}>
            {pending === m.id ? '…' : m.label}
          </button>
        ))}
      </div>
      {log.length === 0 ? (
        <div className="muted">no RPC calls yet</div>
      ) : (
        <ul className="rpc-log">
          {log.map((entry) => (
            <li key={entry.id} className={classNames(entry.status === 'error' && 'text-crit')}>
              <span className="mono">{formatHHmm(entry.at)}</span> {entry.method} — {entry.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
