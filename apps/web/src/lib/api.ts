import type {
  AlertEvent,
  FirmwareInput,
  PlatformStats,
  RpcMethod,
  RuleInput,
  ShadowState,
} from '@iot/shared';

/**
 * Response shapes below (DeviceSummary, ShadowResponse, Rule, FirmwareRecord,
 * raw telemetry rows) are NOT exported by @iot/shared — the shared package only
 * defines request/body schemas and WS event types. These mirror the REST API
 * table in the spec plus the `infra/timescale/init.sql` column names
 * (camelCased), since apps/server owns the actual serialization.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // no JSON body on this error response — keep the status text
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface LatestTelemetry {
  ts: string;
  temperature: number;
  humidity: number;
  battery: number;
}

export interface DeviceSummary {
  id: string;
  name: string;
  kind: string;
  location: string | null;
  status: 'online' | 'offline';
  firmwareVersion: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  latest: LatestTelemetry | null;
}

export interface TelemetryPoint {
  ts: string;
  temperature: number;
  humidity: number;
  battery: number;
}

/** Loosely-typed raw row so we can defensively accept either raw or 1m-cagg field names. */
interface RawTelemetryRow {
  ts?: unknown;
  time?: unknown;
  bucket?: unknown;
  temperature?: unknown;
  temperature_avg?: unknown;
  humidity?: unknown;
  humidity_avg?: unknown;
  battery?: unknown;
  battery_avg?: unknown;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeTelemetryRow(row: RawTelemetryRow): TelemetryPoint | null {
  const ts = asString(row.ts) ?? asString(row.time) ?? asString(row.bucket);
  const temperature = asNumber(row.temperature) ?? asNumber(row.temperature_avg);
  const humidity = asNumber(row.humidity) ?? asNumber(row.humidity_avg);
  const battery = asNumber(row.battery) ?? asNumber(row.battery_avg);
  if (
    ts === undefined ||
    temperature === undefined ||
    humidity === undefined ||
    battery === undefined
  ) {
    return null;
  }
  return { ts, temperature, humidity, battery };
}

export function getStats(): Promise<PlatformStats> {
  return request('/stats');
}

export function listDevices(): Promise<DeviceSummary[]> {
  return request('/devices');
}

export function getDevice(deviceId: string): Promise<DeviceSummary> {
  return request(`/devices/${deviceId}`);
}

export type TelemetryBucket = 'raw' | '1m';

export async function getTelemetry(
  deviceId: string,
  minutes: number,
  bucket: TelemetryBucket,
): Promise<TelemetryPoint[]> {
  const rows = await request<RawTelemetryRow[]>(
    `/devices/${deviceId}/telemetry?minutes=${minutes}&bucket=${bucket}`,
  );
  const points: TelemetryPoint[] = [];
  for (const row of rows) {
    const point = normalizeTelemetryRow(row);
    if (point) points.push(point);
  }
  return points;
}

export interface ShadowResponse {
  desired: ShadowState;
  reported: ShadowState;
  delta: ShadowState;
  version: number;
}

export function getShadow(deviceId: string): Promise<ShadowResponse> {
  return request(`/devices/${deviceId}/shadow`);
}

export function patchShadow(
  deviceId: string,
  version: number,
  desired: ShadowState,
): Promise<ShadowResponse> {
  return request(`/devices/${deviceId}/shadow`, {
    method: 'PATCH',
    body: JSON.stringify({ version, desired }),
  });
}

export interface RpcResult {
  ok: boolean;
  result?: unknown;
}

export function callRpc(
  deviceId: string,
  method: RpcMethod,
  timeoutMs?: number,
): Promise<RpcResult> {
  return request(`/devices/${deviceId}/rpc`, {
    method: 'POST',
    body: JSON.stringify({ method, timeoutMs }),
  });
}

export function deployFirmware(deviceId: string, version: string): Promise<void> {
  return request(`/devices/${deviceId}/firmware`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export type FirmwareRecord = FirmwareInput & { createdAt: string };

export function listFirmware(): Promise<FirmwareRecord[]> {
  return request('/firmware');
}

export function listAlerts(status: 'active' | 'all', limit = 100): Promise<AlertEvent[]> {
  return request(`/alerts?status=${status}&limit=${limit}`);
}

export type Rule = RuleInput & { id: string; createdAt: string };

export function listRules(): Promise<Rule[]> {
  return request('/rules');
}

export function createRule(input: RuleInput): Promise<Rule> {
  return request('/rules', { method: 'POST', body: JSON.stringify(input) });
}

export function updateRule(id: string, patch: Partial<RuleInput>): Promise<Rule> {
  return request(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteRule(id: string): Promise<void> {
  return request(`/rules/${id}`, { method: 'DELETE' });
}
