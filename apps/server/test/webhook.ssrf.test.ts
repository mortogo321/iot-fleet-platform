import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { checkWebhookUrl, isBlockedIp, type SsrfResolver } from '../src/alerts/ssrf';
import { signPayload } from '../src/alerts/webhook';

/** Injected resolver: maps a hostname to fixed addresses; literal IPs pass through unchanged. */
function fakeResolver(map: Record<string, string[]>): SsrfResolver {
  return {
    async resolve(hostname: string): Promise<string[]> {
      return map[hostname] ?? [hostname];
    },
  };
}

describe('isBlockedIp', () => {
  test('blocks IPv4 loopback', () => expect(isBlockedIp('127.0.0.1')).toBe(true));
  test('blocks IPv4 private ranges', () => {
    expect(isBlockedIp('10.1.2.3')).toBe(true);
    expect(isBlockedIp('172.16.0.5')).toBe(true);
    expect(isBlockedIp('172.31.255.254')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
  });
  test('blocks IPv4 link-local, including the cloud metadata address', () => {
    expect(isBlockedIp('169.254.1.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
  });
  test('blocks IPv6 loopback and unique-local (fd00::/8)', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fd00::1')).toBe(true);
    expect(isBlockedIp('fdab:cdef::1')).toBe(true);
  });
  test('blocks IPv6 link-local (fe80::/10)', () => {
    expect(isBlockedIp('fe80::1')).toBe(true);
  });
  test('allows a public IPv4 address', () => {
    expect(isBlockedIp('93.184.216.34')).toBe(false);
  });
  test('allows a public IPv6 address', () => {
    expect(isBlockedIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });
});

describe('checkWebhookUrl', () => {
  test('blocks a hostname that resolves to a loopback address', async () => {
    const resolver = fakeResolver({ 'internal.example': ['127.0.0.1'] });
    const result = await checkWebhookUrl('http://internal.example/hook', resolver);
    expect(result.safe).toBe(false);
  });

  test('blocks a hostname that resolves to a private address', async () => {
    const resolver = fakeResolver({ 'internal.example': ['10.0.0.5'] });
    const result = await checkWebhookUrl('https://internal.example/hook', resolver);
    expect(result.safe).toBe(false);
  });

  test('blocks a hostname that resolves to the cloud metadata address', async () => {
    const resolver = fakeResolver({ 'metadata.example': ['169.254.169.254'] });
    const result = await checkWebhookUrl('http://metadata.example/latest/meta-data', resolver);
    expect(result.safe).toBe(false);
  });

  test('blocks a link-local IPv6 (fe80::/10) resolution', async () => {
    const resolver = fakeResolver({ 'internal.example': ['fe80::1'] });
    const result = await checkWebhookUrl('http://internal.example/hook', resolver);
    expect(result.safe).toBe(false);
  });

  test('blocks a direct loopback IP literal in the URL', async () => {
    const resolver = fakeResolver({});
    const result = await checkWebhookUrl('http://127.0.0.1:9000/hook', resolver);
    expect(result.safe).toBe(false);
  });

  test('rejects non-http(s) protocols', async () => {
    const resolver = fakeResolver({ 'example.com': ['93.184.216.34'] });
    const result = await checkWebhookUrl('ftp://example.com/hook', resolver);
    expect(result.safe).toBe(false);
  });

  test('rejects an unparseable URL', async () => {
    const result = await checkWebhookUrl('not a url', fakeResolver({}));
    expect(result.safe).toBe(false);
  });

  test('allows a public hostname resolving to a public address', async () => {
    const resolver = fakeResolver({ 'example.com': ['93.184.216.34'] });
    const result = await checkWebhookUrl('https://example.com/hook', resolver);
    expect(result.safe).toBe(true);
    if (result.safe) expect(result.url.hostname).toBe('example.com');
  });
});

describe('signPayload (webhook HMAC)', () => {
  test('matches an independently computed HMAC-SHA256 hex digest', () => {
    const secret = 'test-secret';
    const body = '{"id":"abc","ok":true}';
    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(signPayload(secret, body)).toBe(expected);
  });

  test('changes when the body changes', () => {
    const secret = 'test-secret';
    const a = signPayload(secret, '{"a":1}');
    const b = signPayload(secret, '{"a":2}');
    expect(a).not.toBe(b);
  });

  test('changes when the secret changes', () => {
    const body = '{"a":1}';
    const a = signPayload('secret-a', body);
    const b = signPayload('secret-b', body);
    expect(a).not.toBe(b);
  });

  test('is prefixed with sha256=', () => {
    expect(signPayload('s', 'b')).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
