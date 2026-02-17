# Implementation Plan: Workflow Enforcement

**Branch**: `004-workflow-enforcement` | **Date**: 2026-02-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `kitty-specs/004-workflow-enforcement/spec.md`

## Summary

Build the workflow enforcement layer for joyus-ai — a structured mediation system that prevents common development mistakes through quality gates, automatic skill loading, git guardrails, and operation traceability. This extends the `joyus-ai-state` MCP server from feature 002 with new MCP tools and companion service event handlers. The user never interacts with enforcement directly; Claude mediates every action conversationally, adapting to the user's expertise tier.

**Architecture**: Hybrid enforcement — MCP tool interception for gates and git checks (deterministic, unbypassable), context injection for skill loading (enriches Claude's generation context), companion service events for session-start advisories.

## Technical Context

**Language/Version**: TypeScript 5.3+ / Node.js 20+
**Primary Dependencies**: `@modelcontextprotocol/sdk` (MCP server), `zod` (schema validation), `better-sqlite3` (audit index)
**Storage**: JSONL append-only log for raw audit writes + SQLite index for structured queries. Config extends 002's JSON file-based configuration. Skills cached locally from git-based skill repository.
**Testing**: Vitest (matches `joyus-ai-state` from 002)
**Target Platform**: macOS (primary), Linux, Windows via WSL2
**Project Type**: Extension of `joyus-ai-state` — adds enforcement modules to the existing MCP server + companion service
**Performance Goals**: Gate execution overhead <500ms per gate (excluding the gate tool itself); skill loading <200ms; audit write <50ms; MCP tool response <500ms
**Constraints**: Must work fully offline (SC-008). Sequential fail-fast gate execution. 60-second default gate timeout. No auto-pruning of audit data (warn at threshold). Global kill switch for emergency disable.
**Scale/Scope**: Single developer per machine. Up to 20 quality gates per project. Up to 50 skill mappings. Hundreds of audit entries per day of active work.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Multi-Tenant from Day One | PASS | Enforcement config is per-project + per-developer. Same codebase supports different clients with different gate/skill configurations. Tier assignment is per-developer. |
| Skills as Guardrails | PASS | This IS the skills-as-guardrails implementation. Skills auto-load based on file patterns. Layered enforcement: context injection for generation guidance + validation tools for post-generation verification. |
| Sandbox by Default | PASS | Enforcement is local per-developer. Audit data is local. No data crosses developer boundaries. Kill switch is session-scoped and audit-logged. |
| Monitor Everything | PASS | Audit trail captures 100% of enforcement actions (SC-006). Four audit dimensions: gate results, skill activity, branch checks, overrides. Claude Enterprise handles general monitoring; this handles enforcement-specific audit. |
| Feedback Loops | PASS | FR-030/031 capture user corrections when Claude's output doesn't meet skill constraints. Corrections stored locally for future aggregation into skill updates. |
| Spec-Driven Development | PASS | Using spec-kitty. |
| Technology Choices | PASS | TypeScript/Node.js extends 002's `joyus-ai-state`. SQLite for audit queries is lightweight and serverless. JSONL for raw writes is crash-safe. |
| Cost Awareness | PASS | All enforcement runs locally — no API calls or token usage. Gate tools are invoked via shell (existing local tools). Skill loading adds context to Claude's prompt but uses prompt caching. |
| Checkpoint/Recovery | PASS | Audit trail provides recovery context. Kill switch activation is logged for traceability. Gate results are persisted even on failure. |

**No violations. Gate passed.**

## Project Structure

### Documentation (this feature)

```
kitty-specs/004-workflow-enforcement/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── mcp-tools.md     # MCP tool API contract (enforcement tools)
└── tasks.md             # Phase 2 output (NOT created by /spec-kitty.plan)
```

### Source Code (extends joyus-ai-state from 002)

```
joyus-ai-state/
├── src/
│   ├── enforcement/                    # NEW — all 004 code lives here
│   │   ├── types.ts                    # Gate, SkillMapping, BranchRule, AuditEntry, Correction types
│   │   ├── config.ts                   # Enforcement config loading, validation, defaults
│   │   │                               #   (extends 002's config.ts with enforcement sections)
│   │   ├── gates/
│   │   │   ├── runner.ts               # Sequential fail-fast gate executor
│   │   │   ├── registry.ts             # Gate type registry (lint, test, a11y, visual-regression, custom)
│   │   │   └── timeout.ts              # Gate timeout handling (default: 60s)
│   │   ├── skills/
│   │   │   ├── loader.ts               # File-pattern-to-skill mapping, auto-load logic
│   │   │   ├── cache.ts                # Local skill cache, stale detection, fallback
│   │   │   ├── precedence.ts           # Conflict resolution (client > brand > core > default)
│   │   │   └── validator.ts            # Post-generation skill validation tools
│   │   ├── git/
│   │   │   ├── branch-verify.ts        # Branch mismatch detection (current vs expected)
│   │   │   ├── branch-hygiene.ts       # Stale branch detection, naming convention checks
│   │   │   └── guardrails.ts           # Force-push warning, uncommitted change detection
│   │   ├── audit/
│   │   │   ├── writer.ts               # JSONL append-only writer (crash-safe)
│   │   │   ├── index.ts                # SQLite index builder + query engine
│   │   │   ├── schema.ts               # Zod schemas for audit entry validation
│   │   │   └── storage-monitor.ts      # Size threshold warning (no auto-prune)
│   │   ├── corrections/
│   │   │   └── capture.ts              # User correction capture + storage
│   │   └── kill-switch.ts              # Global enforcement toggle (session-scoped)
│   ├── mcp/
│   │   └── tools/                      # NEW enforcement MCP tools
│   │       ├── run-gates.ts            # Run quality gates for a trigger point
│   │       ├── get-skills.ts           # Query active skills and how they were loaded
│   │       ├── verify-branch.ts        # Branch verification before commit/push
│   │       ├── check-hygiene.ts        # Stale branch / branch count check
│   │       ├── check-upstream.ts       # Search dependencies before writing new code
│   │       ├── query-audit.ts          # Query audit trail by time, type, skill, ticket
│   │       ├── record-correction.ts    # Capture user correction of Claude's output
│   │       ├── enforcement-status.ts   # Get current enforcement state (active gates, skills, tier)
│   │       └── kill-switch.ts          # Enable/disable enforcement for session
│   └── service/
│       └── event-handler.ts            # EXTEND — add enforcement triggers to existing event handler
├── tests/
│   ├── unit/
│   │   ├── enforcement/
│   │   │   ├── gate-runner.test.ts
│   │   │   ├── skill-loader.test.ts
│   │   │   ├── skill-precedence.test.ts
│   │   │   ├── branch-verify.test.ts
│   │   │   ├── audit-writer.test.ts
│   │   │   ├── audit-query.test.ts
│   │   │   └── kill-switch.test.ts
│   │   └── ...                         # existing 002 tests
│   ├── integration/
│   │   ├── enforcement-mcp-tools.test.ts
│   │   ├── gate-execution.test.ts
│   │   └── audit-roundtrip.test.ts
│   └── contract/
│       └── enforcement-schema.test.ts
```

**Structure Decision**: All enforcement code lives under `src/enforcement/` within the existing `joyus-ai-state` package. New MCP tools are added to `src/mcp/tools/`. The companion service's event handler is extended (not replaced) to add enforcement triggers. This keeps 002 and 004 code cleanly separated while sharing the same runtime.

## Architecture

### Hybrid Enforcement Runtime

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Developer Machine                             │
│                                                                       │
│  ┌──────────────────┐    ┌──────────────────────────────────────────┐│
│  │ Claude Desktop    │    │  joyus-ai-state (extended by 004)         ││
│  │ or Claude Code    │    │                                          ││
│  │                   │    │  ┌────────────────────────────────────┐  ││
│  │  User talks to    │◄──▶│  │         MCP Server                 │  ││
│  │  Claude. Claude   │MCP │  │                                    │  ││
│  │  calls MCP tools. │    │  │  ┌──────────┐  ┌───────────────┐  │  ││
│  │                   │    │  │  │ 002 Tools │  │  004 Tools    │  │  ││
│  │  Skills injected  │    │  │  │get_context│  │run_gates      │  │  ││
│  │  into Claude's    │    │  │  │save_state │  │get_skills     │  │  ││
│  │  context as       │    │  │  │check_canon│  │verify_branch  │  │  ││
│  │  plain-language   │    │  │  │verify_act │  │check_hygiene  │  │  ││
│  │  constraints.     │    │  │  │share_state│  │check_upstream │  │  ││
│  │                   │    │  │  │query_snap │  │query_audit    │  │  ││
│  │  Validation tools │    │  │  │           │  │record_correct │  │  ││
│  │  called before    │    │  │  │           │  │enforce_status │  │  ││
│  │  commit/push.     │    │  │  │           │  │kill_switch    │  │  ││
│  │                   │    │  │  └──────────┘  └───────────────┘  │  ││
│  └──────────────────┘    │  └──────────┬─────────────────────────┘  ││
│                           │             │                            ││
│                           │  ┌──────────▼─────────────────────────┐  ││
│                           │  │      Enforcement Engine             │  ││
│                           │  │  ┌─────────┐ ┌────────┐ ┌───────┐ │  ││
│                           │  │  │  Gates   │ │ Skills │ │  Git  │ │  ││
│                           │  │  │ Runner   │ │ Loader │ │Guards │ │  ││
│                           │  │  └────┬────┘ └───┬────┘ └──┬────┘ │  ││
│                           │  │       │          │         │       │  ││
│                           │  │       ▼          ▼         ▼       │  ││
│                           │  │  ┌────────────────────────────┐    │  ││
│                           │  │  │     Audit Trail            │    │  ││
│                           │  │  │  JSONL (writes) + SQLite   │    │  ││
│                           │  │  │  (queries)                 │    │  ││
│                           │  │  └────────────────────────────┘    │  ││
│                           │  └────────────────────────────────────┘  ││
│                           │                                          ││
│                           │  ┌────────────────────────────────────┐  ││
│                           │  │  Companion Service (extended)      │  ││
│                           │  │  + Session-start hygiene checks    │  ││
│                           │  │  + File-change skill auto-load     │  ││
│                           │  │  + Branch-switch config reload     │  ││
│                           │  └────────────────────────────────────┘  ││
│                           └──────────────────────────────────────────┘│
│                                                                       │
│  ┌─────────────────────────────┐  ┌────────────────────────────────┐ │
│  │  Skill Repository (local)   │  │  Gate Tools (installed)        │ │
│  │  Git-based, cached locally  │  │  eslint, vitest, pa11y, etc.  │ │
│  │  Fallback to cache if repo  │  │  Invoked by gate runner via   │ │
│  │  unreachable                │  │  shell commands                │ │
│  └─────────────────────────────┘  └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Enforcement Flow: Pre-Push Example

```
User: "Push my changes"
  │
  ▼
Claude calls verify_branch()
  │
  ├─ Branch mismatch? → Warn/block per tier → Audit log
  │
  ▼
Claude calls run_gates(trigger: "pre-push")
  │
  ├─ Load gate config for project + trigger point
  ├─ Check kill switch → if active, skip gates, log
  ├─ Execute gates sequentially (fail-fast):
  │   ├─ Gate 1 (lint): invoke eslint → PASS → audit log
  │   ├─ Gate 2 (test): invoke vitest → FAIL → audit log
  │   └─ Gate 3 (a11y): SKIPPED (fail-fast, Gate 2 failed)
  │
  ├─ Tier 1 (junior): Block push, explain failures
  ├─ Tier 2 (power): Present choice — fix or push anyway
  └─ Tier 3 (non-tech): Block push, explain in plain language
  │
  ▼
If push proceeds → git push → audit log (with gate results + active skills)
```

### Skill Loading Flow

```
Companion service detects file change (*.module)
  │
  ▼
Event handler checks skill mappings for file pattern
  │
  ├─ Match found: drupal-coding-standards, drupal-security
  ├─ Check skill cache → fresh? Use cached. Stale? Warn + use cached.
  ├─ Resolve precedence (client > brand > core > default)
  └─ Audit log: skill load event
  │
  ▼
MCP server enriches next tool response with:
  ├─ Plain-language constraints (injected into Claude's context)
  └─ Available validation tools (e.g., validate_drupal_security)
  │
  ▼
Claude generates code with skill constraints active
  │
  ▼
Before commit: Claude calls validation tool → verify output
  │
  ├─ PASS → proceed
  └─ FAIL → Claude self-corrects, re-validates
```

## Deferred Items

| Item | Why Deferred | When to Build |
|------|-------------|---------------|
| **Skill authoring/creation** | Separate concern (003 Domain: Client Profile Building) | When profile building pipeline is ready |
| **Team-wide audit aggregation** | Local-only for now. Phase 3 platform scope. | When remote platform exists |
| **Automatic skill updates from corrections** | FR-030/031 capture corrections, but automation deferred | After sufficient correction data collected |
| **Remote enforcement** (server-side git hooks) | This spec is local enforcement only | Phase 3 or when CI/CD integration needed |
| **Multi-agent coordination** | Enforcing across concurrent agents is complex | When multi-agent support added to platform |
| **Gate plugin system** | Fixed gate types + custom command is sufficient for now | When clients need custom gate types |
| **Visual audit UI** | Queryable via MCP tools for now | Phase 3 platform dashboard |

## Parallel Work Analysis

### Dependency Graph

```
Foundation (enforcement types + config + audit writer)
    │
    ├──▶ Wave 1a: Gate Engine (runner, registry, timeout)
    │
    ├──▶ Wave 1b: Skill Engine (loader, cache, precedence, validator)
    │       (parallel with gates — independent subsystems)
    │
    ├──▶ Wave 1c: Git Guards (branch-verify, hygiene, guardrails)
    │       (parallel with gates and skills — independent subsystem)
    │
    └──▶ Wave 2: MCP Tools + Companion Events + Integration Tests
            (after Wave 1 — tools wrap the engines)
```

### Work Distribution

- **Sequential work**: Enforcement types, config schema, audit writer/reader must be built first — all engines depend on them
- **Parallel streams**: Once foundation is done, gate engine, skill engine, and git guards can be built independently (they share config and audit but are otherwise decoupled)
- **Integration**: MCP tools wrap the engines and depend on Wave 1 being complete. Companion service event handlers depend on skill loader and git guards.
- **Kill switch**: Cross-cutting — built with foundation, checked by all engines

### Build Priority & Phasing

**Phase 1 — Foundation** (sequential, everything depends on this):
1. Enforcement types, Zod schemas, config loading/validation
2. Audit writer (JSONL append) + audit schema
3. Audit query engine (SQLite index) + storage monitor
4. Kill switch mechanism
5. Correction capture

**Phase 2 — Enforcement Engines** (parallel streams, after Phase 1):
6. **Gate engine**: runner (sequential fail-fast), registry, timeout handling
7. **Skill engine**: loader (file-pattern matching), cache (git-based + fallback), precedence resolver, validation tool framework
8. **Git guards**: branch verification, stale branch detection, naming conventions, force-push/uncommitted warnings

**Phase 3 — MCP Tools + Events** (after Phase 2):
9. **9 MCP tools**: run_gates, get_skills, verify_branch, check_hygiene, check_upstream, query_audit, record_correction, enforcement_status, kill_switch
10. **Companion service extensions**: session-start hygiene checks, file-change skill auto-load triggers, branch-switch config reload

**Phase 4 — Integration & Hardening** (after Phase 3):
11. End-to-end integration tests (gate execution flow, skill loading flow, audit roundtrip)
12. Tier-specific behavior testing (Tier 1/2/3 enforcement differences)
13. Error handling audit (gate unavailable, skill repo down, timeout, kill switch edge cases)
