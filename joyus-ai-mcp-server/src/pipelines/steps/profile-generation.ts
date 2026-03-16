/**
 * ProfileGenerationHandler — regenerates one or more profiles via the profile engine.
 */

import type { StepType, StepResult } from '../types.js';
import type { ExecutionContext } from '../engine/step-runner.js';
import type { PipelineStepHandler, StepHandlerDependencies } from './interface.js';

export class ProfileGenerationHandler implements PipelineStepHandler {
  readonly stepType: StepType = 'profile_generation';

  constructor(private readonly deps: StepHandlerDependencies) {}

  validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (
      !Array.isArray(config['profileIds']) ||
      (config['profileIds'] as unknown[]).length === 0
    ) {
      errors.push('profileIds must be a non-empty array of strings');
    }
    return errors;
  }

  async execute(config: Record<string, unknown>, _context: ExecutionContext): Promise<StepResult> {
    if (!this.deps.profileEngine) {
      return {
        success: false,
        error: {
          message: 'Profile engine client not configured',
          type: 'configuration',
          isTransient: false,
          retryable: false,
        },
      };
    }

    const profileIds = config['profileIds'] as string[];
    const results: Array<{ profileId: string; success: boolean; durationMs?: number }> = [];

    try {
      for (const profileId of profileIds) {
        const result = await this.deps.profileEngine.regenerateProfile(profileId);
        results.push(result);
      }
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

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      return {
        success: false,
        error: {
          message: `Failed to regenerate profiles: ${failed.map((r) => r.profileId).join(', ')}`,
          type: 'service_error',
          isTransient: false,
          retryable: false,
        },
      };
    }

    return {
      success: true,
      outputData: { regenerated: results },
    };
  }
}
