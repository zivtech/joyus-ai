/**
 * Session Run — Durable Inngest Function (WP01)
 *
 * Models the orchestrator session lifecycle as a durable Inngest function.
 * Each meaningful state change is a separate step.run() call, which gives us
 * automatic crash recovery: on restart Inngest replays from the last checkpoint.
 *
 * Concurrency controls (T015):
 *   - Per-tenant limit: at most ORCHESTRATOR_CONCURRENCY_PER_TENANT concurrent sessions
 *   - Global limit: ORCHESTRATOR_CONCURRENCY_GLOBAL across all tenants
 *   - When a tenant hits their limit, new sessions are queued (not rejected)
 *
 * Crash recovery (T014):
 *   - Sessions that were running when the process crashed have status 'running'
 *     but no active Inngest run. On server startup, a recovery sweep should
 *     call SessionService.findAllOrphanedSessions() and either re-dispatch
 *     or mark as failed (see src/orchestrator/recovery.ts for the startup hook).
 *   - Within a running function, Inngest's built-in retry handles transient failures.
 *     The step-based design ensures we never double-process completed steps.
 *
 * Execution ownership:
 *   The HTTP message route now owns agent execution via AgentLoopService.
 *   This function remains registered so existing `orchestrator/session.created`
 *   events are accepted by Inngest, but it must not run a placeholder agent loop
 *   or mark a new session completed before the first message arrives.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { inngest } from '../../client.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONCURRENCY_PER_TENANT = parseInt(
  process.env.ORCHESTRATOR_CONCURRENCY_PER_TENANT ?? '10',
  10,
);

const CONCURRENCY_GLOBAL = parseInt(
  process.env.ORCHESTRATOR_CONCURRENCY_GLOBAL ?? '100',
  10,
);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SessionRunDeps {
  db?: NodePgDatabase<Record<string, unknown>>;
}

/**
 * Create the session-run Inngest function.
 *
 * Call once during server initialisation with the database instance:
 *   const fn = createSessionRunFunction({ db });
 *
 * @param deps - Injectable dependencies (primarily for testing)
 */
export function createSessionRunFunction(deps: SessionRunDeps = {}) {
  return inngest.createFunction(
    {
      id: 'orchestrator-session-run',
      name: 'Orchestrator Session Run',
      /**
       * Per-tenant concurrency: at most CONCURRENCY_PER_TENANT concurrent sessions per tenant.
       * Sessions beyond the limit are queued by Inngest (not rejected).
       * The global limit prevents any single tenant from starving others.
       *
       * scope: 'fn' vs 'env' (spec T015 lists 'env'):
       *   - 'env' limits across ALL functions sharing the same Inngest environment.
       *   - 'fn'  limits within this function only (per-function key grouping).
       * Because this is currently a single-function orchestrator, 'fn' and 'env'
       * are functionally equivalent for per-tenant isolation. 'fn' has simpler
       * semantics and avoids cross-function interference if additional Inngest
       * functions are added later. Update to 'env' if cross-function concurrency
       * pooling is needed in a future WP.
       */
      concurrency: [
        {
          scope: 'fn',
          key: 'event.data.tenantId',
          limit: CONCURRENCY_PER_TENANT,
        },
        {
          scope: 'fn',
          key: 'global',
          limit: CONCURRENCY_GLOBAL,
        },
      ],
      /**
       * Retry configuration: Inngest retries on thrown errors with exponential backoff.
       * The step-based design ensures idempotency — completed steps are not re-run.
       */
      retries: 3,
    },
    { event: 'orchestrator/session.created' },
    async ({ event, step, runId }) => {
      const { sessionId, tenantId, userId } = event.data;

      if (!deps.db) {
        return {
          status: 'skipped' as const,
          sessionId,
          tenantId,
          reason: 'No database configured — skipping session run',
        };
      }

      return step.run('ack-session-created', async () => ({
        status: 'skipped' as const,
        sessionId,
        tenantId,
        userId,
        inngestRunId: runId,
        reason: 'Agent execution is owned by POST /sessions/:sessionId/messages',
      }));
    },
  );
}
