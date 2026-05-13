/**
 * Memory Service — WP02 (T020)
 *
 * Sliding window conversation memory for agent context assembly.
 *
 * Strategy: Keep the last N turns per session (default: 50). No summarization
 * or RAG — the spec's NFR-001 requires <200ms orchestrator overhead, and
 * summarization adds an LLM call (~1-2s). Start simple; instrument utilization
 * so data can justify adding summarization later.
 *
 * See research.md R3 for strategy comparison and rationale.
 */

import { and, asc, count, desc, eq, max } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { orchestratorTurns } from '../db/schema/orchestrator.js';
import type { OrchestratorTurn, NewOrchestratorTurn } from '../db/schema/orchestrator.js';
import type { TurnRole } from './types.js';

// ============================================================
// TYPES
// ============================================================

/**
 * A turn in Claude's messages array format (AI SDK v5 compatible).
 */
export interface MessageTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Input for saving a new turn.
 */
export interface SaveTurnInput {
  sessionId: string;
  tenantId: string;
  role: TurnRole;
  content?: string;
  toolCalls?: Array<Record<string, unknown>>;
  toolResults?: Array<Record<string, unknown>>;
  tokenUsage?: Record<string, number>;
}

// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

const DEFAULT_MAX_TURNS = 50;

// ============================================================
// MEMORY SERVICE
// ============================================================

export class MemoryService {
  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
  ) {}

  /**
   * Load conversation history for a session as OrchestratorTurn rows.
   * Returns turns in chronological order (ascending by sequence).
   * Applies a sliding window: only the most recent maxTurns are returned.
   *
   * @param sessionId - The session to load history for
   * @param tenantId - Tenant scope — must match the session's tenantId
   * @param maxTurns - Window size (default: 50). Only the last N turns are returned.
   */
  async loadHistory(
    sessionId: string,
    tenantId: string,
    maxTurns = DEFAULT_MAX_TURNS,
  ): Promise<OrchestratorTurn[]> {
    // Fetch the most recent N turns (DESC), then reverse to chronological order.
    // DESC + limit gives us the window. ASC return gives the agent chronological context.
    const rows = await this.db
      .select()
      .from(orchestratorTurns)
      .where(
        and(
          eq(orchestratorTurns.sessionId, sessionId),
          eq(orchestratorTurns.tenantId, tenantId),
        ),
      )
      .orderBy(desc(orchestratorTurns.sequence))
      .limit(maxTurns);

    // Reverse to chronological order for the agent
    return rows.reverse();
  }

  /**
   * Convert OrchestratorTurn rows to the messages format used by the Claude API.
   * Tool turns are flattened into the assistant message that preceded them.
   * For simplicity, only user/assistant content turns are returned as messages.
   */
  turnsToMessages(turns: OrchestratorTurn[]): MessageTurn[] {
    return turns
      .filter((t) => (t.role === 'user' || t.role === 'assistant') && t.content)
      .map((t) => ({
        role: t.role as 'user' | 'assistant',
        content: t.content!,
      }));
  }

  /**
   * Get the next sequence number for a session.
   * Uses MAX(sequence) + 1 to avoid read-then-write races.
   * Falls back to 0 for the first turn in a session.
   */
  async nextSequence(sessionId: string, tenantId: string): Promise<number> {
    const [row] = await this.db
      .select({ maxSeq: max(orchestratorTurns.sequence) })
      .from(orchestratorTurns)
      .where(
        and(
          eq(orchestratorTurns.sessionId, sessionId),
          eq(orchestratorTurns.tenantId, tenantId),
        ),
      );

    const current = row?.maxSeq ?? null;
    return current === null ? 0 : current + 1;
  }

  /**
   * Persist a single conversation turn.
   * Sequence number is computed atomically from the current max.
   *
   * NOTE: In high-throughput scenarios, two concurrent saveTurn() calls for the
   * same session could generate the same sequence number. The DB schema has a
   * uniqueIndex on (sessionId, sequence) which will surface this as a constraint
   * violation. The agent loop is sequential per session (single Inngest run),
   * so this race should not occur in practice.
   */
  async saveTurn(input: SaveTurnInput): Promise<OrchestratorTurn> {
    const sequence = await this.nextSequence(input.sessionId, input.tenantId);

    const row: NewOrchestratorTurn = {
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      sequence,
      role: input.role,
      content: input.content ?? null,
      toolCalls: input.toolCalls ?? null,
      toolResults: input.toolResults ?? null,
      tokenUsage: input.tokenUsage ?? null,
    };

    const [saved] = await this.db
      .insert(orchestratorTurns)
      .values(row)
      .returning();

    return saved;
  }

  /**
   * Count turns in a session. Used for monitoring and pagination.
   */
  async countTurns(sessionId: string, tenantId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(orchestratorTurns)
      .where(
        and(
          eq(orchestratorTurns.sessionId, sessionId),
          eq(orchestratorTurns.tenantId, tenantId),
        ),
      );

    return row?.total ?? 0;
  }
}
