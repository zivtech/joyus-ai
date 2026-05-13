/**
 * Tool Router Service — WP05 (T034, T035, T036, T037)
 *
 * Implements the ToolRouter interface defined in agent-loop.service.ts.
 * Replaces the StubToolRouter with real tool discovery, permission filtering,
 * and dispatching to existing tool executors.
 *
 * Architecture decisions:
 * - T034/T036: Tool discovery uses an in-memory registry built from the
 *   existing tools/index.ts definitions. No tool_registrations DB table exists
 *   yet (see orchestrator.ts schema). When that table ships, swap in a DB-backed
 *   registry without changing callers.
 * - T035: Dispatch calls through the existing executeTool() infrastructure with
 *   tenantId as userId (deferred to WP12 — see executor.ts convention).
 * - T037: Transient failures retry with exponential backoff (200/800/3200ms).
 *   Semantic failures pass through to the agent immediately. Circuit breaker
 *   tracks consecutive failures in-memory (resets on process restart is acceptable).
 *
 * Event integration: uses the exported registerEventType from event.service.ts
 * to register circuit breaker events, then emits via an EventService instance.
 */

import { z } from 'zod';

import {
  type ToolRouter,
  type ToolRegistration,
  type ToolExecutionResult,
} from './agent-loop.service.js';
import { registerEventType, type EventService } from './event.service.js';
import {
  contentTools,
  githubTools,
  googleTools,
  jiraTools,
  opsTools,
  pipelineTools,
  profileTools,
  slackTools,
  type ToolDefinition,
} from '../tools/index.js';
import { executeTool } from '../tools/executor.js';

// ============================================================
// CIRCUIT BREAKER EVENTS (registered at module init)
// ============================================================

registerEventType(
  'tool.circuit_breaker.opened',
  z.object({
    tenantId: z.string().min(1),
    toolName: z.string().min(1),
    consecutiveFailures: z.number().int().nonnegative(),
  }),
);

registerEventType(
  'tool.circuit_breaker.closed',
  z.object({
    tenantId: z.string().min(1),
    toolName: z.string().min(1),
  }),
);

// ============================================================
// CONFIGURATION
// ============================================================

/** Retry delays in milliseconds (transient failures only) */
const RETRY_DELAYS_MS = [200, 800, 3200] as const;

/** HTTP status codes that indicate a transient (retryable) failure */
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** HTTP status codes that indicate a semantic (non-retryable) failure */
const SEMANTIC_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

/** Number of consecutive failures before tripping the circuit breaker */
const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Circuit breaker cooldown in milliseconds */
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** Tool cache refresh interval in milliseconds (configurable) */
const TOOL_CACHE_REFRESH_MS =
  parseInt(process.env.TOOL_CACHE_REFRESH_MS ?? '300000', 10) || 300_000; // 5 minutes

/** Per-tool call timeout in milliseconds */
const TOOL_CALL_TIMEOUT_MS =
  parseInt(process.env.TOOL_CALL_TIMEOUT_MS ?? '30000', 10) || 30_000;

// ============================================================
// CIRCUIT BREAKER STATE (in-memory, resets on restart)
// ============================================================

interface CircuitBreakerEntry {
  consecutiveFailures: number;
  openedAt: number | null; // epoch ms when circuit opened, null when closed
}

// ============================================================
// TOOL CACHE ENTRY
// ============================================================

interface ToolCacheEntry {
  tools: ToolRegistration[];
  refreshedAt: number; // epoch ms
}

// ============================================================
// TOOL ROUTER SERVICE
// ============================================================

export interface ToolRouterServiceDeps {
  eventService?: EventService;
}

export class ToolRouterService implements ToolRouter {
  /** In-memory tool cache keyed by tenantId */
  private readonly toolCache = new Map<string, ToolCacheEntry>();

  /** Circuit breaker state keyed by `${tenantId}:${toolName}` */
  private readonly circuitBreakers = new Map<string, CircuitBreakerEntry>();

  private readonly eventService: EventService | null;

  constructor(deps: ToolRouterServiceDeps = {}) {
    this.eventService = deps.eventService ?? null;
  }

  // ---------------------------------------------------------------------------
  // T034: Tool Discovery
  // ---------------------------------------------------------------------------

  /**
   * Discover tools available for this tenant.
   *
   * Phase 1: returns all platform tools from the in-memory registry (no per-user
   * connection filtering needed at this layer — that's a future WP12 concern).
   * Caches results per tenant for TOOL_CACHE_REFRESH_MS.
   *
   * Phase 2 (when Spec 014 ships): replace the body with a gateway query.
   */
  async discoverTools(tenantId: string): Promise<ToolRegistration[]> {
    const cached = this.toolCache.get(tenantId);
    const now = Date.now();

    if (cached && now - cached.refreshedAt < TOOL_CACHE_REFRESH_MS) {
      return cached.tools;
    }

    const tools = buildToolRegistry();
    this.toolCache.set(tenantId, { tools, refreshedAt: now });
    return tools;
  }

  // ---------------------------------------------------------------------------
  // T036: Permission Filtering
  // ---------------------------------------------------------------------------

  /**
   * Get tools authorized for this tenant.
   *
   * Current implementation: all tools are authorized (allowlist model deferred).
   * The interface ensures callers don't need to change when real permissions ship.
   * Filters out any tools with an open circuit breaker.
   */
  async getAuthorizedTools(tenantId: string): Promise<ToolRegistration[]> {
    const all = await this.discoverTools(tenantId);
    return all.filter((tool) => !this.isCircuitOpen(tenantId, tool.name));
  }

  // ---------------------------------------------------------------------------
  // T035: Tool Dispatch (required by ToolRouter interface)
  // ---------------------------------------------------------------------------

  /**
   * Execute a tool call and return a result for the agent.
   *
   * Applies T037 retry/circuit-breaker logic before dispatching.
   * Returns a ToolExecutionResult (never throws — errors are encoded in result).
   */
  async executeToolCall(
    toolName: string,
    toolInput: Record<string, unknown>,
    tenantId: string,
  ): Promise<ToolExecutionResult> {
    // Check circuit breaker before dispatching
    if (this.isCircuitOpen(tenantId, toolName)) {
      return {
        result: `Tool "${toolName}" is temporarily unavailable (circuit breaker open). Please try again later.`,
        isError: true,
      };
    }

    // Emit tool.called event (fire-and-forget)
    void this.emitEvent(tenantId, 'tool.called', {
      sessionId: 'unknown', // sessionId is not available at this layer; WP06 may thread it through
      tenantId,
      toolName,
      input: toolInput,
    });

    const startMs = Date.now();

    // T037: dispatch with retry/timeout
    const result = await this.dispatchWithRetry(toolName, toolInput, tenantId);

    const durationMs = Date.now() - startMs;

    if (result.isError) {
      void this.emitEvent(tenantId, 'tool.failed', {
        sessionId: 'unknown',
        tenantId,
        toolName,
        error: result.result,
      });
    } else {
      void this.emitEvent(tenantId, 'tool.completed', {
        sessionId: 'unknown',
        tenantId,
        toolName,
        durationMs,
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // T037: Failure Handling — retry, classification, circuit breaker
  // ---------------------------------------------------------------------------

  /**
   * Classify an error as transient (retryable) or semantic (pass-through).
   *
   * HTTP status codes:
   *   Transient: 408, 429, 500, 502, 503, 504 + network errors/timeouts
   *   Semantic:  400, 401, 403, 404, 422 + tool body `{error: ...}` responses
   */
  private classifyError(error: unknown): 'transient' | 'semantic' {
    if (error instanceof Error) {
      // Network errors / ECONNREFUSED / ETIMEDOUT → transient
      const msg = error.message.toLowerCase();
      if (
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('econnreset') ||
        msg.includes('timeout') ||
        msg.includes('network')
      ) {
        return 'transient';
      }

      // Axios-style HTTP error with status code
      const axiosError = error as { response?: { status?: number } };
      if (axiosError.response?.status !== undefined) {
        const status = axiosError.response.status;
        if (TRANSIENT_STATUS_CODES.has(status)) return 'transient';
        if (SEMANTIC_STATUS_CODES.has(status)) return 'semantic';
      }

      // Status embedded in message (e.g. "Request failed with status code 503")
      const statusMatch = msg.match(/status code (\d+)/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        if (TRANSIENT_STATUS_CODES.has(status)) return 'transient';
        if (SEMANTIC_STATUS_CODES.has(status)) return 'semantic';
      }
    }

    // Unknown errors → treat as transient (conservative)
    return 'transient';
  }

  /**
   * Dispatch a tool call with retry logic and timeout.
   * Returns a ToolExecutionResult — never throws.
   */
  private async dispatchWithRetry(
    toolName: string,
    toolInput: Record<string, unknown>,
    tenantId: string,
  ): Promise<ToolExecutionResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const result = await this.dispatchWithTimeout(toolName, toolInput, tenantId);

        // Success: reset circuit breaker
        this.recordSuccess(tenantId, toolName);

        return { result, isError: false };
      } catch (error: unknown) {
        lastError = error;
        const classification = this.classifyError(error);

        if (classification === 'semantic') {
          // Semantic failure: record, pass to agent immediately, no retry
          this.recordFailure(tenantId, toolName);
          const msg = error instanceof Error ? error.message : String(error);
          return {
            result: `Tool "${toolName}" returned an error: ${msg}`,
            isError: true,
          };
        }

        // Transient failure: record and retry if attempts remain
        this.recordFailure(tenantId, toolName);

        if (attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt];
          console.warn(`[ToolRouterService] Transient failure for tool "${toolName}" (attempt ${attempt + 1}), retrying in ${delay}ms`, {
            tenantId,
            toolName,
            error: error instanceof Error ? error.message : String(error),
          });
          await sleep(delay);
        }
      }
    }

    // All retries exhausted
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    return {
      result: `Tool "${toolName}" failed after ${RETRY_DELAYS_MS.length + 1} attempts: ${msg}`,
      isError: true,
    };
  }

  /**
   * Dispatch a single tool call with a timeout.
   * Throws on error (caught by dispatchWithRetry).
   */
  private async dispatchWithTimeout(
    toolName: string,
    toolInput: Record<string, unknown>,
    tenantId: string,
  ): Promise<string> {
    // The existing executeTool uses userId — tenantId is userId in single-tenant world.
    // Multi-tenant resolution is deferred to WP12.
    const userId = tenantId;

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool "${toolName}" timed out after ${TOOL_CALL_TIMEOUT_MS}ms`));
      }, TOOL_CALL_TIMEOUT_MS);
      // Allow the process to exit even if timeout fires
      if (typeof timer.unref === 'function') timer.unref();
    });

    const toolPromise = executeTool(userId, toolName, toolInput).then((rawResult) => {
      if (typeof rawResult === 'string') return rawResult;
      return JSON.stringify(rawResult);
    });

    // If the timeout fires before the tool, this will throw (→ classified as transient)
    return Promise.race([toolPromise, timeoutPromise]);
  }

  // ---------------------------------------------------------------------------
  // Circuit Breaker helpers
  // ---------------------------------------------------------------------------

  private cbKey(tenantId: string, toolName: string): string {
    return `${tenantId}:${toolName}`;
  }

  private getOrCreateCbEntry(tenantId: string, toolName: string): CircuitBreakerEntry {
    const key = this.cbKey(tenantId, toolName);
    if (!this.circuitBreakers.has(key)) {
      this.circuitBreakers.set(key, { consecutiveFailures: 0, openedAt: null });
    }
    return this.circuitBreakers.get(key)!;
  }

  private isCircuitOpen(tenantId: string, toolName: string): boolean {
    const key = this.cbKey(tenantId, toolName);
    const entry = this.circuitBreakers.get(key);
    if (!entry || entry.openedAt === null) return false;

    const cooldownExpired = Date.now() - entry.openedAt > CIRCUIT_BREAKER_COOLDOWN_MS;
    if (cooldownExpired) {
      // Auto-close: reset and re-enable the tool
      entry.consecutiveFailures = 0;
      entry.openedAt = null;
      console.info(`[ToolRouterService] Circuit breaker closed (cooldown expired) for "${toolName}"`, { tenantId });
      void this.emitEvent(tenantId, 'tool.circuit_breaker.closed', { tenantId, toolName });
    }
    return entry.openedAt !== null;
  }

  private recordSuccess(tenantId: string, toolName: string): void {
    const entry = this.getOrCreateCbEntry(tenantId, toolName);
    entry.consecutiveFailures = 0;
    // Don't clear openedAt here — that's only reset by cooldown expiry
  }

  private recordFailure(tenantId: string, toolName: string): void {
    const entry = this.getOrCreateCbEntry(tenantId, toolName);
    entry.consecutiveFailures += 1;

    if (entry.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && entry.openedAt === null) {
      entry.openedAt = Date.now();
      console.warn(`[ToolRouterService] Circuit breaker OPENED for "${toolName}" after ${entry.consecutiveFailures} consecutive failures`, { tenantId });
      void this.emitEvent(tenantId, 'tool.circuit_breaker.opened', {
        tenantId,
        toolName,
        consecutiveFailures: entry.consecutiveFailures,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Event emission helper
  // ---------------------------------------------------------------------------

  private async emitEvent(
    tenantId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.eventService) return;
    try {
      await this.eventService.emitEvent(tenantId, type, payload);
    } catch (err) {
      console.error(`[ToolRouterService] Failed to emit event "${type}":`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Testability helpers (for vitest mocking)
  // ---------------------------------------------------------------------------

  /** Expose circuit breaker state for tests. */
  getCircuitBreakerState(tenantId: string, toolName: string): CircuitBreakerEntry | undefined {
    return this.circuitBreakers.get(this.cbKey(tenantId, toolName));
  }

  /** Force-expire the cache for a tenant (for tests). */
  invalidateCache(tenantId: string): void {
    this.toolCache.delete(tenantId);
  }
}

// ============================================================
// Tool Registry Builder
// ============================================================

/**
 * Build the full in-memory tool registry from all registered tool definitions.
 * Converts ToolDefinition (tools/index.ts shape) to ToolRegistration (agent format).
 *
 * Phase 1: includes all platform tools unconditionally (no user-connection check).
 * Per-tenant permission filtering happens in getAuthorizedTools().
 */
function buildToolRegistry(): ToolRegistration[] {
  const allTools: ToolDefinition[] = [
    ...opsTools,
    ...contentTools,
    ...pipelineTools,
    ...profileTools,
    ...jiraTools,
    ...slackTools,
    ...githubTools,
    ...googleTools,
  ];

  return allTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

// ============================================================
// Utilities
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export CircuitBreakerEntry for tests
export type { CircuitBreakerEntry };
