import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleRecordCorrection } from '../../../src/mcp/tools/record-correction.js';
import { listAuditFiles, readEntries } from '../../../src/enforcement/audit/writer.js';
import { rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('handleRecordCorrection', () => {
  let auditDir: string;
  const ctx = () => ({
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test-session',
    auditDir,
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `mcp-correction-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('stores correction and returns IDs', () => {
    const result = handleRecordCorrection(
      {
        skillId: 'drupal-security',
        originalOutput: 'db_query("SELECT * FROM users WHERE id = $id")',
        correctedOutput: 'db_query("SELECT * FROM {users} WHERE id = :id", [":id" => $id])',
        explanation: 'Must use parameterized queries',
      },
      ctx(),
    );
    expect(result.stored).toBe(true);
    expect(result.correctionId).toBeTruthy();
    expect(result.auditEntryId).toBeTruthy();
  });

  it('creates audit entry with correction-captured type', () => {
    handleRecordCorrection(
      {
        skillId: 'test-skill',
        originalOutput: 'bad',
        correctedOutput: 'good',
      },
      ctx(),
    );
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('correction-captured');
    expect(entries[0].skillId).toBe('test-skill');
  });

  it('stores correction in corrections subdirectory', () => {
    handleRecordCorrection(
      {
        skillId: 'test-skill',
        originalOutput: 'old',
        correctedOutput: 'new',
      },
      ctx(),
    );
    const corrDir = join(auditDir, 'corrections');
    const files = readdirSync(corrDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^corrections-.*\.jsonl$/);
  });

  it('records optional filePath', () => {
    handleRecordCorrection(
      {
        skillId: 'test-skill',
        originalOutput: 'old',
        correctedOutput: 'new',
        filePath: 'src/module.php',
      },
      ctx(),
    );
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].details.filePath).toBe('src/module.php');
  });

  it('returns correct response shape', () => {
    const result = handleRecordCorrection(
      {
        skillId: 'test',
        originalOutput: 'a',
        correctedOutput: 'b',
      },
      ctx(),
    );
    expect(result).toHaveProperty('correctionId');
    expect(result).toHaveProperty('auditEntryId');
    expect(result).toHaveProperty('stored');
    expect(typeof result.correctionId).toBe('string');
    expect(typeof result.auditEntryId).toBe('string');
    expect(result.stored).toBe(true);
  });
});
