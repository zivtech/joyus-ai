---
title: Organization skill catalog tool
status: specified
scope: WP01 and WP02
---

# Feature Specification: Organization skill catalog tool

**Status:** Formal requirements; implementation has not started.

**Intent:** Give current tenant members one tool to discover approved skill descriptions and retrieve a complete document on demand, without an individual source-provider connection.

## User Scenarios & Testing

### US1 — Discover the authorized catalog (Priority: P1)

A current member of a tenant can discover the tenant's approved knowledge without connecting an individual GitHub account. Test independently with a small generic corpus and an authenticated member.

1. Given a member with one authoritative default tenant and an approved catalog, when they call `list`, then they receive an ordered bounded page of descriptions and no document bodies.
2. Given an approved empty catalog, when the member lists it, then the result is an empty page with a verified revision; cold-start or configuration failure instead returns unavailable.
3. Given catalogs with 1 and 100 skills, when the client discovers tools, then the single `org_skills` descriptor is byte-identical.

### US2 — Retrieve the selected document (Priority: P1)

A member can retrieve the full document they selected. Test independently by invoking `info` with a known generic fixture name.

1. Given a listed name and matching revision, when the member calls `info`, then the returned UTF-8 document exactly matches the validated original, including frontmatter and line endings.
2. Given an unknown name, when `info` is called, then it returns a generic not-found result without searching another tenant.
3. Given an expected revision superseded by a refresh, when `info` is called, then it returns catalog-changed without a body.

### US3 — Keep the private catalog within tenant membership (Priority: P1)

The platform operator can limit a catalog to its tenant and revoke access. Test independently with two users, two tenants, two service instances, and a shared live policy authority.

1. Given no exact membership, including a self-scope caller or an operator belonging only to another tenant, when either action is invoked, then no catalog metadata or body is returned.
2. Given a previously authorized user, when their membership is removed, then the next call denies access despite a fresh content cache or old cursor.
3. Given two instances with cached content, when a policy disable/source removal is acknowledged, then calls started afterward on either instance deny access. Policy lookup failure also denies access.
4. Given an API-key-only context without an authenticated user membership, when a read is attempted, then it is denied.

### US4 — Update approved content coherently (Priority: P2)

The operator can refresh or roll back approved content without exposing a partial catalog. Test independently with a fake source, fake clock, and controlled concurrent requests.

1. Given active generation A, when valid B is fetched and validated, then each read sees all A or all B.
2. Given a moving approved branch, when a candidate loads, then all files still come from its initially resolved immutable revision.
3. Given failed or malformed B, when refresh ends, then valid A remains eligible only within its stale allowance and current live authorization.
4. Given a rollback from B to A with a new configuration epoch, when an older B attempt completes, then it cannot replace the rollback.
5. Given source 401/403 or stale expiry, when a member reads, then the catalog is unavailable until successful source verification.

### Edge Cases

Malformed or tampered cursors; a cursor from another tenant or service instance; missing/ambiguous defaults; policy removal during refresh; unchanged revision after successful verification; byte-order marks and invalid UTF-8; mixed line endings; duplicate frontmatter keys; YAML aliases/tags; truncated source tree responses; symlinks/submodules; redirect attempts; oversized streamed responses; shutdown during refresh; credentials rotated while a refresh is in flight. Detailed outcomes are in the contracts and acceptance matrix.

## Requirements

Requirement identifiers FR-01 through FR-20 are retained from the agreed core draft. The contracts make their wire fields, state transitions, and boundary values precise.

### Access and source identity

- **FR-01:** Keep `org_skills` independent of connected-service OAuth. Descriptor text and schema contain no private names, source URLs, skill menu, or bodies.
- **FR-02:** Resolve the authorized catalog from authenticated server-side identity and operator configuration. Missing or ambiguous assignment denies access. Re-evaluate user authorization, source approval, and catalog-enabled policy on each list/info call using authoritative server-side policy; if that policy cannot be verified, deny access. Do not persist access entitlements or source approval in the content cache. An acknowledged disable or source removal blocks subsequent reads on every instance, including fresh cached content; this control must not wait for periodic content refresh.
- **FR-03:** A tenant maps to an approved corpus, and current membership in that exact tenant authorizes catalog access. Check a membership record for the authenticated user and selected tenant on every read. Authentication alone, self-scope fallback, environment allowlists, and operator membership in another tenant do not grant access. Catalog-management authority does not implicitly grant permission to read every corpus.
- **FR-04:** Read only operator-allowlisted repository identities and approved refs. Resolve a ref to an immutable revision before loading content. Client inputs and refresh payloads cannot override source host, repository, credentials, tenant, or approved ref.
- **FR-05:** Use separate server secrets for source read access and refresh authentication. No secret may appear in tool results, status responses, logs, fixtures, or exception text. Validate the source host and prevent authenticated redirects to unapproved destinations.

### Catalog integrity

- **FR-06:** Accept index schema version 1: `skills` entries contain unique `name`, nonempty `description`, integer priority 0–100, scope `tenant|role|task`, canonical `skills/<name>/SKILL.md` path, and nonnegative byte count. Names are lower-case alphanumeric slugs with internal hyphens, at most 100 characters. `generatedAt` is descriptive metadata, not an integrity proof.
- **FR-07:** Parse document frontmatter with a maintained parser. Reject duplicate/invalid fields, malformed documents, duplicate names, path traversal, symlinks, and missing content. Index and document name/description/priority/scope must agree; byte count must match the original UTF-8 file. Reject the whole candidate on inconsistency.
- **FR-08:** Index and documents in an activated generation come from the same immutable revision. Eager server-side validation/cache of bodies is allowed; client context still receives a body only after `info`. Do not execute, rewrite, or add behavioral directives to returned documents.
- **FR-09:** Key cached generations by authorized source identity, approved ref, and resolved revision. Sharing a generation across authorized callers never bypasses per-call access checks. Catalog scope metadata describes intended skill use; it is not an access-control grant.
- **FR-10:** Initial maximum limits: 1,000 entries, 1 MiB index, 256 KiB per document, 16 MiB total original documents per generation, and 120 seconds per candidate refresh. Bound downloads before parsing and aggregate size before activation. Unsupported or oversized content rejects the candidate; never truncate a skill and call it complete. Also cap active original-document bytes across tenants at 32 MiB and all retained active/candidate/read-held document bytes at 64 MiB per instance; preserve replacement-refresh headroom, reject excess admission explicitly, and release disabled/removed/replaced sources through policy-driven cleanup. Bound the fair refresh queue to one entry per configured logical source (maximum 1,000) and two active candidates; the 120-second candidate deadline begins at worker-slot start, with no five-minute activation guarantee under queue pressure. The source contract defines capacity recovery and all tighter operational bounds. Implementation may adopt stricter documented limits while preserving explicit errors.

### Tool contract

- **FR-11:** `list` accepts optional page size (default 20, maximum 100) and an opaque cursor. Return only name, description, priority, scope, revision, freshness status, and next cursor. Sort by descending priority then ascending name, using a deterministic lexical comparison.
- **FR-12:** Bind each cursor to source, revision, and position; validate it after authorization. If its generation is no longer active, return a catalog-changed response and require a fresh list. Never silently mix pages across generations.
- **FR-13:** `info` accepts an exact skill name and optional expected revision. A revision mismatch returns catalog-changed without a body; omission selects the current authorized generation. Return complete original `SKILL.md` plus matching metadata/revision and freshness status. Do not expose credential-bearing or private source URLs.
- **FR-14:** Invalid actions/arguments produce explicit validation errors. Unknown skills and inaccessible skills are indistinguishable. Unsupported actions are absent from the descriptor and rejected by the executor. Catalog errors use the repository's existing tool-error convention without altering unrelated tools.
- **FR-15:** A disabled or unconfigured catalog yields a generic unavailable result. The static tool descriptor can remain discoverable, so disabling the feature immediately stops all catalog reads without changing other tools.

### Refresh and operation

- **FR-16:** Refresh authorization is independent from ordinary MCP-user credentials. Reject invalid refresh credentials before remote reads; apply bounded request size, per-source single-flight execution, and rate limits. Any request `ref` is informational; the source always comes from operator configuration.
- **FR-17:** Startup load, periodic refresh, and authenticated refresh all use the same validation and atomic activation path. A cold instance serves unavailable until a valid generation is ready. Concurrent triggers coalesce. Each candidate is bound to the current operator-configuration epoch and a monotonically increasing local attempt sequence. Activate only if the configuration epoch is still current and the attempt has not been superseded. Source commit hashes have no temporal ordering. An intentional rollback advances the configuration epoch and can select any earlier approved revision; in-flight candidates from the previous epoch cannot activate.
- **FR-18:** The default refresh interval is five minutes. After a transient refresh failure (timeout, rate limit, or upstream server failure), serve a prior valid generation as stale for at most one hour since its last successful source verification, then return unavailable. Invalid candidates also leave the prior approved generation active within that bound. Source authorization failures (401/403) make the catalog unavailable until successful re-verification; explicit source removal or disable takes effect through FR-02 immediately and never permits stale serving. List and info report revision, verification time, and fresh/stale status. An operator can disable access immediately, independent of cache age.
- **FR-19:** A refresh response distinguishes accepted/in-progress, successfully activated, rejected, and unavailable. Record timestamps, revision, failure category, and refresh duration without document bodies or secrets. Content-generation convergence across instances is bounded by periodic polling, not an unsupported immediate-broadcast claim. This polling applies only to content: FR-02 requires a live authoritative policy check on every request, independent of the content cache and refresh lifecycle.
- **FR-20:** Document startup settings, authorization mapping, limits, stale behavior, credential rotation, source revocation, and rollback. Rollback disables catalog access or selects an earlier approved source revision and validates it; it does not change or remove other MCP tools.

### Key Entities

- **Tenant membership:** a current grant for an authenticated user and one tenant. Skill scope labels do not modify this grant.
- **Catalog policy:** the operator's enabled/approved source assignment and configuration epoch. It is checked live, never treated as a content-cache entitlement.
- **Catalog generation:** a validated index and all original documents from one immutable source revision.
- **Skill metadata:** name, description, priority and intended-use scope, with document path and byte count used internally for validation.
- **Cursor:** an opaque continuation bound to the caller's authorized catalog and generation.
- **Refresh attempt:** a bounded candidate validation, with an epoch, local sequence and sanitized outcome.

## Success Criteria

- **SC-01:** A same-tenant member without an individual GitHub connection completes list and info; no disallowed identity in the acceptance matrix receives metadata or a body.
- **SC-02:** The descriptor is identical for 1 versus 100 fixture skills, every list omits bodies, and every successful info reproduces the selected original document exactly.
- **SC-03:** Every invalid candidate in the acceptance matrix leaves the active generation unchanged; concurrent refresh and rollback never mix generations.
- **SC-04:** Reads begun after acknowledged disable/source removal fail on both tested instances. A prior source verification older than or equal to one hour never authorizes stale delivery.
- **SC-05:** Every FR has a named work-package owner and an observable acceptance test. Implementation acceptance requires passing repository validation/build, access-boundary tests, and at least 80% coverage of new code.
- **SC-06:** Real-content readiness has a separate receipt naming an explicitly approved revision and its expected documents. Generic fixture success alone does not satisfy this criterion.

## Scope and Assumptions

Only WP01 (catalog/refresh) and WP02 (list/info) are in scope. WP0's interactive-client persistence evidence and the authenticated session-identity lifecycle still gate WP3. Existing session/skill-enablement storage is not rebuilt, imported, migrated, or required by this core. No enable/disable actions, request stub/filing, resources transport, orchestrator work, skill execution, installation, token-saving claim, merge, deployment or corpus promotion is included. Operator catalog disablement in FR-02/FR-15 is access policy, not a user-facing skill activation action.

For this slice, the authenticated user's unique current default membership supplies tenant context; arbitrary headers and arguments cannot select a tenant. Users without a unique default are denied even if they hold other memberships. Selecting among multiple tenants is a future interaction, not an implicit fallback.

The numerical limits are initial engineering limits, not measured service-level guarantees. Real-content evidence, source identities, approval receipts and infrastructure decision rationale remain outside this generic package. Real-content and live-authority readiness (see the acceptance matrix) are separate gates that this package does not close.
