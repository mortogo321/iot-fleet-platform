import { createHmac } from 'node:crypto';
import { type AlertEvent, LIMITS } from '@iot/shared';
import { logger } from '../log';
import { checkWebhookUrl, type SsrfResolver } from './ssrf';

export type WebhookOutcome = 'sent' | 'blocked' | 'error';

export interface WebhookDeps {
  secret: string;
  resolver?: SsrfResolver;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  onResult?: (outcome: WebhookOutcome) => void;
}

/** hex(HMAC-SHA256(secret, rawBody)), formatted as the X-Signature header value. */
export function signPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** Fire-and-forget delivery: SSRF guard, then POST with a signed body and a hard timeout. */
export async function sendAlertWebhook(
  url: string,
  alert: AlertEvent,
  deps: WebhookDeps,
): Promise<void> {
  const check = await checkWebhookUrl(url, deps.resolver);
  if (!check.safe) {
    logger.warn(`webhook blocked for ${url}: ${check.reason}`);
    deps.onResult?.('blocked');
    return;
  }

  const rawBody = JSON.stringify(alert);
  const doFetch = deps.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? LIMITS.WEBHOOK_TIMEOUT_MS);

  try {
    const res = await doFetch(check.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-event-id': alert.id,
        'x-timestamp': new Date().toISOString(),
        'x-signature': signPayload(deps.secret, rawBody),
      },
      body: rawBody,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`webhook delivery to ${url} returned status ${res.status}`);
      deps.onResult?.('error');
      return;
    }
    deps.onResult?.('sent');
  } catch (err) {
    logger.warn(`webhook delivery failed for ${url}`, err);
    deps.onResult?.('error');
  } finally {
    clearTimeout(timer);
  }
}
