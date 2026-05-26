import { createHmac } from 'node:crypto';

import type { GatewayDeliveryEndpoint } from '../../db/schema/gateway-events.js';
import { sanitizeErrorSummary } from '../types.js';

import type { DeliveryAdapter, DeliveryAdapterContext, DeliveryAdapterResult } from './types.js';
import { failedDelivery, sentDelivery } from './types.js';

export interface WebhookSigningContext {
  endpoint: GatewayDeliveryEndpoint;
  body: string;
}

export type WebhookSigningHook = (
  context: WebhookSigningContext
) => Promise<Record<string, string>> | Record<string, string>;

export interface WebhookSecretResolver {
  resolve(secretRef: string): Promise<string | null>;
}

export interface WebhookDeliveryAdapterOptions {
  fetchImpl?: typeof fetch;
  signingHook?: WebhookSigningHook;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

function getWebhookUrl(endpoint: GatewayDeliveryEndpoint): string | null {
  const url = endpoint.config['url'];
  return typeof url === 'string' && url.length > 0 ? url : null;
}

function webhookPayload(context: DeliveryAdapterContext): Record<string, unknown> {
  return {
    eventId: context.event.id,
    tenantId: context.event.tenantId,
    type: context.event.type,
    severity: context.event.severity,
    sourceSpec: context.event.sourceSpec,
    sourceComponent: context.event.sourceComponent,
    subjectType: context.event.subjectType,
    subjectId: context.event.subjectId,
    correlationId: context.event.correlationId,
    payloadSchemaVersion: context.event.payloadSchemaVersion,
    requiresDecision: context.event.requiresDecision,
    handlerKey: context.event.handlerKey,
    payload: context.event.payload,
    occurredAt: context.event.occurredAt.toISOString(),
    emittedAt: context.event.emittedAt.toISOString(),
    deliveryAttemptId: context.attempt.id,
  };
}

export function createHmacWebhookSigningHook(
  secretResolver: WebhookSecretResolver,
  headerName = 'x-joyus-signature-256',
): WebhookSigningHook {
  return async ({ endpoint, body }) => {
    if (!endpoint.secretRef) {
      return {};
    }

    const secret = await secretResolver.resolve(endpoint.secretRef);
    if (!secret) {
      throw new Error('Webhook signing secret is unavailable');
    }

    return {
      [headerName]: `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    };
  };
}

export class WebhookDeliveryAdapter implements DeliveryAdapter {
  readonly type = 'webhook' as const;

  private readonly fetchImpl: typeof fetch;
  private readonly signingHook?: WebhookSigningHook;
  private readonly timeoutMs: number;

  constructor(options: WebhookDeliveryAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.signingHook = options.signingHook;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async deliver(context: DeliveryAdapterContext): Promise<DeliveryAdapterResult> {
    const url = getWebhookUrl(context.endpoint);
    if (!url) {
      return failedDelivery('Webhook endpoint URL is not configured', {
        backend: this.type,
      }, false);
    }

    const body = JSON.stringify(webhookPayload(context));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const signedHeaders = this.signingHook
        ? await this.signingHook({ endpoint: context.endpoint, body })
        : {};
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-joyus-event-id': context.event.id,
          'x-joyus-delivery-attempt-id': context.attempt.id,
          ...signedHeaders,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseSummary = {
        backend: this.type,
        status: response.status,
        ok: response.ok,
      };

      if (!response.ok) {
        return failedDelivery(`Webhook delivery failed with HTTP ${response.status}`, responseSummary);
      }

      return sentDelivery(responseSummary, context.now);
    } catch (error) {
      clearTimeout(timeout);
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      return failedDelivery(
        isTimeout ? 'Webhook delivery timed out' : sanitizeErrorSummary(error),
        {
          backend: this.type,
          timeout: isTimeout,
        },
      );
    }
  }
}
