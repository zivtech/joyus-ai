/**
 * Tool Definitions Index
 * Exports all available tools and generates tool list based on user's connections
 */

import { eq } from 'drizzle-orm';

import { db, connections } from '../db/client.js';

import { githubTools } from './github-tools.js';
import { googleTools } from './google-tools.js';
import { jiraTools } from './jira-tools.js';
import { slackTools } from './slack-tools.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Get all tools available to a user based on their connected services
 */
export async function getAllTools(userId: string): Promise<ToolDefinition[]> {
  const userConnections = await db
    .select({ service: connections.service })
    .from(connections)
    .where(eq(connections.userId, userId));

  const connectedServices = new Set(userConnections.map((c) => c.service));
  const tools: ToolDefinition[] = [];

  // Google tools always available if connected
  if (connectedServices.has('GOOGLE')) {
    tools.push(...googleTools);
  }

  // Jira tools
  if (connectedServices.has('JIRA')) {
    tools.push(...jiraTools);
  }

  // Slack tools
  if (connectedServices.has('SLACK')) {
    tools.push(...slackTools);
  }

  // GitHub tools
  if (connectedServices.has('GITHUB')) {
    tools.push(...githubTools);
  }

  return tools;
}

/**
 * Check if a specific tool is available to a user
 */
export async function isToolAvailable(userId: string, toolName: string): Promise<boolean> {
  const tools = await getAllTools(userId);
  return tools.some(t => t.name === toolName);
}

export { jiraTools, slackTools, githubTools, googleTools };
