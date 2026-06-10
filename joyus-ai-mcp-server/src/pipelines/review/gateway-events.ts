import type { GatewayEventService } from '../../gateway-events/event.service.js';
import { redactSecretsDeep } from '../../gateway-events/types.js';
import type { ExecutionStep, PipelineExecution } from '../schema.js';
import type { ArtifactRef } from '../types.js';

export interface PipelineReviewGatewayEvent {
  execution: PipelineExecution;
  gateStep: ExecutionStep;
  reviewDecisionId: string;
  artifact: ArtifactRef;
  profileVersionRef?: string;
}

export class PipelineReviewGatewayEmitter {
  constructor(private readonly gatewayEvents: Pick<GatewayEventService, 'emitPlatformEvent'>) {}

  async emitPendingReviewDecision(input: PipelineReviewGatewayEvent): Promise<void> {
    await this.gatewayEvents.emitPlatformEvent({
      tenantId: input.execution.tenantId,
      type: 'review.pending',
      severity: 'warning',
      sourceSpec: 'gateway-event-bus',
      sourceComponent: 'pipeline-review',
      subjectType: 'review_decision',
      subjectId: input.reviewDecisionId,
      correlationId: input.execution.id,
      idempotencyKey: `review.pending:${input.reviewDecisionId}`,
      payloadSchemaVersion: 'review.pending.v1',
      requiresDecision: true,
      handlerKey: 'pipeline-review',
      payload: {
        executionId: input.execution.id,
        pipelineId: input.execution.pipelineId,
        gateStepId: input.gateStep.id,
        reviewDecisionId: input.reviewDecisionId,
        artifact: redactSecretsDeep(input.artifact),
        profileVersionRef: input.profileVersionRef,
      },
      occurredAt: new Date(),
    });
  }
}
