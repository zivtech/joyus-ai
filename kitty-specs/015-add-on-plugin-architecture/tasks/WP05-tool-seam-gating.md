---
work_package_id: "WP05"
title: "Tool-Seam Gating"
lane: "planned"
dependencies: ["WP02", "WP03"]
subtasks: ["T027", "T028", "T029", "T030", "T031", "T032"]
history:
  - date: "2026-06-14"
    action: "created"
    agent: "claude-opus"
---

# WP05: Tool-Seam Gating

**Implementation command**: `spec-kitty implement WP05`
**Target repo**: `joyus-ai`
**Dependencies**: WP02 (FeatureGate decision core), WP03 (Un-forgeable gated-path enforcement)
**Priority**: P1

## Objective

Wire feature-entitlement gating into the MCP tool seam (both visibility via `getAllTools` and execution via `executeTool`) and into the provider/step/connector call sites, so that add-on-owned capabilities are hidden and blocked for unentitled subjects, while core/free tools remain fully unaffected. Phase 1 uses a static ownership map as the bridge until the Phase 2 plugin registry replaces it. All gated invocations go through a `GateToken` minted by `FeatureGate.assertEntitled` (from WP03) — never a raw boolean check.

## Context

### The existing `getAllTools` filter

`src/tools/index.ts` (lines 32–62) already filters by connected OAuth service before returning the tool list. The function builds a base array of `[opsTools, contentTools, pipelineTools, profileTools]` (always present) and conditionally appends service-gated arrays (`googleTools`, `jiraTools`, `slackTools`, `githubTools`) depending on which connections exist in the DB for the given `userId`. This filter must be **preserved exactly**. WP05 adds a second, orthogonal filter on top of it: tools in the base array (or any service array) that are add-on-owned are additionally filtered by entitlement. The two filters compose — a tool must pass both the connection check and the entitlement check to appear.

### The existing `executeTool` dispatch

`src/tools/executor.ts` (lines 96–182) dispatches by tool-name prefix:
- `ops_` → `executeOpsTool` (core/free, never gated)
- `content_` → `executeContentTool` (with `tenantId = userId` interim collapse at line 104)
- `profile_` → `executeProfileTool` (with same `tenantId = userId` collapse at line 114)
- `pipeline_` → `executePipelineTool` (with same collapse at line 119)
- OAuth-prefixed (`jira_`, `slack_`, `github_`, `gmail_`, `drive_`, `docs_`) → OAUTH_PREFIX_REGISTRY lookup, then connection fetch + token refresh + `executeFunction`

Only add-on-owned tools within these prefix groups are gated. Core tools (`ops_`, and any non-add-on `content_`/`profile_`/`pipeline_` tools) pass through without a gate call.

### The ownership map as Phase 1 bridge

Phase 2 will have a mutable plugin registry where each registered tool declares its `feature_key`. Phase 1 has no such registry — tool registration is static (each `*-tools.ts` file exports a hard-coded array). The `ownership.ts` static map is the Phase-1 bridge: it enumerates which tool names/prefixes are add-on-owned and what `feature_key` gates them. The map covers **only** add-on tools; absence from the map means core/free (default allow). This map is replaced wholesale in Phase 2 when the plugin host takes over registration.

### The GateToken

`FeatureGate.assertEntitled` (WP02/WP03) returns an opaque, non-constructible `GateToken`. Gated code paths require this token as a parameter — they cannot be reached by passing a hand-constructed entitlement object. The token proves the gate ran before any gated work begins. WP05 calls `assertEntitled` and threads the resulting token into the appropriate executor. The token is not stored beyond the immediate call; it is single-use proof-of-authorization for the current invocation.

### Subject resolution

In Phase 1, the subject is the individual user. The gate is called with `{ subject_type: 'user', subject_id: userId }` — explicitly constructed, never inferred from ambient state. The `tenantId === userId` collapse in `executor.ts` (lines 104, 114, 119) is an unrelated interim measure for downstream content/profile/pipeline logic; WP05 must not conflate the two. The gate always receives an explicit `Subject`.

### Provider/step/connector gating (FR-008)

These non-tool contributions run inside trusted core services:
- **GenerationService** — provider is injected via DI in `src/content/index.ts` (lines 69–74); the generation call site in `src/content/generation/generator.ts` is the gating point for add-on generation providers.
- **StepRegistry** — `src/pipelines/steps/registry.ts`; step handlers are invoked via `registry.execute(stepType, ...)`.
- **ConnectorRegistry** — `src/content/connectors/index.ts`; connectors are invoked via `registry.sync(...)` or equivalent.

Each of these registries can hold both core (free) and add-on contributions. An add-on contribution declares a `requiredFeatureKey` field at registration time; the core asserts entitlement before invoking it. Core contributions carry no `requiredFeatureKey` and bypass the gate.

---

## Subtasks

### T027: `src/entitlements/ownership.ts` — Static add-on tool ownership map

**Purpose**: Provide a Phase-1 bridge that maps add-on-owned tool names/prefixes to their `feature_key`, without touching the static tool-definition arrays. Only add-on tools appear in the map; core/free tools are absent (absence = default allow). In Phase 2 this file is deleted and the plugin registry takes over.

**Steps**:
1. Create `src/entitlements/ownership.ts`.
2. Define the `ADD_ON_TOOL_OWNERSHIP` map as a `ReadonlyMap<string, FeatureKey>` keyed by either exact tool name or prefix (e.g. `'advanced_pipeline_'`). Use the `FeatureKey` branded type from WP01 types.
3. Export a `getFeatureKeyForTool(toolName: string): FeatureKey | undefined` helper that checks exact-name first, then prefix, then returns `undefined` for core tools.
4. Document clearly: returning `undefined` means the tool is core/free and must not be gated.

**Inline reference shape**:

```typescript
// src/entitlements/ownership.ts
import type { FeatureKey } from './types.js';

/**
 * Phase-1 static ownership map: add-on tool name (or prefix ending in '_') → feature_key.
 *
 * ABSENCE from this map means core/free — the tool is available to everyone
 * and must never be gated. Do not add core tools here.
 *
 * Phase 2: deleted and replaced by the plugin registry.
 */
export const ADD_ON_TOOL_OWNERSHIP: ReadonlyMap<string, FeatureKey> = new Map([
  // Example entries — populate with real add-on tools as they are built:
  // ['advanced_pipeline_', 'com.joyus.addon.advanced-pipelines' as FeatureKey],
  // ['content_semantic_search', 'com.joyus.addon.semantic-search' as FeatureKey],
]);

/**
 * Returns the feature_key that gates this tool, or undefined if the tool is
 * core/free and must not be gated.
 *
 * Checks exact name first, then prefix (entries whose key ends with '_').
 */
export function getFeatureKeyForTool(toolName: string): FeatureKey | undefined {
  // Exact match
  if (ADD_ON_TOOL_OWNERSHIP.has(toolName)) {
    return ADD_ON_TOOL_OWNERSHIP.get(toolName);
  }
  // Prefix match (keys ending in '_' are treated as prefixes)
  for (const [key, featureKey] of ADD_ON_TOOL_OWNERSHIP) {
    if (key.endsWith('_') && toolName.startsWith(key)) {
      return featureKey;
    }
  }
  return undefined;
}
```

**Files**:
- `src/entitlements/ownership.ts` (new, ~35 lines)

**Validation**:
- [ ] `getFeatureKeyForTool('ops_health')` returns `undefined` (core tool, never in map)
- [ ] `getFeatureKeyForTool('content_search')` returns `undefined` (core tool, never in map)
- [ ] `getFeatureKeyForTool` returns the correct `FeatureKey` for any name/prefix in the map
- [ ] `tsc --noEmit` passes with zero errors

**Edge Cases**:
- The map starts empty in Phase 1 until real add-on tools are registered. Empty map = all tools are core = no entitlement gating = correct behavior for the free product at launch.
- A prefix key MUST end with `_` (the conventional tool-name separator). A key without a trailing `_` is treated as an exact name only.
- If a tool matches both an exact key and a prefix key, the exact key wins (checked first).

---

### T028: `getAllTools()` — Omit add-on tools the subject lacks (FR-007)

**Purpose**: After the existing connected-service filter runs, additionally remove add-on-owned tools whose `feature_key` the subject's effective entitlement does not include. Core/free tools are untouched regardless of entitlement state.

**Steps**:
1. Modify `src/tools/index.ts` — `getAllTools(userId: string)`.
2. After the existing service-connection filter builds the `tools` array, call `FeatureGate.isEntitled` for each unique `feature_key` found via `getFeatureKeyForTool` across the collected tools.
3. Batch the entitlement checks by unique feature key (one resolve per key, not one per tool) to stay within the < 10ms p95 budget.
4. Filter out any tool whose `getFeatureKeyForTool` returns a key the subject is not entitled to.
5. Tools where `getFeatureKeyForTool` returns `undefined` pass through unconditionally — they are core/free.

**Inline reference shape**:

```typescript
// src/tools/index.ts — additions to getAllTools()
import { getFeatureKeyForTool } from '../entitlements/ownership.js';
import { featureGate } from '../entitlements/index.js';

export async function getAllTools(userId: string): Promise<ToolDefinition[]> {
  // --- Existing connected-service filter (unchanged) ---
  const userConnections = await db
    .select({ service: connections.service })
    .from(connections)
    .where(eq(connections.userId, userId));

  const connectedServices = new Set(userConnections.map((c) => c.service));
  const tools: ToolDefinition[] = [...opsTools, ...contentTools, ...pipelineTools, ...profileTools];

  if (connectedServices.has('GOOGLE')) tools.push(...googleTools);
  if (connectedServices.has('JIRA'))   tools.push(...jiraTools);
  if (connectedServices.has('SLACK'))  tools.push(...slackTools);
  if (connectedServices.has('GITHUB')) tools.push(...githubTools);

  // --- Add-on entitlement filter (layered on top; does not affect core tools) ---
  const subject = { subject_type: 'user' as const, subject_id: userId };

  // Collect unique feature keys referenced by any tool in the list
  const featureKeys = new Set<string>();
  for (const tool of tools) {
    const key = getFeatureKeyForTool(tool.name);
    if (key !== undefined) featureKeys.add(key);
  }

  // Resolve entitlement for each unique key (cache hit is sub-millisecond)
  const entitled = new Map<string, boolean>();
  await Promise.all(
    [...featureKeys].map(async (key) => {
      entitled.set(key, await featureGate.isEntitled(subject, key as FeatureKey));
    })
  );

  // Keep tool if: (a) it is core/free (no feature key), OR (b) the subject is entitled
  return tools.filter((tool) => {
    const key = getFeatureKeyForTool(tool.name);
    return key === undefined || entitled.get(key) === true;
  });
}
```

**Files**:
- `src/tools/index.ts` (modified — add imports + entitlement filter after existing service filter)

**Validation**:
- [ ] Core tools (`ops_*`, `content_*` with no ownership entry) are always present regardless of entitlement state
- [ ] An add-on tool is absent for an unentitled user and present for an entitled user
- [ ] The existing connected-service filter still works: a `jira_` tool requires both the JIRA connection AND entitlement (if add-on-owned)
- [ ] `getAllTools` for a user with zero add-on grants returns the same result as today (no regression)
- [ ] `tsc --noEmit` passes with zero errors

**Edge Cases**:
- `featureGate.isEntitled` must never throw — it is documented non-throwing (WP02). If the resolver is down, it returns `false` (fail-closed). No try/catch needed here, but confirm WP02 upholds this.
- An empty `ADD_ON_TOOL_OWNERSHIP` map means `featureKeys` is empty and the filter pass-through is a no-op. Correct for Phase 1 before any add-ons ship.
- Do not call `isEntitled` for tools with `undefined` feature key — pointless DB/cache work and risks false-excluding core tools on a future code path.

---

### T029: `executeTool()` — Assert entitlement before add-on dispatch (FR-007)

**Purpose**: Before dispatching any add-on-owned tool, call `FeatureGate.assertEntitled` to obtain a `GateToken`. On deny, return a structured "upgrade required" error (not an exception, not an empty result). Core tools bypass the gate entirely — no code path change for `ops_`, non-add-on `content_`, `profile_`, or `pipeline_` tools.

**Steps**:
1. Modify `src/tools/executor.ts` — `executeTool(userId, toolName, input)`.
2. At the top of `executeTool`, before any prefix dispatch, call `getFeatureKeyForTool(toolName)`.
3. If a feature key is found, call `featureGate.assertEntitled(subject, featureKey)` — catching `FeatureNotEntitledError` and returning the structured upgrade-required payload.
4. If `assertEntitled` succeeds, it returns a `GateToken`. Pass this token to the downstream executor as proof the gate ran. (In Phase 1 where executors do not yet accept a `GateToken` param, hold it as a `const _token = ...` — the type-system proof that `assertEntitled` was called before dispatch is the structural guarantee WP03 requires; the token value itself is passed in Phase 2 when executor signatures are updated.)
5. If no feature key is found (core/free tool), skip the gate entirely.

**Inline reference shape**:

```typescript
// src/tools/executor.ts — additions to executeTool()
import { getFeatureKeyForTool } from '../entitlements/ownership.js';
import { featureGate } from '../entitlements/index.js';
import { FeatureNotEntitledError } from '../entitlements/errors.js';
import type { FeatureKey } from '../entitlements/types.js';

export async function executeTool(
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  // --- Entitlement gate (add-on tools only; core tools fall through immediately) ---
  const featureKey = getFeatureKeyForTool(toolName);
  if (featureKey !== undefined) {
    const subject = { subject_type: 'user' as const, subject_id: userId };
    try {
      // assertEntitled mints a GateToken — proof the gate ran before dispatch.
      // Phase 1: _gateToken held here; Phase 2: threaded into executor signature.
      const _gateToken = await featureGate.assertEntitled(subject, featureKey, toolName);
      void _gateToken; // used as structural proof; suppress unused-var lint
    } catch (err) {
      if (err instanceof FeatureNotEntitledError) {
        // Return structured upgrade-required payload — not an exception, not empty.
        return {
          error: 'feature_not_entitled',
          featureKey: err.featureKey,
          message: `This capability requires the '${err.featureKey}' add-on. Upgrade your plan to unlock it.`,
          upgrade: {
            featureKey: err.featureKey,
            reason: err.reason,
          },
        };
      }
      throw err; // unexpected errors propagate normally
    }
  }

  // --- Existing dispatch (unchanged below this line) ---

  if (toolName.startsWith('ops_')) {
    return executeOpsTool(toolName, input, { userId });
  }
  // ... rest of existing dispatch unchanged ...
}
```

**Files**:
- `src/tools/executor.ts` (modified — add gate block at top of `executeTool`, before existing prefix dispatch)

**Validation**:
- [ ] Calling an add-on tool without entitlement returns `{ error: 'feature_not_entitled', featureKey, ... }` — not an exception, not null, not empty
- [ ] Calling an add-on tool with valid entitlement dispatches normally (no change in behavior)
- [ ] Calling any core tool (`ops_`, `content_search`, etc. with no ownership entry) does not call `assertEntitled` — zero gate overhead on the free path
- [ ] `tsc --noEmit` passes with zero errors
- [ ] The upgrade error payload shape matches the MCP error mapping defined in WP02 (T013)

**Edge Cases**:
- `FeatureNotEntitledError` must be imported from the WP02 error types, not caught as a generic `Error`. If a different error class is used in WP02, match it exactly.
- The `_gateToken` is intentionally unused in Phase 1 — the structural guarantee is that `assertEntitled` was called before any dispatch. A lint rule (e.g. `@typescript-eslint/no-unused-vars` suppressed with `void _gateToken`) should be used rather than removing the token call.
- Do not move the gate below the `ops_` check. The gate must be the first thing that runs for add-on tools; putting it after any dispatch-shortcut risks a race or bypass.
- The subject is always `{ subject_type: 'user', subject_id: userId }` in Phase 1. Never infer from `tenantId`. The `tenantId === userId` collapse for downstream executors (lines 104, 114, 119 of the current file) is unrelated and must not change.

---

### T030: Provider/step/connector gating at enumerated call sites (FR-008)

**Purpose**: Gate non-tool add-on contributions at their invocation boundaries in the trusted core services. A contribution declares `requiredFeatureKey?: FeatureKey` at registration time; the core asserts before invoking it. Core contributions with no `requiredFeatureKey` are unaffected. The set of call sites is finite and enumerated here.

**Steps**:

**Step A — Extend contribution registration types**:
1. In `src/pipelines/steps/registry.ts`: add `requiredFeatureKey?: FeatureKey` to the step-handler registration type.
2. In `src/content/connectors/index.ts`: add `requiredFeatureKey?: FeatureKey` to the connector registration type.
3. In the generation provider DI surface (`src/content/index.ts` lines 69–74): add `requiredFeatureKey?: FeatureKey` to `GenerationProvider`.

**Step B — Assert at each call site (enumerated)**:

*Call site 1: GenerationService provider invocation (`src/content/generation/generator.ts`)*
Before calling `this.provider.generate(...)`, if `this.provider.requiredFeatureKey` is set, call `featureGate.assertEntitled(subject, this.provider.requiredFeatureKey, 'generation_provider')`. The subject comes from the session/request context already threaded into generation. Catch `FeatureNotEntitledError` and surface as a structured upgrade response.

*Call site 2: StepRegistry execution (`src/pipelines/steps/registry.ts`)*
In the step invocation path (the method that calls `handler(...)`), check `handler.requiredFeatureKey` before calling. The `tenantId`/`userId` from the pipeline context forms the subject.

*Call site 3: ConnectorRegistry sync (`src/content/connectors/index.ts` or its invocation in `SyncEngine`)*
Before calling `connector.sync(...)`, check `connector.requiredFeatureKey`. The subject is the operator/tenant initiating the sync.

**Step C — Document the complete enumeration**:
Create a comment block in `src/entitlements/gated-sites.ts` (a compile-time documentation file, no runtime code) that lists every Phase-1 gated call site with file:line, so a reviewer can audit coverage is complete and no site was missed.

**Files**:
- `src/pipelines/steps/registry.ts` (modified — add `requiredFeatureKey` field to handler type + assert before invoke)
- `src/content/connectors/index.ts` (modified — add `requiredFeatureKey` field + assert before invoke)
- `src/content/generation/generator.ts` (modified — assert before provider call if `requiredFeatureKey` set)
- `src/entitlements/gated-sites.ts` (new — compile-time enumeration documentation, ~30 lines)

**Validation**:
- [ ] A step handler with `requiredFeatureKey` set is denied for an unentitled subject with a `FeatureNotEntitledError`
- [ ] A step handler without `requiredFeatureKey` is invoked normally — no gate call, no overhead
- [ ] Same for connector and generation provider
- [ ] `gated-sites.ts` lists all three call sites with file references
- [ ] `tsc --noEmit` passes with zero errors across all modified files

**Edge Cases**:
- Phase 1 has zero add-on providers/steps/connectors registered with `requiredFeatureKey`. All checks are `undefined` → no-ops. The gating code must be present and correct, but it produces zero behavioral change until an add-on registers.
- The generation provider in `content/index.ts` is a singleton injected at boot. If a tenant-scoped provider is ever used, the subject must come from the request context, not boot-time. Flag this as a Phase 2 concern in the `gated-sites.ts` comment.
- Connector sync runs as a background job; the "subject" for a background sync is the tenant that owns the connector. The executor context must carry a subject, not derive it from an HTTP request. Verify the `SyncEngine` already carries a `tenantId`; if not, note it as a gap.

---

### T031: Module init wiring — `src/entitlements/index.ts` + `src/index.ts` mount

**Purpose**: Wire the complete entitlement module (gate, resolver, cache, membership) into the application startup, and mount admin routes / register admin MCP tools so the module is operational at boot.

**Steps**:

**Step A — `src/entitlements/index.ts` barrel**:
1. Create (or extend) the entitlements module barrel.
2. Export: `FeatureGate` class, `featureGate` singleton, `FeatureEntitlementResolver`, `MembershipResolver`, `NullMembershipResolver`, `EntitlementCache` (from WP01 core extraction), `FeatureNotEntitledError`, `GateToken` type, `Subject`, `FeatureKey`, `getFeatureKeyForTool`.
3. Instantiate the `featureGate` singleton with the `FeatureEntitlementResolver` (DB-leads), the `NullMembershipResolver` (pre-WP12), the subject-scoped `EntitlementCache`, and the audit writer. Export it as the canonical enforcement instance.

**Step B — `src/index.ts` mount**:
1. Import the admin routes from `src/entitlements/admin/routes.ts` (created by WP04) and mount them behind the operator-role middleware: `app.use('/api/v1/admin/entitlements', requireOperatorRole, entitlementsAdminRouter)`.
2. Import the admin MCP tools from `src/entitlements/admin/tools.ts` (WP04) and register them in the MCP tool list — they are gated by the operator-role check inside the tool, not by `getAllTools` entitlement filtering (admin tools are not subject to the add-on ownership map).
3. Log `[entitlements] Module initialized` on success; catch and log without crashing on failure (matching the `content` module pattern at lines 323–327 of `src/index.ts`).

**Step C — Inject `featureGate` into `executor.ts` and `tools/index.ts`**:
Both files import `featureGate` from `../entitlements/index.js`. Confirm the import resolves without circular dependencies. The entitlements module must not import from `tools/` or `executor.ts`.

**Files**:
- `src/entitlements/index.ts` (new or extended — module barrel + singleton wiring, ~60 lines)
- `src/index.ts` (modified — mount admin routes + register admin tools + initialization block, ~15 lines added)

**Validation**:
- [ ] `featureGate` singleton is available to both `tools/index.ts` and `tools/executor.ts` without circular imports
- [ ] Admin routes are mounted at `/api/v1/admin/entitlements` behind `requireOperatorRole`
- [ ] `[entitlements] Module initialized` appears in server startup logs
- [ ] Server starts cleanly if the entitlements DB tables do not yet exist (fail-soft with log, matching content module pattern)
- [ ] `tsc --noEmit` passes with zero errors

**Edge Cases**:
- The `featureGate` singleton must be created once and shared — do not instantiate it inside `getAllTools` or `executeTool` (would create a new cache per call, defeating the cache purpose).
- `NullMembershipResolver` (pre-WP12) returns `[]` for any user, so the effective subject set is `{user:U}` only. Swapping in a real `MembershipResolver` post-WP12 must require no changes to the gate or the seam wiring.
- Admin tools registered for the MCP surface must be operator-role-gated inside the tool handler, not via `getFeatureKeyForTool` — they are core administrative capabilities, not purchasable add-ons.

---

### T032: Unit tests — core tools unaffected; add-on tools gated on list and call

**Purpose**: Prove the three invariants that matter most: (1) core/free tools are always visible and executable regardless of entitlement state, (2) add-on tools are hidden in `getAllTools` for unentitled subjects and present for entitled ones, (3) `executeTool` on a gated add-on tool returns the upgrade-required payload on deny and dispatches normally on allow.

**Steps**:
1. Create `src/entitlements/__tests__/tool-seam.test.ts`.
2. Set up fixtures:
   - A fake `FeatureGate` that returns configurable allow/deny per feature key.
   - A fake `ADD_ON_TOOL_OWNERSHIP` map with one test add-on tool (`test_addon_tool`) → `test.addon.feature` and one test prefix (`test_addon_prefix_`) → `test.addon.prefix.feature`.
   - A core tool (`ops_health`) absent from the ownership map.
3. Test `getAllTools` entitlement filter (T028):
   - Unentitled user: `test_addon_tool` absent; `ops_health` present.
   - Entitled user: `test_addon_tool` present; `ops_health` present.
   - Gate denial during `isEntitled` (resolver down, returns false): add-on tool absent; core tool present.
4. Test `executeTool` gate (T029):
   - Add-on tool, unentitled: returns `{ error: 'feature_not_entitled', featureKey: 'test.addon.feature', ... }`.
   - Add-on tool, entitled: dispatcher is called (mock confirms call).
   - Core tool (`ops_health`): `assertEntitled` is never called; dispatcher runs directly.
5. Test upgrade error shape: `error`, `featureKey`, `message`, and `upgrade.featureKey` fields all present.
6. Test `getFeatureKeyForTool` (T027): exact match, prefix match, undefined for core.

**Files**:
- `src/entitlements/__tests__/tool-seam.test.ts` (new, ~120 lines)

**Validation**:
- [ ] `npm test -- --testPathPattern=tool-seam` exits 0
- [ ] Core tool path: zero calls to `featureGate.assertEntitled` or `featureGate.isEntitled`
- [ ] Add-on tool gated on both list (omitted when unentitled) AND call (upgrade error returned when unentitled)
- [ ] Upgrade error shape matches the WP02 T013 definition exactly
- [ ] Prefix ownership resolution tested: `test_addon_prefix_foo` resolves to `test.addon.prefix.feature`

**Edge Cases**:
- Test what happens when `ADD_ON_TOOL_OWNERSHIP` is empty (the Phase 1 launch state): `getAllTools` returns all tools; `executeTool` calls no gate. This is the regression-safety test for the free product.
- Test that `getAllTools` does not call `isEntitled` for a tool with `undefined` feature key — confirms zero overhead on the core path.
- Test that an `isEntitled` call that throws (unexpected error) is NOT caught by `getAllTools` — it should propagate, not silently exclude the tool. (This distinguishes "gate says no" from "gate crashed.")

---

## Definition of Done

- [ ] `src/entitlements/ownership.ts` — static map + `getFeatureKeyForTool` helper; starts empty for Phase 1
- [ ] `src/tools/index.ts` — entitlement filter added after existing service-connection filter; core tools unconditionally pass
- [ ] `src/tools/executor.ts` — gate block at top of `executeTool`; upgrade-required payload on deny; core tools bypass gate
- [ ] `src/pipelines/steps/registry.ts` — `requiredFeatureKey` on handler type; assert before invoke
- [ ] `src/content/connectors/index.ts` — `requiredFeatureKey` on connector type; assert before invoke
- [ ] `src/content/generation/generator.ts` — assert before provider call when `requiredFeatureKey` set
- [ ] `src/entitlements/gated-sites.ts` — enumeration of all three Phase-1 call sites (FR-016 audit surface)
- [ ] `src/entitlements/index.ts` — module barrel with `featureGate` singleton wired
- [ ] `src/index.ts` — admin routes mounted; initialization block present
- [ ] `src/entitlements/__tests__/tool-seam.test.ts` — all invariants proven
- [ ] `npm run typecheck` exits 0 with zero errors
- [ ] `npm test` exits 0 with no regressions in existing tests

---

## Risks

**Core/free tool regression (HIGH, contained by T032)**
The primary risk: touching `getAllTools` or `executeTool` could accidentally gate a core tool, breaking the free product. Mitigated by: (1) `getFeatureKeyForTool` returns `undefined` for any tool absent from the ownership map, and `undefined` means unconditional pass-through; (2) the T032 tests explicitly assert core tools are unaffected; (3) the ownership map starts empty, so Phase 1 at launch is a no-op filter.

**Empty ownership map is correct, not a bug**
Phase 1 ships with `ADD_ON_TOOL_OWNERSHIP` empty until real add-on tools are built. The filter must be a no-op in this state. This is correct behavior and is explicitly tested (T032 edge case).

**Static map is a Phase-1 approximation only**
The ownership map cannot be updated at runtime. If an add-on tool is added or removed from the codebase, the map must be manually updated. This is acceptable for Phase 1 (in-tree add-ons; Joyus engineers control both) but is a maintenance risk. Phase 2's plugin registry eliminates it. The risk is low for Phase 1 and the bridge pattern is intentional — call it out in code comments.

**Subject derivation (LOW, enforced by type)**
`executeTool` and `getAllTools` both derive the subject as `{ subject_type: 'user', subject_id: userId }`. The `tenantId === userId` collapse for downstream executors is unrelated. Mixing them would be a latent bug that only manifests post-WP12. The explicit `Subject` construction (not referencing `tenantId`) and the WP02 gate's explicit-subject requirement prevent this.

**GateToken threading (DEFERRED to Phase 2)**
Phase 1 holds the `GateToken` in `_gateToken` but does not pass it into executor signatures (those signatures are not yet updated to require it). The structural guarantee in Phase 1 is that `assertEntitled` must be called before dispatch — if it throws, dispatch never runs. Phase 2 makes this type-level by requiring `GateToken` as a parameter. This is intentional and documented.

---

## Reviewer Guidance

**The invariant that matters most**: run the test suite with `ADD_ON_TOOL_OWNERSHIP` empty and confirm `getAllTools` and `executeTool` are byte-for-byte equivalent to the pre-WP05 behavior. Any deviation is a regression.

**Verify filter composition order**: The entitlement filter must run *after* the connected-service filter in `getAllTools`, never before. If a tool requires both a JIRA connection and an add-on entitlement, both conditions must be checked independently — failing either removes the tool. The current structure (service filter first, entitlement filter second) is correct; do not invert.

**Confirm `isEntitled` vs `assertEntitled` usage**:
- `getAllTools` uses `isEntitled` (non-throwing, returns `false` on deny — tool is silently omitted from the list).
- `executeTool` uses `assertEntitled` (throws `FeatureNotEntitledError` — caught and mapped to upgrade payload). This distinction is intentional: hiding from the list is UX; blocking execution is enforcement.

**Check the gated-sites enumeration**: `src/entitlements/gated-sites.ts` must list every Phase-1 call site. If a reviewer finds a call site that invokes an add-on contribution without a gate, it is a FR-016 violation. The enumeration is the audit surface.

**Do not trust the ownership map alone**: The map gates tools at the seam. But if an add-on contribution is also reachable through a provider/step/connector path (T030), that path must also be gated — the map-level gate on the tool name is insufficient coverage. The `gated-sites.ts` enumeration documents which paths are covered.
