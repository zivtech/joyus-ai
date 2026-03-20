/**
 * Event Adapter — Generic Webhook Parser
 *
 * Parses webhook payloads from arbitrary systems using the source's
 * configurable payload mapping rules. When no mapping is configured,
 * the entire payload is passed through as metadata.
 */

import { mapPayload, type PayloadMappingConfig } from '../services/payload-mapper.js';
import type { EventSource } from '../schema.js';

// ============================================================
// TYPES
// ============================================================

export interface GenericParsedEvent {
  triggerType: string;
  pipelineId?: string;
  metadata: Record<string, unknown>;
}

export class PayloadParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadParseError';
  }
}

// ============================================================
// PARSER
// ============================================================

/**
 * Parse a generic webhook payload using the source's configuration.
 *
 * - If payload_mapping is null: pass entire body as metadata, use source defaults
 * - If payload_mapping is present: apply mapping rules via payload mapper service
 *
 * @param body - Raw request body as Buffer
 * @param source - The event source record with configuration
 * @returns Parsed event with trigger type, pipeline ID, and metadata
 * @throws PayloadParseError if the body is not valid JSON
 */
export function parseGenericWebhook(
  body: Buffer,
  source: EventSource,
): GenericParsedEvent {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body.toString('utf-8')) as Record<string, unknown>;
  } catch {
    throw new PayloadParseError('Request body is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PayloadParseError('Request body must be a JSON object');
  }

  const mapping = source.payloadMapping as PayloadMappingConfig | null;

  if (!mapping) {
    return {
      triggerType: source.targetTriggerType ?? 'manual-request',
      pipelineId: source.targetPipelineId ?? undefined,
      metadata: parsed,
    };
  }

  const mapped = mapPayload(parsed, mapping);

  return {
    triggerType: mapped.triggerType ?? source.targetTriggerType ?? 'manual-request',
    pipelineId: mapped.pipelineId ?? source.targetPipelineId ?? undefined,
    metadata: mapped.metadata,
  };
}
