import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AuditWriter, readEntries, listAuditFiles } from '../../src/enforcement/audit/writer.js';
import { AuditIndex } from '../../src/enforcement/audit/index.js';
import type { AuditEntry } from '../../src/enforcement/types.js';

function tmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: 'integration-test',
    actionType: 'gate-execution',
    result: 'pass',
    userTier: 'tier-2',
    activeSkills: [],
    details: {},
    ...overrides,
  };
}

describe('Integration: Audit Roundtrip', () => {
  let auditDir: string;
  let dbPath: string;

  beforeEach(() => {
    auditDir = tmpDir('audit-roundtrip');
    dbPath = join(auditDir, 'audit-index.sqlite');
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('write and read: 10 entries -> JSONL -> SQLite -> query returns 10', () => {
    const writer = new AuditWriter(auditDir);
    for (let i = 0; i < 10; i++) {
      writer.write(makeEntry());
    }

    const index = new AuditIndex(dbPath);
    try {
      index.initialize();
      index.syncFromJSONL(auditDir);
      const result = index.query();
      expect(result.total).toBe(10);
      expect(result.entries).toHaveLength(10);
    } finally {
      index.close();
    }
  });

  it('filter by time: entries across timestamps -> time range returns subset', () => {
    const writer = new AuditWriter(auditDir);
    const t1 = '2026-01-01T00:00:00.000Z';
    const t2 = '2026-01-15T00:00:00.000Z';
    const t3 = '2026-02-01T00:00:00.000Z';

    writer.write(makeEntry({ timestamp: t1 }));
    writer.write(makeEntry({ timestamp: t2 }));
    writer.write(makeEntry({ timestamp: t2 }));
    writer.write(makeEntry({ timestamp: t3 }));

    const index = new AuditIndex(dbPath);
    try {
      index.initialize();
      index.syncFromJSONL(auditDir);
      const result = index.query({ timeRange: { from: '2026-01-10T00:00:00.000Z', to: '2026-01-20T00:00:00.000Z' } });
      expect(result.total).toBe(2);
    } finally {
      index.close();
    }
  });

  it('filter by actionType: mixed types -> filter returns correct subset', () => {
    const writer = new AuditWriter(auditDir);
    writer.write(makeEntry({ actionType: 'gate-execution' }));
    writer.write(makeEntry({ actionType: 'gate-execution' }));
    writer.write(makeEntry({ actionType: 'skill-load' }));
    writer.write(makeEntry({ actionType: 'branch-verify' }));

    const index = new AuditIndex(dbPath);
    try {
      index.initialize();
      index.syncFromJSONL(auditDir);
      const result = index.query({ actionType: 'gate-execution' });
      expect(result.total).toBe(2);
    } finally {
      index.close();
    }
  });

  it('filter by skillId: entries with different skills -> filter returns subset', () => {
    const writer = new AuditWriter(auditDir);
    writer.write(makeEntry({ skillId: 'drupal-security' }));
    writer.write(makeEntry({ skillId: 'drupal-security' }));
    writer.write(makeEntry({ skillId: 'php-standards' }));

    const index = new AuditIndex(dbPath);
    try {
      index.initialize();
      index.syncFromJSONL(auditDir);
      const result = index.query({ skillId: 'drupal-security' });
      expect(result.total).toBe(2);
    } finally {
      index.close();
    }
  });

  it('filter by taskId: entries with task IDs -> filter returns correct entries', () => {
    const writer = new AuditWriter(auditDir);
    writer.write(makeEntry({ taskId: 'PROJ-142' }));
    writer.write(makeEntry({ taskId: 'PROJ-142' }));
    writer.write(makeEntry({ taskId: 'PROJ-200' }));

    const index = new AuditIndex(dbPath);
    try {
      index.initialize();
      index.syncFromJSONL(auditDir);
      const result = index.query({ taskId: 'PROJ-142' });
      expect(result.total).toBe(2);
    } finally {
      index.close();
    }
  });

  it('pagination: 25 entries with limit=10, offset=0 -> 10 results, hasMore true', () => {
    const writer = new AuditWriter(auditDir);
    for (let i = 0; i < 25; i++) {
      writer.write(makeEntry());
    }

    const index = new AuditIndex(dbPath);
    try {
      index.initialize();
      index.syncFromJSONL(auditDir);
      const result = index.query({ limit: 10, offset: 0 });
      expect(result.entries).toHaveLength(10);
      expect(result.total).toBe(25);
      expect(result.hasMore).toBe(true);

      const page2 = index.query({ limit: 10, offset: 10 });
      expect(page2.entries).toHaveLength(10);
      expect(page2.hasMore).toBe(true);

      const page3 = index.query({ limit: 10, offset: 20 });
      expect(page3.entries).toHaveLength(5);
      expect(page3.hasMore).toBe(false);
    } finally {
      index.close();
    }
  });

  it('incremental sync: write 5, sync, write 5 more, sync -> 10 total, no dupes', () => {
    const writer = new AuditWriter(auditDir);
    for (let i = 0; i < 5; i++) {
      writer.write(makeEntry());
    }

    const index = new AuditIndex(dbPath);
    try {
      index.initialize();
      const sync1 = index.syncFromJSONL(auditDir);
      expect(sync1.newEntries).toBe(5);

      for (let i = 0; i < 5; i++) {
        writer.write(makeEntry());
      }

      const sync2 = index.syncFromJSONL(auditDir);
      expect(sync2.newEntries).toBe(5);

      const result = index.query({ limit: 100 });
      expect(result.total).toBe(10);
    } finally {
      index.close();
    }
  });

  it('crash recovery: partial JSONL line -> skipped, valid entries returned', () => {
    const writer = new AuditWriter(auditDir);
    writer.write(makeEntry());
    writer.write(makeEntry());

    // Append a partial/truncated JSON line to simulate crash
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
    appendFileSync(files[0], '{"id":"broken","timestamp":"2026', 'utf-8');

    const { entries, skipped } = readEntries(files[0]);
    expect(entries).toHaveLength(2);
    expect(skipped).toBe(1);
  });
});
