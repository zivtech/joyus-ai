---
work_package_id: WP04
title: Composite Profile Inheritance
lane: planned
dependencies: [WP01]
subtasks: [T017, T018, T019, T020, T021]
phase: Phase 4 - Composite Profile Inheritance
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP04: Composite Profile Inheritance

## Objective

Build the three-tier profile inheritance system (org > department > individual): hierarchy management for parent-child relationships, an inheritance resolver implementing nearest-ancestor-wins merging, feature vector merging with per-feature override tracking, override source tracing for auditability, and cascade propagation that triggers downstream re-resolution when ancestor profiles change.

## Implementation Command

```bash
spec-kitty implement WP04 --base WP01
```

## Context

- **Spec**: `kitty-specs/008-profile-isolation-and-scale/spec.md` — FR-005 (three-tier inheritance, deterministic resolution), NFR-005 (<=5% fidelity degradation)
- **Plan**: `kitty-specs/008-profile-isolation-and-scale/plan.md` — Phase 4 deliverables
- **Research**: `kitty-specs/008-profile-isolation-and-scale/research.md` — R3 (nearest-ancestor-wins, per-feature override tracking, markers use union-with-tier-annotation)
- **Data Model**: `kitty-specs/008-profile-isolation-and-scale/data-model.md` — `profile_inheritance` table, `profile_cache` table
- **Foundation**: WP01 schema (profile_inheritance table, types, tenant-scope)
- **Key design**: Inheritance relationships reference `profileIdentity` (stable across versions), not specific version IDs. When a parent's active version changes, the child's resolved profile updates automatically.
- **Merge strategy**: Walk chain from org (least specific) to individual (most specific). Each feature is overridden by the most specific tier that defines it. Track which tier provided each feature.
- **Safety limit**: `MAX_HIERARCHY_DEPTH = 10` — if chain exceeds this, log warning and bail.

---

## Subtask T017: Create Hierarchy Management Service

**Purpose**: Implement CRUD operations for managing parent-child profile relationships in the inheritance hierarchy.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/inheritance/hierarchy.ts`
2. Import schema, types, tenant-scope helpers
3. Implement `ProfileHierarchyService` class with methods:
   - `constructor(db: DrizzleClient, logger: ProfileOperationLogger)`
   - `async createRelationship(tenantId: string, parentIdentity: string, childIdentity: string): Promise<ProfileInheritanceRow>`:
     1. `requireTenantId(tenantId)`
     2. Validate: parent and child are different identities
     3. Validate: no circular reference — walk up from parent to ensure child is not an ancestor
     4. Validate: hierarchy depth does not exceed MAX_HIERARCHY_DEPTH
     5. Insert into `profile_inheritance` table
     6. Log operation
     7. Return the created row
   - `async removeRelationship(tenantId: string, parentIdentity: string, childIdentity: string): Promise<boolean>`:
     - Delete the relationship row (tenant-scoped)
     - Return true if deleted, false if not found
   - `async getParent(tenantId: string, childIdentity: string): Promise<string | null>`:
     - Query the parent identity for a given child (tenant-scoped)
   - `async getChildren(tenantId: string, parentIdentity: string): Promise<string[]>`:
     - Query all child identities for a given parent (tenant-scoped)
   - `async getAncestorChain(tenantId: string, profileIdentity: string): Promise<string[]>`:
     - Walk up the hierarchy from the given identity to the root
     - Return ordered array: `[self, parent, grandparent, ..., root]`
     - Safety check: if chain length exceeds MAX_HIERARCHY_DEPTH, throw error
   - `async getDescendants(tenantId: string, profileIdentity: string): Promise<string[]>`:
     - Walk down the hierarchy from the given identity
     - Return all descendant identities (breadth-first)
     - Used by cascade propagation (T021) and cache invalidation (WP06)
   - `async getFullHierarchy(tenantId: string): Promise<HierarchyNode[]>`:
     - Return the complete hierarchy tree for the tenant
     - `HierarchyNode = { identity: string; tier: ProfileTier; children: HierarchyNode[] }`
4. Circular reference detection: before inserting a new relationship, walk the ancestor chain of `parentIdentity`. If `childIdentity` appears anywhere in that chain, reject with error.
5. Write unit tests in `tests/profiles/inheritance/hierarchy.test.ts`:
   - Create org -> dept -> individual chain
   - Get ancestor chain returns correct order
   - Circular reference is rejected
   - Depth limit is enforced
   - Cross-tenant hierarchy access is denied
   - Remove relationship succeeds and breaks the chain

**Files**:
- `joyus-ai-mcp-server/src/profiles/inheritance/hierarchy.ts` (new, ~160 lines)
- `joyus-ai-mcp-server/tests/profiles/inheritance/hierarchy.test.ts` (new, ~120 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Hierarchy tests pass
- [ ] Circular references are detected and rejected
- [ ] Depth limit is enforced
- [ ] Ancestor chain is ordered correctly (self first, root last)
- [ ] Tenant scoping is enforced on all operations

---

## Subtask T018: Create Inheritance Resolver

**Purpose**: Implement the core resolver that walks the inheritance chain and computes the resolved profile using nearest-ancestor-wins merging.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/inheritance/resolver.ts`
2. Import hierarchy service, schema, types, tenant-scope
3. Implement `InheritanceResolver` class with methods:
   - `constructor(db: DrizzleClient, hierarchyService: ProfileHierarchyService)`
   - `async resolve(tenantId: string, profileIdentity: string): Promise<ResolvedProfile>`:
     1. `requireTenantId(tenantId)`
     2. Get the ancestor chain via `hierarchyService.getAncestorChain(tenantId, profileIdentity)`
     3. For each identity in the chain, fetch the ACTIVE version from `tenant_profiles`
     4. If any identity in the chain has no active version, skip it (use whatever ancestors are available)
     5. Call `mergeProfiles(chain)` (T019) to produce the resolved profile
     6. Return the `ResolvedProfile` with features, markers, and override sources
   - `async resolveMultiple(tenantId: string, profileIdentities: string[]): Promise<Map<string, ResolvedProfile>>`:
     - Batch resolve multiple profiles (optimized: share ancestor lookups where chains overlap)
   - `async resolveWithDetails(tenantId: string, profileIdentity: string): Promise<ResolvedProfileWithDetails>`:
     - Same as `resolve` but also returns:
       - The full ancestor chain with version numbers
       - Per-feature: which tier provided it, what the original value was at each tier
       - Marker merge details
4. Chain ordering: the resolver receives the chain ordered `[self, parent, grandparent, ..., root]` from the hierarchy service. For merging, reverse it to `[root, ..., grandparent, parent, self]` so that later entries (more specific) override earlier entries (less specific). This is the nearest-ancestor-wins algorithm.
5. If the profile has no inheritance relationships (orphan profile or org-level with no parent), the resolved profile is simply the profile's own features and markers.

**Files**:
- `joyus-ai-mcp-server/src/profiles/inheritance/resolver.ts` (new, ~120 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Resolver produces correct resolved profile for a three-tier chain
- [ ] Missing intermediate ancestors are handled gracefully (skip, use available)
- [ ] Orphan profiles resolve to their own features
- [ ] Batch resolve shares ancestor lookups

---

## Subtask T019: Implement Feature Vector Merging

**Purpose**: Implement the merge logic for 129-feature stylometric vectors with per-feature override tracking, and the union-with-tier-annotation strategy for markers.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/inheritance/merge.ts`
2. Implement `mergeFeatureVectors(chain: ProfileVersion[]): { features: Map<string, ResolvedFeature>; overrideSources: Record<string, OverrideSource> }`:
   - `chain` is ordered `[root, ..., parent, self]` (least specific first)
   - Walk the chain from root to self
   - For each profile in the chain, iterate its `stylometricFeatures` (Record<string, number>)
   - For each feature key with a non-null, non-undefined value: set or override the resolved value
   - Track the source: `{ sourceTier, sourceProfileId, sourceVersion }` for each feature
   - The final map contains 129 features, each with the value from the nearest ancestor that defines it
3. Implement `mergeMarkers(chain: ProfileVersion[]): ProfileMarkers`:
   - Markers use union-with-tier-annotation strategy (per research R3)
   - Collect markers from all tiers
   - If the same marker name appears at multiple tiers, the most specific tier's version wins (for threshold, frequency, context)
   - Annotate each marker with its source tier
4. Implement `ProfileVersion` interface used by merge:
   ```typescript
   interface ProfileVersion {
     id: string;
     profileIdentity: string;
     version: number;
     tier: ProfileTier;
     stylometricFeatures: Record<string, number>;
     markers: unknown;
   }
   ```
5. Write unit tests in `tests/profiles/inheritance/merge.test.ts`:
   - Three-tier merge: org sets 129 features, dept overrides 3, individual overrides 2 more. Verify 5 features come from dept/individual, 124 from org.
   - Override tracking: each feature has correct source tier and profile ID
   - Missing features: a tier that does not define a feature does not override the ancestor's value
   - Markers: same marker at multiple tiers, most specific wins
   - Empty chain: returns empty resolved profile
   - Single-tier chain: returns profile's own features unchanged

**Files**:
- `joyus-ai-mcp-server/src/profiles/inheritance/merge.ts` (new, ~120 lines)
- `joyus-ai-mcp-server/tests/profiles/inheritance/merge.test.ts` (new, ~120 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Merge tests pass
- [ ] Nearest-ancestor-wins is deterministic: same input always produces same output
- [ ] All 129 features are accounted for in the resolved output
- [ ] Override sources are correct for every feature
- [ ] Marker union with tier annotation works correctly

---

## Subtask T020: Implement Override Source Tracing

**Purpose**: Ensure the resolved profile exposes which tier provided each feature value, enabling users to understand and debug inheritance behavior.

**Steps**:
1. Extend `resolver.ts` to include detailed tracing in the `resolveWithDetails` method:
   - For each of the 129 features in the resolved profile, include:
     - `featureKey`: the feature name
     - `resolvedValue`: the final value
     - `sourceTier`: which tier provided it (`org`, `department`, or `individual`)
     - `sourceProfileId`: the specific profile version ID
     - `sourceVersion`: the version number
     - `allTierValues`: optional — what each tier in the chain defined for this feature (for debugging)
2. Implement a `getOverrideReport(tenantId: string, profileIdentity: string): Promise<OverrideReport>`:
   - Returns a structured report showing:
     - Total features: 129
     - Features from each tier: `{ org: N, department: M, individual: K }`
     - List of overridden features (where a descendant overrides an ancestor value)
     - List of inherited features (where the resolved value comes from an ancestor)
3. Write unit tests:
   - Override report for a three-tier chain shows correct counts
   - All 129 features are accounted for
   - Overridden features correctly identify which tier's value was overridden

**Files**:
- `joyus-ai-mcp-server/src/profiles/inheritance/resolver.ts` (extend, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/inheritance/resolver.test.ts` (new, ~80 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Override report tests pass
- [ ] Every feature in the resolved profile has a traceable source
- [ ] Override counts sum to 129 (FEATURE_COUNT)
- [ ] Overridden features list identifies the ancestor value that was replaced

---

## Subtask T021: Implement Cascade Propagation

**Purpose**: When an ancestor profile is updated (new version created or rollback), trigger re-resolution for all downstream profiles in the inheritance chain.

**Steps**:
1. Add to `resolver.ts` or create a new `cascade.ts`:
   - `async propagateChange(tenantId: string, changedProfileIdentity: string): Promise<{ affected: string[]; reresolved: number }>`:
     1. `requireTenantId(tenantId)`
     2. Get all descendants of the changed profile via `hierarchyService.getDescendants(tenantId, changedProfileIdentity)`
     3. For each descendant:
        a. Re-resolve the profile (call `resolve(tenantId, descendantIdentity)`)
        b. If a cache entry exists (WP06 will implement this), invalidate it (for now, just mark for invalidation — the actual cache service comes in WP06)
     4. Log the propagation operation with the count of affected profiles
     5. Return the list of affected identities and how many were re-resolved
2. Integration point with WP02: after the generation pipeline creates a new profile version, call `propagateChange` if the profile has descendants.
3. Integration point with WP03: after a rollback, call `propagateChange` for the rolled-back profile.
4. For now (before WP06), propagation re-resolves profiles but does not update a cache. WP06 will add cache invalidation that hooks into this propagation.
5. Write unit tests in `tests/profiles/inheritance/cascade.test.ts`:
   - Org profile update triggers re-resolution for department and individual descendants
   - Department profile update triggers re-resolution only for its children (not siblings)
   - Profile with no descendants: propagation is a no-op
   - Propagation count is accurate

**Files**:
- `joyus-ai-mcp-server/src/profiles/inheritance/resolver.ts` (extend, ~50 lines) or `cascade.ts` (new, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/inheritance/cascade.test.ts` (new, ~80 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Cascade tests pass
- [ ] Org update affects all descendants
- [ ] Department update affects only its subtree
- [ ] Leaf node update has no cascade effect
- [ ] Propagation logs the operation with affected count

---

## Definition of Done

- [ ] Hierarchy management supports create, remove, query parent/children/ancestors/descendants (FR-005)
- [ ] Circular reference detection prevents invalid hierarchies
- [ ] Inheritance resolver implements nearest-ancestor-wins deterministically (FR-005)
- [ ] Feature vector merge handles all 129 features with per-feature override tracking
- [ ] Marker merge uses union-with-tier-annotation strategy
- [ ] Override source tracing shows which tier provided each feature
- [ ] Cascade propagation re-resolves descendants on ancestor change
- [ ] Hierarchy depth limited to MAX_HIERARCHY_DEPTH = 10
- [ ] All operations are tenant-scoped and logged
- [ ] `npm run typecheck` passes with zero errors
- [ ] All unit tests pass: `npx vitest run tests/profiles/inheritance/`

## Risks

- **Fidelity degradation**: Inheritance merging may degrade fidelity beyond the 5% threshold (NFR-005). Mitigation: test with realistic 129-feature vectors. The nearest-ancestor-wins strategy is the least lossy option (per research R3).
- **Deep hierarchies**: While spec says 3 tiers, the code supports up to MAX_HIERARCHY_DEPTH = 10. Deep hierarchies increase resolution time. Mitigation: depth limit + logging.
- **Cascade storms**: An org profile update in a tenant with many profiles could trigger many re-resolutions. Mitigation: propagation is async-eligible in the future; for now, it runs synchronously but logs timing.

## Reviewer Guidance

- Verify circular reference detection walks the full ancestor chain before inserting
- Verify merge is deterministic: same chain always produces same resolved profile
- Verify override tracking accounts for all 129 features (not just overridden ones — inherited features also have a source)
- Check that cascade propagation uses the hierarchy service's `getDescendants` (not a manual walk)
- Verify depth limit is checked on both creation and resolution
- Confirm all database queries use tenant scoping
