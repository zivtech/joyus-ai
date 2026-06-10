/**
 * Content Infrastructure — Shared Types & Constants
 *
 * TypeScript types and constants shared across content modules.
 */

// ============================================================
// STRING LITERAL UNION TYPES
// ============================================================

export type SourceType = 'relational-database' | 'rest-api';

export type SyncStrategy = 'mirror' | 'pass-through' | 'hybrid';

export type SourceStatus = 'active' | 'syncing' | 'error' | 'disconnected';

export type SyncRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type SyncTrigger = 'scheduled' | 'manual';

export type ContentOperationType =
  | 'sync'
  | 'search'
  | 'resolve'
  | 'generate'
  | 'mediate'
  | 'cache_miss';

// ============================================================
// CONNECTOR CONFIGURATION TYPES
// ============================================================

export interface ConnectorConfig {
  [key: string]: unknown;
}

export interface DatabaseConnectorConfig extends ConnectorConfig {
  host: string;
  port: number;
  database: string;
  table: string;
  columns: {
    id: string;
    title: string;
    body?: string;
    metadata?: string[];
  };
  ssl?: boolean;
  schema?: string;
}

export interface ApiConnectorConfig extends ConnectorConfig {
  baseUrl: string;
  authType: 'bearer' | 'api-key' | 'basic' | 'none';
  headers?: Record<string, string>;
  endpoints: {
    list: string;
    detail?: string;
  };
  pagination?: {
    type: 'cursor' | 'offset';
    paramName: string;
    limitParam?: string;
    defaultLimit?: number;
  };
}

// ============================================================
// SERVICE RESULT TYPES
// ============================================================

export interface SearchResult {
  itemId: string;
  sourceId: string;
  title: string;
  excerpt: string;
  score: number;
  metadata: Record<string, unknown>;
  isStale: boolean;
}

export interface ResolvedEntitlements {
  productIds: string[];
  sourceIds: string[];
  profileIds: string[];
  resolvedFrom: string;
  resolvedAt: Date;
  /** TTL hint from the resolver backend, in seconds. Used by cache and persistence. */
  ttlSeconds?: number;
}

export interface GenerationResult {
  text: string;
  citations: Citation[];
  profileUsed: string | null;
  metadata: {
    generationLogId: string;
    totalSearchResults: number;
    sourcesUsed: number;
    durationMs: number;
  };
}

export interface Citation {
  sourceId: string;
  itemId: string;
  title: string;
  excerpt: string;
  sourceType: string;
}

// ============================================================
// ACTION JUDGE TYPES
// ============================================================

export type ActionProposalType =
  | 'deliver_mediation_response'
  | 'close_mediation_session'
  | 'write_session_audit'
  | 'resolve_entitlements'
  | 'retrieve_content'
  | 'generate_content'
  | 'manage_mediation_api_key'
  | 'notify_reviewer';

export type ActionProposalTargetEntityType =
  | 'content'
  | 'external_response'
  | 'integration'
  | 'operation_log'
  | 'profile'
  | 'session'
  | 'user';

export type ActionEvidenceSourceType =
  | 'content_item'
  | 'entitlement'
  | 'operation_log'
  | 'policy'
  | 'request'
  | 'session';

export type ActionAuthorizationBasis =
  | 'current_authenticated_request'
  | 'explicit_user_instruction'
  | 'operator_policy'
  | 'inferred_from_context';

export type ActionRollbackMethod = 'automatic' | 'manual' | 'none';

export type ActionRiskFlag =
  | 'ambiguous_target'
  | 'authorization_context_mismatch'
  | 'broad_external_exposure'
  | 'empty_payload'
  | 'high_stakes_action'
  | 'irreversible_external_effect'
  | 'missing_authorization'
  | 'missing_evidence'
  | 'policy_conflict'
  | 'profile_not_authorized'
  | 'sensitive_data_exposure'
  | 'source_not_authorized'
  | 'stale_evidence';

export interface ActionEvidenceSource {
  sourceType: ActionEvidenceSourceType;
  sourceId: string;
  relevance: string;
  tenantId?: string;
  isAuthoritative: boolean;
  isStale?: boolean;
}

export interface ActionProposal {
  id: string;
  proposedAt: string;
  policyVersion: string;
  action: {
    type: ActionProposalType;
    target: {
      entityType: ActionProposalTargetEntityType;
      entityId: string;
      tenantId?: string;
      profileId?: string | null;
    };
    payloadSummary: string;
    payloadRef?: {
      type: string;
      id: string;
    };
    payloadShape: Record<string, unknown>;
  };
  context: {
    tenantId: string;
    userId: string;
    sessionId?: string;
    profileId?: string | null;
    integrationId?: string;
    requestId?: string;
  };
  evidence: {
    sources: ActionEvidenceSource[];
    authoritative: boolean;
    missingEvidenceReason?: string;
  };
  authorization: {
    basis: ActionAuthorizationBasis;
    tenantId: string;
    userId: string;
    apiKeyId?: string;
    profileId?: string | null;
    authorizedProfileIds: string[];
    authorizedSourceIds: string[];
    explicitInstructionRef?: string;
    inferredFromContext: boolean;
  };
  expectedConsequence: {
    summary: string;
    reversible: boolean;
    affectsOtherUsers: boolean;
    affectsExternalSystems: boolean;
    exposedDataClasses: string[];
    visibleTo: string[];
  };
  rollbackPath: {
    method: ActionRollbackMethod;
    description: string;
  };
  riskFlags: ActionRiskFlag[];
}

export type JudgeOutcome = 'allow' | 'block' | 'revise' | 'escalate';

export type JudgeCriterionCategory = 'authorization' | 'evidence' | 'exposure_risk' | 'policy';

export type JudgeCriterionSeverity = 'info' | 'warning' | 'critical';

export interface JudgeCriterionResult {
  criterionId: string;
  category: JudgeCriterionCategory;
  question: string;
  passed: boolean;
  severity: JudgeCriterionSeverity;
  reasonCode: string;
  details: string;
}

export interface JudgeRequiredRevision {
  instruction: string;
  mustChange: string[];
}

export interface JudgeEscalation {
  reason: string;
  reviewerHint: string;
}

export interface JudgeResult {
  id: string;
  proposalId: string;
  judgedAt: string;
  policyVersion: string;
  outcome: JudgeOutcome;
  reasonCode: string;
  summary: string;
  criteria: JudgeCriterionResult[];
  requiredRevision?: JudgeRequiredRevision;
  escalation?: JudgeEscalation;
  latencyMs: number;
}

// ============================================================
// CONSTANTS
// ============================================================

export const DEFAULT_BATCH_SIZE = 100;
export const MAX_SEARCH_LIMIT = 100;
export const DEFAULT_FRESHNESS_WINDOW_MINUTES = 1440; // 24 hours

// ============================================================
// DB CLIENT TYPE
// ============================================================

export type { DrizzleClient } from '../db/types.js';
