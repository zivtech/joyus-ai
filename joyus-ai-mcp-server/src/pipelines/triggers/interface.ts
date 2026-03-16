/**
 * Trigger Handler Contract
 *
 * Defines the interface that all trigger handlers must implement,
 * plus the context/result types used throughout the trigger system.
 */

import type { TriggerEventType, EventEnvelope } from '../types.js';
import type { Pipeline } from '../schema.js';

// ============================================================
// CONTEXT & RESULT
// ============================================================

export interface TriggerContext {
  event: EventEnvelope;
  tenantId: string;
  currentDepth: number;
}

export interface TriggerResult {
  pipelineId: string;
  triggerPayload: Record<string, unknown>;
}

// ============================================================
// HANDLER INTERFACE
// ============================================================

export interface TriggerHandler {
  readonly triggerType: TriggerEventType;
  canHandle(eventType: TriggerEventType): boolean;
  getMatchingPipelines(
    context: TriggerContext,
    activePipelines: Pipeline[],
  ): TriggerResult[];
}
