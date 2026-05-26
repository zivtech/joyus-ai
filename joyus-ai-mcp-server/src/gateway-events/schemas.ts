import { z } from 'zod';

import {
  CHANNEL_CONNECTION_STATUSES,
  DECISION_ROUTE_STATUSES,
  DELIVERY_ENDPOINT_TYPES,
  DELIVERY_STATUSES,
  GATEWAY_DECISIONS,
  PLATFORM_EVENT_SEVERITIES,
  PLATFORM_EVENT_TYPES,
  type PlatformEventType,
} from './types.js';

const nonEmptyText = z.string().trim().min(1);
const payloadSchema = z.record(z.string(), z.unknown());

export const tenantIdSchema = nonEmptyText;

export const platformEventSeveritySchema = z.enum(PLATFORM_EVENT_SEVERITIES);
export const deliveryEndpointTypeSchema = z.enum(DELIVERY_ENDPOINT_TYPES);
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export const gatewayDecisionSchema = z.enum(GATEWAY_DECISIONS);
export const decisionSourceBackendSchema = deliveryEndpointTypeSchema;
export const decisionRouteStatusSchema = z.enum(DECISION_ROUTE_STATUSES);
export const channelConnectionStatusSchema = z.enum(CHANNEL_CONNECTION_STATUSES);

const exactPlatformEventTypeSchema = z.enum(PLATFORM_EVENT_TYPES);
const wildcardPlatformEventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*\.\*$/);

export const platformEventTypeSchema = z.union([
  exactPlatformEventTypeSchema,
  wildcardPlatformEventTypeSchema,
]) as z.ZodType<PlatformEventType>;

export const platformEventInputSchema = z
  .object({
    tenantId: tenantIdSchema,
    type: platformEventTypeSchema,
    severity: platformEventSeveritySchema,
    sourceSpec: nonEmptyText,
    sourceComponent: nonEmptyText,
    subjectType: nonEmptyText.optional(),
    subjectId: nonEmptyText.optional(),
    correlationId: nonEmptyText.optional(),
    idempotencyKey: nonEmptyText,
    payloadSchemaVersion: nonEmptyText,
    requiresDecision: z.boolean().default(false),
    handlerKey: nonEmptyText.optional(),
    payload: payloadSchema,
    occurredAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.requiresDecision && !value.handlerKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['handlerKey'],
        message: 'handlerKey is required when requiresDecision is true',
      });
    }
  });
export type PlatformEventInput = z.input<typeof platformEventInputSchema>;

const baseEndpointInputSchema = z.object({
  tenantId: tenantIdSchema,
  name: nonEmptyText,
  isActive: z.boolean().default(true),
  createdBy: nonEmptyText.optional(),
});

export const dashboardEndpointInputSchema = baseEndpointInputSchema.extend({
  type: z.literal('dashboard'),
});

export const webhookEndpointInputSchema = baseEndpointInputSchema.extend({
  type: z.literal('webhook'),
  url: z.string().url(),
  hmacSecretRef: nonEmptyText,
});

export const slackEndpointInputSchema = baseEndpointInputSchema.extend({
  type: z.literal('slack'),
  webhookSecretRef: nonEmptyText,
});

export const emailEndpointInputSchema = baseEndpointInputSchema.extend({
  type: z.literal('email'),
  addresses: z.array(z.string().email()).min(1),
  credentialSecretRef: nonEmptyText.optional(),
});

export const channelEndpointInputSchema = baseEndpointInputSchema.extend({
  type: z.literal('channel'),
});

export const deliveryEndpointInputSchema = z.discriminatedUnion('type', [
  dashboardEndpointInputSchema,
  webhookEndpointInputSchema,
  slackEndpointInputSchema,
  emailEndpointInputSchema,
  channelEndpointInputSchema,
]);
export type DeliveryEndpointInput = z.input<typeof deliveryEndpointInputSchema>;

export const eventSubscriptionInputSchema = z.object({
  tenantId: tenantIdSchema,
  eventType: platformEventTypeSchema,
  minimumSeverity: platformEventSeveritySchema.optional(),
  endpointId: nonEmptyText,
  filter: payloadSchema.optional(),
  isEnabled: z.boolean().default(true),
});
export type EventSubscriptionInput = z.input<typeof eventSubscriptionInputSchema>;

export const deliveryAttemptInputSchema = z.object({
  tenantId: tenantIdSchema,
  eventId: nonEmptyText,
  subscriptionId: nonEmptyText,
  endpointId: nonEmptyText,
  status: deliveryStatusSchema.default('pending'),
  attemptNumber: z.number().int().min(1).default(1),
  maxAttempts: z.number().int().min(1).default(3),
  nextRetryAt: z.coerce.date().optional(),
  deliveredAt: z.coerce.date().optional(),
  lastError: z.string().max(2000).optional(),
  responseSummary: payloadSchema.optional(),
});
export type DeliveryAttemptInput = z.input<typeof deliveryAttemptInputSchema>;

export const gatewayDecisionInputSchema = z.object({
  tenantId: tenantIdSchema,
  eventId: nonEmptyText,
  decision: gatewayDecisionSchema,
  decisionBy: nonEmptyText,
  sourceBackend: decisionSourceBackendSchema,
  idempotencyKey: nonEmptyText,
  metadata: payloadSchema.default({}),
});
export type GatewayDecisionInput = z.input<typeof gatewayDecisionInputSchema>;

export const channelConnectionInputSchema = z.object({
  tenantId: tenantIdSchema,
  adminId: nonEmptyText.optional(),
  connectionId: nonEmptyText,
  status: channelConnectionStatusSchema.default('connected'),
  capabilities: payloadSchema.default({}),
  lastSeenAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});
export type ChannelConnectionInput = z.input<typeof channelConnectionInputSchema>;
