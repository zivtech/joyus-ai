/**
 * Tool Executor
 * Routes tool calls to appropriate service executors
 */

import { eq, and } from 'drizzle-orm';

import { db, connections, type Service } from '../db/client.js';
import { decryptToken, encryptToken } from '../db/encryption.js';

import { executeGithubTool } from './executors/github-executor.js';
import { executeGoogleTool } from './executors/google-executor.js';
import { executeJiraTool } from './executors/jira-executor.js';
import { executeOpsTool } from './executors/ops-executor.js';
import { executeSlackTool } from './executors/slack-executor.js';

export interface ExecutorContext {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  metadata?: unknown;
}

/**
 * Execute a tool by name with the given input
 */
export async function executeTool(userId: string, toolName: string, input: Record<string, unknown>): Promise<unknown> {
  if (toolName.startsWith('ops_')) {
    return executeOpsTool(toolName, input, { userId });
  }

  // Determine which service this tool belongs to
  let service: Service;
  let executeFunction: (name: string, input: Record<string, unknown>, context: ExecutorContext) => Promise<unknown>;

  if (toolName.startsWith('jira_')) {
    service = 'JIRA';
    executeFunction = executeJiraTool;
  } else if (toolName.startsWith('slack_')) {
    service = 'SLACK';
    executeFunction = executeSlackTool;
  } else if (toolName.startsWith('github_')) {
    service = 'GITHUB';
    executeFunction = executeGithubTool;
  } else if (toolName.startsWith('gmail_') || toolName.startsWith('drive_') || toolName.startsWith('docs_')) {
    service = 'GOOGLE';
    executeFunction = executeGoogleTool;
  } else {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  // Get connection for this service
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.userId, userId),
        eq(connections.service, service)
      )
    )
    .limit(1);

  if (!connection) {
    throw new Error(`No ${service} connection found. Please connect ${service} in the Auth Portal.`);
  }

  let currentAccessToken = connection.accessToken;
  let currentExpiresAt = connection.expiresAt;

  // Check if token is expired (with 5-minute buffer)
  if (currentExpiresAt && currentExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
    // Token needs refresh
    if (connection.refreshToken) {
      const refreshedData = await refreshConnectionToken(connection);
      if (refreshedData) {
        currentAccessToken = refreshedData.accessToken;
        currentExpiresAt = refreshedData.expiresAt;
      }
    } else {
      throw new Error(`${service} token expired. Please reconnect in the Auth Portal.`);
    }
  }

  // Build executor context
  const context: ExecutorContext = {
    userId,
    accessToken: decryptToken(currentAccessToken),
    refreshToken: connection.refreshToken ? decryptToken(connection.refreshToken) : undefined,
    metadata: connection.metadata
  };

  // Execute the tool
  return executeFunction(toolName, input, context);
}

interface RefreshedTokenData {
  accessToken: string;
  expiresAt: Date | null;
}

/**
 * Refresh an expired OAuth token
 */
async function refreshConnectionToken(connection: typeof connections.$inferSelect): Promise<RefreshedTokenData | null> {
  if (!connection.refreshToken) return null;

  const refreshTokenValue = decryptToken(connection.refreshToken);

  try {
    let tokenData: { access_token: string; expires_in?: number; refresh_token?: string } | null = null;

    switch (connection.service) {
      case 'GOOGLE':
        tokenData = await refreshGoogleToken(refreshTokenValue);
        break;
      case 'JIRA':
        tokenData = await refreshJiraToken(refreshTokenValue);
        break;
      case 'SLACK':
        // Slack user tokens don't typically expire
        return null;
      case 'GITHUB':
        // GitHub tokens don't expire
        return null;
    }

    if (tokenData) {
      const newAccessToken = encryptToken(tokenData.access_token);
      const newExpiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null;

      await db
        .update(connections)
        .set({
          accessToken: newAccessToken,
          expiresAt: newExpiresAt,
          refreshToken: tokenData.refresh_token
            ? encryptToken(tokenData.refresh_token)
            : connection.refreshToken,
          updatedAt: new Date()
        })
        .where(eq(connections.id, connection.id));

      return {
        accessToken: newAccessToken,
        expiresAt: newExpiresAt
      };
    }

    return null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to refresh ${connection.service} token:`, message);
    throw new Error(`${connection.service} token refresh failed. Please reconnect.`);
  }
}

async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const axios = (await import('axios')).default;

  const response = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  return response.data;
}

async function refreshJiraToken(refreshToken: string): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const axios = (await import('axios')).default;

  const response = await axios.post('https://auth.atlassian.com/oauth/token', {
    client_id: process.env.ATLASSIAN_CLIENT_ID,
    client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  return response.data;
}
