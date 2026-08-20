import type { OtaProgress, Severity, ShadowState, Telemetry } from './schemas';

/** Events streamed to the ops console over WS /ws (server → client only). */
export type WsEvent =
  | { type: 'telemetry'; deviceId: string; point: Telemetry & { ts: string } }
  | { type: 'presence'; deviceId: string; status: 'online' | 'offline' }
  | {
      type: 'shadow';
      deviceId: string;
      version: number;
      desired: ShadowState;
      reported: ShadowState;
      delta: ShadowState;
    }
  | { type: 'alert'; alert: AlertEvent }
  | { type: 'alert_resolved'; alert: AlertEvent }
  | { type: 'ota_progress'; deviceId: string; progress: OtaProgress }
  | { type: 'stats'; stats: PlatformStats };

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  deviceId: string;
  metric: string;
  value: number;
  threshold: number;
  op: string;
  severity: Severity;
  message: string;
  triggeredAt: string;
  resolvedAt: string | null;
}

export interface PlatformStats {
  devices: number;
  online: number;
  ingestRate1m: number;
  accepted: number;
  rejected: number;
  activeAlerts: number;
  wsClients: number;
  uptimeSec: number;
}
