---
work_package_id: "WP08"
title: "Integration & Validation"
lane: "planned"
dependencies: ["WP01", "WP02", "WP03", "WP04", "WP05", "WP06", "WP07"]
subtasks: ["T041", "T042", "T043", "T044", "T045", "T046", "T047", "T048"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP08: Integration & Validation

**Implementation command**: `spec-kitty implement WP08 --base WP07`
**Target repo**: `joyus-ai`
**Dependencies**: WP01-WP07 (all preceding WPs)
**Priority**: P1 | T041-T047 are independent test suites and can be written in parallel

## Objective

Write end-to-end integration tests that validate the complete profile isolation and scale system: tenant isolation, version lifecycle, batch ingestion, drift-triggered retraining, cache behavior, session-profile binding, and audit log completeness. Run the full validation sweep (`npm run validate`) and confirm zero regressions.

## Context

Integration tests for the profile module require:
- A running PostgreSQL database with the `profiles` and `content` schemas applied
- The `NullProfileEngineClient` for deterministic engine responses
- Test fixtures: two tenants, profiles per tenant, content items per tenant
- Clock manipulation for staleness tests (pass `now` parameter, not mock `Date.now`)

The integration tests are placed in `tests/profiles/integration/` and follow the existing test patterns in the `joyus-ai` codebase. They use Vitest and the project's existing database test helpers.

**Test isolation**: Each integration test creates its own tenant IDs and profile IDs. Tests do NOT share data. Tests clean up after themselves (or rely on transaction rollback if the test harness supports it).

---

## Subtasks

### T041: Integration test — tenant isolation (cross-tenant access denied)

**Purpose**: Verify that no code path allows cross-tenant profile access. This is the single most important test in the entire feature.

**Steps**:
1. Create `tests/profiles/integration/tenant-isolation.test.ts`
2. Set up: create Tenant A and Tenant B, each with profiles
3. Test every access path from Tenant A attempting to access Tenant B's profiles

**Test cases**:
- `GET /api/profiles/:id` with Tenant B's profile ID as Tenant A -> 404
- `POST /api/profiles/:id/retrain` with Tenant B's profile ID as Tenant A -> 404
- `POST /api/profiles/:id/pin` with Tenant B's profile ID as Tenant A -> 404
- `GET /api/profiles/:id/versions` with Tenant B's profile ID as Tenant A -> 404
- `GET /api/profiles/:id/diff/1/2` with Tenant B's profile ID as Tenant A -> 404
- `GET /api/profiles/:id/audit` with Tenant B's profile ID as Tenant A -> 404
- `DELETE /api/profiles/:id` with Tenant B's profile ID as Tenant A -> 404
- `GET /api/profiles` as Tenant A -> only returns Tenant A's profiles (zero of Tenant B's)
- MCP `profile_get` with Tenant B's profile ID in Tenant A's context -> error
- Direct DB query with `assertProfileAccessOrAudit` -> throws `ProfileNotFoundError`
- Audit log confirms all denied attempts are recorded with `result: 'denied'`

```typescript
// tests/profiles/integration/tenant-isolation.test.ts
describe('Profile Tenant Isolation', () => {
  const tenantA = `tenant-a-${createId()}`;
  const tenantB = `tenant-b-${createId()}`;
  let profileA: string;  // Profile owned by Tenant A
  let profileB: string;  // Profile owned by Tenant B

  beforeAll(async () => {
    // Create profiles for each tenant
    profileA = await createTestProfile(db, tenantA, 'Author A');
    profileB = await createTestProfile(db, tenantB, 'Author B');
  });

  it('GET /api/profiles/:id — Tenant A cannot read Tenant B profile', async () => {
    const res = await request(app)
      .get(`/api/profiles/${profileB}`)
      .set('X-Tenant-Id', tenantA)
      .set('X-User-Id', 'user-a');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PROFILE_NOT_FOUND');
  });

  it('audit log records denied access with tenant_mismatch reason', async () => {
    const entries = await queryAuditLog(db, {
      tenantId: tenantA,
      profileId: profileB,
      limit: 10,
      offset: 0,
    });

    const denial = entries.find((e) => e.result === 'denied');
    expect(denial).toBeDefined();
    expect(denial?.metadata).toMatchObject({ reason: 'tenant_mismatch' });
  });

  it('GET /api/profiles — Tenant A list contains zero Tenant B profiles', async () => {
    const res = await request(app)
      .get('/api/profiles')
      .set('X-Tenant-Id', tenantA);

    expect(res.status).toBe(200);
    const ids = res.body.profiles.map((p: any) => p.id);
    expect(ids).toContain(profileA);
    expect(ids).not.toContain(profileB);
  });

  // ... 8 more test cases covering every route and tool
});
```

**Files**:
- `tests/profiles/integration/tenant-isolation.test.ts` (new, ~150 lines)

**Validation**:
- [ ] Every API route returns 404 (not 403) for cross-tenant access
- [ ] List endpoint returns zero profiles from other tenants
- [ ] Audit log captures all denied attempts with structured metadata
- [ ] No test case passes by coincidence (use unique tenant IDs per test run)

---

### T042: Integration test — version lifecycle (create, retrain, pin, diff, rollback)

**Purpose**: Verify the complete version lifecycle works end-to-end.

**Steps**:
1. Create `tests/profiles/integration/version-lifecycle.test.ts`
2. Create a profile, train it (version 1), retrain (version 2), pin version 1, diff 1 vs 2

**Test cases**:
- Create profile -> status `pending_training`, currentVersion null
- First batch ingestion completes -> version 1 created, status `active`, currentVersion 1
- Retrain with different documents -> version 2 created, currentVersion 2
- Pin version 1 -> `getCurrentVersion` returns version 1 (not 2)
- Unpin -> `getCurrentVersion` returns version 2
- Diff version 1 vs 2 -> non-zero `changedFeatures`, valid `overallSimilarity`
- Version list returns [2, 1] (descending order)
- Getting version 1 after version 2 exists -> still returns version 1 data

**Files**:
- `tests/profiles/integration/version-lifecycle.test.ts` (new, ~120 lines)

**Validation**:
- [ ] Version numbers are 1, 2 (not 0-based, not random)
- [ ] Pin overrides currentVersion
- [ ] Diff produces valid similarity score (0.0-1.0)
- [ ] Old versions are never deleted or modified

---

### T043: Integration test — batch ingestion (100 docs, progress, cancel)

**Purpose**: Verify batch ingestion handles large corpora, progress tracking, and cancellation.

**Steps**:
1. Create `tests/profiles/integration/batch-ingestion.test.ts` (may need `tests/profiles/ingestion/batch.test.ts` if integration is heavy)
2. Create 100 content items in the content schema for a test tenant
3. Start a batch ingestion job
4. Verify progress updates
5. Test cancellation of a running job

**Test cases**:
- Create job with 100 documents -> job status `pending`, totalDocuments 100
- After processing -> status `completed`, processedDocuments ~100 (some may fail with null client)
- New profile version created with the trained features
- Cancel a pending job -> status `cancelled`, no version created
- Cancel a completed job -> no effect (still completed)
- Cross-tenant documents -> skipped (not processed), counted as failed

**Files**:
- `tests/profiles/integration/batch-ingestion.test.ts` (new, ~120 lines)

**Validation**:
- [ ] 100-document batch completes within 30 seconds (using NullProfileEngineClient)
- [ ] Progress tracking shows correct percentComplete
- [ ] Cancelled job does not create a version
- [ ] Cross-tenant documents are silently skipped

---

### T044: Integration test — drift-triggered retraining (drift event -> new version)

**Purpose**: Verify the drift -> retrain -> new version pipeline works end-to-end.

**Steps**:
1. Create `tests/profiles/integration/drift-retraining.test.ts`
2. Create a profile with version 1
3. Insert a high-drift `contentDriftReports` entry for the profile
4. Trigger the drift listener's `checkForDriftEvents()` method manually
5. Verify a batch job was created and (after processing) a new version exists

**Test cases**:
- High drift (0.85) -> retraining triggered, new version created
- Low drift (0.3) -> no retraining triggered
- `autoRetrain: false` in drift config -> no retraining triggered
- Frequency limit: retrain, then insert another high drift immediately -> second retrain skipped
- Archived profile with high drift -> no retraining triggered

**Files**:
- `tests/profiles/integration/drift-retraining.test.ts` (new, ~100 lines)

**Validation**:
- [ ] Drift above threshold triggers batch job creation
- [ ] Drift below threshold does not trigger
- [ ] Per-profile config overrides (threshold, autoRetrain, frequency) are respected
- [ ] Retraining creates a new version (versionNumber increments)

---

### T045: Integration test — cache behavior (hit, miss, invalidation, stampede)

**Purpose**: Verify cache performance and correctness.

**Steps**:
1. Create `tests/profiles/integration/cache-behavior.test.ts` (or `tests/profiles/cache/integration.test.ts`)
2. Test cache hit latency, cache miss -> DB fetch, invalidation on retrain

**Test cases**:
- First fetch -> cache miss, DB query executed, result cached
- Second fetch -> cache hit, no DB query (verify with spy/counter)
- Retrain profile -> cache invalidated, next fetch is a miss
- Concurrent fetches for same uncached profile -> only one DB query (stampede protection)
- Cache TTL expiration -> stale entry evicted, re-fetched from DB

**Files**:
- `tests/profiles/integration/cache-behavior.test.ts` (new, ~80 lines)

**Validation**:
- [ ] Cache hit timing < 5ms (measure with `performance.now()`)
- [ ] Stampede protection: concurrent getOrFetch calls result in single fetchFn invocation
- [ ] Invalidation after retrain: cache size decreases

---

### T046: Integration test — session-profile binding validation

**Purpose**: Verify that mediation sessions cannot bind to cross-tenant profiles.

**Steps**:
1. Create `tests/profiles/integration/session-binding.test.ts`
2. Create profiles in two tenants
3. Attempt to validate session-profile binding across tenants

**Test cases**:
- Same-tenant binding -> succeeds, returns profile
- Cross-tenant binding -> throws `ProfileNotFoundError`
- Audit log records the cross-tenant binding attempt

**Files**:
- `tests/profiles/integration/session-binding.test.ts` (new, ~50 lines)

**Validation**:
- [ ] Same-tenant binding returns the profile
- [ ] Cross-tenant binding throws (not returns null — explicit failure)
- [ ] Audit log captures the denial

---

### T047: Integration test — audit log completeness

**Purpose**: Verify that every profile operation is logged in the audit trail.

**Steps**:
1. Create `tests/profiles/integration/audit-completeness.test.ts`
2. Perform a sequence of operations on a profile
3. Query the audit log and verify all operations are present

**Sequence**:
1. Create profile -> `action: 'create'`
2. Read profile -> `action: 'read'`
3. Update profile -> `action: 'update'`
4. Retrain profile -> `action: 'retrain'`
5. Pin version -> `action: 'pin'`
6. Use in generation (session binding) -> `action: 'use_in_generation'`
7. Cross-tenant read attempt -> `action: 'access_denied', result: 'denied'`
8. Archive profile -> `action: 'delete'`

**Test cases**:
- All 8 operations appear in the audit log in order
- Each entry has correct `tenantId`, `userId`, `profileId`, `action`, `result`
- Cross-tenant attempt has `result: 'denied'`, all others have `result: 'allowed'`
- Audit log query respects filters (action, date range, pagination)

**Files**:
- `tests/profiles/integration/audit-completeness.test.ts` (new, ~100 lines)

**Validation**:
- [ ] All 8 action types appear in audit log
- [ ] Denied entry has correct metadata (reason, owning tenant)
- [ ] Pagination works (limit + offset)

---

### T048: Validation sweep — `npm run validate`

**Purpose**: Run the full validation suite to confirm zero regressions.

**Steps**:
1. Run `npm run typecheck` (or `tsc --noEmit`)
2. Run `npm run lint`
3. Run `npm test` (all tests, including new integration tests)
4. Verify zero errors in all three steps
5. Confirm test count increased by the number of new tests added

**Files**:
- No new files.

**Validation**:
- [ ] `npm run typecheck` exits 0 with zero errors
- [ ] `npm run lint` exits 0 with zero warnings
- [ ] `npm test` exits 0 — all tests pass, including new integration tests
- [ ] No pre-existing tests were broken
- [ ] Grep for `console.log` in new `src/profiles/` files — should only appear in `NullProfileEngineClient` warnings and error handlers (not debug statements)

---

## Definition of Done

- [ ] `tests/profiles/integration/tenant-isolation.test.ts` — 11+ test cases, all pass
- [ ] `tests/profiles/integration/version-lifecycle.test.ts` — 8+ test cases, all pass
- [ ] `tests/profiles/integration/batch-ingestion.test.ts` — 6+ test cases, all pass
- [ ] `tests/profiles/integration/drift-retraining.test.ts` — 5+ test cases, all pass
- [ ] `tests/profiles/integration/cache-behavior.test.ts` — 5+ test cases, all pass
- [ ] `tests/profiles/integration/session-binding.test.ts` — 3+ test cases, all pass
- [ ] `tests/profiles/integration/audit-completeness.test.ts` — 4+ test cases, all pass
- [ ] `npm run validate` exits 0 (typecheck + lint + test)
- [ ] Zero regressions in pre-existing tests
- [ ] No debug code (`console.log`, `debugger`, `TODO`, `HACK`) in `src/profiles/`

## Risks

- **Database test setup complexity**: Integration tests need both the `profiles` and `content` schemas applied. If the test harness only applies one schema, tests will fail. Verify the test database migration setup runs all schemas.
- **Test execution time**: 7 integration test suites with database access may take 30-60 seconds. This is acceptable for integration tests. Mark them with a Vitest tag so they can be run separately from unit tests if needed.
- **NullProfileEngineClient determinism**: Integration tests depend on the null client producing deterministic results. If the null client uses `Math.random()` (as in `trainProfile.accuracyScore`), tests that assert on accuracy values will be flaky. Use a seeded random or fixed values for test-critical paths.
- **Concurrent test interference**: Multiple test suites running in parallel could interfere if they share the same tenant IDs. Use unique tenant IDs per test file (use `createId()` in `beforeAll`).

## Reviewer Guidance

- Verify every integration test creates unique tenant IDs (not hardcoded strings like `tenant-1`). Parallel test execution must not cause collisions.
- Check that tenant isolation tests cover EVERY route — if a new route is added in WP07 but no isolation test exists for it, that route is untested for cross-tenant access.
- Confirm the validation sweep (T048) is the LAST subtask and runs AFTER all integration tests pass.
- Verify no `console.log` statements remain in `src/profiles/` except in explicit warning contexts (`NullProfileEngineClient`, audit write failures). Grep: `grep -r "console.log" src/profiles/ | grep -v "console.warn\|console.error"` should return empty.
- Check that `tests/profiles/integration/` tests import from `src/profiles/` (testing the public API), not from internal submodules. Integration tests should exercise the module through its public interface.
