import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SafetyService,
  PassThroughPreHook,
  PassThroughPostHook,
  createDefaultSafetyService,
  SafetyBlockedError,
} from '../../src/orchestrator/safety.service.js';
import type {
  PreGenerationHook,
  PostGenerationHook,
  PreGenerationContext,
  PostGenerationContext,
} from '../../src/orchestrator/safety.service.js';

const makePreContext = (overrides?: Partial<PreGenerationContext>): PreGenerationContext => ({
  tenantId: 'tenant-1',
  sessionId: 'session-1',
  systemPrompt: 'You are a helpful assistant.',
  messages: [],
  ...overrides,
});

const makePostContext = (overrides?: Partial<PostGenerationContext>): PostGenerationContext => ({
  tenantId: 'tenant-1',
  sessionId: 'session-1',
  response: 'Hello, how can I help?',
  ...overrides,
});

describe('SafetyService', () => {
  describe('pre-generation hooks', () => {
    it('allows all when no hooks registered', async () => {
      const service = new SafetyService();
      const result = await service.runPreHooks(makePreContext());
      expect(result.action).toBe('allow');
      expect(result).toHaveProperty('effectiveSystemPrompt', 'You are a helpful assistant.');
    });

    it('pass-through hook returns allow', async () => {
      const service = new SafetyService();
      service.registerPreHook(new PassThroughPreHook());
      const result = await service.runPreHooks(makePreContext());
      expect(result.action).toBe('allow');
    });

    it('block hook stops the chain', async () => {
      const service = new SafetyService();
      const blockHook: PreGenerationHook = {
        name: 'blocker',
        execute: async () => ({ action: 'block', reason: 'Content policy violation' }),
      };
      const neverReached: PreGenerationHook = {
        name: 'never',
        execute: vi.fn().mockResolvedValue({ action: 'allow' }),
      };
      service.registerPreHook(blockHook);
      service.registerPreHook(neverReached);

      const result = await service.runPreHooks(makePreContext());
      expect(result.action).toBe('block');
      expect(result).toHaveProperty('reason', 'Content policy violation');
      expect(neverReached.execute).not.toHaveBeenCalled();
    });

    it('modify hook updates system prompt for subsequent hooks', async () => {
      const service = new SafetyService();
      const modifyHook: PreGenerationHook = {
        name: 'modifier',
        execute: async () => ({
          action: 'modify',
          modifiedPrompt: 'MODIFIED: You are a safe assistant.',
          reason: 'Added safety prefix',
        }),
      };
      const verifyHook: PreGenerationHook = {
        name: 'verifier',
        execute: async (ctx) => {
          expect(ctx.systemPrompt).toBe('MODIFIED: You are a safe assistant.');
          return { action: 'allow' };
        },
      };
      service.registerPreHook(modifyHook);
      service.registerPreHook(verifyHook);

      const result = await service.runPreHooks(makePreContext());
      expect(result.action).toBe('modify');
      expect(result).toHaveProperty('effectiveSystemPrompt', 'MODIFIED: You are a safe assistant.');
    });
  });

  describe('post-generation hooks', () => {
    it('allows all when no hooks registered', async () => {
      const service = new SafetyService();
      const result = await service.runPostHooks(makePostContext());
      expect(result.action).toBe('allow');
      expect(result).toHaveProperty('effectiveResponse', 'Hello, how can I help?');
    });

    it('block hook suppresses response', async () => {
      const service = new SafetyService();
      const blockHook: PostGenerationHook = {
        name: 'output-filter',
        execute: async () => ({ action: 'block', reason: 'PII detected' }),
      };
      service.registerPostHook(blockHook);

      const result = await service.runPostHooks(makePostContext());
      expect(result.action).toBe('block');
      expect(result).toHaveProperty('reason', 'PII detected');
    });

    it('modify hook changes response', async () => {
      const service = new SafetyService();
      const modifyHook: PostGenerationHook = {
        name: 'redactor',
        execute: async () => ({
          action: 'modify',
          modifiedResponse: '[REDACTED]',
          reason: 'Sensitive content removed',
        }),
      };
      service.registerPostHook(modifyHook);

      const result = await service.runPostHooks(makePostContext());
      expect(result.action).toBe('modify');
      expect(result).toHaveProperty('effectiveResponse', '[REDACTED]');
    });
  });

  describe('audit events', () => {
    it('emits audit events for each hook execution', async () => {
      const emitEvent = vi.fn().mockResolvedValue(undefined);
      const eventService = { emitEvent } as any;
      const service = new SafetyService(eventService);
      service.registerPreHook(new PassThroughPreHook());

      await service.runPreHooks(makePreContext());

      expect(emitEvent).toHaveBeenCalledWith(
        'tenant-1',
        'safety.pre_hook.executed',
        expect.objectContaining({
          hookName: 'passthrough-pre',
          action: 'allow',
        }),
        'session-1',
      );
    });

    it('continues even when event emission fails', async () => {
      const eventService = {
        emitEvent: vi.fn().mockRejectedValue(new Error('DB down')),
      } as any;
      const service = new SafetyService(eventService);
      service.registerPreHook(new PassThroughPreHook());

      const result = await service.runPreHooks(makePreContext());
      expect(result.action).toBe('allow');
    });
  });

  describe('createDefaultSafetyService', () => {
    it('creates service with pass-through hooks', async () => {
      const service = createDefaultSafetyService();
      const preResult = await service.runPreHooks(makePreContext());
      const postResult = await service.runPostHooks(makePostContext());
      expect(preResult.action).toBe('allow');
      expect(postResult.action).toBe('allow');
    });
  });

  describe('SafetyBlockedError', () => {
    it('includes phase and reason', () => {
      const err = new SafetyBlockedError('pre', 'Content policy');
      expect(err.phase).toBe('pre');
      expect(err.reason).toBe('Content policy');
      expect(err.message).toContain('pre-generation');
    });
  });
});
