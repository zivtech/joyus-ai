/**
 * check_canonical MCP tool — T025
 *
 * Check file paths against canonical declarations or declare new canonical sources.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { validateInput, createSuccessResponse, createErrorResponse, CheckCanonicalInputSchema } from './utils.js';
import { loadCanonical, saveCanonical, addDeclaration, checkPath } from '../../state/canonical.js';
import { collectGitState } from '../../collectors/git.js';

export const checkCanonicalToolDef = {
  name: 'check_canonical',
  description:
    'Check if a file path is the canonical source, or declare a new canonical source. Use before reading/writing files that might have duplicates.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['check', 'declare'],
        description: 'Mode: check a path or declare a new canonical source',
      },
      path: {
        type: 'string',
        description: 'File path to check or declare as canonical',
      },
      name: {
        type: 'string',
        description: 'Human-readable name for the document (required for declare mode)',
      },
      branch: {
        type: 'string',
        description: 'Branch-specific override (declare mode only)',
      },
    },
    required: ['action', 'path'],
  },
};

export async function handleCheckCanonical(
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<CallToolResult> {
  try {
    const input = validateInput(CheckCanonicalInputSchema, args);

    if (input.action === 'check') {
      const declarations = await loadCanonical(projectRoot);
      const gitState = await collectGitState(projectRoot);
      const result = checkPath(declarations, input.path, gitState.branch);
      return createSuccessResponse(result);
    }

    // declare mode
    const declarations = await loadCanonical(projectRoot);
    const updated = addDeclaration(declarations, input.name, input.path, input.branch);
    await saveCanonical(projectRoot, updated);
    return createSuccessResponse({
      declared: true,
      name: input.name,
      path: input.path,
      branch: input.branch ?? null,
    });
  } catch (err) {
    return createErrorResponse((err as Error).message);
  }
}
