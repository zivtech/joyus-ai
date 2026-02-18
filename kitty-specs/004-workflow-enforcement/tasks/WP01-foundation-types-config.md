---
work_package_id: WP01
title: Foundation -- Types, Schemas, Config & Kill Switch
lane: "doing"
dependencies: []
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
phase: Phase 1 - Foundation
assignee: ''
agent: "claude-opus"
shell_pid: "13603"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T15:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 -- Foundation -- Types, Schemas, Config & Kill Switch

## IMPORTANT: Review Feedback Status

**Read this first if you are implementing this task!**

- **Has review feedback?**: Check the `review_status` field above. If it says `has_feedback`, scroll to the **Review Feedback** section immediately.
- **You must address all feedback** before your work is complete.
- **Mark as acknowledged**: When you understand the feedback and begin addressing it, update `review_status: acknowledged` in the frontmatter.

---

## Review Feedback

> **Populated by `/spec-kitty.review`**

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Define all enforcement TypeScript types matching the data model
- Create Zod schemas that validate enforcement configuration and audit entries
- Implement config loading that merges project-level and developer-level settings with policy constraints
- Implement session-scoped kill switch that all enforcement engines check before executing
- **Done when**: All types compile, schemas validate sample configs, config loader merges project+developer settings correctly, kill switch toggles enforcement state in memory

## Context & Constraints

- **Data Model**: `kitty-specs/004-workflow-enforcement/data-model.md` (authoritative for all entity definitions)
- **Plan**: `kitty-specs/004-workflow-enforcement/plan.md` -- project structure under `joyus-ai-state/src/enforcement/`
- **Spec**: `kitty-specs/004-workflow-enforcement/spec.md` -- FR-026 through FR-029 (configuration), FR-029a (kill switch)
- **Research**: `kitty-specs/004-workflow-enforcement/research.md` -- config strategy (extend 002), kill switch design
- **002 Reference**: `kitty-specs/002-session-context-management/plan.md` -- existing config system at `~/.joyus-ai/` and `.joyus-ai/`
- **Dependencies**: `zod` (schema validation), TypeScript 5.3+

**Implementation command**: `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 -- Define enforcement TypeScript types

- **Purpose**: Create the type foundation that all enforcement modules import. Every entity in the data model needs a corresponding TypeScript type.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/types.ts`
  2. Define the following types (see `data-model.md` for exact fields):
     - `GateType`: union type `'lint' | 'test' | 'a11y' | 'visual-regression' | 'custom'`
     - `TriggerPoint`: union type `'pre-commit' | 'pre-push'`
     - `EnforcementTier`: union type `'always-run' | 'ask-me' | 'skip'`
     - `UserTier`: union type `'tier-1' | 'tier-2' | 'tier-3'`
     - `PrecedenceLevel`: union type `'client-override' | 'client-brand' | 'core' | 'platform-default'`
     - `SkillSource`: union type `'auto-loaded' | 'manually-loaded' | 'project-config'`
     - `AuditResult`: union type `'pass' | 'fail' | 'skip' | 'timeout' | 'unavailable' | 'bypassed'`
     - `AuditActionType`: union of all 16 action type strings from data model
     - `QualityGate`: interface with all fields from data model
     - `SkillMapping`: interface
     - `Skill`: runtime representation interface
     - `BranchRule`: interface
     - `AuditEntry`: interface with all fields
     - `Correction`: interface
     - `EnforcementPolicy`: interface
     - `EnforcementConfig`: project-level config interface (contains gates[], skillMappings[], branchRules, enforcementPolicy)
     - `DeveloperConfig`: per-developer config interface (contains tier, gateOverrides, skillOverrides)
  3. Export all types
- **Files**: `joyus-ai-state/src/enforcement/types.ts` (new, ~150 lines)
- **Notes**: Use `interface` for object types and `type` for unions. Keep all types in one file for easy importing.

### Subtask T002 -- Create Zod validation schemas

- **Purpose**: Runtime validation of config files loaded from disk. Zod schemas ensure invalid config is caught at load time, not at runtime deep in enforcement logic.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/schemas.ts`
  2. Define Zod schemas mirroring every TypeScript type from T001:
     - `QualityGateSchema`: validate gate config with defaults (timeout: 60, defaultTier: 'always-run')
     - `SkillMappingSchema`: validate file patterns are valid globs
     - `BranchRuleSchema`: validate with defaults (staleDays: 14, maxActiveBranches: 10, protectedBranches: ['main', 'master'])
     - `AuditEntrySchema`: validate all audit entry fields
     - `CorrectionSchema`: validate correction fields
     - `EnforcementPolicySchema`: with defaults (mandatoryGates: [], mandatorySkills: [], tierOverridable: false)
     - `EnforcementConfigSchema`: top-level project config schema
     - `DeveloperConfigSchema`: per-developer config schema
  3. Export schemas and inferred types (`z.infer<typeof Schema>`)
  4. Ensure schemas have sensible `.default()` values for optional fields
- **Files**: `joyus-ai-state/src/enforcement/schemas.ts` (new, ~120 lines)
- **Notes**: Use `z.preprocess` for any coercion needed (e.g., string timeout -> number). Schemas should be strict enough to catch typos but flexible enough that missing optional fields get defaults.

### Subtask T003 -- Implement enforcement config loader

- **Purpose**: Load enforcement configuration from both project-level and developer-level config files, validate with Zod, and provide a merged result.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/config.ts`
  2. Implement `loadProjectConfig(projectRoot: string): EnforcementConfig`:
     - Read `.joyus-ai/config.json` from project root
     - Extract `enforcement` section
     - Validate with `EnforcementConfigSchema`
     - Return parsed config (or defaults if section missing)
  3. Implement `loadDeveloperConfig(projectHash: string): DeveloperConfig`:
     - Read `~/.joyus-ai/projects/<projectHash>/config.json`
     - Extract `enforcement` section
     - Validate with `DeveloperConfigSchema`
     - Return parsed config (or defaults if section missing)
  4. Handle file-not-found gracefully: return default config, don't throw
  5. Log validation errors but fall back to safe defaults (FR-029)
- **Files**: `joyus-ai-state/src/enforcement/config.ts` (new, ~80 lines)
- **Notes**: Reuse 002's project hash function if available. If 002's config loader exists, extend it rather than reimplementing file I/O.

### Subtask T004 -- Implement config inheritance/merging with policy constraints

- **Purpose**: Merge project defaults with developer overrides, respecting enforcement policy (some settings are mandatory and cannot be overridden).
- **Steps**:
  1. Add to `config.ts`:
  2. Implement `mergeConfig(project: EnforcementConfig, developer: DeveloperConfig): MergedEnforcementConfig`:
     - Start with project config as base
     - Apply developer tier override (unless `enforcementPolicy.tierOverridable === false`)
     - Apply developer gate overrides: for each gate, check if it's in `mandatoryGates` -- if so, ignore the override
     - Apply developer skill overrides: for each skill, check if it's in `mandatorySkills` -- if so, ignore the override
     - Return merged config with a `overridesApplied` array logging which overrides were applied vs rejected
  3. Define `MergedEnforcementConfig` type (extends EnforcementConfig with resolved tier and override log)
- **Files**: `joyus-ai-state/src/enforcement/config.ts` (extend, ~60 lines added)
- **Notes**: Policy enforcement is critical -- a project admin must be able to mark gates as mandatory. Log rejected overrides so developers understand why their preferences were ignored.

### Subtask T005 -- Implement config validation with safe defaults fallback

- **Purpose**: Ensure the system never crashes due to bad config. Invalid config should log a warning and fall back to safe defaults (FR-029).
- **Steps**:
  1. Add to `config.ts`:
  2. Implement `validateAndFallback(rawConfig: unknown, schema: ZodSchema, label: string): ValidatedResult`:
     - Try `schema.parse(rawConfig)`
     - On success: return `{ valid: true, config, warnings: [] }`
     - On ZodError: return `{ valid: false, config: schema.parse({}), warnings: [formatted error messages] }`
     - Log each warning with the `label` for context (e.g., "Project config validation failed: gates[0].timeout must be a number")
  3. Wire `validateAndFallback` into `loadProjectConfig` and `loadDeveloperConfig`
  4. Define safe defaults:
     - No gates configured (nothing blocked by default)
     - No skill mappings (no skills auto-loaded)
     - Default branch rules (staleDays: 14, maxActiveBranches: 10)
     - Tier: `tier-2` (power user -- least disruptive default)
- **Files**: `joyus-ai-state/src/enforcement/config.ts` (extend, ~40 lines added)
- **Notes**: The principle is "never block a developer due to config errors." Invalid config should degrade to permissive defaults, not strict lockdown.

### Subtask T006 -- Implement session-scoped kill switch

- **Purpose**: Provide a global toggle that disables all enforcement for the current session. Essential for emergency hotfixes and debugging (FR-029a).
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/kill-switch.ts`
  2. Implement a simple state module:
     ```typescript
     let enforcementDisabled = false;
     let disabledAt: string | null = null;
     let disableReason: string | null = null;

     export function disableEnforcement(reason?: string): void
     export function enableEnforcement(): void
     export function isEnforcementActive(): boolean
     export function getKillSwitchState(): { active: boolean; disabledAt: string | null; reason: string | null }
     ```
  3. `isEnforcementActive()` is the function all engines call before executing
  4. State is in-memory only -- new session (new process) starts with enforcement active
  5. Kill switch does NOT disable audit logging -- the switch itself is always recorded
- **Files**: `joyus-ai-state/src/enforcement/kill-switch.ts` (new, ~40 lines)
- **Notes**: Keep this dead simple. No persistence, no config dependency. The kill switch MCP tool (WP06) will call these functions and handle audit logging.

## Risks & Mitigations

- **002 package may not exist**: Create `joyus-ai-state/src/enforcement/` directory. If 002's package.json doesn't exist yet, create minimal stubs for config path utilities.
- **Type drift from data model**: Data model document is the source of truth. If types diverge during implementation, update the code to match the document.
- **Config schema too strict**: Start permissive (most fields optional with defaults), tighten based on real usage.

## Review Guidance

- Verify all types from `data-model.md` have corresponding TypeScript interfaces
- Verify Zod schemas have sensible defaults for all optional fields
- Verify config merging respects enforcement policy (mandatory gates/skills cannot be overridden)
- Verify kill switch is in-memory only and doesn't persist
- Verify invalid config falls back gracefully without throwing

## Activity Log

- 2026-02-17T15:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-02-18T16:20:16Z – claude-opus – shell_pid=13603 – lane=doing – Started implementation via workflow command
