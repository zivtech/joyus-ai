/**
 * FidelityCheckHandler — runs a fidelity check against a profile and content set.
 *
 * A low score is a successful check result with passed=false, NOT a step failure.
 */

import type { StepType, StepResult } from '../types.js';
import type { ExecutionContext } from '../types.js';
import type { PipelineStepHandler, StepHandlerDependencies } from './interface.js';

export class FidelityCheckHandler implements PipelineStepHandler {
  readonly stepType: StepType = 'fidelity_check';

  constructor(private readonly deps: StepHandlerDependencies) {}

  validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['profileId'] || typeof config['profileId'] !== 'string') {
      errors.push('profileId must be a non-empty string');
    }
    const hasContentIds = Array.isArray(config['contentIds']) && (config['contentIds'] as unknown[]).length > 0;
    const hasUpstream = config['useUpstreamOutputs'] === true;
    if (!hasContentIds && !hasUpstream) {
      errors.push('contentIds (non-empty array) or useUpstreamOutputs=true is required');
    }
    return errors;
  }

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<StepResult> {
    if (!this.deps.contentIntelligence) {
      return {
        success: false,
        error: {
          message: 'Content intelligence client not configured',
          type: 'configuration',
          isTransient: false,
          retryable: false,
        },
      };
    }

    const profileId = config['profileId'] as string;
    let contentIds: string[] = Array.isArray(config['contentIds'])
      ? (config['contentIds'] as string[])
      : [];

    // Resolve upstream outputs if requested
    if (config['useUpstreamOutputs'] === true && contentIds.length === 0) {
      for (const [, output] of context.previousStepOutputs) {
        const artifactId = output['artifactId'];
        if (typeof artifactId === 'string') {
          contentIds.push(artifactId);
        }
      }
    }

    try {
      const result = await this.deps.contentIntelligence.runFidelityCheck(profileId, contentIds);
      return {
        success: true,
        outputData: {
          score: result.score,
          passed: result.passed,
          details: result.details ?? {},
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
