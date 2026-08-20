import type { ShadowState } from '@iot/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, getShadow, patchShadow, type ShadowResponse } from '../../lib/api';
import { useWsEvent } from '../../lib/ws';
import { useToast } from '../../toast/ToastProvider';

export function ShadowPanel({ deviceId }: { deviceId: string }) {
  const { push } = useToast();
  const [shadow, setShadow] = useState<ShadowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reportingIntervalMs, setReportingIntervalMs] = useState(3000);
  const [ledOn, setLedOn] = useState(false);

  const applyShadow = useCallback((res: ShadowResponse) => {
    setShadow(res);
    setReportingIntervalMs(
      res.desired.reportingIntervalMs ?? res.reported.reportingIntervalMs ?? 3000,
    );
    setLedOn(res.desired.ledOn ?? res.reported.ledOn ?? false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await getShadow(deviceId);
      applyShadow(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load shadow');
    } finally {
      setLoading(false);
    }
  }, [deviceId, applyShadow]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useWsEvent((event) => {
    if (event.type === 'shadow' && event.deviceId === deviceId) {
      applyShadow({
        version: event.version,
        desired: event.desired,
        reported: event.reported,
        delta: event.delta,
      });
    }
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!shadow) return;
    setSaving(true);
    const desired: ShadowState = { reportingIntervalMs, ledOn };
    try {
      const res = await patchShadow(deviceId, shadow.version, desired);
      applyShadow(res);
      push('shadow updated', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        push('shadow changed, refreshed', 'info');
        await refresh();
      } else {
        push(err instanceof Error ? err.message : 'failed to update shadow', 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="panel muted">loading shadow…</div>;
  if (error) return <div className="panel banner-error">{error}</div>;
  if (!shadow) return null;

  return (
    <div className="panel">
      <h3>Shadow</h3>
      <div className="shadow-columns">
        <ShadowJson label="Desired" value={shadow.desired} />
        <ShadowJson label="Reported" value={shadow.reported} />
        <ShadowJson label="Delta" value={shadow.delta} />
      </div>
      <form className="shadow-form" onSubmit={handleSubmit}>
        <label>
          Reporting interval (ms)
          <input
            type="number"
            min={500}
            max={3_600_000}
            value={reportingIntervalMs}
            onChange={(e) => setReportingIntervalMs(Number(e.target.value))}
          />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={ledOn} onChange={(e) => setLedOn(e.target.checked)} />
          LED on
        </label>
        <button type="submit" disabled={saving}>
          {saving ? 'Applying…' : 'Apply'}
        </button>
      </form>
    </div>
  );
}

function ShadowJson({ label, value }: { label: string; value: ShadowState }) {
  return (
    <div className="shadow-json">
      <div className="shadow-json-label muted">{label}</div>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
