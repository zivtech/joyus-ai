---
work_package_id: WP03
title: Sync Engine
lane: done
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:41:55.567861+00:00'
subtasks: [T011, T012, T013, T014, T015, T016, T017]
shell_pid: '97271'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP03: Sync Engine

## Objective

Build the batch sync engine that orchestrates content indexing across connected sources. Supports all three sync strategies (mirror, pass-through, hybrid), cursor-based incremental indexing at scale (up to 500K items), scheduled and manual sync triggers, and content staleness detection.

## Implementation Command

```bash
spec-kitty implement WP03 --base WP02
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-003 through FR-007, SC-001, SC-002, SC-007)
- **Research**: `kitty-specs/006-content-infrastructure/research.md` (§R7: Batch Sync Engine)
- **Data Model**: `kitty-specs/006-content-infrastructure/data-model.md` (ContentSource, ContentItem, SyncRun)

The sync engine uses connectors (WP02) to fetch content and the content schema (WP01) to store results. Sync is always batch-based — no real-time streaming.

---

## Subtask T011: Create SyncEngine Batch Orchestrator

**Purpose**: Central engine that orchestrates a sync run for a given source.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/sync/engine.ts`
2. Implement `SyncEngine` class:
   ```typescript
   class SyncEngine {
     constructor(private registry: ConnectorRegistry, private db: DrizzleClient) {}

     async syncSource(sourceId: string, trigger: 'scheduled' | 'manual'): Promise<string>;
     // Returns syncRunId

     private async executeSyncRun(source: ContentSource, connector: ContentConnector, syncRun: SyncRun): Promise<void>;
   }
   ```
3. `syncSource` workflow:
   - Look up source by ID, verify status is not already `syncing`
   - Get connector from registry via source.type
   - Create SyncRun record (status: `pending`)
   - Update source status to `syncing`
   - Call `executeSyncRun` (delegates to T012-T014 based on strategy)
   - On success: update source status to `active`, update `lastSyncAt`, `itemCount`
   - On failure: update source status to `error`, record error in `lastSyncError`
   - Update SyncRun to `completed` or `failed`
4. Handle concurrent sync prevention: check source.status before starting

**Files**:
- `joyus-ai-mcp-server/src/content/sync/engine.ts` (new, ~150 lines)

**Validation**:
- [ ] Creates SyncRun record before starting
- [ ] Updates source status correctly on success and failure
- [ ] Prevents concurrent syncs for the same source

---

## Subtask T012: Implement Cursor-Based Incremental Indexing

**Purpose**: Fetch content in batches using cursor pagination, supporting 500K+ items without memory issues.

**Steps**:
1. Add to `engine.ts` a private method:
   ```typescript
   private async indexInBatches(
     connector: ContentConnector,
     config: ConnectorConfig,
     syncRun: SyncRun,
     shouldStoreBody: boolean
   ): Promise<{ created: number; updated: number; removed: number }>
   ```
2. Loop: call `connector.indexBatch(config, cursor, batchSize)` until `nextCursor` is null
3. For each batch:
   - Upsert items into `content.items` (match by `sourceId + sourceRef`)
   - If `shouldStoreBody` is false (pass-through/hybrid), set `body = null`
   - Update `lastSyncedAt` on each item
   - Update SyncRun counters (itemsDiscovered, itemsCreated, itemsUpdated)
   - Save cursor to SyncRun record for resume capability
4. After all batches: detect removed items (items in DB not seen in this sync) and mark appropriately
5. Use `DEFAULT_BATCH_SIZE = 100` from constants, configurable per source

**Files**:
- `joyus-ai-mcp-server/src/content/sync/engine.ts` (extend, ~80 lines)

**Validation**:
- [ ] Processes items in batches without loading all into memory
- [ ] Cursor is persisted to SyncRun for resume
- [ ] Upserts correctly (create new, update existing)
- [ ] Detects removed items

---

## Subtask T013: Implement Sync State Tracking

**Purpose**: Track sync execution via SyncRun records with proper status transitions.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/sync/state.ts`
2. Implement helper functions:
   ```typescript
   export async function createSyncRun(sourceId: string, trigger: SyncTrigger): Promise<SyncRun>;
   export async function updateSyncRun(id: string, updates: Partial<SyncRun>): Promise<void>;
   export async function completeSyncRun(id: string, stats: SyncStats): Promise<void>;
   export async function failSyncRun(id: string, error: string): Promise<void>;
   export async function getLatestSyncRun(sourceId: string): Promise<SyncRun | null>;
   export async function getSyncRunById(id: string): Promise<SyncRun | null>;
   ```
3. Enforce status transitions: `pending` → `running` → `completed`|`failed`

**Files**:
- `joyus-ai-mcp-server/src/content/sync/state.ts` (new, ~80 lines)

**Validation**:
- [ ] Status transitions are enforced (can't go from `completed` to `running`)
- [ ] Stats are accumulated correctly during sync

---

## Subtask T014: Implement Sync Strategy Handling

**Purpose**: Handle the three sync strategies differently during indexing.

**Steps**:
1. In `engine.ts`, `executeSyncRun` delegates based on `source.syncStrategy`:
   - **mirror**: `indexInBatches(connector, config, syncRun, shouldStoreBody: true)` — stores full body
   - **pass-through**: `indexInBatches(connector, config, syncRun, shouldStoreBody: false)` — stores metadata only, body is null
   - **hybrid**: Same as pass-through during indexing (metadata only). Full content fetched on demand via `connector.fetchContent()` when accessed
2. Create a helper for on-demand fetch (used by search and generation later):
   ```typescript
   export async function fetchItemContent(item: ContentItem, source: ContentSource): Promise<string | null>;
   ```
   - If `item.body` is not null (mirror), return it directly
   - If null (pass-through/hybrid), call connector.fetchContent and return result
   - Cache fetched content in item.body for hybrid strategy (update DB)

**Files**:
- `joyus-ai-mcp-server/src/content/sync/engine.ts` (extend, ~40 lines)

**Validation**:
- [ ] Mirror strategy stores body
- [ ] Pass-through strategy stores null body
- [ ] On-demand fetch works for pass-through and hybrid items

---

## Subtask T015: Add Content Staleness Detection

**Purpose**: Detect and flag content that hasn't been synced within the source's freshness window.

**Steps**:
1. Add to `state.ts`:
   ```typescript
   export async function detectStaleContent(): Promise<number>;
   export async function detectStaleSources(): Promise<ContentSource[]>;
   ```
2. `detectStaleContent`: Update `isStale = true` on items where `lastSyncedAt + source.freshnessWindowMinutes < now()`
3. `detectStaleSources`: Return sources where `lastSyncAt + freshnessWindowMinutes < now()`
4. Both use raw SQL with Drizzle's `sql` tagged template for efficient bulk updates

**Files**:
- `joyus-ai-mcp-server/src/content/sync/state.ts` (extend, ~40 lines)

**Validation**:
- [ ] Items flagged as stale when freshness window exceeded
- [ ] Sources identified as stale based on lastSyncAt
- [ ] Staleness cleared after successful sync

---

## Subtask T016: Add Scheduled Sync via node-cron

**Purpose**: Automatically trigger syncs on a configurable schedule.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/sync/scheduler.ts`
2. Implement:
   ```typescript
   export function initializeSyncScheduler(engine: SyncEngine): void;
   export function stopSyncScheduler(): void;
   ```
3. `initializeSyncScheduler`:
   - Run a periodic job (e.g., every 5 minutes) that checks for sources needing sync
   - A source needs sync if: `status = 'active'` AND `lastSyncAt + freshnessWindowMinutes < now()`
   - Trigger `engine.syncSource(sourceId, 'scheduled')` for each
   - Also run staleness detection on each cycle
4. Use `node-cron` (already a dependency) for scheduling
5. Limit concurrent syncs (e.g., max 3 simultaneous) to avoid overwhelming the database

**Files**:
- `joyus-ai-mcp-server/src/content/sync/scheduler.ts` (new, ~60 lines)

**Validation**:
- [ ] Scheduler starts and runs on configured interval
- [ ] Only syncs sources that need it (freshness check)
- [ ] Respects concurrent sync limit
- [ ] Cleanly stops on shutdown

---

## Subtask T017: Add Manual Sync Trigger

**Purpose**: Allow operators to trigger a sync immediately via the sync engine.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/sync/index.ts`
2. Export a convenience function:
   ```typescript
   export async function triggerSync(sourceId: string): Promise<string>;
   // Returns syncRunId
   ```
3. This simply calls `syncEngine.syncSource(sourceId, 'manual')`
4. Export the SyncEngine instance and initialization function

**Files**:
- `joyus-ai-mcp-server/src/content/sync/index.ts` (new, ~30 lines)

**Validation**:
- [ ] Manual trigger creates a SyncRun with trigger='manual'
- [ ] Returns syncRunId for status tracking

---

## Definition of Done

- [ ] SyncEngine orchestrates full sync lifecycle per source
- [ ] Cursor-based batching handles 500K+ items without memory issues
- [ ] All three sync strategies implemented correctly
- [ ] Staleness detection flags stale content and sources
- [ ] Scheduled sync runs periodically
- [ ] Manual sync trigger available
- [ ] `npm run typecheck` passes

## Risks

- **Memory at scale**: Must process items in batches, never load all 500K items at once
- **Concurrent sync prevention**: Race condition if two triggers fire simultaneously
- **Resume after crash**: Cursor saved to SyncRun enables resume, but partially-indexed batches may need rollback

## Reviewer Guidance

- Verify batch processing doesn't accumulate items in memory
- Check cursor persistence for resume capability
- Confirm sync strategy differences (mirror stores body, others don't)
- Verify staleness detection uses source's freshnessWindowMinutes (not hardcoded)
- Check that concurrent sync limit is enforced

## Activity Log

- 2026-02-21T12:53:16Z – unknown – shell_pid=97271 – lane=done – Sync engine complete
