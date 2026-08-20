/**
 * Platform-wide defaults. Every credential here is a LOCAL DEV default, deliberately
 * non-secret and overridable via env — never ship these values to a public deployment.
 */
export const DEFAULTS = {
  PORT: 8080,
  DATABASE_URL: 'postgres://iot:iot@localhost:5432/iot',
  MQTT_URL: 'mqtt://localhost:1883',
  MQTT_SERVER_USERNAME: 'platform-server',
  MQTT_SERVER_PASSWORD: 'platform-secret-dev',
  MQTT_SHARED_GROUP: 'ingest',
  PROVISIONING_TOKEN: 'dev-provisioning-token',
  INTERNAL_TOKEN: 'dev-internal-token',
  WEBHOOK_SECRET: 'dev-webhook-secret',
  API_URL: 'http://localhost:8080',
  SIM_DEVICE_COUNT: 6,
  SIM_ANOMALY_CHANCE: 0.02,
  SIM_STATE_FILE: './.sim-state.json',
  LOG_LEVEL: 'info',
} as const;

export const LIMITS = {
  /** Ingest batcher: flush when either bound is hit. */
  BATCH_MAX_ROWS: 500,
  BATCH_FLUSH_MS: 500,
  /** Bounded ingest buffer — beyond this, oldest rows are dropped (counted). */
  BATCH_BUFFER_CAP: 10_000,
  /** Device timestamps further than this from server time are replaced with server time. */
  CLOCK_SKEW_MS: 5 * 60_000,
  RPC_TIMEOUT_MS: 10_000,
  RPC_TIMEOUT_MAX_MS: 30_000,
  TELEMETRY_QUERY_MAX_ROWS: 5_000,
  REPORTING_INTERVAL_MIN_MS: 500,
  REPORTING_INTERVAL_MAX_MS: 3_600_000,
  WEBHOOK_TIMEOUT_MS: 5_000,
  RULES_CACHE_TTL_MS: 30_000,
} as const;

export const METRIC_BOUNDS = {
  temperature: { min: -40, max: 85 },
  humidity: { min: 0, max: 100 },
  battery: { min: 0, max: 100 },
} as const;

export type MetricName = keyof typeof METRIC_BOUNDS;
export const METRIC_NAMES = Object.keys(METRIC_BOUNDS) as MetricName[];

export const DEVICE_ID_PREFIX = 'dev-';
export const DEVICE_SECRET_PREFIX = 'ds_';
