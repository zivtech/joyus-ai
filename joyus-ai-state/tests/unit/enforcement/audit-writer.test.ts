import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditWriter, readEntries, listAuditFiles } from '../../../src/enforcement/audit/writer.js';
import type { AuditEntry } from '../../../src/enforcement/types.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    actionType: 'gate-execution',
    result: 'pass',
    userTier: 'tier-2',
    activeSkills: [],
    details: {},
    ...overrides,
  };
}

describe('AuditWriter', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `audit-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates directory and writes an entry', () => {
    const writer = new AuditWriter(testDir);
    const entry = makeEntry();
    writer.write(entry);

    const files = listAuditFiles(testDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('audit-');
    expect(files[0]).toContain('.jsonl');
  });

  it('appends multiple entries to the same file', () => {
    const writer = new AuditWriter(testDir);
    writer.write(makeEntry({ id: crypto.randomUUID() }));
    writer.write(makeEntry({ id: crypto.randomUUID() }));
    writer.write(makeEntry({ id: crypto.randomUUID() }));

    const files = listAuditFiles(testDir);
    expect(files).toHaveLength(1);

    const { entries } = readEntries(files[0]);
    expect(entries).toHaveLength(3);
  });

  it('each line is a valid JSON object', () => {
    const writer = new AuditWriter(testDir);
    writer.write(makeEntry());

    const files = listAuditFiles(testDir);
    const content = readFileSync(files[0], 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});

describe('readEntries', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `audit-read-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('skips malformed lines', () => {
    const filePath = join(testDir, 'audit-2026-02-18.jsonl');
    const goodEntry = makeEntry();
    const content = JSON.stringify(goodEntry) + '\n' + 'not-json\n' + '{"partial":true}\n';
    require('node:fs').writeFileSync(filePath, content);

    const { entries, skipped } = readEntries(filePath);
    expect(entries).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('returns empty for non-existent file', () => {
    const { entries, skipped } = readEntries('/nonexistent/path.jsonl');
    expect(entries).toEqual([]);
    expect(skipped).toBe(0);
  });
});

describe('listAuditFiles', () => {
  it('returns empty for non-existent directory', () => {
    expect(listAuditFiles('/nonexistent/dir')).toEqual([]);
  });
});
