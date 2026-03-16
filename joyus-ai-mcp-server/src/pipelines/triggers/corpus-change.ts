/**
 * Corpus-Change Trigger Handler
 *
 * Matches active pipelines that listen for corpus_change events.
 * Applies optional corpus filter and enforces max pipeline depth.
 */

import type { TriggerEventType, CorpusChangeTriggerConfig } from '../types.js';
import { DEFAULT_MAX_PIPELINE_DEPTH } from '../types.js';
import type { Pipeline } from '../schema.js';
import type { TriggerHandler, TriggerContext, TriggerResult } from './interface.js';

export class CorpusChangeTriggerHandler implements TriggerHandler {
  readonly triggerType: TriggerEventType = 'corpus_change';

  canHandle(eventType: TriggerEventType): boolean {
    return eventType === 'corpus_change';
  }

  getMatchingPipelines(
    context: TriggerContext,
    activePipelines: Pipeline[],
  ): TriggerResult[] {
    if (context.currentDepth >= DEFAULT_MAX_PIPELINE_DEPTH) {
      console.warn(
        `[CorpusChangeTrigger] Max pipeline depth (${DEFAULT_MAX_PIPELINE_DEPTH}) reached; ` +
        `skipping trigger for tenant ${context.tenantId}`,
      );
      return [];
    }

    const results: TriggerResult[] = [];

    for (const pipeline of activePipelines) {
      if (pipeline.triggerType !== 'corpus_change') {
        continue;
      }

      const config = pipeline.triggerConfig as CorpusChangeTriggerConfig;
      const filter = config.corpusFilter;

      // No filter or empty filter → match all corpus change events
      if (!filter || Object.keys(filter).length === 0) {
        results.push({
          pipelineId: pipeline.id,
          triggerPayload: {
            sourceEvent: context.event,
            depth: context.currentDepth + 1,
          },
        });
        continue;
      }

      // Apply filter: every filter key must match event payload
      const payload = context.event.payload;
      const matches = Object.entries(filter).every(
        ([key, value]) => payload[key] === value,
      );

      if (matches) {
        results.push({
          pipelineId: pipeline.id,
          triggerPayload: {
            sourceEvent: context.event,
            depth: context.currentDepth + 1,
          },
        });
      }
    }

    return results;
  }
}
