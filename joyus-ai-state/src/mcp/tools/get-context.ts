/**
 * get_context MCP tool — T021
 *
 * Returns current session context: latest snapshot enriched with live git/file state.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StateStore, getSnapshotsDir } from '../../state/store.js';
import { collectGitState } from '../../collectors/git.js';
import { collectFileState } from '../../collectors/files.js';
import { detectDivergence } from '../../state/divergence.js';

export const getContextToolDef = {
  name: 'get_context',
  description:
    'Get the current session context (latest snapshot enriched with live git state). Call this at session start or when you need to understand the current working state.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

export async function handleGetContext(
  _args: Record<string, unknown>,
  projectRoot: string,
): Promise<CallToolResult> {
  const snapshotsDir = getSnapshotsDir(projectRoot);
  const store = new StateStore(snapshotsDir);

  const [latest, liveGit, liveFiles] = await Promise.all([
    store.readLatest(),
    collectGitState(projectRoot),
    collectFileState(projectRoot),
  ]);

  let result: Record<string, unknown>;

  if (latest) {
    const divergence = detectDivergence(latest, liveGit, liveFiles);
    result = {
      ...latest,
      git: liveGit,
      files: liveFiles,
    };
    if (divergence.changes.length > 0) {
      result._divergence = divergence;
    }
  } else {
    result = {
      id: null,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      event: 'session-start',
      project: { rootPath: projectRoot, hash: '', name: '' },
      git: liveGit,
      files: liveFiles,
      task: null,
      tests: null,
      decisions: [],
      canonical: [],
      sharer: null,
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
