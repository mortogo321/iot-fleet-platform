import type { OtaProgress, WsEvent } from '@iot/shared';

export type DeployResult =
  | { ok: true }
  | { ok: false; reason: 'device_not_found' | 'firmware_not_found' };

export interface OtaManagerDeps {
  deviceExists: (deviceId: string) => Promise<boolean>;
  firmwareExists: (version: string) => Promise<boolean>;
  setDesiredFirmware: (deviceId: string, version: string) => Promise<void>;
  updateDeviceFirmwareVersion: (deviceId: string, version: string) => Promise<void>;
  wsPublish: (event: WsEvent) => void;
  onPhaseMetric: (phase: 'complete' | 'failed') => void;
}

export interface OtaManager {
  deploy(deviceId: string, version: string): Promise<DeployResult>;
  handleProgress(deviceId: string, progress: OtaProgress): Promise<void>;
}

export function createOtaManager(deps: OtaManagerDeps): OtaManager {
  async function deploy(deviceId: string, version: string): Promise<DeployResult> {
    const [deviceOk, firmwareOk] = await Promise.all([
      deps.deviceExists(deviceId),
      deps.firmwareExists(version),
    ]);
    if (!deviceOk) return { ok: false, reason: 'device_not_found' };
    if (!firmwareOk) return { ok: false, reason: 'firmware_not_found' };
    await deps.setDesiredFirmware(deviceId, version);
    return { ok: true };
  }

  async function handleProgress(deviceId: string, progress: OtaProgress): Promise<void> {
    deps.wsPublish({ type: 'ota_progress', deviceId, progress });
    if (progress.phase === 'complete' || progress.phase === 'failed') {
      deps.onPhaseMetric(progress.phase);
    }
    if (progress.phase === 'complete') {
      await deps.updateDeviceFirmwareVersion(deviceId, progress.version);
    }
  }

  return { deploy, handleProgress };
}
