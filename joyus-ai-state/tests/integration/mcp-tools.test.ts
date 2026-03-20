/**
 * MCP Tools integration tests — T034
 *
 * Full lifecycle: get_context → save_state → verify_action → check_canonical → share_state
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleGetContext } from '../../src/mcp/tools/get-context.js';
import { handleSaveState } from '../../src/mcp/tools/save-state.js';
import { handleVerifyAction } from '../../src/mcp/tools/verify-action.js';
import { handleCheckCanonical } from '../../src/mcp/tools/check-canonical.js';
import { handleShareState } from '../../src/mcp/tools/share-state.js';
import { getSnapshotsDir } from '../../src/state/store.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

let tmpDir: string;

function parse(result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-'));
  initGitRepo(tmpDir);
  fs.mkdirSync(getSnapshotsDir(tmpDir), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('MCP Tools E2E', () => {
  it('get_context returns live state when no snapshots exist', async () => {
    const result = await handleGetContext({}, tmpDir);
    const data = parse(result);
    expect(data.git).toBeDefined();
    expect(data.id).toBeNull();
    expect((data.git as Record<string, unknown>).branch).toBe('main');
  });

  it('save_state → get_context round-trip', async () => {
    const saveResult = await handleSaveState({ event: 'commit' }, tmpDir);
    const saveData = parse(saveResult);
    expect(saveData.saved).toBe(true);

    const getResult = await handleGetContext({}, tmpDir);
    const getData = parse(getResult);
    expect(getData.id).toBe(saveData.id);
    expect(getData.event).toBe('commit');
  });

  it('verify_action catches branch mismatch', async () => {
    // Save on main
    await handleSaveState({ event: 'manual' }, tmpDir);

    // Create and switch to feature branch
    execFileSync('git', ['checkout', '-b', 'feature/test'], { cwd: tmpDir, stdio: 'ignore' });

    const result = await handleVerifyAction({ action: 'commit' }, tmpDir);
    const data = parse(result);
    expect(data.warnings).toBeDefined();
    const warnings = data.warnings as string[];
    expect(warnings.some((w: string) => w.includes('Branch mismatch'))).toBe(true);
  });

  it('check_canonical declare and check', async () => {
    // Declare
    const declResult = await handleCheckCanonical(
      { action: 'declare', path: 'docs/spec.md', name: 'Spec' },
      tmpDir,
    );
    expect(parse(declResult).declared).toBe(true);

    // Check canonical path → true
    const checkResult = await handleCheckCanonical(
      { action: 'check', path: 'docs/spec.md' },
      tmpDir,
    );
    expect(parse(checkResult).isCanonical).toBe(true);

    // Check non-canonical path → false (but name found)
    const checkOther = await handleCheckCanonical(
      { action: 'check', path: 'other/spec.md' },
      tmpDir,
    );
    expect(parse(checkOther).isCanonical).toBe(false);
  });

  it('share_state export and import', async () => {
    await handleSaveState({ event: 'manual' }, tmpDir);

    const exportResult = await handleShareState(
      { action: 'export', note: 'Handing off auth work' },
      tmpDir,
    );
    const exportData = parse(exportResult);
    expect(exportData.sharedFile).toBeTruthy();

    // Copy exported file to incoming directory (simulates receiving a shared file)
    const { getStateDir } = await import('../../src/state/store.js');
    const stateDir = getStateDir(tmpDir);
    const incomingDir = path.join(stateDir, 'shared', 'incoming');
    fs.mkdirSync(incomingDir, { recursive: true });
    const incomingPath = path.join(incomingDir, path.basename(exportData.sharedFile as string));
    fs.copyFileSync(exportData.sharedFile as string, incomingPath);

    const importResult = await handleShareState(
      { action: 'import', path: incomingPath },
      tmpDir,
    );
    const importData = parse(importResult);
    expect(importData.snapshot).toBeDefined();
    expect((importData.sharerNote as Record<string, unknown>).note).toBe('Handing off auth work');
  });

  it('full lifecycle', async () => {
    // 1. get_context (empty)
    const ctx1 = parse(await handleGetContext({}, tmpDir));
    expect(ctx1.id).toBeNull();

    // 2. save_state after commit
    const save1 = parse(await handleSaveState({ event: 'commit' }, tmpDir));
    expect(save1.saved).toBe(true);

    // 3. get_context (has snapshot)
    const ctx2 = parse(await handleGetContext({}, tmpDir));
    expect(ctx2.id).toBe(save1.id);

    // 4. Declare canonical doc
    const decl = parse(await handleCheckCanonical(
      { action: 'declare', path: 'src/main.ts', name: 'Main Entry' },
      tmpDir,
    ));
    expect(decl.declared).toBe(true);

    // 5. verify_action (should pass — same branch)
    const verify = parse(await handleVerifyAction({ action: 'commit' }, tmpDir));
    expect(verify.allowed).toBeDefined();

    // 6. Share state
    const share = parse(await handleShareState(
      { action: 'export', note: 'Done for the day' },
      tmpDir,
    ));
    expect(share.sharedFile).toBeTruthy();

    // 7. Load shared state (copy to incoming dir first — path traversal containment)
    const { getStateDir: getSD } = await import('../../src/state/store.js');
    const lcStateDir = getSD(tmpDir);
    const incomingDir = path.join(lcStateDir, 'shared', 'incoming');
    fs.mkdirSync(incomingDir, { recursive: true });
    const incomingPath = path.join(incomingDir, path.basename(share.sharedFile as string));
    fs.copyFileSync(share.sharedFile as string, incomingPath);

    const load = parse(await handleShareState(
      { action: 'import', path: incomingPath },
      tmpDir,
    ));
    expect(load.snapshot).toBeDefined();
  });
});
