# Specification: Add-on / Plugin Architecture and Feature Entitlements

**Project:** Joyus AI Platform
**Phase:** Foundation — Add-on Extensibility & Feature Entitlements
**Date:** June 14, 2026
**Status:** Draft for review
**Target repo:** joyus-ai (`joyus-ai-mcp-server`)
**Supporting docs:** `data-model.md` (schema)

---

## 1. Overview

### Problem

Joyus AI is open core (Apache 2.0) with a productization model of proprietary add-ons plus hosting/services. The code has no mechanism for that: there is no core/add-on boundary, no way for a proprietary capability to attach without forking the open core, and no way to license a capability to one subject (user or tenant) and withhold it from another.

An entitlement system **does** exist (`src/content/entitlements/`), but it gates **content access** (which data sources a session may query), is **session-scoped and TTL-based** (`content.entitlements`, `schema.ts:166-179`), and **denies silently** (no `check`/`assert`; non-entitled yields empty results). Feature/add-on licensing needs the opposite on all three axes: a **durable, subject-level** grant, an **explicit** allow/deny with an "upgrade required" signal, and a gate that is **enforced in trusted core code**, not by the add-on itself.

Until this exists, licensed add-ons cannot be offered at all: there is no mechanism to grant a capability, to gate it, or to attach proprietary code to the open core without forking.

### Solution

Build the add-on extensibility foundation in two layers, delivered in two phases so licensed add-ons become possible before the full ecosystem is built.

- **Extension layer** — *how add-on code attaches.* A unified registration surface over the existing seams (tools, providers, connectors, pipeline steps, hooks) so a capability can be added without editing core dispatch code.
- **Entitlement layer** — *how add-on access is licensed.* A persistent, subject-scoped feature-entitlement service that **reuses** the existing generic resolver/cache abstractions (`EntitlementResolver`, `HttpEntitlementResolver`, `EntitlementCache`) but introduces its own durable table and **explicit-deny** gate.

> **Design principle — individual-first, org-layered.** The individual user is the **primary actor and a first-class subject from day one**; organizations are groupings that hold entitlements which *layer on top*. A user's **effective entitlement is the union** of (a) their own user-grants and (b) the grants of every org they belong to (FR-019). The architecture therefore never gates the individual experience behind org/tenant identity — orgs add capability to a member, they are not a precondition for one.

**Phasing — individual-first, org-layered.**

- **Phase 1 — Feature Entitlement + Gate (individual-first; ships *without* WP12).** The entitlement layer (FR-001..019) and gate at the existing seams, with the **individual user as the primary subject**. A user can hold a feature grant for their own account **today** — `subject_type=user`, `tenantId == userId`, no tenant system required. No package split.
- **Phase 1.5 — Org-level entitlement (layers on; requires WP12).** Once tenant identity lands (real `tenants` table + tenant↔user membership + tenant resolution replacing the `tenantId == userId` collapse), an org holds an add-on grant **once** and **every member inherits it** via the effective-entitlement union (FR-019). This gates **org-level entitlement — not the individual path**; individuals never wait on it. The tenant-identity prerequisite is **already specced as Spec 013 — Tenant Identity Resolution** (currently spec-only): its WP01 adds the tenants/membership schema the union needs. Org-level entitlement sequences behind Spec 013's implementation, alongside isolation hardening (and overlaps Spec 008, profile-layer isolation).
- **Phase 2 — Plugin Host + SDK (ecosystem; out-of-tree, proprietary, marketplace-ready).** Extract a stable `@joyus-ai/plugin-sdk`, define a plugin manifest + host + runtime loader, and convert the static surfaces (MCP tool registration; the closed `StepType` union) into host-mediated registration. The host binds entitlement enforcement to plugin contributions automatically. This is what makes truly-proprietary, separately-distributed add-ons and a future marketplace possible.

The subject-type-agnostic `subject_type` plus union resolution (FR-019) means the entitlement layer is **built once** and serves individuals immediately, then lights up for orgs when WP12 lands — a sequencing dependency, not a redesign.

**Isolation coupling (scoped to org-level entitlement, not the individual path).** Phase 1.5 introduces multiple users per tenant, so a cross-tenant bug would expose one tenant's data/features to another — coupling WP12 with isolation hardening (RLS) on the org path. The Phase 1 individual path keeps each user as its own subject and is not gated on RLS for first-party use; public/untrusted exposure still is (§8). The entitlement gate is only as trustworthy as the tenant boundary beneath it — which is why org exposure waits on isolation, while individuals do not.

### Users

- **Platform operators** — enable/disable add-ons per subject; install plugin packages; monitor plugin health.
- **Tenant administrators / end users** — see only the capabilities they are licensed for; get a clear upgrade path when they hit a gated feature.
- **First-party Joyus engineers** — ship licensed capabilities behind an entitlement without forking core (Phase 1).
- **Third-party / proprietary add-on authors** — build against a stable, Apache-licensed SDK and ship an independent package the open core never vendors (Phase 2).
- **External grant sources** — billing/admin automation writes entitlement grants (directly or via a resolver endpoint) when a subject acquires, trials, or relinquishes an add-on.

---

## 2. Functional Requirements

### Phase 1 — Entitlement layer

#### FR-001: Feature Catalog
A catalog of licensable features/add-ons (`entitlements.feature_catalog`) keyed by a stable, reverse-DNS `feature_key` (e.g. `com.joyus.addon.advanced-pipelines`). Each entry carries display name, description, publisher, the contribution kinds it may provide, and a lifecycle status (`active`/`deprecated`/`withdrawn`). Feature keys are **never reused**. This is distinct from `content.products` (which is content-routing, not licensing) and is the authoritative list of entitlement keys.

#### FR-002: Persistent Feature Entitlements
A durable grant table (`entitlements.feature_entitlements`) recording that a **subject** holds a **feature** for a validity window. A subject is `{subject_type ∈ {tenant,user}, subject_id}` — **subject-agnostic**, so a per-tenant vs per-seat choice maps onto `subject_type` without a redesign. Grants carry `status`, `valid_from`, `valid_until` (nullable = perpetual), `source` (`admin`/`resolver`/`trial`/`import`), and an optional `limits` envelope. Grants are **persistent and independent of any session** — explicitly contrasting `content.entitlements`. Exactly one live grant row per `(subject_type, subject_id, feature_key)` (unique constraint); lifecycle changes update status in place, history goes to the decision log (FR-006).

#### FR-003: Feature Entitlement Resolver (reuse the existing contract)
Resolve the set of feature keys a subject is entitled to, using the **existing** `EntitlementResolver` contract (`interface.ts:47-53`) — which is already generic over opaque IDs. Provide a `FeatureEntitlementResolver` whose default implementation reads `feature_entitlements` (DB-leads). Optionally, an `HttpEntitlementResolver` (the existing one, `http-resolver.ts`) may front an external grant source, extended only by adding a `featuresField` to its `responseMapping`. Resolution is **fail-closed**: resolver failure never grants. To make reuse literal, extract the generic `EntitlementResolver` interface, `HttpEntitlementResolver`, and `EntitlementCache` into a shared `src/entitlements/core/` consumed by both the content module and this one (mechanical refactor; re-exports preserved).

#### FR-004: Subject-Scoped Entitlement Cache
Cache resolved feature sets keyed by **subject** (`subject_type:subject_id`), not by session — because licensing does not change per session. Reuse the `EntitlementCache` class (`cache.ts`) parameterized by key. TTL is expiry-aware per FR-017 (default 1h, capped by next grant expiry). Provide **explicit invalidation** on entitlement change (grant/revoke/suspend/expire) — unlike the content cache, which only invalidates on session close (`mediation/router.ts:259`). A grant or revocation must take effect within one TTL window even absent explicit invalidation. **Multi-instance caveat:** the cache is in-process, so explicit invalidation is single-node; cross-node propagation is governed by FR-018.

#### FR-005: FeatureGate Service (explicit deny)
A single enforcement service exposing:
- `isEntitled(subject, featureKey): Promise<boolean>` — non-throwing check.
- `assertEntitled(subject, featureKey, capability?): Promise<void>` — throws `FeatureNotEntitledError` carrying the `featureKey` and a machine-readable reason, which the API/MCP layer maps to a structured **"upgrade required"** response (HTTP 402/403 with an `upgrade` payload; a non-empty MCP tool error) — **not** a silent empty result. Resolution order mirrors the existing stack: **cache → resolver → DB fallback → default deny**, with every step expiry-aware (FR-017). `FeatureGate` is the *only* place entitlement is decided; no add-on decides its own access — and in Phase 1 that guarantee is made structural, not procedural, via FR-016.

#### FR-006: Entitlement Decision Audit
Every gate decision (allow and deny) is appended to `entitlements.entitlement_decisions` with subject, feature key, decision, reason (`entitled`/`not_entitled`/`expired`/`suspended`/`limit_exceeded`/`resolver_unavailable_fallback_deny`), `resolved_from` (`cache`/`resolver`/`db`/`default_deny`), the capability being gated, and session id when available. The table is **append-only** (following the `orchestrator_events` precedent, `events.ts`). There is no entitlement-decision audit today; this creates one for compliance, debugging, and conversion analytics.

### Phase 1 — Gate enforcement at existing seams

#### FR-007: Entitlement-Gated MCP Tools
Tool *visibility* and *execution* become entitlement-aware:
- `getAllTools(userId)` (`tools/index.ts:32-62`), which already filters by connected service, additionally **omits add-on-owned tools** the subject is not entitled to, so `tools/list` shows only licensed capabilities.
- `executeTool(...)` (`tools/executor.ts`) calls `FeatureGate.assertEntitled` **before dispatching** any add-on-owned tool, returning an explicit upgrade error on deny. Core (free) tools are unaffected. Tools declare their owning `feature_key` via the registry (FR-011) or, in Phase 1, a static ownership map for in-tree add-on tools.

#### FR-008: Entitlement-Gated Providers, Steps, and Connectors
Non-tool contributions are gated at their invocation boundary: a generation/search provider, pipeline step handler, or content connector may declare a required `feature_key`; the core asserts entitlement before invoking it. Because these run inside trusted core services (`GenerationService` DI `content/index.ts:69-74`; `StepRegistry` `pipelines/steps/registry.ts`; `ConnectorRegistry` `connectors/registry.ts`), the gate lives in those call sites, not in the contribution. **These call sites are a finite, enumerated set** (FR-016) — not "wherever contributions are invoked" — and each is reached only through the un-forgeable gated path, so coverage is auditable rather than dependent on every author remembering the check.

### Phase 2 — Plugin host + SDK

#### FR-009: Plugin SDK Package (`@joyus-ai/plugin-sdk`, Apache-2.0)
Extract the stable extension interfaces into a separately-publishable, Apache-2.0 package that add-ons depend on **without** pulling in the full server: `ToolDefinition` + tool-executor signature, `GenerationProvider`, `SearchProvider`, `ContentConnector`, `SkillResolver`, `PipelineStepHandler`, `Pre/PostGenerationHook`, the `FeatureGate`-facing types, and the `JoyusPlugin` + `PluginManifest` + `PluginHost` contracts. Today everything is one package with no core/add-on split (`package.json:2-4`); this requires introducing a workspace and moving interfaces behind a published surface with a versioned **core API**.

#### FR-010: Plugin Manifest and Identity
Each add-on declares a manifest: stable `id` (reverse-DNS, marketplace-ready), `version` (semver), `publisher`, `displayName`, the `provides` contributions, the `requiresFeatures` entitlement keys its gated contributions need, and a `coreApiRange` (compatible core API semver range). Identity is stable and versioned so a future marketplace can build on it without redesign — but no marketplace mechanics are in scope here.

#### FR-011: Plugin Host and Registration Contract
A `PluginHost` exposes scoped registration methods — `registerTool`, `registerToolExecutor`, `registerProvider`, `registerConnector`, `registerPipelineStep`, `registerSkillResolver`, `registerPreHook`/`registerPostHook`, `registerEventType` — and calls each plugin's `register(host)` at boot. This requires converting the static surfaces into registries:
- **MCP tools:** add a mutable tool registry feeding `getAllTools()` and a `registerToolExecutor(prefix|ownerId, handler)` path in `executor.ts` (today both are hard-coded — `tools/index.ts:32-62`, `executor.ts:47-54`).
- **Pipeline steps:** widen `StepType` from a closed union (`pipelines/types.ts:25-27`) to `string` (preserving built-in autocomplete) so `StepRegistry.register()` accepts new types.
- **Safety hooks:** expose the `SafetyService` instance (private to `index.ts:353`) to the host.
- Connectors, providers, skill resolvers, and event types already support registration/DI and need only host wiring.

#### FR-012: Runtime Plugin Loader with Failure Isolation
Load a **config-driven allowlist** of plugin packages at boot (env/config pattern, mirroring `SKILLS_DIR`/skill-loader configurability, `skill-loader.service.ts`). For each: validate the manifest, check `coreApiRange` compatibility, and call `register(host)` inside a try/catch. A plugin that throws, is incompatible, or declares an unknown `feature_key` is marked unhealthy in `entitlements.installed_plugins` and **does not crash boot or affect other plugins or core**. Plugin load state is operator-visible.

#### FR-013: Host-Enforced Entitlement Binding
When a plugin contributes a capability that declares `requiresFeatures`, the **host wraps the contribution** so `FeatureGate.assertEntitled` runs in trusted core code at every invocation. A plugin **cannot** self-grant, bypass, or weaken its own gate, and cannot read entitlement state for other subjects. This is the security keystone: enforcement is structurally outside the (possibly third-party, possibly proprietary) add-on.

#### FR-014: Open-Core / Proprietary Boundary, Guard, and Capability Floor
The SDK and all registration contracts are **Apache-2.0** (anyone may build add-ons). Proprietary add-on implementations ship as **independent packages, loaded at runtime via the stable interface, and are never vendored into the open-core repo.** Loading separately-licensed code in-process via a published Apache-2.0 interface carries **no copyleft-contamination risk** — Apache-2.0 is permissive and has no viral term to trigger; reviewers should *not* spend worry on license contamination. The governance risk that is real, and that this FR defends, is **core hollowing over time**: the claim that "the open core stays fully functional and forkable" is meaningless if add-ons accrete the load-bearing capability until a fork with zero add-ons does nothing worth running. Therefore:
- **Vendoring guard (mechanical):** a CI guard in the open repo fails the build if a configured proprietary package namespace or non-Apache license header appears in tree. (Catches accidental vendoring; cannot detect hollowing.)
- **Capability floor (policy + release gate):** enumerate the capability set the open core must always deliver **with zero proprietary add-ons**, and make "a fork with no add-ons boots and delivers floor capability X" a release-gate check. Core APIs must not *require* a proprietary add-on to be useful. This is the structural defense of the freedom-first posture that a grep cannot provide.
- The in-process plugin loader (FR-012) executes allowlisted third-party packages **with full core privileges** (DB, secrets). That supply-chain/threat surface is acknowledged here and routed to a threat model before Phase 2 (see §8, §10); "operator vets the package" is the entire current control.

### Phase 1 — Hardening (added after proposal-critic review; numbered here to preserve existing FR references)

#### FR-015: Operator Grant Administration *(Phase 1 — the write path that creates grants)*
An authenticated, authorized surface for operators (and, later, billing automation) to **create, modify, and revoke** `feature_entitlements` rows. Without this, Phase 1 can *enforce* grants but cannot *create* them through any specified interface — and Scenario 1 has no implementation. Specify: the surface (operator REST endpoint and/or an admin-only MCP tool — **not** raw SQL as the contract), the authorization model (who may grant; an operator/admin role distinct from tenant users), the audit of every grant/revoke (write to `entitlement_decisions` or a grant-history log with actor identity), and idempotency. This is the boundary where billing integration later attaches via `source=resolver|import`. *(This is distinct from out-of-scope billing: it is the grant action, not payment collection.)*

#### FR-016: Un-forgeable Gated-Path Enforcement *(Phase 1 — makes FR-005/FR-008 structural, not procedural)*
For Phase 2 plugins, the host wraps contributions (FR-013) so enforcement is structural. **Phase 1 in-tree add-ons have no host** — FR-008 as stated relies on every call site remembering to call `assertEntitled`, which is *procedural* enforcement. The codebase already contains a counterexample that proves the risk: `content_search` **fabricates a `ResolvedEntitlements` object and passes it straight to the search service, bypassing the resolver/cache/`EntitlementService` entirely** (`tools/executors/content-executor.ts:223-231`). To prevent a licensed feature shipping ungated because one call site forgot the gate:
- A gated capability MUST be reachable **only** via a `FeatureGate`-minted, non-constructible token/handle (e.g. an opaque `GateToken` that gated services require and that only `FeatureGate.assertEntitled` can mint). **Hand-constructed entitlement/grant objects are forbidden in the gated path** and should be made un-typeable there.
- **Enumerate** every Phase-1 gated call site — derived from `executeTool` dispatch (`content_`, `profile_`, `pipeline_`, and the OAuth path; `tools/executor.ts:99-130`) plus the provider / step / connector invocation points (FR-008) — so a reviewer can verify coverage is complete. (Note: pipeline-step execution runs via Inngest functions, not `executeTool`; the gate belongs inside those functions before the step adapter runs.)
- The existing `content_search` synthetic-entitlement path is a **known exception**: fix it to go through `EntitlementService`, or explicitly quarantine and document it, so the plan does not inherit it as a template.

#### FR-017: Expiry-Aware Resolution and DB Fallback *(Phase 1 — fail closed on lapsed grants, not just on access)*
The reused `ResolvedEntitlements` contract is a flat key set + one `ttlSeconds` (`content/types.ts:76-84`) — it carries **no per-grant validity**. So `valid_until` enforcement must live at resolve time, and the fallback path must be expiry-aware (the existing content DB-fallback selects the most-recent row **without** filtering `expiresAt`, `content/entitlements/index.ts`):
- The `FeatureEntitlementResolver` filters `status='active' AND (valid_until IS NULL OR valid_until > now)` at resolve time; the cached set is the **post-filter** set, and the cache TTL is `min(resolverTtl, time-to-next-grant-expiry)` so a grant never outlives `valid_until` by more than one TTL.
- The **DB fallback** (FR-005) MUST apply the same active+non-expired filter. Naively reusing the content fallback would **grant a lapsed licensed feature during a resolver outage** — failing *open on a lapsed grant*. Fail closed on both access and lapsed grants.

#### FR-018: Cross-Instance Invalidation and Revocation Latency *(Phase 1)*
The reused `EntitlementCache` is an in-process `Map` (`cache.ts`). In a multi-instance deployment (the platform targets multi-tenant cloud), invalidating one node's cache (FR-004) does nothing for the others — a revoked grant stays live on every other node until its TTL. Specify the multi-instance story explicitly: either (a) accept **TTL-only** propagation across instances as the baseline guarantee (so SC-1 "revocation denies within one TTL" is the real SLA and "explicit invalidation" is a single-node optimization), or (b) add a pub/sub invalidation bus for immediate cross-node revocation. State the **maximum acceptable revocation latency** (a relinquished/abusive subject retaining a licensed or security-sensitive feature for up to one TTL — default 1h — may or may not be acceptable) and let it constrain the default TTL.

#### FR-019: Individual-First Effective Entitlement (union over the actor's subjects) *(Phase 1 core)*
The **actor is always an individual user**; entitlement is evaluated for that user. A user's **effective entitlement for a feature is the union** of grants whose subject is `user:U` **or** `tenant:T` for any org `T` the user is a member of — all active and non-expired (FR-017). Concretely, the gate resolves the actor's subject set `{ user:U } ∪ { tenant:T | U ∈ members(T) }`, resolves/caches each subject (reusing FR-003/FR-004 per subject), and unions the results; `assertEntitled` allows if the feature is present in any. Consequences that make the design principle real:
- **Pre-WP12**, the membership set is empty, so the set is just `{ user:U }` — the **individual path works day one** with no tenant system.
- **Post-WP12**, an org grant (one row, `subject_type=tenant`) is **inherited by every member** with no per-user rows — this is the org-entitlement mechanism, and it *adds* capability to an individual rather than gating them.
- **Invalidation** (FR-004/FR-018) must fire on the user's own grant changes **and** on changes to any of their orgs' grants or to membership itself; the simplest correct implementation invalidates per-subject and lets the gate re-union, accepting the FR-018 cross-instance TTL bound.
- **Audit** (FR-006) records *which* subject (user vs which tenant) satisfied an allow, so inherited-vs-personal entitlement is traceable.
- **Seat-cap boundary (open — see §11.8).** Pure membership-union implements an **org-wide site license** (every member inherits). It does **not** implement a **capped N-of-M seat license** (only N assigned members). If seat-capped licensing is required, the union must become "user grant ∪ tenant grant *where the user holds an assigned seat*," which needs a seat-assignment table (a WP12/billing concern). Phase 1 ships site-license inheritance; seat-capping is an explicit, deferred extension — do not assume the word "seats" means a cap until §11.8 is decided.

---

## 3. Non-Functional Requirements

### Performance
- `FeatureGate` check on cache hit: < 5ms p95 (in-process map, same class as the content cache).
- Cold resolve (resolver or DB): < 500ms p95 (matches the existing resolver target SC-004; existing default timeout 2000ms, `http-resolver.ts`).
- `tools/list` entitlement filtering adds < 10ms for a tenant with ≤ 50 catalog entries (single cached resolve + set filter).
- Plugin loading happens at boot only; it must not add to per-request latency.

### Security
- Entitlement is an **authorization boundary**. Enforcement is always in trusted core — structurally, not by convention: Phase 2 via the host wrap (FR-013), Phase 1 via the un-forgeable gated path (FR-016). Never delegated to an add-on.
- Default-deny everywhere: absence of a grant, an expired/suspended grant, or any resolver failure denies — and the gate fails closed on **lapsed grants** too (no lapsed grant served on fallback, FR-017), not just on access.
- The gate takes an **explicit subject**; it must not infer the subject from ambient `tenantId == userId` collapse (`executor.ts:104`). Strength of the boundary is bounded by tenant-identity work (WP12) and isolation hardening (RLS) — stated as dependencies, not assumed away.
- Decision audit is append-only and tenant-scoped (FR-006).
- A proprietary add-on runs in-process with core privileges; this spec does **not** sandbox add-on code. Trust in third-party code is an operator decision until a sandboxing model exists (out of scope; noted as residual risk).

### Availability
- Resolver/grant-source outage degrades to DB fallback, then default deny — never to "grant everything." Free/core capabilities remain fully available regardless of entitlement-system health.
- One failing plugin cannot crash boot or disable other plugins or core (FR-012).
- Entitlement changes propagate within one cache TTL even if explicit invalidation is missed.

### Cost
- No external resolver call on the hot path when cached. DB fallback is a single indexed query (partial index on active grants, see `data-model.md`).
- Decision-log volume is bounded by gated-call frequency; reuse the existing audit retention/partitioning approach.

---

## 4. User Scenarios

1. **Operator enables a licensed add-on.** An operator grants `com.joyus.addon.advanced-pipelines` to subject A through the authorized operator grant surface (FR-015; `source=admin`) — not raw SQL. The subject cache is invalidated; on subject A's next `tools/list`, the add-on's tools appear. Subject B sees nothing change. *(In Phase 1 the subject is an individual user, `subject_type=user`; the same flow gates an org once WP12 makes `subject_type=tenant` meaningful — see §1.)*

2. **Unentitled subject hits a gated tool.** A subject without the grant invokes a gated add-on tool. `executeTool` calls `FeatureGate.assertEntitled`, which denies (`reason=not_entitled`), logs a decision row, and returns a structured **"upgrade required"** error naming the feature — no execution, no silent empty result.

3. **Entitlement lapses.** A subject's grant `valid_until` passes. Within one TTL the resolve no longer includes the feature; the tool disappears from `tools/list` and any in-flight call is denied with `reason=expired`. The grant row flips to `status=expired`; history is in the decision log.

4. **Proprietary add-on as a separate package (Phase 2).** An operator adds `@acme/joyus-addon-x` to the plugin allowlist. At boot the loader validates its manifest and `coreApiRange`, calls `register(host)`; the host registers its tool and **wraps it with the entitlement gate** declared in `requiresFeatures`. The open-core repo never contains Acme's code.

5. **Bad plugin fails safely (Phase 2).** `@acme/joyus-addon-y` throws during `register`. The loader catches it, marks it `health=failed` in `installed_plugins` with `last_error`, and continues. Core and all other plugins start normally.

6. **Individual first, org-level entitlement later (FR-019).** A user gets value as an **individual** (Phase 1, pre-WP12; their effective set is `{user:U}`) and may hold a personal grant for an add-on. Later their organization (Phase 1.5, post-WP12) holds that same add-on grant **once** at the tenant level; now every member — including U — **inherits** it via the effective-entitlement union, with no per-user grants written. U's experience never waited on the org; the org *added* capability to U. The audit (FR-006) shows whether an allow came from U's personal grant or the inherited tenant grant.

---

## 5. Key Entities

| Entity | Description |
|--------|-------------|
| FeatureCatalogEntry | A licensable feature/add-on identified by a stable `feature_key` |
| FeatureEntitlement | A durable grant: a subject holds a feature for a validity window |
| Subject | `{subject_type ∈ {tenant,user}, subject_id}` — what a grant attaches to (subject-agnostic). The **actor** is always an individual user; `tenant` is a grouping whose grants are inherited |
| EffectiveEntitlement | A user's resolved capability set: the **union** over `{user:U} ∪ {tenant:T \| U ∈ members(T)}` (FR-019). The thing the gate actually checks |
| FeatureEntitlementResolver | Resolves a subject's licensed feature keys; reuses the existing resolver contract |
| FeatureGate | The single enforcement service: `isEntitled` / `assertEntitled` over a user's effective entitlement (explicit deny) |
| EntitlementDecision | Append-only audit record of an allow/deny decision |
| JoyusPlugin | An add-on package: a `register(host)` entry point + manifest (Phase 2) |
| PluginManifest | Declares id, version, publisher, `provides`, `requiresFeatures`, `coreApiRange` |
| PluginHost | The scoped registration surface plugins attach to; binds the gate to contributions |
| Contribution | A single registered capability (tool, provider, connector, step, hook) |
| InstalledPlugin | Operator-facing load/health record for a configured plugin package |

---

## 6. Success Criteria

1. **Durable licensing works** — a grant created by admin survives session end and server restart; revocation denies within one TTL.
2. **Individual-first + org inheritance (FR-019)** — (a) pre-WP12, an individual with a `user` grant and no org is entitled (the path works with zero tenant system); (b) post-WP12, a single `tenant` grant entitles **every member** with no per-user rows, and removing a user from the org revokes their inherited access on the next resolve.
3. **Explicit deny** — an unentitled gated call returns a structured upgrade error (not an empty result), and the decision is logged.
4. **Reuse is real** — the generic resolver/cache are shared between content and feature entitlements (one implementation, two consumers); the content path's existing tests still pass.
5. **Tool gating** — `tools/list` shows add-on tools only to entitled subjects; `tools/call` on an unentitled add-on tool is denied. Core tools are unaffected for everyone.
6. **Trusted enforcement (structural)** — an add-on cannot grant itself access. (Phase 2) a test proves a host-wrapped contribution invoked without entitlement is blocked by the host. (Phase 1, FR-016) a test proves a gated capability **invoked via a second path** — not just `tools/call`, but e.g. a pipeline step or provider call — is still denied, and that a hand-constructed entitlement object cannot reach the gated path.
7. **Fail closed on lapsed grants** — during a simulated resolver outage, a subject whose grant has **expired** is denied (the DB fallback does not serve a lapsed grant); a subject with a valid grant is still served. (FR-017)
8. **Grant path exists** — an operator can create and revoke a grant through the specified authorized surface (FR-015), not raw SQL, and the action is audited with actor identity.
9. **(Phase 2) Out-of-tree add-on** — a sample add-on shipped as a separate package depending only on `@joyus-ai/plugin-sdk` registers a gated tool that works when entitled and is denied otherwise, with no change to the open-core repo.
10. **(Phase 2) Failure isolation** — a deliberately-broken plugin is quarantined (`health=failed`) without affecting boot, core, or other plugins.
11. **License boundary + capability floor hold** — the CI guard fails when proprietary/non-Apache code is introduced into the open repo; and a fork with **zero proprietary add-ons** boots and delivers the enumerated floor capability set (FR-014).
12. **Auditability** — every allow/deny is queryable per subject and per feature for a defined retention window.

---

## 7. Assumptions

- The generic `EntitlementResolver` / `HttpEntitlementResolver` / `EntitlementCache` are reusable for feature entitlements (verified in the codebase: content-coupling is isolated to two private `EntitlementService` methods).
- Something upstream produces grants — an operator admin action and/or a billing system. This spec **consumes** grants; it does not collect payment or model subscriptions.
- For the MCP path, `tenantId == userId` is acceptable interim subject identity (each user is their own tenant) **provided** the gate API takes an explicit subject and does not bake in the collapse.
- Add-on code is trusted-by-operator (no sandbox). Operators vet third-party packages before allowlisting them.
- PostgreSQL + Drizzle migration mechanics support an additive `entitlements` schema (verified in the codebase).
- A single, versioned **core API** can be defined for the SDK surface (Phase 2). The interfaces to extract already emit `.d.ts`.

---

## 8. Dependencies

- **Existing entitlement module** (`src/content/entitlements/`) — its *resolution machinery* (the `EntitlementResolver` interface, `HttpEntitlementResolver`, and `EntitlementCache` class) is reused via a shared `core/` extraction. **Be precise about scope:** this spec reuses the machinery but **builds a new feature-entitlement *system* on top of it** — a new `entitlements` schema and tables, a net-new `FeatureGate` service (no `assertEntitled`/gating precedent exists in the codebase), and inverted semantics on every behavioral axis (explicit vs silent deny; subject- vs session-keyed cache; invalidate-on-grant-change vs on-session-close). "Extend" describes the plumbing, not the system; the plan must size the Phase 1 build from the new-build surface (`data-model.md` + FR-001..018), not as a thin extension.
- **WP12 / tenant identity** — *prerequisite for ORG-level entitlement (Phase 1.5), NOT for the individual path (Phase 1).* The individual experience and individual add-on grants ship without it (FR-019 unions over `{user:U}` alone pre-WP12). But org-level entitlement cannot be exercised until a real `tenants` table + tenant↔user membership + tenant resolution replace `tenantId == userId` (verified in the codebase); then one tenant grant is inherited by every member (FR-019). **Status:** this prerequisite is already specced as **Spec 013 — Tenant Identity Resolution** (spec-only), including the tenants/membership schema; sequence its implementation after Phase 1 ships individuals and before org-level entitlement, alongside isolation hardening (overlaps Spec 008).
- **Isolation hardening (RLS)** — *coupled to org-level entitlement, not to individuals.* Phase 1.5 puts multiple users in one tenant, so a cross-tenant leak exposes one tenant's data/features to another; the gate is only as trustworthy as the tenant boundary beneath it. Sequence isolation hardening alongside WP12 **before exposing org tenants**. The Phase 1 individual path (each user its own subject) is not gated on RLS for first-party use; any *public/untrusted* exposure still is.
- **Cost/usage capture** — *soft.* Usage-based entitlement limits need token/cost capture (`AnthropicGenerationProvider` returns no usage today, verified in the codebase). `limits` is a forward hook; metering is out of scope.
- **Governance + license posture** — FR-014 operationalizes the Apache-core posture; governance docs should land consistently with it.
- **Spec 014 (safety guardrails)** and **Spec 009 (pipelines)** — provide two of the seams (hooks; step registry) the host unifies in Phase 2.
- **Threat model (before Phase 2)** — the in-process plugin loader (FR-012) runs allowlisted third-party code with full core privileges. Route the loader/supply-chain surface to a threat-modeling pass, and (for any third-party add-ons) the maintainer/bus-factor question to an ownership/bus-factor analysis, before Phase 2 plans land.
- **Billing unit + marketplace** — *downstream.* Decided after Phase 1 lands; the `subject_type` and stable plugin/feature identity are the forward-compatible hooks.

---

## 9. Edge Cases

- **Resolver down, no DB grant** → default deny (`reason=resolver_unavailable_fallback_deny`). Fail-closed, explicit (contrast content path's fail-closed-*silent*).
- **Entitlement without capability** — a subject is granted a feature whose plugin/tool isn't installed → harmless no-op; nothing to show or gate.
- **Capability without entitlement** — an add-on tool is installed but the subject has no grant → hidden in `tools/list`, denied on call (default deny).
- **`tenantId == userId` collapse** — gate must still receive an explicit subject; never infer. A test pins this.
- **Two plugins, same tool name** — registration conflict resolved by namespacing on plugin/owner id; a hard duplicate is rejected at load and the second plugin marked unhealthy.
- **Plugin `coreApiRange` incompatible** — not loaded; `health=incompatible`; logged; boot continues.
- **Plugin declares unknown `feature_key`** — registration of its gated contributions rejected; loader records the error (a gated capability with no catalog entry must never be silently ungated).
- **Grant flips mid-session** (revoke during an active session) — next gated call re-resolves (cache invalidated on change) and denies; in-flight already-authorized operations are not retroactively killed (document the boundary).
- **`limits` set but metering absent (pre-cost-capture)** → treat as boolean entitlement; do not fabricate usage. Limit enforcement is inert until cost capture lands.
- **Clock/TTL skew** — `valid_until` is authoritative on resolve (FR-017): the resolver filters expired grants and the cache TTL is capped at time-to-next-expiry, so cache TTL only bounds staleness and never extends a grant past `valid_until`.
- **Resolver outage with an expired grant on file** — DB fallback must NOT serve it; the fallback filters active+non-expired (FR-017). Naive reuse of the content fallback (most-recent row, no expiry filter) would fail *open on a lapsed grant*.
- **Feature key reuse** — `feature_catalog.feature_key` is the primary key and `withdrawn` rows are retained, so a withdrawn key cannot be re-inserted (PK collision); "never reused" is enforced by the PK, not by policy alone.

---

## 10. Out of Scope

- **Billing / payment collection / subscription modeling** — this spec consumes grants; it does not price, charge, invoice, or model plans. The resolver/`source` field is the integration point.
- **Marketplace** — discovery, third-party publishing, vetting, ratings, revenue share, per-tenant self-serve install (downstream).
- **Tenant identity system (WP12)** — depended upon, not built here.
- **RLS / isolation hardening** — separate workstream; a dependency for *public/untrusted* exposure, not for first-party Phase 1.
- **Token/cost usage capture** — required for usage-based limits; only a forward hook here.
- **Add-on code sandboxing** — add-ons run in-process with core trust; isolating untrusted add-on execution is a future hardening effort.
- **The proprietary add-ons themselves** — this spec is the *framework and the boundary*, not any specific licensed feature.
- **UI/admin console** for entitlement management — API/MCP and operator-level config only; an admin UI is a later feature.

---

## 11. Open Decisions for Planning (carry into plan.md / tasks)

1. **Individual-first, org-layered (settled 2026-06-14).** The architecture serves individuals first (Phase 1, no tenant identity) and layers org-level entitlement on top via membership inheritance (FR-019, Phase 1.5, requires tenant identity). The tenant-identity prerequisite is on the critical path for org-level entitlement and is **already specced as Spec 013 (Tenant Identity Resolution, spec-only)** — sequence its implementation *after* Phase 1 ships individuals and *before* org-level entitlement. *Remaining sub-decision: implement Spec 013 standalone, or alongside the isolation-hardening / Spec 008 work?*
2. **DB-leads vs resolver-leads** for the source of truth (does admin/billing write `feature_entitlements` and the resolver read it, or is an external billing API authoritative with DB as cache?). Spec assumes DB-leads with optional external resolver; confirm with the grant-source owner. (If resolver-leads is ever chosen, the expiry-fallback and per-key-validity gaps — FR-017 — get harder; decide before the schema lands.)
3. **Thinner vs fuller Phase 1.** The fuller design (dedicated `feature_catalog` + `feature_entitlements` + `entitlement_decisions` + resolver-fronting) is the right *destination* — needed for billing integration and compliance. A thinner first cut (single grants table + `FeatureGate` + reuse `content.operation_logs` for audit) could ship the individual path faster. The plan should explicitly adopt or reject the thinner path rather than defaulting to the full schema.
4. **Subject model** — settled by FR-019: the **actor is always the individual user**, and `tenant` grants are *inherited via membership union*, not an alternative subject the user picks. Not "either/or." Phase 1 issues `user` grants; Phase 1.5 adds `tenant` grants that flow to members. Remaining sub-decision: do we ever allow a feature to be *user-only* (non-inheritable, e.g. a personal-seat add-on) — i.e. a per-grant "inheritable" flag — or is every tenant grant always inherited?
5. **Revocation latency SLA** — max acceptable time a revoked/expired grant stays live (bounds the default cache TTL and decides whether the cross-instance pub/sub bus of FR-018 is needed now or deferred to TTL-only).
6. **Phase 1 in-tree ownership map vs minimal registry** — Phase 1 can gate in-tree add-on tools with a static ownership map; decide whether to ship the mutable tool registry early (smooths Phase 2) or defer it. (Note: the static map is a manual-sync risk — a new add-on tool added without an ownership entry ships ungated; consider a registration-time assertion.)
7. **Core API versioning policy** — semver discipline and deprecation window for the SDK surface (Phase 2).
8. **Inheritance granularity — site license vs capped seats (architecture).** Does an org add-on grant mean **every member inherits** (org-wide site license — what FR-019's union ships) or **N assigned seats of M members** (capped)? Capped seats need a seat-assignment table and change FR-019's union to "tenant grant *where the user holds a seat*." A productization choice with a direct schema consequence — resolve before Phase 1.5. Phase 1 (individuals) is unaffected.
