/**
 * Task Management Routes
 *
 * API and UI for managing scheduled tasks.
 */

import { eq, and, desc } from 'drizzle-orm';
import { Router, Request, Response } from 'express';
import cron from 'node-cron';

import { db, scheduledTasks, taskRuns, type TaskType } from '../db/client.js';
import { requireSession, requireSessionOrRedirect } from '../auth/middleware.js';

import { sendTestNotification } from './notifications.js';

import { scheduleTask, unscheduleTask, runTask, reloadTask, getSchedulerStatus } from './index.js';

export const taskRouter = Router();

// ============================================================
// Task Management UI
// ============================================================

taskRouter.get('/', requireSessionOrRedirect, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const tasks = await db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.userId, userId))
    .orderBy(desc(scheduledTasks.createdAt));

  // Get recent runs for each task
  const tasksWithRuns = await Promise.all(
    tasks.map(async (task) => {
      const runs = await db
        .select()
        .from(taskRuns)
        .where(eq(taskRuns.taskId, task.id))
        .orderBy(desc(taskRuns.startedAt))
        .limit(5);
      return { ...task, runs };
    })
  );

  const schedulerStatus = getSchedulerStatus();

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Scheduled Tasks - Joyus AI</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 900px; margin: 50px auto; padding: 20px; }
        h1 { color: #1a1a2e; }
        .btn { display: inline-block; padding: 8px 16px; background: #0066cc; color: white; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; margin: 2px; }
        .btn:hover { background: #0052a3; }
        .btn-danger { background: #dc3545; }
        .btn-danger:hover { background: #c82333; }
        .btn-success { background: #28a745; }
        .btn-secondary { background: #6c757d; }
        .task-card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; }
        .task-header { display: flex; justify-content: space-between; align-items: center; }
        .task-name { font-weight: bold; font-size: 18px; }
        .task-schedule { color: #666; font-family: monospace; }
        .task-status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        .status-enabled { background: #d4edda; color: #155724; }
        .status-disabled { background: #f8d7da; color: #721c24; }
        .task-runs { margin-top: 12px; font-size: 14px; }
        .run-success { color: #28a745; }
        .run-failed { color: #dc3545; }
        .info-box { background: #f0f4ff; padding: 16px; border-radius: 8px; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); }
        .modal-content { background: white; margin: 50px auto; padding: 20px; max-width: 600px; border-radius: 8px; }
        .form-group { margin: 12px 0; }
        .form-group label { display: block; margin-bottom: 4px; font-weight: bold; }
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        .back-link { margin-bottom: 20px; display: block; }
      </style>
    </head>
    <body>
      <a href="/auth" class="back-link">← Back to Dashboard</a>

      <h1>🕐 Scheduled Tasks</h1>

      <div class="info-box">
        <strong>Scheduler Status:</strong> ${schedulerStatus.activeTaskCount} active tasks
      </div>

      <button class="btn" onclick="document.getElementById('newTaskModal').style.display='block'">+ New Task</button>

      ${tasksWithRuns.length === 0 ? '<p>No scheduled tasks yet. Create one to get started!</p>' : ''}

      ${tasksWithRuns.map((task) => `
        <div class="task-card">
          <div class="task-header">
            <div>
              <span class="task-name">${task.name}</span>
              <span class="task-status ${task.enabled ? 'status-enabled' : 'status-disabled'}">
                ${task.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div>
              <button class="btn btn-secondary" onclick="runTaskNow('${task.id}')">Run Now</button>
              <a href="/tasks/${task.id}/edit" class="btn">Edit</a>
              <form method="POST" action="/tasks/${task.id}/toggle" style="display:inline">
                <button class="btn ${task.enabled ? 'btn-danger' : 'btn-success'}">
                  ${task.enabled ? 'Disable' : 'Enable'}
                </button>
              </form>
            </div>
          </div>

          <p>${task.description || 'No description'}</p>

          <table>
            <tr>
              <td><strong>Type:</strong> ${task.taskType.replace(/_/g, ' ')}</td>
              <td><strong>Schedule:</strong> <code>${task.schedule}</code></td>
              <td><strong>Timezone:</strong> ${task.timezone}</td>
            </tr>
            <tr>
              <td><strong>Last Run:</strong> ${task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : 'Never'}</td>
              <td><strong>Next Run:</strong> ${task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : 'N/A'}</td>
              <td>
                <strong>Notify:</strong>
                ${task.notifySlack ? `Slack: ${task.notifySlack}` : ''}
                ${task.notifyEmail ? `Email: ${task.notifyEmail}` : ''}
                ${!task.notifySlack && !task.notifyEmail ? 'None' : ''}
              </td>
            </tr>
          </table>

          ${task.runs.length > 0 ? `
            <div class="task-runs">
              <strong>Recent Runs:</strong>
              ${task.runs.map((run) => `
                <span class="${run.status === 'COMPLETED' ? 'run-success' : run.status === 'FAILED' ? 'run-failed' : ''}">
                  ${run.status} (${run.duration || 0}ms) - ${new Date(run.startedAt).toLocaleString()}
                </span>
              `).join(' | ')}
            </div>
          ` : ''}
        </div>
      `).join('')}

      <!-- New Task Modal -->
      <div id="newTaskModal" class="modal">
        <div class="modal-content">
          <h2>Create New Scheduled Task</h2>
          <form method="POST" action="/tasks/create">
            <div class="form-group">
              <label>Task Name</label>
              <input type="text" name="name" required placeholder="Daily Standup Summary">
            </div>

            <div class="form-group">
              <label>Description</label>
              <textarea name="description" rows="2" placeholder="What does this task do?"></textarea>
            </div>

            <div class="form-group">
              <label>Task Type</label>
              <select name="taskType" required>
                <optgroup label="Jira">
                  <option value="JIRA_STANDUP_SUMMARY">Standup Summary</option>
                  <option value="JIRA_OVERDUE_ALERT">Overdue Alert</option>
                  <option value="JIRA_SPRINT_REPORT">Sprint Report</option>
                </optgroup>
                <optgroup label="Slack">
                  <option value="SLACK_CHANNEL_DIGEST">Channel Digest</option>
                  <option value="SLACK_MENTIONS_SUMMARY">Mentions Summary</option>
                </optgroup>
                <optgroup label="GitHub">
                  <option value="GITHUB_PR_REMINDER">PR Reminder</option>
                  <option value="GITHUB_STALE_PR_ALERT">Stale PR Alert</option>
                  <option value="GITHUB_RELEASE_NOTES">Release Notes</option>
                </optgroup>
                <optgroup label="Google">
                  <option value="GMAIL_DIGEST">Email Digest</option>
                </optgroup>
                <optgroup label="Multi-Service">
                  <option value="WEEKLY_STATUS_REPORT">Weekly Status Report</option>
                </optgroup>
              </select>
            </div>

            <div class="form-group">
              <label>Schedule (Cron Expression)</label>
              <input type="text" name="schedule" required placeholder="0 9 * * 1-5" title="Example: 0 9 * * 1-5 = 9am weekdays">
              <small>Examples: <code>0 9 * * 1-5</code> (9am weekdays), <code>0 8 * * 1</code> (8am Monday)</small>
            </div>

            <div class="form-group">
              <label>Timezone</label>
              <select name="timezone">
                <option value="America/New_York">Eastern (New York)</option>
                <option value="America/Chicago">Central (Chicago)</option>
                <option value="America/Denver">Mountain (Denver)</option>
                <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>

            <div class="form-group">
              <label>Configuration (JSON)</label>
              <textarea name="config" rows="4" placeholder='{"project": "PROJ"}'>{}</textarea>
              <small>Task-specific config. See docs for options per task type.</small>
            </div>

            <div class="form-group">
              <label>Notify on Success (Slack channel)</label>
              <input type="text" name="notifySlack" placeholder="#general">
            </div>

            <div class="form-group">
              <label>Notify on Error (Email)</label>
              <input type="email" name="notifyEmail" placeholder="you@example.com">
            </div>

            <button type="submit" class="btn">Create Task</button>
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('newTaskModal').style.display='none'">Cancel</button>
          </form>
        </div>
      </div>

      <script>
        async function runTaskNow(taskId) {
          if (!confirm('Run this task now?')) return;
          const response = await fetch('/tasks/' + taskId + '/run', { method: 'POST' });
          if (response.ok) {
            alert('Task started!');
            location.reload();
          } else {
            alert('Failed to start task');
          }
        }
      </script>
    </body>
    </html>
  `);
});

// ============================================================
// Task CRUD Operations
// ============================================================

taskRouter.post('/create', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const { name, description, taskType, schedule, timezone, config, notifySlack, notifyEmail } = req.body;

  // Validate cron expression
  if (!cron.validate(schedule)) {
    return res.status(400).send('Invalid cron expression');
  }

  // Parse config JSON
  let parsedConfig = {};
  try {
    parsedConfig = config ? JSON.parse(config) : {};
  } catch {
    return res.status(400).send('Invalid JSON in configuration');
  }

  const [task] = await db
    .insert(scheduledTasks)
    .values({
      userId,
      name,
      description,
      taskType: taskType as TaskType,
      schedule,
      timezone: timezone || 'America/New_York',
      config: parsedConfig,
      notifySlack: notifySlack || null,
      notifyEmail: notifyEmail || null,
      enabled: true
    })
    .returning();

  // Schedule the task
  try {
    scheduleTask(task);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('Failed to schedule task:', message);
  }

  res.redirect('/tasks');
});

taskRouter.post('/:id/toggle', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const [task] = await db
    .select()
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.id, req.params.id),
        eq(scheduledTasks.userId, userId)
      )
    )
    .limit(1);

  if (!task) return res.status(404).send('Task not found');

  await db
    .update(scheduledTasks)
    .set({ enabled: !task.enabled, updatedAt: new Date() })
    .where(eq(scheduledTasks.id, task.id));

  await reloadTask(task.id);

  res.redirect('/tasks');
});

taskRouter.post('/:id/run', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const [task] = await db
    .select()
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.id, req.params.id),
        eq(scheduledTasks.userId, userId)
      )
    )
    .limit(1);

  if (!task) return res.status(404).send('Task not found');

  // Run in background
  runTask(task.id).catch(e => console.error('Task run failed:', e));

  res.json({ success: true, message: 'Task started' });
});

taskRouter.post('/:id/delete', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const [task] = await db
    .select()
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.id, req.params.id),
        eq(scheduledTasks.userId, userId)
      )
    )
    .limit(1);

  if (!task) return res.status(404).send('Task not found');

  unscheduleTask(task.id);

  await db
    .delete(scheduledTasks)
    .where(eq(scheduledTasks.id, task.id));

  res.redirect('/tasks');
});

taskRouter.get('/:id/edit', requireSessionOrRedirect, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const [task] = await db
    .select()
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.id, req.params.id),
        eq(scheduledTasks.userId, userId)
      )
    )
    .limit(1);

  if (!task) return res.status(404).send('Task not found');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Edit Task - Joyus AI</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .form-group { margin: 12px 0; }
        .form-group label { display: block; margin-bottom: 4px; font-weight: bold; }
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        .btn { display: inline-block; padding: 10px 20px; background: #0066cc; color: white; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; margin: 4px; }
        .btn:hover { background: #0052a3; }
        .btn-danger { background: #dc3545; }
      </style>
    </head>
    <body>
      <h1>Edit Task: ${task.name}</h1>

      <form method="POST" action="/tasks/${task.id}/update">
        <div class="form-group">
          <label>Task Name</label>
          <input type="text" name="name" value="${task.name}" required>
        </div>

        <div class="form-group">
          <label>Description</label>
          <textarea name="description" rows="2">${task.description || ''}</textarea>
        </div>

        <div class="form-group">
          <label>Schedule (Cron Expression)</label>
          <input type="text" name="schedule" value="${task.schedule}" required>
        </div>

        <div class="form-group">
          <label>Timezone</label>
          <select name="timezone">
            <option value="America/New_York" ${task.timezone === 'America/New_York' ? 'selected' : ''}>Eastern</option>
            <option value="America/Chicago" ${task.timezone === 'America/Chicago' ? 'selected' : ''}>Central</option>
            <option value="America/Denver" ${task.timezone === 'America/Denver' ? 'selected' : ''}>Mountain</option>
            <option value="America/Los_Angeles" ${task.timezone === 'America/Los_Angeles' ? 'selected' : ''}>Pacific</option>
            <option value="UTC" ${task.timezone === 'UTC' ? 'selected' : ''}>UTC</option>
          </select>
        </div>

        <div class="form-group">
          <label>Configuration (JSON)</label>
          <textarea name="config" rows="4">${JSON.stringify(task.config, null, 2)}</textarea>
        </div>

        <div class="form-group">
          <label>Notify on Success (Slack channel)</label>
          <input type="text" name="notifySlack" value="${task.notifySlack || ''}" placeholder="#general">
        </div>

        <div class="form-group">
          <label>Notify on Error (Email)</label>
          <input type="email" name="notifyEmail" value="${task.notifyEmail || ''}" placeholder="you@example.com">
        </div>

        <button type="submit" class="btn">Save Changes</button>
        <a href="/tasks" class="btn" style="background:#6c757d">Cancel</a>
      </form>

      <hr style="margin: 30px 0">

      <form method="POST" action="/tasks/${task.id}/delete" onsubmit="return confirm('Delete this task?')">
        <button type="submit" class="btn btn-danger">Delete Task</button>
      </form>
    </body>
    </html>
  `);
});

taskRouter.post('/:id/update', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const [task] = await db
    .select()
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.id, req.params.id),
        eq(scheduledTasks.userId, userId)
      )
    )
    .limit(1);

  if (!task) return res.status(404).send('Task not found');

  const { name, description, schedule, timezone, config, notifySlack, notifyEmail } = req.body;

  // Validate cron
  if (!cron.validate(schedule)) {
    return res.status(400).send('Invalid cron expression');
  }

  // Parse config
  let parsedConfig = {};
  try {
    parsedConfig = config ? JSON.parse(config) : {};
  } catch {
    return res.status(400).send('Invalid JSON in configuration');
  }

  await db
    .update(scheduledTasks)
    .set({
      name,
      description,
      schedule,
      timezone,
      config: parsedConfig,
      notifySlack: notifySlack || null,
      notifyEmail: notifyEmail || null,
      updatedAt: new Date()
    })
    .where(eq(scheduledTasks.id, task.id));

  await reloadTask(task.id);

  res.redirect('/tasks');
});

// ============================================================
// API Endpoints
// ============================================================

taskRouter.get('/api/status', async (req: Request, res: Response) => {
  const status = getSchedulerStatus();
  res.json(status);
});

taskRouter.post('/api/test-notification', requireSession, async (req: Request, res: Response) => {
  const userId = req.session!.userId!;

  const { channel, destination } = req.body;

  const result = await sendTestNotification(userId, channel, destination);
  res.json(result);
});
