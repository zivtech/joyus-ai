import { describe, expect, it } from 'vitest';

import {
  DeterministicMediationJudgeService,
  createMediationResponseProposal,
  runJudgeEvaluationSuite,
} from '../../../src/content/mediation/judge.js';
import type {
  ActionProposal,
  ActionRiskFlag,
  Citation,
  GenerationResult,
  JudgeOutcome,
  ResolvedEntitlements,
} from '../../../src/content/types.js';

function makeCitation(id: string): Citation {
  return {
    sourceId: `source-${id}`,
    itemId: `item-${id}`,
    title: `Reference ${id}`,
    excerpt: `Excerpt ${id}`,
    sourceType: 'article',
  };
}

function makeGenerationResult(overrides: Partial<GenerationResult> = {}): GenerationResult {
  const citations = overrides.citations ?? [makeCitation('a')];
  return {
    text: 'Use the cited reference to answer the requester.',
    citations,
    profileUsed: 'profile-a',
    metadata: {
      generationLogId: 'generation-log-a',
      totalSearchResults: citations.length,
      sourcesUsed: citations.length,
      durationMs: 35,
      ...overrides.metadata,
    },
    ...overrides,
  };
}

function makeEntitlements(overrides: Partial<ResolvedEntitlements> = {}): ResolvedEntitlements {
  return {
    productIds: ['product-a'],
    sourceIds: ['source-a', 'source-b', 'source-c'],
    profileIds: ['profile-a', 'profile-b'],
    resolvedFrom: 'resolver-a',
    resolvedAt: new Date('2026-05-25T12:00:00.000Z'),
    ...overrides,
  };
}

function baseProposal(
  options: {
    generationResult?: GenerationResult;
    entitlements?: ResolvedEntitlements;
    profileId?: string | null;
  } = {},
): ActionProposal {
  return createMediationResponseProposal({
    requestId: 'request-a',
    tenantId: 'tenant-a',
    userId: 'user-a',
    apiKeyId: 'api-key-a',
    sessionId: 'session-a',
    profileId: options.profileId === undefined ? 'profile-a' : options.profileId,
    entitlements: options.entitlements ?? makeEntitlements(),
    generationResult: options.generationResult ?? makeGenerationResult(),
    proposedAt: new Date('2026-05-25T12:00:00.000Z'),
  });
}

function withRiskFlags(
  proposal: ActionProposal,
  riskFlags: ActionRiskFlag[],
): ActionProposal {
  return { ...proposal, riskFlags };
}

function withExpectedOutcome(
  id: string,
  expectedOutcome: JudgeOutcome,
  proposal: ActionProposal,
) {
  return { id, expectedOutcome, proposal };
}

describe('DeterministicMediationJudgeService', () => {
  it('allows a well-formed mediation response proposal', async () => {
    const judge = new DeterministicMediationJudgeService();

    const result = await judge.judge(baseProposal());

    expect(result.outcome).toBe('allow');
    expect(result.criteria).toHaveLength(8);
    expect(result.reasonCode).toBe('criteria_satisfied');
  });

  it('blocks profile authorization mismatches', async () => {
    const judge = new DeterministicMediationJudgeService();
    const proposal = baseProposal({
      profileId: 'profile-c',
      entitlements: makeEntitlements({ profileIds: ['profile-a'] }),
    });

    const result = await judge.judge(proposal);

    expect(result.outcome).toBe('block');
    expect(result.reasonCode).toBe('profile_not_authorized');
  });

  it('reports metrics for a 20-case allow/block/revise/escalate suite', async () => {
    const judge = new DeterministicMediationJudgeService();
    const multiCitation = makeGenerationResult({
      citations: [makeCitation('a'), makeCitation('b')],
      metadata: {
        generationLogId: 'generation-log-b',
        totalSearchResults: 2,
        sourcesUsed: 2,
        durationMs: 40,
      },
    });
    const noEvidence = makeGenerationResult({
      citations: [],
      metadata: {
        generationLogId: 'generation-log-empty',
        totalSearchResults: 0,
        sourcesUsed: 0,
        durationMs: 20,
      },
    });

    const cases = [
      withExpectedOutcome('allow-basic', 'allow', baseProposal()),
      withExpectedOutcome('allow-no-profile', 'allow', baseProposal({ profileId: null })),
      withExpectedOutcome('allow-multi-citation', 'allow', baseProposal({ generationResult: multiCitation })),
      withExpectedOutcome('allow-alt-profile', 'allow', baseProposal({ profileId: 'profile-b' })),
      withExpectedOutcome('allow-manual-rollback', 'allow', {
        ...baseProposal(),
        rollbackPath: { method: 'manual', description: 'Correction can be issued.' },
      }),

      withExpectedOutcome('block-missing-auth', 'block', withRiskFlags(baseProposal(), ['missing_authorization'])),
      withExpectedOutcome('block-auth-mismatch', 'block', {
        ...baseProposal(),
        authorization: { ...baseProposal().authorization, tenantId: 'tenant-b' },
      }),
      withExpectedOutcome('block-profile', 'block', baseProposal({
        profileId: 'profile-c',
        entitlements: makeEntitlements({ profileIds: ['profile-a'] }),
      })),
      withExpectedOutcome('block-source', 'block', baseProposal({
        entitlements: makeEntitlements({ sourceIds: ['source-b'] }),
      })),
      withExpectedOutcome('block-empty-payload', 'block', baseProposal({
        generationResult: makeGenerationResult({ text: '' }),
      })),

      withExpectedOutcome('revise-no-evidence', 'revise', baseProposal({ generationResult: noEvidence })),
      withExpectedOutcome('revise-stale-evidence', 'revise', withRiskFlags(baseProposal(), ['stale_evidence'])),
      withExpectedOutcome('revise-ambiguous-target', 'revise', withRiskFlags(baseProposal(), ['ambiguous_target'])),
      withExpectedOutcome('revise-not-authoritative', 'revise', {
        ...baseProposal(),
        evidence: { ...baseProposal().evidence, authoritative: false },
      }),
      withExpectedOutcome('revise-stale-source', 'revise', {
        ...baseProposal(),
        evidence: {
          ...baseProposal().evidence,
          sources: baseProposal().evidence.sources.map((source) => (
            source.sourceType === 'content_item' ? { ...source, isStale: true } : source
          )),
        },
      }),

      withExpectedOutcome('escalate-policy-conflict', 'escalate', withRiskFlags(baseProposal(), ['policy_conflict'])),
      withExpectedOutcome('escalate-sensitive-data', 'escalate', withRiskFlags(baseProposal(), ['sensitive_data_exposure'])),
      withExpectedOutcome('escalate-broad-exposure', 'escalate', withRiskFlags(baseProposal(), ['broad_external_exposure'])),
      withExpectedOutcome('escalate-high-stakes', 'escalate', withRiskFlags(baseProposal(), ['high_stakes_action'])),
      withExpectedOutcome('escalate-no-correction-path', 'escalate', {
        ...baseProposal(),
        expectedConsequence: {
          ...baseProposal().expectedConsequence,
          affectsOtherUsers: true,
        },
        rollbackPath: {
          method: 'none',
          description: 'No rollback path exists.',
        },
      }),
    ];

    const metrics = await runJudgeEvaluationSuite(judge, cases);

    expect(metrics.totalCases).toBe(20);
    expect(metrics.outcomeCounts).toEqual({
      allow: 5,
      block: 5,
      revise: 5,
      escalate: 5,
    });
    expect(metrics.falseAllowRate).toBe(0);
    expect(metrics.falseBlockRate).toBe(0);
    expect(metrics.escalationRate).toBe(0.25);
    expect(metrics.revisionRate).toBe(0.25);
    expect(metrics.averageLatencyMs).toBeGreaterThanOrEqual(0);
    expect(metrics.mismatches).toEqual([]);
  });
});
