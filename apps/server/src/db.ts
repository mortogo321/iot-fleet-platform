import { Pool } from 'pg';
import { logger } from './log';

export interface TelemetryRow {
  time: Date;
  deviceId: string;
  temperature: number;
  humidity: number;
  battery: number;
}

export interface Db {
  pool: Pool;
  ping(): Promise<boolean>;
  insertTelemetryBatch(rows: TelemetryRow[]): Promise<void>;
  touchLastSeen(deviceIds: string[]): Promise<void>;
  findDeviceSecretHash(deviceId: string): Promise<string | null>;
  setDeviceStatus(deviceId: string, status: 'online' | 'offline'): Promise<void>;
  deviceExists(deviceId: string): Promise<boolean>;
  firmwareExists(version: string): Promise<boolean>;
  updateDeviceFirmwareVersion(deviceId: string, version: string): Promise<void>;
  end(): Promise<void>;
}

export function createDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });

  async function ping(): Promise<boolean> {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (err) {
      logger.error('db ping failed', err);
      return false;
    }
  }

  async function insertTelemetryBatch(rows: TelemetryRow[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const tuples: string[] = [];
    rows.forEach((row, i) => {
      const base = i * 5;
      tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      values.push(row.time, row.deviceId, row.temperature, row.humidity, row.battery);
    });
    const sql = `INSERT INTO telemetry (time, device_id, temperature, humidity, battery)
      VALUES ${tuples.join(', ')}
      ON CONFLICT (device_id, time) DO NOTHING`;
    await pool.query(sql, values);
  }

  async function touchLastSeen(deviceIds: string[]): Promise<void> {
    if (deviceIds.length === 0) return;
    await pool.query('UPDATE devices SET last_seen = now() WHERE id = ANY($1::text[])', [
      deviceIds,
    ]);
  }

  async function findDeviceSecretHash(deviceId: string): Promise<string | null> {
    const res = await pool.query<{ secret_hash: string }>(
      'SELECT secret_hash FROM devices WHERE id = $1',
      [deviceId],
    );
    return res.rows[0]?.secret_hash ?? null;
  }

  async function setDeviceStatus(deviceId: string, status: 'online' | 'offline'): Promise<void> {
    await pool.query('UPDATE devices SET status = $2 WHERE id = $1', [deviceId, status]);
  }

  async function deviceExists(deviceId: string): Promise<boolean> {
    const res = await pool.query('SELECT 1 FROM devices WHERE id = $1', [deviceId]);
    return (res.rowCount ?? 0) > 0;
  }

  async function firmwareExists(version: string): Promise<boolean> {
    const res = await pool.query('SELECT 1 FROM firmware WHERE version = $1', [version]);
    return (res.rowCount ?? 0) > 0;
  }

  async function updateDeviceFirmwareVersion(deviceId: string, version: string): Promise<void> {
    await pool.query('UPDATE devices SET firmware_version = $2 WHERE id = $1', [deviceId, version]);
  }

  async function end(): Promise<void> {
    await pool.end();
  }

  return {
    pool,
    ping,
    insertTelemetryBatch,
    touchLastSeen,
    findDeviceSecretHash,
    setDeviceStatus,
    deviceExists,
    firmwareExists,
    updateDeviceFirmwareVersion,
    end,
  };
}
