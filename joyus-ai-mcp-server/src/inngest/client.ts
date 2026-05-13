/**
 * Inngest client configuration — Feature 010 evaluation spike.
 *
 * Configured for self-hosted Inngest server. In development, the server
 * runs via docker-compose.inngest.yml at http://localhost:8288.
 *
 * Required environment variables:
 *   INNGEST_BASE_URL      — URL of self-hosted Inngest server (default: http://localhost:8288)
 *   INNGEST_EVENT_KEY     — Event key for publishing events (default: local-dev-key)
 *   INNGEST_SIGNING_KEY   — Signing key for request verification (default: local-signing-key)
 */
import { Inngest, EventSchemas } from 'inngest';

// ---------------------------------------------------------------------------
// Event schema definitions
// ---------------------------------------------------------------------------

/**
 * Events used by the orchestrator (WP01+).
 */
type OrchestratorEvents = {
  /** Fired when a new session is created — triggers the durable session-run function */
  'orchestrator/session.created': {
    data: {
      sessionId: string;
      tenantId: string;
      userId: string;
    };
  };

  /** Fired when a session's concurrency limit is hit — for observability */
  'orchestrator/session.queued': {
    data: {
      sessionId: string;
      tenantId: string;
      queuedAt: string;
    };
  };

  /**
   * WP04: Fired when a work unit status changes.
   * Triggers the coordination group lifecycle function.
   */
  'orchestrator/work_unit.status_changed': {
    data: {
      workUnitId: string;
      tenantId: string;
      previousStatus: string;
      newStatus: string;
      coordinationGroupId?: string;
    };
  };

  /**
   * WP04: Inter-agent signal — fire-and-forget typed message from one session to another.
   * The target session's Inngest function receives it via step.waitForEvent().
   * Signals are tenant-scoped and cannot cross tenant boundaries.
   */
  'orchestrator/agent.signal': {
    data: {
      tenantId: string;
      fromSessionId: string;
      toSessionId: string;
      signalType: string;
      payload: Record<string, unknown>;
    };
  };
};

/**
 * Events used by the pipeline system.
 * Add new event types here as WP02-WP04 introduce them.
 */
type PipelineEvents = {
  /** Fired when a corpus changes, triggering corpus-change pipelines */
  'pipeline/corpus.changed': {
    data: {
      tenantId: string;
      corpusId: string;
      changeType: 'created' | 'updated' | 'deleted';
    };
  };

  /** Fired by DecisionRecorder to resume a paused review-gate execution */
  'pipeline/review.decided': {
    data: {
      tenantId: string;
      executionId: string;
      decision: 'approved' | 'rejected';
      feedback?: string;
    };
  };

  /** Fired by schedule triggers to kick off schedule_tick pipelines */
  'pipeline/schedule.tick': {
    data: {
      tenantId: string;
      pipelineId: string;
      scheduledAt: string;
    };
  };

  /** Fired by the manual trigger route to enqueue pipeline execution */
  'pipeline/manual.triggered': {
    data: {
      tenantId: string;
      pipelineId: string;
      payload: Record<string, unknown>;
    };
  };
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const inngest = new Inngest({
  id: 'joyus-ai',
  schemas: new EventSchemas().fromRecord<PipelineEvents & OrchestratorEvents>(),
  eventKey: process.env.INNGEST_EVENT_KEY ?? 'local-dev-key',
  baseUrl: process.env.INNGEST_BASE_URL ?? 'http://localhost:8288',
});
