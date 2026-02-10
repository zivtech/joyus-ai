/**
 * MCP Token Verification
 * Verifies Bearer tokens for MCP requests
 */

import { eq, and } from 'drizzle-orm';

import { db, users, connections, type Service } from '../db/client.js';

interface UserWithConnections {
  id: string;
  email: string;
  name: string | null;
  connections: {
    service: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    metadata: unknown;
  }[];
}

/**
 * Verify an MCP token and return the user if valid
 */
export async function verifyMcpToken(token: string): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.mcpToken, token))
    .limit(1);
  return !!user;
}

/**
 * Get user from MCP token with their connections
 */
export async function getUserFromToken(token: string): Promise<UserWithConnections | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.mcpToken, token))
    .limit(1);

  if (!user) return null;

  const userConnections = await db
    .select()
    .from(connections)
    .where(eq(connections.userId, user.id));

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    connections: userConnections.map((c) => ({
      service: c.service,
      accessToken: c.accessToken,
      refreshToken: c.refreshToken,
      expiresAt: c.expiresAt,
      metadata: c.metadata
    }))
  };
}

/**
 * Get a specific service connection for a user
 */
export async function getConnection(userId: string, service: string) {
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.userId, userId),
        eq(connections.service, service as Service)
      )
    )
    .limit(1);
  return connection || null;
}

/**
 * Check if a token needs refresh (expires within 5 minutes)
 */
export function needsRefresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  const fiveMinutes = 5 * 60 * 1000;
  return expiresAt.getTime() - Date.now() < fiveMinutes;
}
