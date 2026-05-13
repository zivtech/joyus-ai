/**
 * Event Service — WP03 (T024, T025, T026)
 *
 * Typed event system for recording all orchestrator state changes and
 * supporting real-time external subscription via Server-Sent Events (SSE).
 *
 * Design principles:
 * - APPEND-ONLY: emitEvent() is the only write path. No updates, no deletes.
 * - TYPED REGISTRY: every event type must be explicitly registered with a Zod
 *   schema. Unregistered event types are rejected synchronously at emit time.
 * - TENANT-SCOPED: every read and write path includes tenantId in WHERE clauses.
 * - FIRE-AND-FORGET notifications: notification routing must never delay emission.
 *
 * SSE subscription (T026):
 * - Clients receive events in SSE format: id/event/data lines.
 * - Polling at 1-second intervals (LISTEN/NOTIFY is a Phase 2 upgrade).
 * - Clients may pass Last-Event-ID to resume from a specific sequence.
 * - Heartbeat every 15 seconds keeps proxies from closing idle connections.
 */

import { and, asc, eq, gt, gte, inArray, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { orchestratorEvents } from '../db/schema/events.js';
import type { OrchestratorEvent } from '../db/schema/events.js';

// ============================================================
// TYPED EVENT REGISTRY
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eventRegistry = new Map<string, z.ZodSchema<any>>();

/**
 * Register an event type with its payload schema.
 * Called at module init — registration is synchronous and idempotent.
 */
function registerEventType<T extends z.ZodSchema>(type: string, payloadSchema: T): void {
  eventRegistry.set(type, payloadSchema);
}

// ============================================================
// CORE EVENT TYPE SCHEMAS
// ============================================================

// Session lifecycle events
registerEventType(
  'session.created',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    userId: z.string().min(1),
  }),
);

registerEventType(
  'session.status_changed',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    previousStatus: z.string().min(1),
    newStatus: z.string().min(1),
  }),
);

registerEventType(
  'session.completed',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    turnCount: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
);

registerEventType(
  'session.failed',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    error: z.string().min(1),
  }),
);

// Tool events
registerEventType(
  'tool.called',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.record(z.unknown()),
  }),
);

registerEventType(
  'tool.completed',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    toolName: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
  }),
);

registerEventType(
  'tool.failed',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    toolName: z.string().min(1),
    error: z.string().min(1),
  }),
);

// Agent response event
registerEventType(
  'agent.response',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    turnSequence: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
);

// Error event
registerEventType(
  'error.occurred',
  z.object({
    sessionId: z.string().optional(),
    tenantId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
);

// Context window monitoring event
registerEventType(
  'orchestrator.context_window.high_utilization',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    utilizationPct: z.number().min(0).max(1),
  }),
);

// ============================================================
// EVENT TYPE — public export
// ============================================================

/** All registered event type strings (for type-safe callers). */
export type EventType =
  | 'session.created'
  | 'session.status_changed'
  | 'session.completed'
  | 'session.failed'
  | 'tool.called'
  | 'tool.completed'
  | 'tool.failed'
  | 'agent.response'
  | 'error.occurred'
  | 'orchestrator.context_window.high_utilization';

// ============================================================
// QUERY FILTERS
// ============================================================

export interface EventQueryFilters {
  /** Narrow results to a specific session. */
  sessionId?: string;
  /** Filter to one or more event types. */
  types?: string[];
  /** Only include events created at or after this date. */
  since?: Date;
  /** Only include events with sequence > afterSequence (cursor pagination). */
  afterSequence?: number;
  /** Maximum number of events to return (default: 100). */
  limit?: number;
}

export interface EventSseFilters {
  /** Only stream events for this session. */
  sessionId?: string;
  /** Only stream these event types. */
  types?: string[];
  /**
   * Resume from this sequence number.
   * Corresponds to the HTTP header `Last-Event-ID`.
   * On connection, events since this sequence are replayed, then live polling begins.
   */
  lastEventId?: number;
}

// ============================================================
// EVENT ERROR
// ============================================================

export class UnregisteredEventTypeError extends Error {
  constructor(type: string) {
    super(
      `Event type "${type}" is not registered. Register it with registerEventType() before emitting.`,
    );
    this.name = 'UnregisteredEventTypeError';
  }
}

export class EventPayloadValidationError extends Error {
  constructor(type: string, cause: unknown) {
    super(`Invalid payload for event type "${type}": ${String(cause)}`);
    this.name = 'EventPayloadValidationError';
  }
}

// ============================================================
// NOTIFICATION ROUTING INTERFACE (T027)
// ============================================================

/**
 * Notification router interface.
 * The default implementation is imported from notification.service.ts.
 * Swappable for testing.
 */
export interface NotificationRouter {
  /** Route a routable event to external subscribers. Fire-and-forget. */
  route(event: OrchestratorEvent): void;
}

/** No-op router used when no notification service is configured. */
class NoopNotificationRouter implements NotificationRouter {
  route(_event: OrchestratorEvent): void {
    // intentionally empty
  }
}

// ============================================================
// EVENT SERVICE
// ============================================================

const POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

export class EventService {
  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly notificationRouter: NotificationRouter = new NoopNotificationRouter(),
  ) {}

  // ---------------------------------------------------------------------------
  // EMIT (T024, T025)
  // ---------------------------------------------------------------------------

  /**
   * Emit a typed event to the events table.
   *
   * Synchronously validates:
   * 1. The event type is registered in the registry.
   * 2. The payload matches the registered Zod schema.
   *
   * Then inserts the event and, fire-and-forget, notifies the notification router.
   *
   * APPEND-ONLY: this is the only write path. Never update or delete events.
   *
   * @param tenantId - Tenant scope. Required for all events.
   * @param type - Registered event type string.
   * @param payload - Event payload (validated against registered schema).
   * @param sessionId - Optional session scope. Null for system-level events.
   * @returns The created event including its auto-assigned sequence number.
   */
  async emitEvent(
    tenantId: string,
    type: string,
    payload: Record<string, unknown>,
    sessionId?: string,
  ): Promise<OrchestratorEvent> {
    // Synchronous registry check — throws before any DB call
    const schema = eventRegistry.get(type);
    if (!schema) {
      throw new UnregisteredEventTypeError(type);
    }

    // Synchronous payload validation
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new EventPayloadValidationError(type, parsed.error);
    }

    const [event] = await this.db
      .insert(orchestratorEvents)
      .values({
        tenantId,
        sessionId: sessionId ?? null,
        type,
        payload: parsed.data,
      })
      .returning();

    // Fire-and-forget: notification routing must NOT delay emission
    // Errors in the notification path are logged but never surface to caller
    try {
      this.notificationRouter.route(event);
    } catch (err) {
      console.error('[EventService] Notification routing error (non-fatal):', err);
    }

    return event;
  }

  // ---------------------------------------------------------------------------
  // QUERY (T025)
  // ---------------------------------------------------------------------------

  /**
   * Query events for a tenant with optional filters.
   *
   * Always tenant-scoped. Results are ordered by sequence ASC.
   * Use afterSequence for cursor-based pagination.
   */
  async queryEvents(
    tenantId: string,
    filters: EventQueryFilters = {},
  ): Promise<OrchestratorEvent[]> {
    const { sessionId, types, since, afterSequence, limit = 100 } = filters;

    const conditions = [eq(orchestratorEvents.tenantId, tenantId)];

    if (sessionId !== undefined) {
      conditions.push(eq(orchestratorEvents.sessionId, sessionId));
    }

    if (types !== undefined && types.length > 0) {
      conditions.push(inArray(orchestratorEvents.type, types));
    }

    if (since !== undefined) {
      conditions.push(gte(orchestratorEvents.createdAt, since));
    }

    if (afterSequence !== undefined) {
      conditions.push(gt(orchestratorEvents.sequence, afterSequence));
    }

    return this.db
      .select()
      .from(orchestratorEvents)
      .where(and(...conditions))
      .orderBy(asc(orchestratorEvents.sequence))
      .limit(limit);
  }

  // ---------------------------------------------------------------------------
  // REPLAY (T025)
  // ---------------------------------------------------------------------------

  /**
   * Replay all events for a tenant after a given sequence number.
   *
   * Used for SSE reconnection: clients send `Last-Event-ID` header,
   * which maps to the last sequence number they received.
   * This returns all events they missed since then.
   *
   * Results are ordered by sequence ASC (natural replay order).
   */
  async replayEvents(tenantId: string, fromSequence: number): Promise<OrchestratorEvent[]> {
    return this.db
      .select()
      .from(orchestratorEvents)
      .where(
        and(
          eq(orchestratorEvents.tenantId, tenantId),
          gt(orchestratorEvents.sequence, fromSequence),
        ),
      )
      .orderBy(asc(orchestratorEvents.sequence));
  }

  // ---------------------------------------------------------------------------
  // SSE SUBSCRIPTION (T026)
  // ---------------------------------------------------------------------------

  /**
   * Handle an SSE subscription request from an external consumer.
   *
   * Protocol:
   * 1. Sets SSE response headers.
   * 2. If `lastEventId` is provided, replays all missed events first.
   * 3. Polls for new events every 1 second.
   * 4. Sends heartbeat comments every 15 seconds.
   * 5. Cleans up all timers when client disconnects.
   *
   * SSE event format:
   *   id: {sequence}\n
   *   event: {type}\n
   *   data: {JSON payload}\n
   *   \n
   *
   * Routes should call this and return — do not write to res after calling.
   *
   * @param tenantId - Tenant scope. Only events for this tenant are sent.
   * @param req - Express request (used to detect client disconnect).
   * @param res - Express response (SSE stream target).
   * @param filters - Optional event filters and resume cursor.
   */
  async handleSseSubscription(
    tenantId: string,
    req: Request,
    res: Response,
    filters: EventSseFilters = {},
  ): Promise<void> {
    const { sessionId, types, lastEventId } = filters;

    // — Open SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    let closed = false;
    let lastSeenSequence = lastEventId ?? 0;

    // — Cleanup: called on client disconnect OR server-side close
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    req.on('close', cleanup);

    // — Write a single SSE event to the response
    const writeEvent = (event: OrchestratorEvent): void => {
      if (closed) return;
      // SSE format: id / event / data / blank line
      const chunk =
        `id: ${event.sequence}\n` +
        `event: ${event.type}\n` +
        `data: ${JSON.stringify(event.payload)}\n` +
        `\n`;
      res.write(chunk);
      lastSeenSequence = event.sequence;
    };

    // — Phase 1: Replay missed events (if lastEventId provided)
    if (lastEventId !== undefined && lastEventId > 0) {
      try {
        const missed = await this.replayEvents(tenantId, lastEventId);
        for (const event of missed) {
          if (closed) return;
          if (this.matchesFilters(event, sessionId, types)) {
            writeEvent(event);
          }
        }
      } catch (err) {
        console.error('[EventService] SSE replay error:', err);
        if (!closed) {
          res.write(`: replay error\n\n`);
        }
      }
    }

    if (closed) return;

    // — Phase 2: Heartbeat timer
    heartbeatTimer = setInterval(() => {
      if (!closed) {
        res.write(': heartbeat\n\n');
      }
    }, HEARTBEAT_INTERVAL_MS);

    // — Phase 3: Polling loop (1-second intervals)
    // Captures lastSeenSequence from closure — advances after each batch
    const poll = async (): Promise<void> => {
      if (closed) return;

      try {
        const conditions: SQL[] = [
          eq(orchestratorEvents.tenantId, tenantId),
          gt(orchestratorEvents.sequence, lastSeenSequence),
        ];

        if (sessionId !== undefined) {
          conditions.push(eq(orchestratorEvents.sessionId, sessionId));
        }

        if (types !== undefined && types.length > 0) {
          conditions.push(inArray(orchestratorEvents.type, types));
        }

        const newEvents = await this.db
          .select()
          .from(orchestratorEvents)
          .where(and(...conditions))
          .orderBy(asc(orchestratorEvents.sequence))
          .limit(100);

        for (const event of newEvents) {
          if (closed) return;
          writeEvent(event);
        }
      } catch (err) {
        console.error('[EventService] SSE poll error:', err);
      }
    };

    pollTimer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private matchesFilters(
    event: OrchestratorEvent,
    sessionId: string | undefined,
    types: string[] | undefined,
  ): boolean {
    if (sessionId !== undefined && event.sessionId !== sessionId) return false;
    if (types !== undefined && types.length > 0 && !types.includes(event.type)) return false;
    return true;
  }
}

// ============================================================
// RE-EXPORT REGISTRY FOR EXTENSION (e.g. WP05, tests)
// ============================================================

/**
 * Register an additional event type with its payload schema.
 *
 * This function is exported so that other WPs can register domain-specific
 * event types without modifying this file. Callers must import this and
 * call it before any emitEvent() calls for the new type.
 */
export { registerEventType };
