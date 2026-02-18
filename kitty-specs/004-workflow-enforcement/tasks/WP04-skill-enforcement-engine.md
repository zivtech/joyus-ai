---
work_package_id: WP04
title: Skill Enforcement Engine
lane: "doing"
dependencies:
- WP01
- WP02
base_branch: 004-workflow-enforcement-WP04-merge-base
base_commit: fb3062c7457a64310965cf349ecffa31a260b03d
created_at: '2026-02-18T17:19:17.070456+00:00'
subtasks:
- T019
- T020
- T021
- T022
- T023
- T024
- T025
phase: Phase 2 - Enforcement Engines
assignee: ''
agent: ''
shell_pid: "93782"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T15:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP04 -- Skill Enforcement Engine

## IMPORTANT: Review Feedback Status

- **Has review feedback?**: Check `review_status` above.
- **Mark as acknowledged**: Update `review_status: acknowledged` when addressing feedback.

---

## Review Feedback

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Build file-pattern-to-skill mapper that auto-loads skills on file edits
- Implement local skill cache with git-based freshness checking and fallback
- Implement deterministic precedence resolution (client > brand > core > default)
- Build context builder that aggregates plain-language constraints for Claude injection
- Build validation tool framework for post-generation anti-pattern checking
- Integrate all skill operations with audit trail
- **Done when**: File patterns trigger correct skill loads, cache falls back when repo unreachable, precedence is deterministic and logged, context string is generated, validation catches anti-patterns

## Context & Constraints

- **Spec**: FR-008 through FR-013a (skill enforcement), User Story 2
- **Data Model**: SkillMapping, Skill (runtime), PrecedenceLevel
- **Research**: layered skill representation (context injection + validation tools)
- **Clarifications**: Skill repo fallback uses cached version with warning
- **Existing skills**: `zivtech-claude-skills/` repository (markdown files with rules)
- **Plan**: `joyus-ai-state/src/enforcement/skills/` directory

**Implementation command**: `spec-kitty implement WP04 --base WP02`

## Subtasks & Detailed Guidance

### Subtask T019 -- Implement file-pattern-to-skill mapper

- **Purpose**: Given a file path, determine which skills should be loaded based on configured skill mappings (FR-008).
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/skills/loader.ts`
  2. Implement `matchSkillsForFile(filePath: string, mappings: SkillMapping[]): MatchResult`:
     - For each mapping, test `filePath` against each glob in `mapping.filePatterns`
     - Use `picomatch` or `micromatch` for glob matching
     - Collect all matching mappings (a file can match multiple patterns -- edge case in spec)
     - Return `{ matchedMappings: SkillMapping[], skillIds: string[] }` (deduplicated skill IDs)
  3. Implement `matchSkillsForFiles(filePaths: string[], mappings: SkillMapping[]): MatchResult`:
     - Union of all matches across all files
     - Used when multiple files are being edited in a session
  4. Install `picomatch` as a dependency
- **Files**: `joyus-ai-state/src/enforcement/skills/loader.ts` (new, ~50 lines)
- **Parallel?**: Yes -- independent of cache and validator
- **Notes**: Edge case from spec: "a file matches both `*.module` and `*.php`" -- both skills load, conflicts resolved by precedence (T022).

### Subtask T020 -- Implement skill cache

- **Purpose**: Cache skills locally so they're available offline and when the git repo is unreachable (FR-013a).
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/skills/cache.ts`
  2. Implement `SkillCache` class:
     - Constructor takes `cachePath: string` (e.g., `~/.joyus-ai/projects/<hash>/skill-cache/`)
     - `cacheSkill(skillId: string, content: SkillContent): void` -- write skill to cache dir
     - `getCachedSkill(skillId: string): SkillContent | null` -- read from cache
     - `getCacheAge(skillId: string): number` -- milliseconds since last cache update
     - `isFresh(skillId: string, maxAgeMs: number): boolean` -- check freshness
  3. Define `SkillContent` interface:
     ```typescript
     interface SkillContent {
       id: string;
       name: string;
       constraints: string;        // plain-language rules
       antiPatterns: string[];      // patterns to check against
       validationCommand?: string;  // optional shell command
       cachedAt: string;            // ISO8601
       sourceCommit?: string;       // git commit hash of skill repo when cached
     }
     ```
  4. Cache files stored as JSON: `skill-cache/<skillId>.json`
- **Files**: `joyus-ai-state/src/enforcement/skills/cache.ts` (new, ~70 lines)
- **Parallel?**: Yes -- independent of loader and validator

### Subtask T021 -- Implement skill repo fallback

- **Purpose**: When the skill repository is unreachable (git fetch fails, repo corrupted), fall back to cached skills and warn the user (clarification decision).
- **Steps**:
  1. Add to `loader.ts` or create helper:
  2. Implement `loadSkillFromRepo(skillId: string, repoPath: string): SkillContent | null`:
     - Attempt to read skill file from `repoPath/skills/<skillId>.md` (or similar structure)
     - Parse markdown skill file: extract frontmatter (name, precedence), body (constraints), anti-patterns section
     - If successful: update cache, return content
     - If failed (file not found, parse error): return null
  3. Implement `loadSkill(skillId: string, repoPath: string, cache: SkillCache): LoadResult`:
     - Try `loadSkillFromRepo` first
     - If fails: try `cache.getCachedSkill(skillId)`
     - If cached version found: return it with `{ source: 'cache', stale: true, warning: 'Skill repo unreachable, using cached version' }`
     - If no cache: return `{ source: 'none', error: 'Skill not available' }`
  4. Log the load source in the result for audit trail
- **Files**: `joyus-ai-state/src/enforcement/skills/loader.ts` (extend, ~60 lines added)
- **Notes**: The exact skill file format depends on the `zivtech-claude-skills` repo structure. Start with a simple markdown parser; refine when real skills are tested.

### Subtask T022 -- Implement skill precedence resolver

- **Purpose**: When multiple skills are loaded and have conflicting rules, resolve conflicts deterministically (FR-009, SC-010).
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/skills/precedence.ts`
  2. Define precedence order (highest to lowest):
     - `client-override` (4)
     - `client-brand` (3)
     - `core` (2)
     - `platform-default` (1)
  3. Implement `resolveSkillPrecedence(skills: Skill[]): PrecedenceResult`:
     - Group skills by conflicting rules (if two skills define the same constraint domain)
     - For each conflict: winner is the skill with higher precedence
     - Return `{ resolvedSkills: Skill[], conflicts: ConflictResolution[] }`
     - `ConflictResolution`: `{ winner: string, loser: string, reason: string }`
  4. Resolution MUST be deterministic: same input always produces same output
  5. Log all conflict resolutions
- **Files**: `joyus-ai-state/src/enforcement/skills/precedence.ts` (new, ~50 lines)
- **Notes**: For MVP, "conflict" is defined as two skills with the same constraint domain (e.g., both define database access rules). Simple precedence sort is sufficient; semantic conflict detection can be added later.

### Subtask T023 -- Implement skill context builder

- **Purpose**: Aggregate plain-language constraints from all active skills into a single string for injection into Claude's context.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/skills/context-builder.ts`
  2. Implement `buildSkillContext(skills: Skill[]): string`:
     - Sort skills by precedence (highest first)
     - For each skill, format as:
       ```
       ## [Skill Name] (precedence: [level])
       [constraints text]
       ```
     - Concatenate all formatted sections
     - Return the combined context string
  3. Implement `buildSkillSummary(skills: Skill[]): SkillSummary[]`:
     - Return array of `{ id, name, source, precedence, cachedFrom? }` for each active skill
     - Used by `get_skills` MCP tool
- **Files**: `joyus-ai-state/src/enforcement/skills/context-builder.ts` (new, ~40 lines)

### Subtask T024 -- Implement skill validation tool framework

- **Purpose**: Post-generation validation -- check Claude's output against skill anti-patterns before commit/push.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/skills/validator.ts`
  2. Implement `validateAgainstSkills(content: string, skills: Skill[]): ValidationResult`:
     - For each skill with `antiPatterns`:
       - Check `content` against each anti-pattern (string matching or regex)
       - Collect violations: `{ skillId, pattern, matchedText, lineNumber? }`
     - Return `{ valid: boolean, violations: Violation[] }`
  3. Implement `validateFile(filePath: string, skills: Skill[]): ValidationResult`:
     - Read file content, call `validateAgainstSkills`
  4. Anti-pattern format in skills: simple strings or regex patterns (prefixed with `/`)
- **Files**: `joyus-ai-state/src/enforcement/skills/validator.ts` (new, ~60 lines)
- **Parallel?**: Yes -- independent of loader and cache
- **Notes**: This is a best-effort check. Anti-pattern matching won't catch semantic violations (e.g., "should use database abstraction"). That's what the plain-language context injection handles.

### Subtask T025 -- Integrate skill loading with audit trail

- **Purpose**: Every skill load, bypass, and conflict resolution must be audited (FR-020, FR-022).
- **Steps**:
  1. Add audit writing to skill loader:
  2. On skill load: create audit entry with `actionType: 'skill-load'`, `skillId`, `details: { source, precedence, cachedFrom? }`
  3. On skill bypass (power user override): create entry with `actionType: 'skill-bypass'`, `skillId`, `overrideReason`
  4. On conflict resolution: include resolution details in the load entry's `details`
  5. Pass `AuditWriter` as dependency to the skill loader
- **Files**: `joyus-ai-state/src/enforcement/skills/loader.ts` (extend, ~20 lines added)

## Risks & Mitigations

- **Skill file format unknown**: start with a simple format (markdown with YAML frontmatter for metadata, body for constraints, `## Anti-Patterns` section for violations). Validate against real `zivtech-claude-skills` files.
- **Glob matching performance**: `picomatch` is fast (compiled regex). Cache compiled matchers for repeated use.
- **Precedence edge cases**: when two skills have equal precedence, use lexical sort on skill ID for determinism.

## Review Guidance

- Verify file patterns correctly match expected file types (test with `*.module`, `*.php`, `*.install`)
- Verify cache fallback works when repo path doesn't exist
- Verify precedence resolution is deterministic (test with same skills in different order)
- Verify context builder output is well-formatted and includes all active skills
- Verify anti-pattern validation catches known bad patterns
- Verify all skill operations create audit entries

## Activity Log

- 2026-02-17T15:00:00Z -- system -- lane=planned -- Prompt created.
