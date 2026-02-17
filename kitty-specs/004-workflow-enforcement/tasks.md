# Work Packages: Workflow Enforcement

**Inputs**: Design documents from `kitty-specs/004-workflow-enforcement/`
**Prerequisites**: plan.md (tech architecture), spec.md (user stories & requirements), data-model.md (entities), contracts/mcp-tools.md (MCP tool schemas), research.md (decisions), quickstart.md (validation)

**Tests**: Included in WP09 (Integration Testing & Hardening).

**Organization**: 51 fine-grained subtasks (`T001`-`T051`) roll up into 9 work packages (`WP01`-`WP09`). Each work package is independently deliverable and testable.

**Prompt Files**: Each work package references a matching prompt file in `kitty-specs/004-workflow-enforcement/tasks/`.

---

## Work Package WP01: Foundation -- Types, Schemas, Config & Kill Switch (Priority: P0)

**Goal**: Define all enforcement TypeScript types, Zod validation schemas, config loading with inheritance, and the session-scoped kill switch. This is the foundation everything else depends on.
**Independent Test**: Package compiles, types are importable, config loading returns merged project+developer config with safe defaults, kill switch toggles enforcement state.
**Prompt**: `tasks/WP01-foundation-types-config.md`
**Estimated Size**: ~400 lines

### Included Subtasks
- [ ] T001 Define enforcement TypeScript types in `joyus-ai-state/src/enforcement/types.ts`
- [ ] T002 Create Zod validation schemas in `joyus-ai-state/src/enforcement/schemas.ts`
- [ ] T003 Implement enforcement config loader in `joyus-ai-state/src/enforcement/config.ts`
- [ ] T004 Implement config inheritance/merging with enforcement policy constraints
- [ ] T005 Implement config validation with safe defaults fallback (FR-029)
- [ ] T006 Implement session-scoped kill switch in `joyus-ai-state/src/enforcement/kill-switch.ts`

### Implementation Notes
- Types derived from `data-model.md`: QualityGate, SkillMapping, BranchRule, AuditEntry, Correction, EnforcementConfig, DeveloperConfig, all enums
- Config extends 002's existing JSON config system (`~/.joyus-ai/projects/<hash>/config.json` + `.joyus-ai/config.json`)
- Kill switch is in-memory (session-scoped), checked by all enforcement engines before executing

### Parallel Opportunities
- T001/T002 (types and schemas) can be written together
- T006 (kill switch) is independent after types exist

### Dependencies
- None (starting package). Assumes 002's `joyus-ai-state` package structure exists.

### Risks & Mitigations
- 002's package may not exist yet: WP01 should create the `enforcement/` directory within the planned structure, with stubs for 002 imports if needed.

---

## Work Package WP02: Audit Trail Infrastructure (Priority: P0)

**Goal**: Build the audit trail system -- JSONL append-only writer for crash-safe writes, SQLite index for structured queries, storage monitoring, and correction capture.
**Independent Test**: Write audit entries to JSONL, rebuild SQLite index, query by time/type/skill/ticket, verify storage monitor warns at threshold.
**Prompt**: `tasks/WP02-audit-infrastructure.md`
**Estimated Size**: ~500 lines

### Included Subtasks
- [ ] T007 Implement JSONL audit writer in `joyus-ai-state/src/enforcement/audit/writer.ts`
- [ ] T008 Implement audit entry Zod schemas in `joyus-ai-state/src/enforcement/audit/schema.ts`
- [ ] T009 Set up SQLite database schema in `joyus-ai-state/src/enforcement/audit/index.ts`
- [ ] T010 Implement audit query engine with filters and pagination
- [ ] T011 Implement incremental JSONL -> SQLite index sync
- [ ] T012 Implement storage monitor in `joyus-ai-state/src/enforcement/audit/storage-monitor.ts`
- [ ] T013 Implement correction capture in `joyus-ai-state/src/enforcement/corrections/capture.ts`

### Implementation Notes
- JSONL files rotate daily: `audit-YYYY-MM-DD.jsonl`
- SQLite uses `better-sqlite3` (synchronous, no native compilation issues)
- Index rebuild: on MCP server startup + incremental every 50 writes
- Storage monitor warns at configurable threshold (suggest default: 100MB)
- Corrections stored as separate JSONL file alongside audit entries

### Parallel Opportunities
- T007/T008 (writer + schemas) are coupled, build together
- T009/T010/T011 (SQLite) form a sub-chain
- T012 (storage monitor) and T013 (corrections) are independent after writer exists

### Dependencies
- Depends on WP01 (types, schemas, config).

### Risks & Mitigations
- `better-sqlite3` native module: may need platform-specific build steps. Pin version; test on macOS and Linux.
- JSONL corruption on crash: use atomic append (write + fsync). Detect partial lines on read.

---

## Work Package WP03: Quality Gate Engine (Priority: P1)

**Goal**: Build the gate execution engine -- gate type registry, sequential fail-fast runner, timeout handling, tier-based enforcement, and audit integration.
**Independent Test**: Configure a gate, execute it, verify fail-fast stops at first failure, verify timeout kills long-running gates, verify audit entries created.
**Prompt**: `tasks/WP03-quality-gate-engine.md`
**Estimated Size**: ~400 lines

### Included Subtasks
- [ ] T014 Implement gate type registry in `joyus-ai-state/src/enforcement/gates/registry.ts`
- [ ] T015 Implement sequential fail-fast gate runner in `joyus-ai-state/src/enforcement/gates/runner.ts`
- [ ] T016 Implement gate timeout handling in `joyus-ai-state/src/enforcement/gates/timeout.ts`
- [ ] T017 Implement gate result mapping to enforcement tiers (always-run/ask-me/skip per user tier)
- [ ] T018 Integrate gate execution with audit trail logging

### Implementation Notes
- Gates execute shell commands via `child_process.spawn`
- Timeout via `AbortController` + `setTimeout` (default: 60s per gate)
- Gate result states: pass, fail, timeout, unavailable, skipped, bypassed
- Tier mapping: Tier 1 = always-run, Tier 2 = ask-me, Tier 3 = always-run (invisible)
- Kill switch check before execution (return `disabled` result if engaged)

### Parallel Opportunities
- T014 (registry) and T016 (timeout) can be built in parallel
- T015 (runner) integrates both

### Dependencies
- Depends on WP01 (types, config), WP02 (audit writer).

### Risks & Mitigations
- Gate tool not installed: detect via spawn error, return `unavailable` status (FR-005)
- Long-running process cleanup: ensure killed processes don't leave zombie children

---

## Work Package WP04: Skill Enforcement Engine (Priority: P1)

**Goal**: Build the skill loading system -- file-pattern matching, local cache with git-based freshness, precedence resolution, context builder for Claude injection, and validation tool framework.
**Independent Test**: Configure skill mappings, edit a file matching a pattern, verify skills auto-load with correct precedence, verify constraint text is generated, verify validation catches anti-patterns.
**Prompt**: `tasks/WP04-skill-enforcement-engine.md`
**Estimated Size**: ~500 lines

### Included Subtasks
- [ ] T019 [P] Implement file-pattern-to-skill mapper in `joyus-ai-state/src/enforcement/skills/loader.ts`
- [ ] T020 [P] Implement skill cache in `joyus-ai-state/src/enforcement/skills/cache.ts`
- [ ] T021 Implement skill repo fallback (use cache when unreachable, warn user)
- [ ] T022 Implement skill precedence resolver in `joyus-ai-state/src/enforcement/skills/precedence.ts`
- [ ] T023 Implement skill context builder in `joyus-ai-state/src/enforcement/skills/context-builder.ts`
- [ ] T024 [P] Implement skill validation tool framework in `joyus-ai-state/src/enforcement/skills/validator.ts`
- [ ] T025 Integrate skill loading with audit trail logging

### Implementation Notes
- Skills are markdown files in a git-cloned repo (e.g., `zivtech-claude-skills/`)
- Cache stored in `~/.joyus-ai/projects/<hash>/skill-cache/`
- Freshness check: compare git HEAD of skill repo with cached version; if fetch fails, use cache + warn
- Precedence order: client-override > client-brand > core > platform-default (deterministic, logged per SC-010)
- Context builder aggregates plain-language constraints from all active skills into a single `skillContext` string
- Validation framework: parse anti-pattern lists from skills, provide a check function

### Parallel Opportunities
- T019 (loader), T020 (cache), T024 (validator) can be built in parallel
- T022 (precedence) and T023 (context builder) depend on loader

### Dependencies
- Depends on WP01 (types, config), WP02 (audit writer).

### Risks & Mitigations
- Skill file format variety: start with a strict format (markdown with YAML frontmatter) and validate on load.
- Glob pattern performance: use `micromatch` or `picomatch` for fast file-pattern matching.

---

## Work Package WP05: Git Guardrails Engine (Priority: P1)

**Goal**: Build git guardrails -- branch verification, naming convention checks, stale branch detection, branch count warnings, force-push warnings, and uncommitted change detection.
**Independent Test**: Set expected branch, verify mismatch detection. Configure naming convention, verify violation flagged. Create stale branches, verify detection. Verify force-push and uncommitted change warnings.
**Prompt**: `tasks/WP05-git-guardrails-engine.md`
**Estimated Size**: ~450 lines

### Included Subtasks
- [ ] T026 Implement branch verification in `joyus-ai-state/src/enforcement/git/branch-verify.ts`
- [ ] T027 [P] Implement branch naming convention checker in `joyus-ai-state/src/enforcement/git/branch-hygiene.ts`
- [ ] T028 [P] Implement stale branch detection
- [ ] T029 [P] Implement active branch count warning
- [ ] T030 [P] Implement force-push warning in `joyus-ai-state/src/enforcement/git/guardrails.ts`
- [ ] T031 [P] Implement uncommitted changes detection before branch switch
- [ ] T032 Integrate git guardrails with audit trail logging

### Implementation Notes
- Branch verification uses 002's state snapshot (task context includes expected branch)
- Stale branch detection: `git for-each-ref --sort=-committerdate refs/heads/` parsed for age
- Naming convention: regex match from config `branchRules.namingConvention`
- Force-push detection: intercept when Claude is about to call `git push --force`
- All guardrail results logged to audit trail with branch name and action type

### Parallel Opportunities
- T027-T031 are all independent checks and can be built in parallel
- T026 (branch verify) and T032 (audit integration) tie them together

### Dependencies
- Depends on WP01 (types, config), WP02 (audit writer).

### Risks & Mitigations
- Git command parsing: use structured `git` CLI output (e.g., `--format` flags) rather than parsing human-readable output.
- Branch list performance: for repos with hundreds of branches, limit to local refs only.

---

## Work Package WP06: MCP Tools -- Gates, Branch & Status (Priority: P1)

**Goal**: Expose gate execution, branch verification, hygiene checks, enforcement status, and kill switch as MCP tools that Claude can call.
**Independent Test**: Call each MCP tool via test harness, verify correct input validation, response schema, and audit logging.
**Prompt**: `tasks/WP06-mcp-tools-gates-branch.md`
**Estimated Size**: ~400 lines

### Included Subtasks
- [ ] T033 Implement `run_gates` MCP tool in `joyus-ai-state/src/mcp/tools/run-gates.ts`
- [ ] T034 Implement `verify_branch` MCP tool in `joyus-ai-state/src/mcp/tools/verify-branch.ts`
- [ ] T035 Implement `check_hygiene` MCP tool in `joyus-ai-state/src/mcp/tools/check-hygiene.ts`
- [ ] T036 Implement `enforcement_status` MCP tool in `joyus-ai-state/src/mcp/tools/enforcement-status.ts`
- [ ] T037 Implement `kill_switch` MCP tool in `joyus-ai-state/src/mcp/tools/kill-switch.ts`

### Implementation Notes
- Each tool follows the MCP SDK `tool()` registration pattern from 002
- Input/output schemas defined in `contracts/mcp-tools.md`
- Tools are thin wrappers: validate input -> call engine -> format response -> log audit
- Kill switch tool updates in-memory state and creates audit entry
- `enforcement_status` aggregates state from all engines + config + audit storage size

### Parallel Opportunities
- All 5 tools can be built in parallel (they call independent engines)

### Dependencies
- Depends on WP03 (gate engine), WP05 (git guardrails), WP01 (kill switch, config).

### Risks & Mitigations
- MCP SDK version compatibility: pin to same version as 002.

---

## Work Package WP07: MCP Tools -- Skills, Upstream, Audit & Corrections (Priority: P1)

**Goal**: Expose skill querying, upstream checking, audit querying, and correction recording as MCP tools.
**Independent Test**: Call each MCP tool, verify skill context injection, dependency search, audit query results, and correction storage.
**Prompt**: `tasks/WP07-mcp-tools-skills-audit.md`
**Estimated Size**: ~350 lines

### Included Subtasks
- [ ] T038 Implement `get_skills` MCP tool in `joyus-ai-state/src/mcp/tools/get-skills.ts`
- [ ] T039 Implement `check_upstream` MCP tool in `joyus-ai-state/src/mcp/tools/check-upstream.ts`
- [ ] T040 Implement `query_audit` MCP tool in `joyus-ai-state/src/mcp/tools/query-audit.ts`
- [ ] T041 Implement `record_correction` MCP tool in `joyus-ai-state/src/mcp/tools/record-correction.ts`

### Implementation Notes
- `get_skills`: calls skill engine, returns active skills + conflict resolutions + combined `skillContext` string
- `check_upstream`: scans dependency manifests (package.json, composer.json, requirements.txt, Gemfile) locally -- no network calls
- `query_audit`: wraps SQLite query engine with pagination
- `record_correction`: validates input, stores correction, creates audit entry

### Parallel Opportunities
- All 4 tools can be built in parallel

### Dependencies
- Depends on WP04 (skill engine), WP02 (audit infrastructure).

### Risks & Mitigations
- `check_upstream` dependency manifest parsing: start with package.json (Node.js) and composer.json (PHP/Drupal), add others incrementally.

---

## Work Package WP08: Companion Service Extensions (Priority: P2)

**Goal**: Extend the companion service from 002 with enforcement-specific event handlers -- session-start hygiene, file-change skill loading, and branch-switch config reload.
**Independent Test**: Start companion service, trigger file change matching skill pattern, verify skill load event. Switch branches, verify config reload. Start new session, verify hygiene check fires.
**Prompt**: `tasks/WP08-companion-service-extensions.md`
**Estimated Size**: ~300 lines

### Included Subtasks
- [ ] T042 Implement session-start hygiene check trigger in companion service
- [ ] T043 Implement file-change skill auto-load trigger
- [ ] T044 Implement branch-switch config reload trigger
- [ ] T045 Wire enforcement events into existing companion service event handler

### Implementation Notes
- Companion service from 002 already watches filesystem and git events
- Add new event types: `enforcement:hygiene-check`, `enforcement:skill-reload`, `enforcement:config-reload`
- Session-start trigger: on companion service startup or when MCP server connects, run `check_hygiene`
- File-change trigger: when watched files match skill mapping patterns, trigger skill reload via MCP server IPC
- Branch-switch trigger: when `.git/HEAD` changes, reload enforcement config for new branch context

### Parallel Opportunities
- T042, T043, T044 are independent event handlers and can be built in parallel
- T045 wires them into the existing event router

### Dependencies
- Depends on WP04 (skill engine), WP05 (git guardrails). Requires 002's companion service to exist.

### Risks & Mitigations
- Companion service from 002 may not be built yet: implement event handlers as standalone modules that can be wired in later.

---

## Work Package WP09: Integration Testing & Hardening (Priority: P2)

**Goal**: End-to-end integration tests covering gate execution flow, skill loading flow, audit roundtrip, tier-specific behavior, error handling, and config edge cases.
**Independent Test**: All integration tests pass. Error scenarios degrade gracefully. Config validation catches invalid input.
**Prompt**: `tasks/WP09-integration-testing.md`
**Estimated Size**: ~450 lines

### Included Subtasks
- [ ] T046 End-to-end gate execution flow test (config -> trigger -> execute -> block/pass -> audit)
- [ ] T047 End-to-end skill loading flow test (file edit -> pattern match -> skill load -> context injection)
- [ ] T048 Audit roundtrip test (write JSONL -> build index -> query SQLite -> verify results)
- [ ] T049 Tier-specific behavior test matrix (Tier 1/2/3 x gates/skills/git guardrails)
- [ ] T050 Error handling: gate unavailable, skill repo down, timeout, kill switch during execution
- [ ] T051 Config validation edge cases (invalid config, missing fields, conflicting overrides, policy enforcement)

### Implementation Notes
- Use Vitest for all tests
- Gate execution tests: mock shell commands to simulate pass/fail/timeout/unavailable
- Skill loading tests: create temp skill repo with test skills
- Audit tests: use temp directories for JSONL + SQLite files
- Tier matrix: 3 tiers x 3 domains (gates, skills, git) = 9 behavior combinations

### Parallel Opportunities
- T046-T051 can all be written in parallel (independent test files)

### Dependencies
- Depends on WP06, WP07, WP08 (all MCP tools and companion service must exist).

### Risks & Mitigations
- Test isolation: each test creates its own temp directory and config to avoid cross-test contamination.
- Git test fixtures: use `git init` in temp directories with scripted commits for branch/stale tests.

---

## Dependency & Execution Summary

```
WP01 (Foundation)
  |
  v
WP02 (Audit)
  |
  +-------+-------+
  |       |       |
  v       v       v
WP03    WP04    WP05
(Gates) (Skills) (Git)    <-- Can run in parallel
  |       |       |
  +---+   +---+   |
  |   |   |   |   |
  v   |   v   |   v
WP06 |  WP07  | WP08     <-- Can run in parallel
  |   |   |   |   |
  +---+---+---+---+
  |
  v
WP09 (Integration)
```

- **Sequence**: WP01 -> WP02 -> [WP03, WP04, WP05 parallel] -> [WP06, WP07, WP08 parallel] -> WP09
- **Parallelization**: After WP02, three engine WPs run in parallel. After engines, three tool/service WPs run in parallel.
- **MVP Scope**: WP01 + WP02 + WP03 + WP06 (foundation + audit + gates + gate MCP tools) delivers the highest-impact user story (US1: quality gate blocks bad push).

---

## Subtask Index (Reference)

| Subtask | Summary | WP | Priority | Parallel? |
|---------|---------|-----|----------|-----------|
| T001 | Define enforcement TypeScript types | WP01 | P0 | No |
| T002 | Create Zod validation schemas | WP01 | P0 | No |
| T003 | Implement enforcement config loader | WP01 | P0 | No |
| T004 | Implement config inheritance/merging | WP01 | P0 | No |
| T005 | Implement config validation with defaults | WP01 | P0 | No |
| T006 | Implement session-scoped kill switch | WP01 | P0 | No |
| T007 | Implement JSONL audit writer | WP02 | P0 | No |
| T008 | Implement audit entry Zod schemas | WP02 | P0 | No |
| T009 | Set up SQLite database schema | WP02 | P0 | No |
| T010 | Implement audit query engine | WP02 | P0 | No |
| T011 | Implement JSONL -> SQLite index sync | WP02 | P0 | No |
| T012 | Implement storage monitor | WP02 | P0 | Yes |
| T013 | Implement correction capture | WP02 | P0 | Yes |
| T014 | Implement gate type registry | WP03 | P1 | Yes |
| T015 | Implement fail-fast gate runner | WP03 | P1 | No |
| T016 | Implement gate timeout handling | WP03 | P1 | Yes |
| T017 | Implement gate tier mapping | WP03 | P1 | No |
| T018 | Integrate gates with audit trail | WP03 | P1 | No |
| T019 | Implement file-pattern-to-skill mapper | WP04 | P1 | Yes |
| T020 | Implement skill cache | WP04 | P1 | Yes |
| T021 | Implement skill repo fallback | WP04 | P1 | No |
| T022 | Implement skill precedence resolver | WP04 | P1 | No |
| T023 | Implement skill context builder | WP04 | P1 | No |
| T024 | Implement skill validation framework | WP04 | P1 | Yes |
| T025 | Integrate skills with audit trail | WP04 | P1 | No |
| T026 | Implement branch verification | WP05 | P1 | No |
| T027 | Implement naming convention checker | WP05 | P1 | Yes |
| T028 | Implement stale branch detection | WP05 | P1 | Yes |
| T029 | Implement branch count warning | WP05 | P1 | Yes |
| T030 | Implement force-push warning | WP05 | P1 | Yes |
| T031 | Implement uncommitted changes detection | WP05 | P1 | Yes |
| T032 | Integrate git guardrails with audit | WP05 | P1 | No |
| T033 | Implement run_gates MCP tool | WP06 | P1 | Yes |
| T034 | Implement verify_branch MCP tool | WP06 | P1 | Yes |
| T035 | Implement check_hygiene MCP tool | WP06 | P1 | Yes |
| T036 | Implement enforcement_status MCP tool | WP06 | P1 | Yes |
| T037 | Implement kill_switch MCP tool | WP06 | P1 | Yes |
| T038 | Implement get_skills MCP tool | WP07 | P1 | Yes |
| T039 | Implement check_upstream MCP tool | WP07 | P1 | Yes |
| T040 | Implement query_audit MCP tool | WP07 | P1 | Yes |
| T041 | Implement record_correction MCP tool | WP07 | P1 | Yes |
| T042 | Session-start hygiene check trigger | WP08 | P2 | Yes |
| T043 | File-change skill auto-load trigger | WP08 | P2 | Yes |
| T044 | Branch-switch config reload trigger | WP08 | P2 | Yes |
| T045 | Wire events into companion service | WP08 | P2 | No |
| T046 | E2E gate execution flow test | WP09 | P2 | Yes |
| T047 | E2E skill loading flow test | WP09 | P2 | Yes |
| T048 | Audit roundtrip test | WP09 | P2 | Yes |
| T049 | Tier-specific behavior test matrix | WP09 | P2 | Yes |
| T050 | Error handling edge cases | WP09 | P2 | Yes |
| T051 | Config validation edge cases | WP09 | P2 | Yes |
