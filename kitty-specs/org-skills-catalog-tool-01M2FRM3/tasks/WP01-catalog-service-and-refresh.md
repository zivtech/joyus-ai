---
work_package_id: WP01
title: Catalog service and refresh
dependencies: []
requirement_refs:
- FR-02
- FR-04
- FR-05
- FR-06
- FR-07
- FR-08
- FR-09
- FR-10
- FR-16
- FR-17
- FR-18
- FR-19
- FR-20
planning_base_branch: codex/org-skills-catalog-core
merge_target_branch: codex/org-skills-catalog-core
branch_strategy: Planning artifacts for this mission were generated on codex/org-skills-catalog-core. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into codex/org-skills-catalog-core unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-org-skills-catalog-tool-01M2FRM3
base_commit: d27d7fbc087e24de6e79f8f4514e7bc0f3b0cee8
created_at: '2026-09-14T10:55:57.843334+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
- T007
- T008
- T009
history: []
authoritative_surface: joyus-ai-mcp-server/src/skills/catalog/
create_intent:
- joyus-ai-mcp-server/src/skills/catalog/types.ts
- joyus-ai-mcp-server/src/skills/catalog/config.ts
- joyus-ai-mcp-server/src/skills/catalog/source-github.ts
- joyus-ai-mcp-server/src/skills/catalog/validation.ts
- joyus-ai-mcp-server/src/skills/catalog/policy-s3.ts
- joyus-ai-mcp-server/src/skills/catalog/service.ts
- joyus-ai-mcp-server/src/skills/catalog/refresh-routes.ts
- joyus-ai-mcp-server/tests/catalog-config.test.ts
- joyus-ai-mcp-server/tests/catalog-source-github.test.ts
- joyus-ai-mcp-server/tests/catalog-validation.test.ts
- joyus-ai-mcp-server/tests/catalog-policy-s3.test.ts
- joyus-ai-mcp-server/tests/catalog-service.test.ts
- joyus-ai-mcp-server/tests/catalog-refresh-lifecycle.test.ts
- joyus-ai-mcp-server/tests/catalog-refresh-routes.test.ts
- joyus-ai-mcp-server/tests/catalog-startup-integration.test.ts
execution_mode: code_change
lane: planned
owned_files:
- joyus-ai-mcp-server/src/skills/catalog/types.ts
- joyus-ai-mcp-server/src/skills/catalog/config.ts
- joyus-ai-mcp-server/src/skills/catalog/source-github.ts
- joyus-ai-mcp-server/src/skills/catalog/validation.ts
- joyus-ai-mcp-server/src/skills/catalog/policy-s3.ts
- joyus-ai-mcp-server/src/skills/catalog/service.ts
- joyus-ai-mcp-server/src/skills/catalog/refresh-routes.ts
- joyus-ai-mcp-server/src/index.ts
- joyus-ai-mcp-server/tests/catalog-config.test.ts
- joyus-ai-mcp-server/tests/catalog-source-github.test.ts
- joyus-ai-mcp-server/tests/catalog-validation.test.ts
- joyus-ai-mcp-server/tests/catalog-policy-s3.test.ts
- joyus-ai-mcp-server/tests/catalog-service.test.ts
- joyus-ai-mcp-server/tests/catalog-refresh-lifecycle.test.ts
- joyus-ai-mcp-server/tests/catalog-refresh-routes.test.ts
- joyus-ai-mcp-server/tests/catalog-startup-integration.test.ts
tags: []
tracker_refs: []
---

Implementation paths in this prompt body are relative to `joyus-ai-mcp-server/`; machine-readable ownership paths are repository-relative.


# WP01 — Catalog service and refresh

Owns the read-only catalog core: source adapter, index/document validation, the policy read port, the in-process generation service, refresh lifecycle/orchestration, the operator refresh HTTP surface, and startup wiring. Depends on nothing else in this package. WP02 depends on WP01's public module surface (`types.ts` exports and `service.ts`'s read/query entry points) but not on its internals.

**Implementation paths are PROPOSED** under the target MCP server implementation repository; none exist yet. Exact base revision to be reconfirmed before editing.

- `src/skills/catalog/types.ts`
- `src/skills/catalog/config.ts`
- `src/skills/catalog/source-github.ts`
- `src/skills/catalog/validation.ts`
- `src/skills/catalog/policy-s3.ts`
- `src/skills/catalog/service.ts`
- `src/skills/catalog/refresh-routes.ts`
- `src/index.ts` — startup and refresh-route mounting only; no other edits
- `tests/catalog-*.test.ts` (one file per module below)

No new database table, migration, or session/skill-enablement read/write. No enable/disable UI, orchestrator, or corpus-promotion work.

## T001 — Shared types and config module

**Purpose:** Establish the shared vocabulary (`Generation`, `SkillMetadata`, `PolicyTenantEntry`, `RefreshAttempt`, cursor payload shape) and the operator config loader (env secret aliases for source-read and refresh credentials, policy-object location/region, refresh interval, stale/unavailable bounds) so every later WP01/WP02 module imports one source of truth.

**Files/ownership:** `src/skills/catalog/types.ts`, `src/skills/catalog/config.ts`, `tests/catalog-config.test.ts`.

**Steps:**
1. Encode data-model.md's seven entities as TypeScript interfaces/types; no persistence, process-memory only.
2. Encode FR-10/refresh.md bounds (1,000 entries, 1 MiB index, 256 KiB/doc, 16 MiB/generation, 32 MiB active admission cap, 64 MiB aggregate budget, 120s candidate, 5-min refresh interval, 1hr stale ceiling) as named constants, not inline literals.
3. Load source-read secret alias, refresh-auth secret alias, cursor key alias, and policy-object location/region config from environment; mark the optional catalog unavailable with a sanitized configuration error if a required alias is absent; the main server must still start (do not silently default a secret).
4. Do not read the secret *values* here — only alias/location config; value resolution happens in the adapters (T002, T004, T007).

**Acceptance observations (planned, unexecuted):** config loader rejects missing required alias with an explicit error; constants match the bounds table exactly; no secret value appears in the config object's serialized/log form.

**Dependencies:** none.

## T002 — GitHub source adapter

**Purpose:** Implement the sole content source per catalog-source.md: resolve an operator-approved ref to an immutable commit, traverse the tree, and fetch bounded index/document bytes without trusting client-supplied identity.

**Files/ownership:** `src/skills/catalog/source-github.ts`, `tests/catalog-source-github.test.ts`.

**Steps:**
1. Accept `{owner, repository, ref, credentialAlias}` from policy (never from tool input); resolve the read-only credential once at candidate start and keep that snapshot for this attempt only, per the mid-flight rotation contract.
2. Resolve `ref` once to a commit SHA; fetch the tree at that SHA; reject symlink/submodule entries and truncated/incomplete tree responses; use bounded nonrecursive traversal or explicit rejection if the recursive tree is incomplete.
3. Fetch index and document blobs over HTTPS against the fixed approved GitHub API origin only; disable automatic redirects (treat any redirect as a source failure); never forward Authorization to a redirect target; never follow a source-provided download URL.
4. Enforce per-candidate budget: ≤4 downloads in flight, 120s total elapsed including retries/traversal, tree response ≤1 MiB.
5. Surface a typed rejection (not a thrown raw HTTP error) distinguishing timeout / rate-limit / upstream-failure / source-authorization (401/403) / structural-rejection, matching refresh.md's category enum.
6. Never compare commit SHAs for recency; treat them as opaque identity only.

**Acceptance observations (planned, unexecuted):** fake-HTTP tests cover redirect rejection, symlink/submodule rejection, truncated-tree rejection, budget-exceeded abort, and each failure category mapping to the correct enum value; no credential value appears in any thrown error or log call.

**Dependencies:** T001.

## T003 — Index and document validation

**Purpose:** Implement catalog-source.md's schema-1 and frontmatter validation with a maintained duplicate-key-aware parser and strict YAML parser, rejecting the whole candidate on any inconsistency.

**Files/ownership:** `src/skills/catalog/validation.ts`, `tests/catalog-validation.test.ts`.

**Steps:**
1. Require valid JSON syntax with the runtime JSON parser, then run strict JSON-compatible parsing and unique-key checks through the maintained YAML parser as specified in catalog-source.md. Both stages must succeed; record the locked yaml version and nested duplicate-key tests. Do not hand-roll a parser.
2. Validate `schemaVersion: 1`, `generatedAt` (RFC3339, descriptive only — never used for integrity/ordering), and each `skills[]` entry's `name` (slug regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤100 chars, unique), `description` (nonempty), `priority` (integer 0–100, no coercion), `scope` (`tenant|role|task`), `path` (exact literal `skills/<name>/SKILL.md`), `bytes` (nonnegative integer matching original UTF-8 length).
3. Parse each document with the maintained `yaml` parser in strict mode, unique keys enforced, alias/anchor/tag/merge-key expansion disabled; reject leading BOM rather than stripping it; require exactly one opening/closing frontmatter delimiter pair on their own lines; support LF and CRLF without normalizing.
4. Cross-check index vs. frontmatter `name`/`description`/`priority`/`scope` for exact agreement and byte count vs. actual original UTF-8 length; reject the entire candidate (not just the offending entry) on any mismatch.
5. Enforce entry/size bounds from T001's constants during parsing, not only after full materialization.

**Acceptance observations (planned, unexecuted):** fixture set covers valid, duplicate-JSON-key, duplicate-frontmatter-field, BOM, mixed-line-ending, YAML-alias/anchor/tag, path-traversal, oversized-document, oversized-index, and index/frontmatter-mismatch cases; every invalid fixture rejects the whole candidate with no partial index.

**Dependencies:** T001.

## T004 — Policy read adapter

**Purpose:** Implement the sole `CatalogAccessPolicyReader` production adapter per access-policy.md: one uncached, authenticated read against one configured policy object, no CDN/replica/cache/version-pinned fallback.

**Files/ownership:** `src/skills/catalog/policy-s3.ts`, `tests/catalog-policy-s3.test.ts`.

**Steps:**
1. Define the `CatalogAccessPolicyReader` port (interface) and the reference adapter implementing it; object location/region come from T001 config only, never from caller input.
2. Issue a fresh read per call with a 2-second overall deadline and no SDK-level retry extension of that deadline; use a cancellation signal.
3. Validate the returned object: `schemaVersion: 1`, `tenants` mapping, each entry exactly `{epoch, enabled, approved, source: {provider: "github", owner, repository, ref, credentialAlias}}`; reject duplicate/unknown fields; bound to 1 MiB / 1,000 tenant entries; treat missing/unreadable/malformed as unavailable (fail closed), never as "no policy = allow."
4. Treat `epoch` as an opaque equality token only — never sort or compare it temporally.
5. Provide an injectable fake reader for tests (two simulated instances sharing one fake authority) satisfying the same port, so WP02's identity-matrix tests (T012) can reuse it without a live dependency.

**Acceptance observations (planned, unexecuted):** fake-reader tests cover malformed object, oversized object, unknown-field rejection, timeout-at-2s, and the two-instance shared-authority scenario (disable observed by both instances on next read). Real live-authority wiring is out of scope for test execution — this is a deployment prerequisite tracked as AT-16, not produced here.

**Dependencies:** T001.

## T005 — Generation service core

**Purpose:** Implement the in-process generation store: atomic activation, cache keying by `(tenant policy binding, source, approved ref, resolved revision)`, one active + at most one candidate per logical source (tenant policy binding plus source/ref), the 64 MiB aggregate retained-bytes budget, and fresh/stale/unavailable determination per refresh.md's state table.

**Files/ownership:** `src/skills/catalog/service.ts`, `tests/catalog-service.test.ts`.

**Steps:**
1. Model `Generation` as immutable once activated (source/ref/revision, epoch, verification time, sorted skill metadata, original document map); publish it via a single atomic swap, never a partial/observable-mid-write state.
2. Compute freshness per refresh.md's table using an injectable monotonic clock: fresh (<5 min since verification, no subsequent failure), stale (≥5 min or transient/validation failure, <1 hr, policy permitting), unavailable (≥1 hr, or no active generation, or source 401/403 observed on this instance).
3. Enforce the 32 MiB active admission cap and 64 MiB total across active/candidate/read-held retired generations. Preserve replacement-refresh headroom. Reject new admission at capacity; do not evict another approved tenant. Sweep disabled/removed entries after successful policy reads and retry queued tenants fairly, as catalog-source.md specifies.
4. Expose read-only query methods (pin-current-generation-for-epoch) that WP02's access module (T012) and executor (T014) call; do not expose a method that bypasses live policy/membership checks — this module never itself decides authorization.
5. A rejected/invalid candidate must leave the prior valid generation and its `verifiedAt` untouched.

**Acceptance observations (planned, unexecuted):** fake-clock tests cover the full freshness-state table, budget-exhaustion rejection, independent epoch eligibility for two tenants sharing repository/ref, and "invalid candidate does not move prior generation's verifiedAt."

**Dependencies:** T001, T002, T003.

## T006 — Refresh orchestration and rollback

**Purpose:** Unify startup load, periodic timer, and authenticated trigger behind one service method with epoch/local-attempt-sequence gating and rollback support, per FR-17 and refresh.md's activation rules.

**Files/ownership:** `src/skills/catalog/service.ts` (same module as T005; distinct method surface), `tests/catalog-refresh-lifecycle.test.ts`.

**Steps:**
1. Implement one `refresh(sourceKey, trigger)` entry point used identically by startup, timer, and the authenticated HTTP route (T007); concurrent triggers for the same source coalesce into the in-flight attempt rather than starting a second one.
2. Bind each candidate to the current policy epoch (read via T004's port) and a monotonically increasing local attempt sequence; before activation, reread policy and confirm the tenant entry, source/ref, and epoch are still current, and that this attempt has not been superseded — reject activation on any mismatch.
3. Implement rollback as: operator selects an earlier approved ref/revision under a new epoch; any in-flight candidate from the previous epoch is discarded on completion, never activated.
4. Never use commit-hash comparison to decide "newer"; ordering comes solely from epoch + local sequence.
5. Use bounded round-robin scheduling (one queued request per configured logical source, maximum 1,000; two active attempts). Begin the candidate deadline on worker-slot start; do not claim a refresh completion guarantee under queue pressure. On shutdown, cancel timers/queued refreshes/in-flight fetches; persist no body cache or entitlement.
6. Test source credential rotation during download: a new epoch fences the old candidate; an old credential 401/403 fails closed; only a fresh candidate under the new epoch may verify/activate.

**Acceptance observations (planned, unexecuted):** fake-clock/fake-source tests cover coalesced concurrent triggers, stale-epoch candidate rejection at activation time, rollback-under-new-epoch discarding a superseded in-flight candidate, and shutdown cancellation.

**Dependencies:** T004, T005.

## T007 — Refresh HTTP routes

**Purpose:** Implement the operator-only `POST/GET /internal/org-skills/refresh[/:operationId]` surface per refresh.md, authenticated by a refresh secret distinct from source-read credentials, MCP user tokens, and the cursor key.

**Files/ownership:** `src/skills/catalog/refresh-routes.ts`, `tests/catalog-refresh-routes.test.ts`.

**Steps:**
1. Authenticate the bearer refresh secret before parsing the request body or reading any remote policy/source; bind each valid secret to one configured tenant/source (never accept a source/tenant selector in path, query, or body).
2. Parse the body with a route-local parser capped at 1 KiB, placed before any global body parser; accept an optional `ref` (≤256 bytes) as informational-only — never let it select the fetched revision, never log it.
3. Rate-limit manual triggers: at most one new attempt per minute per source per instance (burst one); an authenticated duplicate while a job runs returns the existing `operationId` instead of starting new work; apply the existing rate-limit middleware to unauthenticated attempts with a safe fixed policy.
4. Return the exact status/body table from refresh.md (202 accepted/in_progress, 400 invalid_request, 401 unavailable, 413 request_too_large, 429 rate_limited, 503 unavailable) and the GET status endpoint returning `in_progress|activated|rejected|unavailable` plus safe timestamps/duration/revision.
5. Retain at most the latest 100 finished statuses per instance for 10 minutes, evicting oldest-completed only; unknown/expired/differently-scoped operation IDs all return the same 404-unavailable shape; no body, secret, raw input, source URL, or exception stack in any status/log output.

**Acceptance observations (planned, unexecuted):** route tests cover auth-before-parse ordering, 1 KiB body cap, rate-limit burst-of-one, duplicate-coalesce-to-same-operationId, full status/body table, and log/response redaction of the informational `ref` field.

**Dependencies:** T001, T006.

## T008 — Startup and route integration in `src/index.ts`

**Purpose:** Wire the catalog service and refresh routes into server startup without making normal startup depend on catalog availability, per refresh.md's non-blocking-startup requirement.

**Files/ownership:** `src/index.ts` (startup sequencing and route mounting only — no unrelated edits), `tests/catalog-startup-integration.test.ts`.

**Steps:**
1. Start the bounded catalog load (T006's `refresh` on startup trigger) in the background after the server begins listening; do not await it in the critical startup path.
2. Mount `refresh-routes.ts` under `/internal/org-skills/refresh` alongside existing internal routes, before the existing global JSON parser consumes that route body, as required by T007; preserve all unrelated middleware behavior and order.
3. Ensure a cold instance (no active generation yet) surfaces "unavailable" to any read attempt rather than hanging or throwing an unhandled rejection.
4. Confirm no other MCP tool's startup path is touched; a missing/unauthorized policy authority must not prevent the rest of the server from starting.

**Acceptance observations (planned, unexecuted):** integration test asserts server reaches "listening" state without waiting on catalog load completion, and that a read during cold start returns the unavailable shape (final wiring of that shape into `org_skills` itself is WP02's T014/T015).

**Dependencies:** T005, T006, T007.

## T009 — WP01 verification and review

**Purpose:** After authorized implementation, demonstrate the service contracts with executed tests and build evidence. This task remains planned until those checks run and pass; the documentation turn has not run them.

**Files/ownership:** WP01 tests, dependency manifest/lockfile for the new parser and policy-read client, generic usage notes and evidence receipts. Preserve every unrelated dependency change.

**Steps:**
1. Record compatible locked dependency versions; verify strict parsing, redirects and cancellation against current library documentation. Add the declared dependencies and lockfile changes as part of WP01 only when implementing.
2. Execute all WP01 tests, including AT-05 through AT-08 and AT-11 through AT-13. Use fake clocks/barriers and injected authorities, plus route/startup integration tests; write failing tests before the corresponding runtime behavior where feasible.
3. Run the target repository's validate, build, and coverage scripts in the target server directory. Demonstrate service startup with missing optional catalog configuration and reachability of an unrelated tool. Record commands, exit codes, selected commit and coverage of the new WP01 files; require >=80% new-code coverage.
4. Trace all WP01 FR cells to actual test files/results. Resolve material review findings; never replace a failed runtime observation with a document check. Record unchanged baseline failures separately if encountered.
5. Confirm no migrations, existing-storage reads/writes or descriptor/tool activation changes. Keep approved-corpus AT-14 and actual policy-deployment AT-16 separate; fixture development and WP01 code review do not close them.

**Acceptance observations (planned, unexecuted):** required service/route tests and validation/build pass, new-code coverage meets the target, optional startup failure remains isolated, and a focused review has no unresolved material service-boundary finding.

**Dependencies:** T002, T003, T004, T005, T006, T007, T008.

## Review guidance and definition of done

Review the actual implementation diff and test evidence against contracts, especially live policy versus cached content, moving refs, old-epoch activation, one-hour cutoff and secret-free errors. WP01 is done only after T009 passes and a focused reviewer approves its implementation. All tasks are presently planned; no reviewer approval or runtime evidence is claimed here.
