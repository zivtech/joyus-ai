---
work_package_id: "WP06"
title: "Integration & Validation"
lane: "planned"
dependencies: ["WP01", "WP02", "WP03", "WP04", "WP05"]
subtasks: ["T033", "T034", "T035", "T036", "T037", "T038", "T039", "T040"]
history:
  - date: "2026-06-14"
    action: "created"
    agent: "claude-opus"
---

# WP06: Integration & Validation

**Implementation command**: `spec-kitty implement WP06`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (core extraction + schema), WP02 (FeatureGate decision core), WP03 (un-forgeable enforcement), WP04 (operator grant write path), WP05 (tool-seam gating)
**Priority**: P1

---

## Objective

Prove — with running code, not assertions — that Phase 1 of Spec 015 meets its success criteria. Every test in this WP is a load-bearing end-to-end scenario that verifies a specific SC cannot be broken silently. The three most critical are T035 (fail closed on lapsed grants during outage), T036 (structural enforcement via a second invocation path), and T038 (content-path regression gate). Pass these and the entitlement system earns the right to ship.

---

## Context

### Test file to mirror

`tests/content/integration/entitlements.test.ts` is the established convention for integration-level entitlement tests in this codebase. Study its patterns before writing a single line:

- **Import style**: named imports from the compiled module paths (`.js` extensions on all local imports, per `"type": "module"` in `package.json`).
- **Mock pattern**: `vi.fn()` for resolver mocks, a plain object literal `const mockDb = {} as never` for the DB when not needed, and a structured mock db when DB queries matter.
- **Cache usage**: `new EntitlementCache()` directly, `.set(key, entitlements)`, `.get(key)`, `.invalidate(key)` — no factory functions.
- **Fixture helper**: `makeEntitlements(sourceIds, overrides)` returns a `ResolvedEntitlements` — mirror this with a `makeFeatureGrant` / `makeSubject` helper for feature entitlements.
- **Fail-closed assertions**: when a resolver throws, verify that `resolvedFrom` contains `'restricted'` or `'default_deny'` and that entitled content/features are absent. Never `expect(result).toBeDefined()` alone.
- **TTL test pattern**: use a `ttlSeconds: 0` override to expire immediately; a short busy-wait (< 5 ms) is acceptable per existing convention (see `cache TTL` describe block).
- **No real database, no network**: all tests use mocks. No test should open a real pg connection.

### Test runner

```
npm run validate     # typecheck + lint + vitest run (the gate T040 must pass)
npm test             # vitest run only
```

Vitest config (`vitest.config.ts`):
- `environment: 'node'`
- `include: ['src/**/*.test.ts', 'tests/**/*.test.ts']`
- `testTimeout: 10000`
- Coverage thresholds enforced (statements 59%, branches 74%, functions 67%, lines 59%)

### New test file location

```
tests/entitlements/integration/feature-gate.test.ts
```

Mirror the directory structure of the existing content integration tests.

### Fixtures needed (shared helpers — define in this file or a `helpers.ts` sibling)

```typescript
// Subject helpers
function makeSubject(type: 'user' | 'tenant', id: string): Subject {
  return { subject_type: type, subject_id: id };
}

// Grant helpers — mirrors makeEntitlements() in the content test
function makeGrant(featureKey: string, overrides: Partial<FeatureEntitlement> = {}): FeatureEntitlement {
  return {
    id: 'grant-test',
    subject_type: 'user',
    subject_id: 'user-alice',
    feature_key: featureKey,
    status: 'active',
    valid_from: new Date(Date.now() - 1000),
    valid_until: null,           // perpetual by default
    source: 'admin',
    limits: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// Fake operator context (WP04 admin role)
function makeOperatorContext(): OperatorContext {
  return { actorId: 'operator-sys', role: 'admin' };
}

// Resolver mocks
function makeResolver(grants: string[]): FeatureEntitlementResolver {
  return { resolve: vi.fn().mockResolvedValue(grants) };
}

function makeFailingResolver(): FeatureEntitlementResolver {
  return { resolve: vi.fn().mockRejectedValue(new Error('resolver outage: connection refused')) };
}
```

### Key types to import (paths will be stable post-WP01/WP02)

```typescript
import { FeatureGate, FeatureNotEntitledError } from '../../../src/entitlements/gate.js';
import { FeatureEntitlementResolver }           from '../../../src/entitlements/resolver.js';
import { EntitlementCache }                     from '../../../src/entitlements/core/cache.js';
import { NullMembershipResolver }               from '../../../src/entitlements/membership.js';
import type { Subject, FeatureKey }             from '../../../src/entitlements/types.js';
import type { GateToken }                       from '../../../src/entitlements/gate.js';
// WP04 grant administration
import { GrantsService }                        from '../../../src/entitlements/grants-service.js';
// WP05 tool seam
import { getAllTools, executeTool }             from '../../../src/tools/index.js';
```

Adjust import paths to match the actual module layout produced by WP01–WP05. Do not hard-code paths that may shift — read the barrel exports from `src/entitlements/index.ts` first.

---

## SC Coverage Map

| Test | Subtask | Success Criteria proved |
|------|---------|------------------------|
| T033 | individual licensing end-to-end | SC-1 (durable licensing), SC-2a (individual path, pre-WP12) |
| T034 | explicit deny + audit log | SC-3 (explicit deny, decision logged) |
| T035 | fail-closed on lapsed grants | SC-6 (expired grant denied on outage; valid grant still served) |
| T036 | structural enforcement | SC-5 (second-path denied; hand-constructed object rejected) |
| T037 | union resolution seam | SC-2 (union: {user} pre-WP12; membership stub adds tenant grant) |
| T038 | content-path regression | SC-4 (reuse is real; existing content tests green) |
| T039 | auditability query | SC-11 (every allow/deny queryable per subject + per feature) |

Note: SC-7 (grant path exists) is exercised inside T033 (operator creates a grant via `GrantsService`, not raw SQL). SC-8, SC-9, SC-10 are Phase 2 only and are explicitly out of scope for WP06.

---

## Subtasks

---

### T033 — Individual licensing end-to-end (SC-1, SC-2a)

**Purpose**: Prove the complete individual-subject licensing lifecycle: operator grants → `tools/list` filters in → `tools/call` succeeds → operator revokes → denied within one TTL. This is Scenario 1 from the spec enacted in a single test sequence.

**Scenario enacted**:
1. Operator creates a `user` grant for `com.joyus.addon.advanced-pipelines` on `user:alice` via `GrantsService.create(...)` (not raw SQL — satisfies FR-015).
2. `getAllTools('user:alice')` returns the add-on tool (it was hidden before the grant).
3. `FeatureGate.assertEntitled({ subject_type: 'user', subject_id: 'alice' }, 'com.joyus.addon.advanced-pipelines')` resolves without throwing.
4. Operator revokes the grant via `GrantsService.revoke(...)`.
5. After cache invalidation fires, the same `assertEntitled` call throws `FeatureNotEntitledError`.
6. `getAllTools('user:alice')` no longer includes the add-on tool.

**Key assertions**:
- `GrantsService.create` result has `status: 'active'` and a non-null `id`.
- Tool visibility before grant: add-on tool absent from list; after grant: present; after revoke: absent again.
- `FeatureNotEntitledError.featureKey === 'com.joyus.addon.advanced-pipelines'`.
- The decision log contains both an `allow` row (post-grant) and a `deny` row (post-revoke) for subject `user:alice`.

**Files**:
- `tests/entitlements/integration/feature-gate.test.ts` (new, within the `describe('Individual licensing')` block)

**Validation**:
- [ ] Test passes with `vitest run`
- [ ] No raw DB inserts — only `GrantsService` API is used for the grant lifecycle
- [ ] Tool list assertions check both the add-on tool name and the absence of any core tool being affected

---

### T034 — Explicit deny returns structured upgrade error (SC-3)

**Purpose**: Prove that an unentitled gated call returns a machine-readable "upgrade required" payload — not an empty result, not a generic error — and that a decision row is appended to the audit log.

**Scenario enacted**:
1. Subject `user:bob` has no grants.
2. `FeatureGate.assertEntitled({ subject_type: 'user', subject_id: 'bob' }, 'com.joyus.addon.advanced-pipelines')` is called.
3. It throws `FeatureNotEntitledError`.
4. The MCP/API error-mapping layer (or a test shim that mimics it) converts the error to an "upgrade required" payload.

**Key assertions**:
- The thrown error is an instance of `FeatureNotEntitledError` (not a generic `Error`).
- `error.featureKey === 'com.joyus.addon.advanced-pipelines'`.
- `error.reason === 'not_entitled'` (or equivalent field from WP02 T013).
- The "upgrade required" payload is not empty and carries a `featureKey` field.
- After the call, querying `entitlement_decisions` for `subject_id: 'bob'` returns a row with `decision: 'deny'` and `reason: 'not_entitled'`.

**Files**:
- `tests/entitlements/integration/feature-gate.test.ts` (within `describe('Explicit deny')` block)

**Validation**:
- [ ] `expect(() => gate.assertEntitled(...)).rejects.toThrow(FeatureNotEntitledError)`
- [ ] Payload mapping produces a non-empty object with `featureKey` present
- [ ] Decision log mock is called with `decision: 'deny'`

---

### T035 — Fail closed on lapsed grants: resolver outage + expired grant (SC-6, FR-017)

**Purpose**: The single most important security test for grant-validity integrity. Proves that when the resolver is unreachable AND the only grant on file has `valid_until` in the past, the DB fallback denies — not grants. A naive content-fallback copy would serve the expired row (fail *open on a lapsed grant*); this test catches that bug before it ships.

**Representative skeleton** (inline — this test is load-bearing):

```typescript
describe('Fail closed on lapsed grants (SC-6 / FR-017)', () => {
  it('denies when resolver is down and the only DB grant is expired', async () => {
    const FEATURE = 'com.joyus.addon.advanced-pipelines';
    const subject: Subject = { subject_type: 'user', subject_id: 'user-expired' };

    // Resolver is unreachable
    const failingResolver = makeFailingResolver();

    // DB fallback returns one row — but it is expired
    const expiredGrant = makeGrant(FEATURE, {
      status: 'active',                          // status column still says 'active' (simulating a
      valid_until: new Date(Date.now() - 60_000), // grant that just lapsed — valid_until is in the past)
    });
    const mockDb = buildMockDbWithGrants([expiredGrant]);

    const cache = new EntitlementCache();
    const gate = new FeatureGate(failingResolver, cache, new NullMembershipResolver(), mockDb);

    // Assert: FeatureGate must deny, not grant
    await expect(
      gate.assertEntitled(subject, FEATURE)
    ).rejects.toThrow(FeatureNotEntitledError);

    // Assert: the decision recorded the exact reason
    const lastDecision = getLastDecisionLog(mockDb);
    expect(lastDecision.decision).toBe('deny');
    expect(lastDecision.reason).toBe('resolver_unavailable_fallback_deny');
    expect(lastDecision.feature_key).toBe(FEATURE);
    expect(lastDecision.subject_id).toBe('user-expired');
  });

  it('still serves a valid grant when resolver is down', async () => {
    const FEATURE = 'com.joyus.addon.advanced-pipelines';
    const subject: Subject = { subject_type: 'user', subject_id: 'user-valid' };

    const failingResolver = makeFailingResolver();

    // DB fallback returns a live grant
    const validGrant = makeGrant(FEATURE, {
      valid_until: new Date(Date.now() + 86_400_000), // expires tomorrow
    });
    const mockDb = buildMockDbWithGrants([validGrant]);

    const cache = new EntitlementCache();
    const gate = new FeatureGate(failingResolver, cache, new NullMembershipResolver(), mockDb);

    // Assert: gate allows — the valid fallback should serve
    const token: GateToken = await gate.assertEntitled(subject, FEATURE);
    expect(token).toBeDefined();

    const lastDecision = getLastDecisionLog(mockDb);
    expect(lastDecision.decision).toBe('allow');
    expect(lastDecision.resolved_from).toBe('db');
  });
});
```

**What `buildMockDbWithGrants` must do**: return a mock DB object whose `select(...).from(...).where(...)` chain returns only grants that pass the active + non-expired filter. Implement the mock so the WHERE predicate is applied in the mock (i.e., the mock checks `valid_until > now` before returning rows) — otherwise you are testing the mock, not the gate. Alternatively, mock the raw DB call to return the given rows unconditionally and rely on the gate's own filter; this also works but requires the gate to filter post-query. Either approach is valid; document which one the implementation uses.

**Files**:
- `tests/entitlements/integration/feature-gate.test.ts` (within `describe('Fail closed on lapsed grants')` block)

**Validation**:
- [ ] First test (`expired grant`) throws `FeatureNotEntitledError` with `reason: 'resolver_unavailable_fallback_deny'`
- [ ] Second test (`valid grant`) resolves with a `GateToken` and records `resolved_from: 'db'`
- [ ] Neither test makes a real network call or opens a real DB connection
- [ ] The mock resolver's `resolve` function is called and throws in both tests (confirming the outage path is exercised)

---

### T036 — Structural enforcement: second path and un-forgeable token (SC-5, FR-016)

**Purpose**: Proves that gated capabilities cannot be reached by any path other than a `FeatureGate`-minted `GateToken`. Two scenarios: (a) a gated pipeline step invoked without going through `tools/call` is still denied; (b) a hand-constructed entitlement/grant object cannot be passed to the gated step to bypass the gate.

**Representative skeleton** (inline — this test is load-bearing):

```typescript
describe('Structural enforcement — second path and un-forgeable token (SC-5 / FR-016)', () => {
  it('denies a gated pipeline step invoked via its registry (not tools/call)', async () => {
    const FEATURE = 'com.joyus.addon.advanced-pipelines';
    const subject: Subject = { subject_type: 'user', subject_id: 'user-noentitle' };

    // Subject has no grant
    const resolver = makeResolver([]); // empty feature set
    const gate = new FeatureGate(resolver, new EntitlementCache(), new NullMembershipResolver(), {} as never);

    // Invoke the gated pipeline step handler directly through the StepRegistry,
    // bypassing the tools/call path — the gate should still fire
    const stepRegistry = buildStepRegistryWithGatedStep(FEATURE, gate);

    await expect(
      stepRegistry.execute('advanced_pipeline_step', { subject }, {})
    ).rejects.toThrow(FeatureNotEntitledError);
  });

  it('rejects a hand-constructed grant object at the type boundary', () => {
    // This test is a compile-time / structural check.
    // The gated step handler's signature must require a GateToken, not a raw
    // FeatureEntitlement or boolean. Verify at the TypeScript level that
    // passing a fake object fails to type-check.
    //
    // At runtime: attempt to call a gated handler with a raw object where
    // the token parameter is expected — it must throw or fail.

    const fakeToken = { featureKey: 'com.joyus.addon.advanced-pipelines' }; // not a real GateToken

    // The gated step's call signature is: execute(token: GateToken, input: ...).
    // Passing fakeToken must either: (a) cause a TypeScript compile error (caught by T040),
    // or (b) throw at runtime because GateToken is branded/opaque and the gate validates it.
    expect(() => {
      // @ts-expect-error — deliberate: fakeToken is not a GateToken
      invokeGatedStepWithRawToken(fakeToken, {});
    }).toThrow();
  });
});
```

**Notes on implementation**:
- `buildStepRegistryWithGatedStep` is a test helper that creates a `StepRegistry` instance, registers a mock gated step that declares `requiresFeature: FEATURE`, and wires the provided `gate` at the call site.
- The `@ts-expect-error` approach for the type-boundary test means the test validates that the compile-time guard is in place. T040 (`npm run validate` including typecheck) will catch if this boundary is accidentally removed.
- If `GateToken` is implemented as a branded/opaque type (e.g., `declare const _brand: unique symbol; type GateToken = { [_brand]: true }`) rather than a class with runtime identity, the runtime portion of the second test may be a no-op at runtime. That is acceptable: the type-level guard is the enforcement mechanism. Document this explicitly in a test comment.

**Files**:
- `tests/entitlements/integration/feature-gate.test.ts` (within `describe('Structural enforcement')` block)

**Validation**:
- [ ] First test (second-path) throws `FeatureNotEntitledError` when invoked via the step registry
- [ ] Second test (un-forgeable token) either fails at typecheck (caught by T040) or throws at runtime
- [ ] No modification to the gated step's enforcement logic is made just to make the test pass — verify the step is genuinely gated in the registry

---

### T037 — Union resolution: individual pre-WP12, then membership-stub tenant grant (SC-2 seam, FR-019)

**Purpose**: Proves both halves of the FR-019 union. Pre-WP12: a user with only a `user:U` grant is entitled (the individual path works today with no tenant system). Post-WP12 seam: a `NullMembershipResolver` swapped for a stub that returns one tenant grants the user membership-based access — proving the seam Phase 1.5 depends on is correctly wired without requiring WP12 to exist.

**Representative skeleton** (inline — this test is load-bearing):

```typescript
describe('Union resolution — individual-first + membership seam (SC-2 / FR-019)', () => {
  const FEATURE = 'com.joyus.addon.advanced-pipelines';

  it('pre-WP12: individual user grant is sufficient with no org membership', async () => {
    const subject: Subject = { subject_type: 'user', subject_id: 'user-alice' };

    // Only a user grant; NullMembershipResolver returns []
    const resolver = makeResolver([FEATURE]);
    const gate = new FeatureGate(
      resolver,
      new EntitlementCache(),
      new NullMembershipResolver(),  // <-- the pre-WP12 state
      {} as never,
    );

    const token = await gate.assertEntitled(subject, FEATURE);
    expect(token).toBeDefined();
  });

  it('pre-WP12: user with no grant and no org membership is denied', async () => {
    const subject: Subject = { subject_type: 'user', subject_id: 'user-bob' };

    const resolver = makeResolver([]); // no grants
    const gate = new FeatureGate(resolver, new EntitlementCache(), new NullMembershipResolver(), {} as never);

    await expect(gate.assertEntitled(subject, FEATURE)).rejects.toThrow(FeatureNotEntitledError);
  });

  it('post-WP12 seam: tenant grant inherited by member via membership stub', async () => {
    // Swap NullMembershipResolver for a stub that says user-carol belongs to tenant-acme
    const membershipStub = {
      getMemberships: vi.fn().mockResolvedValue(['tenant-acme']),
    };

    // user-carol has no personal grant; tenant-acme has the feature grant
    const userResolver = makeResolver([]); // user:carol → no features
    const tenantResolver = makeResolver([FEATURE]); // tenant:acme → has the feature

    // The gate must union: effective = user grants ∪ tenant grants
    // Wire a gate that resolves both subjects and unions them
    const gate = new FeatureGate(
      buildUnionResolver(userResolver, tenantResolver),
      new EntitlementCache(),
      membershipStub,
      {} as never,
    );

    const subject: Subject = { subject_type: 'user', subject_id: 'user-carol' };
    const token = await gate.assertEntitled(subject, FEATURE);
    expect(token).toBeDefined();

    // Confirm the audit records which subject satisfied the allow
    const decision = getLastDecisionLog();
    expect(decision.decision).toBe('allow');
    // The allow came from the tenant subject, not the user subject directly
    expect(decision.resolved_subject_type).toBe('tenant');
    expect(decision.resolved_subject_id).toBe('tenant-acme');
  });

  it('removing membership revokes inherited access on next resolve', async () => {
    // After membership is revoked, the union no longer includes tenant-acme's grant
    const membershipStub = {
      getMemberships: vi.fn().mockResolvedValue([]), // membership removed
    };
    const tenantResolver = makeResolver([FEATURE]);
    const gate = new FeatureGate(
      buildUnionResolver(makeResolver([]), tenantResolver),
      new EntitlementCache(),
      membershipStub,
      {} as never,
    );

    const subject: Subject = { subject_type: 'user', subject_id: 'user-carol' };
    await expect(gate.assertEntitled(subject, FEATURE)).rejects.toThrow(FeatureNotEntitledError);
  });
});
```

**Note on `buildUnionResolver`**: this is a test helper (not production code) that routes `user:X` subjects to `userResolver` and `tenant:Y` subjects to `tenantResolver`. It simulates the per-subject resolution that `FeatureGate` performs internally during union. If the gate's production implementation already accepts a single resolver and derives per-subject resolution itself, this helper may be unnecessary — pass the single resolver and verify union behavior through the gate's public `assertEntitled` API alone.

**Files**:
- `tests/entitlements/integration/feature-gate.test.ts` (within `describe('Union resolution')` block)

**Validation**:
- [ ] All four tests pass
- [ ] `NullMembershipResolver` is imported from production code, not defined inline
- [ ] The membership-stub test confirms the `resolved_subject_type` in the decision log

---

### T038 — Content-path regression gate (SC-4, non-negotiable)

**Purpose**: Prove that the WP01 extraction of `EntitlementResolver`, `HttpEntitlementResolver`, and `EntitlementCache` into `src/entitlements/core/` did not break the content entitlement path. The existing test file is the gate.

**This test does not write new test code.** It runs the existing test suite:

```
tests/content/integration/entitlements.test.ts
```

and asserts all tests remain green. If any test in that file fails after WP01–WP05 land, this subtask is **blocked** — do not proceed to T039/T040 until it is resolved.

**Mechanism**:
- Run `npx vitest run tests/content/integration/entitlements.test.ts` in isolation.
- All 10 existing tests must pass (the 3 `describe` blocks in the file as of grounding: cache hit/miss, fail-closed fallback, search result filtering, generation citations, TTL/invalidation).
- If import paths changed in WP01 (e.g., `EntitlementCache` moved from `src/content/entitlements/cache.js` to `src/entitlements/core/cache.js`), the existing content test file must have been updated with re-exports that preserve the old import paths. If it was not, fix the re-exports — do not modify the test file's import paths.

**Files**:
- `tests/content/integration/entitlements.test.ts` (read-only; fix is in re-exports if needed)
- `src/content/entitlements/cache.ts` (re-export only if import was moved)
- `src/content/entitlements/index.ts` (re-export only if imports were moved)

**Validation**:
- [ ] `npx vitest run tests/content/integration/entitlements.test.ts` exits 0
- [ ] Test count matches pre-WP01 baseline (no tests silently dropped)
- [ ] Zero modifications to the test file itself

---

### T039 — Auditability: every allow/deny queryable per subject and per feature (SC-11)

**Purpose**: Prove that the `entitlement_decisions` table (FR-006) makes every gate decision queryable by (a) subject and (b) feature key, within the defined retention window.

**Scenario enacted**:
1. Run a sequence of four gate evaluations:
   - `user:alice` + `com.joyus.addon.advanced-pipelines` → allow (has grant)
   - `user:bob` + `com.joyus.addon.advanced-pipelines` → deny (no grant)
   - `user:alice` + `com.joyus.addon.some-other-feature` → deny (no grant for this feature)
   - `user:carol` + `com.joyus.addon.advanced-pipelines` → allow (has grant)
2. Query the decision log by subject `user:alice` — expect 2 rows (1 allow, 1 deny for different features).
3. Query by subject `user:bob` — expect 1 row (1 deny).
4. Query by feature `com.joyus.addon.advanced-pipelines` — expect 4 rows (2 allows, 2 denies including bob and the revoke from T033 if run in sequence — or just the 3 from this test if isolated).
5. Query by subject `user:alice` + feature `com.joyus.addon.advanced-pipelines` — expect exactly 1 allow row.

**Key assertions**:
- The mock decision logger's `logAllow` and `logDeny` calls (from WP02 T011) are invoked with the correct `subject`, `feature_key`, and `reason` arguments.
- A query helper over the mock log returns the expected subsets.
- Every row carries: `subject_type`, `subject_id`, `feature_key`, `decision`, `reason`, `resolved_from`, `created_at`.

**Files**:
- `tests/entitlements/integration/feature-gate.test.ts` (within `describe('Auditability')` block)

**Validation**:
- [ ] Per-subject query returns only that subject's decisions
- [ ] Per-feature query returns decisions across all subjects for that feature
- [ ] Combined subject+feature query returns exactly the expected rows
- [ ] Every logged row has all required fields populated (no `undefined` values)

---

### T040 — Validation sweep: `npm run validate`, zero regressions

**Purpose**: The integration gate. Runs the full project validation pipeline — typecheck, lint, and all tests — and asserts zero failures. This is the Definition of Done checkpoint for the entire Spec 015 Phase 1 work.

**Steps**:
1. From the `joyus-ai-mcp-server/` directory, run: `npm run validate`
2. The command runs: `npm run typecheck && npm run lint && npm test` (confirmed from `package.json`).
3. All three must exit 0.
4. Coverage thresholds must not regress (statements 59%, branches 74%, functions 67%, lines 59% — from `vitest.config.ts`).

**This subtask is a pure execution check — no new test code.** If it fails:
- Typecheck failures: fix the types, do not use `as any` or `@ts-ignore` unless the existing codebase already uses them in that location.
- Lint failures: fix the lint errors, do not disable rules.
- Test failures: diagnose root cause; if a pre-existing test is now failing, the cause is in WP01–WP05, not in this WP's test additions.
- Coverage regression: add targeted tests to the failing module; do not lower the thresholds.

**Files**:
- No new files. CI command only.

**Validation**:
- [ ] `npm run validate` exits 0
- [ ] Zero new TypeScript errors introduced by WP01–WP06
- [ ] Zero lint errors in `src/entitlements/` or any modified existing file
- [ ] All existing tests pass (T038 is a subset; this confirms the full suite)
- [ ] Coverage thresholds not regressed

---

## Definition of Done

- [ ] `tests/entitlements/integration/feature-gate.test.ts` exists and contains all T033–T039 test scenarios
- [ ] T033: individual grant/revoke lifecycle passes; tool visibility changes confirmed
- [ ] T034: `FeatureNotEntitledError` thrown with `featureKey` + `reason`; upgrade payload non-empty; decision logged
- [ ] T035: expired grant denied on outage; valid grant still served; reasons recorded correctly
- [ ] T036: gated pipeline step denied via second path; hand-constructed token rejected at type boundary
- [ ] T037: user grant alone is sufficient pre-WP12; membership stub adds tenant grant; membership removal revokes
- [ ] T038: `tests/content/integration/entitlements.test.ts` — all tests green, zero modifications to the file
- [ ] T039: allow/deny decisions queryable by subject, by feature, and by subject+feature
- [ ] T040: `npm run validate` exits 0 with no typecheck, lint, or test failures
- [ ] No real database connections in any test; all DB interactions use mocks
- [ ] All new test imports use `.js` extensions on local paths (ESM module requirement)
- [ ] Test file header comment follows the established convention (see `entitlements.test.ts` line 1–6)

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| T035 mock ambiguity: the mock DB returns expired rows and the gate is supposed to filter them — but if the mock applies the filter and the gate also applies it, the test proves nothing | High | Document clearly whether the mock returns raw rows (gate filters) or pre-filtered rows (mock filters). Pick one approach consistently and assert on the resolver's call trace to confirm the outage path was exercised. |
| T036 type-boundary test becomes a no-op if `GateToken` is a pure branded type with no runtime identity | Medium | Add a comment explaining that the type guard is the mechanism. Confirm in T040 that `@ts-expect-error` is caught by typecheck — if it is NOT caught, the branded type is not enforced and the WP03 guarantee is broken. |
| T037 union helper (`buildUnionResolver`) diverges from production union behavior | Medium | Prefer testing through `gate.assertEntitled` alone if the gate already handles subject-set resolution internally. Only introduce the helper if the gate requires you to pass per-subject resolvers explicitly. |
| T038 import path breakage after WP01 extraction | High | Run T038 immediately after WP01 lands, before WP02. If it breaks, fix re-exports before continuing. This is the earliest possible catch of the extraction regression. |
| Coverage regression: new `src/entitlements/` code is added but not covered by the new tests | Medium | Run `npm run test:coverage` after T033–T039 pass. If the thresholds fail, trace uncovered branches and add targeted tests. Do not lower thresholds. |
| `GateToken` not yet typed when this WP is implemented (WP03 dependency) | Low | If WP03 used `void` or `unknown` as a placeholder for `GateToken`, update the T035/T036 test assertions after the final type is confirmed. Do not write tests assuming a specific shape; use `expect(token).toBeDefined()` as the minimum. |

---

## Reviewer Guidance

- **T035 is the grant-validity test.** Review it with adversarial eyes: does the mock actually simulate an outage (resolver throws), and does the mock DB actually have an expired grant row? If either condition is not genuinely met, the test is a false positive. Check the mock resolver's call trace.
- **T036, first case**: confirm the gated step is invoked through the step registry's public `execute` method, not through a test-only back door. If the test calls the step handler directly (bypassing the registry), it does not prove structural enforcement.
- **T037, membership-stub case**: check that `resolved_subject_type: 'tenant'` appears in the decision log. If the decision log records the actor's `user:carol` subject instead of the satisfying `tenant:acme` subject, the audit is misleading — FR-006 requires the log to show which subject satisfied the allow.
- **T038**: verify the test count before and after. If a test was silently skipped due to an import error (Vitest sometimes skips rather than fails on bad imports), the count will drop. A dropped test is a hidden regression.
- **Imports**: every local import in the new test file must use the `.js` extension. Missing extensions cause silent failures in Vitest under `"type": "module"`. Check the first run's error output carefully if tests fail to collect.
- **No `as any`**: the existing test file (`entitlements.test.ts`) uses `{} as never` for the mock DB when DB is not exercised. Mirror this pattern. Do not use `as any` — it defeats the typecheck gate.
