/**
 * Service daemon — T029
 *
 * Main service process — lifecycle, PID file, orchestrates watcher + event handler + IPC.
 */

import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getStateDir } from '../state/store.js';
import { loadProjectConfig } from '../core/config.js';
import { FileWatcher } from './watcher.js';
import { EventHandler } from './event-handler.js';
import { createIpcServer, type IpcServer } from './ipc.js';

export interface ServiceOptions {
  projectRoot: string;
  foreground?: boolean;
}

function getPidFilePath(stateDir: string): string {
  return path.join(stateDir, 'service.pid');
}

export async function startService(options: ServiceOptions): Promise<void> {
  const { projectRoot } = options;
  const stateDir = getStateDir(projectRoot);
  await mkdir(stateDir, { recursive: true });

  // Check if already running
  if (await isServiceRunning(stateDir)) {
    console.error('[joyus-ai-service] Another instance is already running for this project.');
    process.exit(1);
  }

  // Write PID file
  const pidData = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  await writeFile(getPidFilePath(stateDir), pidData, 'utf8');

  // Initialize components
  const projectConfig = await loadProjectConfig(projectRoot);
  const eventHandler = new EventHandler(projectRoot);
  const watcher = new FileWatcher({
    projectRoot,
    customTriggers: projectConfig.customTriggers,
  });
  const ipcServer = createIpcServer(projectRoot, eventHandler);

  // Wire watcher events to handler
  watcher.on('git-commit', () => eventHandler.handleEvent('git-commit'));
  watcher.on('git-branch-switch', () => eventHandler.handleEvent('git-branch-switch'));
  watcher.on('file-change', () => eventHandler.handleEvent('file-change'));
  watcher.on('custom-event', (eventName: string) => eventHandler.handleEvent('custom-event', eventName));

  // Start components
  await watcher.start();
  const port = await ipcServer.start();

  console.error(`[joyus-ai-service] Started for: ${projectRoot}`);
  console.error(`[joyus-ai-service] PID: ${process.pid}, IPC port: ${port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.error('[joyus-ai-service] Shutting down...');
    await watcher.stop();
    await ipcServer.stop();
    try { await unlink(getPidFilePath(stateDir)); } catch { /* already removed */ }
    console.error('[joyus-ai-service] Stopped.');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGUSR1', () => {
    console.error('[joyus-ai-service] SIGUSR1 received — capturing snapshot');
    eventHandler.handleEvent('manual');
  });
}

export async function stopService(stateDir: string): Promise<void> {
  try {
    const raw = await readFile(getPidFilePath(stateDir), 'utf8');
    const { pid } = JSON.parse(raw);
    process.kill(pid, 'SIGTERM');
    console.error(`[joyus-ai-service] Sent SIGTERM to PID ${pid}`);
  } catch (err) {
    console.error('[joyus-ai-service] No running service found:', (err as Error).message);
  }
}

export async function isServiceRunning(stateDir: string): Promise<boolean> {
  try {
    const raw = await readFile(getPidFilePath(stateDir), 'utf8');
    const { pid } = JSON.parse(raw);
    process.kill(pid, 0); // Signal 0 = check if alive
    return true;
  } catch {
    // PID file missing or process dead — clean up stale PID file
    try { await unlink(getPidFilePath(stateDir)); } catch { /* no file */ }
    return false;
  }
}
