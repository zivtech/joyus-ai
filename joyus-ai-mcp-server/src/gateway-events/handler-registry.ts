import type {
  GatewayDecisionHandlerContext,
  GatewayDecisionHandlerResult,
  GatewayDecision,
} from './types.js';

export type GatewayDecisionHandler = (
  context: GatewayDecisionHandlerContext
) => Promise<GatewayDecisionHandlerResult> | GatewayDecisionHandlerResult;

export class GatewayDecisionHandlerNotFoundError extends Error {
  constructor(handlerKey: string) {
    super(`Gateway decision handler not registered: ${handlerKey}`);
    this.name = 'GatewayDecisionHandlerNotFoundError';
  }
}

export class GatewayDecisionHandlerRegistry {
  private readonly handlers = new Map<string, GatewayDecisionHandler>();

  register(handlerKey: string, handler: GatewayDecisionHandler): void {
    this.handlers.set(handlerKey, handler);
  }

  has(handlerKey: string): boolean {
    return this.handlers.has(handlerKey);
  }

  async route(context: GatewayDecisionHandlerContext): Promise<GatewayDecisionHandlerResult> {
    const handler = this.handlers.get(context.handlerKey);
    if (!handler) {
      throw new GatewayDecisionHandlerNotFoundError(context.handlerKey);
    }

    return handler(context);
  }
}

export interface PipelineReviewDecisionPort {
  routeReviewDecision(
    context: GatewayDecisionHandlerContext
  ): Promise<Record<string, unknown> | void>;
}

export interface MonitoringDecisionPort {
  routeMonitoringDecision(
    context: GatewayDecisionHandlerContext
  ): Promise<Record<string, unknown> | void>;
}

const PIPELINE_REVIEW_DECISIONS = [
  'approved',
  'rejected',
  'request_changes',
] as const satisfies readonly GatewayDecision[];

const MONITORING_DECISIONS = [
  'acknowledged',
  'dismissed',
] as const satisfies readonly GatewayDecision[];

export function createPipelineReviewDecisionHandler(
  port: PipelineReviewDecisionPort,
): GatewayDecisionHandler {
  return async (context) => {
    if (!PIPELINE_REVIEW_DECISIONS.includes(context.decision as (typeof PIPELINE_REVIEW_DECISIONS)[number])) {
      return {
        status: 'rejected',
        error: 'Pipeline review handler accepts only review decisions',
      };
    }

    const summary = await port.routeReviewDecision(context);
    return routed(summary);
  };
}

export function createMonitoringDecisionHandler(
  port: MonitoringDecisionPort,
): GatewayDecisionHandler {
  return async (context) => {
    if (!MONITORING_DECISIONS.includes(context.decision as (typeof MONITORING_DECISIONS)[number])) {
      return {
        status: 'rejected',
        error: 'Monitoring handler accepts only acknowledgment decisions',
      };
    }

    const summary = await port.routeMonitoringDecision(context);
    return routed(summary);
  };
}

function routed(summary?: Record<string, unknown> | void): GatewayDecisionHandlerResult {
  return summary
    ? { status: 'routed', summary }
    : { status: 'routed' };
}
