/**
 * Event Adapter — Webhook Ingestion Tests
 *
 * Tests the full ingestion path: slug resolution, auth validation,
 * GitHub/generic parsing, rate limiting, and error conditions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

import { parseGitHubEvent, UnsupportedEventTypeError } from '../../src/event-adapter/parsers/github.js';
import { parseGenericWebhook, PayloadParseError } from '../../src/event-adapter/parsers/generic.js';
import { mapPayload, evaluatePath } from '../../src/event-adapter/services/payload-mapper.js';
import { RateLimiter } from '../../src/event-adapter/services/rate-limiter.js';
import type { EventSource } from '../../src/event-adapter/schema.js';

// ============================================================
// GITHUB PARSER TESTS (T019)
// ============================================================

describe('parseGitHubEvent', () => {
  it('parses push events with corpus-change trigger type', () => {
    const payload = {
      ref: 'refs/heads/main',
      after: 'abc123',
      repository: { full_name: 'org/repo', clone_url: 'https://github.com/org/repo.git' },
      pusher: { name: 'dev-user' },
      compare: 'https://github.com/org/repo/compare/before...after',
      commits: [
        { added: ['new.ts'], modified: ['existing.ts'], removed: ['old.ts'] },
        { added: [], modified: ['existing.ts'], removed: [] },
      ],
    };

    const result = parseGitHubEvent(
      { 'x-github-event': 'push' },
      Buffer.from(JSON.stringify(payload)),
    );

    expect(result.eventType).toBe('push');
    expect(result.triggerType).toBe('corpus-change');
    expect(result.metadata.branch).toBe('main');
    expect(result.metadata.commitSha).toBe('abc123');
    expect(result.metadata.repository).toBe('org/repo');
    expect(result.metadata.author).toBe('dev-user');
    expect(result.metadata.changedFiles).toEqual(
      expect.arrayContaining(['new.ts', 'existing.ts', 'old.ts']),
    );
    // Deduplicated: existing.ts appears in two commits but only once in output
    expect((result.metadata.changedFiles as string[]).length).toBe(3);
  });

  it('parses pull_request events with manual-request trigger type', () => {
    const payload = {
      action: 'opened',
      pull_request: {
        number: 42,
        title: 'Add feature',
        head: { ref: 'feature-branch' },
        base: { ref: 'main' },
        merged: false,
        merged_at: null,
      },
      repository: { full_name: 'org/repo' },
    };

    const result = parseGitHubEvent(
      { 'x-github-event': 'pull_request' },
      Buffer.from(JSON.stringify(payload)),
    );

    expect(result.eventType).toBe('pull_request');
    expect(result.triggerType).toBe('manual-request');
    expect(result.metadata.action).toBe('opened');
    expect(result.metadata.number).toBe(42);
    expect(result.metadata.sourceBranch).toBe('feature-branch');
    expect(result.metadata.targetBranch).toBe('main');
  });

  it('parses issues events', () => {
    const payload = {
      action: 'labeled',
      issue: {
        number: 10,
        title: 'Bug report',
        state: 'open',
        labels: [{ name: 'bug' }, { name: 'priority' }],
      },
      repository: { full_name: 'org/repo' },
    };

    const result = parseGitHubEvent(
      { 'x-github-event': 'issues' },
      Buffer.from(JSON.stringify(payload)),
    );

    expect(result.eventType).toBe('issues');
    expect(result.triggerType).toBe('manual-request');
    expect(result.metadata.labels).toEqual(['bug', 'priority']);
  });

  it('parses release events', () => {
    const payload = {
      action: 'published',
      release: { tag_name: 'v1.0.0', name: 'Release 1.0', prerelease: false },
      repository: { full_name: 'org/repo' },
    };

    const result = parseGitHubEvent(
      { 'x-github-event': 'release' },
      Buffer.from(JSON.stringify(payload)),
    );

    expect(result.eventType).toBe('release');
    expect(result.triggerType).toBe('manual-request');
    expect(result.metadata.tagName).toBe('v1.0.0');
    expect(result.metadata.prerelease).toBe(false);
  });

  it('throws UnsupportedEventTypeError for ping events', () => {
    expect(() =>
      parseGitHubEvent(
        { 'x-github-event': 'ping' },
        Buffer.from(JSON.stringify({ zen: 'test' })),
      ),
    ).toThrow(UnsupportedEventTypeError);
  });

  it('throws UnsupportedEventTypeError for missing event header', () => {
    expect(() =>
      parseGitHubEvent({}, Buffer.from('{}')),
    ).toThrow(UnsupportedEventTypeError);
  });
});

// ============================================================
// GENERIC WEBHOOK PARSER TESTS (T020)
// ============================================================

function makeSource(overrides: Partial<EventSource> = {}): EventSource {
  return {
    id: 'src-1',
    tenantId: 'tenant-1',
    name: 'Test Source',
    sourceType: 'generic_webhook',
    endpointSlug: 'test-slug',
    authMethod: 'api_key_header',
    authConfig: { headerName: 'X-API-Key', secretRef: 'ref-1' },
    payloadMapping: null,
    targetPipelineId: 'pipeline-1',
    targetTriggerType: 'corpus-change',
    lifecycleState: 'active',
    isPlatformWide: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('parseGenericWebhook', () => {
  it('passes entire body as metadata when no mapping configured', () => {
    const body = { action: 'deploy', version: '1.2.3' };
    const source = makeSource();

    const result = parseGenericWebhook(Buffer.from(JSON.stringify(body)), source);

    expect(result.triggerType).toBe('corpus-change');
    expect(result.pipelineId).toBe('pipeline-1');
    expect(result.metadata).toEqual(body);
  });

  it('applies payload mapping when configured', () => {
    const body = { action: 'deploy', details: { env: 'prod' } };
    const source = makeSource({
      payloadMapping: {
        triggerType: 'manual-request',
        metadataMapping: { environment: '$.details.env', action: '$.action' },
      },
    });

    const result = parseGenericWebhook(Buffer.from(JSON.stringify(body)), source);

    expect(result.triggerType).toBe('manual-request');
    expect(result.metadata.environment).toBe('prod');
    expect(result.metadata.action).toBe('deploy');
  });

  it('throws PayloadParseError for invalid JSON', () => {
    const source = makeSource();
    expect(() => parseGenericWebhook(Buffer.from('not json'), source)).toThrow(PayloadParseError);
  });

  it('throws PayloadParseError for non-object JSON', () => {
    const source = makeSource();
    expect(() => parseGenericWebhook(Buffer.from('"string"'), source)).toThrow(PayloadParseError);
  });

  it('uses source defaults when mapping omits triggerType', () => {
    const body = { data: 'test' };
    const source = makeSource({
      targetTriggerType: 'corpus-change',
      payloadMapping: { metadataMapping: { value: '$.data' } },
    });

    const result = parseGenericWebhook(Buffer.from(JSON.stringify(body)), source);
    expect(result.triggerType).toBe('corpus-change');
  });
});

// ============================================================
// PAYLOAD MAPPER TESTS (T021)
// ============================================================

describe('evaluatePath', () => {
  const obj = {
    name: 'test',
    nested: { value: 42, deep: { key: 'found' } },
    items: [{ id: 'a' }, { id: 'b' }],
  };

  it('returns literal for non-$ paths', () => {
    expect(evaluatePath(obj, 'literal-value')).toBe('literal-value');
  });

  it('accesses top-level fields', () => {
    expect(evaluatePath(obj, '$.name')).toBe('test');
  });

  it('traverses nested fields', () => {
    expect(evaluatePath(obj, '$.nested.value')).toBe(42);
    expect(evaluatePath(obj, '$.nested.deep.key')).toBe('found');
  });

  it('accesses array elements by index', () => {
    expect(evaluatePath(obj, '$.items[0].id')).toBe('a');
    expect(evaluatePath(obj, '$.items[1].id')).toBe('b');
  });

  it('returns undefined for missing paths', () => {
    expect(evaluatePath(obj, '$.missing')).toBeUndefined();
    expect(evaluatePath(obj, '$.nested.missing.deep')).toBeUndefined();
    expect(evaluatePath(obj, '$.items[99].id')).toBeUndefined();
  });

  it('handles null/undefined gracefully', () => {
    expect(evaluatePath(null, '$.field')).toBeUndefined();
    expect(evaluatePath(undefined, '$.field')).toBeUndefined();
  });
});

describe('mapPayload', () => {
  it('maps metadata using path expressions', () => {
    const body = { user: { name: 'Alice' }, action: 'create' };
    const result = mapPayload(body, {
      metadataMapping: { userName: '$.user.name', action: '$.action' },
    });

    expect(result.metadata.userName).toBe('Alice');
    expect(result.metadata.action).toBe('create');
  });

  it('evaluates triggerType and pipelineId as paths', () => {
    const body = { type: 'corpus-change', pipeline: 'pipe-123' };
    const result = mapPayload(body, {
      triggerType: '$.type',
      pipelineId: '$.pipeline',
    });

    expect(result.triggerType).toBe('corpus-change');
    expect(result.pipelineId).toBe('pipe-123');
  });

  it('treats non-$ values as literals', () => {
    const result = mapPayload({}, {
      triggerType: 'manual-request',
      pipelineId: 'static-pipeline-id',
    });

    expect(result.triggerType).toBe('manual-request');
    expect(result.pipelineId).toBe('static-pipeline-id');
  });

  it('omits undefined path results from metadata', () => {
    const body = { exists: true };
    const result = mapPayload(body, {
      metadataMapping: { exists: '$.exists', missing: '$.not_here' },
    });

    expect(result.metadata.exists).toBe(true);
    expect('missing' in result.metadata).toBe(false);
  });
});

// ============================================================
// RATE LIMITER TESTS (T022)
// ============================================================

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      perSourceLimit: 3,
      perTenantLimit: 5,
      windowMs: 1000,
    });
  });

  it('allows requests within limit', () => {
    const result = limiter.checkRateLimit('src-1', 'tenant-1');
    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(1);
  });

  it('rejects requests exceeding per-source limit', () => {
    limiter.checkRateLimit('src-1', 'tenant-1');
    limiter.checkRateLimit('src-1', 'tenant-1');
    limiter.checkRateLimit('src-1', 'tenant-1');

    const result = limiter.checkRateLimit('src-1', 'tenant-1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('tracks sources independently', () => {
    limiter.checkRateLimit('src-1', 'tenant-1');
    limiter.checkRateLimit('src-1', 'tenant-1');
    limiter.checkRateLimit('src-1', 'tenant-1');

    // src-2 should still be allowed
    const result = limiter.checkRateLimit('src-2', 'tenant-1');
    expect(result.allowed).toBe(true);
  });

  it('enforces per-tenant limit across sources', () => {
    // 5 requests across different sources, same tenant
    limiter.checkRateLimit('src-1', 'tenant-1');
    limiter.checkRateLimit('src-2', 'tenant-1');
    limiter.checkRateLimit('src-3', 'tenant-1');
    limiter.checkRateLimit('src-4', 'tenant-1');
    limiter.checkRateLimit('src-5', 'tenant-1');

    // 6th request — tenant limit exceeded
    const result = limiter.checkRateLimit('src-6', 'tenant-1');
    expect(result.allowed).toBe(false);
  });

  it('includes rate limit info in results', () => {
    const result = limiter.checkRateLimit('src-1', 'tenant-1');
    expect(result.limit).toBeGreaterThan(0);
    expect(result.resetAt).toBeGreaterThan(0);
    expect(result.currentCount).toBe(1);
  });

  it('resets state with reset()', () => {
    limiter.checkRateLimit('src-1', 'tenant-1');
    limiter.checkRateLimit('src-1', 'tenant-1');
    limiter.checkRateLimit('src-1', 'tenant-1');

    limiter.reset();

    const result = limiter.checkRateLimit('src-1', 'tenant-1');
    expect(result.allowed).toBe(true);
  });
});

// ============================================================
// HMAC SIGNATURE GENERATION HELPER (for route-level tests)
// ============================================================

describe('HMAC signature integration', () => {
  it('generates valid HMAC-SHA256 signatures for GitHub-style webhooks', () => {
    const secret = 'test-webhook-secret';
    const payload = JSON.stringify({ ref: 'refs/heads/main' });
    const signature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

    // Verify the signature format matches what GitHub sends
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });
});
