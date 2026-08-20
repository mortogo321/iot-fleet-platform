import { loadConfig } from './config';
import { type DeviceHandle, startDevice } from './device';
import { createLogger } from './log';
import { provisionDevice } from './provision';
import { loadState, saveState } from './state';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);

  const state = await loadState(config.stateFile);
  const missing = Math.max(0, config.deviceCount - state.devices.length);

  for (let i = 0; i < missing; i++) {
    const name = `sim-device-${state.devices.length + 1}`;
    log.info('provisioning device', { name });
    const record = await provisionDevice(
      { apiUrl: config.apiUrl, provisioningToken: config.provisioningToken },
      name,
      log,
    );
    state.devices.push(record);
    await saveState(config.stateFile, state);
    log.info('provisioned device', { name, deviceId: record.deviceId });
  }

  log.info('starting fleet', { count: state.devices.length });
  const handles: DeviceHandle[] = state.devices.map((device) =>
    startDevice({
      deviceId: device.deviceId,
      secret: device.secret,
      mqttUrl: config.mqttUrl,
      anomalyChance: config.anomalyChance,
      log,
    }),
  );

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    await Promise.all(handles.map((h) => h.shutdown()));
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('simulator fatal error', err);
  process.exit(1);
});
