/**
 * save_state MCP tool — T022
 *
 * Captures a state snapshot. Claude calls this after significant actions.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createId } from '@paralleldrive/cuid2';
import { StateStore, getSnapshotsDir, getProjectHash } from '../../state/store.js';
import { collectGitState } from '../../collectors/git.js';
import { collectFileState } from '../../collectors/files.js';
import { carryForwardDecisions } from '../../collectors/decisions.js';
import { loadCanonical, getCanonicalStatuses } from '../../state/canonical.js';
import { SnapshotSchema } from '../../core/schema.js';
import type { Snapshot, EventType } from '../../core/types.js';
import path from 'node:path';

const VALID_EVENTS: EventType[] = [
  'commit', 'branch-switch', 'test-run', 'session-start',
  'session-end', 'manual', 'file-change', 'compaction', 'canonical-update', 'share',
];

export const saveStateToolDef = {
  name: 'save_state',
  description:
    'Capture a state snapshot now. Call this after significant actions (commits, test runs, branch switches) to preserve the current state.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event: {
        type: 'string',
        description: 'What triggered this snapshot',
        enum: VALID_EVENTS,
      },
      note: {
        type: 'string',
        description: 'Free-text note about what just happened',
      },
      decision: {
        type: 'string',
        description: 'Record a new pending decision',
      },
    },
  },
};

export async function handleSaveState(
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<CallToolResult> {
  const event = (typeof args.event === 'string' && VALID_EVENTS.includes(args.event as EventType))
    ? (args.event as EventType)
    : 'manual';
  const decision = typeof args.decision === 'string' ? args.decision : undefined;

  const snapshotsDir = getSnapshotsDir(projectRoot);
  const store = new StateStore(snapshotsDir);

  // Collect live state and previous data in parallel
  const [liveGit, liveFiles, previousSnapshot, canonicalDecl] = await Promise.all([
    collectGitState(projectRoot),
    collectFileState(projectRoot),
    store.readLatest(),
    loadCanonical(projectRoot),
  ]);

  // Carry forward decisions
  const previousDecisions = previousSnapshot?.decisions ?? [];
  const decisions = carryForwardDecisions(previousDecisions, decision);

  // Canonical statuses
  const canonical = await getCanonicalStatuses(projectRoot, canonicalDecl, liveGit.branch);

  const snapshot: Snapshot = {
    id: createId(),
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    event,
    project: {
      rootPath: projectRoot,
      hash: getProjectHash(projectRoot),
      name: path.basename(projectRoot),
    },
    git: liveGit,
    files: liveFiles,
    task: previousSnapshot?.task ?? null,
    tests: previousSnapshot?.tests ?? null,
    decisions,
    canonical,
    sharer: null,
  };

  // Validate
  SnapshotSchema.parse(snapshot);

  // Write
  const filePath = await store.write(snapshot);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        saved: true,
        id: snapshot.id,
        event,
        timestamp: snapshot.timestamp,
        file: filePath,
        branch: liveGit.branch,
      }, null, 2),
    }],
  };
}
