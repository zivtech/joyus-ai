/**
 * State sharing — T017, T018, T019
 *
 * Export/import session state for sharing between developers.
 * Shared files are self-contained valid Snapshots with a sharer note.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { createId } from '@paralleldrive/cuid2';
import { SnapshotSchema } from '../core/schema.js';
import type { Snapshot, SharerNote } from '../core/types.js';
import { StateStore, getStateDir } from './store.js';

// --- T019: Directory management ---

export function getSharedOutgoingDir(stateDir: string): string {
  return path.join(stateDir, 'shared', 'outgoing');
}

export function getSharedIncomingDir(stateDir: string): string {
  return path.join(stateDir, 'shared', 'incoming');
}

export async function ensureSharedDirs(stateDir: string): Promise<void> {
  await mkdir(getSharedOutgoingDir(stateDir), { recursive: true });
  await mkdir(getSharedIncomingDir(stateDir), { recursive: true });
}

export function generateShareFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}-share.json`;
}

// --- T017: Export ---

export interface ShareOptions {
  projectRoot: string;
  note: string;
  outputPath?: string;
}

function getUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

function getGitUsername(projectRoot: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['config', 'user.name'], { cwd: projectRoot, timeout: 3000 }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

export async function exportSharedState(options: ShareOptions): Promise<{
  sharedFile: string;
  note: string;
}> {
  const { projectRoot, note, outputPath } = options;
  const stateDir = getStateDir(projectRoot);
  const snapshotsDir = path.join(stateDir, 'snapshots');
  const store = new StateStore(snapshotsDir);

  const latest = await store.readLatest();
  if (!latest) {
    throw new Error('No snapshot found. Capture a snapshot before sharing.');
  }

  // Build sharer note
  let from = getUsername();
  if (from === 'unknown') {
    const gitName = await getGitUsername(projectRoot);
    if (gitName) from = gitName;
  }

  const sharerNote: SharerNote = {
    from,
    note,
    sharedAt: new Date().toISOString(),
  };

  // Clone snapshot and attach sharer info
  const shared: Snapshot = {
    ...latest,
    id: createId(),
    event: 'share',
    sharer: sharerNote,
  };

  // Determine output path
  let filePath: string;
  if (outputPath) {
    filePath = path.resolve(outputPath);
  } else {
    const outDir = getSharedOutgoingDir(stateDir);
    await mkdir(outDir, { recursive: true });
    filePath = path.join(outDir, generateShareFilename());
  }

  // Write atomically
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(shared, null, 2) + '\n', 'utf-8');
  await rename(tmpPath, filePath);

  return { sharedFile: filePath, note };
}

// --- T018: Import ---

export interface LoadResult {
  snapshot: Snapshot;
  sharerNote: SharerNote | null;
}

export async function loadSharedState(filePath: string): Promise<LoadResult> {
  const resolved = path.resolve(filePath);

  let raw: string;
  try {
    raw = await readFile(resolved, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read shared state file: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Shared state file is not valid JSON');
  }

  const result = SnapshotSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid snapshot: ${issues}`);
  }

  const snapshot = result.data;
  return {
    snapshot,
    sharerNote: snapshot.sharer ?? null,
  };
}
