/**
 * Event Adapter — Event-to-Trigger Translation
 *
 * Maps buffered webhook_event records to TriggerCall format for
 * forwarding to Spec 009's event bus.
 *
 * Each source_type has its own translation logic:
 * - github: corpus-change for push, manual-request for PR/issues/release
 * - generic_webhook: uses payload_mapping or source defaults
 * - schedule: always manual-request with schedule metadata
 * - automation_callback: passes through from event payload
 */

import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { WebhookEvent, EventSource, EventScheduledTask } from '../schema.js';
import { platformSubscriptions } from '../schema.js';
import { bufferEvent } from './event-buffer.js';
import type { TriggerCall } from './trigger-forwarder.js';
import type { TriggerForwarder } from './trigger-forwarder.js';

// ============================================================
// ERRORS
// ============================================================

export class TranslationError extends Error {
  constructor(
    message: string,
    public readonly eventId: string,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

// ============================================================
// TRANSLATOR
// ============================================================

/**
 * Translate a buffered event into a TriggerCall for Spec 009.
 *
 * @param event - The webhook_event record from the buffer
 * @param source - The associated event_source (required for webhook events)
 * @param schedule - The associated scheduled_task (required for schedule events)
 * @throws TranslationError if required fields are missing
 */
export function translateEvent(
  event: WebhookEvent,
  source?: EventSource | null,
  schedule?: EventScheduledTask | null,
): TriggerCall {
  switch (event.sourceType) {
    case 'github':
      return translateGitHub(event, source);
    case 'generic_webhook':
      return translateGenericWebhook(event, source);
    case 'schedule':
      return translateSchedule(event, schedule);
    case 'automation_callback':
      return translateAutomationCallback(event);
    default:
      throw new TranslationError(
        `Unknown source type: ${event.sourceType}`,
        event.id,
      );
  }
}

// ============================================================
// SOURCE-TYPE TRANSLATORS
// ============================================================

function translateGitHub(
  event: WebhookEvent,
  source?: EventSource | null,
): TriggerCall {
  if (!source) {
    throw new TranslationError('GitHub event missing associated event_source', event.id);
  }

  const pipelineId = source.targetPipelineId;
  if (!pipelineId) {
    throw new TranslationError('GitHub source missing target_pipeline_id', event.id);
  }

  const payload = event.payload as Record<string, unknown>;
  const metadata = typeof payload === 'object' && payload !== null ? payload : {};

  // Push events → corpus-change, everything else → manual-request
  const eventType = metadata.eventType ?? (metadata as Record<string, unknown>).event_type;
  const triggerType = eventType === 'push' ? 'corpus-change' : 'manual-request';

  return {
    tenantId: event.tenantId,
    pipelineId,
    triggerType: triggerType as 'corpus-change' | 'manual-request',
    metadata,
    sourceEventId: event.id,
  };
}

function translateGenericWebhook(
  event: WebhookEvent,
  source?: EventSource | null,
): TriggerCall {
  if (!source) {
    throw new TranslationError('Generic webhook event missing associated event_source', event.id);
  }

  const pipelineId = source.targetPipelineId;
  if (!pipelineId) {
    throw new TranslationError('Generic webhook source missing target_pipeline_id', event.id);
  }

  const payload = event.payload as Record<string, unknown>;

  // If a translated_trigger already exists (from WP04 payload mapping), use it
  const translated = event.translatedTrigger as Record<string, unknown> | null;
  const triggerType = (translated?.triggerType as string)
    ?? source.targetTriggerType
    ?? 'manual-request';

  const metadata = (translated?.metadata as Record<string, unknown>)
    ?? (typeof payload === 'object' && payload !== null ? payload : {});

  return {
    tenantId: event.tenantId,
    pipelineId: (translated?.pipelineId as string) ?? pipelineId,
    triggerType: triggerType as 'corpus-change' | 'manual-request',
    metadata,
    sourceEventId: event.id,
  };
}

function translateSchedule(
  event: WebhookEvent,
  schedule?: EventScheduledTask | null,
): TriggerCall {
  if (!schedule) {
    throw new TranslationError('Schedule event missing associated scheduled_task', event.id);
  }

  const pipelineId = schedule.targetPipelineId;
  if (!pipelineId) {
    throw new TranslationError('Scheduled task missing target_pipeline_id', event.id);
  }

  return {
    tenantId: event.tenantId,
    pipelineId,
    triggerType: 'manual-request',
    metadata: {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      firedAt: event.createdAt.toISOString(),
      ...(schedule.triggerMetadata as Record<string, unknown> ?? {}),
    },
    sourceEventId: event.id,
  };
}

function translateAutomationCallback(event: WebhookEvent): TriggerCall {
  const payload = event.payload as Record<string, unknown>;

  const triggerType = payload?.triggerType ?? payload?.trigger_type;
  if (!triggerType || (triggerType !== 'corpus-change' && triggerType !== 'manual-request')) {
    throw new TranslationError(
      `Automation callback missing valid trigger_type: ${String(triggerType)}`,
      event.id,
    );
  }

  const pipelineId = (payload?.pipelineId ?? payload?.pipeline_id) as string | undefined;
  if (!pipelineId) {
    throw new TranslationError('Automation callback missing pipeline_id', event.id);
  }

  const metadata = (payload?.metadata as Record<string, unknown>) ?? {};

  return {
    tenantId: event.tenantId,
    pipelineId,
    triggerType: triggerType as 'corpus-change' | 'manual-request',
    metadata,
    sourceEventId: event.id,
  };
}

// ============================================================
// T059: PLATFORM FAN-OUT
// ============================================================

/**
 * Fan out a platform-wide event to all active tenant subscriptions.
 *
 * Creates a child webhook_event per subscription via bufferEvent().
 * Uses Promise.allSettled so one tenant failure never blocks others.
 *
 * @param db      - Database connection
 * @param event   - The platform-wide event that was just delivered
 * @param _triggerCall - The trigger call (reserved for future enrichment)
 * @param _forwarder   - TriggerForwarder (reserved for future direct forwarding)
 * @returns counts of succeeded and failed child events
 */
export async function fanOutPlatformEvent(
  db: NodePgDatabase<Record<string, unknown>>,
  event: WebhookEvent,
  _triggerCall: TriggerCall,
  _forwarder: TriggerForwarder,
): Promise<{ succeeded: number; failed: number }> {
  // Query active subscriptions for this source — isActive filter pushed to DB
  const subscriptions = await db
    .select()
    .from(platformSubscriptions)
    .where(
      and(
        eq(platformSubscriptions.eventSourceId, event.sourceId ?? ''),
        eq(platformSubscriptions.isActive, true),
      ),
    );

  if (subscriptions.length === 0) {
    return { succeeded: 0, failed: 0 };
  }

  // Create a child event per tenant subscription with bounded concurrency
  const CONCURRENCY = 20;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < subscriptions.length; i += CONCURRENCY) {
    const chunk = subscriptions.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((sub) =>
        bufferEvent(db, {
          tenantId: sub.tenantId,
          sourceType: event.sourceType,
          sourceId: event.sourceId ?? undefined,
          payload: event.payload,
          signatureValid: true,
        }),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        succeeded++;
      } else {
        failed++;
        console.error('[event-adapter] Fan-out child event creation failed', r.reason);
      }
    }
  }

  return { succeeded, failed };
}
