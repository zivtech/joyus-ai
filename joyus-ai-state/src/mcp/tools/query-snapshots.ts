/**
 * query_snapshots MCP tool — T039
 *
 * Lists snapshot summaries with optional filters.
 * Returns metadata only (id/timestamp/event/branch/commit message).
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StateStore, getSnapshotsDir } from '../../state/store.js';
import {
  validateInput,
  createSuccessResponse,
  createErrorResponse,
  QuerySnapshotsInputSchema,
} from './utils.js';

export const querySnapshotsToolDef = {
  name: 'query_snapshots',
  description:
    'List state snapshot summaries with optional filtering by date range, event type, and branch. Returns summaries only.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      since: {
        type: 'string',
        description: 'Inclusive ISO-8601 lower timestamp bound',
      },
      until: {
        type: 'string',
        description: 'Inclusive ISO-8601 upper timestamp bound',
      },
      event: {
        type: 'string',
        description: 'Event type filter',
      },
      branch: {
        type: 'string',
        description: 'Git branch filter',
      },
      limit: {
        type: 'number',
        description: 'Maximum summaries to return (1-1000, default 50)',
      },
    },
  },
};

export async function handleQuerySnapshots(
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<CallToolResult> {
  try {
    const input = validateInput(QuerySnapshotsInputSchema, args);
    const snapshotsDir = getSnapshotsDir(projectRoot);
    const store = new StateStore(snapshotsDir);

    const summaries = await store.list({
      since: input.since,
      until: input.until,
      event: input.event,
      branch: input.branch,
      limit: input.limit ?? 50,
    });

    return createSuccessResponse({
      total: summaries.length,
      filters: {
        since: input.since ?? null,
        until: input.until ?? null,
        event: input.event ?? null,
        branch: input.branch ?? null,
        limit: input.limit ?? 50,
      },
      snapshots: summaries,
    });
  } catch (err) {
    return createErrorResponse((err as Error).message);
  }
}
