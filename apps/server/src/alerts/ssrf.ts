import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SsrfResolver {
  resolve(hostname: string): Promise<string[]>;
}

/** Real DNS-backed resolver; IP literals resolve to themselves without a lookup. */
export const defaultSsrfResolver: SsrfResolver = {
  async resolve(hostname: string): Promise<string[]> {
    if (isIP(hostname)) return [hostname];
    const records = await dnsLookup(hostname, { all: true });
    return records.map((r) => r.address);
  },
};

function isBlockedIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  const a = octets[0];
  const b = octets[1];
  if (a === undefined || b === undefined) return true;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 cloud metadata
  if (a === 0) return true; // "this network"
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized.startsWith('fd')) return true; // unique local fd00::/8
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true; // link-local fe80::/10
  }
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return isBlockedIpv4(mapped);
  }
  return false;
}

/** True if `ip` is loopback, private, link-local, or a known cloud metadata address. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // not a parseable address literal -> treat as unsafe
}

export type SsrfCheckResult = { safe: true; url: URL } | { safe: false; reason: string };

/** SSRF guard to run BEFORE fetching a user-supplied webhook URL. */
export async function checkWebhookUrl(
  rawUrl: string,
  resolver: SsrfResolver = defaultSsrfResolver,
): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { safe: false, reason: 'protocol must be http or https' };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = await resolver.resolve(hostname);
  } catch {
    return { safe: false, reason: 'dns resolution failed' };
  }
  if (addresses.length === 0) return { safe: false, reason: 'no addresses resolved' };

  for (const addr of addresses) {
    if (isBlockedIp(addr)) return { safe: false, reason: `blocked address ${addr}` };
  }
  return { safe: true, url };
}
