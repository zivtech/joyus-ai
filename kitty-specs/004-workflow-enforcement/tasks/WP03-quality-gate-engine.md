---
work_package_id: WP03
title: Quality Gate Engine
lane: planned
dependencies:
- WP01
- WP02
subtasks:
- T014
- T015
- T016
- T017
- T018
phase: Phase 2 - Enforcement Engines
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T15:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP03 -- Quality Gate Engine

## IMPORTANT: Review Feedback Status

- **Has review feedback?**: Check `review_status` above.
- **Mark as acknowledged**: Update `review_status: acknowledged` when addressing feedback.

---

## Review Feedback

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Build gate type registry supporting lint, test, a11y, visual-regression, and custom gates
- Implement sequential fail-fast gate runner
- Implement timeout handling with 60-second default
- Map gate results to enforcement tiers based on user tier
- Integrate all gate executions with audit trail
- **Done when**: Gates execute shell commands sequentially, stop at first failure, respect timeouts, map results to tier-appropriate enforcement, and log all results to audit

## Context & Constraints

- **Spec**: FR-001 through FR-007 (quality gates), User Story 1
- **Data Model**: QualityGate entity, GateType enum, EnforcementTier enum
- **Research**: gate execution model (sequential fail-fast), timeout design (60s default, AbortController)
- **Plan**: `joyus-ai-state/src/enforcement/gates/` directory
- **Clarifications**: Sequential fail-fast confirmed. 60-second default confirmed.

**Implementation command**: `spec-kitty implement WP03 --base WP02`

## Subtasks & Detailed Guidance

### Subtask T014 -- Implement gate type registry

- **Purpose**: Provide a registry of supported gate types with metadata about each (display name, default command patterns, expected output format).
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/gates/registry.ts`
  2. Define `GateTypeInfo` interface: `{ type: GateType, displayName: string, defaultCommand?: string, outputParser?: (stdout: string) => GateOutput }`
  3. Register built-in gate types:
     - `lint`: default command pattern `npx eslint .`, parse for error count
     - `test`: default command pattern `npx vitest run`, parse for pass/fail count
     - `a11y`: default command pattern `npx pa11y-ci`, parse for violation count
     - `visual-regression`: no default command (requires project-specific config)
     - `custom`: user-provided command, no parsing (exit code only)
  4. Implement `getGateInfo(type: GateType): GateTypeInfo`
  5. Output parsers are best-effort -- if parsing fails, fall back to exit code (0 = pass, non-zero = fail)
- **Files**: `joyus-ai-state/src/enforcement/gates/registry.ts` (new, ~60 lines)

### Subtask T015 -- Implement sequential fail-fast gate runner

- **Purpose**: Core gate execution engine. Runs gates in configured order, stops at first failure.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/gates/runner.ts`
  2. Implement `runGates(config: GateRunConfig): Promise<GateRunResult>`:
     ```typescript
     interface GateRunConfig {
       trigger: TriggerPoint;
       gates: QualityGate[];
       userTier: UserTier;
       gateOverrides: Record<string, EnforcementTier>;
       enforcementActive: boolean; // from kill switch
     }
     interface GateRunResult {
       enforcementActive: boolean;
       trigger: TriggerPoint;
       gatesExecuted: GateExecutionResult[];
       overallResult: 'pass' | 'fail' | 'bypassed' | 'disabled';
       failedGate?: string;
     }
     ```
  3. Logic:
     - If `!enforcementActive`, return `overallResult: 'disabled'` immediately
     - Filter gates for the specified trigger point
     - Sort by `order` field
     - For each gate:
       a. Determine effective enforcement tier (user tier default -> gate config -> developer override)
       b. Execute gate command (call `executeGate` from T016)
       c. If result is `fail`:
          - If tier is `always-run`: stop, set `overallResult: 'fail'`
          - If tier is `ask-me`: stop, set `overallResult: 'fail'` (Claude will present choice)
          - If tier is `skip`: log, continue to next gate
       d. If result is `pass`, `timeout`, `unavailable`: log and continue
     - If all gates pass: `overallResult: 'pass'`
- **Files**: `joyus-ai-state/src/enforcement/gates/runner.ts` (new, ~100 lines)
- **Notes**: The runner doesn't make the block/allow decision for `ask-me` -- it reports the failure, and the MCP tool layer (WP06) lets Claude present the choice.

### Subtask T016 -- Implement gate timeout handling

- **Purpose**: Prevent gates from hanging indefinitely. Kill the process after the configured timeout.
- **Steps**:
  1. Create `joyus-ai-state/src/enforcement/gates/timeout.ts`
  2. Implement `executeGate(gate: QualityGate): Promise<GateExecutionResult>`:
     ```typescript
     interface GateExecutionResult {
       gateId: string;
       name: string;
       type: GateType;
       result: AuditResult;
       duration: number;  // milliseconds
       output: string;    // stdout+stderr, truncated to 2000 chars
       enforcementTier: EnforcementTier;
     }
     ```
  3. Use `child_process.spawn` to execute the gate command
  4. Implement timeout:
     - Create `AbortController`
     - Set `setTimeout` for `gate.timeout * 1000` milliseconds (default: 60000)
     - On timeout: abort the controller, kill the process, return `result: 'timeout'`
  5. Handle errors:
     - Command not found (ENOENT): return `result: 'unavailable'` (FR-005)
     - Non-zero exit code: return `result: 'fail'`
     - Zero exit code: return `result: 'pass'`
  6. Capture stdout + stderr, truncate to 2000 characters
  7. Measure duration with `performance.now()`
- **Files**: `joyus-ai-state/src/enforcement/gates/timeout.ts` (new, ~80 lines)
- **Notes**: Use `signal` option on `spawn` for clean abort. Ensure child process and all descendants are killed (use `kill(-pid)` for process group).

### Subtask T017 -- Implement gate result mapping to enforcement tiers

- **Purpose**: Determine the effective enforcement tier for each gate based on user tier, gate defaults, project policy, and developer overrides.
- **Steps**:
  1. Add to `runner.ts` or create `joyus-ai-state/src/enforcement/gates/tier-resolver.ts`:
  2. Implement `resolveGateTier(gate: QualityGate, userTier: UserTier, overrides: Record<string, EnforcementTier>, mandatoryGates: string[]): EnforcementTier`:
     - If gate is in `mandatoryGates`: return `'always-run'` (cannot be overridden)
     - If gate has a developer override: return the override
     - Otherwise: map user tier to default:
       - `tier-1` (junior): `'always-run'`
       - `tier-2` (power user): gate's `defaultTier` (usually `'ask-me'`)
       - `tier-3` (non-technical): `'always-run'`
  3. Log the resolution path for debugging (SC-010 equivalent for gates)
- **Files**: `joyus-ai-state/src/enforcement/gates/runner.ts` or new file (~40 lines)

### Subtask T018 -- Integrate gate execution with audit trail

- **Purpose**: Every gate execution must create an audit entry (FR-007, FR-020).
- **Steps**:
  1. Add audit writing to the gate runner:
  2. After each gate executes, create an `AuditEntry` with:
     - `actionType`: `'gate-execution'` (or `'gate-bypass'` if skipped by user)
     - `result`: the gate's result
     - `gateId`: the gate's ID
     - `details`: `{ command: gate.command, output: truncatedOutput, duration, enforcementTier }`
     - `activeSkills`: current active skills (passed in from caller)
     - `userTier`: from config
     - `taskId`: from session context if available
     - `branchName`: current branch
  3. Write entry via `AuditWriter.write()`
  4. Return `auditEntryIds` in the `GateRunResult`
- **Files**: `joyus-ai-state/src/enforcement/gates/runner.ts` (extend, ~30 lines added)

## Risks & Mitigations

- **Zombie processes**: use process group kill (`kill(-pid)`) and verify no orphans remain after timeout.
- **Platform differences**: `spawn` behavior varies slightly between macOS/Linux/Windows. Use `shell: true` for consistent command interpretation.
- **Large gate output**: truncate to 2000 chars to prevent audit bloat. Store full output only in the JSONL raw entry.

## Review Guidance

- Verify sequential execution order matches `gate.order` field
- Verify fail-fast stops at first failure for `always-run` and `ask-me` tiers
- Verify `skip` tier continues past failures
- Verify timeout kills the process and returns `timeout` result
- Verify unavailable tools (ENOENT) return `unavailable` not `fail`
- Verify every execution creates an audit entry

## Activity Log

- 2026-02-17T15:00:00Z -- system -- lane=planned -- Prompt created.
