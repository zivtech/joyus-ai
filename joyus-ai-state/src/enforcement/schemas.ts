/**
 * Zod validation schemas — T002
 *
 * Runtime validation for enforcement configuration loaded from disk.
 * Mirrors types from types.ts with sensible defaults for optional fields.
 */

import { z } from 'zod';

// --- Union schemas ---

export const GateTypeSchema = z.enum(['lint', 'test', 'a11y', 'visual-regression', 'custom']);

export const TriggerPointSchema = z.enum(['pre-commit', 'pre-push']);

export const EnforcementTierSchema = z.enum(['always-run', 'ask-me', 'skip']);

export const UserTierSchema = z.enum(['tier-1', 'tier-2', 'tier-3']);

export const PrecedenceLevelSchema = z.enum([
  'client-override',
  'client-brand',
  'core',
  'platform-default',
]);

export const SkillSourceSchema = z.enum(['auto-loaded', 'manually-loaded', 'project-config']);

export const AuditResultSchema = z.enum([
  'pass',
  'fail',
  'skip',
  'timeout',
  'unavailable',
  'bypassed',
]);

export const AuditActionTypeSchema = z.enum([
  'gate-execution',
  'gate-bypass',
  'skill-load',
  'skill-bypass',
  'branch-verify',
  'branch-mismatch',
  'branch-hygiene',
  'naming-violation',
  'force-push-warning',
  'uncommitted-warning',
  'kill-switch-on',
  'kill-switch-off',
  'correction-captured',
  'upstream-check',
  'config-reload',
]);

// --- Entity schemas ---

export const QualityGateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: GateTypeSchema,
  command: z.string().min(1),
  triggerPoints: z.array(TriggerPointSchema).min(1),
  defaultTier: EnforcementTierSchema.default('always-run'),
  timeout: z.number().positive().default(60),
  order: z.number().int().default(0),
  workingDir: z.string().optional(),
  env: z.record(z.string()).optional(),
});

export const SkillMappingSchema = z.object({
  id: z.string().min(1),
  filePatterns: z.array(z.string().min(1)).min(1),
  skills: z.array(z.string().min(1)).min(1),
  precedence: PrecedenceLevelSchema.default('platform-default'),
});

export const BranchRuleSchema = z.object({
  namingConvention: z.string().optional(),
  staleDays: z.number().int().positive().default(14),
  maxActiveBranches: z.number().int().positive().default(10),
  protectedBranches: z.array(z.string()).default(['main', 'master']),
});

export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  sessionId: z.string().min(1),
  actionType: AuditActionTypeSchema,
  result: AuditResultSchema,
  userTier: UserTierSchema,
  activeSkills: z.array(z.string()),
  taskId: z.string().optional(),
  gateId: z.string().optional(),
  skillId: z.string().optional(),
  details: z.record(z.unknown()).default({}),
  overrideReason: z.string().optional(),
  branchName: z.string().optional(),
});

export const CorrectionSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  sessionId: z.string().min(1),
  skillId: z.string().min(1),
  originalOutput: z.string(),
  correctedOutput: z.string(),
  explanation: z.string().optional(),
  filePath: z.string().optional(),
});

export const EnforcementPolicySchema = z.object({
  mandatoryGates: z.array(z.string()).default([]),
  mandatorySkills: z.array(z.string()).default([]),
  tierOverridable: z.boolean().default(false),
});

export const EnforcementConfigSchema = z.object({
  gates: z.array(QualityGateSchema).default([]),
  skillMappings: z.array(SkillMappingSchema).default([]),
  branchRules: BranchRuleSchema.default({}),
  enforcementPolicy: EnforcementPolicySchema.default({}),
});

export const DeveloperConfigSchema = z.object({
  tier: UserTierSchema.default('tier-2'),
  gateOverrides: z.record(EnforcementTierSchema).default({}),
  skillOverrides: z.record(z.enum(['enabled', 'disabled'])).default({}),
});

// --- Inferred types (for consumers who prefer Zod-inferred types) ---

export type QualityGateInput = z.input<typeof QualityGateSchema>;
export type EnforcementConfigInput = z.input<typeof EnforcementConfigSchema>;
export type DeveloperConfigInput = z.input<typeof DeveloperConfigSchema>;
