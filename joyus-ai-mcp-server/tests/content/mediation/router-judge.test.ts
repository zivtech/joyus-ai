import type { Router } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createMediationRouter } from '../../../src/content/mediation/router.js';
import type { JudgeOutcome, JudgeResult } from '../../../src/content/types.js';

function makeResponse() {
  const res = {} as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeRequest() {
  return {
    params: { sessionId: 'session-a' },
    body: { message: 'What does the reference say?', maxSources: 3 },
    headers: { 'x-request-id': 'request-a' },
    tenantId: 'tenant-a',
    userId: 'user-a',
    apiKeyRecord: { id: 'api-key-a' },
  };
}

function makeJudgment(outcome: JudgeOutcome): JudgeResult {
  return {
    id: `judgment-${outcome}`,
    proposalId: 'proposal-a',
    judgedAt: '2026-05-25T12:00:00.000Z',
    policyVersion: 'mediation-response-judge-v1',
    outcome,
    reasonCode: `${outcome}_reason`,
    summary: `Judge returned ${outcome}.`,
    criteria: [],
    ...(outcome === 'revise' && {
      requiredRevision: {
        instruction: 'Revise before delivery.',
        mustChange: ['Add cited evidence.'],
      },
    }),
    ...(outcome === 'escalate' && {
      escalation: {
        reason: 'Human review required.',
        reviewerHint: 'Review exposure.',
      },
    }),
    latencyMs: 1,
  };
}

function findRouteHandler(router: Router, method: string, path: string) {
  const stack = (router as unknown as { stack: Array<Record<string, any>> }).stack;
  const layer = stack.find((candidate) => (
    candidate.route?.path === path &&
    candidate.route?.methods?.[method] === true
  ));
  if (!layer?.route?.stack?.[0]?.handle) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack[0].handle as (req: unknown, res: unknown) => Promise<void>;
}

function makeDeps(outcome: JudgeOutcome) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const db = {
    insert: vi.fn().mockReturnValue({ values: insertValues }),
  };
  const generationService = {
    generate: vi.fn().mockResolvedValue({
      text: 'Generated response [Source 1].',
      citations: [{
        sourceId: 'source-a',
        itemId: 'item-a',
        title: 'Reference A',
        excerpt: 'Excerpt A',
        sourceType: 'article',
      }],
      profileUsed: 'profile-a',
      metadata: {
        generationLogId: 'generation-log-a',
        totalSearchResults: 1,
        sourcesUsed: 1,
        durationMs: 42,
      },
    }),
  };
  const entitlementService = {
    resolve: vi.fn().mockResolvedValue({
      productIds: ['product-a'],
      sourceIds: ['source-a'],
      profileIds: ['profile-a'],
      resolvedFrom: 'resolver-a',
      resolvedAt: new Date('2026-05-25T12:00:00.000Z'),
    }),
  };
  const entitlementCache = {
    invalidate: vi.fn(),
  };
  const sessionService = {
    createSession: vi.fn(),
    getSession: vi.fn().mockResolvedValue({
      id: 'session-a',
      tenantId: 'tenant-a',
      userId: 'user-a',
      apiKeyId: 'api-key-a',
      activeProfileId: 'profile-a',
      endedAt: null,
    }),
    incrementMessageCount: vi.fn().mockResolvedValue({
      idleGapSeconds: 0,
      isCacheMiss: false,
    }),
    closeSession: vi.fn(),
  };
  const judgeService = {
    judge: vi.fn().mockResolvedValue(makeJudgment(outcome)),
  };

  return {
    deps: {
      db: db as never,
      generationService: generationService as never,
      entitlementService: entitlementService as never,
      entitlementCache: entitlementCache as never,
      sessionService,
      judgeService,
    },
    insertValues,
    generationService,
    entitlementService,
    sessionService,
    judgeService,
  };
}

describe('mediation router judge boundary', () => {
  it('allows delivery only after judgment and audit logging succeed', async () => {
    const { deps, insertValues, sessionService, judgeService } = makeDeps('allow');
    const router = createMediationRouter(deps);
    const handler = findRouteHandler(router, 'post', '/sessions/:sessionId/messages');
    const req = makeRequest();
    const res = makeResponse();

    await handler(req, res);

    expect(judgeService.judge).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'mediate',
      success: true,
      metadata: expect.objectContaining({
        event: 'mediation.judge.evaluated',
        enforcement: expect.objectContaining({ executed: true, outcome: 'allow' }),
      }),
    }));
    expect(sessionService.incrementMessageCount).toHaveBeenCalledOnce();
    expect(
      judgeService.judge.mock.invocationCallOrder[0],
    ).toBeLessThan(sessionService.incrementMessageCount.mock.invocationCallOrder[0]);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Generated response [Source 1].',
      metadata: expect.objectContaining({
        judgment: expect.objectContaining({ outcome: 'allow' }),
      }),
    }));
  });

  it.each([
    ['block' as const, 403],
    ['revise' as const, 409],
    ['escalate' as const, 202],
  ])('halts delivery for %s judgments', async (outcome, statusCode) => {
    const { deps, insertValues, sessionService, judgeService } = makeDeps(outcome);
    const router = createMediationRouter(deps);
    const handler = findRouteHandler(router, 'post', '/sessions/:sessionId/messages');
    const req = makeRequest();
    const res = makeResponse();

    await handler(req, res);

    expect(judgeService.judge).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'mediate',
      success: false,
      metadata: expect.objectContaining({
        event: 'mediation.judge.evaluated',
        enforcement: expect.objectContaining({ executed: false, outcome }),
      }),
    }));
    expect(sessionService.incrementMessageCount).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(statusCode);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: `judge_${outcome}`,
      judgment: expect.objectContaining({ outcome }),
    }));
  });
});
