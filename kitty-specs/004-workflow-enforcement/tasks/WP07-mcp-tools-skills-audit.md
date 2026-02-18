---
work_package_id: WP07
title: MCP Tools -- Skills, Upstream, Audit & Corrections
lane: "doing"
dependencies:
- WP02
- WP04
base_branch: 004-workflow-enforcement-WP07-merge-base
base_commit: 96863181c325da0d7eae21523eddfd754ef90049
created_at: '2026-02-18T18:20:12.302745+00:00'
subtasks:
- T038
- T039
- T040
- T041
phase: Phase 3 - MCP Tools & Events
assignee: ''
agent: ''
shell_pid: "63854"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T15:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP07 -- MCP Tools -- Skills, Upstream, Audit & Corrections

## IMPORTANT: Review Feedback Status

- **Has review feedback?**: Check `review_status` above.
- **Mark as acknowledged**: Update `review_status: acknowledged` when addressing feedback.

---

## Review Feedback

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Expose skill querying, upstream dependency checking, audit querying, and correction recording as MCP tools
- Each tool validates input, calls the underlying engine, and returns correctly shaped responses
- **Done when**: All 4 MCP tools register, return correct data, and create audit entries where required

## Context & Constraints

- **Contracts**: `kitty-specs/004-workflow-enforcement/contracts/mcp-tools.md` (authoritative schemas)
- **Engines**: Skill engine (WP04), audit infrastructure (WP02)
- **MCP SDK**: Same registration pattern as WP06

**Implementation command**: `spec-kitty implement WP07 --base WP04`

## Subtasks & Detailed Guidance

### Subtask T038 -- Implement `get_skills` MCP tool

- **Purpose**: MCP tool that returns active skills, conflict resolutions, and the combined skill context string for Claude's context injection.
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/get-skills.ts`
  2. Register with MCP server
  3. Input: `{ filePath?: string }` (optional: check skills for a specific file)
  4. Logic:
     - If `filePath` provided: call `matchSkillsForFile()` to find relevant mappings
     - Otherwise: return all currently loaded skills from session state
     - For each matched skill ID: call `loadSkill()` (repo with cache fallback)
     - Resolve precedence via `resolveSkillPrecedence()`
     - Build context string via `buildSkillContext()`
     - Build summary via `buildSkillSummary()`
  5. Return: activeSkills array, conflictsResolved array, skillContext string
- **Files**: `joyus-ai-state/src/mcp/tools/get-skills.ts` (new, ~60 lines)
- **Parallel?**: Yes

### Subtask T039 -- Implement `check_upstream` MCP tool

- **Purpose**: MCP tool that searches project dependencies before Claude writes new code (FR-011, User Story 4).
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/check-upstream.ts`
  2. Register with MCP server
  3. Input: `{ description: string, language?: string }`
  4. Logic:
     - Detect project type by scanning for dependency manifests:
       - `package.json` (Node.js) -- search `dependencies` and `devDependencies`
       - `composer.json` (PHP/Drupal) -- search `require` and `require-dev`
       - `requirements.txt` / `Pipfile` (Python)
       - `Gemfile` (Ruby)
     - For each found manifest: search package names and known exports against the description
     - Match algorithm: case-insensitive substring match on package names, README keywords if available
     - No network calls -- local search only
  5. Return: existingSolutions array, searchedIn array, recommendation
  6. Recommendation logic:
     - High-confidence match found: `'use-existing'`
     - Possible match: `'investigate-further'`
     - No matches: `'implement-new'`
- **Files**: `joyus-ai-state/src/mcp/tools/check-upstream.ts` (new, ~80 lines)
- **Parallel?**: Yes
- **Notes**: Start with `package.json` and `composer.json` parsing. Add others incrementally. This is a best-effort heuristic, not an exhaustive search.

### Subtask T040 -- Implement `query_audit` MCP tool

- **Purpose**: MCP tool for querying the audit trail with filters (FR-024).
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/query-audit.ts`
  2. Register with MCP server
  3. Input: `{ timeRange?, actionType?, skillId?, taskId?, result?, limit?, offset? }`
  4. Logic:
     - Ensure SQLite index is up to date: call `syncFromJSONL()` if needed
     - Call `AuditIndex.query()` with provided filters
     - Format entries for response (deserialize JSON fields)
  5. Return: entries array, total count, hasMore flag
- **Files**: `joyus-ai-state/src/mcp/tools/query-audit.ts` (new, ~40 lines)
- **Parallel?**: Yes

### Subtask T041 -- Implement `record_correction` MCP tool

- **Purpose**: MCP tool that captures user corrections when Claude's output didn't meet skill constraints (FR-030/031).
- **Steps**:
  1. Create `joyus-ai-state/src/mcp/tools/record-correction.ts`
  2. Register with MCP server
  3. Input: `{ skillId, originalOutput, correctedOutput, explanation?, filePath? }`
  4. Logic:
     - Validate input with CorrectionSchema
     - Generate correction ID (UUID)
     - Call `CorrectionStore.record()` to persist
     - Create audit entry with `actionType: 'correction-captured'`
  5. Return: correctionId, auditEntryId, stored: true
- **Files**: `joyus-ai-state/src/mcp/tools/record-correction.ts` (new, ~40 lines)
- **Parallel?**: Yes

## Risks & Mitigations

- **`check_upstream` accuracy**: substring matching on package names has false positives. Rank by confidence and let Claude decide.
- **Large audit queries**: enforce max limit (1000 entries) to prevent memory issues. Pagination is required.
- **Correction data sensitivity**: corrections may contain code. Store locally only, never transmit.

## Review Guidance

- Verify `get_skills` returns correct precedence resolution and combined context
- Verify `check_upstream` handles missing manifest files gracefully
- Verify `query_audit` triggers sync before querying
- Verify `record_correction` validates all required fields
- Verify output schemas match `contracts/mcp-tools.md` exactly

## Activity Log

- 2026-02-17T15:00:00Z -- system -- lane=planned -- Prompt created.
