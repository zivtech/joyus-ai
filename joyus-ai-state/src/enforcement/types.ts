/**
 * Enforcement TypeScript types — T001
 *
 * All entity types for the workflow enforcement system.
 * Source of truth: kitty-specs/004-workflow-enforcement/data-model.md
 */

// --- Union types ---

export type GateType = 'lint' | 'test' | 'a11y' | 'visual-regression' | 'custom';

export type TriggerPoint = 'pre-commit' | 'pre-push';

export type EnforcementTier = 'always-run' | 'ask-me' | 'skip';

export type UserTier = 'tier-1' | 'tier-2' | 'tier-3';

export type PrecedenceLevel = 'client-override' | 'client-brand' | 'core' | 'platform-default';

export type SkillSource = 'auto-loaded' | 'manually-loaded' | 'project-config';

export type AuditResult = 'pass' | 'fail' | 'skip' | 'timeout' | 'unavailable' | 'bypassed';

export type AuditActionType =
  | 'gate-execution'
  | 'gate-bypass'
  | 'skill-load'
  | 'skill-bypass'
  | 'branch-verify'
  | 'branch-mismatch'
  | 'branch-hygiene'
  | 'naming-violation'
  | 'force-push-warning'
  | 'uncommitted-warning'
  | 'kill-switch-on'
  | 'kill-switch-off'
  | 'correction-captured'
  | 'upstream-check'
  | 'config-reload';

// --- Entity interfaces ---

export interface QualityGate {
  id: string;
  name: string;
  type: GateType;
  command: string;
  triggerPoints: TriggerPoint[];
  defaultTier: EnforcementTier;
  timeout: number;
  order: number;
  workingDir?: string;
  env?: Record<string, string>;
}

export interface SkillMapping {
  id: string;
  filePatterns: string[];
  skills: string[];
  precedence: PrecedenceLevel;
}

export interface Skill {
  id: string;
  name: string;
  source: SkillSource;
  precedence: PrecedenceLevel;
  constraints: string;
  antiPatterns: string[];
  validationCommand?: string;
  loadedAt: string;
  cachedFrom?: string;
}

export interface BranchRule {
  namingConvention?: string;
  staleDays: number;
  maxActiveBranches: number;
  protectedBranches: string[];
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  actionType: AuditActionType;
  result: AuditResult;
  userTier: UserTier;
  activeSkills: string[];
  taskId?: string;
  gateId?: string;
  skillId?: string;
  details: Record<string, unknown>;
  overrideReason?: string;
  branchName?: string;
}

export interface Correction {
  id: string;
  timestamp: string;
  sessionId: string;
  skillId: string;
  originalOutput: string;
  correctedOutput: string;
  explanation?: string;
  filePath?: string;
}

export interface EnforcementPolicy {
  mandatoryGates: string[];
  mandatorySkills: string[];
  tierOverridable: boolean;
}

export interface EnforcementConfig {
  gates: QualityGate[];
  skillMappings: SkillMapping[];
  branchRules: BranchRule;
  enforcementPolicy: EnforcementPolicy;
}

export interface DeveloperConfig {
  tier: UserTier;
  gateOverrides: Record<string, EnforcementTier>;
  skillOverrides: Record<string, 'enabled' | 'disabled'>;
}

export interface MergedEnforcementConfig extends EnforcementConfig {
  resolvedTier: UserTier;
  overridesApplied: OverrideLogEntry[];
}

export interface OverrideLogEntry {
  field: string;
  requested: string;
  applied: boolean;
  reason: string;
}

export interface ValidatedResult<T> {
  valid: boolean;
  config: T;
  warnings: string[];
}
