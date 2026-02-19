/**
 * File locking for concurrent session handling — T036
 *
 * Advisory file lock using atomic create (O_CREAT | O_EXCL).
 * Stale lock detection via PID check. Graceful timeout.
 */

import { open, unlink, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { logWarn, logDebug } from '../utils/logger.js';

interface LockData {
  pid: number;
  timestamp: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireLock(lockPath: string, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  const pollInterval = 100;

  while (Date.now() - start < timeoutMs) {
    try {
      // Atomic create — fails if file exists
      const fd = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      const data: LockData = { pid: process.pid, timestamp: new Date().toISOString() };
      await fd.writeFile(JSON.stringify(data));
      await fd.close();
      logDebug(`Lock acquired: ${lockPath}`);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        logWarn(`Lock error: ${(err as Error).message}`);
        return false;
      }

      // Lock file exists — check if stale
      try {
        const content = await readFile(lockPath, 'utf8');
        const lock: LockData = JSON.parse(content);

        if (!isProcessAlive(lock.pid)) {
          logDebug(`Removing stale lock (PID ${lock.pid} dead)`);
          await unlink(lockPath);
          continue; // Retry immediately
        }
      } catch {
        // Can't read lock file — try to remove it
        try { await unlink(lockPath); } catch { /* ignore */ }
        continue;
      }

      // Lock held by active process — wait
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  logWarn(`Could not acquire lock within ${timeoutMs}ms: ${lockPath}`);
  return false;
}

export async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
    logDebug(`Lock released: ${lockPath}`);
  } catch {
    // Already removed — fine
  }
}
