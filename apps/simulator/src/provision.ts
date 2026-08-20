import { z } from 'zod';
import type { Logger } from './log';
import type { DeviceRecord } from './state';
import { sleep } from './time';

const ProvisionResponseSchema = z.object({
  device: z.object({ id: z.string().min(1) }),
  secret: z.string().min(1),
});

export interface ProvisionConfig {
  apiUrl: string;
  provisioningToken: string;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/** Rejected by the server (bad token/body) — retrying won't help, surface it immediately. */
class NonRetryableProvisioningError extends Error {}

async function tryProvisionOnce(config: ProvisionConfig, name: string): Promise<DeviceRecord> {
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/devices`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-provisioning-token': config.provisioningToken,
      },
      body: JSON.stringify({ name }),
    });
  } catch (err) {
    throw new Error(`network error reaching ${config.apiUrl}: ${String(err)}`);
  }

  if (res.status >= 400 && res.status < 500) {
    const text = await res.text().catch(() => '');
    throw new NonRetryableProvisioningError(`provisioning rejected (${res.status}): ${text}`);
  }
  if (!res.ok) {
    throw new Error(`server error ${res.status}`);
  }

  const body = ProvisionResponseSchema.parse(await res.json());
  return { deviceId: body.device.id, secret: body.secret, name };
}

/** Self-provision one device via POST /api/devices, retrying with backoff until the server is reachable. */
export async function provisionDevice(
  config: ProvisionConfig,
  name: string,
  log: Logger,
): Promise<DeviceRecord> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await tryProvisionOnce(config, name);
    } catch (err) {
      if (err instanceof NonRetryableProvisioningError) throw err;
      const backoffMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
      log.warn('provisioning attempt failed, retrying', {
        name,
        attempt,
        backoffMs,
        error: String(err),
      });
      await sleep(backoffMs);
    }
  }
}
