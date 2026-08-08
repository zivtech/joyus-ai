---
work_package_id: "WP03"
title: "Un-forgeable Gated-Path Enforcement"
lane: "planned"
dependencies: ["WP02"]
subtasks: ["T015", "T016", "T017", "T018", "T019"]
history:
  - date: "2026-06-14"
    action: "created"
    agent: "claude-opus"
---

# WP03: Un-forgeable Gated-Path Enforcement

**Implementation command**: `spec-kitty implement WP03`
**Target repo**: `joyus-ai`
**Dependencies**: WP02 (FeatureGate Decision Core — mints GateToken)
**Priority**: P0 (Security keystone — without this, FR-016 is theater)

## Objective

Convert Phase 1 feature-gate enforcement from procedural (every call site remembers to check) to structural (a gated capability cannot be reached without passing through `FeatureGate.assertEntitled`). This is accomplished by introducing an opaque `GateToken` type that only `FeatureGate.assertEntitled` can mint, then making every gated entrypoint require one — making it a TypeScript compile error, not a review comment, to skip the gate. The existing `content_search` synthetic-entitlement bypass is the live counterexample this WP must close.

## Context

### The Live Counterexample

`src/tools/executors/content-executor.ts` lines 223–231 contain the pattern this WP exists to prevent:

```typescript
// BEFORE — the fabricated bypass (content-executor.ts:217-231)
const entitlements: ResolvedEntitlements = {
  productIds: tenantProducts.map((p) => p.id),
  sourceIds: [],
  profileIds: [],
  resolvedFrom: 'tool-executor',   // ← lies: no resolver was consulted
  resolvedAt: new Date(),
};
const results = await context.searchService.search(query, entitlements, { ... });
```

This constructs a `ResolvedEntitlements` object inline and passes it straight to `SearchService.search()`, bypassing `EntitlementService`, the resolver, the cache, and any future `FeatureGate` check entirely. The bug is invisible at review because there is no type-level constraint that makes the bypass wrong — it is merely inadvertent. FR-016 names this as the proof that procedural enforcement is insufficient.

### Procedural vs. Structural

**Procedural** enforcement: every author who adds a gated call site is supposed to remember to call `FeatureGate.assertEntitled` first. One forgotten call = a licensed feature ships for free. The content_search path is proof the convention breaks.

**Structural** enforcement: a gated service's public API *requires* a `GateToken` parameter that cannot be constructed anywhere except inside `FeatureGate.assertEntitled`. Forgetting the gate is a compile error, not a review gap. The TS type system enforces what the convention could not.

Phase 2 achieves structural enforcement via the plugin host wrapping every contribution. Phase 1 has no host — WP03 is the Phase 1 equivalent: a branded/non-constructible token that makes the gate impossible to skip at the type level.

---

## Subtasks

---

### T015: Define the opaque `GateToken` type

**Purpose**: Introduce a non-constructible branded type that only `FeatureGate.assertEntitled` (WP02) can produce. Nothing outside `src/entitlements/feature-gate.ts` can create a valid `GateToken`, so a gated entrypoint that requires one cannot be reached without passing through the gate.

**TypeScript technique — private-constructor class (recommended)**:

```typescript
// src/entitlements/gate-token.ts

/**
 * GateToken — an un-forgeable proof that FeatureGate.assertEntitled
 * was called and succeeded for a specific (subject, featureKey) pair.
 *
 * The constructor is private. The only way to obtain a GateToken is to
 * call FeatureGate.assertEntitled(), which mints one on success.
 *
 * A gated service method that requires a GateToken parameter cannot be
 * reached without going through FeatureGate — the TS compiler enforces
 * this, not code review.
 */
export class GateToken {
  /** The subject that was asserted (for audit/logging at the call site). */
  readonly subject: Subject;
  /** The feature key that was asserted. */
  readonly featureKey: FeatureKey;
  /** Timestamp the token was minted (for freshness checks if desired). */
  readonly mintedAt: Date;

  // Private constructor — only FeatureGate can call `new GateToken(...)`.
  // External code cannot import the constructor or use `new GateToken()`
  // because the constructor is not exported or accessible.
  private constructor(subject: Subject, featureKey: FeatureKey) {
    this.subject = subject;
    this.featureKey = featureKey;
    this.mintedAt = new Date();
  }

  /**
   * Module-private mint. Called only by FeatureGate.assertEntitled().
   * Not exported from this module — only FeatureGate imports it.
   *
   * Using a static factory method keeps the class cleanly non-constructible
   * externally while giving FeatureGate a single, explicit mint point.
   */
  static _mint(subject: Subject, featureKey: FeatureKey): GateToken {
    return new GateToken(subject, featureKey);
  }
}
```

**Why not a branded interface or `unique symbol`?**

A branded interface (`type GateToken = { readonly _brand: unique symbol }`) can be fabricated at runtime with a cast (`{} as GateToken`) and provides no structural guarantee. A `unique symbol` brand is structurally un-forgeable at the TS level but has no runtime identity (cannot be `instanceof` checked, carries no payload, cannot be logged). The private-constructor class is un-forgeable at both the TS type level (no public constructor) and runtime (`instanceof GateToken` can gate at runtime if needed), and it carries the subject/featureKey for audit logging at the call site without a separate lookup.

**`_mint` naming convention**: The leading underscore signals "do not call from outside the entitlements module." In Phase 2 when the plugin host takes over enforcement, `_mint` is removed and `GateToken` becomes purely internal to the host.

**Files**:
- `src/entitlements/gate-token.ts` (new, ~40 lines)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `new GateToken(...)` outside `feature-gate.ts` produces TS error: `Constructor of class 'GateToken' is private`
- [ ] `GateToken._mint(...)` called from a file that has not imported `_mint` produces TS error (the method is not on the exported type surface — verify this by checking whether `_mint` is accessible through the exported type)
- [ ] `instanceof GateToken` evaluates correctly at runtime in a test

**Edge Cases**:
- `GateToken._mint` is a static method on the class, so it IS accessible to any code that imports the class. To prevent external minting, either (a) do not export `_mint` from the module barrel (omit it from `src/entitlements/index.ts`) and have `FeatureGate` import directly from `gate-token.ts`; or (b) enforce via ESLint `no-restricted-imports` rule that only `feature-gate.ts` may import `gate-token.ts`. Document which approach is used.
- The token does not expire. If a long-running operation holds a token, there is no built-in revocation. This is acceptable for Phase 1 — a token is minted per-call, not cached.

---

### T016: Make every gated entrypoint require a `GateToken` parameter

**Purpose**: Change the type signature of every service or method that constitutes a "gated entrypoint" so that it accepts a `GateToken` as a required parameter. This is the mechanism that makes the TS compiler reject calls that bypass the gate.

**What a "gated entrypoint" is**: Any public API on a service that executes a capability declared as belonging to a licensed add-on feature. In Phase 1, these are the provider/step/connector invocation points (FR-008). The `executeTool()` path gates at a higher level (WP05), but the underlying service methods must also require a token so a second path cannot bypass them.

**Signature change pattern**:

```typescript
// BEFORE — no gate parameter
class SearchService {
  async search(
    query: string,
    entitlements: ResolvedEntitlements,
    options?: SearchOptions,
  ): Promise<SearchResult[]> { ... }
}

// AFTER — GateToken required for the gated path
// Option A: token on the gated method itself (simplest, most explicit)
class SearchService {
  async search(
    query: string,
    entitlements: ResolvedEntitlements,
    options?: SearchOptions,
    _gate?: GateToken,   // ← required for add-on-owned search providers
  ): Promise<SearchResult[]> { ... }
}

// Option B (preferred for cleaner separation): separate gated entry
class SearchService {
  /** Free-tier (core) search — no gate required */
  async searchCore(query: string, ...): Promise<SearchResult[]> { ... }

  /** Add-on search (e.g. semantic/vector) — GateToken required */
  async searchPremium(query: string, gate: GateToken, ...): Promise<SearchResult[]> { ... }
}
```

**Recommended approach**: For Phase 1, add `gate: GateToken` as a required parameter on the specific method variant that is being gated (not the core free method). This makes the gated/free split explicit in the type signature. Do not gate core/free methods — they must remain accessible to everyone (FR-007: "core tools are unaffected").

**For `GenerationService.generate()` specifically** (the provider invocation point at `src/content/generation/index.ts:44`):

```typescript
// AFTER
async generate(
  query: string,
  userId: string,
  tenantId: string,
  entitlements: ResolvedEntitlements,
  gate: GateToken,         // ← required; proves assertEntitled was called
  options?: GenerateOptions,
): Promise<GenerationResult> { ... }
```

**For Inngest step handler execution** (`src/inngest/adapter.ts:64`): The `PipelineStepHandlerAdapter.run()` is the step invocation point. For gated step types, the `ExecutionContext` passed to `handler.execute(config, context)` should carry a `gate: GateToken` field so the handler can require it:

```typescript
// src/pipelines/types.ts — extend ExecutionContext
export interface ExecutionContext {
  tenantId: string;
  // ... existing fields ...
  gate?: GateToken;   // present if this step is gated; undefined for free steps
}
```

Gated step handlers validate `context.gate instanceof GateToken` at the top of `execute()`.

**Files**:
- `src/content/generation/index.ts` — add `gate: GateToken` to `GenerationService.generate()`
- `src/pipelines/types.ts` — extend `ExecutionContext` with optional `gate?: GateToken`
- `src/pipelines/steps/interface.ts` — update `PipelineStepHandler.execute()` documentation
- Any connector interface files that declare a gated `connect()` or `fetch()` (see T017 for the enumerated list)

**Validation**:
- [ ] `tsc --noEmit` passes with zero errors after signature changes
- [ ] Any existing call to a gated method that does not pass a `GateToken` becomes a TS error — confirm by temporarily removing `gate` from one existing call and verifying the error fires
- [ ] Free/core methods (those not gated) do not require a `GateToken`
- [ ] Existing tests that call gated methods need to be updated to pass a fabricated test token — add a `GateToken._mint(testSubject, testFeatureKey)` test helper exported from a `test/helpers/gate-token.ts` fixture

**Edge Cases**:
- Do not add `GateToken` to the `ResolvedEntitlements` type (WP01 owns that type). The token is a separate, orthogonal proof-of-gate.
- Some services are already fully internal to a call chain that is always gated at the top (e.g. a connector called only from `GenerationService`). Adding the token to the inner service is belt-and-suspenders. Do it anyway — a future refactor could expose the inner path.

---

### T017: Enumerate Phase-1 gated call sites

**Purpose**: Produce a complete, auditable list of every call site that must require a `GateToken` in Phase 1. Derived from the actual codebase — not inferred from the spec alone.

**Derivation method**: Start from `executeTool()` in `src/tools/executor.ts` and trace every non-OAuth dispatch branch, then follow each executor to the service invocation point. Also trace the Inngest pipeline execution path.

**Enumerated Phase-1 gated call sites**:

| # | Call site | File | Lines | Notes |
|---|-----------|------|-------|-------|
| 1 | `content_` tool dispatch → `executeContentTool()` | `src/tools/executor.ts` | 103–110 | Dispatches all `content_*` tools; `content_search` is the live bypass case |
| 2 | `executeContentTool` → `context.searchService.search()` | `src/tools/executors/content-executor.ts` | 231 | The gated SearchService invocation; currently bypassed (see T018) |
| 3 | `profile_` tool dispatch → `executeProfileTool()` | `src/tools/executor.ts` | 113–116 | Dispatches all `profile_*` tools; profile capabilities may be gated add-ons |
| 4 | `pipeline_` tool dispatch → `executePipelineTool()` | `src/tools/executor.ts` | 118–129 | Dispatches all `pipeline_*` tools; advanced pipeline features may be gated |
| 5 | OAuth-prefix dispatch (jira_, slack_, github_, gmail_, drive_, docs_) | `src/tools/executor.ts` | 133–181 | OAuth tools are currently all free/core; no gate needed in Phase 1, but enumerated so a future add-on OAuth tool has a named insertion point |
| 6 | `GenerationService.generate()` — provider invocation | `src/content/generation/index.ts` | 44–60 | Calls `this.generator.generate()` → `this.provider.generate()`; gated if the provider is a premium add-on |
| 7 | `ContentGenerator.generate()` → `provider.generate()` | `src/content/generation/generator.ts` | 27–31 | The actual `GenerationProvider` call; `PlaceholderGenerationProvider` is free, an add-on provider is gated |
| 8 | Inngest adapter → `handler.execute()` | `src/inngest/adapter.ts` | 64 | Wraps `PipelineStepHandler.execute()` inside `step.run()`; gated step types need `GateToken` in `ExecutionContext` |
| 9 | `content-audit-pipeline` → `registry.getHandler()` + `.execute()` | `src/inngest/functions/content-audit-pipeline.ts` | 76, 101, 181 | Three step invocations: `fidelity_check`, `content_generation`, `notification` |
| 10 | `regulatory-change-monitor-pipeline` → `registry.getHandler()` + `.execute()` | `src/inngest/functions/regulatory-change-monitor-pipeline.ts` | 77, 102, 182 | Three step invocations: `source_query`, `content_generation`, `notification` |
| 11 | `manual-trigger-pipeline` → `registry.getHandler()` + `.execute()` | `src/inngest/functions/manual-trigger-pipeline.ts` | 284 | Generic step execution loop over pipeline steps |
| 12 | `ConnectorRegistry.getOrThrow()` → connector use | `src/content/connectors/registry.ts` | 21–27 | Connector fetch; a premium connector type (e.g. a proprietary data source) requires a gate before the `getOrThrow` call |
| 13 | `StepRegistry.getHandler()` → step execution | `src/pipelines/steps/registry.ts` | 24 | Step lookup; gate check goes in the caller (Inngest function) before calling `adapter.run()` |

**Phase-1 gating scope** (which of the above are actually gated vs. free in Phase 1):

For Phase 1 with in-tree add-ons only, the **ownership map** (WP05/T027) determines which tool prefixes and step types belong to licensed features. Call sites 1–4 and 6–11 gate only when the dispatched tool/step/provider declares a `feature_key`. Call sites 5 (OAuth tools) and 12–13 are currently all free-tier; gate logic is a no-op until a premium connector or step type is registered with a `feature_key`.

**What this enumeration is for**: A reviewer completing WP03 checks this list against the implementation to verify that every non-free invocation point either (a) requires a `GateToken` parameter, or (b) is documented as explicitly free/core for Phase 1 with the reason stated.

**Files**:
- This document (the enumeration is the artifact; no code changes in T017 itself)
- `src/entitlements/gated-call-sites.ts` (new, ~30 lines) — a comment-only registry of the Phase-1 gated call sites, used by the reviewer and referenced in tests

**Validation**:
- [ ] Every non-free call site in the table above either requires a `GateToken` at the type level (after T016) or is explicitly documented as free-tier in `gated-call-sites.ts`
- [ ] The Inngest pipeline invocation points (rows 8–11) are covered — either via `ExecutionContext.gate` or via the Inngest function checking entitlement before calling `adapter.run()`
- [ ] A reviewer can trace from any tool name dispatched in `executor.ts` to its ultimate service invocation and find a `GateToken` checkpoint without gaps

**Edge Cases**:
- The `ops_` prefix (dispatch at `executor.ts:99`) routes to `executeOpsTool`. Ops tools are platform-internal (health checks, diagnostics); they do not carry a subject and are never gated. Document this explicitly in `gated-call-sites.ts`.
- `content_resolve_entitlements` (content-executor.ts line 357) is a diagnostic tool for viewing the user's content entitlements — not an add-on feature. Free, not gated.
- `content_generate` (content-executor.ts line 428) currently returns a placeholder and notes "GenerationService available in WP12." When `GenerationService` is fully wired, call site 6 activates. The GateToken signature on `GenerationService.generate()` (added in T016) ensures the gate is already in place when that happens.

---

### T018: Fix or quarantine the `content_search` synthetic-entitlement bypass

**Purpose**: The `content_search` case in `content-executor.ts:210–254` fabricates a `ResolvedEntitlements` object and passes it directly to `SearchService.search()`, bypassing the resolver, cache, and any `FeatureGate` check. This must be fixed (route through real entitlement resolution) or explicitly quarantined so it cannot be copied as a template.

**The live bypass — exact code**:

```typescript
// BEFORE: content-executor.ts:217-231 — the fabricated bypass
case 'content_search': {
  // ...
  if (context.searchService) {
    const tenantProducts = await db
      .select({ id: contentProducts.id })
      .from(contentProducts)
      .where(and(eq(contentProducts.tenantId, tenantId), eq(contentProducts.isActive, true)));

    // ← THIS IS THE BYPASS: a ResolvedEntitlements object is constructed
    //   from a raw DB query with no resolver, no cache, no FeatureGate.
    const entitlements: ResolvedEntitlements = {
      productIds: tenantProducts.map((p) => p.id),
      sourceIds: [],
      profileIds: [],
      resolvedFrom: 'tool-executor',   // ← not honest: no resolver ran
      resolvedAt: new Date(),
    };

    const results = await context.searchService.search(query, entitlements, { ... });
    // ...
  }
}
```

**Fix path (preferred)**: Route through `EntitlementService` (the content entitlement resolver, which already exists in `src/content/entitlements/`). The content entitlement system gates *data access* (which products/sources a session may query), not feature licensing — so this fix is about making the content gate honest, not about adding a feature gate. The `FeatureGate` for the `content_search` *tool itself* is a separate concern (WP05), applied at the tool dispatch level.

```typescript
// AFTER: content-executor.ts — route through EntitlementService
case 'content_search': {
  if (context.searchService) {
    // Resolve content entitlements via EntitlementService (cache → resolver → DB)
    // rather than fabricating them from a raw product query.
    // EntitlementService is injected into ContentExecutorContext (add to T016/WP05).
    const entitlements = await context.entitlementService.resolve(userId, tenantId);

    const results = await context.searchService.search(query, entitlements, {
      limit,
      offset,
      sourceId: sourceIds?.[0],
    });
    // ... rest unchanged
  }
}
```

This requires adding `entitlementService: EntitlementService` to `ContentExecutorContext` (currently defined at `content-executor.ts:21-26`) and injecting it at the call site in `executor.ts:105-110`.

**Quarantine path (if the fix creates too much coupling before WP05)**: If wiring `EntitlementService` into `ContentExecutorContext` is deferred to WP05, add a prominent quarantine comment and a lint/TODO marker so the pattern is not repeated:

```typescript
// QUARANTINE: This constructs a ResolvedEntitlements object directly from a DB
// query, bypassing EntitlementService, the resolver, and any FeatureGate.
// This is a KNOWN BYPASS documented in Spec 015 FR-016. It exists because
// EntitlementService is not yet wired into ContentExecutorContext (WP05 fixes this).
// DO NOT COPY THIS PATTERN. All new code must go through EntitlementService.
// Tracked: Spec 015 WP03 T018 / WP05 T030.
// eslint-disable-next-line joyus/no-synthetic-entitlements
const entitlements: ResolvedEntitlements = { ... };
```

Add a custom ESLint rule `joyus/no-synthetic-entitlements` that flags inline `ResolvedEntitlements` construction outside of `entitlement*.ts` files. This converts the quarantine into a lint error if anyone copies the pattern.

**Decision**: Fix is preferred if WP05 context injection can be done in the same PR as WP03 (they are adjacent in the dependency graph). Quarantine if WP03 must ship before WP05. Either way, the bypass must not survive un-marked.

**Files**:
- `src/tools/executors/content-executor.ts` — fix or quarantine (lines 217–231)
- `src/tools/executors/content-executor.ts` — add `entitlementService?: EntitlementService` to `ContentExecutorContext` (if fixing)
- `src/tools/executor.ts` — inject `entitlementService` into the `content_` dispatch (lines 103–110, if fixing)
- `eslint-rules/no-synthetic-entitlements.js` (new, ~30 lines, if quarantining)

**Validation**:
- [ ] The fabricated `ResolvedEntitlements` literal at content-executor.ts:223 is either gone (replaced by an `EntitlementService.resolve()` call) or surrounded by a quarantine comment + lint suppression with an explicit tracking reference
- [ ] If fixed: `content_search` passes its integration test with a real (or test-doubled) `EntitlementService`
- [ ] If quarantined: the ESLint rule fires when an inline `ResolvedEntitlements` literal is added to any non-entitlement file
- [ ] No regression: `content_search` still returns results for an entitled user (WP06 T038)

**Edge Cases**:
- The SearchService path (`context.searchService`) and the fallback LIKE-search path (lines 256–312) both serve `content_search`. Only the SearchService path has the bypass — the LIKE-search fallback queries `contentSources` directly (no `ResolvedEntitlements` object). The fix/quarantine applies only to the SearchService branch.
- `resolvedFrom: 'tool-executor'` in the bypassed code is semantically misleading — it implies the tool executor is a valid resolver origin, which it is not. The fixed version will show `resolvedFrom: 'db'` or `'cache'` from the real EntitlementService.

---

### T019: Unit tests — structural enforcement proof

**Purpose**: Prove, in code, that the GateToken mechanism enforces the FR-016 guarantee: (1) a hand-constructed entitlement object cannot reach a gated path, and (2) a gated capability invoked via a second path (not `tools/call`) is still denied.

**Test 1: Compile-time enforcement (TypeScript)**

This is tested by `tsc --noEmit` as part of the build — not a vitest unit test. Create a file in `test/type-tests/` that attempts to call a gated method without a `GateToken` and verify tsc rejects it:

```typescript
// test/type-tests/gate-token-forgery.ts
// This file must NOT compile. Run: tsc --noEmit test/type-tests/gate-token-forgery.ts
// Expected: error TS2345 or TS2554 on each line marked @ts-expect-error

import { GenerationService } from '../../src/content/generation/index.js';
import type { ResolvedEntitlements } from '../../src/content/types.js';

declare const svc: GenerationService;
declare const ent: ResolvedEntitlements;

// @ts-expect-error GateToken missing — must be a compile error
await svc.generate('query', 'user1', 'tenant1', ent);

// Attempting to forge a GateToken with a plain object:
// @ts-expect-error plain object is not GateToken
await svc.generate('query', 'user1', 'tenant1', ent, {} as never);
```

This test passes if `tsc --noEmit` exits with errors on the `@ts-expect-error` lines (meaning the errors ARE present, which is what we want). If tsc does NOT error, the `@ts-expect-error` suppressions themselves become errors — proving the test is self-enforcing.

**Test 2: Runtime — fabricated object cannot satisfy GateToken**

```typescript
// test/unit/entitlements/gate-token.test.ts
import { describe, it, expect } from 'vitest';
import { GateToken } from '../../../src/entitlements/gate-token.js';
import type { Subject, FeatureKey } from '../../../src/entitlements/types.js';

describe('GateToken', () => {
  const subject: Subject = { subject_type: 'user', subject_id: 'user-123' };
  const featureKey: FeatureKey = 'com.joyus.addon.advanced-search';

  it('cannot be constructed with new outside FeatureGate', () => {
    // TypeScript prevents this at compile time, but verify at runtime too:
    // @ts-expect-error testing private constructor
    expect(() => new GateToken(subject, featureKey)).toThrow();
    // OR: if TS catches it at compile time, this test simply documents the intent.
  });

  it('_mint produces a valid GateToken', () => {
    const token = GateToken._mint(subject, featureKey);
    expect(token).toBeInstanceOf(GateToken);
    expect(token.subject).toEqual(subject);
    expect(token.featureKey).toBe(featureKey);
    expect(token.mintedAt).toBeInstanceOf(Date);
  });

  it('instanceof check distinguishes a real token from a plain object', () => {
    const fake = { subject, featureKey, mintedAt: new Date() };
    const real = GateToken._mint(subject, featureKey);
    expect(real instanceof GateToken).toBe(true);
    expect(fake instanceof GateToken).toBe(false);
  });
});
```

**Test 3: Runtime — second-path gating (the FR-016 structural guarantee)**

This test proves that a gated capability reached via a path OTHER than `tools/call` (e.g. directly calling `GenerationService.generate()` from an Inngest pipeline step) is still denied if no valid `GateToken` is provided.

```typescript
// test/unit/entitlements/structural-enforcement.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GenerationService } from '../../../src/content/generation/index.js';
import { GateToken } from '../../../src/entitlements/gate-token.js';

describe('Structural gate enforcement', () => {
  it('denies GenerationService.generate() when called without a GateToken', async () => {
    const mockSearchService = { search: vi.fn() };
    const mockProvider = { generate: vi.fn() };
    const mockDb = {} as never;
    const svc = new GenerationService(mockSearchService as never, mockProvider, mockDb);

    const subject = { subject_type: 'user' as const, subject_id: 'user-abc' };
    const entitlements = { productIds: [], sourceIds: [], profileIds: [],
      resolvedFrom: 'test', resolvedAt: new Date() };

    // TypeScript prevents this call from even compiling without a GateToken.
    // At runtime, if somehow reached (e.g. via `any` cast), the service must
    // detect the missing/invalid token and throw.
    await expect(
      // @ts-expect-error deliberate missing GateToken
      svc.generate('query', 'user-abc', 'tenant-abc', entitlements)
    ).rejects.toThrow(/GateToken required/);
  });

  it('allows GenerationService.generate() with a valid GateToken', async () => {
    // ... normal success path with GateToken._mint(subject, featureKey)
    // ... verify mockProvider.generate was called
  });

  it('rejects a plain-object forgery even if TypeScript is bypassed', async () => {
    // Simulate `any`-cast forgery at runtime:
    const forgery = { subject: {}, featureKey: 'x', mintedAt: new Date() };
    await expect(
      (svc.generate as Function)('q', 'u', 't', entitlements, forgery)
    ).rejects.toThrow(/GateToken required/);
  });
});
```

**Runtime guard in gated methods**: For the runtime tests to pass, gated service methods must include an explicit runtime check alongside the TS type:

```typescript
// Inside GenerationService.generate() — the runtime guard
async generate(
  query: string,
  userId: string,
  tenantId: string,
  entitlements: ResolvedEntitlements,
  gate: GateToken,
  options?: GenerateOptions,
): Promise<GenerationResult> {
  // Runtime enforcement (defends against `any`-cast bypasses):
  if (!(gate instanceof GateToken)) {
    throw new Error('GateToken required — call FeatureGate.assertEntitled() first');
  }
  // ... rest of implementation
}
```

**Files**:
- `test/type-tests/gate-token-forgery.ts` (new, ~20 lines) — compile-time proof
- `test/unit/entitlements/gate-token.test.ts` (new, ~40 lines)
- `test/unit/entitlements/structural-enforcement.test.ts` (new, ~60 lines)

**Validation**:
- [ ] `tsc --noEmit test/type-tests/gate-token-forgery.ts` exits with errors (proving the type constraint is real)
- [ ] `vitest run test/unit/entitlements/gate-token.test.ts` passes
- [ ] `vitest run test/unit/entitlements/structural-enforcement.test.ts` passes
- [ ] The "second path" test (calling `GenerationService.generate()` directly, not via `executeTool`) proves the gate holds even outside the MCP dispatch path

**Edge Cases**:
- `GateToken._mint` is accessible to tests since tests import directly from `gate-token.ts`. This is intentional — tests need a way to create valid tokens to exercise the success paths. Do not prevent tests from minting tokens.
- The compile-time type test and the runtime vitest tests are complementary, not redundant: the type test proves TS rejects forgeries; the runtime test proves `any`-cast bypasses are caught at runtime.

---

## Definition of Done

- [ ] `src/entitlements/gate-token.ts` — `GateToken` class with private constructor, `_mint()`, `subject`, `featureKey`, `mintedAt` fields
- [ ] `GateToken._mint()` is called only from `FeatureGate.assertEntitled()` (WP02) — enforced by lint rule or module structure
- [ ] Every Phase-1 gated entrypoint listed in T017 requires a `GateToken` at the type level (TS error without one) AND validates `instanceof GateToken` at runtime
- [ ] `src/entitlements/gated-call-sites.ts` — comment registry of the 13 enumerated call sites with free/gated classification
- [ ] `content-executor.ts:223-231` — either fixed (routes through `EntitlementService`) or explicitly quarantined with a lint rule preventing copy-paste
- [ ] `test/type-tests/gate-token-forgery.ts` — tsc rejects forgery attempts
- [ ] `test/unit/entitlements/gate-token.test.ts` — runtime token behavior confirmed
- [ ] `test/unit/entitlements/structural-enforcement.test.ts` — second-path denial confirmed
- [ ] `npm run validate` (typecheck + lint + test) exits 0 with no regressions

---

## Risks

- **`_mint` accessibility**: The static `_mint` method is accessible to any importer of `gate-token.ts`. If the ESLint rule or module-structure restriction is not implemented, nothing mechanically prevents misuse. Decide and document the enforcement approach in the PR.
- **`any`-cast bypasses**: TypeScript's structural guarantee only holds for correctly-typed code. A `as any` cast can bypass the type check at the callsite. The runtime `instanceof` guard (T019) is the defense against this; do not omit it.
- **content_search regression**: Fixing the bypass (T018) changes how `content_search` resolves its entitlements. If `EntitlementService` is not injected correctly, `content_search` will break for all users. WP06 T038 is the regression gate — do not close WP03 until T038 passes.
- **Inngest step gate coverage**: Steps invoked via the Inngest adapter (call sites 8–11) run asynchronously, possibly after the original `executeTool()` call has returned. The `GateToken` passed through `ExecutionContext` was minted at dispatch time, not at execution time. If a grant is revoked between dispatch and execution, the token is stale. For Phase 1 this is acceptable (document the staleness window = Inngest retry delay + execution time); the per-call gate check in WP05 is the primary enforcement for synchronous paths.
- **Phase 2 migration**: When the plugin host (Phase 2) takes over enforcement, `GateToken._mint` should be removed or made truly inaccessible (no longer needed since the host wraps contributions). Annotate the token with a `// TODO(Phase-2): remove _mint when plugin host gates contributions` comment.

---

## Reviewer Guidance

The single question to answer when reviewing this WP: **Can a gated capability be reached without a `GateToken` minted by `FeatureGate.assertEntitled()`?**

Trace each of the 13 call sites in T017 and answer yes or no:
- If yes — it is a gap; request a fix before merging.
- If no — verify the `instanceof GateToken` runtime guard is present, not just the TypeScript type.

Specific checks:
1. `GateToken` constructor is `private` — verify by attempting `new GateToken(...)` in a test file and confirming the TS error.
2. `_mint` is only called from `src/entitlements/feature-gate.ts` — grep the codebase for `_mint(` and verify no other caller exists.
3. `content-executor.ts:223` — verify the fabricated literal is gone or quarantined with a lint suppression and a tracking comment. A bare `resolvedFrom: 'tool-executor'` in a `ResolvedEntitlements` literal is the tell.
4. The Inngest execution path (call sites 8–11) — confirm that `ExecutionContext.gate` is set before `adapter.run()` is called in each Inngest function, and that gated step handlers check `context.gate instanceof GateToken`.
5. `structural-enforcement.test.ts` — the "second path" test is the structural proof that FR-016 requires. Verify it calls `GenerationService.generate()` directly (not via `executeTool`), not just the MCP dispatch path.
