/**
 * share_state MCP tool — T026
 *
 * Export current state with a note for a teammate, or load shared state.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { validateInput, createSuccessResponse, createErrorResponse, ShareStateInputSchema } from './utils.js';
import { exportSharedState, loadSharedState, getSharedIncomingDir } from '../../state/share.js';
import { getStateDir } from '../../state/store.js';

export const shareStateToolDef = {
  name: 'share_state',
  description:
    "Export current state with a note for a teammate, or load a teammate's shared state.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['export', 'import'],
        description: 'Mode: export current state or import shared state',
      },
      note: {
        type: 'string',
        description: 'What you were working on (required for export)',
      },
      path: {
        type: 'string',
        description: 'Path to shared state file (required for import)',
      },
    },
    required: ['action'],
  },
};

export async function handleShareState(
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<CallToolResult> {
  try {
    const input = validateInput(ShareStateInputSchema, args);

    if (input.action === 'export') {
      const result = await exportSharedState({ projectRoot, note: input.note });
      return createSuccessResponse(result);
    }

    // import mode — constrain the path to the incoming shared state directory
    const stateDir = getStateDir(projectRoot);
    const allowedDir = getSharedIncomingDir(stateDir);
    const result = await loadSharedState(input.path, allowedDir);
    return createSuccessResponse(result);
  } catch (err) {
    return createErrorResponse((err as Error).message);
  }
}
