/**
 * Event Adapter — Zod Validation Schemas
 *
 * Input validation for event adapter API endpoints.
 *
 * TENANT SCOPING: tenantId is NOT included in these input schemas because it
 * is always resolved from the authenticated session context, never from
 * user-supplied input. This prevents tenant spoofing.
 */

import { z } from 'zod';

// ============================================================
// SHARED REFINEMENTS
// ============================================================

/**
 * Basic cron expression validation (5-field standard cron).
 * Full semantic validation happens at scheduling time.
 */
const cronExpression = z.string().regex(
  /^(\S+\s+){4}\S+$/,
  'Must be a valid 5-field cron expression (e.g., "0 9 * * 1-5")',
);

/**
 * IANA timezone validation via Intl API.
 */
const ianaTimezone = z.string().refine(
  (tz) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Must be a valid IANA timezone (e.g., "America/New_York", "UTC")' },
);

// ============================================================
// EVENT SOURCE MANAGEMENT
// ============================================================

export const CreateEventSourceInput = z.object({
  name: z.string().min(1).max(255),
  sourceType: z.enum(['github', 'generic_webhook']),
  authMethod: z.enum(['hmac_sha256', 'api_key_header', 'ip_allowlist']),
  authSecret: z.string().min(1).max(500).optional(),
  authConfig: z.record(z.string(), z.unknown()).optional(),
  targetPipelineId: z.string().optional(),
  targetTriggerType: z.string().max(50).optional(),
  payloadMapping: z.record(z.string(), z.unknown()).optional(),
});
export type CreateEventSourceInput = z.infer<typeof CreateEventSourceInput>;

export const UpdateEventSourceInput = z.object({
  name: z.string().min(1).max(255).optional(),
  authMethod: z.enum(['hmac_sha256', 'api_key_header', 'ip_allowlist']).optional(),
  authSecret: z.string().min(1).max(500).optional(),
  authConfig: z.record(z.string(), z.unknown()).optional(),
  targetPipelineId: z.string().optional(),
  targetTriggerType: z.string().max(50).optional(),
  payloadMapping: z.record(z.string(), z.unknown()).optional(),
  lifecycleState: z.enum(['active', 'paused', 'disabled', 'archived']).optional(),
});
export type UpdateEventSourceInput = z.infer<typeof UpdateEventSourceInput>;

// ============================================================
// SCHEDULE MANAGEMENT
// ============================================================

export const CreateScheduleInput = z.object({
  name: z.string().min(1).max(255),
  cronExpression: cronExpression,
  timezone: ianaTimezone.default('UTC'),
  targetPipelineId: z.string().min(1),
  triggerType: z.string().max(50).default('manual-request'),
  triggerMetadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateScheduleInput = z.infer<typeof CreateScheduleInput>;

export const UpdateScheduleInput = z.object({
  name: z.string().min(1).max(255).optional(),
  cronExpression: cronExpression.optional(),
  timezone: ianaTimezone.optional(),
  targetPipelineId: z.string().min(1).optional(),
  triggerType: z.string().max(50).optional(),
  triggerMetadata: z.record(z.string(), z.unknown()).optional(),
  lifecycleState: z.enum(['active', 'paused', 'disabled', 'archived']).optional(),
});
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInput>;

// ============================================================
// TRIGGER CALLBACK (from Spec 009 or external automation)
// ============================================================

export const TriggerCallbackInput = z.object({
  triggerType: z.enum(['corpus-change', 'manual-request']),
  pipelineId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type TriggerCallbackInput = z.infer<typeof TriggerCallbackInput>;

// ============================================================
// AUTOMATION DESTINATION
// ============================================================

export const AutomationDestinationInput = z.object({
  url: z.string().url().refine(
    (u) => u.startsWith('https://'),
    { message: 'Automation destination URL must use HTTPS' },
  ),
  authHeader: z.string().max(255).optional(),
  authSecret: z.string().max(500).optional(),
});
export type AutomationDestinationInput = z.infer<typeof AutomationDestinationInput>;

// ============================================================
// EVENT QUERY
// ============================================================

export const EventQueryInput = z.object({
  status: z.enum(['pending', 'processing', 'delivered', 'failed', 'dead_letter']).optional(),
  sourceType: z.enum(['github', 'generic_webhook', 'schedule', 'automation_callback']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
export type EventQueryInput = z.infer<typeof EventQueryInput>;
