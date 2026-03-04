/**
 * Notification System
 *
 * Sends task results via Slack or Email based on task configuration.
 */

import axios from 'axios';
import { eq, and } from 'drizzle-orm';

import { db, connections, taskRuns, type ScheduledTask } from '../db/client.js';
import { decryptToken } from '../db/encryption.js';

interface TaskForNotification {
  userId: string;
  name: string;
  notifySlack?: string | null;
  notifyEmail?: string | null;
}

/**
 * Send notification for a completed task
 */
export async function sendNotification(
  task: TaskForNotification,
  runId: string,
  status: 'success' | 'error',
  result: unknown,
  errorMessage?: string
): Promise<void> {
  const promises: Promise<void>[] = [];

  // Send to Slack if configured
  if (task.notifySlack) {
    promises.push(sendSlackNotification(task, runId, status, result, errorMessage));
  }

  // Send email if configured
  if (task.notifyEmail) {
    promises.push(sendEmailNotification(task, runId, status, result, errorMessage));
  }

  try {
    await Promise.all(promises);

    // Mark as notified
    await db
      .update(taskRuns)
      .set({ notified: true, notifiedAt: new Date() })
      .where(eq(taskRuns.id, runId));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to send notifications for task ${task.name}:`, message);
  }
}

/**
 * Send notification to Slack channel
 */
async function sendSlackNotification(
  task: TaskForNotification,
  _runId: string,
  status: 'success' | 'error',
  result: unknown,
  errorMessage?: string
): Promise<void> {
  // Get user's Slack connection
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.userId, task.userId),
        eq(connections.service, 'SLACK')
      )
    )
    .limit(1);

  if (!connection) {
    console.warn(`No Slack connection for user ${task.userId}, skipping notification`);
    return;
  }

  const accessToken = decryptToken(connection.accessToken);
  const channel = task.notifySlack;

  // Build message
  type SlackBlock = {
    type: string;
    text?: { type: string; text: string; emoji?: boolean };
    elements?: { type: string; text: string }[];
  };

  let blocks: SlackBlock[] = [];
  const resultObj = result as { markdown?: string; title?: string } | null;

  if (status === 'success') {
    blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `✅ ${task.name}`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: resultObj?.markdown || resultObj?.title || 'Task completed successfully'
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Scheduled task completed at ${new Date().toLocaleString()}`
          }
        ]
      }
    ];
  } else {
    blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `❌ ${task.name} Failed`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:* ${errorMessage || 'Unknown error'}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Failed at ${new Date().toLocaleString()}`
          }
        ]
      }
    ];
  }

  // Send to Slack
  try {
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel,
      blocks,
      text: status === 'success' ? `✅ ${task.name} completed` : `❌ ${task.name} failed`
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error: unknown) {
    const axiosError = error as { response?: { data?: unknown }; message?: string };
    console.error(`Failed to send Slack notification:`, axiosError.response?.data || axiosError.message);
    throw error;
  }
}

/**
 * Send notification via email (using Gmail)
 */
async function sendEmailNotification(
  task: TaskForNotification,
  _runId: string,
  status: 'success' | 'error',
  result: unknown,
  errorMessage?: string
): Promise<void> {
  // Get user's Google connection
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.userId, task.userId),
        eq(connections.service, 'GOOGLE')
      )
    )
    .limit(1);

  if (!connection) {
    console.warn(`No Google connection for user ${task.userId}, skipping email notification`);
    return;
  }

  const accessToken = decryptToken(connection.accessToken);
  const to = task.notifyEmail;

  // Build email
  const subject = status === 'success'
    ? `✅ Scheduled Task: ${task.name}`
    : `❌ Scheduled Task Failed: ${task.name}`;

  const resultObj = result as { markdown?: string; title?: string } | null;
  let body: string;

  if (status === 'success') {
    body = `
Scheduled Task Report: ${task.name}

${resultObj?.markdown || resultObj?.title || 'Task completed successfully'}

---
This is an automated message from Joyus AI.
Task executed at: ${new Date().toLocaleString()}
    `.trim();
  } else {
    body = `
Scheduled Task Failed: ${task.name}

Error: ${errorMessage || 'Unknown error'}

Please check the task configuration and try again.

---
This is an automated message from Joyus AI.
Task failed at: ${new Date().toLocaleString()}
    `.trim();
  }

  // Create email in RFC 2822 format
  const email = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body
  ].join('\r\n');

  const encodedEmail = Buffer.from(email).toString('base64url');

  // Send via Gmail API
  try {
    await axios.post(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      { raw: encodedEmail },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error: unknown) {
    const axiosError = error as { response?: { data?: unknown }; message?: string };
    console.error(`Failed to send email notification:`, axiosError.response?.data || axiosError.message);
    throw error;
  }
}

/**
 * Send a test notification
 */
export async function sendTestNotification(
  userId: string,
  channel: 'slack' | 'email',
  destination: string
): Promise<{ success: boolean; error?: string }> {
  const mockTask: TaskForNotification = {
    userId,
    name: 'Test Notification',
    notifySlack: channel === 'slack' ? destination : undefined,
    notifyEmail: channel === 'email' ? destination : undefined
  };

  const mockResult = {
    title: 'Test Notification',
    markdown: '🧪 This is a test notification from Joyus AI.\n\nIf you received this, notifications are working correctly!'
  };

  try {
    if (channel === 'slack') {
      await sendSlackNotification(mockTask, 'test', 'success', mockResult);
    } else {
      await sendEmailNotification(mockTask, 'test', 'success', mockResult);
    }
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}
