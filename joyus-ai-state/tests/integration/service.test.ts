/**
 * Companion service integration tests — T035
 *
 * Verifies watcher detects events, debouncing works, IPC health/capture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from '../../src/service/watcher.js';
import { EventHandler } from '../../src/service/event-handler.js';
import { createIpcServer, checkServiceHealth, requestCapture } from '../../src/service/ipc.js';
import { getSnapshotsDir, getStateDir } from '../../src/state/store.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-e2e-'));
  fs.mkdirSync(getSnapshotsDir(tmpDir), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('Companion Service Integration', () => {
  it('detects git commit and captures snapshot', async () => {
    // Set up fake .git
    const refsDir = path.join(tmpDir, '.git', 'refs', 'heads');
    fs.mkdirSync(refsDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(refsDir, 'main'), 'abc123\n');

    const handler = new EventHandler(tmpDir);
    const watcher = new FileWatcher({
      projectRoot: tmpDir,
      debounce: { gitEvents: 50, fileChanges: 50 },
      usePolling: true,
    });

    watcher.on('git-commit', () => handler.handleEvent('git-commit'));
    await watcher.start();

    // Simulate commit
    fs.writeFileSync(path.join(refsDir, 'main'), 'def456\n');
    await new Promise((resolve) => setTimeout(resolve, 500));

    await watcher.stop();
    expect(handler.lastCaptureTime).toBeTruthy();

    const files = fs.readdirSync(getSnapshotsDir(tmpDir)).filter(f => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('debounces rapid events', async () => {
    const refsDir = path.join(tmpDir, '.git', 'refs', 'heads');
    fs.mkdirSync(refsDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(refsDir, 'main'), 'aaa\n');

    const handler = new EventHandler(tmpDir);
    const watcher = new FileWatcher({
      projectRoot: tmpDir,
      debounce: { gitEvents: 200, fileChanges: 200 },
      usePolling: true,
    });

    watcher.on('git-commit', () => handler.handleEvent('git-commit'));
    await watcher.start();

    // Trigger 5 rapid changes
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(refsDir, 'main'), `commit-${i}\n`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    // Wait for debounce to settle
    await new Promise((resolve) => setTimeout(resolve, 600));
    await watcher.stop();

    // Should have only 1 snapshot, not 5
    const files = fs.readdirSync(getSnapshotsDir(tmpDir)).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(1);
  });

  it('IPC health check and capture works end-to-end', async () => {
    const handler = new EventHandler(tmpDir);
    const ipc = createIpcServer(tmpDir, handler);
    await ipc.start();

    const stateDir = getStateDir(tmpDir);

    // Health check
    const health = await checkServiceHealth(stateDir);
    expect(health.running).toBe(true);

    // Request capture
    const captured = await requestCapture(stateDir, 'manual');
    expect(captured).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const files = fs.readdirSync(getSnapshotsDir(tmpDir)).filter(f => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(1);

    await ipc.stop();
  });
});
