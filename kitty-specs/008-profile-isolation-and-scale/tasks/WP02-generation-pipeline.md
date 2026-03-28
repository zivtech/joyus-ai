---
work_package_id: WP02
title: Profile Generation Pipeline
lane: planned
dependencies: [WP01]
subtasks: [T007, T008, T009, T010, T011]
phase: Phase 2 - Profile Generation Pipeline
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

# WP02: Profile Generation Pipeline

## Objective

Build the core profile generation pipeline: a subprocess bridge to Spec 005's stable Python stylometric engine, a corpus snapshot service for creating immutable corpus records, a generation orchestrator that drives the full intake-to-profile flow, concurrent tenant-isolated pipeline execution with advisory locks, and structured pipeline status tracking with operation logging.

## Implementation Command

```bash
spec-kitty implement WP02 --base WP01
```

## Context

- **Spec**: `kitty-specs/008-profile-isolation-and-scale/spec.md` — FR-001 (tenant scoping), FR-002 (tenant-scoped pipeline), FR-010 (concurrent pipelines)
- **Plan**: `kitty-specs/008-profile-isolation-and-scale/plan.md` — Phase 2 deliverables
- **Data Model**: `kitty-specs/008-profile-isolation-and-scale/data-model.md` — `generation_runs`, `corpus_snapshots`, `tenant_profiles` tables
- **Research**: `kitty-specs/008-profile-isolation-and-scale/research.md` — R1 (TenantScope), R2 (immutable versioning)
- **Foundation**: WP01 provides `schema.ts`, `types.ts`, `validation.ts`, `tenant-scope.ts`
- **External dependency**: Spec 005 Python stylometric engine — invoked via `child_process.execFile`, expects a corpus directory path, outputs a JSON profile with 129-feature vector and markers
- **Performance target**: 50-document corpus generation within 10 minutes (NFR-001, SC-001). Budget 60% for engine, 40% for orchestration.

---

## Subtask T007: Create Engine Bridge

**Purpose**: Implement the subprocess bridge that invokes Spec 005's Python stylometric engine from the Node.js profiles module.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/generation/engine-bridge.ts`
2. Import `execFile` from `node:child_process` and `promisify` from `node:util`
3. Define configuration interface:
   ```typescript
   interface EngineBridgeConfig {
     pythonPath: string;         // Path to Python interpreter (default: 'python3')
     engineScriptPath: string;   // Path to Spec 005 engine entry point
     timeoutMs: number;          // Subprocess timeout (default: 360000 = 6 minutes)
     maxBuffer: number;          // Max stdout buffer (default: 50MB for large profiles)
   }
   ```
4. Implement `EngineBridge` class with methods:
   - `constructor(config: EngineBridgeConfig)` — store config, validate paths
   - `async generateProfile(corpusPath: string, authorId: string, options?: { engineVersion?: string }): Promise<EngineResult>` — invoke the Python engine for a single author
   - `async generateBatch(corpusPath: string, authorIds: string[]): Promise<Map<string, EngineResult>>` — invoke for multiple authors (serial or parallel depending on engine support)
   - `async healthCheck(): Promise<{ available: boolean; version?: string; error?: string }>` — verify engine is accessible
5. Define `EngineResult` interface:
   ```typescript
   interface EngineResult {
     authorId: string;
     stylometricFeatures: Record<string, number>;  // 129-feature vector
     markers: unknown;                               // Marker set (Spec 005 schema)
     fidelityScore: number | null;                   // Attribution accuracy
     engineVersion: string;
     durationMs: number;
   }
   ```
6. Error handling:
   - Subprocess timeout: throw `EngineTimeoutError` with duration info
   - Subprocess exit code non-zero: throw `EngineExecutionError` with stderr
   - JSON parse failure on stdout: throw `EngineOutputError` with raw output
   - All errors include `tenantId` context for logging (but NOT in error messages exposed to users)
7. Write unit tests in `tests/profiles/generation/engine-bridge.test.ts`:
   - Mock `execFile` to simulate successful engine output
   - Test timeout handling
   - Test malformed output handling
   - Test health check

**Files**:
- `joyus-ai-mcp-server/src/profiles/generation/engine-bridge.ts` (new, ~150 lines)
- `joyus-ai-mcp-server/tests/profiles/generation/engine-bridge.test.ts` (new, ~100 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Unit tests pass with mocked subprocess
- [ ] Timeout is configurable and enforced
- [ ] Error types are distinguishable (timeout vs. execution vs. output)

---

## Subtask T008: Create Corpus Snapshot Service

**Purpose**: Implement the service that creates immutable corpus snapshots from a set of documents, recording which documents comprised the corpus at generation time.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/generation/corpus-snapshot.ts`
2. Import the profiles schema tables and tenant-scope helpers from WP01
3. Implement `CorpusSnapshotService` class with methods:
   - `constructor(db: DrizzleClient)` — store db reference
   - `async createSnapshot(tenantId: string, options?: { name?: string; documentIds?: string[] }): Promise<CorpusSnapshot>`:
     - Call `requireTenantId(tenantId)` first
     - Query `corpus_documents` for active documents in the tenant (all if no documentIds filter, or specific ones)
     - Compute the snapshot: collect content hashes, count documents, count distinct authors, sum word counts
     - Insert a new `corpus_snapshots` row with the computed data
     - Return the created snapshot
   - `async getSnapshot(tenantId: string, snapshotId: string): Promise<CorpusSnapshot | null>`:
     - Fetch with tenant scoping
     - Use `assertTenantOwnership` on the result
   - `async listSnapshots(tenantId: string, limit?: number, offset?: number): Promise<CorpusSnapshot[]>`:
     - Tenant-scoped query ordered by `createdAt` descending
   - `async getSnapshotDocuments(tenantId: string, snapshotId: string): Promise<CorpusDocument[]>`:
     - Fetch the snapshot, then query documents matching the content hashes in `documentHashes`
4. Snapshots are immutable — no update or delete methods. Once created, a snapshot is a permanent record.
5. Write unit tests in `tests/profiles/generation/corpus-snapshot.test.ts`:
   - Create snapshot from documents, verify counts
   - Verify tenant scoping (cannot access other tenant's snapshots)
   - Verify snapshot immutability (no update methods exist)

**Files**:
- `joyus-ai-mcp-server/src/profiles/generation/corpus-snapshot.ts` (new, ~120 lines)
- `joyus-ai-mcp-server/tests/profiles/generation/corpus-snapshot.test.ts` (new, ~80 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Unit tests pass
- [ ] Snapshot includes correct document count, author count, and word count
- [ ] Tenant scoping is enforced on every query

---

## Subtask T009: Create Generation Pipeline Orchestrator

**Purpose**: Build the main orchestrator that drives the full profile generation pipeline: validate corpus, create snapshot, invoke engine per author, store versioned profiles.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/generation/pipeline.ts`
2. Import `EngineBridge`, `CorpusSnapshotService`, schema, types, tenant-scope, and validation
3. Implement `ProfileGenerationPipeline` class with methods:
   - `constructor(db: DrizzleClient, engineBridge: EngineBridge, snapshotService: CorpusSnapshotService)`
   - `async generate(tenantId: string, input: GenerateProfilesInput): Promise<PipelineResult>`:
     1. `requireTenantId(tenantId)`
     2. Create a `generation_runs` record with status `pending`
     3. Validate the corpus: verify the snapshot has documents, has authors, meets minimum thresholds
     4. Update run status to `running`
     5. Prepare corpus: write tenant-scoped documents to a temp directory for engine consumption
     6. For each author in the corpus (or filtered by `input.authorIds`):
        a. Invoke `engineBridge.generateProfile(corpusPath, authorId)`
        b. Determine the next version number: `SELECT MAX(version) FROM tenant_profiles WHERE tenant_id = ? AND profile_identity = ?` + 1
        c. Insert a new `tenant_profiles` row with status `generating`
        d. On engine success: update status to `active`, store features + markers + fidelity
        e. On engine failure: log error, increment `profilesFailed`, continue to next author
     7. Update run status to `completed` or `failed` based on results
     8. Log operation to `operation_logs`
     9. Clean up temp directory
     10. Return `PipelineResult` with run ID, profile IDs, duration
   - `async getRunStatus(tenantId: string, runId: string): Promise<GenerationRun | null>` — tenant-scoped fetch
4. Profile identity format: `{tier}::{name}` (e.g., `org::default`, `department::engineering`, `individual::author-001`)
5. Version assignment: the pipeline queries the max existing version for the profile identity and increments. If no existing version, start at 1.
6. Zero-document corpus: reject with a clear error in the validation step (spec edge case)
7. Single-author corpus: generate profile but set a metadata flag `lowConfidence: true` (spec edge case)
8. Write unit tests in `tests/profiles/generation/pipeline.test.ts`:
   - Successful generation for 3 authors produces 3 versioned profiles
   - Version numbers increment correctly (v1 -> v2)
   - Zero-document corpus is rejected
   - Single-author corpus flags low confidence
   - Partial failure (1 of 3 authors fails) creates 2 profiles and reports the failure

**Files**:
- `joyus-ai-mcp-server/src/profiles/generation/pipeline.ts` (new, ~250 lines)
- `joyus-ai-mcp-server/tests/profiles/generation/pipeline.test.ts` (new, ~150 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Unit tests pass
- [ ] Profiles are created with correct version numbers and status `active`
- [ ] Generation run record tracks requested, completed, and failed counts
- [ ] Operation log entry is created for every generation
- [ ] Tenant scoping is enforced throughout

---

## Subtask T010: Add Concurrent Pipeline Execution

**Purpose**: Ensure multiple tenants can run profile generation pipelines simultaneously without data corruption, using PostgreSQL advisory locks for tenant-scoped mutual exclusion.

**Steps**:
1. Extend `pipeline.ts` with advisory lock support
2. Implement `acquireTenantLock(tenantId: string): Promise<boolean>`:
   - Use `pg_advisory_xact_lock` with a hash of `tenantId` as the lock key
   - This prevents two pipelines for the SAME tenant from running concurrently (correctness)
   - Pipelines for DIFFERENT tenants proceed without contention (performance)
3. Implement `withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T>`:
   - Acquire lock, execute fn within a transaction, release lock on completion
   - If lock acquisition fails (another pipeline for this tenant is running): return an error result rather than blocking
4. Wrap the `generate()` method's core logic in `withTenantLock`
5. Add a try-lock variant that returns immediately if the lock is held (non-blocking):
   - Use `pg_try_advisory_xact_lock` — returns `false` if lock is held
   - When lock is held: return `PipelineResult` with status `'pending'` and message `'Another generation pipeline is running for this tenant'`
6. Write unit tests:
   - Two pipelines for the same tenant: second one gets "already running" result
   - Two pipelines for different tenants: both succeed independently
   - Lock is released after pipeline completion (success or failure)

**Files**:
- `joyus-ai-mcp-server/src/profiles/generation/pipeline.ts` (modify, ~50 lines added)
- `joyus-ai-mcp-server/tests/profiles/generation/pipeline-concurrent.test.ts` (new, ~80 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Concurrent tests pass
- [ ] Same-tenant concurrency is blocked (returns pending status)
- [ ] Different-tenant concurrency succeeds independently
- [ ] Locks are released on both success and failure paths

---

## Subtask T011: Add Pipeline Status Tracking and Structured Logging

**Purpose**: Implement comprehensive pipeline status tracking in `generation_runs` and structured operation logging for all profile operations.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/monitoring/logger.ts`
2. Implement `ProfileOperationLogger` class:
   - `constructor(db: DrizzleClient)`
   - `async logOperation(params: { tenantId, operation, profileIdentity?, userId?, durationMs, success, metadata? }): Promise<void>`:
     - Insert a row into `operation_logs`
     - Also emit a structured log line to stdout (JSON format with operation, tenantId, duration, success)
   - `async getOperationHistory(tenantId: string, options?: { operation?, profileIdentity?, limit?, offset? }): Promise<ProfileOperationLog[]>`:
     - Tenant-scoped query with optional filters, ordered by `createdAt` descending
3. Create `joyus-ai-mcp-server/src/profiles/monitoring/metrics.ts`
4. Implement `ProfileMetrics` class:
   - Track: generation count, generation duration histogram, failure rate, rollback count, cache hit/miss ratio
   - `recordGeneration(tenantId, durationMs, success)`, `recordRollback(tenantId, durationMs, success)`, `recordCacheHit(tenantId)`, `recordCacheMiss(tenantId)`
   - `getMetrics(tenantId?): ProfileMetricsSummary` — aggregate metrics, optionally filtered by tenant
   - Metrics are in-memory counters (not persisted) — reset on server restart. This is sufficient for the initial implementation.
5. Update `pipeline.ts` to use the logger and metrics:
   - Log operation start, completion, and failure
   - Record generation metrics on completion
   - Update `generation_runs.durationMs` on completion
6. Write unit tests for the logger:
   - Operation log entries are created with correct fields
   - Query filters work (by operation type, by profileIdentity)
   - Tenant scoping is enforced

**Files**:
- `joyus-ai-mcp-server/src/profiles/monitoring/logger.ts` (new, ~80 lines)
- `joyus-ai-mcp-server/src/profiles/monitoring/metrics.ts` (new, ~70 lines)
- `joyus-ai-mcp-server/src/profiles/generation/pipeline.ts` (modify, ~20 lines added)
- `joyus-ai-mcp-server/tests/profiles/monitoring/logger.test.ts` (new, ~60 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Logger tests pass
- [ ] Generation pipeline logs start, completion, and failure operations
- [ ] Generation run `durationMs` is populated on completion
- [ ] Metrics counters increment correctly
- [ ] All log entries include `tenantId`

---

## Definition of Done

- [ ] Engine bridge invokes Spec 005 Python engine via subprocess with configurable timeout
- [ ] Corpus snapshot service creates immutable snapshots with correct document/author/word counts
- [ ] Generation pipeline orchestrates the full flow: validate -> snapshot -> engine -> store
- [ ] Version numbers are monotonically increasing per (tenantId, profileIdentity)
- [ ] Concurrent pipelines for different tenants succeed independently
- [ ] Concurrent pipelines for the same tenant are safely blocked (try-lock)
- [ ] Structured operation logging in `operation_logs` table
- [ ] All profile data is tenant-scoped (FR-001, FR-002)
- [ ] Zero-document corpus rejected, single-author flagged low-confidence
- [ ] `npm run typecheck` passes with zero errors
- [ ] All unit tests pass: `npx vitest run tests/profiles/generation/ tests/profiles/monitoring/`

## Risks

- **Subprocess latency**: The Python engine subprocess may be slow to start. Mitigation: pool warm processes if needed (deferred). Budget 6 minutes for engine out of 10-minute total.
- **Temp directory cleanup**: If the pipeline crashes between creating temp files and cleanup, orphaned files remain. Mitigation: use `os.tmpdir()` with a profiles-specific prefix; add a cleanup-on-startup step.
- **Advisory lock hash collisions**: `pg_advisory_xact_lock` uses bigint keys. Hash tenantId to bigint deterministically. Risk of collision is negligible but document the hashing strategy.

## Reviewer Guidance

- Verify engine bridge subprocess invocation uses `execFile` (not `exec`) for safety — no shell interpretation
- Verify advisory locks use the try-lock variant (non-blocking) and release on all code paths
- Confirm version number assignment queries MAX within a transaction to prevent races
- Verify all database queries use `tenantWhere` or equivalent tenant scoping
- Check that temp directories are cleaned up in both success and error paths
- Verify operation log entries are created for every pipeline execution (success and failure)
