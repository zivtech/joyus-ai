/**
 * Usage Service — WP07 (T050, T051, T052)
 *
 * Tracks token usage per session and detects idle sessions.
 * Emits typed events consumed by Spec 011 (cost aggregation).
 *
 * This service is the emit-side only.
 * Spec 011 owns the aggregation, budgeting, and enforcement logic.
 *
 * Responsibilities:
 *   T050 - Emit `usage.model_invocation` after each Claude API call
 *   T051 - Accumulate per-session usage; expose `getSessionUsage()`
 *   T052 - Detect idle gaps and emit `usage.idle_gap_detected`
 *
 * NOT in scope:
 *   - Enforcing token budgets (Spec 011)
 *   - Billing or invoicing (Spec 011)
 *   - Session suspension on idle (Spec 011 decision)
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { orchestratorEvents } from '../db/schema/events.js';
import type { EventService } from './event.service.js';
import { registerEventType } from './event.service.js';

// ============================================================
// EVENT TYPE REGISTRATION — T050, T052
// ============================================================

registerEventType(
  'usage.model_invocation',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    cacheCreations: z.number().int().nonnegative(),
    model: z.string().min(1),
    turnSequence: z.number().int().nonnegative(),
  }),
);

registerEventType(
  'usage.idle_gap_detected',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    idleMinutes: z.number().nonnegative(),
    tokensSinceLastInteraction: z.number().int().nonnegative(),
  }),
);

// ============================================================
// PRICING CONSTANTS — T051
// ============================================================

/**
 * Approximate pricing per 1M tokens (USD).
 *
 * IMPORTANT: These are approximate values for estimation purposes only.
 * Actual pricing is subject to change. Update when Anthropic changes pricing.
 * Source: https://www.anthropic.com/pricing (verified 2026-05)
 *
 * Do NOT use these for billing or invoicing. Use Spec 011 for that.
 */
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number }> = {
  // Claude claude-3-5-sonnet
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
  // Claude claude-3-opus
  'claude-opus-4-20250514': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 },
  // Claude claude-3-haiku
  'claude-haiku-4-20250514': { input: 0.8, output: 4.0, cacheRead: 0.08, cacheCreation: 1.0 },
  // Claude claude-3-5-sonnet (newer)
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
};

/** Fallback pricing used when model is not in the pricing table (conservative estimate). */
const FALLBACK_PRICING = { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 };

/**
 * Estimate USD cost for a model invocation.
 * Returns 0 if pricing is unavailable. Marked approximate.
 *
 * APPROXIMATE: Do not use for billing.
 */
function estimateInvocationCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheHits: number,
  cacheCreations: number,
): number {
  const pricing = PRICING_PER_MILLION_TOKENS[model] ?? FALLBACK_PRICING;
  const M = 1_000_000;
  return (
    (inputTokens * pricing.input) / M +
    (outputTokens * pricing.output) / M +
    (cacheHits * pricing.cacheRead) / M +
    (cacheCreations * pricing.cacheCreation) / M
  );
}

// ============================================================
// INVOCATION RECORD — passed from agent loop to usage service
// ============================================================

/**
 * Token usage data extracted from a Claude API response.
 * Agent loop populates this and passes to UsageService after each invocation.
 */
export interface ModelInvocationUsage {
  sessionId: string;
  tenantId: string;
  model: string;
  turnSequence: number;
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the prompt cache (no charge at full rate). */
  cacheHits: number;
  /** Tokens written to the prompt cache (incurs cache creation charge). */
  cacheCreations: number;
  /** Wall-clock timestamp of the last user message for idle detection. */
  lastUserMessageAt: Date;
}

// ============================================================
// SESSION USAGE SUMMARY — T051
// ============================================================

/**
 * Cumulative token usage for a session.
 * Returned by getSessionUsage() for the session GET endpoint.
 */
export interface SessionUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheHits: number;
  /** APPROXIMATE: USD cost estimate. Do not use for billing. */
  estimatedCostUsd: number;
  invocationCount: number;
}

// ============================================================
// USAGE SERVICE — T050, T051, T052
// ============================================================

export interface UsageServiceDeps {
  eventService: EventService;
  db: NodePgDatabase<Record<string, unknown>>;
  /**
   * Idle detection threshold in minutes.
   * Sessions with no user interaction for longer than this are flagged.
   * Default: 5 minutes. Set via ORCHESTRATOR_IDLE_THRESHOLD_MINUTES env var.
   */
  idleThresholdMinutes?: number;
}

export class UsageService {
  private readonly eventService: EventService;
  private readonly db: NodePgDatabase<Record<string, unknown>>;
  private readonly idleThresholdMinutes: number;

  constructor(deps: UsageServiceDeps) {
    this.eventService = deps.eventService;
    this.db = deps.db;
    this.idleThresholdMinutes =
      deps.idleThresholdMinutes ??
      parseInt(process.env.ORCHESTRATOR_IDLE_THRESHOLD_MINUTES ?? '5', 10);
  }

  // ---------------------------------------------------------------------------
  // T050: Emit usage event after each model invocation
  // ---------------------------------------------------------------------------

  /**
   * Record a model invocation: emit token usage event and detect idle gap.
   *
   * Called by the agent loop after each `client.messages.create()` call.
   * Fire-and-forget from the loop's perspective — awaited internally so
   * events are guaranteed before method returns.
   *
   * @param usage - Token counts and context from the current invocation
   */
  async recordInvocation(usage: ModelInvocationUsage): Promise<void> {
    // T050: emit the per-invocation usage event
    await this.emitModelInvocationEvent(usage);

    // T052: detect and flag idle gaps
    await this.detectIdleGap(usage);
  }

  // ---------------------------------------------------------------------------
  // T051: Per-session cost accumulation — queryable via session GET
  // ---------------------------------------------------------------------------

  /**
   * Get cumulative token usage for a session.
   *
   * Implementation: queries the events table for all `usage.model_invocation`
   * events for this session and sums the token counts. This is Option A from
   * the spec (no schema changes needed). Switch to Option B (materialized
   * column) if query performance becomes an issue.
   *
   * @param tenantId - Tenant scope (required for all DB queries)
   * @param sessionId - Session to summarize
   * @returns Cumulative usage totals and approximate cost estimate
   */
  async getSessionUsage(tenantId: string, sessionId: string): Promise<SessionUsage> {
    const events = await this.db
      .select()
      .from(orchestratorEvents)
      .where(
        and(
          eq(orchestratorEvents.tenantId, tenantId),
          eq(orchestratorEvents.sessionId, sessionId),
          inArray(orchestratorEvents.type, ['usage.model_invocation']),
        ),
      );

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheHits = 0;
    let totalCacheCreations = 0;
    let estimatedCostUsd = 0;

    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      const inputTokens = (payload.inputTokens as number) ?? 0;
      const outputTokens = (payload.outputTokens as number) ?? 0;
      const cacheHits = (payload.cacheHits as number) ?? 0;
      const cacheCreations = (payload.cacheCreations as number) ?? 0;
      const model = (payload.model as string) ?? '';

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalCacheHits += cacheHits;
      totalCacheCreations += cacheCreations;

      estimatedCostUsd += estimateInvocationCost(
        model,
        inputTokens,
        outputTokens,
        cacheHits,
        cacheCreations,
      );
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheHits,
      estimatedCostUsd,
      invocationCount: events.length,
    };
  }

  // ---------------------------------------------------------------------------
  // T050: Private event emitter
  // ---------------------------------------------------------------------------

  private async emitModelInvocationEvent(usage: ModelInvocationUsage): Promise<void> {
    try {
      await this.eventService.emitEvent(
        usage.tenantId,
        'usage.model_invocation',
        {
          sessionId: usage.sessionId,
          tenantId: usage.tenantId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheHits: usage.cacheHits,
          cacheCreations: usage.cacheCreations,
          model: usage.model,
          turnSequence: usage.turnSequence,
        },
        usage.sessionId,
      );
    } catch (err) {
      // Usage events are non-blocking — log and continue
      console.error('[UsageService] Failed to emit model invocation event (non-fatal):', err);
    }
  }

  // ---------------------------------------------------------------------------
  // T052: Idle gap detection
  // ---------------------------------------------------------------------------

  /**
   * Detect and flag idle sessions.
   *
   * An idle gap exists when:
   *   - The session has consumed tokens in this invocation (tokensSinceLastInteraction > 0)
   *   - AND the time since the last user message exceeds idleThresholdMinutes
   *
   * Emits `usage.idle_gap_detected` as a signal only — no automatic action taken.
   * Spec 011 (cost tracking) decides what to do with this signal.
   *
   * Common causes: runaway tool call loops, stuck agent, very long tasks.
   */
  private async detectIdleGap(usage: ModelInvocationUsage): Promise<void> {
    const tokensSinceLastInteraction = usage.inputTokens + usage.outputTokens;
    if (tokensSinceLastInteraction === 0) return;

    const idleMs = Date.now() - usage.lastUserMessageAt.getTime();
    const idleMinutes = idleMs / 60_000;

    if (idleMinutes < this.idleThresholdMinutes) return;

    try {
      await this.eventService.emitEvent(
        usage.tenantId,
        'usage.idle_gap_detected',
        {
          sessionId: usage.sessionId,
          tenantId: usage.tenantId,
          idleMinutes: Math.round(idleMinutes * 10) / 10, // one decimal place
          tokensSinceLastInteraction,
        },
        usage.sessionId,
      );
    } catch (err) {
      // Idle detection events are non-blocking — log and continue
      console.error('[UsageService] Failed to emit idle gap event (non-fatal):', err);
    }
  }
}

// ============================================================
// EXPORTS — for use by agent-loop.service.ts and routes
// ============================================================

export { estimateInvocationCost };
