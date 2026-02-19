/**
 * Event handler — T031
 *
 * Receives events from the filesystem watcher, maps them to EventType,
 * and triggers snapshot capture.
 */

import { createId } from '@paralleldrive/cuid2';
import { StateStore, getSnapshotsDir, getProjectHash } from '../state/store.js';
import { collectGitState } from '../collectors/git.js';
import { collectFileState } from '../collectors/files.js';
import { carryForwardDecisions } from '../collectors/decisions.js';
import { loadCanonical, getCanonicalStatuses } from '../state/canonical.js';
import { SnapshotSchema } from '../core/schema.js';
import type { Snapshot, EventType } from '../core/types.js';
import path from 'node:path';

const EVENT_MAP: Record<string, EventType> = {
  'git-commit': 'commit',
  'git-branch-switch': 'branch-switch',
  'file-change': 'file-change',
  'test-output': 'test-run',
};

export class EventHandler {
  private projectRoot: string;
  private capturing = false;
  public lastCaptureTime: string | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async handleEvent(eventType: string, _detail?: string): Promise<void> {
    // Prevent concurrent captures
    if (this.capturing) return;
    this.capturing = true;

    try {
      const event: EventType = EVENT_MAP[eventType] ?? 'manual';
      const snapshotsDir = getSnapshotsDir(this.projectRoot);
      const store = new StateStore(snapshotsDir);

      const [liveGit, liveFiles, previousSnapshot, canonicalDecl] = await Promise.all([
        collectGitState(this.projectRoot),
        collectFileState(this.projectRoot),
        store.readLatest(),
        loadCanonical(this.projectRoot),
      ]);

      const previousDecisions = previousSnapshot?.decisions ?? [];
      const decisions = carryForwardDecisions(previousDecisions);
      const canonical = await getCanonicalStatuses(this.projectRoot, canonicalDecl, liveGit.branch);

      const snapshot: Snapshot = {
        id: createId(),
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        event,
        project: {
          rootPath: this.projectRoot,
          hash: getProjectHash(this.projectRoot),
          name: path.basename(this.projectRoot),
        },
        git: liveGit,
        files: liveFiles,
        task: previousSnapshot?.task ?? null,
        tests: previousSnapshot?.tests ?? null,
        decisions,
        canonical,
        sharer: null,
      };

      SnapshotSchema.parse(snapshot);
      await store.write(snapshot);

      this.lastCaptureTime = snapshot.timestamp;
      console.error(`[joyus-ai-service] Snapshot captured: ${snapshot.timestamp} [${event}]`);
    } catch (err) {
      console.error('[joyus-ai-service] Error capturing snapshot:', (err as Error).message);
    } finally {
      this.capturing = false;
    }
  }
}
