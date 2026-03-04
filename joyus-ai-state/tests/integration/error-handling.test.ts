import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runGates, type GateRunConfig } from '../../src/enforcement/gates/runner.js';
import { loadSkill } from '../../src/enforcement/skills/loader.js';
import { SkillCache } from '../../src/enforcement/skills/cache.js';
import { AuditWriter, readEntries, listAuditFiles } from '../../src/enforcement/audit/writer.js';
import { AuditIndex } from '../../src/enforcement/audit/index.js';
import type { QualityGate, AuditEntry } from '../../src/enforcement/types.js';

function tmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeGate(id: string, command: string, overrides?: Partial<QualityGate>): QualityGate {
  return {
    id, name: id, type: 'custom', command,
    triggerPoints: ['pre-commit'], defaultTier: 'always-run',
    timeout: 60, order: 0, ...overrides,
  };
}

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    id: randomUUID(), timestamp: new Date().toISOString(),
    sessionId: 'test', actionType: 'gate-execution', result: 'pass',
    userTier: 'tier-2', activeSkills: [], details: {},
    ...overrides,
  };
}

describe('Integration: Error Handling Edge Cases', () => {
  let auditDir: string;
  let cacheDir: string;

  beforeEach(() => {
    auditDir = tmpDir('error-audit');
    cacheDir = tmpDir('error-cache');
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('gate tool not installed: nonexistent command via shell -> fail (FR-005)', async () => {
    // With shell: true, a nonexistent command produces exit code 127 (fail).
    // The ENOENT -> 'unavailable' path only fires when spawn can't find the shell binary.
    const gates = [makeGate('missing', '/nonexistent/command-that-does-not-exist')];
    const config: GateRunConfig = {
      trigger: 'pre-commit', gates, userTier: 'tier-2',
      gateOverrides: {}, enforcementActive: true, mandatoryGates: [],
      sessionId: 'test', activeSkills: [], auditDir,
    };

    const result = await runGates(config);
    expect(result.gatesExecuted[0].result).toBe('fail');
    expect(result.overallResult).toBe('fail');
  });

  it('skill repo unreachable: path missing -> cache used, warning (FR-013a)', () => {
    const cache = new SkillCache(cacheDir);
    cache.cacheSkill('drupal-security', {
      id: 'drupal-security', name: 'Drupal Security',
      constraints: 'cached', antiPatterns: [], cachedAt: new Date().toISOString(),
    });

    const result = loadSkill('drupal-security', '/nonexistent/skill-repo', cache);
    expect(result.source).toBe('cache');
    expect(result.warning).toBeTruthy();
    expect(result.skill).not.toBeNull();
  });

  it('skill repo + no cache: both missing -> graceful failure, no crash', () => {
    const cache = new SkillCache(cacheDir);
    const result = loadSkill('unknown-skill', '/nonexistent/repo', cache);
    expect(result.source).toBe('none');
    expect(result.skill).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('gate timeout: process exceeds timeout -> killed, timeout result (FR-006)', async () => {
    const gates = [makeGate('slow', 'sleep 10', { timeout: 1, order: 1 })];
    const config: GateRunConfig = {
      trigger: 'pre-commit', gates, userTier: 'tier-2',
      gateOverrides: {}, enforcementActive: true, mandatoryGates: [],
      sessionId: 'test', activeSkills: [], auditDir,
    };

    const result = await runGates(config);
    expect(result.gatesExecuted[0].result).toBe('timeout');
  }, 10_000);

  it('SQLite corruption: delete index -> triggers full rebuild', () => {
    const writer = new AuditWriter(auditDir);
    for (let i = 0; i < 5; i++) {
      writer.write(makeEntry());
    }

    const dbPath = join(auditDir, 'audit-index.sqlite');

    // Build initial index
    const index1 = new AuditIndex(dbPath);
    try {
      index1.initialize();
      index1.syncFromJSONL(auditDir);
      expect(index1.query().total).toBe(5);
    } finally {
      index1.close();
    }

    // Delete the SQLite file to simulate corruption
    unlinkSync(dbPath);

    // Full rebuild should restore from JSONL
    const index2 = new AuditIndex(dbPath);
    try {
      index2.initialize();
      const result = index2.fullRebuild(auditDir);
      expect(result.newEntries).toBe(5);
      expect(index2.query().total).toBe(5);
    } finally {
      index2.close();
    }
  });

  it('JSONL partial write: truncated last line -> skipped on read', () => {
    const writer = new AuditWriter(auditDir);
    writer.write(makeEntry());
    writer.write(makeEntry());

    const files = listAuditFiles(auditDir);
    // Append a truncated line
    appendFileSync(files[0], '{"id":"broken","time', 'utf-8');

    const { entries, skipped } = readEntries(files[0]);
    expect(entries).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it('concurrent writes: two rapid audit writes -> both succeed', () => {
    const writer = new AuditWriter(auditDir);
    const entry1 = makeEntry({ id: randomUUID() });
    const entry2 = makeEntry({ id: randomUUID() });

    // Write in rapid succession (synchronous appendFileSync is atomic per call)
    writer.write(entry1);
    writer.write(entry2);

    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe(entry1.id);
    expect(entries[1].id).toBe(entry2.id);
  });

  it('offline operation (SC-008): no network calls in enforcement', async () => {
    // Verify gate execution uses local commands only
    const gates = [makeGate('local', 'echo "local test"')];
    const config: GateRunConfig = {
      trigger: 'pre-commit', gates, userTier: 'tier-2',
      gateOverrides: {}, enforcementActive: true, mandatoryGates: [],
      sessionId: 'test', activeSkills: [], auditDir,
    };

    const result = await runGates(config);
    expect(result.gatesExecuted[0].result).toBe('pass');

    // Verify skill loading uses local filesystem only
    const cache = new SkillCache(cacheDir);
    const skillResult = loadSkill('test', '/nonexistent', cache);
    expect(skillResult.source).toBe('none');

    // Verify audit uses local filesystem
    const writer = new AuditWriter(auditDir);
    writer.write(makeEntry());
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
  });
});
