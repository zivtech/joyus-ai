/**
 * Tests for built-in step handlers and StepRegistry.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '../../../src/pipelines/engine/step-runner.js';
import type {
  StepHandlerDependencies,
  ProfileEngineClient,
  ContentIntelClient,
  ContentInfraClient,
  NotificationService,
} from '../../../src/pipelines/steps/index.js';
import {
  ProfileGenerationHandler,
  FidelityCheckHandler,
  ContentGenerationHandler,
  SourceQueryHandler,
  NotificationHandler,
  StepRegistry,
  createStepRegistry,
} from '../../../src/pipelines/steps/index.js';

// ============================================================
// SHARED FIXTURES
// ============================================================

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    tenantId: 'tenant-1',
    executionId: 'exec-abc',
    pipelineId: 'pipe-xyz',
    triggerPayload: {},
    previousStepOutputs: new Map(),
    ...overrides,
  };
}

// ============================================================
// ProfileGenerationHandler
// ============================================================

describe('ProfileGenerationHandler', () => {
  it('validates config — rejects missing profileIds', () => {
    const handler = new ProfileGenerationHandler({});
    expect(handler.validateConfig({})).toHaveLength(1);
    expect(handler.validateConfig({ profileIds: [] })).toHaveLength(1);
  });

  it('validates config — accepts valid profileIds', () => {
    const handler = new ProfileGenerationHandler({});
    expect(handler.validateConfig({ profileIds: ['p1'] })).toHaveLength(0);
  });

  it('executes successfully', async () => {
    const profileEngine: ProfileEngineClient = {
      regenerateProfile: vi.fn().mockResolvedValue({ profileId: 'p1', success: true }),
    };
    const handler = new ProfileGenerationHandler({ profileEngine });
    const result = await handler.execute({ profileIds: ['p1'] }, makeContext());
    expect(result.success).toBe(true);
    expect(result.outputData?.['regenerated']).toHaveLength(1);
  });

  it('returns non-transient error when dep missing', async () => {
    const handler = new ProfileGenerationHandler({});
    const result = await handler.execute({ profileIds: ['p1'] }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error?.isTransient).toBe(false);
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.type).toBe('configuration');
  });

  it('classifies network errors as transient', async () => {
    const profileEngine: ProfileEngineClient = {
      regenerateProfile: vi.fn().mockRejectedValue(new Error('network timeout')),
    };
    const handler = new ProfileGenerationHandler({ profileEngine });
    const result = await handler.execute({ profileIds: ['p1'] }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error?.isTransient).toBe(true);
    expect(result.error?.retryable).toBe(true);
  });
});

// ============================================================
// FidelityCheckHandler
// ============================================================

describe('FidelityCheckHandler', () => {
  it('validates config — rejects missing profileId', () => {
    const handler = new FidelityCheckHandler({});
    const errors = handler.validateConfig({ contentIds: ['c1'] });
    expect(errors.some((e) => /profileId/.test(e))).toBe(true);
  });

  it('validates config — rejects missing contentIds and useUpstreamOutputs', () => {
    const handler = new FidelityCheckHandler({});
    const errors = handler.validateConfig({ profileId: 'p1' });
    expect(errors.some((e) => /contentIds/.test(e))).toBe(true);
  });

  it('validates config — accepts useUpstreamOutputs=true', () => {
    const handler = new FidelityCheckHandler({});
    expect(handler.validateConfig({ profileId: 'p1', useUpstreamOutputs: true })).toHaveLength(0);
  });

  it('low score = success with passed=false (not a step failure)', async () => {
    const contentIntelligence: ContentIntelClient = {
      runFidelityCheck: vi.fn().mockResolvedValue({ score: 0.3, passed: false }),
    };
    const handler = new FidelityCheckHandler({ contentIntelligence });
    const result = await handler.execute(
      { profileId: 'p1', contentIds: ['c1'] },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(result.outputData?.['passed']).toBe(false);
    expect(result.outputData?.['score']).toBe(0.3);
  });

  it('high score = success with passed=true', async () => {
    const contentIntelligence: ContentIntelClient = {
      runFidelityCheck: vi.fn().mockResolvedValue({ score: 0.95, passed: true }),
    };
    const handler = new FidelityCheckHandler({ contentIntelligence });
    const result = await handler.execute(
      { profileId: 'p1', contentIds: ['c1'] },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(result.outputData?.['passed']).toBe(true);
  });

  it('returns non-transient error when dep missing', async () => {
    const handler = new FidelityCheckHandler({});
    const result = await handler.execute(
      { profileId: 'p1', contentIds: ['c1'] },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('configuration');
    expect(result.error?.isTransient).toBe(false);
  });

  it('classifies network errors as transient', async () => {
    const contentIntelligence: ContentIntelClient = {
      runFidelityCheck: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const handler = new FidelityCheckHandler({ contentIntelligence });
    const result = await handler.execute(
      { profileId: 'p1', contentIds: ['c1'] },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.error?.isTransient).toBe(true);
  });
});

// ============================================================
// ContentGenerationHandler
// ============================================================

describe('ContentGenerationHandler', () => {
  it('validates config — rejects missing prompt', () => {
    const handler = new ContentGenerationHandler({});
    expect(handler.validateConfig({})).toHaveLength(1);
    expect(handler.validateConfig({ prompt: '  ' })).toHaveLength(1);
  });

  it('executes successfully and returns artifactRef', async () => {
    const contentInfrastructure: ContentInfraClient = {
      generateContent: vi.fn().mockResolvedValue({ artifactId: 'art-1', type: 'document' }),
      querySource: vi.fn(),
    };
    const handler = new ContentGenerationHandler({ contentInfrastructure });
    const result = await handler.execute({ prompt: 'Write a summary' }, makeContext());
    expect(result.success).toBe(true);
    expect(result.outputData?.['artifactRef']).toMatchObject({ id: 'art-1', type: 'document' });
  });

  it('returns non-transient error when dep missing', async () => {
    const handler = new ContentGenerationHandler({});
    const result = await handler.execute({ prompt: 'Write something' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('configuration');
    expect(result.error?.isTransient).toBe(false);
  });

  it('classifies network errors as transient', async () => {
    const contentInfrastructure: ContentInfraClient = {
      generateContent: vi.fn().mockRejectedValue(new Error('network timeout')),
      querySource: vi.fn(),
    };
    const handler = new ContentGenerationHandler({ contentInfrastructure });
    const result = await handler.execute({ prompt: 'Write something' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error?.isTransient).toBe(true);
  });
});

// ============================================================
// SourceQueryHandler
// ============================================================

describe('SourceQueryHandler', () => {
  it('validates config — rejects missing query', () => {
    const handler = new SourceQueryHandler({});
    expect(handler.validateConfig({})).toHaveLength(1);
  });

  it('executes successfully and returns items', async () => {
    const contentInfrastructure: ContentInfraClient = {
      generateContent: vi.fn(),
      querySource: vi.fn().mockResolvedValue({ items: [{ id: 'doc-1' }], total: 1 }),
    };
    const handler = new SourceQueryHandler({ contentInfrastructure });
    const result = await handler.execute({ query: 'search term' }, makeContext());
    expect(result.success).toBe(true);
    expect(result.outputData?.['items']).toHaveLength(1);
    expect(result.outputData?.['total']).toBe(1);
  });

  it('returns non-transient error when dep missing', async () => {
    const handler = new SourceQueryHandler({});
    const result = await handler.execute({ query: 'search term' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('configuration');
    expect(result.error?.isTransient).toBe(false);
  });

  it('classifies network errors as transient', async () => {
    const contentInfrastructure: ContentInfraClient = {
      generateContent: vi.fn(),
      querySource: vi.fn().mockRejectedValue(new Error('ETIMEDOUT')),
    };
    const handler = new SourceQueryHandler({ contentInfrastructure });
    const result = await handler.execute({ query: 'search term' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error?.isTransient).toBe(true);
  });
});

// ============================================================
// NotificationHandler
// ============================================================

describe('NotificationHandler', () => {
  it('validates config — rejects missing channel', () => {
    const handler = new NotificationHandler({});
    expect(handler.validateConfig({ message: 'hi' })).toHaveLength(1);
  });

  it('validates config — rejects missing message', () => {
    const handler = new NotificationHandler({});
    expect(handler.validateConfig({ channel: 'slack' })).toHaveLength(1);
  });

  it('executes successfully', async () => {
    const notificationService: NotificationService = {
      send: vi.fn().mockResolvedValue({ sent: true, messageId: 'msg-1' }),
    };
    const handler = new NotificationHandler({ notificationService });
    const result = await handler.execute(
      { channel: 'slack', message: 'Pipeline {pipelineName} done ({executionId})' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(result.outputData?.['sent']).toBe(true);
    // Verify template substitution happened
    expect(notificationService.send).toHaveBeenCalledWith(
      'slack',
      'Pipeline pipe-xyz done (exec-abc)',
      undefined,
    );
  });

  it('returns non-transient error when dep missing', async () => {
    const handler = new NotificationHandler({});
    const result = await handler.execute(
      { channel: 'email', message: 'Done' },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('configuration');
    expect(result.error?.isTransient).toBe(false);
  });

  it('classifies network errors as transient', async () => {
    const notificationService: NotificationService = {
      send: vi.fn().mockRejectedValue(new Error('network error')),
    };
    const handler = new NotificationHandler({ notificationService });
    const result = await handler.execute(
      { channel: 'slack', message: 'Done' },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.error?.isTransient).toBe(true);
  });
});

// ============================================================
// StepRegistry
// ============================================================

describe('StepRegistry / createStepRegistry', () => {
  it('registers all 5 built-in handlers', () => {
    const registry = createStepRegistry({});
    const types = registry.getRegisteredTypes();
    expect(types).toContain('profile_generation');
    expect(types).toContain('fidelity_check');
    expect(types).toContain('content_generation');
    expect(types).toContain('source_query');
    expect(types).toContain('notification');
    expect(types).toHaveLength(5);
  });

  it('returns undefined for review_gate (handled by executor)', () => {
    const registry = createStepRegistry({});
    expect(registry.getHandler('review_gate')).toBeUndefined();
  });

  it('returns undefined for unknown type', () => {
    const registry = createStepRegistry({});
    expect(registry.getHandler('unknown' as never)).toBeUndefined();
  });

  it('returns validation errors for a known type', () => {
    const registry = createStepRegistry({});
    const errors = registry.validateStepConfig('profile_generation', {});
    expect(errors).toHaveLength(1);
  });

  it('returns error for unregistered type in validateStepConfig', () => {
    const registry = createStepRegistry({});
    const errors = registry.validateStepConfig('review_gate', {});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/No handler/);
  });

  it('register() allows adding a custom handler', () => {
    const registry = new StepRegistry();
    const fakeHandler = {
      stepType: 'notification' as const,
      execute: vi.fn(),
      validateConfig: vi.fn().mockReturnValue([]),
    };
    registry.register(fakeHandler);
    expect(registry.getHandler('notification')).toBe(fakeHandler);
  });
});
