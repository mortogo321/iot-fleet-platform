-- IoT fleet platform schema. Runs once via docker-entrypoint-initdb.d.
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE devices (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  kind             text NOT NULL DEFAULT 'env-sensor',
  location         text,
  secret_hash      text NOT NULL,
  status           text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  firmware_version text NOT NULL DEFAULT '1.0.0',
  shadow_desired   jsonb  NOT NULL DEFAULT '{}'::jsonb,
  shadow_reported  jsonb  NOT NULL DEFAULT '{}'::jsonb,
  shadow_version   bigint NOT NULL DEFAULT 0,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz
);

-- Composite PK gives QoS1 redelivery idempotency (ON CONFLICT DO NOTHING) and
-- covers the hot query path (per-device time-ordered scans).
CREATE TABLE telemetry (
  time        timestamptz NOT NULL,
  device_id   text NOT NULL,
  temperature double precision NOT NULL,
  humidity    double precision NOT NULL,
  battery     double precision NOT NULL,
  PRIMARY KEY (device_id, time)
);

SELECT create_hypertable('telemetry', 'time');

CREATE MATERIALIZED VIEW telemetry_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  device_id,
  avg(temperature) AS temperature_avg,
  min(temperature) AS temperature_min,
  max(temperature) AS temperature_max,
  avg(humidity)    AS humidity_avg,
  min(humidity)    AS humidity_min,
  max(humidity)    AS humidity_max,
  avg(battery)     AS battery_avg,
  min(battery)     AS battery_min,
  max(battery)     AS battery_max
FROM telemetry
GROUP BY bucket, device_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_1m',
  start_offset      => INTERVAL '2 hours',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

SELECT add_retention_policy('telemetry', INTERVAL '30 days');

CREATE TABLE alert_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  device_id    text REFERENCES devices (id) ON DELETE CASCADE,
  kind         text,
  metric       text NOT NULL CHECK (metric IN ('temperature', 'humidity', 'battery')),
  op           text NOT NULL CHECK (op IN ('gt', 'gte', 'lt', 'lte')),
  threshold    double precision NOT NULL,
  duration_sec integer NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  cooldown_sec integer NOT NULL DEFAULT 60 CHECK (cooldown_sec >= 0),
  severity     text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  webhook_url  text,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      uuid NOT NULL REFERENCES alert_rules (id) ON DELETE CASCADE,
  device_id    text NOT NULL,
  metric       text NOT NULL,
  value        double precision NOT NULL,
  threshold    double precision NOT NULL,
  op           text NOT NULL,
  severity     text NOT NULL,
  message      text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

CREATE INDEX alerts_active_idx    ON alerts (device_id) WHERE resolved_at IS NULL;
CREATE INDEX alerts_triggered_idx ON alerts (triggered_at DESC);

CREATE TABLE firmware (
  version    text PRIMARY KEY,
  sha256     text NOT NULL,
  size_bytes bigint NOT NULL,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Simulated firmware artifacts (checksums are placeholders — OTA transfer is simulated).
INSERT INTO firmware (version, sha256, size_bytes, notes) VALUES
  ('1.0.0', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 524288,
   'Baseline firmware (factory image)'),
  ('1.1.0', 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210', 548864,
   'Adds adaptive reporting + sensor self-calibration');

INSERT INTO alert_rules (name, metric, op, threshold, duration_sec, cooldown_sec, severity) VALUES
  ('High temperature',        'temperature', 'gt', 35, 0,  120,  'warning'),
  ('Critical temperature',    'temperature', 'gt', 45, 0,  120,  'critical'),
  ('Sustained high humidity', 'humidity',    'gt', 90, 60, 300,  'warning'),
  ('Low battery',             'battery',     'lt', 15, 0,  3600, 'warning');
