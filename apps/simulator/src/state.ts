export interface DeviceRecord {
  deviceId: string;
  secret: string;
  name: string;
}

export interface SimState {
  devices: DeviceRecord[];
}

function isDeviceRecord(value: unknown): value is DeviceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceId === 'string' && typeof v.secret === 'string' && typeof v.name === 'string'
  );
}

/** Load persisted device credentials; missing or corrupt file ⇒ empty state (never throws). */
export async function loadState(path: string): Promise<SimState> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return { devices: [] };
    const data: unknown = await file.json();
    if (
      typeof data === 'object' &&
      data !== null &&
      Array.isArray((data as { devices?: unknown }).devices) &&
      (data as { devices: unknown[] }).devices.every(isDeviceRecord)
    ) {
      return data as SimState;
    }
    return { devices: [] };
  } catch {
    return { devices: [] };
  }
}

export async function saveState(path: string, state: SimState): Promise<void> {
  await Bun.write(path, `${JSON.stringify(state, null, 2)}\n`);
}
