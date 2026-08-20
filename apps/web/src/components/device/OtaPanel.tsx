import type { OtaProgress } from '@iot/shared';
import { useEffect, useState } from 'react';
import { deployFirmware, type FirmwareRecord, listFirmware } from '../../lib/api';
import { clamp } from '../../lib/format';
import { useWsEvent } from '../../lib/ws';
import { useToast } from '../../toast/ToastProvider';

export function OtaPanel({
  deviceId,
  currentVersion,
}: {
  deviceId: string;
  currentVersion: string | null;
}) {
  const { push } = useToast();
  const [firmware, setFirmware] = useState<FirmwareRecord[]>([]);
  const [selected, setSelected] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [progress, setProgress] = useState<OtaProgress | null>(null);
  const [lastCompleted, setLastCompleted] = useState<OtaProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listFirmware();
        if (cancelled) return;
        setFirmware(rows);
        const first = rows[0];
        if (first) setSelected(first.version);
      } catch {
        // best-effort: select stays empty if the firmware list can't be loaded
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useWsEvent((event) => {
    if (event.type !== 'ota_progress' || event.deviceId !== deviceId) return;
    setProgress(event.progress);
    if (event.progress.phase === 'complete' || event.progress.phase === 'failed') {
      setLastCompleted(event.progress);
      setDeploying(false);
    }
  });

  async function handleDeploy() {
    if (!selected) return;
    setDeploying(true);
    setProgress(null);
    try {
      await deployFirmware(deviceId, selected);
      push(`OTA deploy started: ${selected}`, 'info');
    } catch (err) {
      setDeploying(false);
      push(err instanceof Error ? err.message : 'failed to start OTA deploy', 'error');
    }
  }

  return (
    <div className="panel">
      <h3>OTA</h3>
      <div className="muted">running {currentVersion ?? 'unknown'}</div>
      <div className="ota-controls">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={firmware.length === 0}
        >
          {firmware.length === 0 && <option value="">no firmware registered</option>}
          {firmware.map((f) => (
            <option key={f.version} value={f.version}>
              {f.version}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleDeploy} disabled={!selected || deploying}>
          {deploying ? 'Deploying…' : 'Deploy'}
        </button>
      </div>

      {progress && (
        <div className="ota-progress">
          <div className="ota-progress-track">
            <div
              className="ota-progress-fill"
              style={{ width: `${clamp(progress.progress, 0, 100)}%` }}
            />
          </div>
          <div className="muted ota-progress-label">
            {progress.phase} — {progress.progress.toFixed(0)}%
            {progress.detail ? ` (${progress.detail})` : ''}
          </div>
        </div>
      )}

      {lastCompleted && (
        <div className="muted ota-history">
          Last update: {lastCompleted.version} — {lastCompleted.phase}
        </div>
      )}
    </div>
  );
}
