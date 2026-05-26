export const PLATFORM_EVENT_SEVERITIES = ['info', 'warning', 'critical'] as const;

export const PLATFORM_EVENT_TYPES = [
  'pipeline.completed',
  'pipeline.failed',
  'review.pending',
  'review.decided',
  'review.escalated',
  'monitoring.alert',
  'monitoring.alert.acknowledged',
  'pipeline.review.timeout',
  'dead_letter.accumulated',
  'rate_limit.exceeded',
  'circuit_breaker.opened',
  'fidelity.threshold_breached',
] as const;

export const DELIVERY_ENDPOINT_TYPES = [
  'dashboard',
  'webhook',
  'slack',
  'email',
  'channel',
] as const;

export const DELIVERY_STATUSES = [
  'pending',
  'sent',
  'failed',
  'retry_scheduled',
  'dead_letter',
  'skipped_no_channel',
] as const;

export const GATEWAY_DECISIONS = [
  'approved',
  'rejected',
  'request_changes',
  'acknowledged',
  'dismissed',
] as const;

export const DECISION_ROUTE_STATUSES = [
  'pending',
  'routed',
  'failed',
  'rejected',
] as const;

export const CHANNEL_CONNECTION_STATUSES = [
  'connected',
  'stale',
  'disconnected',
] as const;

export const AUDIT_ACTIONS = [
  'event.accepted',
  'event.duplicate',
  'delivery.created',
  'delivery.sent',
  'delivery.failed',
  'delivery.retry_scheduled',
  'delivery.dead_lettered',
  'delivery.skipped_no_channel',
  'decision.accepted',
  'decision.duplicate',
  'decision.routed',
  'decision.failed',
  'decision.rejected',
] as const;

export type PlatformEventSeverity = (typeof PLATFORM_EVENT_SEVERITIES)[number];
export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[number] | `${string}.*`;
export type DeliveryEndpointType = (typeof DELIVERY_ENDPOINT_TYPES)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type GatewayDecision = (typeof GATEWAY_DECISIONS)[number];
export type DecisionSourceBackend = DeliveryEndpointType;
export type DecisionRouteStatus = (typeof DECISION_ROUTE_STATUSES)[number];
export type ChannelConnectionStatus = (typeof CHANNEL_CONNECTION_STATUSES)[number];
export type GatewayAuditAction = (typeof AUDIT_ACTIONS)[number];

export interface PlatformEventInput {
  tenantId: string;
  type: PlatformEventType;
  severity: PlatformEventSeverity;
  sourceSpec: string;
  sourceComponent: string;
  subjectType?: string;
  subjectId?: string;
  correlationId?: string;
  idempotencyKey: string;
  payloadSchemaVersion: string;
  requiresDecision: boolean;
  handlerKey?: string;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}

export interface GatewayDecisionHandlerContext {
  tenantId: string;
  eventId: string;
  handlerKey: string;
  decision: GatewayDecision;
  decisionBy: string;
  sourceBackend: DecisionSourceBackend;
  metadata: Record<string, unknown>;
}

export type GatewayDecisionHandlerResult =
  | {
      status: 'routed';
      summary?: Record<string, unknown>;
    }
  | {
      status: 'rejected' | 'failed';
      error: string;
      summary?: Record<string, unknown>;
    };

export class TenantMismatchError extends Error {
  constructor(
    readonly expectedTenantId: string,
    readonly actualTenantId: string,
    readonly resourceName: string,
  ) {
    super(
      `${resourceName} tenant mismatch: expected ${expectedTenantId}, received ${actualTenantId}`,
    );
    this.name = 'TenantMismatchError';
  }
}

export function assertTenantMatch(
  expectedTenantId: string,
  actualTenantId: string,
  resourceName: string,
): void {
  if (expectedTenantId !== actualTenantId) {
    throw new TenantMismatchError(expectedTenantId, actualTenantId, resourceName);
  }
}

const SENSITIVE_KEY_PATTERN = /(secret|token|password|credential|signature|authorization|webhook)/i;

export function redactSecretsDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsDeep(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecretsDeep(nestedValue),
      ]),
    );
  }

  return value;
}

export function sanitizeErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /(Bearer\s+)[A-Za-z0-9._~+/-]+=*|([?&](?:token|secret|signature)=)[^&\s]+/gi,
    '$1$2[REDACTED]',
  );
}
