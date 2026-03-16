/**
 * ContentGenerationHandler — generates content via the content infrastructure service.
 */

import type { StepType, StepResult } from '../types.js';
import type { ExecutionContext } from '../engine/step-runner.js';
import type { PipelineStepHandler, StepHandlerDependencies } from './interface.js';

export class ContentGenerationHandler implements PipelineStepHandler {
  readonly stepType: StepType = 'content_generation';

  constructor(private readonly deps: StepHandlerDependencies) {}

  validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['prompt'] || typeof config['prompt'] !== 'string' || config['prompt'].trim() === '') {
      errors.push('prompt must be a non-empty string');
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

    const prompt = config['prompt'] as string;
    const profileId = config['profileId'] as string | undefined;
    const sourceIds = config['sourceIds'] as string[] | undefined;

    try {
      const result = await this.deps.contentInfrastructure.generateContent(
        prompt,
        profileId ?? '',
        sourceIds,
      );
      return {
        success: true,
        outputData: {
          artifactRef: {
            type: result.type,
            id: result.artifactId,
            metadata: result.metadata ?? {},
          },
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
