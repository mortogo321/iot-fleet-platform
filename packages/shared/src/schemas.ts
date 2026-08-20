import { z } from 'zod';
import { LIMITS, METRIC_BOUNDS } from './constants';

/** Telemetry payload published by devices. Unknown fields are rejected at the boundary. */
export const TelemetrySchema = z
  .object({
    ts: z.string().datetime({ offset: true }).optional(),
    temperature: z.number().min(METRIC_BOUNDS.temperature.min).max(METRIC_BOUNDS.temperature.max),
    humidity: z.number().min(METRIC_BOUNDS.humidity.min).max(METRIC_BOUNDS.humidity.max),
    battery: z.number().min(METRIC_BOUNDS.battery.min).max(METRIC_BOUNDS.battery.max),
  })
  .strict();
export type Telemetry = z.infer<typeof TelemetrySchema>;

/** Device shadow state — the keys a device knows how to apply/report. */
export const ShadowStateSchema = z
  .object({
    reportingIntervalMs: z
      .number()
      .int()
      .min(LIMITS.REPORTING_INTERVAL_MIN_MS)
      .max(LIMITS.REPORTING_INTERVAL_MAX_MS)
      .optional(),
    firmwareVersion: z.string().min(1).max(64).optional(),
    ledOn: z.boolean().optional(),
  })
  .strict();
export type ShadowState = z.infer<typeof ShadowStateSchema>;

export const ShadowDeltaSchema = z
  .object({ version: z.number().int().nonnegative(), state: ShadowStateSchema })
  .strict();
export type ShadowDelta = z.infer<typeof ShadowDeltaSchema>;

export const RpcMethodSchema = z.enum(['identify', 'reboot', 'readNow', 'getState']);
export type RpcMethod = z.infer<typeof RpcMethodSchema>;

export const RpcRequestSchema = z
  .object({
    id: z.string().uuid(),
    method: RpcMethodSchema,
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcResponseSchema = z
  .object({
    id: z.string().uuid(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict();
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

/** REST body for POST /api/devices/:id/rpc. */
export const RpcRequestBodySchema = z
  .object({
    method: RpcMethodSchema,
    params: z.record(z.string(), z.unknown()).optional(),
    timeoutMs: z.number().int().min(100).max(LIMITS.RPC_TIMEOUT_MAX_MS).optional(),
  })
  .strict();

export const OtaPhaseSchema = z.enum([
  'downloading',
  'verifying',
  'applying',
  'rebooting',
  'complete',
  'failed',
]);
export type OtaPhase = z.infer<typeof OtaPhaseSchema>;

export const OtaProgressSchema = z
  .object({
    version: z.string().min(1).max(64),
    phase: OtaPhaseSchema,
    progress: z.number().min(0).max(100),
    detail: z.string().max(200).optional(),
  })
  .strict();
export type OtaProgress = z.infer<typeof OtaProgressSchema>;

export const SeveritySchema = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

export const RuleOpSchema = z.enum(['gt', 'gte', 'lt', 'lte']);
export type RuleOp = z.infer<typeof RuleOpSchema>;

export const MetricNameSchema = z.enum(['temperature', 'humidity', 'battery']);

/** Alert rule. durationSec: condition must hold this long before firing (0 = instant). */
export const RuleInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    deviceId: z.string().min(1).max(64).nullable().optional(),
    kind: z.string().min(1).max(64).nullable().optional(),
    metric: MetricNameSchema,
    op: RuleOpSchema,
    threshold: z.number(),
    durationSec: z.number().int().min(0).max(86_400).default(0),
    cooldownSec: z.number().int().min(0).max(86_400).default(60),
    severity: SeveritySchema.default('warning'),
    webhookUrl: z.string().url().max(500).nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();
export type RuleInput = z.infer<typeof RuleInputSchema>;

export const ProvisionRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    kind: z.string().min(1).max(64).default('env-sensor'),
    location: z.string().min(1).max(120).optional(),
  })
  .strict();
export type ProvisionRequest = z.infer<typeof ProvisionRequestSchema>;

export const FirmwareInputSchema = z
  .object({
    version: z.string().min(1).max(64),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive(),
    notes: z.string().max(500).optional(),
  })
  .strict();
export type FirmwareInput = z.infer<typeof FirmwareInputSchema>;

/** EMQX HTTP authenticator request body (configured in infra/emqx/emqx.conf). */
export const MqttAuthRequestSchema = z.object({
  clientid: z.string(),
  username: z.string(),
  password: z.string(),
});

/** EMQX HTTP authorizer request body. */
export const MqttAclRequestSchema = z.object({
  clientid: z.string(),
  username: z.string(),
  topic: z.string(),
  action: z.enum(['publish', 'subscribe']),
});
