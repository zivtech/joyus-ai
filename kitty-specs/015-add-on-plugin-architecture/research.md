# Research: Add-on / Plugin Architecture and Feature Entitlements

This document checks every claim about the **current codebase** in `spec.md`, `data-model.md`, `plan.md`, and the WP prompts against the open-source tree. The code was checked at `main` commit `7a330234`, the commit merged into this branch. All paths are relative to `joyus-ai-mcp-server/` unless they start at the repo root.

It was written from the public repository alone. The original code-reasoning analysis and all commercial strategy stay in the private planning repo; nothing here depends on them.

**Result:** 38 claims checked.

| Status | Count | Meaning |
|---|---|---|
| Confirmed | 21 | True, and the cited lines are correct |
| Confirmed with line drift | 7 | True, but the code has moved |
| Partial | 3 | Partly true; the difference is stated below |
| Out of date | 7 | False at `7a330234` |

Four of the out-of-date premises affect sequencing and should be resolved before Phase 1 planning is treated as final. They are listed first.

---

## Findings that change the plan (read first)

### F1: Tenant membership and shared tenant resolution already exist

**Spec premise:** there is no tenant system, and tenant↔user membership is a future prerequisite (Spec 013, "spec-only"). Org-level entitlement (Phase 1.5) waits on it. See §1 Phasing, §8 Dependencies, §11.1, the Adoption Plan, and `data-model.md` §1.

**Code at HEAD:**
- `tenant_memberships` exists, with `role` (`member | admin | operator`) and `isDefault`: `src/db/schema.ts:50-54` (enum) and `:72-88` (table). It was created by `drizzle/migrations/0009_tenant_memberships.sql`.
- A shared resolver, `resolveTenantContextForUser` / `resolveTenantContext` in `src/tenancy/resolver.ts`, does default-tenant lookup and authorizes requested tenants against memberships. It fails closed on lookup errors. It landed with the "add shared tenant resolution" commit and two hardening follow-ups.

Spec 013 is **partially implemented**, even though its `meta.json` still says `spec-only`. The membership table and resolver exist. The `tenants` and `tenant_access_audit` tables from Spec 013's plan do not.

**Impact:** the FR-019 union (user grants ∪ grants of the user's tenants) can read `tenant_memberships` today. The remaining Phase 1.5 prerequisites are:
- the missing `tenants` table, if the union needs tenant rows rather than opaque ids
- isolation hardening, which is still open

The phasing rationale, the §8 dependency text, and the Adoption Plan should be updated.

### F2: Tool dispatch does not collapse `tenantId` to `userId`, except on the `approval_` path

**Spec premise:** tool execution derives the tenant from an ambient `tenantId == userId` collapse (`executor.ts:104`), so the gate must take an explicit subject. See §3 Security, §7 Assumptions, §9 Edge Cases, plan Security Considerations, and WP05.

**Code at HEAD:**
- `ops_`, `content_`, `profile_`, and `pipeline_` tools resolve the tenant through `resolveToolTenantId` → `resolveTenantContextForUser`, using a real membership lookup (`src/tools/executor.ts:102-119`). Line 104 is a comment inside that function.
- The only literal collapse is on the `approval_` prefix: `const tenantId = userId; // tenant resolution deferred` (`src/tools/executor.ts:152-158`).

**Impact:** the explicit-subject requirement still stands; it is good practice. But the rationale should cite the `approval_` path, not the content/profile/pipeline paths. The `approval_` prefix is also **missing from FR-016's enumeration of gated call sites**. It is a separate dispatch branch that needs its own gating decision.

### F3: An operator role already exists

**Spec premise:** there is no operator/admin tier, so WP04 introduces an `OPERATOR_USER_IDS` allowlist for the grant-administration surface (FR-015).

**Code at HEAD:**
- The `tenant_role` enum includes `operator` (`src/db/schema.ts:50-54`).
- `findOperatorMembership` (`src/tenancy/resolver.ts:162`) gives operators platform-wide context (`:186-200`).
- `/event-adapter/admin` already requires operator membership for platform-wide access (`src/index.ts:376` onward).

**Impact:** an env allowlist would create a second, parallel operator concept. FR-015's authorization model should reuse the membership-backed operator role, or state why not.

### F4: Usage capture already exists

**Spec premise:** `AnthropicGenerationProvider` returns no usage, so usage-based limits stay inert until cost capture lands. See §8 Dependencies (cost/usage capture) and §9 Edge Cases (`limits` without metering).

**Code at HEAD:**
- The provider returns `usage: normalizeAnthropicUsage(...)` (`src/content/generation/anthropic-provider.ts:70`).
- `GenerationService` already resolves cost and accumulates per-session token and cost totals (`src/content/generation/index.ts:87-104` and `:158-182`, plus `src/content/generation/cost.ts`).

**Impact:** metering for `limits` is closer than the spec says. The dependency is on wiring usage into entitlement limits, not on building capture.

### F5: WP01's migration instructions are out of date

**WP01 premise:** the `drizzle.config.ts` schema array has 6 entries, and the next migration is `0008_entitlements_schema.sql`.

**Code at HEAD:**
- The array has **10 entries** (`drizzle.config.ts:4-14`). WP01's sample lists only 6, so copying it would drop `db/schema/coordination.ts`, `db/schema/approvals.ts`, `event-adapter/schema.ts`, and `exports/schema.ts` from the config.
- The highest migration is `0012_jira_a11y_triage_scheduler.sql`, so the next is **0013**.
- WP01 also cites `src/content/schema.ts:4-11` for the config array. Those lines are that file's header, not `drizzle.config.ts`.

**Impact:** update WP01 before implementation. Add one entry to the current array; do not replace the array.

---

## Confirmed premises

These hold at HEAD. The design's reuse argument depends on them.

**The resolver machinery is reusable as specified.**

| Claim | Evidence |
|---|---|
| `EntitlementResolver` interface | `src/content/entitlements/interface.ts:47-53` |
| `HttpEntitlementResolver` defaults to a 2000ms timeout | `src/content/entitlements/http-resolver.ts:8` and `:60` |
| `EntitlementCache` is an in-process `Map`, so cross-instance invalidation is a real gap (FR-018) | `src/content/entitlements/cache.ts:24-25` |

**The content entitlement semantics are as described.**

| Claim | Evidence |
|---|---|
| `content.entitlements` is session-scoped and TTL-based | `src/content/schema.ts:166-179` |
| The DB fallback takes the most recent row with no `expiresAt` filter, so reusing it verbatim would serve lapsed grants during an outage (FR-017) | `src/content/entitlements/index.ts:74-110` |
| No `assertEntitled` or equivalent gate exists anywhere in `src/` (repo-wide search, zero hits) | — |

**The known bypass exists (FR-016).** `content_search` builds a `ResolvedEntitlements` literal (`resolvedFrom: 'tool-executor'`) and passes it straight to search, skipping the resolver, cache, and `EntitlementService`. The literal is at `src/tools/executors/content-executor.ts:223-229`, inside `:217-231`. The LIKE-search fallback is at `:256-312`.

**Precedents and seams the spec relies on:**

| Claim | Evidence |
|---|---|
| Append-only `orchestrator_events` (no `update`/`delete` against it anywhere) | `src/db/schema/events.ts:42` |
| `GenerationService` provider selection | `src/content/index.ts:69-78` |
| `ContentGenerator.generate()` → `provider.generate()` | `src/content/generation/generator.ts:31-38` |
| `StepType` is a closed union of 6 literals | `src/pipelines/types.ts:25-27` |
| `SKILLS_DIR` config pattern, the precedent for the FR-012 allowlist | `src/orchestrator/skill-loader.service.ts:83-84` |
| Single package, no workspaces (FR-009's split is net-new) | `package.json` |
| `pgSchema` per domain | `content` at `src/content/schema.ts:32`; `profiles` at `src/profiles/schema.ts:29` |
| `$inferSelect` / `$inferInsert` type exports | `src/content/schema.ts:374-408` |
| Bearer auth: `verifyMcpToken` | `src/auth/verify.ts:26` |
| Bearer auth: `requireBearerToken` | `src/auth/middleware.ts:26-49` |
| `content_resolve_entitlements` is a diagnostic tool | `src/tools/executors/content-executor.ts:357` |
| `content_generate` returns a placeholder | `src/tools/executors/content-executor.ts:428-453` |
| `ContentExecutorContext` shape | `src/tools/executors/content-executor.ts:21-26` |

### Partially true

**Content coupling in `EntitlementService` (§7 Assumptions).**
- The two product-join methods, `getAccessibleSourceIds` and `getAccessibleProfileIds` (`src/content/entitlements/index.ts:171` and `:201`), are public, not private.
- `resolve()`'s DB fallback also reads `content.entitlements` directly.
- `EntitlementService` as a whole is therefore content-coupled. The interface, cache, and HTTP resolver are not, and they are exactly what the `core/` extraction reuses. The design holds; the assumption's wording overstates the isolation.

**`executeTool` dispatch ranges (FR-016, WP03, WP05).** The prefixes are right, but the ranges moved by 15–40 lines:

| Prefix | Current lines in `src/tools/executor.ts` |
|---|---|
| `ops_` | 126 |
| `content_` | 137-145 |
| `profile_` | 147-150 |
| `approval_` | 152-158 (undocumented; see F2) |
| `pipeline_` | 160-171 |
| OAuth registry | 173-223 |

**The `/event-adapter/admin` auth model (WP04).**
- The route is at `src/index.ts:376`.
- Its primary path is an OAuth session user; `session.adminUserId` is only a one-time-token fallback.
- It now also resolves tenant context with platform-wide access for operators.

## Citation drift (claim true, lines moved)

| Claim | Cited | Current |
|---|---|---|
| `ResolvedEntitlements` shape | `content/types.ts:76-84` | `src/content/types.ts:81-88` |
| `content.products` table | `content/schema.ts:133-144` | `src/content/schema.ts:133-143` |
| `getAllTools(userId)` filters by connected service | `tools/index.ts:32-62` | `src/tools/index.ts:33-69` |
| `ToolDefinition` shape | `tools/index.ts:19-27` | `src/tools/index.ts:20-28` |
| `users` table (no role column; roles live on memberships, see F3) | `db/schema.ts:54-60` | `src/db/schema.ts:61-68` |
| Content cache invalidated only on session close | `mediation/router.ts:259` | `src/content/mediation/router.ts:355` (route at 341-361) |
| `ConnectorRegistry.getOrThrow()` | `connectors/registry.ts:21-27` | `src/content/connectors/registry.ts:21-30` |

## Method

- **Extraction:** every sentence in `spec.md`, `data-model.md`, `plan.md`, `tasks.md`, and `tasks/WP01`–`WP06` that asserts a fact about existing code was extracted. Claims about what will be built were skipped. Duplicates across files were merged.
- **Checking:** each claim was checked by reading the cited file at `7a330234`. Where a cited range no longer showed the code, the current range was located.
- **Absence claims** were checked with repo-wide searches over `joyus-ai-mcp-server/src`:
  - `assertEntitled`: zero hits.
  - `update(orchestratorEvents)` / `delete(orchestratorEvents)`: zero hits.
  - `tenants` table definitions: none. Only `tenant_memberships` exists.
- **Spot checks:** refuted and drifted claims were re-read directly before being recorded.
- **Not covered:** runtime behavior was not executed; this is a static read. Claims about Spec 013's intended schema come from its own `plan.md` and `tasks.md`.
