---
work_package_id: WP08
title: Performance Validation
lane: planned
dependencies: [WP06, WP07]
subtasks: [T037, T038, T039, T040, T041]
phase: Phase 8 - Performance Validation & Hardening
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP08: Performance Validation

## Objective

Validate all spec performance targets with dedicated test suites: profile generation within 10 minutes for a 50-document corpus, rollback within 30 seconds, cached profile lookup under 50ms at p95, concurrent pipeline stress test with 5 simultaneous tenants, and a final comprehensive pass of typecheck, lint, and the full test suite.

## Implementation Command

```bash
spec-kitty implement WP08 --base WP07
```

## Context

- **Spec**: `kitty-specs/008-profile-isolation-and-scale/spec.md` — NFR-001 (generation <=10 min), NFR-002 (rollback <=30s), NFR-003 (cache <50ms p95), SC-001 through SC-006
- **Plan**: `kitty-specs/008-profile-isolation-and-scale/plan.md` — Phase 8 deliverables, exit criteria
- **Success criteria**:
  - SC-001: Profile generation for 50-doc corpus <=10 min
  - SC-002: Cross-tenant isolation: 10,000 queries with zero leaks
  - SC-003: Rollback <=30s
  - SC-004: Cached lookup <=50ms p95
  - SC-005: 100-doc mixed-format intake <=2 manual steps
  - SC-006: Fidelity degradation after inheritance <=5%
- **Dependencies**: All WP01-WP07 must be complete. Performance tests exercise the full stack.
- **Important**: Performance results depend on test environment hardware. Document the baseline environment (CPU, RAM, PostgreSQL version) and tag results as environment-specific.

---

## Subtask T037: Performance Test — Generation Timing

**Purpose**: Validate that profile generation for a 50-document corpus completes within 10 minutes (NFR-001, SC-001).

**Steps**:
1. Create `joyus-ai-mcp-server/tests/profiles/performance/generation-timing.test.ts`
2. Test setup:
   - Create a tenant
   - Ingest 50 documents (use generated text fixtures — realistic lengths of 500-2000 words each)
   - Attribute documents to 3 authors (mix of ~17 docs per author)
   - Create a corpus snapshot
3. Test execution:
   - Start a timer
   - Trigger profile generation via the pipeline
   - Wait for completion
   - Record total duration
4. Assertions:
   - Total duration <= 600,000 ms (10 minutes)
   - All 3 author profiles are created
   - All profiles have status `active`
   - All profiles have a valid 129-feature vector (not empty, not all zeros)
   - Generation run record shows `completed` status with accurate timing
5. Record detailed timing breakdown:
   - Document preparation time
   - Per-author engine invocation time
   - Database storage time
   - Total orchestration overhead
6. Tag this test as `@slow` or use Vitest's `describe.skipIf` for CI environments where the Python engine is unavailable

**Important**: This test requires the Spec 005 Python engine to be available. If the engine is not installed, the test should skip with a clear message explaining why.

**Files**:
- `joyus-ai-mcp-server/tests/profiles/performance/generation-timing.test.ts` (new, ~100 lines)

**Validation**:
- [ ] Test passes within 10-minute budget (or skips if engine unavailable)
- [ ] Timing breakdown is logged for analysis
- [ ] All generated profiles are valid
- [ ] Generation run record is accurate

---

## Subtask T038: Performance Test — Rollback Speed

**Purpose**: Validate that profile rollback completes (all consumers switch) within 30 seconds (NFR-002, SC-003).

**Steps**:
1. Create `joyus-ai-mcp-server/tests/profiles/performance/rollback-speed.test.ts`
2. Test setup:
   - Create a tenant
   - Create 5 versions of a profile (v1 through v5, v5 is active)
3. Test execution:
   - Start a timer
   - Roll back from v5 to v1
   - Record duration
4. Assertions:
   - Rollback duration <= 30,000 ms (30 seconds)
   - v1 is now `active`
   - v5 is now `rolled_back`
   - All queries for the active version return v1 (not v5)
   - No intermediate state is observable (atomicity)
5. Additional test: rollback with cache invalidation
   - Create a cached resolved profile
   - Roll back
   - Verify cache is invalidated
   - Verify next read re-resolves correctly
   - Total duration (rollback + invalidation) still <= 30s

**Files**:
- `joyus-ai-mcp-server/tests/profiles/performance/rollback-speed.test.ts` (new, ~80 lines)

**Validation**:
- [ ] Rollback completes in <30 seconds
- [ ] Active version switches atomically
- [ ] Cache invalidation is included in timing
- [ ] No stale data after rollback

---

## Subtask T039: Performance Test — Cache Lookup Latency

**Purpose**: Validate that cached resolved profile lookups return in under 50ms at p95 (NFR-003, SC-004).

**Steps**:
1. Create `joyus-ai-mcp-server/tests/profiles/performance/cache-latency.test.ts`
2. Test setup:
   - Create a tenant with a three-tier hierarchy (org > dept > individual)
   - Generate profiles at each tier
   - Resolve and cache the individual profile (full inheritance chain)
3. Test execution:
   - Perform 1000 cached profile lookups via `cacheService.get(tenantId, profileIdentity)`
   - Record each lookup duration
   - Compute p50, p95, p99, and max latencies
4. Assertions:
   - p95 latency <= 50 ms
   - p50 latency <= 20 ms (informational, not a hard requirement)
   - All 1000 lookups return the correct resolved profile
   - No cache misses (all 1000 should be hits after the first resolution)
5. Additional test: cache miss + on-demand resolution
   - Invalidate the cache
   - Perform a lookup via `cacheService.getOrResolve`
   - Verify the first lookup (cache miss) takes longer but subsequent lookups (cache hit) are <50ms

**Files**:
- `joyus-ai-mcp-server/tests/profiles/performance/cache-latency.test.ts` (new, ~90 lines)

**Validation**:
- [ ] p95 latency <= 50ms
- [ ] All lookups return correct data
- [ ] Latency statistics are logged for analysis
- [ ] Cache miss -> hit transition works correctly

---

## Subtask T040: Concurrent Pipeline Stress Test

**Purpose**: Validate that 5 tenants can run profile generation pipelines simultaneously without data corruption or correctness failures (FR-010).

**Steps**:
1. Create `joyus-ai-mcp-server/tests/profiles/performance/concurrent-stress.test.ts`
2. Test setup:
   - Create 5 tenants, each with a 20-document corpus and 3 authors
   - Use overlapping author names across tenants to stress isolation (all 5 have "Author A", "Author B", "Author C")
3. Test execution:
   - Launch all 5 generation pipelines concurrently (use `Promise.all`)
   - Wait for all to complete
   - Record per-tenant timing and results
4. Assertions:
   - All 5 pipelines complete successfully (status `completed`)
   - Each tenant has exactly 3 profiles (one per author)
   - No cross-tenant data: Tenant 1's "Author A" profile features are different from Tenant 2's "Author A" (different corpora)
   - No database errors or deadlocks
   - Advisory locks prevented same-tenant concurrent runs (if tested)
5. Cross-verification:
   - For each tenant, verify profile count matches expected (3)
   - For each profile, verify `tenantId` matches the generating tenant
   - Spot-check: verify feature vectors are different across tenants for the same author name (proving isolation)
6. Log summary: per-tenant duration, total wall-clock time, any warnings

**Files**:
- `joyus-ai-mcp-server/tests/profiles/performance/concurrent-stress.test.ts` (new, ~120 lines)

**Validation**:
- [ ] All 5 pipelines complete without errors
- [ ] 15 total profiles created (5 tenants x 3 authors)
- [ ] Zero cross-tenant data contamination
- [ ] No deadlocks or database errors
- [ ] Feature vectors differ across tenants for same author name

---

## Subtask T041: Final Validation — Typecheck, Lint, Full Test Suite

**Purpose**: Run the full validation suite to confirm zero type errors, zero lint violations, and all tests passing across the entire codebase.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/profiles/performance/final-validation.test.ts` (or run as a script)
2. Validation steps:
   a. **Typecheck**: `npm run typecheck` — zero errors
   b. **Lint**: `npm run lint` — zero violations (or only pre-existing ones)
   c. **Unit tests**: `npx vitest run tests/profiles/` — all profile tests pass
   d. **Full test suite**: `npx vitest run` — all tests pass (profiles + existing)
   e. **Existing tests unaffected**: verify the existing test count has not decreased
3. Feature exit criteria checklist (from plan.md):
   - [ ] All 10 functional requirements (FR-001 through FR-010) implemented and tested
   - [ ] All 5 non-functional requirements (NFR-001 through NFR-005) validated
   - [ ] All 6 success criteria (SC-001 through SC-006) passing
   - [ ] Cross-tenant isolation: zero data leaks across all test cases
   - [ ] Edge cases: tenant deletion, zero-doc, single-author, no-author handled
   - [ ] typecheck, lint, full test suite pass
   - [ ] Profile generation produces correct results for concurrent tenants with overlapping author names
   - [ ] Spec 009 integration point: corpus-change events are emittable (event schema defined, emission point exists)
4. Document results: create a validation summary showing:
   - Total tests: N (M new profile tests + K existing tests)
   - Pass rate: 100%
   - Typecheck: clean
   - Lint: clean
   - Performance targets: all met (with measured values)

**Files**:
- `joyus-ai-mcp-server/tests/profiles/performance/final-validation.test.ts` (new, ~60 lines — or run as shell commands)

**Validation**:
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run lint` passes with zero new violations
- [ ] `npx vitest run` passes with all tests green
- [ ] No existing tests are broken
- [ ] All feature exit criteria are satisfied

---

## Definition of Done

- [ ] SC-001: Profile generation for 50-doc corpus <=10 minutes (validated or skipped with justification)
- [ ] SC-003: Rollback <=30 seconds (validated)
- [ ] SC-004: Cached lookup <50ms at p95 (validated)
- [ ] FR-010: 5 concurrent tenant pipelines complete with zero data corruption (validated)
- [ ] SC-002: Cross-tenant isolation has zero leaks across all test cases
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run lint` — zero new violations
- [ ] `npx vitest run` — all tests pass (new + existing)
- [ ] Performance results documented with environment baseline
- [ ] Feature exit criteria checklist fully satisfied

## Risks

- **Engine unavailability**: Performance tests for generation timing require the Spec 005 Python engine. If unavailable in CI, tests should skip with a clear message and the generation timing test is deferred to a dedicated environment.
- **Environment variance**: Performance results are hardware-dependent. A laptop running other processes will show different results than a dedicated CI server. Document the environment and accept that absolute numbers vary.
- **Database performance**: Concurrent pipeline tests depend on PostgreSQL connection pool settings and hardware. Ensure the test database has sufficient connections (at least 10) for 5 concurrent pipelines.
- **Flaky concurrent tests**: Timing-dependent tests can be flaky. Use generous timeouts and retry logic for performance assertions. Document any flaky test patterns.

## Reviewer Guidance

- Verify performance tests have appropriate timeouts (do not use default Vitest timeout for 10-minute generation test)
- Check that generation timing test skips gracefully when engine is unavailable
- Confirm concurrent stress test uses truly different corpora per tenant (not shared)
- Verify cache latency test performs enough iterations (1000+) for statistically meaningful p95
- Check that final validation runs the FULL test suite (not just profile tests)
- Verify no existing tests are skipped, disabled, or modified
- Confirm environment baseline is documented in test output
