import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleQueryAudit } from '../../../src/mcp/tools/query-audit.js';
import { AuditWriter } from '../../../src/enforcement/audit/writer.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '../../../src/enforcement/types.js';

describe('handleQueryAudit', () => {
  let auditDir: string;
  const ctx = () => ({
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test-session',
    auditDir,
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `mcp-audit-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('returns empty results when no audit data', () => {
    const result = handleQueryAudit({}, ctx());
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('returns entries after sync', () => {
    const writer = new AuditWriter(auditDir);
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId: 'test-session',
      actionType: 'gate-execution',
      result: 'pass',
      userTier: 'tier-2',
      activeSkills: [],
      details: {},
    };
    writer.write(entry);

    const result = handleQueryAudit({}, ctx());
    expect(result.total).toBe(1);
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].actionType).toBe('gate-execution');
  });

  it('filters by actionType', () => {
    const writer = new AuditWriter(auditDir);
    writer.write({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId: 'test',
      actionType: 'gate-execution',
      result: 'pass',
      userTier: 'tier-2',
      activeSkills: [],
      details: {},
    });
    writer.write({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId: 'test',
      actionType: 'kill-switch-on',
      result: 'pass',
      userTier: 'tier-2',
      activeSkills: [],
      details: {},
    });

    const result = handleQueryAudit({ actionType: 'kill-switch-on' }, ctx());
    expect(result.total).toBe(1);
    expect(result.entries[0].actionType).toBe('kill-switch-on');
  });

  it('respects limit and offset', () => {
    const writer = new AuditWriter(auditDir);
    for (let i = 0; i < 5; i++) {
      writer.write({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId: 'test',
        actionType: 'gate-execution',
        result: 'pass',
        userTier: 'tier-2',
        activeSkills: [],
        details: { index: i },
      });
    }

    const result = handleQueryAudit({ limit: 2, offset: 0 }, ctx());
    expect(result.entries.length).toBe(2);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  it('returns correct response shape', () => {
    const result = handleQueryAudit({}, ctx());
    expect(result).toHaveProperty('entries');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('hasMore');
  });
});
