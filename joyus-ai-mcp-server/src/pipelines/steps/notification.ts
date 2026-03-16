/**
 * NotificationHandler — sends a notification via a configured channel.
 *
 * Supports template variables: {pipelineName}, {executionId}.
 */

import type { StepType, StepResult } from '../types.js';
import type { ExecutionContext } from '../engine/step-runner.js';
import type { PipelineStepHandler, StepHandlerDependencies } from './interface.js';

function resolveTemplate(template: string, context: ExecutionContext): string {
  return template
    .replace(/\{pipelineName\}/g, context.pipelineId)
    .replace(/\{executionId\}/g, context.executionId);
}

export class NotificationHandler implements PipelineStepHandler {
  readonly stepType: StepType = 'notification';

  constructor(private readonly deps: StepHandlerDependencies) {}

  validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['channel'] || typeof config['channel'] !== 'string') {
      errors.push('channel must be a non-empty string');
    }
    if (!config['message'] || typeof config['message'] !== 'string' || config['message'].trim() === '') {
      errors.push('message must be a non-empty string');
    }
    return errors;
  }

  async execute(config: Record<string, unknown>, context: ExecutionContext): Promise<StepResult> {
    if (!this.deps.notificationService) {
      return {
        success: false,
        error: {
          message: 'Notification service not configured',
          type: 'configuration',
          isTransient: false,
          retryable: false,
        },
      };
    }

    const channel = config['channel'] as string;
    const rawMessage = config['message'] as string;
    const recipients = config['recipients'] as string[] | undefined;
    const message = resolveTemplate(rawMessage, context);

    try {
      const result = await this.deps.notificationService.send(channel, message, recipients);
      return {
        success: true,
        outputData: {
          sent: result.sent,
          messageId: result.messageId,
        },
      };
    } catch (err) {
      const message2 = err instanceof Error ? err.message : String(err);
      const isNetwork = /network|timeout|ECONNREFUSED|ETIMEDOUT/i.test(message2);
      return {
        success: false,
        error: {
          message: message2,
          type: isNetwork ? 'network' : 'service_error',
          isTransient: isNetwork,
          retryable: isNetwork,
        },
      };
    }
  }
}
