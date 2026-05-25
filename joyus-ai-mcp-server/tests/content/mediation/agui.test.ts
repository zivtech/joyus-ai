import { describe, expect, it } from 'vitest';

import {
  MEDIATION_APPROVAL_AGUI_EVENT_NAMES,
  createMediationApprovalAguiEvents,
  createMediationApprovalDecisionEvent,
  createMediationApprovalRequest,
  createMediationApprovalResponse,
} from '../../../src/content/mediation/agui.js';
import {
  createMediationResponseProposal,
  evaluateMediationActionProposal,
} from '../../../src/content/mediation/judge.js';
import type {
  ActionProposal,
  ActionRiskFlag,
  Citation,
  GenerationResult,
  ResolvedEntitlements,
} from '../../../src/content/types.js';

const NOW = new Date('2026-05-25T12:00:00.000Z');

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
    sourceIds: ['source-a', 'source-b'],
    profileIds: ['profile-a'],
    resolvedFrom: 'resolver-a',
    resolvedAt: NOW,
    ...overrides,
  };
}

function baseProposal(overrides: { generationResult?: GenerationResult } = {}): ActionProposal {
  return createMediationResponseProposal({
    requestId: 'request-a',
    tenantId: 'tenant-a',
    userId: 'user-a',
    apiKeyId: 'api-key-a',
    sessionId: 'session-a',
    profileId: 'profile-a',
    entitlements: makeEntitlements(),
    generationResult: overrides.generationResult ?? makeGenerationResult(),
    proposedAt: NOW,
  });
}

function withRiskFlags(proposal: ActionProposal, riskFlags: ActionRiskFlag[]): ActionProposal {
  return { ...proposal, riskFlags };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe('mediation AG-UI approval adapter', () => {
  it('maps escalate judgments to an approval request stream', () => {
    const proposal = withRiskFlags(baseProposal(), ['policy_conflict']);
    const judgment = evaluateMediationActionProposal(proposal);

    const events = createMediationApprovalAguiEvents(proposal, judgment, {
      approvalRequestId: 'approval-a',
      now: NOW,
      ttlMs: 60_000,
    });
    const customEvent = events.find(event => event.type === 'CUSTOM');

    expect(judgment.outcome).toBe('escalate');
    expect(events.map(event => event.type)).toEqual([
      'RUN_STARTED',
      'STATE_DELTA',
      'CUSTOM',
      'RUN_FINISHED',
    ]);
    expect(customEvent).toEqual(
      expect.objectContaining({
        name: MEDIATION_APPROVAL_AGUI_EVENT_NAMES.requested,
        value: expect.objectContaining({
          approvalRequestId: 'approval-a',
          kind: 'approval_request',
          status: 'awaiting_user_decision',
          actionProposalId: proposal.id,
          judgmentId: judgment.id,
          judgeOutcome: 'escalate',
          actionType: 'deliver_mediation_response',
          expiresAt: '2026-05-25T12:01:00.000Z',
          responseContract: expect.objectContaining({
            decisions: ['approve', 'reject', 'revise_with_edits'],
          }),
          resume: expect.objectContaining({
            requestId: 'request-a',
            sessionId: 'session-a',
            actionProposalId: proposal.id,
            judgmentId: judgment.id,
          }),
        }),
      })
    );
  });

  it('maps revise judgments to an editable revision request', () => {
    const proposal = baseProposal({
      generationResult: makeGenerationResult({
        citations: [],
        metadata: {
          generationLogId: 'generation-log-empty',
          totalSearchResults: 0,
          sourcesUsed: 0,
          durationMs: 10,
        },
      }),
    });
    const judgment = evaluateMediationActionProposal(proposal);

    const request = createMediationApprovalRequest(proposal, judgment, {
      approvalRequestId: 'approval-revise',
      now: NOW,
    });

    expect(judgment.outcome).toBe('revise');
    expect(request.kind).toBe('revision_request');
    expect(request.requiredRevision).toEqual(
      expect.objectContaining({
        instruction: 'Revise the response proposal before delivery.',
        mustChange: expect.arrayContaining([
          'Attach authoritative cited content evidence or change the response to state that no supported answer is available.',
        ]),
      })
    );
  });

  it('accepts approval, rejection, and revise-with-edits responses with deterministic next actions', () => {
    expect(
      createMediationApprovalResponse({
        approvalRequestId: 'approval-a',
        actionProposalId: 'proposal-a',
        decision: 'approve',
        decidedAt: NOW,
      })
    ).toEqual(
      expect.objectContaining({
        decision: 'approve',
        nextAction: 'execute',
        decidedAt: NOW.toISOString(),
      })
    );

    expect(
      createMediationApprovalResponse({
        approvalRequestId: 'approval-a',
        actionProposalId: 'proposal-a',
        decision: 'reject',
        decidedAt: NOW,
      })
    ).toEqual(
      expect.objectContaining({
        decision: 'reject',
        nextAction: 'cancel',
      })
    );

    const revised = createMediationApprovalResponse({
      approvalRequestId: 'approval-a',
      actionProposalId: 'proposal-a',
      decision: 'revise_with_edits',
      editedPayloadSummary: 'Use a narrower supported answer.',
      decidedAt: NOW,
    });
    expect(revised).toEqual(
      expect.objectContaining({
        decision: 'revise_with_edits',
        nextAction: 'rerun_judge',
        editedPayloadSummary: 'Use a narrower supported answer.',
      })
    );
    expect(createMediationApprovalDecisionEvent(revised, NOW)).toEqual(
      expect.objectContaining({
        type: 'CUSTOM',
        name: MEDIATION_APPROVAL_AGUI_EVENT_NAMES.decided,
        timestamp: NOW.getTime(),
        value: revised,
      })
    );
  });

  it('rejects unsupported or incomplete approval responses', () => {
    expect(() =>
      createMediationApprovalResponse({
        approvalRequestId: 'approval-a',
        actionProposalId: 'proposal-a',
        decision: 'revise_with_edits',
      })
    ).toThrow('revise_with_edits requires editedPayloadSummary');

    expect(() =>
      createMediationApprovalResponse({
        approvalRequestId: 'approval-a',
        actionProposalId: 'proposal-a',
        decision: 'defer' as never,
      })
    ).toThrow('Unsupported approval decision');
  });

  it('does not expose raw authorization, tenant, user, or API-key data', () => {
    const proposal = withRiskFlags(baseProposal(), ['policy_conflict']);
    const judgment = evaluateMediationActionProposal(proposal);
    const request = createMediationApprovalRequest(proposal, judgment, {
      approvalRequestId: 'approval-a',
      now: NOW,
    });
    const serialized = json(request);

    expect(serialized).not.toContain('tenant-a');
    expect(serialized).not.toContain('user-a');
    expect(serialized).not.toContain('api-key-a');
    expect(serialized).not.toContain('authorizedSourceIds');
    expect(serialized).not.toContain('authorizedProfileIds');
    expect(serialized).not.toContain('"criteria"');
    expect(serialized).not.toContain('"authorization"');
    expect(serialized).not.toContain('"evidence"');
  });

  it('requires a revise or escalate judgment', () => {
    const proposal = baseProposal();
    const judgment = evaluateMediationActionProposal(proposal);

    expect(judgment.outcome).toBe('allow');
    expect(() =>
      createMediationApprovalRequest(proposal, judgment, {
        now: NOW,
      })
    ).toThrow('Cannot create approval request for allow judgment');
  });
});
