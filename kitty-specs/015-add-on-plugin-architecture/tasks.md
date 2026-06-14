# Work Packages: Add-on Feature Entitlements — Phase 1 (Individual Path)
*Feature 015 — Phase 1 task decomposition*

**Scope**: Phase 1 only (individual subject; ships without WP12). Phase 1.5 (org inheritance) and Phase 2 (plugin host + SDK) are separate plans.
**Total**: 6 work packages, 40 subtasks
**Parallelization**: 5 layers — up to 2 WPs (WP03, WP04) run concurrently at peak
**Per-WP prompt files** (`tasks/WP0N-*.md`): not yet generated — say the word and I'll expand each WP into an implement-ready prompt.

## Dependency Graph

```
Layer 0: WP01 (core extraction + schema)
Layer 1: WP02 (FeatureGate decision core)            depends WP01
Layer 2: WP03 (un-forgeable enforcement) ┐ parallel  depends WP02
         WP04 (operator grant write path)┘ parallel  depends WP01, WP02
Layer 3: WP05 (tool-seam gating)                     depends WP02, WP03
Layer 4: WP06 (integration & validation)             depends all
```

---

## Subtask Index

| ID | Description | WP | Parallel |
|----|-------------|-----|----------|
| T001 | Extract `EntitlementResolver` iface + `HttpEntitlementResolver` + `EntitlementCache` to `src/entitlements/core/`; add re-exports in `src/content/entitlements/` | WP01 | |
| T002 | Add `responseMapping.featuresField` to `HttpEntitlementResolver` | WP01 | [P] |
| T003 | Create `entitlements` Drizzle schema — `feature_catalog`, `feature_entitlements`, `entitlement_decisions` (indexes, unique, partial-active) | WP01 | |
| T004 | Create `types.ts` — `Subject`, `FeatureKey`, `EffectiveEntitlement`, opaque `GateToken`, `GrantSource`, `GrantStatus` | WP01 | [P] |
| T005 | Create Zod validation (`validation.ts`) — grant create/modify/revoke, catalog entry | WP01 | [P] |
| T006 | Register schema in `drizzle.config.ts`; generate migration (`drizzle/00NN_entitlements_schema.sql`) | WP01 | |
| T007 | Verify typecheck + **existing content entitlement tests pass** (extraction regression gate) | WP01 | |
| T008 | `FeatureEntitlementResolver` — DB-leads, expiry-aware filter `active AND (valid_until IS NULL OR > now)` (FR-017) | WP02 | |
| T009 | `MembershipResolver` interface + `NullMembershipResolver` returning `[]` (pre-WP12 seam, FR-019) | WP02 | [P] |
| T010 | Subject-scoped cache wiring (key `subject_type:subject_id`; TTL capped to next expiry; explicit invalidate) — reuse `EntitlementCache` (FR-004/017/018) | WP02 | |
| T011 | `entitlement_decisions` append-only audit writer — `logAllow`/`logDeny` only (FR-006) | WP02 | [P] |
| T012 | `FeatureGate` — `isEntitled`/`assertEntitled`; effective **union** over `{user:U} ∪ membership`; order cache→resolver→DB-fallback→deny; expiry-aware fallback (FR-005/016/017/019) | WP02 | |
| T013 | `FeatureNotEntitledError` + structured "upgrade required" payload (402/403 + MCP error mapping) | WP02 | [P] |
| T014 | Unit tests — resolver expiry/fail-closed, union `{user}` pre-WP12, cache TTL/invalidate, audit, gate order | WP02 | |
| T015 | Define opaque `GateToken` — non-constructible outside `FeatureGate`, minted only by `assertEntitled` (FR-016) | WP03 | |
| T016 | Make gated entrypoints **require** a `GateToken`; forbid raw entitlement objects in the gated path (type-level) | WP03 | |
| T017 | **Enumerate** Phase-1 gated call sites — `content_`/`profile_`/`pipeline_` dispatch (`executor.ts:99-130`) + provider/step/connector invocation points; document the list | WP03 | [P] |
| T018 | Fix **or** quarantine the `content_search` synthetic-entitlement bypass (`content-executor.ts:223-231`) so it isn't a template | WP03 | [P] |
| T019 | Unit tests — hand-constructed entitlement object cannot reach a gated path; second-path gating | WP03 | |
| T020 | `GrantsService` — create/modify/revoke `feature_entitlements` (idempotent); write grant-history with **actor identity** (FR-015) | WP04 | |
| T021 | Catalog service — create/list `feature_catalog` entries (FR-001) | WP04 | [P] |
| T022 | Operator REST routes (admin-only) for grants + catalog | WP04 | |
| T023 | Admin-only MCP tools for grants + catalog (FR-015 surface) | WP04 | [P] |
| T024 | Authorization — operator/admin role **distinct from tenant users**; enforce on routes + tools | WP04 | |
| T025 | Cache invalidation on grant/revoke (hook into subject-cache) | WP04 | |
| T026 | Unit tests — authz, idempotency, audited writes, invalidation-on-change | WP04 | |
| T027 | `ownership.ts` — static add-on-tool → `feature_key` map (Phase 1; registry replaces it in Phase 2) | WP05 | [P] |
| T028 | `getAllTools()` — omit add-on-owned tools the subject's effective set lacks (FR-007); core/free tools untouched | WP05 | |
| T029 | `executeTool()` — `assertEntitled` (GateToken) before add-on tool dispatch; explicit upgrade error on deny (FR-007) | WP05 | |
| T030 | Provider/step/connector gating at the enumerated call sites — declare required `feature_key`, assert before invoke (FR-008) | WP05 | [P] |
| T031 | Module init (`entitlements/index.ts`) + mount admin routes / register admin tools in `src/index.ts` | WP05 | |
| T032 | Unit tests — core tools unaffected for everyone; add-on tools gated on both list + call | WP05 | |
| T033 | Integration — individual licensing: grant → `tools/list` shows → call works; revoke → denies within TTL (SC-1, SC-2a) | WP06 | [P] |
| T034 | Integration — explicit deny: unentitled gated call → upgrade-required (not empty), logged (SC-3) | WP06 | [P] |
| T035 | Integration — fail-closed on lapsed grants: resolver outage + expired grant → deny; valid grant still served (SC-6) | WP06 | [P] |
| T036 | Integration — structural enforcement: gated capability via a non-`tools/call` path denied; un-forgeable object (SC-5) | WP06 | [P] |
| T037 | Integration — union: returns `{user}` pre-WP12; membership-stub adds a tenant grant (SC-2 seam) | WP06 | [P] |
| T038 | Content path regression: existing entitlement + search tests green (SC reuse) | WP06 | [P] |
| T039 | Auditability — every allow/deny queryable per subject + per feature (SC-11) | WP06 | [P] |
| T040 | Validation sweep — `npm run validate` (typecheck + lint + test), zero regressions | WP06 | |

---

## Phase A: Foundation

### WP01 — Core Extraction & Entitlements Schema
**Priority**: P0 (blocks everything) | **Dependencies**: none | **Est. ~450 lines**

Extract the generic resolution machinery into `src/entitlements/core/` with re-exports preserved in `src/content/entitlements/`, then create the new `entitlements` schema, types, and validation. The extraction must leave the content path bit-for-bit behavioral.

**Subtasks**: T001–T007 (see index).

**Parallel opportunities**: T002, T004, T005 are independent of the extraction mechanics once T001 lands.
**Risks**: The extraction is the one place this plan touches existing code. Re-exports must keep `src/content/entitlements/` import paths valid; **T007 is a hard gate** — existing entitlement/search tests must stay green before anything else proceeds. Drizzle `pgSchema('entitlements')` needs `CREATE SCHEMA IF NOT EXISTS` in the migration (per the `content`/`profiles` precedent).

---

### WP02 — FeatureGate Decision Core
**Priority**: P0 (security core) | **Dependencies**: WP01 | **Est. ~550 lines**

The resolver, subject-scoped cache, decision audit, and the `FeatureGate` itself — including the effective-entitlement union (FR-019) with a `NullMembershipResolver` so Phase 1.5 activates org inheritance by swapping one class.

**Subtasks**: T008–T014.

**Parallel opportunities**: T009 (membership stub), T011 (audit), T013 (error type) are independent of the resolver/gate core.
**Risks**: Must mirror the existing **fail-closed** philosophy but with **explicit** deny — and the DB fallback must be **expiry-aware** (the content fallback is not; copying it ships a lapsed licensed feature on outage — FR-017). The union must take an **explicit subject** and never infer from `tenantId == userId`.

---

## Phase B: Enforcement & Write Path

### WP03 — Un-forgeable Gated-Path Enforcement
**Priority**: P0 (the security keystone) | **Dependencies**: WP02 | **Est. ~350 lines**

Make Phase 1 enforcement structural, not procedural: a `GateToken` only `FeatureGate` can mint, required by every gated entrypoint, with the call-site set enumerated and the existing synthetic-entitlement bypass closed.

**Subtasks**: T015–T019.

**Parallel opportunities**: T017 (enumerate) and T018 (quarantine the bypass) can run in parallel with the token typing (T015–T016).
**Risks**: This is the response to the live counterexample (`content-executor.ts:223`). The "forbid raw objects in the gated path" must be enforced at the **type** level, not by convention, or the FR-016 guarantee is theater. Closing `content_search`'s bypass must not regress content search — pair with WP06 T038.

---

### WP04 — Operator Grant Administration (write path)
**Priority**: P1 (creates grants — Scenario 1) | **Dependencies**: WP01, WP02 | **Est. ~450 lines**

The authorized surface to create/modify/revoke grants and manage the catalog — the thing that turns "enforceable" into "licensable."

**Subtasks**: T020–T026.

**Parallel opportunities**: Runs in parallel with WP03. T021 (catalog) and T023 (admin tools) are independent tracks.
**Risks**: Authorization is the crux — the grant role must be **distinct from tenant users** (a tenant user must never grant themselves). Every write audited with actor identity. Revoke must invalidate the subject cache (T025) or revocation appears not to take effect until TTL.

---

## Phase C: Seam Wiring & Validation

### WP05 — Tool-Seam Gating
**Priority**: P1 | **Dependencies**: WP02, WP03 | **Est. ~400 lines**

Wire entitlement gating into the tools seam (visibility + execution) and the provider/step/connector call sites, with the structured upgrade response. Phase 1 uses a static ownership map; Phase 2 replaces it with the registry.

**Subtasks**: T027–T032.

**Parallel opportunities**: T027 (ownership map) and T030 (provider/step/connector) are independent of the tool-list/exec changes.
**Risks**: Must touch **only add-on-owned** tools — core/free tools stay unaffected for everyone (a regression here breaks the free product). `getAllTools` already filters by connected service; layer the entitlement filter without disturbing that. All gated invocations go through a `GateToken` (WP03), not a raw check.

---

### WP06 — Integration & Validation
**Priority**: P1 | **Dependencies**: WP01–WP05 | **Est. ~500 lines**

End-to-end proof of the Phase 1 success criteria, the content-path regression gate, and the full validation sweep.

**Subtasks**: T033–T040.

**Parallel opportunities**: T033–T039 are independent test suites.
**Risks**: Integration tests need clock manipulation (expiry/TTL), a fake resolver (outage simulation), and an operator-role fixture. The union test (T037) must prove both the pre-WP12 `{user}` behavior **and** that a stubbed membership adds a tenant grant — that's the seam Phase 1.5 depends on. T038 is the non-negotiable regression gate.

---

## Dependency Graph

```
WP01 (Core Extraction & Schema)
  └──▶ WP02 (FeatureGate Decision Core)
         ├──▶ WP03 (Un-forgeable Enforcement) ──┐
         └──▶ WP04 (Operator Grant Write Path) ─┤   (WP03 ∥ WP04)
                                                 ▼
                                        WP05 (Tool-Seam Gating)
                                                 │
                                                 ▼
                                        WP06 (Integration & Validation)
```

**Parallelization**: After WP02, WP03 and WP04 run in parallel. WP05 needs WP02+WP03. WP06 needs everything.

## Summary

| WP | Title | Subtasks | Est. Lines | Priority |
|----|-------|----------|-----------|----------|
| WP01 | Core Extraction & Entitlements Schema | 7 (T001–T007) | ~450 | P0 |
| WP02 | FeatureGate Decision Core | 7 (T008–T014) | ~550 | P0 |
| WP03 | Un-forgeable Gated-Path Enforcement | 5 (T015–T019) | ~350 | P0 |
| WP04 | Operator Grant Administration | 7 (T020–T026) | ~450 | P1 |
| WP05 | Tool-Seam Gating | 6 (T027–T032) | ~400 | P1 |
| WP06 | Integration & Validation | 8 (T033–T040) | ~500 | P1 |

**Total**: 6 work packages, 40 subtasks
**MVP scope (the individual path)**: WP01 + WP02 + WP03 + WP04 + WP05 — schema + gate + un-forgeable enforcement + operator grant + tool gating = an operator can license an add-on to an individual and the gate shows/runs it for them, denies everyone else. WP06 hardens and proves it.
**Deferred by design**: org inheritance activation (Phase 1.5 / WP12), plugin host + SDK (Phase 2), seat-capping (§11.8), cross-instance invalidation bus (§11.5).
