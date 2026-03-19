---
work_package_id: WP10
title: Integration & Validation
lane: "done"
dependencies: []
base_branch: main
base_commit: 31a79e98c335b7afb4072e860de05aa3331c3821
created_at: '2026-03-16T19:16:01.378024+00:00'
subtasks: [T055, T056, T057, T058, T059, T060]
phase: Phase G - Integration
assignee: "Claude"
agent: "claude-sonnet"
shell_pid: "81465"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP10: Integration & Validation

## Objective

Create end-to-end integration tests that verify the complete pipeline framework works as a system, plus a full validation sweep confirming zero regressions. These tests exercise the entire flow from event publication through pipeline execution to analytics, crossing all module boundaries built in WP01-WP09.

## Implementation Command

```bash
spec-kitty implement WP10 --base WP09
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (all acceptance scenarios, exit criteria)
- **Plan**: `kitty-specs/009-automated-pipelines-framework/plan.md` (WP-10, WP-18, WP-22: all test work items)
- **Exit Criteria**: plan.md Exit Criteria table — every criterion must have a corresponding test

Integration tests are the final verification that the pipeline framework delivers on its spec promises. They test module interactions, not individual units (those were tested in each WP). Integration tests use mock platform services (profile engine, content infrastructure) but real pipeline framework code.

**Test infrastructure**:
- Vitest 1.x for test runner
- Database: use in-memory SQLite or mock Drizzle client for fast tests, OR use a test PostgreSQL database for true integration tests (depending on CI environment)
- Mock platform services: mock implementations of ProfileEngineClient, ContentIntelClient, ContentInfraClient, NotificationService
- Clock manipulation: Vitest's `vi.useFakeTimers()` for schedule and timeout tests

---

## Subtask T055: End-to-End Pipeline Execution Test

**Purpose**: Verify the complete execution path from corpus-change trigger through step execution to completion.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/integration/e2e-execution.test.ts`
2. Test scenario — **User Story 1**: Event-Triggered Pipeline Execution
   - Setup:
     - Create a pipeline for tenant "test-tenant-a" with trigger type `corpus_change`
     - Pipeline has 3 steps: source_query -> profile_generation -> notification
     - Mock step handlers to return success with test output data
   - Execute:
     - Publish a corpus_change event for tenant "test-tenant-a" with payload `{ sourceIds: ['source-1'], changeType: 'added' }`
     - Wait for executor to process the event (poll cycle)
   - Verify:
     - trigger_event row created with status `processed`
     - pipeline_execution row created with status `completed`, completedAt set
     - 3 execution_step rows, all with status `completed`, correct position order
     - Each step's outputData matches mock handler output
     - Pipeline's stepsCompleted = 3, stepsTotal = 3
     - trigger_event.pipelinesTriggered includes the pipeline ID
3. Test scenario — **No-op execution**:
   - Publish corpus_change event with empty payload (no affected authors)
   - First step (source_query) returns no-op
   - Pipeline still completes (with a no-op execution) — it does NOT fail
4. Test scenario — **Multiple pipelines triggered**:
   - Create 2 pipelines for same tenant, both triggered by corpus_change
   - Publish one event
   - Both pipelines execute independently
5. Test scenario — **User Story 2**: Failure and recovery
   - Create a pipeline with 5 steps
   - Mock step 3 to fail with a transient error, then succeed on retry
   - Verify: step 3 has attempts = 2, pipeline completes successfully
   - Create another pipeline where step 3 exhausts retries
   - Verify: execution status = paused_on_failure, steps 4-5 not executed

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/integration/e2e-execution.test.ts` (new, ~300 lines)

**Validation**:
- [ ] Full lifecycle: event -> trigger -> execution -> step completion
- [ ] No-op handling: step returns no-op, pipeline completes
- [ ] Multiple pipelines: both execute from one event
- [ ] Retry: transient failure retried and succeeds
- [ ] Exhausted retries: pipeline pauses on failure

---

## Subtask T056: Review Gate Flow Test

**Purpose**: Verify the complete review gate lifecycle: pause, decide, resume, including partial approval and all-rejected scenarios.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/integration/review-gate-flow.test.ts`
2. Test scenario — **User Story 3**: Full approval flow
   - Setup: pipeline with steps: content_generation -> review_gate -> notification
   - Mock content_generation to produce 2 artifacts
   - Execute pipeline, verify:
     - Execution pauses at review_gate (status = paused_at_gate)
     - 2 ReviewDecision rows created (status = pending)
   - Submit approval for both artifacts
   - Verify:
     - Both decisions status = approved
     - Execution resumes (status = running, then completed)
     - Notification step executes with both approved artifacts
3. Test scenario — **Partial approval**:
   - Same setup, 3 artifacts
   - Approve 2, reject 1 with feedback: `{ reason: "Off-brand tone", category: "tone" }`
   - Verify:
     - Pipeline resumes
     - Notification step receives only 2 approved artifacts
     - Rejected artifact has feedback stored
     - reviewGateResults in execution context has correct approvalRate (0.667)
4. Test scenario — **All rejected**:
   - Reject all artifacts
   - Verify:
     - Pipeline resumes
     - Next step receives empty artifact set
     - Next step executes as no-op (or completes with zero artifacts to process)
5. Test scenario — **Partial decisions (no resume)**:
   - 3 artifacts, decide on 2 only
   - Verify execution stays paused_at_gate
6. Test scenario — **Cross-tenant decision rejected**:
   - Create decision for tenant A's pipeline
   - Attempt to decide as tenant B
   - Verify: decision rejected (error, not updated)

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/integration/review-gate-flow.test.ts` (new, ~250 lines)

**Validation**:
- [ ] Full approval -> resume -> complete
- [ ] Partial approval -> only approved artifacts forwarded
- [ ] All rejected -> next step gets empty set
- [ ] Incomplete decisions -> stays paused
- [ ] Cross-tenant -> rejected

---

## Subtask T057: Scheduled Pipeline Execution Test

**Purpose**: Verify scheduled pipelines fire on time and handle overlap correctly.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/integration/scheduled-execution.test.ts`
2. Test scenario — **Scheduled execution fires**:
   - Use Vitest fake timers
   - Create a pipeline with schedule trigger, cron = `*/5 * * * *` (every 5 minutes)
   - Register the schedule
   - Advance fake timer by 5 minutes
   - Verify: trigger_event created with type schedule_tick, pipeline executes
3. Test scenario — **Overlap skip**:
   - Create pipeline with skip_if_running concurrency policy
   - Start a slow execution (mock step handler with delay)
   - Advance timer to next cron tick while execution is still running
   - Verify: second execution is NOT created, skip warning is logged
4. Test scenario — **Disabled pipeline skip**:
   - Create pipeline with schedule, set status = disabled
   - Advance timer past cron tick
   - Verify: no execution created
5. Test scenario — **Dynamic schedule update**:
   - Create pipeline with cron every 5 minutes
   - Update to cron every 10 minutes
   - Advance timer by 5 minutes
   - Verify: no execution (old schedule removed, new schedule hasn't fired yet)
   - Advance timer by another 5 minutes (total 10)
   - Verify: execution created (new schedule fires)

**Important**: Use Vitest's `vi.useFakeTimers()` and `vi.advanceTimersByTime()` for all timing tests. Do NOT use real timers in tests.

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/integration/scheduled-execution.test.ts` (new, ~200 lines)

**Validation**:
- [ ] Scheduled pipeline fires at correct time
- [ ] Overlap is detected and skipped (skip_if_running)
- [ ] Disabled pipelines don't fire
- [ ] Schedule updates take effect

---

## Subtask T058: Analytics Accuracy Test

**Purpose**: Verify that analytics metrics accurately reflect execution outcomes after multiple runs.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/integration/analytics-accuracy.test.ts`
2. Test scenario — **SC-007**: 20 executions with varying outcomes
   - Create a pipeline for tenant
   - Simulate 20 executions:
     - 15 completed successfully (varying durations: 100ms, 200ms, ..., 1500ms)
     - 3 completed after retry on step 2 (transient failure then success)
     - 2 failed (exhausted retries on step 3)
   - Refresh metrics
   - Verify:
     - totalExecutions = 20
     - successCount = 18 (15 direct success + 3 retry-then-success)
     - failureCount = 2
     - cancelledCount = 0
     - meanDurationMs is within expected range (average of 18 completed execution durations)
     - p95DurationMs is the correct 95th percentile value
     - failureBreakdown shows step 3 with correct error type and count
3. Test scenario — **Review analytics**:
   - Simulate 10 review decisions: 7 approved, 3 rejected
   - Verify:
     - reviewApprovalRate = 0.7
     - reviewRejectionRate = 0.3
     - meanTimeToReviewMs is within expected range
4. Test scenario — **Quality signal emission**:
   - Simulate 10 decisions with 4 rejections (40% rejection rate)
   - Verify: quality signal emitted (rejectionRate = 0.4)
   - Simulate 10 more decisions with 2 rejections (20% cumulative)
   - Verify: no new signal (within threshold when looking at last 10)
5. Test scenario — **Staleness** (SC-007: within 5 minutes):
   - Complete an execution
   - Verify metrics are refreshed within the same test (not delayed)

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/integration/analytics-accuracy.test.ts` (new, ~200 lines)

**Validation**:
- [ ] Counts match exactly
- [ ] Duration statistics are mathematically correct
- [ ] Review rates computed correctly
- [ ] Quality signal threshold triggers correctly
- [ ] Metrics refresh is timely

---

## Subtask T059: Tenant Isolation Test

**Purpose**: Verify that no pipeline data leaks across tenants in any operation.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/integration/tenant-isolation.test.ts`
2. Setup: create pipelines, executions, and review decisions for two tenants: "tenant-alpha" and "tenant-beta"
3. Test cases:
   - **Pipeline listing**: tenant-alpha lists pipelines, sees only their own
   - **Pipeline get**: tenant-alpha requests tenant-beta's pipeline by ID, gets 404
   - **Execution history**: tenant-alpha queries execution history, sees only their own
   - **Execution detail**: tenant-alpha requests tenant-beta's execution by ID, gets 404
   - **Trigger event**: corpus_change event for tenant-alpha does NOT trigger tenant-beta's pipelines
   - **Review decision**: tenant-alpha attempts to decide on tenant-beta's review decision, rejected
   - **Manual trigger**: tenant-alpha attempts to manually trigger tenant-beta's pipeline, rejected
   - **Template instantiation**: both tenants can instantiate same template, each gets independent pipeline
   - **Analytics**: tenant-alpha sees only their metrics, not tenant-beta's
   - **Pipeline limit**: tenant-alpha at limit (20 pipelines), tenant-beta can still create pipelines
4. Each test creates data for both tenants and verifies isolation from the other tenant's perspective

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/integration/tenant-isolation.test.ts` (new, ~200 lines)

**Validation**:
- [ ] All data access paths enforce tenant isolation
- [ ] Cross-tenant access returns 404 (not 403)
- [ ] Events only trigger same-tenant pipelines
- [ ] Review decisions only accessible to same tenant
- [ ] Metrics are tenant-scoped

---

## Subtask T060: Full Validation Sweep

**Purpose**: Run the complete validation suite and confirm zero regressions across the entire codebase.

**Steps**:
1. Run `npm run validate` (typecheck + lint + test)
2. Verify:
   - TypeScript compilation: zero errors
   - ESLint: zero errors (warnings acceptable)
   - All tests pass: existing tests + all new pipeline tests
   - No skipped tests (all .skip or .todo removed)
3. Check for common issues:
   - Import path errors (missing `.js` extensions for ESM)
   - Circular imports between pipeline modules
   - Type mismatches between schema types and runtime types
   - Missing barrel exports
4. Count new test files and verify coverage:
   - WP01: no tests (schema only, validated by typecheck)
   - WP02: `pg-notify-bus.test.ts`
   - WP03: `cycle-detector.test.ts`, `corpus-change.test.ts`
   - WP04: `executor.test.ts`, `step-runner.test.ts`, `retry.test.ts`
   - WP06: `gate.test.ts`, `escalation.test.ts`
   - WP07: `schedule.test.ts`, `store.test.ts`
   - WP08: `routes.test.ts`
   - WP09: `aggregator.test.ts`, `quality-signals.test.ts`
   - WP10: `e2e-execution.test.ts`, `review-gate-flow.test.ts`, `scheduled-execution.test.ts`, `analytics-accuracy.test.ts`, `tenant-isolation.test.ts`
   - Total: ~19 test files
5. If any tests fail: diagnose, fix, and re-run until clean

**Files**: None (verification only)

**Validation**:
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run test` passes — ALL tests (existing + new)
- [ ] `npm run validate` passes (combined command)
- [ ] No circular imports
- [ ] No missing exports
- [ ] Zero regressions to existing functionality

---

## Definition of Done

- [ ] End-to-end pipeline execution test passes (corpus-change -> steps -> completion)
- [ ] Review gate flow test passes (pause -> decide -> resume, partial approval, all-rejected)
- [ ] Scheduled execution test passes (fires on time, overlap skip, disabled skip)
- [ ] Analytics accuracy test passes (20 executions, correct aggregates, quality signals)
- [ ] Tenant isolation test passes (all data access paths verified)
- [ ] `npm run validate` passes with zero errors and zero regressions
- [ ] All exit criteria from plan.md have corresponding test coverage:
  - SC-001: Pipeline executes end-to-end from trigger to completion
  - SC-002: Retry policy correct across failure scenarios
  - SC-003: Review gate pauses and routes within target latency
  - SC-004: Cycle detection catches all cycles (covered in WP03 unit tests)
  - SC-005: Execution history queryable within target latency
  - SC-007: Analytics reflect outcomes within 5 minutes
- [ ] All acceptance scenarios from spec.md User Stories 1-6 are covered

## Risks

- **Test database setup**: Integration tests need a PostgreSQL database with the `pipelines` schema created. If CI does not provide a test database, tests may need to use mocked Drizzle operations (less realistic but still valuable).
- **Fake timer compatibility**: node-cron may not work with Vitest's fake timers. Mitigation: use `vi.spyOn` to mock cron.schedule and manually invoke callbacks, rather than relying on real timer advancement.
- **Test execution time**: 19 test files with integration tests could be slow. Mitigation: use parallel test execution (Vitest default), mock expensive operations, use fast-returning mock handlers.

## Reviewer Guidance

- Verify each spec exit criterion has at least one test
- Check that integration tests cross module boundaries (not just testing individual modules again)
- Verify tenant isolation tests cover ALL data access paths (not just the obvious ones)
- Confirm review gate tests cover the full decision matrix (all approved, partial, all rejected, incomplete)
- Check that scheduled execution tests use fake timers (no real setTimeout in tests)
- Verify analytics tests use exact numerical verification (not approximate)
- Confirm the validation sweep runs the FULL `npm run validate` command (not just tests)
- Check that no test files are `.skip`-ed or `.todo`-ed

## Activity Log
- 2026-03-16T19:29:48Z – unknown – shell_pid=81465 – lane=done – 42 integration tests covering full framework. 315 total tests.
