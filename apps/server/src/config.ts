import { DEFAULTS } from '@iot/shared';

/** Single typed config object. Env access lives ONLY here — every other module takes config as a value. */
export interface Config {
  port: number;
  databaseUrl: string;
  mqttUrl: string;
  mqttServerUsername: string;
  mqttServerPassword: string;
  mqttSharedGroup: string;
  provisioningToken: string;
  internalToken: string;
  webhookSecret: string;
  logLevel: string;
}

function numEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: numEnv(env.PORT, DEFAULTS.PORT),
    databaseUrl: env.DATABASE_URL ?? DEFAULTS.DATABASE_URL,
    mqttUrl: env.MQTT_URL ?? DEFAULTS.MQTT_URL,
    mqttServerUsername: env.MQTT_SERVER_USERNAME ?? DEFAULTS.MQTT_SERVER_USERNAME,
    mqttServerPassword: env.MQTT_SERVER_PASSWORD ?? DEFAULTS.MQTT_SERVER_PASSWORD,
    // `??` (not `||`) so an explicit empty string (tests: plain-subscribe mode) survives.
    mqttSharedGroup: env.MQTT_SHARED_GROUP ?? DEFAULTS.MQTT_SHARED_GROUP,
    provisioningToken: env.PROVISIONING_TOKEN ?? DEFAULTS.PROVISIONING_TOKEN,
    internalToken: env.INTERNAL_TOKEN ?? DEFAULTS.INTERNAL_TOKEN,
    webhookSecret: env.WEBHOOK_SECRET ?? DEFAULTS.WEBHOOK_SECRET,
    logLevel: env.LOG_LEVEL ?? DEFAULTS.LOG_LEVEL,
  };
}

export const config: Config = loadConfig();
