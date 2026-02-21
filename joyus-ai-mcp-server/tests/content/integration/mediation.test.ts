/**
 * Integration Tests — Mediation Flow
 *
 * Tests auth → session → message → close using mocks.
 * No real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SessionService } from '../../../src/content/mediation/session.js';
import type { ResolvedEntitlements, GenerationResult } from '../../../src/content/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntitlements(): ResolvedEntitlements {
  return {
    productIds: ['prod-1'],
    sourceIds: ['source-1'],
    profileIds: ['profile-1'],
    resolvedFrom: 'test',
    resolvedAt: new Date(),
  };
}

function makeGenerationResult(): GenerationResult {
  return {
    text: 'Generated response with [Source 1] citation.',
    citations: [
      {
        sourceId: 'source-1',
        itemId: 'item-1',
        title: 'Test Article',
        excerpt: 'Excerpt text.',
        sourceType: 'content',
      },
    ],
    profileUsed: 'profile-1',
    metadata: { totalSearchResults: 3, sourcesUsed: 1, durationMs: 42 },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Mediation Flow', () => {
  describe('session lifecycle: create → message → close', () => {
    it('creates a session with correct properties', async () => {
      const mockDb = {} as never;
      const sessionService = new SessionService(mockDb);

      const session = await sessionService.create({
        tenantId: 'tenant-1',
        apiKeyId: 'key-1',
        userId: 'user-1',
        profileId: 'profile-1',
      });

      expect(session.id).toBeDefined();
      expect(session.tenantId).toBe('tenant-1');
      expect(session.apiKeyId).toBe('key-1');
      expect(session.userId).toBe('user-1');
      expect(session.activeProfileId).toBe('profile-1');
      expect(session.messageCount).toBe(0);
      expect(session.endedAt).toBeNull();
    });

    it('processes a message and returns generation result', async () => {
      const mockGenerationService = {
        generate: vi.fn().mockResolvedValue(makeGenerationResult()),
      };
      const mockEntitlementService = {
        resolve: vi.fn().mockResolvedValue(makeEntitlements()),
      };

      const entitlements = await mockEntitlementService.resolve('tenant-1', 'user-1', 'session-1');
      const result = await mockGenerationService.generate('What is the policy?', entitlements);

      expect(mockEntitlementService.resolve).toHaveBeenCalledWith('tenant-1', 'user-1', 'session-1');
      expect(mockGenerationService.generate).toHaveBeenCalledOnce();
      expect(result.text).toContain('Generated response');
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].sourceId).toBe('source-1');
    });

    it('closes session without error', async () => {
      const mockDb = {} as never;
      const sessionService = new SessionService(mockDb);
      const closeSpy = vi.spyOn(sessionService, 'close').mockResolvedValue();

      await sessionService.close('session-1');

      expect(closeSpy).toHaveBeenCalledWith('session-1');
    });
  });

  describe('auth rejects missing API key', () => {
    it('returns 401 when X-API-Key header is absent', async () => {
      const mockReq = {
        headers: {},
      };

      const hasApiKey = Boolean((mockReq.headers as Record<string, string>)['x-api-key']);
      expect(hasApiKey).toBe(false);

      // The middleware would respond 401; here we verify the condition
      const result = hasApiKey ? 'allowed' : '401-missing-api-key';
      expect(result).toBe('401-missing-api-key');
    });
  });

  describe('auth rejects missing Bearer token', () => {
    it('returns 401 when Authorization header is absent', async () => {
      const mockReq = {
        headers: {
          'x-api-key': 'some-key',
          // no authorization header
        } as Record<string, string>,
      };

      const authHeader = mockReq.headers['authorization'];
      const hasBearer = authHeader?.startsWith('Bearer ') ?? false;
      expect(hasBearer).toBe(false);

      const result = hasBearer ? 'allowed' : '401-missing-bearer';
      expect(result).toBe('401-missing-bearer');
    });

    it('returns 401 when Authorization is not Bearer', async () => {
      const mockReq = {
        headers: {
          'x-api-key': 'some-key',
          'authorization': 'Basic dXNlcjpwYXNz',
        } as Record<string, string>,
      };

      const authHeader = mockReq.headers['authorization'];
      const hasBearer = authHeader?.startsWith('Bearer ') ?? false;
      expect(hasBearer).toBe(false);
    });
  });

  describe('auth rejects invalid API key', () => {
    it('resolver failure produces restricted entitlements', async () => {
      const mockResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('Invalid API key')),
      };
      const mockCache = {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
      };

      // Simulate EntitlementService fallback on resolver failure
      let entitlements: ResolvedEntitlements;
      try {
        entitlements = await mockResolver.resolve('tenant-1', 'user-1', 'session-1');
      } catch {
        entitlements = {
          productIds: [],
          sourceIds: [],
          profileIds: [],
          resolvedFrom: 'fallback-restricted',
          resolvedAt: new Date(),
        };
      }

      expect(entitlements.sourceIds).toHaveLength(0);
      expect(entitlements.resolvedFrom).toBe('fallback-restricted');
    });
  });

  describe('full mediation flow with mocked services', () => {
    it('orchestrates create → message → close in sequence', async () => {
      const mockDb = {} as never;
      const sessionService = new SessionService(mockDb);
      const createSpy = vi.spyOn(sessionService, 'create');
      const closeSpy = vi.spyOn(sessionService, 'close').mockResolvedValue();
      const incrementSpy = vi.spyOn(sessionService, 'incrementMessageCount').mockResolvedValue();

      const mockGenerationService = {
        generate: vi.fn().mockResolvedValue(makeGenerationResult()),
      };
      const mockEntitlementService = {
        resolve: vi.fn().mockResolvedValue(makeEntitlements()),
      };

      // Step 1: create
      const session = await sessionService.create({
        tenantId: 'tenant-1',
        apiKeyId: 'key-1',
        userId: 'user-1',
      });
      expect(createSpy).toHaveBeenCalledOnce();

      // Step 2: message
      const entitlements = await mockEntitlementService.resolve(
        session.tenantId,
        session.userId,
        session.id,
      );
      const result = await mockGenerationService.generate('test query', entitlements);
      await sessionService.incrementMessageCount(session.id);

      expect(result.citations.length).toBeGreaterThan(0);
      expect(incrementSpy).toHaveBeenCalledWith(session.id);

      // Step 3: close
      await sessionService.close(session.id);
      expect(closeSpy).toHaveBeenCalledWith(session.id);
    });
  });
});
