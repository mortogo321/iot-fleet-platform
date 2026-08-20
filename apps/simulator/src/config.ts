import { DEFAULTS } from '@iot/shared';

/** Simulator runtime configuration. Env access lives ONLY here — see cross-cutting rules. */
export interface SimulatorConfig {
  apiUrl: string;
  mqttUrl: string;
  provisioningToken: string;
  deviceCount: number;
  anomalyChance: number;
  stateFile: string;
  logLevel: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): SimulatorConfig {
  return {
    apiUrl: process.env.API_URL ?? DEFAULTS.API_URL,
    mqttUrl: process.env.MQTT_URL ?? DEFAULTS.MQTT_URL,
    provisioningToken: process.env.PROVISIONING_TOKEN ?? DEFAULTS.PROVISIONING_TOKEN,
    deviceCount: envInt('SIM_DEVICE_COUNT', DEFAULTS.SIM_DEVICE_COUNT),
    anomalyChance: envFloat('SIM_ANOMALY_CHANCE', DEFAULTS.SIM_ANOMALY_CHANCE),
    stateFile: process.env.SIM_STATE_FILE ?? DEFAULTS.SIM_STATE_FILE,
    logLevel: process.env.LOG_LEVEL ?? DEFAULTS.LOG_LEVEL,
  };
}
