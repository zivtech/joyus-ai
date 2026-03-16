/**
 * Event Adapter — Cron Scheduler Service
 *
 * Polls for due scheduled tasks and fires them by buffering a webhook event.
 * Uses self-correcting setTimeout recursion (NOT setInterval) to avoid drift.
 *
 * Subtasks: T029, T030, T031, T032, T033
 */

import { parseExpression } from 'cron-parser';
import { and, eq, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { eventScheduledTasks } from '../schema.js';
import type { EventScheduledTask } from '../schema.js';
import type { LifecycleState, ScheduleMetadata } from '../types.js';
import { SCHEDULER_POLL_INTERVAL_MS } from '../types.js';
import { bufferEvent } from './event-buffer.js';

// ============================================================
// T029 — CRON EXPRESSION UTILITIES
// ============================================================

/**
 * Validate a cron expression (5-field standard: min hour dom mon dow).
 * Returns true if the expression parses without error.
 */
export function validateCronExpression(expression: string): boolean {
  if (!expression || !expression.trim()) return false;
  // Enforce exactly 5 fields (standard cron: min hour dom mon dow).
  // cron-parser v4 is permissive about field counts, so we check before parsing.
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  try {
    parseExpression(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute the next fire time for a cron expression relative to a given date.
 * Returns null if the expression is invalid or has no future occurrences.
 *
 * @param expression - Standard 5-field cron expression
 * @param fromDate   - Reference date (defaults to now)
 * @param timezone   - IANA timezone string (defaults to 'UTC')
 */
export function computeNextFireAt(
  expression: string,
  fromDate: Date = new Date(),
  timezone = 'UTC',
): Date | null {
  try {
    const interval = parseExpression(expression, {
      currentDate: fromDate,
      tz: timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

/**
 * Check whether a string is a valid IANA timezone identifier.
 * Uses Intl.DateTimeFormat which throws on unknown timezone strings.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// T030 — SCHEDULER SERVICE
// ============================================================

export interface SchedulerServiceConfig {
  /** Poll interval in ms. Defaults to SCHEDULER_POLL_INTERVAL_MS (30 000). */
  pollIntervalMs?: number;
}

/**
 * SchedulerService polls the database for due scheduled tasks and fires them.
 *
 * Usage:
 *   const svc = new SchedulerService(db);
 *   svc.start();
 *   // on shutdown:
 *   svc.stop();
 */
export class SchedulerService {
  private readonly db: NodePgDatabase<Record<string, unknown>>;
  private readonly pollIntervalMs: number;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Timestamp of the last completed poll tick.
   * Exposed as a public property so health endpoints (WP09) can read it.
   */
  public lastTickAt: Date | null = null;

  constructor(
    db: NodePgDatabase<Record<string, unknown>>,
    config: SchedulerServiceConfig = {},
  ) {
    this.db = db;
    this.pollIntervalMs = config.pollIntervalMs ?? SCHEDULER_POLL_INTERVAL_MS;
  }

  /**
   * Start the scheduler polling loop.
   * Calling start() while already running is a no-op.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    console.log(`[SchedulerService] Started — poll interval ${this.pollIntervalMs}ms`);
    this.scheduleNextTick(0);
  }

  /**
   * Stop the scheduler polling loop.
   * In-flight poll operations are allowed to finish.
   */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[SchedulerService] Stopped');
  }

  // ============================================================
  // INTERNAL POLLING LOOP
  // ============================================================

  /**
   * Schedule the next tick with self-correcting delay.
   * Subtracts elapsed time from the nominal interval to compensate for
   * time spent inside the tick handler.
   */
  private scheduleNextTick(delayMs: number): void {
    this.timer = setTimeout(async () => {
      if (!this.running) return;

      const tickStart = Date.now();

      try {
        await this.tick();
      } catch (err) {
        console.error('[SchedulerService] Uncaught error during tick:', err);
      }

      this.lastTickAt = new Date();

      if (!this.running) return;

      const elapsed = Date.now() - tickStart;
      const nextDelay = Math.max(0, this.pollIntervalMs - elapsed);
      this.scheduleNextTick(nextDelay);
    }, delayMs);
  }

  /**
   * Execute one poll: find all active tasks with next_fire_at <= now and fire each.
   */
  private async tick(): Promise<void> {
    const now = new Date();

    const dueTasks = await this.db
      .select()
      .from(eventScheduledTasks)
      .where(
        and(
          eq(eventScheduledTasks.lifecycleState, 'active'),
          lte(eventScheduledTasks.nextFireAt, now),
        ),
      );

    if (dueTasks.length === 0) return;

    console.log(`[SchedulerService] Tick found ${dueTasks.length} due task(s)`);

    await Promise.allSettled(
      dueTasks.map((task) => this.processTask(task, now)),
    );
  }

  // ============================================================
  // T032 — FIRE SCHEDULE
  // ============================================================

  /**
   * Fire a single scheduled task: buffer the event, then advance next_fire_at.
   * If bufferEvent fails, the error propagates to the Promise.allSettled caller
   * (no silent swallow). If advanceNextFireAt fails after a successful buffer,
   * the event is already persisted — acceptable per spec.
   */
  private async processTask(task: EventScheduledTask, firedAt: Date): Promise<void> {
    try {
      await this.fireSchedule(task, firedAt);
    } catch (err) {
      console.error(`[SchedulerService] Failed to fire schedule ${task.id} (${task.name}):`, err);
      throw err;
    }

    try {
      await this.advanceNextFireAt(task);
    } catch (err) {
      console.error(
        `[SchedulerService] Failed to advance next_fire_at for schedule ${task.id} — event already buffered:`,
        err,
      );
      // Do not rethrow: event was buffered successfully.
    }
  }

  /**
   * Create a webhook_event via bufferEvent with sourceType = 'schedule'.
   */
  private async fireSchedule(task: EventScheduledTask, firedAt: Date): Promise<void> {
    const scheduledFireTime = task.nextFireAt?.toISOString() ?? firedAt.toISOString();

    const scheduleMetadata: ScheduleMetadata = {
      cronExpression: task.cronExpression,
      timezone: task.timezone,
      scheduledFireTime,
      actualFireTime: firedAt.toISOString(),
    };

    await bufferEvent(this.db, {
      tenantId: task.tenantId,
      sourceType: 'schedule',
      scheduleId: task.id,
      payload: {
        triggerType: task.triggerType,
        targetPipelineId: task.targetPipelineId,
        triggerMetadata: task.triggerMetadata,
        scheduleMetadata,
      },
      signatureValid: true,
    });

    console.log(
      `[SchedulerService] Fired schedule ${task.id} (${task.name}) at ${firedAt.toISOString()}`,
    );
  }

  // ============================================================
  // T031 — ADVANCE NEXT FIRE AT
  // ============================================================

  /**
   * Compute and persist the next fire time after a task has fired.
   * Also updates last_fired_at.
   */
  private async advanceNextFireAt(task: EventScheduledTask): Promise<void> {
    const nextFireAt = computeNextFireAt(task.cronExpression, new Date(), task.timezone);

    await this.db
      .update(eventScheduledTasks)
      .set({
        lastFiredAt: new Date(),
        nextFireAt: nextFireAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(eventScheduledTasks.id, task.id));
  }
}

// ============================================================
// T033 — LIFECYCLE MANAGEMENT
// ============================================================

/**
 * Pause an active schedule. Records who paused it.
 * Returns the updated task, or null if not found / already paused.
 */
export async function pauseSchedule(
  db: NodePgDatabase<Record<string, unknown>>,
  scheduleId: string,
  pausedBy: string,
): Promise<EventScheduledTask | null> {
  const [updated] = await db
    .update(eventScheduledTasks)
    .set({
      lifecycleState: 'paused',
      pausedBy,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventScheduledTasks.id, scheduleId),
        eq(eventScheduledTasks.lifecycleState, 'active'),
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Resume a paused schedule.
 * Recomputes next_fire_at from the current time — no backfill of missed ticks.
 * Returns the updated task, or null if not found / not paused.
 */
export async function resumeSchedule(
  db: NodePgDatabase<Record<string, unknown>>,
  scheduleId: string,
): Promise<EventScheduledTask | null> {
  // Fetch the task first to get cronExpression + timezone for recompute.
  const [task] = await db
    .select()
    .from(eventScheduledTasks)
    .where(
      and(
        eq(eventScheduledTasks.id, scheduleId),
        eq(eventScheduledTasks.lifecycleState, 'paused'),
      ),
    );

  if (!task) return null;

  const nextFireAt = computeNextFireAt(task.cronExpression, new Date(), task.timezone);

  const [updated] = await db
    .update(eventScheduledTasks)
    .set({
      lifecycleState: 'active',
      pausedBy: null,
      nextFireAt: nextFireAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(eventScheduledTasks.id, scheduleId))
    .returning();

  return updated ?? null;
}

/**
 * Disable a schedule (active or paused → disabled).
 * A disabled schedule cannot fire and cannot be resumed directly.
 */
export async function disableSchedule(
  db: NodePgDatabase<Record<string, unknown>>,
  scheduleId: string,
): Promise<EventScheduledTask | null> {
  const allowedStates: LifecycleState[] = ['active', 'paused'];

  // Drizzle doesn't support inArray with enums in all adapters easily;
  // use two separate updates via a single OR-less approach: fetch then update.
  const [task] = await db
    .select()
    .from(eventScheduledTasks)
    .where(eq(eventScheduledTasks.id, scheduleId));

  if (!task) return null;

  const currentState = task.lifecycleState as LifecycleState;
  if (!allowedStates.includes(currentState)) return null;

  const [updated] = await db
    .update(eventScheduledTasks)
    .set({
      lifecycleState: 'disabled',
      updatedAt: new Date(),
    })
    .where(eq(eventScheduledTasks.id, scheduleId))
    .returning();

  return updated ?? null;
}
