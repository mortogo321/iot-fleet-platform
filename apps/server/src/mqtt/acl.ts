import { parseTopic } from '@iot/shared';

export type MqttAclAction = 'publish' | 'subscribe';

/**
 * Pure EMQX authorizer decision. Devices are scoped to their own id (username === deviceId
 * from the topic); everything else denies. This function has NO special knowledge of the
 * platform server's own username — its is_superuser bypass is granted by the /auth response
 * and enforced by EMQX itself, never by this function.
 */
export function checkAcl(username: string, action: MqttAclAction, topic: string): boolean {
  const parsed = parseTopic(topic);
  if (!parsed) return false;
  if (parsed.deviceId !== username) return false;

  if (action === 'publish') {
    switch (parsed.kind) {
      case 'telemetry':
      case 'status':
      case 'shadow_reported':
      case 'ota_progress':
        return true;
      case 'rpc_response':
        return isConcreteSegment(parsed.requestId);
      default:
        return false;
    }
  }

  // action === 'subscribe'
  switch (parsed.kind) {
    case 'shadow_delta':
      return true;
    case 'rpc_request':
      // Devices only ever subscribe with the wildcard filter, never a concrete requestId.
      return parsed.requestId === '+';
    default:
      return false;
  }
}

function isConcreteSegment(segment: string | undefined): boolean {
  return typeof segment === 'string' && segment.length > 0 && segment !== '+' && segment !== '#';
}
