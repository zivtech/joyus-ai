/**
 * Safety Service — WP07 (T048, T049)
 *
 * Provides pre/post-generation hook points for Spec 014's safety system.
 * This file defines the interfaces and orchestrates hook chaining.
 * Real hook implementations are registered by Spec 014 at runtime.
 *
 * Design principles:
 * - DEFAULT PASS-THROUGH: no hooks registered = all requests allowed
 * - ORDERED CHAINING: hooks run in registration order; first "block" stops the chain
 * - AUDIT ALWAYS: every hook execution emits an audit event, even for "allow"
 * - SPEC BOUNDARY: this file is interface + orchestration only; implementations live in Spec 014
 *
 * Hook lifecycle (pre-generation):
 *   1. assembleSystemPrompt() → runPreHooks() → (if allow/modify) invoke Claude
 *   2. If blocked: return block reason to caller, no API call made
 *   3. If modified: use modifiedPrompt for the Claude call
 *
 * Hook lifecycle (post-generation):
 *   1. Claude responds → runPostHooks()
 *   2. If flagged/blocked: suppress or modify response, return reason to caller
 */

import { z } from 'zod';

import type { AgentMessage } from './agent-loop.service.js';
import type { EventService } from './event.service.js';
import { registerEventType } from './event.service.js';
import type { ToolCall as AgentToolCall } from './types.js';


// ============================================================
// EVENT TYPE REGISTRATION — T049 (audit logging)
// ============================================================

registerEventType(
  'safety.pre_hook.executed',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    hookName: z.string().min(1),
    action: z.enum(['allow', 'modify', 'block']),
    reason: z.string().optional(),
  }),
);

registerEventType(
  'safety.post_hook.executed',
  z.object({
    sessionId: z.string().min(1),
    tenantId: z.string().min(1),
    hookName: z.string().min(1),
    action: z.enum(['allow', 'modify', 'block']),
    reason: z.string().optional(),
  }),
);

// ============================================================
// HOOK INTERFACES — T048
// ============================================================

/**
 * Context passed to every pre-generation hook.
 */
export interface PreGenerationContext {
  tenantId: string;
  sessionId: string;
  systemPrompt: string;
  messages: AgentMessage[];
}

/**
 * Outcome of a pre-generation hook execution.
 *
 * - allow: proceed with the original prompt
 * - modify: replace systemPrompt with modifiedPrompt before Claude invocation
 * - block: do not invoke Claude; return blockReason to the caller
 */
export type PreGenerationOutcome =
  | { action: 'allow'; reason?: string }
  | { action: 'modify'; modifiedPrompt: string; reason?: string }
  | { action: 'block'; reason: string };

/**
 * Pre-generation safety hook.
 * Called BEFORE the Claude API is invoked.
 * Spec 014 will register implementations.
 */
export interface PreGenerationHook {
  /** Unique name used in audit logs. */
  readonly name: string;
  execute(context: PreGenerationContext): Promise<PreGenerationOutcome>;
}

/**
 * Context passed to every post-generation hook.
 */
export interface PostGenerationContext {
  tenantId: string;
  sessionId: string;
  response: string;
  toolCalls?: AgentToolCall[];
}

/**
 * Outcome of a post-generation hook execution.
 *
 * - allow: pass the response through unchanged
 * - modify: replace response with modifiedResponse before returning to caller
 * - block: suppress the response; return blockReason to the caller
 */
export type PostGenerationOutcome =
  | { action: 'allow'; reason?: string }
  | { action: 'modify'; modifiedResponse: string; reason?: string }
  | { action: 'block'; reason: string };

/**
 * Post-generation safety hook.
 * Called AFTER the Claude API responds.
 * Spec 014 will register implementations.
 */
export interface PostGenerationHook {
  /** Unique name used in audit logs. */
  readonly name: string;
  execute(context: PostGenerationContext): Promise<PostGenerationOutcome>;
}

// ============================================================
// SAFETY SERVICE RESULT TYPES — T049
// ============================================================

/**
 * Result of running the pre-generation hook chain.
 */
export type PreHooksResult =
  | { action: 'allow'; effectiveSystemPrompt: string }
  | { action: 'modify'; effectiveSystemPrompt: string }
  | { action: 'block'; reason: string };

/**
 * Result of running the post-generation hook chain.
 */
export type PostHooksResult =
  | { action: 'allow'; effectiveResponse: string }
  | { action: 'modify'; effectiveResponse: string }
  | { action: 'block'; reason: string };

// ============================================================
// SAFETY SERVICE — T048, T049
// ============================================================

/**
 * Orchestrates pre/post-generation safety hook chains.
 *
 * Registration: call registerPreHook() / registerPostHook() at startup.
 * Runtime: call runPreHooks() before Claude, runPostHooks() after.
 *
 * By default (no hooks registered), all requests pass through.
 */
export class SafetyService {
  private readonly preHooks: PreGenerationHook[] = [];
  private readonly postHooks: PostGenerationHook[] = [];
  private readonly eventService: EventService | null;

  constructor(eventService?: EventService) {
    this.eventService = eventService ?? null;
  }

  // ---------------------------------------------------------------------------
  // Hook registration
  // ---------------------------------------------------------------------------

  /**
   * Register a pre-generation hook.
   * Hooks run in registration order; first "block" stops the chain.
   */
  registerPreHook(hook: PreGenerationHook): void {
    this.preHooks.push(hook);
  }

  /**
   * Register a post-generation hook.
   * Hooks run in registration order; first "block" stops the chain.
   */
  registerPostHook(hook: PostGenerationHook): void {
    this.postHooks.push(hook);
  }

  // ---------------------------------------------------------------------------
  // T048: Run pre-generation hooks
  // ---------------------------------------------------------------------------

  /**
   * Run all registered pre-generation hooks in order.
   *
   * - If no hooks registered: returns { action: 'allow', effectiveSystemPrompt }
   * - If a hook returns "block": stops the chain, returns block reason
   * - If a hook returns "modify": updates systemPrompt for subsequent hooks
   * - Audit event emitted for every hook execution (T049)
   *
   * @param context - The generation context including systemPrompt and messages
   * @returns The aggregated hook chain result
   */
  async runPreHooks(context: PreGenerationContext): Promise<PreHooksResult> {
    let effectiveSystemPrompt = context.systemPrompt;

    for (const hook of this.preHooks) {
      const hookContext: PreGenerationContext = {
        ...context,
        systemPrompt: effectiveSystemPrompt,
      };

      const outcome = await hook.execute(hookContext);

      // T049: audit log every execution, even for "allow"
      await this.emitPreHookAuditEvent(context.sessionId, context.tenantId, hook.name, outcome);

      if (outcome.action === 'block') {
        return { action: 'block', reason: outcome.reason };
      }

      if (outcome.action === 'modify') {
        effectiveSystemPrompt = outcome.modifiedPrompt;
      }
      // 'allow': continue with current prompt
    }

    const wasModified = effectiveSystemPrompt !== context.systemPrompt;
    return {
      action: wasModified ? 'modify' : 'allow',
      effectiveSystemPrompt,
    };
  }

  // ---------------------------------------------------------------------------
  // T048: Run post-generation hooks
  // ---------------------------------------------------------------------------

  /**
   * Run all registered post-generation hooks in order.
   *
   * - If no hooks registered: returns { action: 'allow', effectiveResponse }
   * - If a hook returns "block": stops the chain, response is suppressed
   * - If a hook returns "modify": updates response for subsequent hooks
   * - Audit event emitted for every hook execution (T049)
   *
   * @param context - The generation context including the Claude response
   * @returns The aggregated hook chain result
   */
  async runPostHooks(context: PostGenerationContext): Promise<PostHooksResult> {
    let effectiveResponse = context.response;

    for (const hook of this.postHooks) {
      const hookContext: PostGenerationContext = {
        ...context,
        response: effectiveResponse,
      };

      const outcome = await hook.execute(hookContext);

      // T049: audit log every execution, even for "allow"
      await this.emitPostHookAuditEvent(context.sessionId, context.tenantId, hook.name, outcome);

      if (outcome.action === 'block') {
        return { action: 'block', reason: outcome.reason };
      }

      if (outcome.action === 'modify') {
        effectiveResponse = outcome.modifiedResponse;
      }
      // 'allow': continue with current response
    }

    const wasModified = effectiveResponse !== context.response;
    return {
      action: wasModified ? 'modify' : 'allow',
      effectiveResponse,
    };
  }

  // ---------------------------------------------------------------------------
  // T049: Private audit event emitters
  // ---------------------------------------------------------------------------

  /**
   * Emit a pre-hook audit event.
   * For "allow" actions: minimal payload (no prompt content).
   * For "block"/"modify" actions: include reason.
   */
  private async emitPreHookAuditEvent(
    sessionId: string,
    tenantId: string,
    hookName: string,
    outcome: PreGenerationOutcome,
  ): Promise<void> {
    if (!this.eventService) return;

    try {
      await this.eventService.emitEvent(
        tenantId,
        'safety.pre_hook.executed',
        {
          sessionId,
          tenantId,
          hookName,
          action: outcome.action,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        },
        sessionId,
      );
    } catch (err) {
      // Audit log failures are non-fatal — log and continue
      console.error('[SafetyService] Failed to emit pre-hook audit event (non-fatal):', err);
    }
  }

  /**
   * Emit a post-hook audit event.
   * For "allow" actions: minimal payload (no response content).
   * For "block"/"modify" actions: include reason.
   */
  private async emitPostHookAuditEvent(
    sessionId: string,
    tenantId: string,
    hookName: string,
    outcome: PostGenerationOutcome,
  ): Promise<void> {
    if (!this.eventService) return;

    try {
      await this.eventService.emitEvent(
        tenantId,
        'safety.post_hook.executed',
        {
          sessionId,
          tenantId,
          hookName,
          action: outcome.action,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        },
        sessionId,
      );
    } catch (err) {
      // Audit log failures are non-fatal — log and continue
      console.error('[SafetyService] Failed to emit post-hook audit event (non-fatal):', err);
    }
  }
}

// ============================================================
// DEFAULT STUB HOOK — T048
// ============================================================

/**
 * No-op pre-generation hook.
 * Registered by default. Always returns "allow".
 * Spec 014 will register real implementations that replace or supplement this.
 *
 * This stub satisfies the "audit events are always emitted" requirement:
 * SafetyService emits the audit event for every hook including this one.
 */
export class PassThroughPreHook implements PreGenerationHook {
  readonly name = 'passthrough-pre';

  async execute(_context: PreGenerationContext): Promise<PreGenerationOutcome> {
    return { action: 'allow' };
  }
}

/**
 * No-op post-generation hook.
 * Registered by default. Always returns "allow".
 * Spec 014 will register real implementations that replace or supplement this.
 */
export class PassThroughPostHook implements PostGenerationHook {
  readonly name = 'passthrough-post';

  async execute(_context: PostGenerationContext): Promise<PostGenerationOutcome> {
    return { action: 'allow' };
  }
}

/**
 * Factory: create a SafetyService with default pass-through hooks registered.
 *
 * Default behavior: every request is allowed, every invocation is audited.
 * Replace with createSafetyService({ hooks: [...] }) when Spec 014 ships.
 */
export function createDefaultSafetyService(eventService?: EventService): SafetyService {
  const service = new SafetyService(eventService);
  service.registerPreHook(new PassThroughPreHook());
  service.registerPostHook(new PassThroughPostHook());
  return service;
}

// ============================================================
// SAFETY ERRORS — T048 (returned when block is triggered)
// ============================================================

export class SafetyBlockedError extends Error {
  constructor(
    public readonly phase: 'pre' | 'post',
    public readonly reason: string,
  ) {
    super(`Safety hook blocked ${phase}-generation: ${reason}`);
    this.name = 'SafetyBlockedError';
  }
}
