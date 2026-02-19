import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from '../../../src/service/watcher.js';
import { EventHandler } from '../../../src/service/event-handler.js';
import { createIpcServer, checkServiceHealth, requestCapture } from '../../../src/service/ipc.js';
import { isServiceRunning } from '../../../src/service/daemon.js';
import { getSnapshotsDir, getStateDir } from '../../../src/state/store.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

// --- FileWatcher (T030) ---

describe('FileWatcher', () => {
  it('can be created with options', () => {
    const watcher = new FileWatcher({ projectRoot: tmpDir });
    expect(watcher).toBeDefined();
  });

  it('starts and stops without error', async () => {
    const watcher = new FileWatcher({ projectRoot: tmpDir });
    await watcher.start();
    await watcher.stop();
  });

  it('emits git-commit when refs/heads file changes', async () => {
    // Set up a fake .git directory
    const gitDir = path.join(tmpDir, '.git');
    const refsDir = path.join(gitDir, 'refs', 'heads');
    fs.mkdirSync(refsDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(refsDir, 'main'), 'abc123\n');

    const watcher = new FileWatcher({
      projectRoot: tmpDir,
      debounce: { gitEvents: 50, fileChanges: 50 },
      usePolling: true,
    });

    const events: string[] = [];
    watcher.on('git-commit', () => events.push('git-commit'));

    await watcher.start();

    // Simulate a commit by touching the refs file
    fs.writeFileSync(path.join(refsDir, 'main'), 'def456\n');

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 500));
    await watcher.stop();

    expect(events).toContain('git-commit');
  });

  it('emits git-branch-switch when HEAD changes', async () => {
    const gitDir = path.join(tmpDir, '.git');
    const refsDir = path.join(gitDir, 'refs', 'heads');
    fs.mkdirSync(refsDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

    const watcher = new FileWatcher({
      projectRoot: tmpDir,
      debounce: { gitEvents: 50, fileChanges: 50 },
      usePolling: true,
    });

    const events: string[] = [];
    watcher.on('git-branch-switch', () => events.push('git-branch-switch'));

    await watcher.start();

    // Simulate a branch switch
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature\n');

    await new Promise((resolve) => setTimeout(resolve, 500));
    await watcher.stop();

    expect(events).toContain('git-branch-switch');
  });
});

// --- EventHandler (T031) ---

describe('EventHandler', () => {
  it('captures a snapshot on git-commit event', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const handler = new EventHandler(tmpDir);
    await handler.handleEvent('git-commit');

    expect(handler.lastCaptureTime).toBeTruthy();

    // Verify a snapshot was written
    const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(1);
  });

  it('captures a snapshot on branch-switch event', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const handler = new EventHandler(tmpDir);
    await handler.handleEvent('git-branch-switch');

    expect(handler.lastCaptureTime).toBeTruthy();
  });

  it('handles unknown events as manual', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const handler = new EventHandler(tmpDir);
    await handler.handleEvent('unknown-event');

    expect(handler.lastCaptureTime).toBeTruthy();
  });
});

// --- IPC (T032) ---

describe('IPC', () => {
  it('starts and stops the IPC server', async () => {
    const handler = new EventHandler(tmpDir);
    const ipc = createIpcServer(tmpDir, handler);

    const port = await ipc.start();
    expect(port).toBeGreaterThan(0);

    await ipc.stop();
  });

  it('health endpoint returns running status', async () => {
    const handler = new EventHandler(tmpDir);
    const ipc = createIpcServer(tmpDir, handler);
    await ipc.start();

    const stateDir = getStateDir(tmpDir);
    const health = await checkServiceHealth(stateDir);
    expect(health.running).toBe(true);
    expect(health.status?.status).toBe('running');
    expect(health.status?.pid).toBe(process.pid);

    await ipc.stop();
  });

  it('capture endpoint triggers snapshot', async () => {
    const snapshotsDir = getSnapshotsDir(tmpDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });

    const handler = new EventHandler(tmpDir);
    const ipc = createIpcServer(tmpDir, handler);
    await ipc.start();

    const stateDir = getStateDir(tmpDir);
    const result = await requestCapture(stateDir, 'manual');
    expect(result).toBe(true);

    // Wait for capture to complete (fire-and-forget)
    await new Promise((resolve) => setTimeout(resolve, 500));

    const files = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(1);

    await ipc.stop();
  });

  it('checkServiceHealth returns false when no service running', async () => {
    const stateDir = getStateDir(tmpDir);
    fs.mkdirSync(stateDir, { recursive: true });

    const health = await checkServiceHealth(stateDir);
    expect(health.running).toBe(false);
  });
});

// --- Daemon helpers (T029) ---

describe('isServiceRunning', () => {
  it('returns false when no PID file exists', async () => {
    const stateDir = getStateDir(tmpDir);
    fs.mkdirSync(stateDir, { recursive: true });

    const running = await isServiceRunning(stateDir);
    expect(running).toBe(false);
  });

  it('returns true when PID file points to current process', async () => {
    const stateDir = getStateDir(tmpDir);
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, 'service.pid'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );

    const running = await isServiceRunning(stateDir);
    expect(running).toBe(true);

    // Clean up
    fs.unlinkSync(path.join(stateDir, 'service.pid'));
  });

  it('returns false and cleans up stale PID file', async () => {
    const stateDir = getStateDir(tmpDir);
    fs.mkdirSync(stateDir, { recursive: true });

    // Use a PID that's very unlikely to be running
    fs.writeFileSync(
      path.join(stateDir, 'service.pid'),
      JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
    );

    const running = await isServiceRunning(stateDir);
    expect(running).toBe(false);

    // PID file should be cleaned up
    expect(fs.existsSync(path.join(stateDir, 'service.pid'))).toBe(false);
  });
});
