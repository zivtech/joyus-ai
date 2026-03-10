---
work_package_id: "WP03"
title: "Profile Versioning"
lane: "planned"
dependencies: ["WP01"]
subtasks: ["T012", "T013", "T014", "T015", "T016"]
phase: "Phase 3 - Profile Versioning"
assignee: ""
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
history:
  - timestamp: "2026-03-10T00:00:00Z"
    lane: "planned"
    agent: "system"
    action: "Prompt generated via /spec-kitty.tasks"
---

# WP03: Profile Versioning

## Objective

Implement immutable profile version management: version creation with monotonic integers that never mutate existing rows, atomic rollback that swaps status fields in a single transaction, version history queries with full metadata, retention policy enforcement with soft-delete and hard-delete phases, and version comparison for computing feature vector deltas between profile versions.

## Implementation Command

```bash
spec-kitty implement WP03 --base WP01
```

## Context

- **Spec**: `kitty-specs/008-profile-isolation-and-scale/spec.md` — FR-003 (immutable versions), FR-004 (atomic rollback), FR-009 (retention)
- **Plan**: `kitty-specs/008-profile-isolation-and-scale/plan.md` — Phase 3 deliverables
- **Research**: `kitty-specs/008-profile-isolation-and-scale/research.md` — R2 (immutable append-only, monotonic integers, status-swap rollback)
- **Data Model**: `kitty-specs/008-profile-isolation-and-scale/data-model.md` — `tenant_profiles` status transitions
- **Foundation**: WP01 schema, types, tenant-scope; WP02 pipeline creates versioned profiles
- **Performance target**: Rollback completes within 30 seconds (NFR-002, SC-003)

**State transitions** (from data-model.md):
```
generating -> active          (generation completed)
active -> rolled_back         (another version activated via rollback)
rolled_back -> active         (this version is the rollback target)
active -> archived            (retention policy expired)
rolled_back -> archived       (retention policy expired)
archived -> deleted           (hard-delete after 30-day recovery window)
```

---

## Subtask T012: Create Version Creation Service

**Purpose**: Implement the service that creates new profile versions as immutable rows with monotonically increasing version numbers.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/versioning/service.ts`
2. Import schema, types, tenant-scope helpers
3. Implement `ProfileVersionService` class with methods:
   - `constructor(db: DrizzleClient, logger: ProfileOperationLogger)`
   - `async createVersion(tenantId: string, params: { profileIdentity, tier, authorId?, authorName?, corpusSnapshotId, stylometricFeatures, markers, fidelityScore?, parentProfileId?, metadata? }): Promise<TenantProfile>`:
     1. `requireTenantId(tenantId)`
     2. Within a transaction:
        a. Query `SELECT MAX(version) FROM tenant_profiles WHERE tenant_id = ? AND profile_identity = ?` — use `tenantWhere`
        b. Next version = (max version ?? 0) + 1
        c. If there is a current `active` version for this identity, set its status to `rolled_back`
        d. Insert new row with the computed version number and status `active`
     3. Log the operation via `logger.logOperation`
     4. Return the created profile row
   - `async getActiveVersion(tenantId: string, profileIdentity: string): Promise<TenantProfile | null>`:
     - Query with `tenantWhere` and `status = 'active'` filter
   - `async getVersion(tenantId: string, profileIdentity: string, version: number): Promise<TenantProfile | null>`:
     - Query with `tenantWhere`, `profileIdentity`, and `version` filter
4. Version number assignment is monotonic: always MAX(existing) + 1. No gaps, no reuse.
5. Only one version per profileIdentity can have status `active` at any time — the `createVersion` method enforces this by transitioning the old active to `rolled_back`.

**Files**:
- `joyus-ai-mcp-server/src/profiles/versioning/service.ts` (new, ~120 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Version numbers increment correctly: first version is 1, second is 2, etc.
- [ ] Only one `active` version exists per (tenantId, profileIdentity) at any time
- [ ] Previous active version transitions to `rolled_back` when a new version is created

---

## Subtask T013: Implement Atomic Rollback

**Purpose**: Implement rollback that atomically switches the active profile version, ensuring all downstream consumers see the change simultaneously.

**Steps**:
1. Add to `service.ts` in `ProfileVersionService`:
   - `async rollback(tenantId: string, profileIdentity: string, targetVersion: number): Promise<TenantProfile>`:
     1. `requireTenantId(tenantId)`
     2. Within a single database transaction:
        a. Fetch the target version row — verify it exists, belongs to this tenant, and is in a rollback-eligible status (`rolled_back` or `archived`)
        b. If target version has status `active`, throw: already active, nothing to roll back to
        c. If target version has status `deleted`, throw: version has been permanently deleted
        d. Set current `active` version (if any) to `rolled_back`:
           ```sql
           UPDATE tenant_profiles SET status = 'rolled_back', updated_at = NOW()
           WHERE tenant_id = ? AND profile_identity = ? AND status = 'active'
           ```
        e. Set target version to `active`:
           ```sql
           UPDATE tenant_profiles SET status = 'active', updated_at = NOW()
           WHERE tenant_id = ? AND id = ?
           ```
     3. Log operation with metadata: `{ fromVersion, toVersion, profileIdentity }`
     4. Return the now-active target version
2. Rollback must be atomic: if either UPDATE fails, the entire transaction rolls back. No intermediate state where zero or two versions are active.
3. Write unit tests in `tests/profiles/versioning/rollback.test.ts`:
   - Rollback from v3 to v1: v3 becomes `rolled_back`, v1 becomes `active`
   - Rollback to already-active version: error
   - Rollback to deleted version: error
   - Rollback to non-existent version: error
   - Cross-tenant rollback attempt: denied
   - Concurrent rollbacks: only one succeeds (transaction isolation)

**Files**:
- `joyus-ai-mcp-server/src/profiles/versioning/service.ts` (extend, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/versioning/rollback.test.ts` (new, ~100 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Rollback tests pass
- [ ] Transaction atomicity: both UPDATEs succeed or neither does
- [ ] Exactly one `active` version after rollback
- [ ] Operation is logged with from/to version metadata

---

## Subtask T014: Implement Version History Queries

**Purpose**: Implement version history queries that list all versions of a profile with timestamps, corpus snapshot references, and fidelity scores.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/versioning/history.ts`
2. Implement `ProfileVersionHistory` class with methods:
   - `constructor(db: DrizzleClient)`
   - `async getHistory(tenantId: string, profileIdentity: string, options?: { limit?, offset?, includeDeleted? }): Promise<{ versions: TenantProfile[]; total: number }>`:
     1. `requireTenantId(tenantId)`
     2. Query `tenant_profiles` with `tenantWhere(tenantId)` and `profileIdentity` filter
     3. By default, exclude `deleted` status. Include if `includeDeleted` is true.
     4. Order by `version` descending (newest first)
     5. Apply pagination (limit, offset)
     6. Return versions with total count
   - `async getVersionSummary(tenantId: string, profileIdentity: string): Promise<VersionSummary>`:
     - Return: total versions, current active version number, latest version number, oldest version date, newest version date, average fidelity score
   - `async listProfileIdentities(tenantId: string, options?: { tier?, limit?, offset? }): Promise<string[]>`:
     - Return distinct profileIdentity values for the tenant, optionally filtered by tier
3. Write unit tests in `tests/profiles/versioning/history.test.ts`:
   - History returns all versions ordered by version desc
   - Pagination works correctly
   - Deleted versions are excluded by default
   - Summary returns correct aggregates
   - Tenant scoping is enforced

**Files**:
- `joyus-ai-mcp-server/src/profiles/versioning/history.ts` (new, ~100 lines)
- `joyus-ai-mcp-server/tests/profiles/versioning/history.test.ts` (new, ~80 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] History tests pass
- [ ] Versions are ordered correctly (newest first)
- [ ] Pagination returns correct subsets
- [ ] Summary aggregates are accurate

---

## Subtask T015: Implement Retention Policy Enforcement

**Purpose**: Implement the background retention policy that soft-deletes expired versions and hard-deletes versions past the recovery window.

**Steps**:
1. Add to `service.ts` in `ProfileVersionService`:
   - `async enforceRetention(tenantId: string, retentionDays: number = 90): Promise<{ archived: number; deleted: number }>`:
     1. `requireTenantId(tenantId)`
     2. Phase 1 — Soft-delete (archive): Find versions with status `rolled_back` where `createdAt` is older than `retentionDays` days ago. Transition to `archived`, set `archivedAt`.
     3. Phase 2 — Hard-delete: Find versions with status `archived` where `archivedAt` is older than 30 days ago (SOFT_DELETE_RECOVERY_DAYS). Transition to `deleted` (or physically delete the row — spec says soft-delete first, then hard-delete).
     4. Never archive or delete the current `active` version, regardless of age.
     5. Log operation with counts: `{ archived: N, deleted: M }`
     6. Return counts
   - `async getRetentionStatus(tenantId: string): Promise<RetentionStatus>`:
     - Return: total versions, active count, rolled_back count, archived count, deleted count, oldest non-deleted version date
2. Retention policy respects FR-009: minimum 90 days or tenant-configured, whichever is longer. The `retentionDays` parameter must be >= 90 (validated by Zod schema in WP01).
3. Write unit tests in `tests/profiles/versioning/retention.test.ts`:
   - Versions older than retention window are archived
   - Archived versions older than 30 days are deleted
   - Active versions are never archived regardless of age
   - Retention minimum of 90 days is enforced (cannot pass <90)

**Files**:
- `joyus-ai-mcp-server/src/profiles/versioning/service.ts` (extend, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/versioning/retention.test.ts` (new, ~80 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Retention tests pass
- [ ] Active versions are never archived
- [ ] Two-phase lifecycle: rolled_back -> archived -> deleted
- [ ] Minimum 90-day retention is enforced

---

## Subtask T016: Implement Version Comparison

**Purpose**: Compute the diff between two profile versions, showing which features changed, by how much, and in what direction.

**Steps**:
1. Add to `history.ts` in `ProfileVersionHistory`:
   - `async compareVersions(tenantId: string, profileIdentity: string, versionA: number, versionB: number): Promise<VersionComparison[]>`:
     1. `requireTenantId(tenantId)`
     2. Fetch both versions — verify they exist and belong to this tenant
     3. Extract `stylometricFeatures` (Record<string, number>) from each
     4. For each feature key across both versions:
        - Compute `delta = newValue - oldValue`
        - Compute `percentChange = ((newValue - oldValue) / oldValue) * 100` (handle division by zero)
     5. Return an array of `VersionComparison` objects, sorted by absolute delta descending (largest changes first)
   - `async compareWithActive(tenantId: string, profileIdentity: string, version: number): Promise<VersionComparison[]>`:
     - Convenience method: compare the given version with the current active version
2. Write unit tests in `tests/profiles/versioning/comparison.test.ts`:
   - Two versions with different features produce correct deltas
   - Features present in only one version are included (oldValue or newValue is 0)
   - Division by zero is handled (oldValue = 0)
   - Results are sorted by absolute delta descending

**Files**:
- `joyus-ai-mcp-server/src/profiles/versioning/history.ts` (extend, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/versioning/comparison.test.ts` (new, ~70 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Comparison tests pass
- [ ] Deltas are computed correctly
- [ ] Percent change handles edge cases (zero values)
- [ ] Results sorted by magnitude

---

## Definition of Done

- [ ] Version creation assigns monotonic integers, never mutates existing rows (FR-003)
- [ ] Exactly one `active` version per (tenantId, profileIdentity) at all times
- [ ] Atomic rollback switches versions in a single transaction (FR-004)
- [ ] Rollback completes in <30 seconds (NFR-002)
- [ ] Version history is queryable with pagination and filtering (FR-009)
- [ ] Retention policy archives after configurable window (>=90 days), deletes after 30 more (FR-009)
- [ ] Active versions are never archived or deleted regardless of age
- [ ] Version comparison produces accurate feature vector deltas
- [ ] All operations are tenant-scoped and logged
- [ ] `npm run typecheck` passes with zero errors
- [ ] All unit tests pass: `npx vitest run tests/profiles/versioning/`

## Risks

- **Concurrent version creation**: Two generation pipelines completing at the same time could race on MAX(version). Mitigation: version creation is within a transaction with the advisory lock from WP02.
- **Rollback + generation race**: A rollback executing while a new generation is completing. Mitigation: both operations use the same tenant advisory lock.
- **Large version history**: A profile with 100+ versions could make history queries slow. Mitigation: pagination is mandatory; add index on `(tenantId, profileIdentity, version)` (already in schema).

## Reviewer Guidance

- Verify rollback uses a SINGLE database transaction for both status updates
- Verify version numbers never reuse or skip values
- Confirm active version is protected from retention policy
- Check that all queries use `tenantWhere` or equivalent tenant scoping
- Verify operation logging captures all version lifecycle events
- Confirm comparison handles the edge case where a feature exists in one version but not the other
