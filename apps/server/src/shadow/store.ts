import { type ShadowDelta, type ShadowState, TOPICS, type WsEvent } from '@iot/shared';
import type { Pool } from 'pg';
import { computeDelta } from './delta';

export interface ShadowRecord {
  deviceId: string;
  desired: ShadowState;
  reported: ShadowState;
  version: number;
}

export type PatchResult =
  | { ok: true; record: ShadowRecord }
  | { ok: false; reason: 'not_found' | 'version_conflict' };

export interface ShadowStoreDeps {
  pool: Pool;
  mqttPublish: (topic: string, payload: string) => void;
  wsPublish: (event: WsEvent) => void;
}

interface ShadowRow {
  id: string;
  shadow_desired: ShadowState;
  shadow_reported: ShadowState;
  shadow_version: string | number;
}

function toRecord(row: ShadowRow): ShadowRecord {
  return {
    deviceId: row.id,
    desired: row.shadow_desired,
    reported: row.shadow_reported,
    version: Number(row.shadow_version),
  };
}

export interface ShadowStore {
  get(deviceId: string): Promise<ShadowRecord | null>;
  patchDesired(deviceId: string, expectedVersion: number, patch: ShadowState): Promise<PatchResult>;
  /** Unconditional desired-merge used by trusted internal callers (e.g. the OTA manager). */
  setDesired(deviceId: string, patch: ShadowState): Promise<ShadowRecord | null>;
  applyReported(deviceId: string, reported: ShadowState): Promise<ShadowRecord | null>;
  /** Re-fetch and re-emit the current shadow (delta + WS) — used on device reconnect. */
  refreshAndPublish(deviceId: string): Promise<void>;
}

export function createShadowStore(deps: ShadowStoreDeps): ShadowStore {
  function emit(record: ShadowRecord): void {
    const delta = computeDelta(record.desired, record.reported);
    const event: WsEvent = {
      type: 'shadow',
      deviceId: record.deviceId,
      version: record.version,
      desired: record.desired,
      reported: record.reported,
      delta,
    };
    deps.wsPublish(event);
    if (Object.keys(delta).length > 0) {
      const payload: ShadowDelta = { version: record.version, state: delta };
      deps.mqttPublish(TOPICS.shadowDelta(record.deviceId), JSON.stringify(payload));
    }
  }

  async function get(deviceId: string): Promise<ShadowRecord | null> {
    const res = await deps.pool.query<ShadowRow>(
      'SELECT id, shadow_desired, shadow_reported, shadow_version FROM devices WHERE id = $1',
      [deviceId],
    );
    const row = res.rows[0];
    return row ? toRecord(row) : null;
  }

  async function patchDesired(
    deviceId: string,
    expectedVersion: number,
    patch: ShadowState,
  ): Promise<PatchResult> {
    const res = await deps.pool.query<ShadowRow>(
      `UPDATE devices
       SET shadow_desired = shadow_desired || $2::jsonb, shadow_version = shadow_version + 1
       WHERE id = $1 AND shadow_version = $3
       RETURNING id, shadow_desired, shadow_reported, shadow_version`,
      [deviceId, JSON.stringify(patch), expectedVersion],
    );
    const row = res.rows[0];
    if (!row) {
      const exists = await deps.pool.query('SELECT 1 FROM devices WHERE id = $1', [deviceId]);
      return exists.rowCount
        ? { ok: false, reason: 'version_conflict' }
        : { ok: false, reason: 'not_found' };
    }
    const record = toRecord(row);
    emit(record);
    return { ok: true, record };
  }

  async function setDesired(deviceId: string, patch: ShadowState): Promise<ShadowRecord | null> {
    const res = await deps.pool.query<ShadowRow>(
      `UPDATE devices
       SET shadow_desired = shadow_desired || $2::jsonb, shadow_version = shadow_version + 1
       WHERE id = $1
       RETURNING id, shadow_desired, shadow_reported, shadow_version`,
      [deviceId, JSON.stringify(patch)],
    );
    const row = res.rows[0];
    if (!row) return null;
    const record = toRecord(row);
    emit(record);
    return record;
  }

  async function applyReported(
    deviceId: string,
    reported: ShadowState,
  ): Promise<ShadowRecord | null> {
    const res = await deps.pool.query<ShadowRow>(
      `UPDATE devices
       SET shadow_reported = $2::jsonb
       WHERE id = $1
       RETURNING id, shadow_desired, shadow_reported, shadow_version`,
      [deviceId, JSON.stringify(reported)],
    );
    const row = res.rows[0];
    if (!row) return null;
    const record = toRecord(row);
    emit(record);
    return record;
  }

  async function refreshAndPublish(deviceId: string): Promise<void> {
    const record = await get(deviceId);
    if (record) emit(record);
  }

  return { get, patchDesired, setDesired, applyReported, refreshAndPublish };
}
