/**
 * State store — T005, T006, T007
 *
 * Atomic read/write of snapshot JSON files. Crash-safe via write-to-temp
 * then rename pattern. Per-project state directory under ~/.joyus-ai/.
 */

import { readdir, readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { SnapshotSchema } from '../core/schema.js';
import type { Snapshot, EventType } from '../core/types.js';
import { acquireLock, releaseLock } from './lock.js';
import { logWarn, logDebug } from '../utils/logger.js';

// --- Types ---

export interface SnapshotFilter {
  since?: string;
  until?: string;
  event?: EventType;
  branch?: string;
  limit?: number;
}

export interface SnapshotSummary {
  id: string;
  timestamp: string;
  event: EventType;
  branch: string;
  commitMessage: string;
}

// --- T007: Directory initialization ---

export function getProjectHash(projectRoot: string): string {
  const normalized = resolve(projectRoot);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function getStateDir(projectRoot: string): string {
  const hash = getProjectHash(projectRoot);
  return join(homedir(), '.joyus-ai', 'projects', hash);
}

export function getSnapshotsDir(projectRoot: string): string {
  return join(getStateDir(projectRoot), 'snapshots');
}

export async function initStateDirectory(projectRoot: string): Promise<string> {
  const stateDir = getStateDir(projectRoot);

  // Create global state directories
  await mkdir(join(stateDir, 'snapshots'), { recursive: true });
  await mkdir(join(stateDir, 'shared', 'incoming'), { recursive: true });
  await mkdir(join(stateDir, 'shared', 'outgoing'), { recursive: true });

  // Create project-local .joyus-ai/ directory
  const localDir = join(projectRoot, '.joyus-ai');
  await mkdir(localDir, { recursive: true });

  // Create default config files if they don't exist
  await writeIfMissing(join(localDir, 'config.json'), '{}');
  await writeIfMissing(join(localDir, 'canonical.json'), '{"documents":{}}');

  return stateDir;
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, content, 'utf-8');
  }
}

// --- StateStore class ---

export class StateStore {
  private readonly snapshotsDir: string;

  constructor(snapshotsDir: string) {
    this.snapshotsDir = snapshotsDir;
  }

  // --- T005: Atomic snapshot write ---

  async write(snapshot: Snapshot): Promise<string> {
    const lockPath = join(this.snapshotsDir, 'write.lock');

    try {
      await mkdir(this.snapshotsDir, { recursive: true });

      const locked = await acquireLock(lockPath, 5000);
      if (!locked) {
        logWarn('Could not acquire write lock, skipping snapshot');
        return snapshot.id;
      }

      try {
        const validated = SnapshotSchema.parse(snapshot);
        const filename = await this.generateFilename(validated.timestamp);
        const filePath = join(this.snapshotsDir, filename);
        const tmpPath = filePath + '.tmp';

        await writeFile(tmpPath, JSON.stringify(validated, null, 2), 'utf-8');
        await rename(tmpPath, filePath);

        logDebug(`Snapshot written: ${filename}`);
        return validated.id;
      } finally {
        await releaseLock(lockPath);
      }
    } catch (err) {
      logWarn(`Failed to write snapshot: ${err instanceof Error ? err.message : err}`);
      return snapshot.id;
    }
  }

  // --- T006: Snapshot read and listing ---

  async readLatest(): Promise<Snapshot | null> {
    const files = await this.listSnapshotFiles();
    if (files.length === 0) return null;

    // Files are sorted descending (newest first)
    for (const file of files) {
      const snapshot = await this.readAndParse(join(this.snapshotsDir, file));
      if (snapshot) return snapshot;
    }

    return null;
  }

  async readById(id: string): Promise<Snapshot | null> {
    const files = await this.listSnapshotFiles();

    for (const file of files) {
      const snapshot = await this.readAndParse(join(this.snapshotsDir, file));
      if (snapshot && snapshot.id === id) return snapshot;
    }

    return null;
  }

  async list(filter?: SnapshotFilter): Promise<SnapshotSummary[]> {
    const files = await this.listSnapshotFiles();
    const limit = filter?.limit ?? 10;
    const summaries: SnapshotSummary[] = [];

    for (const file of files) {
      if (summaries.length >= limit) break;

      const snapshot = await this.readAndParse(join(this.snapshotsDir, file));
      if (!snapshot) continue;

      if (filter?.since && snapshot.timestamp < filter.since) continue;
      if (filter?.until && snapshot.timestamp > filter.until) continue;
      if (filter?.event && snapshot.event !== filter.event) continue;
      if (filter?.branch && snapshot.git.branch !== filter.branch) continue;

      summaries.push({
        id: snapshot.id,
        timestamp: snapshot.timestamp,
        event: snapshot.event,
        branch: snapshot.git.branch,
        commitMessage: snapshot.git.commitMessage,
      });
    }

    return summaries;
  }

  // --- Helpers ---

  private async generateFilename(timestamp: string): Promise<string> {
    const safe = timestamp.replace(/:/g, '-');
    const base = `${safe}.json`;

    try {
      await stat(join(this.snapshotsDir, base));
      // File exists — append suffix
      return `${safe}-${createId().slice(0, 8)}.json`;
    } catch {
      return base;
    }
  }

  private async listSnapshotFiles(): Promise<string[]> {
    try {
      const files = await readdir(this.snapshotsDir);
      return files
        .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
        .sort()
        .reverse(); // newest first
    } catch {
      return [];
    }
  }

  private async readAndParse(filePath: string): Promise<Snapshot | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return SnapshotSchema.parse(parsed);
    } catch (err) {
      console.warn('[joyus-ai] Skipping corrupted snapshot:', filePath, err instanceof Error ? err.message : '');
      return null;
    }
  }
}
