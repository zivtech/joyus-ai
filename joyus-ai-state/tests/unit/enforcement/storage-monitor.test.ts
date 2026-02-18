import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkStorageUsage, formatBytes } from '../../../src/enforcement/audit/storage-monitor.js';

describe('checkStorageUsage', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `storage-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns 0 bytes for empty directory', () => {
    const status = checkStorageUsage(testDir);
    expect(status.totalBytes).toBe(0);
    expect(status.isOverThreshold).toBe(false);
  });

  it('calculates total size of all files', () => {
    writeFileSync(join(testDir, 'audit-2026-02-17.jsonl'), 'a'.repeat(1000));
    writeFileSync(join(testDir, 'audit-2026-02-18.jsonl'), 'b'.repeat(2000));
    writeFileSync(join(testDir, 'audit-index.db'), 'c'.repeat(500));

    const status = checkStorageUsage(testDir);
    expect(status.totalBytes).toBe(3500);
    expect(status.isOverThreshold).toBe(false);
  });

  it('detects over-threshold', () => {
    writeFileSync(join(testDir, 'audit-2026-02-17.jsonl'), 'x'.repeat(200));
    const status = checkStorageUsage(testDir, 100); // 100 byte threshold
    expect(status.isOverThreshold).toBe(true);
  });

  it('handles non-existent directory', () => {
    const status = checkStorageUsage('/nonexistent/path');
    expect(status.totalBytes).toBe(0);
    expect(status.isOverThreshold).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(104857600)).toBe('100.0 MB');
  });
});
