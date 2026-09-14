---
work_package_id: WP02
title: Tool and access boundary
dependencies:
- WP01
requirement_refs:
- FR-01
- FR-02
- FR-03
- FR-05
- FR-08
- FR-09
- FR-11
- FR-12
- FR-13
- FR-14
- FR-15
- FR-20
planning_base_branch: codex/org-skills-catalog-core
merge_target_branch: codex/org-skills-catalog-core
branch_strategy: Planning artifacts for this mission were generated on codex/org-skills-catalog-core. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into codex/org-skills-catalog-core unless the human explicitly redirects the landing branch.
subtasks:
- T010
- T011
- T012
- T013
- T014
- T015
- T016
- T017
history: []
authoritative_surface: joyus-ai-mcp-server/src/tools/
create_intent:
- joyus-ai-mcp-server/src/skills/catalog/access.ts
- joyus-ai-mcp-server/src/skills/catalog/cursor.ts
- joyus-ai-mcp-server/src/tools/org-skills-tools.ts
- joyus-ai-mcp-server/src/tools/org-skills-executor.ts
- joyus-ai-mcp-server/tests/catalog-tool-descriptor.test.ts
- joyus-ai-mcp-server/tests/catalog-executor-validation.test.ts
- joyus-ai-mcp-server/tests/catalog-access.test.ts
- joyus-ai-mcp-server/tests/catalog-cursor.test.ts
- joyus-ai-mcp-server/tests/catalog-executor-list-info.test.ts
- joyus-ai-mcp-server/tests/catalog-error-transport.test.ts
- joyus-ai-mcp-server/tests/catalog-audit-sanitizer.test.ts
- joyus-ai-mcp-server/tests/catalog-tool-registration.test.ts
execution_mode: code_change
lane: planned
owned_files:
- joyus-ai-mcp-server/src/skills/catalog/access.ts
- joyus-ai-mcp-server/src/skills/catalog/cursor.ts
- joyus-ai-mcp-server/src/tools/org-skills-tools.ts
- joyus-ai-mcp-server/src/tools/org-skills-executor.ts
- joyus-ai-mcp-server/src/tools/index.ts
- joyus-ai-mcp-server/src/tools/executor.ts
- joyus-ai-mcp-server/src/index.ts
- joyus-ai-mcp-server/tests/catalog-tool-descriptor.test.ts
- joyus-ai-mcp-server/tests/catalog-executor-validation.test.ts
- joyus-ai-mcp-server/tests/catalog-access.test.ts
- joyus-ai-mcp-server/tests/catalog-cursor.test.ts
- joyus-ai-mcp-server/tests/catalog-executor-list-info.test.ts
- joyus-ai-mcp-server/tests/catalog-error-transport.test.ts
- joyus-ai-mcp-server/tests/catalog-audit-sanitizer.test.ts
- joyus-ai-mcp-server/tests/catalog-tool-registration.test.ts
tags: []
tracker_refs: []
---

Implementation paths in this prompt body are relative to `joyus-ai-mcp-server/`; machine-readable ownership paths are repository-relative.


# WP02 — Tool and access boundary

Owns the `org_skills` MCP tool surface, the tenant-membership + live-policy access boundary, the opaque cursor, and the exact-tool audit-sanitizing edits to the shared executor/registration/startup files. Depends on WP01's `types.ts` exports and `service.ts` query surface (T001, T005, T006); does not depend on WP01's internal source/validation/policy-adapter implementation details.

**Implementation paths are PROPOSED** under the target MCP server implementation repository; none exist yet. Exact base revision to be reconfirmed before editing.

- `src/skills/catalog/access.ts`
- `src/skills/catalog/cursor.ts`
- `src/tools/org-skills-tools.ts`
- `src/tools/org-skills-executor.ts`
- `src/tools/index.ts` — edit: register `org_skills` unconditionally (existing file today builds the tool list from `userConnections`/`connectedServices`; org_skills must not require any connected service)
- `src/tools/executor.ts` — edit: exact-name catalog dispatch before OAuth lookup; preserve `executeTool(userId, toolName, input)` and unrelated dispatch.
- `src/index.ts` — edit: exact-tool audit filtering at both existing success/failure writes and transport integration tests; WP01 startup changes must be preserved.
- `tests/catalog-*.test.ts`, plus generic operator docs for the access/refresh boundary

Existing runtime today (per repository inspection) has no live policy store, a permissive general resolver, `executeTool` keyed only on `userId`, and raw-`args` auditing on both success and failure paths — WP02 must not reuse the general resolver as `org_skills`'s access grant, and must not change any other tool's resolver or audit semantics.

## T010 — `org_skills` static tool descriptor

**Purpose:** Define the single static tool descriptor per org-skills.md, independent of any connected-service state, with no corpus-derived or private text.

**Files/ownership:** `src/tools/org-skills-tools.ts`, `tests/catalog-tool-descriptor.test.ts`.

**Steps:**
1. Export one `ToolDefinition` named `org_skills` with the fixed description text and an `inputSchema` covering only `action`, `pageSize?`, `cursor?`, `name`, `expectedRevision?` — no tenant/source/repository/URL/path/ref/credential/session property.
2. Ensure `action` is required and the schema structurally excludes `enable`, `disable`, `request`, and any other action value — unsupported actions must not appear as valid schema values at all.
3. Add a descriptor-stability test asserting the tool object is byte-identical regardless of catalog size (1 vs. 100 fixture skills) — the descriptor never embeds catalog contents.
4. Do not import `db`/`connections` or any connected-service check into this file.

**Acceptance observations (planned, unexecuted):** descriptor JSON is identical across the 1- and 100-skill fixture runs (AT-01); the descriptor enum excludes `enable`/`disable`/`request`; direct executor validation also rejects them because clients are not trusted to enforce the descriptor schema.

**Dependencies:** WP01 T001 (shared types only).

## T011 — Argument validation and error taxonomy

**Purpose:** Implement org-skills.md's argument rules and the `invalid_arguments` path before any authorization or backend call, never echoing supplied values.

**Files/ownership:** `src/tools/org-skills-executor.ts` (validation entry point), `tests/catalog-executor-validation.test.ts`.

**Steps:**
1. Validate `action` ∈ {`list`, `info`}; reject null/array arguments, numeric coercion, fractional `pageSize`, empty optional strings, and any property not valid for the given action.
2. Validate `name` against `^[a-z0-9]+(?:-[a-z0-9]+)*$` (≤100 chars) and `expectedRevision` (≤128 ASCII chars) for `info`; validate `pageSize` (1–100, default 20) and `cursor` (≤2,048 bytes, nonempty) for `list`.
3. On any violation, throw the `invalid_arguments` catalog error with the fixed safe message, never including the offending value in the error or in any log call.
4. Confirm no credential-shaped field can reach a log call even if supplied maliciously (test with a fake `credentials` property injected into `list`/`info` args).

**Acceptance observations (planned, unexecuted):** fixture matrix of malformed requests (wrong types, extra tenant/source fields, wrong-action fields, unsupported action) all resolve to `invalid_arguments` with the fixed message and no echoed value.

**Dependencies:** T010.

## T012 — Access boundary module

**Purpose:** Implement the per-call live authorization sequence from access-policy.md: exact single default membership row + current policy, both freshly read, fail-closed, never cached as an entitlement.

**Files/ownership:** `src/skills/catalog/access.ts`, `tests/catalog-access.test.ts`.

**Steps:**
1. Query the primary membership store for exactly one `(userId, tenantId)` row where `isDefault` is true, bounding the lookup to detect a second row (ambiguous default) and denying on zero or multiple rows; use a fresh primary read, never a replica or retained transaction snapshot.
2. Reject any role-override, API-key-only, self-scope-fallback, or environment-allowlist path to authorization; do not call or reuse the general resolver mentioned in this WP's header — build this check as its own function.
3. Call WP01's `CatalogAccessPolicyReader` port (T004) with a 2-second read deadline; deny on missing/unreadable/disabled/unapproved entry or on lookup failure/timeout.
4. Select a generation from WP01's service (T005/T006) verified under the tenant entry's *current* epoch only; if none exists, treat as unavailable (the refresh trigger, if any, is WP01's concern, not this module's).
5. Propagate a single five-second deadline through membership, policy, generation selection, cursor handling and result assembly for the entire read and fail closed on any dependency error; never persist the membership/policy decision for reuse on a later call.

**Acceptance observations (planned, unexecuted):** identity-matrix tests cover: no membership, ambiguous default (two rows), self-scope caller, operator-membership-in-another-tenant, API-key-only context, policy disabled/unapproved/unreadable, and policy-lookup-timeout — every case denies with the same unavailable shape (no unknown-vs-inaccessible signal leak).

**Dependencies:** WP01 T001 (types), T004 (policy port), T005 (generation service), T006 (refresh/epoch lifecycle).

## T013 — Cursor module

**Purpose:** Implement the authenticated-encryption opaque cursor per org-skills.md, bound to tenant, source/ref fingerprint, epoch, revision, and offset, using a cursor key distinct from source-read and refresh-auth secrets.

**Files/ownership:** `src/skills/catalog/cursor.ts`, `tests/catalog-cursor.test.ts`.

**Steps:**
1. Encode/decode the cursor using the Node.js built-in crypto authenticated encryption (AES-256-GCM with a fresh random 96-bit nonce for each minted token), keyed by a dedicated cursor-key alias (from WP01 T001 config) that is never reused as the source or refresh-auth secret.
2. Include schema version, tenant binding, authorized source/ref fingerprint, policy epoch, immutable revision, and next offset inside the encrypted payload; expose none of these as plaintext outside the token.
3. Validate the cursor only *after* T012's authorization succeeds; a tamper/malformed/wrong-tenant/wrong-source token returns `invalid_cursor` without revealing its contents; a same-source cursor with a superseded revision or epoch returns `catalog_changed`.
4. Confirm a cursor remains valid across instances holding the same active epoch/revision, and that a changed page size between calls does not disturb the exact next offset.

**Acceptance observations (planned, unexecuted):** tests cover tamper, cross-tenant, cross-source, superseded-epoch, superseded-revision, cross-instance-same-generation success, and page-size-change-mid-pagination.

**Dependencies:** T012.

## T014 — `list`/`info` executor logic

**Purpose:** Implement the pinned-generation read path: sorted pagination for `list`, exact-document retrieval for `info`, per org-skills.md.

**Files/ownership:** `src/tools/org-skills-executor.ts` (core logic), `tests/catalog-executor-list-info.test.ts`.

**Steps:**
1. After T011 validation and T012 authorization, pin one eligible generation (from WP01's service) for the entire call; never mix pages or lookups across generations within one call.
2. `list`: sort by descending `priority` then ASCII-ascending `name` (ordinal, not locale-aware); apply T013's cursor for continuation; return only `{skills[], revision, verifiedAt, freshness, nextCursor}`; empty catalog returns `skills: []` with the real revision and `nextCursor: null`.
3. `info`: exact-name lookup within the pinned generation; `expectedRevision` mismatch returns `catalog_changed` before any name lookup; omitted `expectedRevision` selects the current authorized generation; return the complete original UTF-8 `SKILL.md` bytes unchanged (including frontmatter and original line endings) plus matching metadata/revision/freshness.
4. An unknown name and an inaccessible name (wrong tenant, etc.) must be indistinguishable — both resolve through the same `not_found`/`unavailable` path already established by T011/T012; do not add a separate lookup that could leak existence across tenants.
5. Never execute, rewrite, truncate, or append directives to a returned document.

**Acceptance observations (planned, unexecuted):** exact-byte round-trip test (fixture in → JSON-encoded tool result → decoded, byte-identical, including CRLF fixture and LF fixture); sort-order determinism test; expected-revision-mismatch-before-lookup ordering test; within an authorized catalog, unknown and inaccessible names produce the same not_found result; with denied catalog access, every valid name produces the same unavailable result without probing existence.

**Dependencies:** T011, T012, T013, WP01 T005, T006.

## T015 — Dispatch and error transport wiring

**Purpose:** Connect list/info to the existing executor and preserve the MCP error convention at its verified wrapper in `src/index.ts`.

**Files/ownership:** `src/tools/executor.ts` (exact-name dispatch), catalog error type in the shared types module by agreement with WP01, `tests/catalog-error-transport.test.ts`. The transport wrapper itself remains unchanged except for T016's audit filtering.

**Steps:**
1. Use one catalog error type carrying `invalid_arguments`, `unavailable`, `not_found`, `invalid_cursor` or `catalog_changed`, with the exact fixed safe messages in org-skills.md. Consolidate with WP01's typed errors rather than defining competing types.
2. In `executeTool`, add exact `toolName === 'org_skills'` dispatch before the OAuth-prefix lookup; call the catalog executor with the authenticated userId and injected service/access dependencies. Preserve every unrelated dispatch branch and existing function signatures. No general tenant resolver call is added for this branch.
3. Let sanitized catalog failures propagate to the existing `src/index.ts` tools/call catch, which already supplies text and `isError: true`. Do not invent an executor-local wrapper, duplicate serialization, or return an error-shaped success object.
4. Test all five errors through the HTTP/MCP wrapper and verify one existing non-catalog error case remains unchanged. No exception stack, upstream response body, tenant identifier or supplied argument value may reach the error text.

**Acceptance observations (planned, unexecuted):** an authenticated no-GitHub member reaches both actions through tools/call, and each catalog error has the fixed safe message and isError through the real wrapper.

**Dependencies:** T014.

## T016 — Audit sanitizer and tool registration

**Purpose:** Register `org_skills` unconditionally in the tool list, and add the exact `name === 'org_skills'` audit-input sanitizer at the existing raw-`args` logging site(s), per org-skills.md's audit requirement — without touching any other tool's audit behavior.

**Files/ownership:** `src/tools/index.ts` (edit: add `org_skills` to the base tool list, independent of `connectedServices`), `src/index.ts` (edit: both raw-args audit writes at the verified success/failure wrapper sites), `tests/catalog-audit-sanitizer.test.ts`, `tests/catalog-tool-registration.test.ts`.

**Steps:**
1. In `src/tools/index.ts`, add `org_skills` alongside `opsTools`/`contentTools`/etc. in the always-available base list (not inside any `connectedServices.has(...)` branch); verify no existing GitHub/Google/Jira/Slack-conditional tool list is reordered or altered.
2. Locate the current raw-`args` audit write (both success and failure paths, per this WP's header note); add a branch that runs only when the wrapper's exact `name === 'org_skills'`, replacing raw `args` with: validated action or `'invalid'`, boolean presence flags for `pageSize`/`cursor`/`name`/`expectedRevision` (not their values), and the outcome/error-code only.
3. Confirm this branch never logs raw `name`, `cursor`, `expectedRevision`, unknown/extra fields, or document text — for either the success or failure write.
4. Test the sanitizer through the HTTP wrapper layer (not solely a direct executor unit test), per org-skills.md's explicit instruction, so the audit write's actual call site is exercised.
5. Add a registration test confirming `org_skills` appears in `getAllTools(userId)`'s result for a user with zero connections.

**Acceptance observations (planned, unexecuted):** HTTP-level test shows a success call and a failure call both produce sanitized audit records (no raw name/cursor/expectedRevision); a user with no connected services still sees `org_skills` in their tool list; every other tool's audit record in the same test run remains raw/unmodified.

**Dependencies:** T010, T015.

## T017 — WP02 verification, operator documentation and readiness receipts

**Purpose:** After authorized implementation, execute the complete tool/access regression suite and prepare usable operator guidance. This task remains planned until evidence exists; no runtime tests were run while writing this package.

**Files/ownership:** WP02 integration tests, generic `docs/org-skills.md` in the implementation repository, and any operator runbook/evidence kept separately outside this generic package. Do not put private policy/credential/deployment design in the public implementation docs.

**Steps:**
1. Write complete generic usage/error/pagination guidance for `docs/org-skills.md`. Any operator runbook covering live policy setup, conditional writes/read-back, fresh epochs, refresh authentication/status, stale failure behavior, credential/key rotation and rollback is maintained separately and is out of scope for this generic package. No real credentials or source coordinates enter generic examples.
2. Execute AT-01 through AT-04, AT-09 and AT-10, and the WP01 regression suite. Use the HTTP wrapper to inspect success/failure audit rows; use two service instances with a shared fake policy and current membership store for deterministic revocation tests.
3. Run the target repository's validate, build, and coverage scripts. Record actual commands/results and require >=80% coverage for new code, with every access-negative case executed. Verify optional catalog config does not prevent unrelated tools from starting.
4. Obtain the project's standard code and security review for actual TypeScript/tests, resolve material findings and record evidence. Scan the named diff for secrets and private identifiers before any public push. Verify no storage/migration, session/getAllTools-signature, resource or orchestrator changes.
5. Keep AT-14 approved real-content and AT-16 actual two-instance policy-deployment receipts separate. Obtain them only under explicit corpus/operations authorization; until then report fixture-only core completion and the precise unmet readiness prerequisites. Neither receipt authorizes merge/deployment or closes any gated later work.

**Acceptance observations (planned, unexecuted):** required core tests and build/validation pass, new-code coverage meets the target, review findings are resolved, usable docs exist in the correct repository, and readiness receipts are either verified or explicitly pending. A checked task inventory alone is not completion evidence.

**Dependencies:** T011, T012, T013, T014, T015, T016.

## Review guidance and definition of done

Review the real HTTP path, direct membership query, policy freshness, generation pinning, cursor encryption/binding, same-access-state error equivalence and both audit writes. WP02 is done only after T017's core evidence and reviews pass. AT-14/AT-16 remain separate readiness gates if not yet authorized/completed. All tasks presently remain planned.
