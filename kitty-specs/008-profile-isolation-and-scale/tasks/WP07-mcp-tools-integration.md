---
work_package_id: WP07
title: MCP Tools & Integration
lane: planned
dependencies: [WP02, WP03, WP04, WP05]
subtasks: [T032, T033, T034, T035, T036]
phase: Phase 7 - MCP Tools & Integration
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

# WP07: MCP Tools & Integration

## Objective

Implement MCP tools for all profile operations (list, get, generate, rollback, version history, intake, resolve, cache management), create the profiles module entry point with service initialization and wiring, mount the profiles module in the main server, and build comprehensive cross-tenant isolation regression tests and edge case test suites.

## Implementation Command

```bash
spec-kitty implement WP07 --base WP05
```

## Context

- **Spec**: `kitty-specs/008-profile-isolation-and-scale/spec.md` — FR-001 (cross-tenant isolation), edge cases (tenant deletion, zero-doc corpus, single-author, no-author)
- **Plan**: `kitty-specs/008-profile-isolation-and-scale/plan.md` — Phase 7 deliverables
- **Existing tool pattern**: `src/tools/content-tools.ts` — exports a `ToolDefinition[]` array with `content_` prefix
- **Existing executor pattern**: `src/tools/executor.ts` — routes by prefix (`content_` -> content executor)
- **Existing tool index**: `src/tools/index.ts` — registers tools and pushes to `getAllTools()`
- **Existing module mount**: `src/index.ts` — see how `src/content/` module is initialized and mounted
- **Profile tools prefix**: `profile_` — all profile MCP tools use this prefix
- **Dependencies**: This WP consumes all services from WP01-WP06: versioning, generation, inheritance, intake, cache

---

## Subtask T032: Create MCP Tools for Profile Operations

**Purpose**: Define all MCP tool definitions for profile operations and implement a profile-specific executor.

**Steps**:
1. Create `joyus-ai-mcp-server/src/tools/profile-tools.ts`
2. Define `ToolDefinition[]` array with the following tools (use `profile_` prefix):

   **Profile Management**:
   - `profile_list_profiles`: List all active profiles for the tenant. Input: `{ tier?: string, limit?: number, offset?: number }`. Returns profile identities with tier, active version, fidelity score.
   - `profile_get_profile`: Get a specific profile version. Input: `{ profileIdentity: string, version?: number }`. Returns full profile data including features, markers, status. If no version specified, returns active version.
   - `profile_get_resolved`: Get the resolved (inheritance-merged) profile. Input: `{ profileIdentity: string, forceRefresh?: boolean }`. Uses cache (WP06). If forceRefresh, invalidate cache first.

   **Generation**:
   - `profile_generate`: Trigger profile generation from a corpus snapshot. Input: `{ corpusSnapshotId: string, authorIds?: string[], tier?: string, parentProfileIdentity?: string }`. Returns generation run ID.
   - `profile_get_generation_status`: Check generation run progress. Input: `{ runId: string }`. Returns run status, progress counts, errors.

   **Versioning**:
   - `profile_version_history`: Get version history for a profile. Input: `{ profileIdentity: string, limit?: number, offset?: number }`. Returns version list with metadata.
   - `profile_rollback`: Roll back to a previous version. Input: `{ profileIdentity: string, targetVersion: number }`. Returns the now-active version.
   - `profile_compare_versions`: Compare two versions. Input: `{ profileIdentity: string, versionA: number, versionB: number }`. Returns feature deltas.

   **Corpus & Intake**:
   - `profile_list_documents`: List corpus documents. Input: `{ authorId?: string, limit?: number, offset?: number }`. Returns document list.
   - `profile_list_snapshots`: List corpus snapshots. Input: `{ limit?: number, offset?: number }`. Returns snapshot list.
   - `profile_intake_status`: Get intake pipeline status. Input: `{}`. Returns recent intake operations.

   **Hierarchy & Inheritance**:
   - `profile_get_hierarchy`: Get the full profile hierarchy tree. Input: `{}`. Returns hierarchy nodes.
   - `profile_set_parent`: Set or change a profile's parent. Input: `{ childIdentity: string, parentIdentity: string }`. Returns updated relationship.

3. Follow existing tool definition pattern from `content-tools.ts`:
   ```typescript
   export const profileTools: ToolDefinition[] = [
     {
       name: 'profile_list_profiles',
       description: 'List all active writing profiles...',
       inputSchema: { type: 'object', properties: { ... }, required: [] }
     },
     // ...
   ];
   ```
4. Create `joyus-ai-mcp-server/src/tools/executors/profile-executor.ts`:
   - `async executeProfileTool(toolName: string, input: Record<string, unknown>, context: { userId: string; tenantId: string }): Promise<unknown>`
   - Route each tool name to the appropriate service method
   - Extract `tenantId` from context (never from input — Leash pattern)
   - Validate input with the appropriate Zod schema from `validation.ts`
   - Call the service method and return the result

**Files**:
- `joyus-ai-mcp-server/src/tools/profile-tools.ts` (new, ~200 lines)
- `joyus-ai-mcp-server/src/tools/executors/profile-executor.ts` (new, ~180 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All tool definitions have correct input schemas
- [ ] Executor routes all tool names correctly
- [ ] No tool accepts `tenantId` as an input parameter

---

## Subtask T033: Create Module Entry Point

**Purpose**: Create the profiles module entry point that initializes all services and exports them for use by the tool executor and main server.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/index.ts`
2. Implement module initialization:
   ```typescript
   export interface ProfilesModule {
     versionService: ProfileVersionService;
     historyService: ProfileVersionHistory;
     pipeline: ProfileGenerationPipeline;
     engineBridge: EngineBridge;
     snapshotService: CorpusSnapshotService;
     hierarchyService: ProfileHierarchyService;
     resolver: InheritanceResolver;
     intakeService: IntakeService;
     cacheService: ProfileCacheService;
     invalidationService: CacheInvalidationService;
     logger: ProfileOperationLogger;
     metrics: ProfileMetrics;
     parserRegistry: ParserRegistry;
     dedupService: DeduplicationService;
   }
   ```
3. Implement `initializeProfiles(db: DrizzleClient, config?: ProfilesConfig): ProfilesModule`:
   - Create all service instances with correct dependency injection order:
     1. Logger and Metrics (no dependencies)
     2. EngineBridge (config only)
     3. ParserRegistry + register all parsers (PdfParser, DocxParser, TextParser)
     4. DeduplicationService (db)
     5. CorpusSnapshotService (db)
     6. ProfileGenerationPipeline (db, engineBridge, snapshotService)
     7. ProfileVersionService (db, logger)
     8. ProfileVersionHistory (db)
     9. ProfileHierarchyService (db, logger)
     10. InheritanceResolver (db, hierarchyService)
     11. IntakeService (db, parserRegistry, dedupService, snapshotService, logger)
     12. ProfileCacheService (db, resolver, logger)
     13. CacheInvalidationService (db, hierarchyService, cacheService, logger)
   - Return the initialized module
4. Define `ProfilesConfig` interface:
   ```typescript
   interface ProfilesConfig {
     pythonPath?: string;            // Default: 'python3'
     engineScriptPath?: string;      // Path to Spec 005 engine
     engineTimeoutMs?: number;       // Default: 360000 (6 min)
     cacheWarmThreshold?: number;    // Default: 20
   }
   ```
5. Export all types, services, and the initialization function

**Files**:
- `joyus-ai-mcp-server/src/profiles/index.ts` (new, ~100 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] `initializeProfiles` creates all services without errors
- [ ] All services are accessible through the returned module object
- [ ] Parser registry has all 3 parsers registered

---

## Subtask T034: Extend Main index.ts to Mount Profiles Module

**Purpose**: Wire the profiles module into the main server startup, following the same pattern used for the content module.

**Steps**:
1. Edit `joyus-ai-mcp-server/src/index.ts`
2. Import `initializeProfiles` from `./profiles/index.js`
3. Import `profileTools` from `./tools/profile-tools.js`
4. In the server initialization section (where content module is initialized):
   - Call `initializeProfiles(db, profilesConfig)` to create the module
   - Store the module reference for use by the executor
5. Edit `src/tools/executor.ts`:
   - Add `profile_` prefix routing:
     ```typescript
     if (toolName.startsWith('profile_')) {
       return executeProfileTool(toolName, input, { userId, tenantId });
     }
     ```
6. Edit `src/tools/index.ts`:
   - Import `profileTools` and add to `getAllTools()`:
     ```typescript
     tools.push(...profileTools);  // Always available
     ```
7. Verify existing functionality is unchanged — no modifications to content module initialization or existing tool routing

**Files**:
- `joyus-ai-mcp-server/src/index.ts` (modify, ~10 lines)
- `joyus-ai-mcp-server/src/tools/executor.ts` (modify, ~5 lines)
- `joyus-ai-mcp-server/src/tools/index.ts` (modify, ~5 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Server starts without errors
- [ ] Profile tools appear in `getAllTools()` output
- [ ] Profile tool execution routes correctly through the executor
- [ ] Existing content tools and other tools are unaffected

---

## Subtask T035: Create Cross-Tenant Isolation Regression Tests

**Purpose**: Build a comprehensive test suite that verifies cross-tenant data isolation across all profile operations — the critical correctness requirement (FR-001, FR-002).

**Steps**:
1. Create `joyus-ai-mcp-server/tests/profiles/tenant-isolation.test.ts`
2. Test structure: create two tenants (Tenant A and Tenant B) with overlapping data (same author names, similar corpus) and verify zero data leakage across all operations.
3. Test cases (target: comprehensive coverage for zero-leak guarantee):

   **Data layer isolation**:
   - T-ISO-001: Tenant A's profile is not visible via Tenant B's list query
   - T-ISO-002: Tenant A's profile cannot be fetched by ID using Tenant B's tenantId
   - T-ISO-003: Tenant A's corpus documents are not visible to Tenant B
   - T-ISO-004: Tenant A's corpus snapshots are not accessible to Tenant B
   - T-ISO-005: Tenant A's generation runs are not visible to Tenant B

   **Pipeline isolation**:
   - T-ISO-006: Tenant A's profile generation produces profiles scoped only to Tenant A
   - T-ISO-007: Concurrent generation for Tenant A and B produces independent, correct results
   - T-ISO-008: Overlapping author names (both tenants have "Jane Smith") produce independent profiles

   **Version isolation**:
   - T-ISO-009: Tenant A cannot roll back Tenant B's profile
   - T-ISO-010: Tenant A's version history shows only Tenant A's versions

   **Inheritance isolation**:
   - T-ISO-011: Tenant A's hierarchy is independent of Tenant B's
   - T-ISO-012: Resolved profiles use only the tenant's own inheritance chain

   **Intake isolation**:
   - T-ISO-013: Deduplication is scoped per tenant — same document in both tenants is not flagged as duplicate
   - T-ISO-014: Intake for Tenant A does not create documents visible to Tenant B

   **Cache isolation**:
   - T-ISO-015: Tenant A's cache entries are not returned for Tenant B
   - T-ISO-016: Cache invalidation for Tenant A does not affect Tenant B's cache

4. Each test case should assert a specific isolation boundary. The full suite should cover the SC-002 target: "zero false negatives over 10,000 test queries" is validated in WP08, but the test cases here cover all operations.

**Files**:
- `joyus-ai-mcp-server/tests/profiles/tenant-isolation.test.ts` (new, ~250 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All 16 isolation tests pass
- [ ] Zero cross-tenant data leakage detected
- [ ] Tests use realistic overlapping data (same author names, similar content)

---

## Subtask T036: Create Edge Case Tests

**Purpose**: Test the spec-defined edge cases: tenant deletion, zero-document corpus, single-author corpus, and no-author corpus.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/profiles/edge-cases.test.ts`
2. Test cases:

   **Tenant deletion (soft-delete)**:
   - EC-001: Soft-delete a tenant's profiles: all profiles get status `deleted`, all documents get `isActive = false`
   - EC-002: Soft-deleted data is not returned by normal queries
   - EC-003: Soft-deleted data IS recoverable within 30-day window
   - EC-004: Hard-delete after 30 days: data is permanently removed
   - EC-005: No orphaned data in shared indexes after hard-delete

   **Zero-document corpus**:
   - EC-006: Profile generation with zero documents is rejected with clear error
   - EC-007: No empty profiles are created
   - EC-008: The rejection error message is informative

   **Single-author corpus**:
   - EC-009: Profile is generated successfully
   - EC-010: Profile is flagged with `lowConfidence: true` in metadata
   - EC-011: The low-confidence flag is visible in profile queries

   **No-author corpus**:
   - EC-012: Documents are ingested successfully (stored in corpus_documents)
   - EC-013: Profile generation is deferred — clear message that author attribution is needed
   - EC-014: Once authors are attributed, generation can proceed

3. Implement a `tenantCleanup(tenantId: string)` helper function that performs the soft-delete:
   - Set all `tenant_profiles` to status `deleted`
   - Set all `corpus_documents` to `isActive = false`
   - Delete all `profile_cache` entries
   - Delete all `profile_inheritance` entries
   - Log the cleanup operation

**Files**:
- `joyus-ai-mcp-server/tests/profiles/edge-cases.test.ts` (new, ~200 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All 14 edge case tests pass
- [ ] Tenant deletion leaves no orphaned data
- [ ] Zero-document corpus produces clear error, not empty profiles
- [ ] Single-author corpus flags low confidence
- [ ] No-author corpus defers generation with informative message

---

## Definition of Done

- [ ] All MCP tools defined with correct schemas and `profile_` prefix
- [ ] Profile executor routes all tools to correct service methods
- [ ] Tools registered in tool index (always available)
- [ ] Profiles module initializes all services with correct dependency injection
- [ ] Module mounts in main server without affecting existing functionality
- [ ] Cross-tenant isolation: 16 test cases covering all operations pass with zero leakage
- [ ] Edge cases: tenant deletion, zero-doc, single-author, no-author all handled correctly
- [ ] `npm run typecheck` passes with zero errors
- [ ] All tests pass: `npx vitest run tests/profiles/`

## Risks

- **Executor context**: Existing executor passes `userId` but profile tools need `tenantId` too. May need to extend the executor context (same issue as content tools — follow the same solution).
- **Service initialization order**: Circular dependencies between services. Mitigation: the `initializeProfiles` function creates services in dependency order. No circular references exist in the design.
- **Test database state**: Isolation tests require multiple tenants with data. Must use proper setup/teardown to avoid test pollution.

## Reviewer Guidance

- Verify all tool definitions follow the existing pattern (`ToolDefinition[]` array, inputSchema format)
- Check executor routes every tool name (no missing cases in the switch)
- Confirm `tenantId` is never accepted from tool input — always from context
- Verify module initialization order matches dependency graph
- Check that existing tools and content module are completely unaffected
- Review isolation tests: verify they use different tenantIds with overlapping data
- Verify edge case tests cover all 4 spec-defined scenarios
- Confirm tenant cleanup removes data from ALL profile tables
