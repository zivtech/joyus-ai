/**
 * Task Scheduler
 *
 * Manages scheduled tasks using node-cron.
 * - Loads active tasks from database on startup
 * - Executes tasks at scheduled times
 * - Handles notifications (Slack, email)
 * - Logs all executions
 */

import { parseExpression } from 'cron-parser';
import { eq } from 'drizzle-orm';
import cron from 'node-cron';

import { db, scheduledTasks, taskRuns, users, connections } from '../db/client.js';

import { sendNotification } from './notifications.js';
import { executeScheduledTask } from './task-executor.js';

// Map of active cron jobs by task ID
const activeJobs = new Map<string, cron.ScheduledTask>();

/**
 * Initialize the scheduler - load and start all active tasks
 */
export async function initializeScheduler(): Promise<void> {
  console.log('🕐 Initializing task scheduler...');

  // Load all enabled tasks
  const tasks = await db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.enabled, true));

  console.log(`   Found ${tasks.length} active scheduled tasks`);

  // Schedule each task
  for (const task of tasks) {
    try {
      scheduleTask(task);
      console.log(`   ✓ Scheduled: ${task.name} (${task.schedule})`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ✗ Failed to schedule "${task.name}": ${message}`);
    }
  }

  // Run the "next run" updater every minute
  cron.schedule('* * * * *', updateNextRunTimes);

  console.log('🕐 Task scheduler initialized');
}

/**
 * Schedule a single task
 */
export function scheduleTask(task: typeof scheduledTasks.$inferSelect): void {
  // Validate cron expression
  if (!cron.validate(task.schedule)) {
    throw new Error(`Invalid cron expression: ${task.schedule}`);
  }

  // Stop existing job if any
  if (activeJobs.has(task.id)) {
    activeJobs.get(task.id)?.stop();
    activeJobs.delete(task.id);
  }

  // Create new cron job
  const job = cron.schedule(task.schedule, async () => {
    await runTask(task.id);
  }, {
    timezone: task.timezone || 'America/New_York'
  });

  activeJobs.set(task.id, job);

  // Update next run time
  updateTaskNextRun(task.id, task.schedule, task.timezone);
}

/**
 * Unschedule a task
 */
export function unscheduleTask(taskId: string): void {
  const job = activeJobs.get(taskId);
  if (job) {
    job.stop();
    activeJobs.delete(taskId);
    console.log(`Unscheduled task: ${taskId}`);
  }
}

/**
 * Run a task immediately (for manual triggers or scheduled execution)
 */
export async function runTask(taskId: string): Promise<void> {
  // Get the task with user and connections
  const [task] = await db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.id, taskId))
    .limit(1);

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  if (!task.enabled) {
    console.log(`Task disabled, skipping: ${task.name}`);
    return;
  }

  // Get user with connections
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, task.userId))
    .limit(1);

  if (!user) {
    console.error(`User not found for task: ${taskId}`);
    return;
  }

  const userConnections = await db
    .select()
    .from(connections)
    .where(eq(connections.userId, user.id));

  console.log(`▶ Running task: ${task.name}`);

  // Create task run record
  const [run] = await db
    .insert(taskRuns)
    .values({
      taskId: task.id,
      userId: task.userId,
      status: 'RUNNING'
    })
    .returning();

  const startTime = Date.now();

  try {
    // Execute the task
    const result = await executeScheduledTask(task, { ...user, connections: userConnections });

    const duration = Date.now() - startTime;

    // Update run record with success
    await db
      .update(taskRuns)
      .set({
        status: 'COMPLETED',
        completedAt: new Date(),
        duration,
        output: result
      })
      .where(eq(taskRuns.id, run.id));

    // Update task's last run time
    await db
      .update(scheduledTasks)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(scheduledTasks.id, task.id));

    console.log(`✓ Task completed: ${task.name} (${duration}ms)`);

    // Send success notification if configured
    if (task.notifyOnSuccess) {
      await sendNotification(task, run.id, 'success', result);
    }

  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update run record with failure
    await db
      .update(taskRuns)
      .set({
        status: 'FAILED',
        completedAt: new Date(),
        duration,
        error: errorMessage
      })
      .where(eq(taskRuns.id, run.id));

    // Update task's last run time
    await db
      .update(scheduledTasks)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(scheduledTasks.id, task.id));

    console.error(`✗ Task failed: ${task.name} - ${errorMessage}`);

    // Send error notification if configured
    if (task.notifyOnError) {
      await sendNotification(task, run.id, 'error', null, errorMessage);
    }
  }
}

/**
 * Update the next run time for a task
 */
async function updateTaskNextRun(taskId: string, schedule: string, timezone: string): Promise<void> {
  try {
    const interval = parseExpression(schedule, {
      tz: timezone || 'America/New_York'
    });
    const nextRun = interval.next().toDate();

    await db
      .update(scheduledTasks)
      .set({ nextRunAt: nextRun })
      .where(eq(scheduledTasks.id, taskId));
  } catch {
    // Ignore parsing errors
  }
}

/**
 * Update next run times for all active tasks (runs every minute)
 */
async function updateNextRunTimes(): Promise<void> {
  const tasks = await db
    .select({
      id: scheduledTasks.id,
      schedule: scheduledTasks.schedule,
      timezone: scheduledTasks.timezone
    })
    .from(scheduledTasks)
    .where(eq(scheduledTasks.enabled, true));

  for (const task of tasks) {
    await updateTaskNextRun(task.id, task.schedule, task.timezone);
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): { activeTaskCount: number; taskIds: string[] } {
  return {
    activeTaskCount: activeJobs.size,
    taskIds: Array.from(activeJobs.keys())
  };
}

/**
 * Reload a task (after config change)
 */
export async function reloadTask(taskId: string): Promise<void> {
  const [task] = await db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.id, taskId))
    .limit(1);

  if (!task) {
    unscheduleTask(taskId);
    return;
  }

  if (task.enabled) {
    scheduleTask(task);
    console.log(`Reloaded task: ${task.name}`);
  } else {
    unscheduleTask(taskId);
    console.log(`Disabled task: ${task.name}`);
  }
}
