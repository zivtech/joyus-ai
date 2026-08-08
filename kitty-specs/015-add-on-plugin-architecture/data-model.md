# Data Model: Add-on / Plugin Architecture and Feature Entitlements

**Spec:** 015 | **Target repo:** joyus-ai (`joyus-ai-mcp-server`)
**Date:** 2026-06-14

This document defines the new persistence introduced by Spec 015 and how it relates to the existing entitlement schema. It does **not** restate existing tables except where contrast matters.

---

## 1. Relationship to the existing schema

The existing entitlement system lives entirely in the `content` Postgres schema:

- `content.products` (`src/content/schema.ts:133-144`) — `{id, tenantId, name, description, isActive}`. No `kind`/`tier`/`feature` discriminator.
- `content.entitlements` (`src/content/schema.ts:166-179`) — `{id, tenantId, userId, sessionId, productId→products, resolvedFrom, resolvedAt, expiresAt}`. **Session-scoped, TTL-based.** A grant exists only for the life of a mediation session.

These are **content-access** primitives (which data sources a session may query). They are the wrong granularity for **feature/add-on licensing**, which is a durable, subject-level fact ("Tenant X is licensed for add-on Y until 2027-01-01"), independent of any session.

Spec 015 therefore introduces a **new, platform-level** schema (`entitlements`) rather than overloading `content.entitlements`. Both build on the same *generic* resolver/cache abstractions (see Research §2).

> Proposed home: a new `entitlements` Postgres schema (`src/entitlements/schema.ts`), registered in `drizzle.config.ts` alongside the existing six schema files. The generic `EntitlementResolver` interface, `HttpEntitlementResolver`, and `EntitlementCache` are extracted to `src/entitlements/core/` and imported by both the content module and the new feature module (refactor, not rewrite).

---

## 2. New tables (Phase 1 — Entitlement layer)

### `entitlements.feature_catalog`
The catalog of licensable features/add-ons. The authoritative list of entitlement keys. Marketplace-ready identity, but no marketplace mechanics.

| Column | Type | Notes |
|---|---|---|
| `feature_key` | `text` PK | Stable, reverse-DNS style, e.g. `com.joyus.addon.advanced-pipelines`. Never reused. |
| `display_name` | `text` NOT NULL | Human label. |
| `description` | `text` | |
| `publisher` | `text` NOT NULL | `joyus` for first-party; publisher id for third-party (Phase 2). |
| `capability_kinds` | `jsonb` NOT NULL | Which contribution kinds this add-on may provide: `["tool","provider","pipeline_step","connector","hook"]`. Advisory metadata for the catalog/marketplace. |
| `status` | `text` NOT NULL | `active` \| `deprecated` \| `withdrawn`. |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | |

### `entitlements.feature_entitlements`
Persistent grants. The source of truth / local fallback for "who may use what." Distinct from `content.entitlements` in lifecycle (durable, not session-scoped) and semantics (explicit deny on absence).

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | cuid. |
| `subject_type` | `text` NOT NULL | `tenant` \| `user`. **Billing-unit-agnostic.** **No DB default** — the application always supplies an explicit subject. Phase 1 issues `user` grants (individual-first, FR-019); `tenant` grants arrive with WP12. Do not encode a `tenant` default at the column level. |
| `subject_id` | `text` NOT NULL | tenantId or userId per `subject_type`. |
| `feature_key` | `text` NOT NULL | FK → `feature_catalog.feature_key` (RESTRICT on delete). |
| `status` | `text` NOT NULL | `active` \| `suspended` \| `expired` \| `revoked`. |
| `valid_from` | `timestamp` NOT NULL | |
| `valid_until` | `timestamp` NULL | NULL = perpetual until revoked. |
| `source` | `text` NOT NULL | `admin` \| `resolver` \| `trial` \| `import`. Provenance for audit. |
| `limits` | `jsonb` NULL | Optional quota envelope, e.g. `{"maxRunsPerMonth":1000}`. Enforcement of limits is mostly out of scope (see spec §10); the column exists so the gate boundary can carry them later. |
| `metadata` | `jsonb` NULL | Free-form (e.g. billing reference, plan id). |
| `created_at` | `timestamp` NOT NULL | |
| `updated_at` | `timestamp` NOT NULL | |

**Indexes / constraints**
- `UNIQUE (subject_type, subject_id, feature_key)` — one live grant row per subject+feature (status transitions update in place; history goes to the decision log / event stream).
- `INDEX (subject_type, subject_id, status)` — the hot path for `resolve(subject)`.
- `INDEX (feature_key)` — catalog-side queries ("who has add-on Y").
- Partial index `(subject_type, subject_id) WHERE status = 'active'` for fast active-set resolution.

**Query semantics (FR-017) — required, not optional.** Every read that decides entitlement (resolve *and* the resolver-outage DB fallback) MUST filter `status = 'active' AND (valid_until IS NULL OR valid_until > now())`. The existing content DB-fallback selects the most-recent row *without* an expiry filter (`content/entitlements/index.ts`); copying it verbatim would serve a lapsed paid grant during an outage. The cached resolved set is the post-filter set, and cache TTL is capped at time-to-next-expiry so no grant outlives `valid_until` by more than one TTL.

**Write path (FR-015).** Rows are created/modified/revoked only through the authorized operator grant surface (operator REST endpoint and/or admin-only MCP tool), never by tenant-user code paths and not as a raw-SQL contract. Each write records actor identity to the decision/grant-history log. This is the attachment point for billing automation later (`source=resolver|import`).

> Isolation note: `subject_id` is a naked string today (no `tenants` table — `orchestrator.ts:15`). When subject_type=`tenant`, `subject_id` is the same opaque `tenantId` used platform-wide. There is **no** FK to a tenants table because none exists (WP12). This table inherits the platform's current soft-isolation posture; see spec §3 Security and Dependencies.

> **Effective-entitlement resolution (spec FR-019) — individual-first, org-layered.** The gate evaluates a *user*, whose effective set is the union of grants for `{user:U} ∪ {tenant:T | U ∈ members(T)}`. **Pre-WP12** there is no membership source, so the union degrades to `{user:U}` and the individual path works against this table alone. **Post-WP12** the resolver also reads tenant↔user membership (a WP12-owned table, not defined here) and unions in `tenant` grants — so one tenant row entitles every member with no per-user fan-out. This table needs **no change** to support inheritance; the union lives in the resolver/gate. Open sub-decision (spec §11.4): an optional per-grant `inheritable` flag if some tenant grants should *not* flow to all members.

### `entitlements.entitlement_decisions` (append-only audit)
Every gate decision is recorded. There is no dedicated entitlement-decision audit today; the existing `*.operation_logs` tables are operation audits, and `content.entitlements` is a live grant table, not append-only.

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | |
| `subject_type` | `text` NOT NULL | |
| `subject_id` | `text` NOT NULL | |
| `feature_key` | `text` NOT NULL | |
| `decision` | `text` NOT NULL | `allow` \| `deny`. |
| `reason` | `text` NOT NULL | `entitled` \| `not_entitled` \| `expired` \| `suspended` \| `limit_exceeded` \| `resolver_unavailable_fallback_deny`. |
| `resolved_from` | `text` NOT NULL | `cache` \| `resolver` \| `db` \| `default_deny`. Mirrors the existing `resolvedFrom` convention. |
| `capability` | `text` NULL | e.g. `tool:advanced_pipeline_run`. What was being gated. |
| `actor_id` | `text` NULL | Who initiated the decision when it is an **admin action** (grant/revoke). NULL for routine gate checks (the subject is the actor). Required so FR-015 grant/revoke writes carry actor identity in an append-only record. |
| `session_id` | `text` NULL | When available. |
| `created_at` | `timestamp` NOT NULL | |

**Constraints**: APPEND-ONLY (no UPDATE/DELETE), following the `orchestrator_events` precedent (`src/db/schema/events.ts`). Indexes: `(subject_type, subject_id, created_at)`, `(feature_key, created_at)`.

---

## 3. New persistence (Phase 2 — Plugin host)

Plugin **identity and contributions** are mostly declared in code (the manifest is a TypeScript/JSON object shipped by the add-on package), so Phase 2 adds little schema. One operational table tracks load state:

### `entitlements.installed_plugins`
Operator-facing record of which plugin packages are configured to load and their last-known health. Distinct from entitlements (which gate *use*); this tracks *installation*.

| Column | Type | Notes |
|---|---|---|
| `plugin_id` | `text` PK | Reverse-DNS, matches manifest `id`. |
| `version` | `text` NOT NULL | semver, from manifest. |
| `enabled` | `boolean` NOT NULL | Operator toggle. |
| `core_api_range` | `text` NOT NULL | Declared compatible core API semver range. |
| `provides` | `jsonb` NOT NULL | Contribution descriptors from the manifest. |
| `requires_features` | `jsonb` NOT NULL | Entitlement keys the plugin's gated contributions require. |
| `health` | `text` NOT NULL | `loaded` \| `failed` \| `incompatible` \| `disabled`. |
| `last_error` | `text` NULL | |
| `loaded_at` | `timestamp` NULL | |

> A "tenant installs a plugin" model (per-tenant plugin install) is **out of scope** for Spec 015 — installation is operator/deployment-level here. Per-tenant install is a marketplace concern (W6).

---

## 4. Migration approach

Follows the established pattern (Research §6): add `src/entitlements/schema.ts` to the `schema` array in `drizzle.config.ts`, generate with `drizzle-kit`, commit the SQL under `drizzle/migrations/00NN_*.sql` with a journal entry. No data backfill is required — Phase 1 starts with an empty catalog and grants created by admin/import. Existing `content.*` tables are untouched (additive only); the only change to existing code paths is the (mechanical) extraction of the generic resolver/cache into `src/entitlements/core/` with re-exports kept in `src/content/entitlements/` for source compatibility.

---

## 5. What is deliberately NOT modeled here

- **No `tenants`/`plan`/`subscription` table.** Spec 015 consumes whatever produces grants (admin action, a billing resolver). Building the billing/subscription system is out of scope (spec §10); `feature_entitlements.source` and `metadata` carry the linkage.
- **No token/cost usage tables.** Usage-based entitlements depend on W3 (cost capture); the `limits` column is a forward hook only.
- **No RLS policies.** Isolation remains application-level (W5 dependency). The new tables follow the same "all queries MUST filter by subject" rule as the rest of the schema.
