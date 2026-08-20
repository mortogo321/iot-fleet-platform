/** MQTT topic contract. Always build/parse topics through these helpers. */
export const TOPICS = {
  telemetry: (deviceId: string) => `telemetry/${deviceId}`,
  telemetryAll: 'telemetry/+',
  status: (deviceId: string) => `devices/${deviceId}/status`,
  statusAll: 'devices/+/status',
  shadowReported: (deviceId: string) => `devices/${deviceId}/shadow/reported`,
  shadowReportedAll: 'devices/+/shadow/reported',
  shadowDelta: (deviceId: string) => `devices/${deviceId}/shadow/delta`,
  rpcRequest: (deviceId: string, requestId: string) => `devices/${deviceId}/rpc/request/${requestId}`,
  rpcRequestSub: (deviceId: string) => `devices/${deviceId}/rpc/request/+`,
  rpcResponse: (deviceId: string, requestId: string) =>
    `devices/${deviceId}/rpc/response/${requestId}`,
  rpcResponseAll: 'devices/+/rpc/response/+',
  otaProgress: (deviceId: string) => `devices/${deviceId}/ota/progress`,
  otaProgressAll: 'devices/+/ota/progress',
  alerts: (deviceId: string) => `alerts/${deviceId}`,
} as const;

/** Wrap a topic filter in an MQTT shared subscription; empty group ⇒ plain subscribe (tests). */
export function sharedSub(group: string, topicFilter: string): string {
  return group ? `$share/${group}/${topicFilter}` : topicFilter;
}

/** Extract the deviceId from any platform topic; null when the topic isn't ours. */
export function deviceIdFromTopic(topic: string): string | null {
  const parts = topic.split('/');
  if (parts[0] === 'telemetry' && parts.length === 2 && parts[1]) return parts[1];
  if ((parts[0] === 'devices' || parts[0] === 'alerts') && parts.length >= 2 && parts[1]) {
    return parts[1];
  }
  return null;
}

export type TopicKind =
  | 'telemetry'
  | 'status'
  | 'shadow_reported'
  | 'shadow_delta'
  | 'rpc_request'
  | 'rpc_response'
  | 'ota_progress'
  | 'alerts';

export interface ParsedTopic {
  kind: TopicKind;
  deviceId: string;
  /** Present for rpc_request / rpc_response topics. */
  requestId?: string;
}

/** Structured parse of a platform topic; null when it doesn't match the contract. */
export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/');
  if (parts[0] === 'telemetry' && parts.length === 2 && parts[1]) {
    return { kind: 'telemetry', deviceId: parts[1] };
  }
  if (parts[0] === 'alerts' && parts.length === 2 && parts[1]) {
    return { kind: 'alerts', deviceId: parts[1] };
  }
  if (parts[0] !== 'devices' || !parts[1]) return null;
  const deviceId = parts[1];
  const rest = parts.slice(2);
  if (rest.length === 1 && rest[0] === 'status') return { kind: 'status', deviceId };
  if (rest.length === 2 && rest[0] === 'shadow' && rest[1] === 'reported') {
    return { kind: 'shadow_reported', deviceId };
  }
  if (rest.length === 2 && rest[0] === 'shadow' && rest[1] === 'delta') {
    return { kind: 'shadow_delta', deviceId };
  }
  if (rest.length === 3 && rest[0] === 'rpc' && rest[2]) {
    if (rest[1] === 'request') return { kind: 'rpc_request', deviceId, requestId: rest[2] };
    if (rest[1] === 'response') return { kind: 'rpc_response', deviceId, requestId: rest[2] };
  }
  if (rest.length === 2 && rest[0] === 'ota' && rest[1] === 'progress') {
    return { kind: 'ota_progress', deviceId };
  }
  return null;
}
