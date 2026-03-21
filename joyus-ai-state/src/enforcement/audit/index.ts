/**
 * SQLite audit index — T009, T010, T011
 *
 * Provides structured queries over the JSONL audit log.
 * JSONL is the source of truth; SQLite is a queryable index.
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readEntries, listAuditFiles } from './writer.js';
import type { AuditEntry, AuditResult, AuditActionType } from '../types.js';

// --- Query types ---

export interface AuditQueryFilters {
  timeRange?: { from: string; to: string };
  actionType?: AuditActionType;
  skillId?: string;
  taskId?: string;
  result?: AuditResult;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  hasMore: boolean;
}

export interface AuditStats {
  totalEntries: number;
  byActionType: Record<string, number>;
  byResult: Record<string, number>;
  dateRange: { earliest: string | null; latest: string | null };
}

export interface SyncResult {
  newEntries: number;
  errors: number;
}

// --- AuditIndex class ---

export class AuditIndex {
  private db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  // --- T009: Schema setup ---

  initialize(): void {
    this.db.exec(`
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
        active_skills TEXT,
        details TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_entries(timestamp);
      CREATE INDEX IF NOT EXISTS idx_action_type ON audit_entries(action_type);
      CREATE INDEX IF NOT EXISTS idx_skill_id ON audit_entries(skill_id);
      CREATE INDEX IF NOT EXISTS idx_task_id ON audit_entries(task_id);

      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_synced_file TEXT,
        last_synced_line INTEGER DEFAULT 0
      );
      INSERT OR IGNORE INTO sync_state (id) VALUES (1);
    `);
  }

  // --- T010: Query engine ---

  query(filters: AuditQueryFilters = {}): AuditQueryResult {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.timeRange) {
      conditions.push('timestamp >= ? AND timestamp <= ?');
      params.push(filters.timeRange.from, filters.timeRange.to);
    }
    if (filters.actionType) {
      conditions.push('action_type = ?');
      params.push(filters.actionType);
    }
    if (filters.skillId) {
      conditions.push('skill_id = ?');
      params.push(filters.skillId);
    }
    if (filters.taskId) {
      conditions.push('task_id = ?');
      params.push(filters.taskId);
    }
    if (filters.result) {
      conditions.push('result = ?');
      params.push(filters.result);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM audit_entries ${where}`);
    const { total } = countStmt.get(...params) as { total: number };

    const selectStmt = this.db.prepare(
      `SELECT raw_json FROM audit_entries ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    );
    const rows = selectStmt.all(...params, limit, offset) as { raw_json: string }[];

    const entries = rows.map((row) => JSON.parse(row.raw_json) as AuditEntry);

    return {
      entries,
      total,
      hasMore: offset + entries.length < total,
    };
  }

  getStats(): AuditStats {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as total FROM audit_entries');
    const { total } = totalStmt.get() as { total: number };

    const byActionStmt = this.db.prepare(
      'SELECT action_type, COUNT(*) as count FROM audit_entries GROUP BY action_type',
    );
    const actionRows = byActionStmt.all() as { action_type: string; count: number }[];
    const byActionType: Record<string, number> = {};
    for (const row of actionRows) {
      byActionType[row.action_type] = row.count;
    }

    const byResultStmt = this.db.prepare(
      'SELECT result, COUNT(*) as count FROM audit_entries GROUP BY result',
    );
    const resultRows = byResultStmt.all() as { result: string; count: number }[];
    const byResult: Record<string, number> = {};
    for (const row of resultRows) {
      byResult[row.result] = row.count;
    }

    const rangeStmt = this.db.prepare(
      'SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM audit_entries',
    );
    const range = rangeStmt.get() as { earliest: string | null; latest: string | null };

    return {
      totalEntries: total,
      byActionType,
      byResult,
      dateRange: { earliest: range.earliest, latest: range.latest },
    };
  }

  // --- T011: Incremental sync ---

  syncFromJSONL(auditDir: string): SyncResult {
    const files = listAuditFiles(auditDir);
    if (files.length === 0) return { newEntries: 0, errors: 0 };

    const stateStmt = this.db.prepare('SELECT last_synced_file, last_synced_line FROM sync_state WHERE id = 1');
    const state = stateStmt.get() as { last_synced_file: string | null; last_synced_line: number };

    let newEntries = 0;
    let errors = 0;
    let startProcessing = state.last_synced_file === null;

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO audit_entries
        (id, timestamp, session_id, action_type, result, user_tier, gate_id, skill_id, task_id, branch_name, override_reason, active_skills, details, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStateStmt = this.db.prepare(
      'UPDATE sync_state SET last_synced_file = ?, last_synced_line = ? WHERE id = 1',
    );

    for (const filePath of files) {
      const fileName = filePath.split('/').pop()!;

      if (!startProcessing) {
        if (fileName === state.last_synced_file) {
          startProcessing = true;
          // Do not continue — fall through so new entries appended to this file are picked up.
        } else {
          continue;
        }
      }

      const { entries, skipped } = readEntries(filePath);
      errors += skipped;

      const startLine = fileName === state.last_synced_file ? state.last_synced_line : 0;

      const insertBatch = this.db.transaction((batchEntries: AuditEntry[]) => {
        for (const entry of batchEntries) {
          insertStmt.run(
            entry.id,
            entry.timestamp,
            entry.sessionId,
            entry.actionType,
            entry.result,
            entry.userTier,
            entry.gateId ?? null,
            entry.skillId ?? null,
            entry.taskId ?? null,
            entry.branchName ?? null,
            entry.overrideReason ?? null,
            JSON.stringify(entry.activeSkills),
            JSON.stringify(entry.details),
            JSON.stringify(entry),
          );
        }
      });

      const newBatch = entries.slice(startLine);
      if (newBatch.length > 0) {
        // Insert in batches of 50
        for (let i = 0; i < newBatch.length; i += 50) {
          insertBatch(newBatch.slice(i, i + 50));
        }
        newEntries += newBatch.length;
      }

      updateStateStmt.run(fileName, entries.length);
    }

    return { newEntries, errors };
  }

  fullRebuild(auditDir: string): SyncResult {
    this.db.exec('DELETE FROM audit_entries');
    this.db.exec('UPDATE sync_state SET last_synced_file = NULL, last_synced_line = 0');
    return this.syncFromJSONL(auditDir);
  }

  close(): void {
    this.db.close();
  }
}
