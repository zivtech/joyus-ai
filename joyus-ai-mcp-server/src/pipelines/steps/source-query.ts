/**
 * SourceQueryHandler — queries a content source and returns matching items.
 */

import type { StepType, StepResult } from '../types.js';
import type { ExecutionContext } from '../engine/step-runner.js';
import type { PipelineStepHandler, StepHandlerDependencies } from './interface.js';

export class SourceQueryHandler implements PipelineStepHandler {
  readonly stepType: StepType = 'source_query';

  constructor(private readonly deps: StepHandlerDependencies) {}

  validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['query'] || typeof config['query'] !== 'string' || config['query'].trim() === '') {
      errors.push('query must be a non-empty string');
    }
    return errors;
  }

  async execute(config: Record<string, unknown>, _context: ExecutionContext): Promise<StepResult> {
    if (!this.deps.contentInfrastructure) {
      return {
        success: false,
        error: {
          message: 'Content infrastructure client not configured',
          type: 'configuration',
          isTransient: false,
          retryable: false,
        },
      };
    }

    const query = config['query'] as string;
    const sourceIds = config['sourceIds'] as string[] | undefined;
    const maxResults = config['maxResults'] as number | undefined;

    try {
      const result = await this.deps.contentInfrastructure.querySource(query, sourceIds, maxResults);
      return {
        success: true,
        outputData: {
          items: result.items,
          total: result.total,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isNetwork = /network|timeout|ECONNREFUSED|ETIMEDOUT/i.test(message);
      return {
        success: false,
        error: {
          message,
          type: isNetwork ? 'network' : 'service_error',
          isTransient: isNetwork,
          retryable: isNetwork,
        },
      };
    }
  }
}
