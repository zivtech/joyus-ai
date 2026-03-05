import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleGetContext } from '../../../src/mcp/tools/get-context.js';
import { handleSaveState } from '../../../src/mcp/tools/save-state.js';
import { handleVerifyAction } from '../../../src/mcp/tools/verify-action.js';
import { handleCheckCanonical } from '../../../src/mcp/tools/check-canonical.js';
import { handleShareState } from '../../../src/mcp/tools/share-state.js';
import { handleQuerySnapshots } from '../../../src/mcp/tools/query-snapshots.js';
import {
  validateInput,
  createErrorResponse,
  createSuccessResponse,
  SaveStateInputSchema,
  CheckCanonicalInputSchema,
  ShareStateInputSchema,
  QuerySnapshotsInputSchema,
} from '../../../src/mcp/tools/utils.js';
import { StateStore, getSnapshotsDir, initStateDirectory } from '../../../src/state/store.js';
import { saveCanonical, addDeclaration } from '../../../src/state/canonical.js';
import type { Snapshot } from '../../../src/core/types.js';
import type { CanonicalDeclarations } from '../../../src/state/canonical.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 'snap-test-001',
    version: '1.0.0',
    timestamp: '2026-01-15T10:00:00.000Z',
    event: 'commit',
    project: { rootPath: '/tmp/test', hash: 'abc123', name: 'test-project' },
    git: {
      branch: 'main',
      commitHash: 'abc1234',
      commitMessage: 'test commit',
      isDetached: false,
      hasUncommittedChanges: false,
      remoteBranch: null,
      aheadBehind: { ahead: 0, behind: 0 },
    },
    files: { staged: [], unstaged: [], untracked: [] },
    task: null,
    tests: null,
    decisions: [],
    canonical: [],
    sharer: null,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

// --- Utils (T027) ---

describe('utils', () => {
  describe('validateInput', () => {
    it('returns parsed data on valid input', () => {
      const result = validateInput(SaveStateInputSchema, { event: 'manual' });
      expect(result.event).toBe('manual');
    });

    it('throws on invalid input', () => {
      expect(() => validateInput(CheckCanonicalInputSchema, { action: 'check' })).toThrow('Invalid input');
    });

    it('validates query_snapshots input schema', () => {
      const result = validateInput(QuerySnapshotsInputSchema, { event: 'manual', limit: 20 });
      expect(result.event).toBe('manual');
      expect(result.limit).toBe(20);
    });

    it('includes field names in error message', () => {
      try {
        validateInput(CheckCanonicalInputSchema, { action: 'check' });
      } catch (err) {
        expect((err as Error).message).toContain('path');
      }
    });
  });

  describe('createErrorResponse', () => {
    it('returns MCP error format', () => {
      const result = createErrorResponse('something failed');
      expect(result.isError).toBe(true);
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.error).toBe('something failed');
    });
  });

  describe('createSuccessResponse', () => {
    it('returns MCP success format', () => {
      const result = createSuccessResponse({ foo: 'bar' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.foo).toBe('bar');
    });

    it('pretty-prints JSON', () => {
      const result = createSuccessResponse({ a: 1 });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('\n');
    });
  });
});

// --- get_context (T021) ---

describe('get_context', () => {
  it('returns fresh state when no snapshots exist', async () => {
    const result = await handleGetContext({}, tmpDir);
    expect(result.content).toHaveLength(1);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.git).toBeDefined();
    expect(data.files).toBeDefined();
    expect(data.id).toBeNull();
  });

  it('enriches existing snapshot with live state', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const store = new StateStore(snapshotsDir);
    await store.write(makeSnapshot({
      project: { rootPath: tmpDir, hash: 'test', name: 'test' },
    }));

    const result = await handleGetContext({}, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.id).toBe('snap-test-001');
    expect(data.git).toBeDefined();
  });
});

// --- save_state (T022) ---

describe('save_state', () => {
  it('saves a snapshot and returns confirmation', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const result = await handleSaveState({ event: 'manual' }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.saved).toBe(true);
    expect(data.id).toBeTruthy();
    expect(data.event).toBe('manual');
    expect(data.file).toBeTruthy();

    const store = new StateStore(snapshotsDir);
    const latest = await store.readLatest();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(data.id);
  });

  it('defaults to manual event when not specified', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const result = await handleSaveState({}, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.event).toBe('manual');
  });

  it('records a new decision', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    await handleSaveState({ event: 'manual', decision: 'Use Redis or Memcached?' }, tmpDir);

    const store = new StateStore(snapshotsDir);
    const latest = await store.readLatest();
    expect(latest).not.toBeNull();
    expect(latest!.decisions).toHaveLength(1);
    expect(latest!.decisions[0].question).toBe('Use Redis or Memcached?');
  });
});

// --- verify_action (T023) ---

describe('verify_action', () => {
  it('returns allowed when no issues found', async () => {
    const result = await handleVerifyAction({ action: 'push' }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.checks).toBeDefined();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(typeof data.allowed).toBe('boolean');
  });

  it('warns on force push', async () => {
    const result = await handleVerifyAction({ action: 'push', details: { force: true } }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.allowed).toBe(false);
    expect(data.warnings.some((w: string) => w.includes('Force push'))).toBe(true);
  });

  it('detects branch mismatch', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const store = new StateStore(snapshotsDir);
    await store.write(makeSnapshot({
      git: {
        branch: 'feature/other-branch',
        commitHash: 'abc',
        commitMessage: 'test',
        isDetached: false,
        hasUncommittedChanges: false,
        remoteBranch: null,
        aheadBehind: { ahead: 0, behind: 0 },
      },
      project: { rootPath: tmpDir, hash: 'test', name: 'test' },
    }));

    const result = await handleVerifyAction({ action: 'commit' }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    const branchCheck = data.checks.find((c: Check) => c.name === 'branch-match');
    expect(branchCheck.passed).toBe(false);
    expect(data.warnings.some((w: string) => w.includes('Branch mismatch'))).toBe(true);
  });

  it('returns error for invalid action', async () => {
    const result = await handleVerifyAction({ action: 'invalid' }, tmpDir);
    expect(result.isError).toBe(true);
  });
});

// --- check_canonical (T025) ---

describe('check_canonical', () => {
  it('check mode returns not-canonical for unknown path', async () => {
    const result = await handleCheckCanonical({ action: 'check', path: 'src/foo.ts' }, tmpDir);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.isCanonical).toBe(false);
    expect(data.canonicalName).toBeNull();
  });

  it('declare mode persists a canonical declaration', async () => {
    const result = await handleCheckCanonical(
      { action: 'declare', path: 'docs/spec.md', name: 'Feature Spec' },
      tmpDir,
    );
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.declared).toBe(true);
    expect(data.name).toBe('Feature Spec');
    expect(data.path).toBe('docs/spec.md');

    // Verify it can now be checked
    const checkResult = await handleCheckCanonical(
      { action: 'check', path: 'docs/spec.md' },
      tmpDir,
    );
    const checkData = JSON.parse((checkResult.content[0] as { text: string }).text);
    expect(checkData.isCanonical).toBe(true);
    expect(checkData.canonicalName).toBe('Feature Spec');
  });

  it('declare mode supports branch override', async () => {
    const result = await handleCheckCanonical(
      { action: 'declare', path: 'docs/spec.md', name: 'Feature Spec', branch: 'feature/x' },
      tmpDir,
    );
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.declared).toBe(true);
    expect(data.branch).toBe('feature/x');
  });

  it('returns error for declare without name', async () => {
    const result = await handleCheckCanonical(
      { action: 'declare', path: 'docs/spec.md' },
      tmpDir,
    );
    expect(result.isError).toBe(true);
  });

  it('returns error for invalid action', async () => {
    const result = await handleCheckCanonical(
      { action: 'invalid', path: 'foo' },
      tmpDir,
    );
    expect(result.isError).toBe(true);
  });
});

// --- share_state (T026) ---

describe('share_state', () => {
  it('export mode creates a shared state file', async () => {
    // Need a snapshot to export
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });
    await handleSaveState({ event: 'manual' }, tmpDir);

    const result = await handleShareState({ action: 'export', note: 'Working on auth' }, tmpDir);
    expect(result.isError).toBeUndefined();
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.sharedFile).toBeTruthy();
    expect(data.note).toBe('Working on auth');
  });

  it('import mode loads a shared state file', async () => {
    // First export to create a shared file
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });
    await handleSaveState({ event: 'manual' }, tmpDir);

    const exportResult = await handleShareState({ action: 'export', note: 'test handoff' }, tmpDir);
    const exportData = JSON.parse((exportResult.content[0] as { text: string }).text);

    // Now import it
    const importResult = await handleShareState({ action: 'import', path: exportData.sharedFile }, tmpDir);
    expect(importResult.isError).toBeUndefined();
    const importData = JSON.parse((importResult.content[0] as { text: string }).text);
    expect(importData.snapshot).toBeDefined();
    expect(importData.sharerNote.note).toBe('test handoff');
  });

  it('returns error for export without note', async () => {
    const result = await handleShareState({ action: 'export' }, tmpDir);
    expect(result.isError).toBe(true);
  });

  it('returns error for import without path', async () => {
    const result = await handleShareState({ action: 'import' }, tmpDir);
    expect(result.isError).toBe(true);
  });

  it('returns error for invalid action', async () => {
    const result = await handleShareState({ action: 'invalid' }, tmpDir);
    expect(result.isError).toBe(true);
  });
});

// --- query_snapshots (T039) ---

describe('query_snapshots', () => {
  it('returns snapshot summaries and respects filters', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const store = new StateStore(snapshotsDir);

    await store.write(makeSnapshot({
      id: 'snap-a',
      timestamp: '2026-01-15T10:00:00.000Z',
      event: 'manual',
      git: {
        branch: 'main',
        commitHash: 'abc1234',
        commitMessage: 'manual snapshot',
        isDetached: false,
        hasUncommittedChanges: false,
        remoteBranch: null,
        aheadBehind: { ahead: 0, behind: 0 },
      },
      project: { rootPath: tmpDir, hash: 'test', name: 'test' },
    }));
    await store.write(makeSnapshot({
      id: 'snap-b',
      timestamp: '2026-01-16T10:00:00.000Z',
      event: 'commit',
      git: {
        branch: 'feature/x',
        commitHash: 'def5678',
        commitMessage: 'commit snapshot',
        isDetached: false,
        hasUncommittedChanges: false,
        remoteBranch: null,
        aheadBehind: { ahead: 0, behind: 0 },
      },
      project: { rootPath: tmpDir, hash: 'test', name: 'test' },
    }));

    const result = await handleQuerySnapshots(
      { event: 'commit', branch: 'feature/x', limit: 10 },
      tmpDir,
    );
    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.total).toBe(1);
    expect(data.snapshots).toHaveLength(1);
    expect(data.snapshots[0].event).toBe('commit');
    expect(data.snapshots[0].branch).toBe('feature/x');
    expect(data.snapshots[0].id).toBe('snap-b');
  });

  it('returns validation error for invalid limit', async () => {
    const result = await handleQuerySnapshots({ limit: 0 }, tmpDir);
    expect(result.isError).toBe(true);
  });
});

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}
