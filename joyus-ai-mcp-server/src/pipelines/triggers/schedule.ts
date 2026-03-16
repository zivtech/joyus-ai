/**
 * Schedule Trigger Handler
 *
 * Manages cron-based scheduling for pipelines with triggerType='schedule_tick'.
 * Loads active schedules on startup, registers node-cron jobs, publishes
 * schedule_tick events to the event bus, and handles overlap detection.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { parseExpression } from 'cron-parser';
import { eq, and, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { TriggerEventType, ScheduleTriggerConfig } from '../types.js';
import type { Pipeline } from '../schema.js';
import { pipelines, pipelineExecutions } from '../schema.js';
import type { EventBus } from '../event-bus/interface.js';
import type { TriggerHandler, TriggerContext, TriggerResult } from './interface.js';

// ============================================================
// CONSTANTS
// ============================================================

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

// ============================================================
// HANDLER
// ============================================================

export class ScheduleTriggerHandler implements TriggerHandler {
  readonly triggerType: TriggerEventType = 'schedule_tick';

  private readonly activeJobs: Map<string, ScheduledTask> = new Map();

  constructor(
    private readonly db: NodePgDatabase,
    private readonly eventBus: EventBus,
  ) {}

  canHandle(eventType: TriggerEventType): boolean {
    return eventType === 'schedule_tick';
  }

  getMatchingPipelines(
    context: TriggerContext,
    activePipelines: Pipeline[],
  ): TriggerResult[] {
    const pipelineId = context.event.payload['pipelineId'];

    if (typeof pipelineId !== 'string' || !pipelineId) {
      return [];
    }

    const pipeline = activePipelines.find(
      (p) => p.id === pipelineId && p.triggerType === 'schedule_tick',
    );

    if (!pipeline) {
      return [];
    }

    return [
      {
        pipelineId: pipeline.id,
        triggerPayload: {
          sourceEvent: context.event,
          depth: context.currentDepth + 1,
        },
      },
    ];
  }

  // ============================================================
  // SCHEDULE MANAGEMENT
  // ============================================================

  async loadAllSchedules(): Promise<void> {
    const activeSchedulePipelines = await this.db
      .select()
      .from(pipelines)
      .where(
        and(
          eq(pipelines.triggerType, 'schedule_tick'),
          eq(pipelines.status, 'active'),
        ),
      );

    for (const pipeline of activeSchedulePipelines) {
      this.registerSchedule(pipeline);
    }
  }

  registerSchedule(pipeline: Pipeline): void {
    const config = pipeline.triggerConfig as ScheduleTriggerConfig;
    const { cronExpression, timezone } = config;

    // Validate cron expression
    try {
      parseExpression(cronExpression);
    } catch {
      console.error(
        `[ScheduleTrigger] Invalid cron expression for pipeline ${pipeline.id}: "${cronExpression}"`,
      );
      return;
    }

    // Validate timezone if provided
    if (timezone !== undefined) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        console.error(
          `[ScheduleTrigger] Invalid timezone for pipeline ${pipeline.id}: "${timezone}"`,
        );
        return;
      }
    }

    // Stop existing job if any
    if (this.activeJobs.has(pipeline.id)) {
      this.unregisterSchedule(pipeline.id);
    }

    const cronOptions = timezone ? { timezone } : {};

    const job = cron.schedule(
      cronExpression,
      async () => {
        await this.onTick(pipeline);
      },
      cronOptions,
    );

    this.activeJobs.set(pipeline.id, job);
  }

  unregisterSchedule(pipelineId: string): void {
    const job = this.activeJobs.get(pipelineId);
    if (job) {
      job.stop();
      this.activeJobs.delete(pipelineId);
    }
  }

  updateSchedule(pipeline: Pipeline): void {
    this.unregisterSchedule(pipeline.id);
    this.registerSchedule(pipeline);
  }

  stopAll(): void {
    for (const job of this.activeJobs.values()) {
      job.stop();
    }
    this.activeJobs.clear();
  }

  // ============================================================
  // NEXT RUN TIME
  // ============================================================

  getNextRunTime(cronExpression: string, timezone?: string): Date | null {
    try {
      const options = timezone ? { tz: timezone } : {};
      const interval = parseExpression(cronExpression, options);
      return interval.next().toDate();
    } catch {
      return null;
    }
  }

  // ============================================================
  // INTERNAL
  // ============================================================

  private async onTick(pipeline: Pipeline): Promise<void> {
    // Overlap detection: check for non-terminal executions
    const concurrencyPolicy = pipeline.concurrencyPolicy;

    if (concurrencyPolicy === 'skip_if_running') {
      const nonTerminalStatuses = ['pending', 'running', 'paused_at_gate', 'paused_on_failure'] as const;

      try {
        const running = await this.db
          .select({ id: pipelineExecutions.id })
          .from(pipelineExecutions)
          .where(
            and(
              eq(pipelineExecutions.pipelineId, pipeline.id),
              inArray(pipelineExecutions.status, [...nonTerminalStatuses]),
            ),
          )
          .limit(1);

        if (running.length > 0) {
          console.log(
            `[ScheduleTrigger] Skipping tick for pipeline ${pipeline.id} — execution ${running[0]!.id} is still running`,
          );
          return;
        }
      } catch (err) {
        console.error(
          `[ScheduleTrigger] Failed to check running executions for pipeline ${pipeline.id}:`,
          err,
        );
        // Proceed anyway on DB error to avoid silent schedule failure
      }
    }

    try {
      await this.eventBus.publish(pipeline.tenantId, 'schedule_tick', {
        pipelineId: pipeline.id,
        scheduledAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(
        `[ScheduleTrigger] Failed to publish schedule_tick for pipeline ${pipeline.id}:`,
        err,
      );
    }
  }
}
