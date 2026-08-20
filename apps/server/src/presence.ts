import type { WsEvent } from '@iot/shared';
import { logger } from './log';

export type PresenceStatus = 'online' | 'offline';

export interface PresenceDeps {
  setStatus: (deviceId: string, status: PresenceStatus) => Promise<void>;
  wsPublish: (event: WsEvent) => void;
  /** Invoked when a device comes online, so the shadow store can push any pending delta. */
  onOnline?: (deviceId: string) => void;
}

function parseStatusPayload(payload: Buffer | string): PresenceStatus | undefined {
  const text = (typeof payload === 'string' ? payload : payload.toString('utf8')).trim();
  return text === 'online' || text === 'offline' ? text : undefined;
}

export async function handleStatus(
  deps: PresenceDeps,
  deviceId: string,
  payload: Buffer | string,
): Promise<void> {
  const status = parseStatusPayload(payload);
  if (!status) {
    logger.debug(`ignoring invalid status payload for ${deviceId}`);
    return;
  }
  await deps.setStatus(deviceId, status);
  deps.wsPublish({ type: 'presence', deviceId, status });
  if (status === 'online') deps.onOnline?.(deviceId);
}
