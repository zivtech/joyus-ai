---
work_package_id: WP02
title: Audit Trail Infrastructure
lane: planned
dependencies:
- WP01
subtasks:
- T007
- T008
- T009
- T010
- T011
- T012
- T013
phase: Phase 1 - Foundation
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T15:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 -- Audit Trail Infrastructure

## IMPORTANT: Review Feedback Status

- **Has review feedback?**: Check `review_status` above.
- **Mark as acknowledged**: Update `review_status: acknowledged` when addressing feedback.

---

## Review Feedback

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Implement crash-safe JSONL audit writer with daily file rotation
- Set up SQLite index with schema for structured queries (FR-024)
- Implement incremental JSONL -> SQLite sync
- Implement storage monitor with configurable threshold warning
- Implement correction capture and local storage
- **Done when**: Audit entries write to JSONL, SQLite index rebuilds, queries return correct results with filters/pagination, storage monitor warns at threshold, corrections are captured and stored

## Context & Constraints

- **Data Model**: `kitty-specs/004-workflow-enforcement/data-model.md` -- AuditEntry, Correction, AuditActionType
- **Research**: `kitty-specs/004-workflow-enforcement/research.md` -- audit storage strategy (JSONL + SQLite)
- **Contracts**: `kitty-specs/004-workflow-enforcement/contracts/mcp-tools.md` -- query_audit response schema
- **Spec**: FR-020 through FR-025a (audit requirements), FR-030/FR-031 (corrections)
- **Dependency**: `better-sqlite3` for SQLite queries
- **Storage path**: `~/.jawn-ai/projects/<hash>/audit/`

**Implementation command**: `spec-kitty implement WP02 --base WP01`

## Subtasks & Detailed Guidance

### Subtask T007 -- Implement JSONL audit writer

- **Purpose**: Crash-safe, append-only audit log. JSONL format means each line is a complete JSON object -- partial writes are detectable and discardable.
- **Steps**:
  1. Create `jawn-ai-state/src/enforcement/audit/writer.ts`
  2. Implement `AuditWriter` class:
     - Constructor takes `auditDir: string` (e.g., `~/.jawn-ai/projects/<hash>/audit/`)
     - `write(entry: AuditEntry): void` -- serialize to JSON, append line to current day's file, fsync
     - File naming: `audit-YYYY-MM-DD.jsonl` (new file each day for easy manual cleanup)
     - Ensure directory exists on first write (`mkdirSync` with `recursive: true`)
     - Use `fs.appendFileSync` with `\n` delimiter for crash safety
  3. Implement `readEntries(filePath: string): AuditEntry[]`:
     - Read file line by line
     - Parse each line as JSON
     - Skip and log any lines that fail to parse (crash recovery)
     - Validate each entry against `AuditEntrySchema`
  4. Implement `listAuditFiles(auditDir: string): string[]`:
     - Return sorted list of `audit-*.jsonl` files
- **Files**: `jawn-ai-state/src/enforcement/audit/writer.ts` (new, ~80 lines)
- **Notes**: Atomic append is critical. `appendFileSync` + `\n` means a crash mid-write produces a partial last line, which `readEntries` skips.

### Subtask T008 -- Implement audit entry Zod schemas

- **Purpose**: Validate audit entries on write and read. Different action types have different required fields.
- **Steps**:
  1. Create `jawn-ai-state/src/enforcement/audit/schema.ts`
  2. Define `AuditEntrySchema` with:
     - Required fields: id (UUID), timestamp, sessionId, actionType, result, userTier, activeSkills
     - Optional fields: taskId, gateId, skillId, details, overrideReason, branchName
     - Validate `actionType` against `AuditActionType` enum
     - Validate `result` against `AuditResult` enum
  3. Define `CorrectionSchema` with required fields from data model
  4. Export both schemas
- **Files**: `jawn-ai-state/src/enforcement/audit/schema.ts` (new, ~50 lines)

### Subtask T009 -- Set up SQLite database schema

- **Purpose**: Create SQLite tables and indexes for structured audit queries.
- **Steps**:
  1. Create `jawn-ai-state/src/enforcement/audit/index.ts`
  2. Implement `AuditIndex` class:
     - Constructor takes `dbPath: string` (e.g., `~/.jawn-ai/projects/<hash>/audit/audit-index.db`)
     - `initialize(): void` -- create tables if not exist:
       ```sql
       CREATE TABLE IF NOT EXISTS audit_entries (
         id TEXT PRIMARY KEY,
         timestamp TEXT NOT NULL,
         session_id TEXT,
         action_type TEXT NOT NULL,
         result TEXT NOT NULL,
         user_tier TEXT,
         gate_id TEXT,
         skill_id TEXT,
         task_id TEXT,
         branch_name TEXT,
         override_reason TEXT,
         active_skills TEXT,  -- JSON array stored as text
         details TEXT,        -- JSON object stored as text
         raw_json TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_entries(timestamp);
       CREATE INDEX IF NOT EXISTS idx_action_type ON audit_entries(action_type);
       CREATE INDEX IF NOT EXISTS idx_skill_id ON audit_entries(skill_id);
       CREATE INDEX IF NOT EXISTS idx_task_id ON audit_entries(task_id);
       ```
  3. Use `better-sqlite3` for synchronous operations
- **Files**: `jawn-ai-state/src/enforcement/audit/index.ts` (new, ~60 lines)
- **Notes**: Store `raw_json` for full fidelity. Indexed columns are extracted for query performance.

### Subtask T010 -- Implement audit query engine

- **Purpose**: Support FR-024 queries by time range, action type, skill, and task/ticket ID with pagination.
- **Steps**:
  1. Add to `AuditIndex` class:
  2. Implement `query(filters: AuditQueryFilters): AuditQueryResult`:
     - `filters`: `{ timeRange?: { from, to }, actionType?, skillId?, taskId?, result?, limit?, offset? }`
     - Build WHERE clause dynamically from provided filters
     - Use parameterized queries (prevent SQL injection)
     - Return `{ entries: AuditEntry[], total: number, hasMore: boolean }`
  3. Implement `getStats(): AuditStats`:
     - Total entry count, entries by action type, entries by result, date range
- **Files**: `jawn-ai-state/src/enforcement/audit/index.ts` (extend, ~80 lines added)

### Subtask T011 -- Implement incremental JSONL -> SQLite index sync

- **Purpose**: Keep the SQLite index up to date without requiring full rebuild every time.
- **Steps**:
  1. Add to `AuditIndex` class:
  2. Track sync state: store `last_synced_file` and `last_synced_line` in a `sync_state` table
  3. Implement `syncFromJSONL(auditDir: string): SyncResult`:
     - List all JSONL files in auditDir
     - For each file after last synced position: read new lines, insert into SQLite
     - Use transactions for batch inserts (50 entries per transaction)
     - Update sync state after each file
     - Return `{ newEntries: number, errors: number }`
  4. Implement `fullRebuild(auditDir: string): void`:
     - Drop all entries, reset sync state, re-import all JSONL files
     - Used on first startup or manual repair
  5. Call `syncFromJSONL` on MCP server startup and every 50 writes (configurable)
- **Files**: `jawn-ai-state/src/enforcement/audit/index.ts` (extend, ~100 lines added)
- **Notes**: Sync must be idempotent -- running it twice produces the same result. Use entry `id` as dedup key.

### Subtask T012 -- Implement storage monitor

- **Purpose**: Warn when audit storage exceeds a configurable threshold. No auto-pruning (clarification decision).
- **Steps**:
  1. Create `jawn-ai-state/src/enforcement/audit/storage-monitor.ts`
  2. Implement `checkStorageUsage(auditDir: string): StorageStatus`:
     - Calculate total size of all `audit-*.jsonl` files + SQLite database
     - Return `{ totalBytes: number, humanReadable: string, warningThreshold: number, isOverThreshold: boolean }`
  3. Default threshold: 100MB (configurable via enforcement config)
  4. Implement `formatBytes(bytes: number): string` utility
- **Files**: `jawn-ai-state/src/enforcement/audit/storage-monitor.ts` (new, ~40 lines)

### Subtask T013 -- Implement correction capture and storage

- **Purpose**: Capture user corrections when Claude's output doesn't meet skill constraints (FR-030/031). Stored locally for future aggregation.
- **Steps**:
  1. Create `jawn-ai-state/src/enforcement/corrections/capture.ts`
  2. Implement `CorrectionStore` class:
     - Constructor takes `correctionsDir: string`
     - `record(correction: Correction): string` -- validate with CorrectionSchema, write to `corrections-YYYY-MM-DD.jsonl`, return correction ID
     - `list(filters?: { skillId?, dateRange? }): Correction[]` -- read and filter corrections
  3. Storage format: JSONL (same approach as audit, crash-safe)
  4. Also create an audit entry when a correction is recorded
- **Files**: `jawn-ai-state/src/enforcement/corrections/capture.ts` (new, ~60 lines)

## Risks & Mitigations

- **`better-sqlite3` native compilation**: pin to a known-good version. Test `npm install` on macOS and verify it builds.
- **JSONL file corruption**: the reader skips malformed lines. Log warnings so the developer knows data was lost.
- **SQLite lock contention**: use WAL mode for concurrent read/write. Since this is single-developer, contention is unlikely.

## Review Guidance

- Verify JSONL writer uses `appendFileSync` for crash safety
- Verify SQLite queries use parameterized statements (no SQL injection)
- Verify sync is idempotent (running twice doesn't duplicate entries)
- Verify storage monitor calculates correct total across all files
- Verify correction capture creates both a correction record and an audit entry

## Activity Log

- 2026-02-17T15:00:00Z -- system -- lane=planned -- Prompt created.
