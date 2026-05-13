/**
 * Coordination Lifecycle Functions — WP04 (T033)
 *
 * Durable Inngest functions that react to coordination events and manage
 * group lifecycle. Every meaningful state check is a step.run() call for
 * crash recovery and replay safety.
 *
 * Functions defined here:
 *   createCoordinationGroupLifecycleFunction — listens for work_unit.status_changed,
 *     evaluates the group's completion policy, and finalizes the group if the
 *     policy is satisfied.
 *
 * Design:
 *   - Functions are created via factory pattern (same as session-run.ts) to
 *     support dependency injection for tests.
 *   - Group evaluation is idempotent — finalizeCoordinationGroup() is a no-op
 *     if the group is already in a terminal state.
 *   - Signals (agent.signal) are raw Inngest events, not orchestrator events.
 *     Receiving agents wait on them via step.waitForEvent() in their own functions.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { CoordinationService } from '../../../orchestrator/coordination.service.js';
import { EventService } from '../../../orchestrator/event.service.js';
import { inngest } from '../../client.js';

// ============================================================
// DEPS INTERFACE
// ============================================================

export interface CoordinationFunctionDeps {
  db?: NodePgDatabase<Record<string, unknown>>;
}

// ============================================================
// COORDINATION GROUP LIFECYCLE FUNCTION
// ============================================================

/**
 * React to work unit status changes and evaluate group completion policies.
 *
 * Triggered by: `orchestrator/work_unit.status_changed`
 *
 * Flow:
 * 1. Extract the coordinationGroupId from the event payload.
 * 2. If no group, exit immediately — standalone work units don't trigger this.
 * 3. Evaluate the group's completion policy.
 * 4. If policy satisfied → finalize the group as 'completed'.
 * 5. If policy failed   → finalize the group as 'failed'.
 * 6. Otherwise          → no-op (group still active, more units to complete).
 */
export function createCoordinationGroupLifecycleFunction(
  deps: CoordinationFunctionDeps = {},
) {
  return inngest.createFunction(
    {
      id: 'orchestrator-coordination-group-lifecycle',
      name: 'Orchestrator: Coordination Group Lifecycle',
      retries: 3,
    },
    { event: 'orchestrator/work_unit.status_changed' },
    async ({ event, step }) => {
      const { tenantId, workUnitId, coordinationGroupId } = event.data;

      // Only process work units that belong to a coordination group
      if (!coordinationGroupId) {
        return {
          status: 'skipped' as const,
          reason: 'Work unit has no coordination group',
          workUnitId,
        };
      }

      if (!deps.db) {
        return {
          status: 'skipped' as const,
          reason: 'No database configured',
          workUnitId,
        };
      }

      const db = deps.db as NodePgDatabase<Record<string, unknown>>;
      const eventService = new EventService(db);
      const coordinationService = new CoordinationService(db, eventService);

      // Step 1: Evaluate whether the group's policy is satisfied
      const evaluation = await step.run('evaluate-group-completion', async () => {
        return coordinationService.evaluateCompletion(tenantId, coordinationGroupId);
      });

      // Step 2: Finalize if complete or failed
      if (evaluation.isComplete) {
        await step.run('finalize-group-completed', async () => {
          return coordinationService.finalizeCoordinationGroup(
            tenantId,
            coordinationGroupId,
            'completed',
          );
        });

        return {
          status: 'completed' as const,
          groupId: coordinationGroupId,
          tenantId,
          policy: evaluation.policy,
          summary: evaluation.summary,
        };
      }

      if (evaluation.isFailed) {
        await step.run('finalize-group-failed', async () => {
          return coordinationService.finalizeCoordinationGroup(
            tenantId,
            coordinationGroupId,
            'failed',
            `Policy "${evaluation.policy}" failed: ${evaluation.summary.failed} unit(s) failed`,
          );
        });

        return {
          status: 'failed' as const,
          groupId: coordinationGroupId,
          tenantId,
          policy: evaluation.policy,
          summary: evaluation.summary,
        };
      }

      // Group still active — more work units need to complete
      return {
        status: 'active' as const,
        groupId: coordinationGroupId,
        tenantId,
        policy: evaluation.policy,
        summary: evaluation.summary,
      };
    },
  );
}
