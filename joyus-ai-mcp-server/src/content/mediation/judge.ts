import { createId } from '@paralleldrive/cuid2';

import type {
  ActionEvidenceSource,
  ActionProposal,
  ActionRiskFlag,
  GenerationResult,
  JudgeCriterionCategory,
  JudgeCriterionResult,
  JudgeCriterionSeverity,
  JudgeOutcome,
  JudgeResult,
  ResolvedEntitlements,
} from '../types.js';

export const MEDIATION_RESPONSE_JUDGE_POLICY_VERSION = 'mediation-response-judge-v1';

export interface MediationJudgeService {
  judge(proposal: ActionProposal): Promise<JudgeResult>;
}

export interface CreateMediationResponseProposalInput {
  requestId: string;
  tenantId: string;
  userId: string;
  apiKeyId: string;
  sessionId: string;
  profileId: string | null;
  entitlements: ResolvedEntitlements;
  generationResult: GenerationResult;
  proposedAt?: Date;
}

export interface JudgeEvaluationCase {
  id: string;
  proposal: ActionProposal;
  expectedOutcome: JudgeOutcome;
}

export interface JudgeEvaluationMetrics {
  totalCases: number;
  outcomeCounts: Record<JudgeOutcome, number>;
  falseAllowRate: number;
  falseBlockRate: number;
  escalationRate: number;
  revisionRate: number;
  averageLatencyMs: number;
  mismatches: Array<{
    caseId: string;
    expectedOutcome: JudgeOutcome;
    actualOutcome: JudgeOutcome;
  }>;
}

function hasRiskFlag(proposal: ActionProposal, flag: ActionRiskFlag): boolean {
  return proposal.riskFlags.includes(flag);
}

function uniqueRiskFlags(flags: ActionRiskFlag[]): ActionRiskFlag[] {
  return Array.from(new Set(flags));
}

function criterion(
  criterionId: string,
  category: JudgeCriterionCategory,
  question: string,
  passed: boolean,
  severity: JudgeCriterionSeverity,
  reasonCode: string,
  details: string,
): JudgeCriterionResult {
  return {
    criterionId,
    category,
    question,
    passed,
    severity,
    reasonCode,
    details,
  };
}

function countByOutcome(results: JudgeResult[]): Record<JudgeOutcome, number> {
  return results.reduce<Record<JudgeOutcome, number>>(
    (counts, result) => ({
      ...counts,
      [result.outcome]: counts[result.outcome] + 1,
    }),
    { allow: 0, block: 0, revise: 0, escalate: 0 },
  );
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export function createMediationResponseProposal(
  input: CreateMediationResponseProposalInput,
): ActionProposal {
  const proposedAt = input.proposedAt ?? new Date();
  const citations = input.generationResult.citations;
  const citedSourceIds = Array.from(new Set(citations.map((citation) => citation.sourceId)));
  const unauthorizedSourceIds = citedSourceIds.filter(
    (sourceId) => !input.entitlements.sourceIds.includes(sourceId),
  );

  const contentEvidence: ActionEvidenceSource[] = citations.map((citation) => ({
    sourceType: 'content_item',
    sourceId: citation.sourceId,
    tenantId: input.tenantId,
    relevance: `Generated response cites ${citation.title} (${citation.itemId})`,
    isAuthoritative: true,
    isStale: false,
  }));

  const riskFlags: ActionRiskFlag[] = [];
  if (input.generationResult.text.trim().length === 0) riskFlags.push('empty_payload');
  if (citations.length === 0 || input.generationResult.metadata.sourcesUsed === 0) {
    riskFlags.push('missing_evidence');
  }
  if (input.profileId && !input.entitlements.profileIds.includes(input.profileId)) {
    riskFlags.push('profile_not_authorized');
  }
  if (unauthorizedSourceIds.length > 0) riskFlags.push('source_not_authorized');

  return {
    id: createId(),
    proposedAt: proposedAt.toISOString(),
    policyVersion: MEDIATION_RESPONSE_JUDGE_POLICY_VERSION,
    action: {
      type: 'deliver_mediation_response',
      target: {
        entityType: 'external_response',
        entityId: input.sessionId,
        tenantId: input.tenantId,
        profileId: input.profileId,
      },
      payloadSummary: [
        'Deliver generated mediation response',
        `${input.generationResult.text.length} chars`,
        `${citations.length} citations`,
      ].join('; '),
      payloadRef: {
        type: 'content.generation_logs',
        id: input.generationResult.metadata.generationLogId,
      },
      payloadShape: {
        responseLength: input.generationResult.text.length,
        citationCount: citations.length,
        sourcesUsed: input.generationResult.metadata.sourcesUsed,
        totalSearchResults: input.generationResult.metadata.totalSearchResults,
        profileUsed: input.generationResult.profileUsed,
        citedItemIds: citations.map((citation) => citation.itemId),
      },
    },
    context: {
      tenantId: input.tenantId,
      userId: input.userId,
      sessionId: input.sessionId,
      profileId: input.profileId,
      integrationId: input.apiKeyId,
      requestId: input.requestId,
    },
    evidence: {
      sources: [
        {
          sourceType: 'session',
          sourceId: input.sessionId,
          tenantId: input.tenantId,
          relevance: 'Authenticated mediation session for the request',
          isAuthoritative: true,
        },
        {
          sourceType: 'entitlement',
          sourceId: input.entitlements.resolvedFrom,
          tenantId: input.tenantId,
          relevance: 'Resolved content and profile access for the session',
          isAuthoritative: true,
        },
        ...contentEvidence,
      ],
      authoritative: contentEvidence.length > 0 && unauthorizedSourceIds.length === 0,
      ...(contentEvidence.length === 0 && {
        missingEvidenceReason: 'Generated response did not cite any content items',
      }),
    },
    authorization: {
      basis: 'current_authenticated_request',
      tenantId: input.tenantId,
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      profileId: input.profileId,
      authorizedProfileIds: input.entitlements.profileIds,
      authorizedSourceIds: input.entitlements.sourceIds,
      explicitInstructionRef: `request:${input.requestId}`,
      inferredFromContext: false,
    },
    expectedConsequence: {
      summary: 'Generated content becomes visible to the authenticated requester and calling integration.',
      reversible: false,
      affectsOtherUsers: false,
      affectsExternalSystems: true,
      exposedDataClasses: ['generated_response', 'source_citations'],
      visibleTo: ['authenticated_user', 'calling_integration', 'tenant_operator_audit_log'],
    },
    rollbackPath: {
      method: 'manual',
      description: 'A follow-up correction can be issued, and the audit record identifies the generation log.',
    },
    riskFlags: uniqueRiskFlags(riskFlags),
  };
}

export function evaluateMediationActionProposal(proposal: ActionProposal): JudgeResult {
  const startedAt = Date.now();
  const contentEvidence = proposal.evidence.sources.filter(
    (source) => source.sourceType === 'content_item',
  );
  const authorizedSourceIds = new Set(proposal.authorization.authorizedSourceIds);
  const citedSourceIds = new Set(
    contentEvidence.map((source) => source.sourceId),
  );
  const hasUnauthorizedEvidence = Array.from(citedSourceIds).some(
    (sourceId) => !authorizedSourceIds.has(sourceId),
  );
  const profileAuthorized = (
    proposal.context.profileId === null ||
    proposal.context.profileId === undefined ||
    proposal.authorization.authorizedProfileIds.includes(proposal.context.profileId)
  );
  const authContextPresent = Boolean(
    proposal.context.tenantId &&
    proposal.context.userId &&
    proposal.context.sessionId &&
    proposal.context.integrationId &&
    proposal.authorization.tenantId &&
    proposal.authorization.userId &&
    proposal.authorization.apiKeyId,
  );
  const authContextMatches = (
    proposal.context.tenantId === proposal.authorization.tenantId &&
    proposal.context.userId === proposal.authorization.userId &&
    proposal.context.profileId === proposal.authorization.profileId
  );
  const hasAuthoritativeContentEvidence = (
    proposal.evidence.authoritative &&
    contentEvidence.length > 0 &&
    contentEvidence.every((source) => source.isAuthoritative && source.isStale !== true)
  );
  const scopedExposure = proposal.expectedConsequence.visibleTo.every((recipient) => (
    recipient === 'authenticated_user' ||
    recipient === 'calling_integration' ||
    recipient === 'tenant_operator_audit_log'
  ));
  const correctionPathAvailable = (
    proposal.rollbackPath.method !== 'none' ||
    proposal.expectedConsequence.affectsOtherUsers === false
  );
  const policyIsolationOk = (
    profileAuthorized &&
    !hasUnauthorizedEvidence &&
    !hasRiskFlag(proposal, 'source_not_authorized') &&
    !hasRiskFlag(proposal, 'profile_not_authorized') &&
    !hasRiskFlag(proposal, 'policy_conflict')
  );

  const criteria = [
    criterion(
      'AUTH-001',
      'authorization',
      'Does the proposal include authenticated tenant, user, session, and integration context?',
      authContextPresent && !hasRiskFlag(proposal, 'missing_authorization'),
      'critical',
      'authorization_context_present',
      authContextPresent ? 'Authenticated request context is present.' : 'Authenticated request context is incomplete.',
    ),
    criterion(
      'AUTH-002',
      'authorization',
      'Does proposal authorization match the request and session context?',
      authContextMatches && !hasRiskFlag(proposal, 'authorization_context_mismatch'),
      'critical',
      'authorization_context_matches',
      authContextMatches ? 'Proposal context matches authorization context.' : 'Proposal context does not match authorization context.',
    ),
    criterion(
      'AUTH-003',
      'authorization',
      'Is the requested profile authorized for the session?',
      profileAuthorized,
      'critical',
      'profile_authorized',
      profileAuthorized ? 'Profile is absent or included in entitlements.' : 'Profile is not included in entitlements.',
    ),
    criterion(
      'EVID-001',
      'evidence',
      'Does the proposal include authoritative cited content evidence?',
      hasAuthoritativeContentEvidence && !hasRiskFlag(proposal, 'missing_evidence'),
      'warning',
      'authoritative_evidence_present',
      hasAuthoritativeContentEvidence ? 'Authoritative cited content evidence is present.' : 'Authoritative cited content evidence is missing.',
    ),
    criterion(
      'EVID-002',
      'evidence',
      'Are all cited content sources authorized for this session?',
      !hasUnauthorizedEvidence && !hasRiskFlag(proposal, 'source_not_authorized'),
      'critical',
      'evidence_sources_authorized',
      hasUnauthorizedEvidence ? 'At least one cited source is outside entitlements.' : 'Cited sources are within entitlements.',
    ),
    criterion(
      'RISK-001',
      'exposure_risk',
      'Is exposure scoped to the authenticated requester, calling integration, and audit trail?',
      scopedExposure &&
        !hasRiskFlag(proposal, 'broad_external_exposure') &&
        !hasRiskFlag(proposal, 'sensitive_data_exposure'),
      'critical',
      'exposure_scoped',
      scopedExposure ? 'Exposure is scoped to the requester, integration, and audit trail.' : 'Exposure includes recipients outside the scoped boundary.',
    ),
    criterion(
      'RISK-002',
      'exposure_risk',
      'Is there a correction path when the action cannot be fully undone?',
      correctionPathAvailable && !hasRiskFlag(proposal, 'irreversible_external_effect'),
      'warning',
      'correction_path_available',
      correctionPathAvailable ? 'A manual or low-blast-radius correction path exists.' : 'No correction path exists for a broader-impact action.',
    ),
    criterion(
      'POLICY-001',
      'policy',
      'Does the proposal preserve tenant, profile, entitlement, and citation policy boundaries?',
      policyIsolationOk,
      'critical',
      'policy_boundaries_preserved',
      policyIsolationOk ? 'Policy boundaries are preserved.' : 'One or more policy boundaries failed.',
    ),
  ];

  const outcome = decideOutcome(proposal, {
    authContextPresent,
    authContextMatches,
    profileAuthorized,
    hasUnauthorizedEvidence,
    hasAuthoritativeContentEvidence,
    scopedExposure,
    correctionPathAvailable,
  });

  const resultBase = {
    id: createId(),
    proposalId: proposal.id,
    judgedAt: new Date().toISOString(),
    policyVersion: proposal.policyVersion,
    outcome,
    criteria,
    latencyMs: Date.now() - startedAt,
  };

  if (outcome === 'allow') {
    return {
      ...resultBase,
      reasonCode: 'criteria_satisfied',
      summary: 'Proposal satisfies authorization, evidence, risk, and policy criteria.',
    };
  }

  if (outcome === 'block') {
    return {
      ...resultBase,
      reasonCode: blockReasonCode(proposal, {
        authContextPresent,
        authContextMatches,
        profileAuthorized,
        hasUnauthorizedEvidence,
      }),
      summary: 'Proposal failed a critical authorization, payload, or policy criterion.',
    };
  }

  if (outcome === 'revise') {
    return {
      ...resultBase,
      reasonCode: reviseReasonCode(proposal, hasAuthoritativeContentEvidence),
      summary: 'Proposal is directionally valid but must be revised before delivery.',
      requiredRevision: {
        instruction: 'Revise the response proposal before delivery.',
        mustChange: requiredRevisionItems(proposal, hasAuthoritativeContentEvidence),
      },
    };
  }

  return {
    ...resultBase,
    reasonCode: escalateReasonCode(proposal, scopedExposure, correctionPathAvailable),
    summary: 'Proposal needs human review before this action can proceed.',
    escalation: {
      reason: 'The judge could not safely decide the action automatically.',
      reviewerHint: 'Review authorization, exposed data, policy conflict, and action reversibility.',
    },
  };
}

export class DeterministicMediationJudgeService implements MediationJudgeService {
  async judge(proposal: ActionProposal): Promise<JudgeResult> {
    return evaluateMediationActionProposal(proposal);
  }
}

export async function runJudgeEvaluationSuite(
  judge: MediationJudgeService,
  cases: JudgeEvaluationCase[],
): Promise<JudgeEvaluationMetrics> {
  const results = await Promise.all(cases.map((testCase) => judge.judge(testCase.proposal)));
  const outcomeCounts = countByOutcome(results);
  const mismatches = cases.flatMap((testCase, index) => {
    const actualOutcome = results[index].outcome;
    if (actualOutcome === testCase.expectedOutcome) return [];
    return [{
      caseId: testCase.id,
      expectedOutcome: testCase.expectedOutcome,
      actualOutcome,
    }];
  });

  const expectedAllowCount = cases.filter((testCase) => testCase.expectedOutcome === 'allow').length;
  const expectedNonAllowCount = cases.length - expectedAllowCount;
  const falseAllowCount = cases.filter((testCase, index) => (
    testCase.expectedOutcome !== 'allow' && results[index].outcome === 'allow'
  )).length;
  const falseBlockCount = cases.filter((testCase, index) => (
    testCase.expectedOutcome === 'allow' && results[index].outcome !== 'allow'
  )).length;
  const totalLatencyMs = results.reduce((sum, result) => sum + result.latencyMs, 0);

  return {
    totalCases: cases.length,
    outcomeCounts,
    falseAllowRate: rate(falseAllowCount, expectedNonAllowCount),
    falseBlockRate: rate(falseBlockCount, expectedAllowCount),
    escalationRate: rate(outcomeCounts.escalate, cases.length),
    revisionRate: rate(outcomeCounts.revise, cases.length),
    averageLatencyMs: rate(totalLatencyMs, cases.length),
    mismatches,
  };
}

function decideOutcome(
  proposal: ActionProposal,
  checks: {
    authContextPresent: boolean;
    authContextMatches: boolean;
    profileAuthorized: boolean;
    hasUnauthorizedEvidence: boolean;
    hasAuthoritativeContentEvidence: boolean;
    scopedExposure: boolean;
    correctionPathAvailable: boolean;
  },
): JudgeOutcome {
  if (
    !checks.authContextPresent ||
    !checks.authContextMatches ||
    !checks.profileAuthorized ||
    checks.hasUnauthorizedEvidence ||
    hasRiskFlag(proposal, 'empty_payload') ||
    hasRiskFlag(proposal, 'missing_authorization') ||
    hasRiskFlag(proposal, 'authorization_context_mismatch') ||
    hasRiskFlag(proposal, 'profile_not_authorized') ||
    hasRiskFlag(proposal, 'source_not_authorized')
  ) {
    return 'block';
  }

  if (
    !checks.scopedExposure ||
    !checks.correctionPathAvailable ||
    hasRiskFlag(proposal, 'broad_external_exposure') ||
    hasRiskFlag(proposal, 'high_stakes_action') ||
    hasRiskFlag(proposal, 'irreversible_external_effect') ||
    hasRiskFlag(proposal, 'policy_conflict') ||
    hasRiskFlag(proposal, 'sensitive_data_exposure')
  ) {
    return 'escalate';
  }

  if (
    !checks.hasAuthoritativeContentEvidence ||
    hasRiskFlag(proposal, 'ambiguous_target') ||
    hasRiskFlag(proposal, 'missing_evidence') ||
    hasRiskFlag(proposal, 'stale_evidence')
  ) {
    return 'revise';
  }

  return 'allow';
}

function blockReasonCode(
  proposal: ActionProposal,
  checks: {
    authContextPresent: boolean;
    authContextMatches: boolean;
    profileAuthorized: boolean;
    hasUnauthorizedEvidence: boolean;
  },
): string {
  if (!checks.authContextPresent || hasRiskFlag(proposal, 'missing_authorization')) {
    return 'missing_authorization_context';
  }
  if (!checks.authContextMatches || hasRiskFlag(proposal, 'authorization_context_mismatch')) {
    return 'authorization_context_mismatch';
  }
  if (!checks.profileAuthorized || hasRiskFlag(proposal, 'profile_not_authorized')) {
    return 'profile_not_authorized';
  }
  if (checks.hasUnauthorizedEvidence || hasRiskFlag(proposal, 'source_not_authorized')) {
    return 'source_not_authorized';
  }
  if (hasRiskFlag(proposal, 'empty_payload')) return 'empty_payload';
  return 'policy_boundary_failed';
}

function reviseReasonCode(
  proposal: ActionProposal,
  hasAuthoritativeContentEvidence: boolean,
): string {
  if (!hasAuthoritativeContentEvidence || hasRiskFlag(proposal, 'missing_evidence')) {
    return 'missing_authoritative_evidence';
  }
  if (hasRiskFlag(proposal, 'stale_evidence')) return 'stale_evidence';
  if (hasRiskFlag(proposal, 'ambiguous_target')) return 'ambiguous_target';
  return 'revision_required';
}

function requiredRevisionItems(
  proposal: ActionProposal,
  hasAuthoritativeContentEvidence: boolean,
): string[] {
  const items: string[] = [];
  if (!hasAuthoritativeContentEvidence || hasRiskFlag(proposal, 'missing_evidence')) {
    items.push('Attach authoritative cited content evidence or change the response to state that no supported answer is available.');
  }
  if (hasRiskFlag(proposal, 'stale_evidence')) {
    items.push('Refresh stale source evidence before delivery.');
  }
  if (hasRiskFlag(proposal, 'ambiguous_target')) {
    items.push('Clarify the target session, profile, or response recipient before delivery.');
  }
  return items.length > 0 ? items : ['Submit a narrower proposal with concrete evidence and recipient scope.'];
}

function escalateReasonCode(
  proposal: ActionProposal,
  scopedExposure: boolean,
  correctionPathAvailable: boolean,
): string {
  if (hasRiskFlag(proposal, 'policy_conflict')) return 'policy_conflict';
  if (hasRiskFlag(proposal, 'sensitive_data_exposure')) return 'sensitive_data_exposure';
  if (!scopedExposure || hasRiskFlag(proposal, 'broad_external_exposure')) {
    return 'broad_external_exposure';
  }
  if (!correctionPathAvailable || hasRiskFlag(proposal, 'irreversible_external_effect')) {
    return 'irreversible_external_effect';
  }
  if (hasRiskFlag(proposal, 'high_stakes_action')) return 'high_stakes_action';
  return 'human_review_required';
}
