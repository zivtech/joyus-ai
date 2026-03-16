/**
 * Manual-Request Trigger Handler
 *
 * Matches a single pipeline by ID from the event payload.
 * Used when a user explicitly triggers a pipeline by name/id.
 */

import type { TriggerEventType } from '../types.js';
import type { Pipeline } from '../schema.js';
import type { TriggerHandler, TriggerContext, TriggerResult } from './interface.js';

export class ManualRequestTriggerHandler implements TriggerHandler {
  readonly triggerType: TriggerEventType = 'manual_request';

  canHandle(eventType: TriggerEventType): boolean {
    return eventType === 'manual_request';
  }

  getMatchingPipelines(
    context: TriggerContext,
    activePipelines: Pipeline[],
  ): TriggerResult[] {
    const pipelineId = context.event.payload['pipelineId'];

    if (typeof pipelineId !== 'string' || !pipelineId) {
      return [];
    }

    const pipeline = activePipelines.find(
      (p) => p.id === pipelineId && p.triggerType === 'manual_request',
    );

    if (!pipeline) {
      return [];
    }

    return [
      {
        pipelineId: pipeline.id,
        triggerPayload: {
          sourceEvent: context.event,
          depth: context.currentDepth + 1,
        },
      },
    ];
  }
}
