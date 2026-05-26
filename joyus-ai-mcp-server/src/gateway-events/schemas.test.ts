import { describe, expect, it } from 'vitest';

import {
  channelConnectionInputSchema,
  deliveryEndpointInputSchema,
  gatewayDecisionInputSchema,
  platformEventInputSchema,
} from './schemas.js';
import {
  assertTenantMatch,
  redactSecretsDeep,
  sanitizeErrorSummary,
  TenantMismatchError,
} from './types.js';

describe('gateway event schemas', () => {
  it('accepts a decision-capable platform event with generic tenant scope', () => {
    const parsed = platformEventInputSchema.parse({
      tenantId: 'tenant_123',
      type: 'review.pending',
      severity: 'warning',
      sourceSpec: 'gateway-event-bus',
      sourceComponent: 'pipeline-review',
      subjectType: 'pipeline_execution',
      subjectId: 'execution_456',
      correlationId: 'run_789',
      idempotencyKey: 'pipeline-review:execution_456:pending',
      payloadSchemaVersion: 'review.pending.v1',
      requiresDecision: true,
      handlerKey: 'pipeline-review',
      payload: {
        title: 'Review required',
        summary: 'Generated output is ready for operator review.',
      },
    });

    expect(parsed).toMatchObject({
      tenantId: 'tenant_123',
      type: 'review.pending',
      requiresDecision: true,
      handlerKey: 'pipeline-review',
    });
  });

  it('requires handlerKey when an event requires a decision', () => {
    const result = platformEventInputSchema.safeParse({
      tenantId: 'tenant_123',
      type: 'review.pending',
      severity: 'warning',
      sourceSpec: 'gateway-event-bus',
      sourceComponent: 'pipeline-review',
      idempotencyKey: 'event-1',
      payloadSchemaVersion: 'review.pending.v1',
      requiresDecision: true,
      payload: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['handlerKey'],
          }),
        ]),
      );
    }
  });

  it('validates endpoint variants and keeps secrets as references', () => {
    const webhook = deliveryEndpointInputSchema.parse({
      tenantId: 'tenant_123',
      type: 'webhook',
      name: 'Example Webhook',
      url: 'https://example.invalid/hooks/gateway',
      hmacSecretRef: 'secret_ref_webhook_123',
    });
    const email = deliveryEndpointInputSchema.parse({
      tenantId: 'tenant_123',
      type: 'email',
      name: 'Review Email',
      addresses: ['operator@example.invalid'],
    });

    expect(webhook).toMatchObject({
      type: 'webhook',
      hmacSecretRef: 'secret_ref_webhook_123',
      isActive: true,
    });
    expect(email).toMatchObject({
      type: 'email',
      addresses: ['operator@example.invalid'],
      isActive: true,
    });
  });

  it('validates decision inputs from any delivery surface', () => {
    const parsed = gatewayDecisionInputSchema.parse({
      tenantId: 'tenant_123',
      eventId: 'event_123',
      decision: 'approved',
      decisionBy: 'operator_456',
      sourceBackend: 'dashboard',
      idempotencyKey: 'dashboard:event_123:operator_456:approved',
      metadata: {
        comment: 'Approved after review.',
      },
    });

    expect(parsed).toMatchObject({
      sourceBackend: 'dashboard',
      metadata: {
        comment: 'Approved after review.',
      },
    });
  });

  it('defaults channel connections to connected with empty capabilities', () => {
    const parsed = channelConnectionInputSchema.parse({
      tenantId: 'tenant_123',
      connectionId: 'channel_conn_123',
    });

    expect(parsed).toMatchObject({
      status: 'connected',
      capabilities: {},
    });
  });

  it('throws a typed error for tenant mismatches', () => {
    expect(() => assertTenantMatch('tenant_a', 'tenant_b', 'endpoint')).toThrow(
      TenantMismatchError,
    );
  });

  it('redacts nested secret-bearing fields before audit persistence', () => {
    expect(
      redactSecretsDeep({
        url: 'https://example.invalid/hooks/gateway',
        hmacSecretRef: 'secret_ref_webhook_123',
        nested: {
          authorizationHeader: 'Bearer example-token',
          safe: 'kept',
        },
      }),
    ).toEqual({
      url: 'https://example.invalid/hooks/gateway',
      hmacSecretRef: '[REDACTED]',
      nested: {
        authorizationHeader: '[REDACTED]',
        safe: 'kept',
      },
    });
  });

  it('sanitizes bearer tokens and query secrets in error summaries', () => {
    const sanitized = sanitizeErrorSummary(
      new Error('POST failed Bearer abc.def?secret=not-kept&safe=yes'),
    );

    expect(sanitized).not.toContain('abc.def');
    expect(sanitized).not.toContain('not-kept');
    expect(sanitized).toContain('[REDACTED]');
  });
});
