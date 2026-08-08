# Implementation Plan: Add-on Feature Entitlements — Phase 1 (Individual Path)

**Branch**: `015-add-on-plugin-architecture` | **Date**: 2026-06-14 | **Spec**: [spec.md](spec.md)
**Input**: `spec/015-add-on-plugin-architecture/spec.md` (FRs), [data-model.md](data-model.md), [research.md](research.md)
**Scope of THIS plan**: **Phase 1 only — the individual path that ships without WP12.** Phase 1.5 (org seat-licensing via membership inheritance) and Phase 2 (plugin host + SDK) are explicitly out of scope here and get their own plans.

---

## Summary

Build the feature-entitlement layer and gate that turns the open core into a licensable surface — for **individual subjects**, with no tenant system and no package split. Reuse the existing entitlement *resolution machinery* (`EntitlementResolver`, `HttpEntitlementResolver`, `EntitlementCache`) by extracting it to a shared `src/entitlements/core/`, then build a new persistent, explicit-deny system on top: three tables in a new `entitlements` PostgreSQL schema, a `FeatureGate` with structural (un-forgeable) enforcement, an operator grant-write path, and entitlement gating wired into the tools seam. The effective-entitlement **union (FR-019)** is built now with a `NullMembershipResolver` (returns `[]` pre-WP12), so Phase 1.5 activates org inheritance by swapping one implementation — no redesign.

What this unblocks: an individual ("looking for answers") licenses an add-on for their own account; the gate shows and runs it for them and denies everyone else with an explicit "upgrade required."

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20 LTS
**Primary Dependencies**: Express.js, Drizzle ORM, Zod, `@paralleldrive/cuid2` — no new deps
**Storage**: PostgreSQL 16 — new `entitlements` pgSchema (follows the `content`/`profiles` schema pattern)
**Testing**: Vitest (unit + integration), existing infrastructure
**Target Platform**: Linux server (Docker), same deployment as the rest of `joyus-ai-mcp-server`
**Project Type**: Platform module within `joyus-ai-mcp-server` (single package — no monorepo split in Phase 1)
**Performance Goals**: < 5ms gate cache hit p95; < 500ms cold resolve p95; < 10ms `tools/list` entitlement filter for ≤ 50 catalog entries
**Constraints**: Reuse content entitlement machinery (no rewrite); no package extraction; **individual subject only** (`subject_type=user`, `tenantId == userId`); fail closed on access *and* lapsed grants
**Scale/Scope**: Phase 1 is the entitlement layer + tool-seam gating + operator grant path. ~6 work packages.

## Constitution Check

*GATE: must pass before implementation. Re-check after Phase A.*

| Principle | Status | Notes |
|-----------|--------|-------|
| 2.1 Multi-Tenant from Day One | **CONDITIONAL** | Phase 1 operates on **individual subjects** (`tenantId == userId` interim). The schema (`subject_type`) and union resolver (FR-019) are multi-tenant-ready; org-scoped entitlement activates at WP12 (Phase 1.5). Not a violation — a sequenced, declared boundary. The gate takes an *explicit* subject and never infers from the collapse. |
| 2.2 Skills as Guardrails | **PASS** | Entitlement is a guardrail: add-on capability is gated, default-deny, enforced in trusted core (FR-016). Operator grant action exposed as an admin-only MCP tool with explicit authz (FR-015). |
| 2.3 Sandbox by Default | **PASS (Phase 1)** | Default-deny everywhere; absence/expiry/resolver-failure denies. *(In-process add-on sandboxing is a Phase 2 concern — flagged, not in scope.)* |
| 2.4 Monitor Everything | **PASS** | Every allow/deny appended to `entitlement_decisions` (append-only, FR-006); grant/revoke audited with actor identity (FR-015). |
| 2.5 Feedback Loops | **PASS** | Deny carries a structured "upgrade required" signal (FR-005) — the conversion loop. Decision log feeds conversion analytics. |
| 3.2 Data Governance | **PASS** | Decision log append-only. Grant writes are authorized + audited. No new PII; `feature_entitlements` holds keys + windows, not content. |
| 5.1 Technology Choices | **PASS** | Express + Drizzle + PostgreSQL + Zod — existing stack. **Reuses** existing entitlement machinery (extracted to shared `core/`), no new deps. |
| 5.2 Cost Awareness | **PASS** | In-process cache (reused class), no external cache service in Phase 1. DB fallback is a single indexed query (partial index on active grants). Cross-instance pub/sub deferred pending the revocation-SLA decision (§11.5). |
| 5.3 Reliability | **PASS** | Fail-closed on resolver outage (DB fallback → deny), expiry-aware so a lapsed grant is never served (FR-017). Content path untouched (additive + extraction with re-exports). |

**One open gate item:** principle 2.1 is CONDITIONAL by design — Phase 1 is individual-scoped. Confirm this is an accepted, declared boundary (it is the whole point of the individual-first sequencing) before starting.

## Project Structure

### Documentation (this feature)

```
spec/015-add-on-plugin-architecture/
├── spec.md              # Feature specification (19 FRs, 2 layers, 3 phases)
├── data-model.md        # entitlements schema + query/write rules
├── research.md          # Code grounding (file:line evidence)
├── plan.md              # This file — Phase 1 (individual path)
├── tasks.md             # Phase 1 work-package decomposition
└── meta.json
```

### Source Code (in joyus-ai-mcp-server)

```
src/
├── entitlements/                     # NEW platform-level module
│   ├── core/                         # EXTRACTED shared machinery (was src/content/entitlements/*)
│   │   ├── resolver.interface.ts     #   EntitlementResolver, ResolverContext, *Config
│   │   ├── http-resolver.ts          #   HttpEntitlementResolver (+ responseMapping.featuresField)
│   │   ├── cache.ts                  #   EntitlementCache (key-generic)
│   │   └── index.ts
│   ├── schema.ts                     # entitlements pgSchema: feature_catalog, feature_entitlements, entitlement_decisions
│   ├── types.ts                      # Subject, FeatureKey, EffectiveEntitlement, GateToken (opaque), GrantSource
│   ├── validation.ts                 # Zod: grant create/modify/revoke, catalog entry
│   ├── resolver.ts                   # FeatureEntitlementResolver (DB-leads, expiry-aware filter — FR-017)
│   ├── membership.ts                 # MembershipResolver interface + NullMembershipResolver (returns [] pre-WP12)
│   ├── gate.ts                       # FeatureGate: isEntitled/assertEntitled, GateToken mint, union (FR-016/019)
│   ├── subject-cache.ts              # subject-keyed cache wiring + explicit invalidation (FR-004/018)
│   ├── audit.ts                      # entitlement_decisions append-only writer (FR-006)
│   ├── errors.ts                     # FeatureNotEntitledError (+ upgrade payload shape)
│   ├── ownership.ts                  # static add-on-tool → feature_key map (Phase 1; replaced by registry in Phase 2)
│   ├── admin/
│   │   ├── grants.service.ts         # operator grant/modify/revoke (FR-015), idempotent, audited
│   │   ├── routes.ts                 # operator-only REST endpoints
│   │   └── tools.ts                  # admin-only MCP tools (catalog + grant management)
│   └── index.ts                      # module barrel + initialization (wires gate, resolver, cache, membership)
│
├── content/entitlements/             # KEEPS thin re-exports from ../../entitlements/core (source-compat; no break)
│
├── tools/
│   ├── index.ts                      # getAllTools(): filter add-on-owned tools by effective entitlement (FR-007)
│   └── executor.ts                   # executeTool(): assertEntitled (GateToken) before add-on tool dispatch (FR-007)
│
└── index.ts                          # mount admin routes, register admin tools, init entitlements module

drizzle/
└── 00NN_entitlements_schema.sql      # generated migration (add schema.ts to drizzle.config.ts)

tests/
├── entitlements/
│   ├── core-extraction.test.ts       # content path regression: existing entitlement tests still green
│   ├── resolver.test.ts              # DB-leads, expiry filter, fail-closed
│   ├── gate.test.ts                  # explicit deny, resolution order, GateToken un-forgeability
│   ├── union.test.ts                 # FR-019: {user} pre-WP12; membership-stub union
│   ├── subject-cache.test.ts         # subject key, TTL cap, invalidation
│   ├── audit.test.ts                 # append-only decision log
│   ├── admin-grants.test.ts          # FR-015 write path + authz + audit
│   └── integration/
│       ├── individual-licensing.test.ts   # grant → tool appears → call works; revoke → denies
│       ├── explicit-deny.test.ts          # unentitled → upgrade-required, logged
│       ├── fail-closed-lapsed-grant.test.ts    # resolver outage + expired grant → deny (FR-017)
│       └── second-path-gating.test.ts     # gated capability via non-tools/call path still denied (FR-016)
```

**Structure Decision**: The entitlement module is promoted to **platform-level** (`src/entitlements/`) rather than living under `content/`, because feature licensing is not content-specific. The generic machinery is *extracted* to `src/entitlements/core/` and the content module keeps re-exports so its call sites and tests are untouched. This makes "extend the machinery, build the system" literal and low-risk.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       joyus-ai-mcp-server (Express)                        │
│                                                                            │
│   Actor = individual user U  (Phase 1: tenantId == userId)                 │
│        │                                                                   │
│        ▼                                                                   │
│   tools/list ──┐                       ┌── operator (admin role)           │
│   tools/call ──┤                       │                                   │
│        │       │                       ▼                                   │
│        │       │              ┌──────────────────────┐                     │
│        │       │              │  Admin Grant Path     │  FR-015            │
│        │       │              │  admin/routes,tools   │  authz + audit     │
│        │       │              │  grants.service ──────┼──▶ feature_*       │
│        ▼       ▼              └──────────────────────┘     (write)         │
│   ┌─────────────────────────────────────────────────────┐                 │
│   │                  FeatureGate (gate.ts)               │  FR-005/016/019 │
│   │  assertEntitled(subject, featureKey) → GateToken     │                 │
│   │   effective set = UNION over actor's subjects:       │                 │
│   │     { user:U } ∪ MembershipResolver(U)               │  FR-019         │
│   │            (NullMembershipResolver → [] pre-WP12)     │                 │
│   │   resolution order:                                  │                 │
│   │     subject-cache → resolver → DB fallback → DENY     │  FR-004/005/017 │
│   │   deny → FeatureNotEntitledError (upgrade payload)    │  explicit       │
│   └───────┬─────────────────────┬───────────────┬────────┘                 │
│           │ mints               │ reads          │ appends                 │
│           ▼                     ▼                ▼                         │
│     GateToken          FeatureEntitlement    entitlement_decisions         │
│     (un-forgeable;     Resolver (DB-leads,   (append-only audit)           │
│      required by       expiry-aware)              FR-006                    │
│      gated seams)             │                                            │
│           │                   ▼                                            │
│           │            ┌──────────────────────────────────────────┐       │
│           │            │  PostgreSQL  (entitlements schema)         │       │
│           │            │  feature_catalog | feature_entitlements |  │       │
│           │            │  entitlement_decisions                     │       │
│           │            └──────────────────────────────────────────┘       │
│           ▼                                                                │
│   Gated seams (FR-007/008) — accept a GateToken, never a raw object:       │
│     • tools/index.ts getAllTools  → hides unentitled add-on tools          │
│     • tools/executor.ts execute   → asserts before add-on dispatch         │
│     • (providers / steps / connectors: enumerated call sites)              │
│                                                                            │
│   Reused, unchanged:  src/entitlements/core/  (EntitlementResolver,        │
│     HttpEntitlementResolver, EntitlementCache)  ◀── content path re-exports │
└──────────────────────────────────────────────────────────────────────────┘
```

## Phase Breakdown (this plan = Phase 1 only)

### Phase A: Foundation (WP01–WP02)
Extract the shared `core/`, create the `entitlements` schema + types + validation, and build the decision core (resolver + subject cache + `FeatureGate` + union seam + audit). Security-critical; nothing ships until default-deny and fail-closed are proven and the content path is still green.

### Phase B: Enforcement & Write Path (WP03–WP04)
The un-forgeable gated-path primitive (`GateToken`, enumerated call sites, quarantine the existing synthetic bypass) and the operator grant/catalog write path that creates grants.

### Phase C: Seam Wiring & Validation (WP05–WP06)
Wire entitlement gating into the tools seam (visibility + execution + upgrade response), then the integration tests and validation sweep proving the Phase 1 success criteria.

## Security Considerations

1. **Enforcement is structural, not procedural (FR-016).** Gated capabilities accept only a `GateToken` minted by `FeatureGate`; hand-constructed entitlement objects are un-typeable in the gated path. This directly closes the class of bug the codebase already demonstrates (`content-executor.ts:223` fabricates a `ResolvedEntitlements`). Phase 1 enumerates every gated call site so coverage is auditable.

2. **Fail closed on access AND lapsed grants (FR-017).** Resolver outage → DB fallback → deny. The fallback filters `status='active' AND (valid_until IS NULL OR valid_until > now())` so a lapsed licensed feature is never served during an outage. The existing content fallback is *not* expiry-aware; do not copy it verbatim.

3. **The gate takes an explicit subject.** It never infers from the `tenantId == userId` collapse. A test pins this so Phase 1.5 / WP12 cannot silently weaken it.

4. **Grant-write is privileged and audited (FR-015).** Only an operator/admin role writes `feature_entitlements`, through a defined surface (not raw SQL), with actor identity recorded on every grant/revoke.

5. **Decision audit is append-only (FR-006).** Only `logAllow`/`logDeny`; no UPDATE/DELETE in application code (follows the `orchestrator_events` precedent).

6. **Bounded by tenant identity (declared).** Phase 1 entitlement strength for *individuals* is sound; org-scoped strength depends on WP12 + isolation hardening (Phase 1.5). This boundary is stated, not assumed away.

## Future Considerations (NOT in this plan)

- **Phase 1.5 — org seat-licensing**: swap `NullMembershipResolver` for a real one (reads WP12 tenant↔user membership); activate `subject_type=tenant` inheritance; couples with isolation/RLS hardening. Needs WP12.
- **Phase 2 — plugin host + SDK**: extract `@joyus-ai/plugin-sdk`, plugin manifest + host + runtime loader, convert static tool registration and the closed `StepType` union to host-mediated registration with auto-gating; in-process loader threat model.
- **Seat-capping** (vs site license): a seat-assignment table refining FR-019's union — open decision §11.8.
- **Cross-instance invalidation bus**: pub/sub for immediate cross-node revocation — pending the revocation-SLA decision (§11.5); Phase 1 baseline is TTL-only across instances.
- **Usage-based limits / metering**: needs cost capture; `limits` is a forward hook only.

## Complexity Tracking

| Item | Why it exists | Simpler alternative rejected |
|------|---------------|------------------------------|
| `core/` extraction | Make reuse literal; keep content path green | Duplicating resolver/cache — rejected (drift, two implementations) |
| Union resolver + `NullMembershipResolver` now | Phase 1.5 activates by swap, not redesign | Hard-coding `{user:U}` — rejected (would force a later rewrite of the gate) |
| `GateToken` un-forgeable primitive | Structural enforcement; the synthetic-bypass bug is already in-tree | Call-site discipline only — rejected (FR-016 / M1; one forgotten site ships a free licensed feature) |
| Dedicated `entitlement_decisions` table | Compliance + conversion analytics; explicit-deny semantics | Reusing `content.operation_logs` — viable thinner path (§11.3); flagged for the build owner to confirm |

*Open decision for the build owner (spec §11.3): adopt the full three-table schema, or a thinner first cut (single grants table + reuse `content.operation_logs` for audit) to ship the individual dollar faster. This plan assumes the full schema; downgrade is a scoped reduction of WP01.*
