/**
 * Event Adapter — Automation Forwarder (WP10)
 *
 * Outbound forwarding of webhook events to a tenant's registered external
 * automation destination (Tier 2). Implements circuit breaker logic to
 * protect against failing destinations.
 *
 * Circuit breaker states:
 *   CLOSED  — forwarding active, failureCount < threshold
 *   OPEN    — forwarding paused after threshold failures
 *   HALF-OPEN — one probe allowed after half-open timeout; success resets
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { automationDestinations } from '../schema.js';
import type { AutomationDestination, WebhookEvent } from '../schema.js';
import type { TriggerCall } from './trigger-forwarder.js';
import { decryptSecret } from './secret-store.js';

// ============================================================
// CONSTANTS
// ============================================================

const CIRCUIT_BREAKER_THRESHOLD = 10;
const CIRCUIT_HALF_OPEN_AFTER_MS = 5 * 60 * 1000; // 5 minutes
const FORWARD_TIMEOUT_MS = 5000;

// ============================================================
// TYPES
// ============================================================

export interface AutomationForwarderConfig {
  circuitBreakerThreshold?: number;
  halfOpenTimeoutMs?: number;
  forwardTimeoutMs?: number;
}

interface OutboundPayload {
  event_id: string;
  tenant_id: string;
  source_type: string;
  trigger_type: string | null;
  pipeline_id: string | null;
  metadata: unknown;
  received_at: string;
}

// ============================================================
// AUTOMATION FORWARDER
// ============================================================

export class AutomationForwarder {
  private readonly db: NodePgDatabase<Record<string, unknown>>;
  private readonly threshold: number;
  private readonly halfOpenMs: number;
  private readonly timeoutMs: number;

  /**
   * In-memory map of tenantId -> timestamp when circuit opened.
   * Used for half-open probe logic.
   */
  private readonly circuitOpenedAt = new Map<string, number>();

  /**
   * In-memory map of tenantId -> boolean indicating a probe is currently
   * in-flight. Prevents multiple concurrent probes.
   */
  private readonly probeInFlight = new Map<string, boolean>();

  constructor(
    db: NodePgDatabase<Record<string, unknown>>,
    config?: AutomationForwarderConfig,
  ) {
    this.db = db;
    this.threshold = config?.circuitBreakerThreshold ?? CIRCUIT_BREAKER_THRESHOLD;
    this.halfOpenMs = config?.halfOpenTimeoutMs ?? CIRCUIT_HALF_OPEN_AFTER_MS;
    this.timeoutMs = config?.forwardTimeoutMs ?? FORWARD_TIMEOUT_MS;
  }

  // ============================================================
  // T053: FORWARD EVENT TO AUTOMATION DESTINATION
  // ============================================================

  /**
   * Forward an event to the tenant's registered automation destination.
   *
   * Fire-and-forget: all errors are caught and logged, never propagated.
   * Circuit breaker prevents forwarding when the destination is failing.
   */
  async forwardToAutomation(event: WebhookEvent, triggerCall?: TriggerCall): Promise<void> {
    try {
      await this._forward(event, triggerCall);
    } catch (err) {
      console.error('[automation-forwarder] unexpected error in forwardToAutomation', {
        eventId: event.id,
        tenantId: event.tenantId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  private async _forward(event: WebhookEvent, triggerCall?: TriggerCall): Promise<void> {
    const [destination] = await this.db
      .select()
      .from(automationDestinations)
      .where(eq(automationDestinations.tenantId, event.tenantId));

    if (!destination) {
      return;
    }

    if (!destination.isActive) {
      return;
    }

    // Circuit breaker check
    if (!this._shouldAttempt(destination)) {
      console.log('[automation-forwarder] circuit open, skipping forward', {
        tenantId: event.tenantId,
        failureCount: destination.failureCount,
      });
      return;
    }

    const payload: OutboundPayload = {
      event_id: event.id,
      tenant_id: event.tenantId,
      source_type: event.sourceType,
      trigger_type: triggerCall?.triggerType ?? event.triggerType ?? null,
      pipeline_id: triggerCall?.pipelineId ?? event.pipelineId ?? null,
      metadata: (event.payload as Record<string, unknown>)?.['metadata'] ?? {},
      received_at: event.createdAt.toISOString(),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Decrypt and add auth header if configured
    if (destination.authHeader && destination.authSecretRef) {
      const secret = decryptSecret(destination.authSecretRef);
      if (secret) {
        headers[destination.authHeader] = secret;
      } else {
        console.warn('[automation-forwarder] failed to decrypt auth secret', {
          tenantId: event.tenantId,
        });
      }
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(destination.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from automation destination`);
      }

      // Success: reset failure count and record forwarded timestamp
      await this.db
        .update(automationDestinations)
        .set({
          lastForwardedAt: new Date(),
          failureCount: 0,
          updatedAt: new Date(),
        })
        .where(eq(automationDestinations.tenantId, event.tenantId));

      // Clear circuit state on success
      this.circuitOpenedAt.delete(event.tenantId);
      this.probeInFlight.delete(event.tenantId);

      console.log('[automation-forwarder] forwarded event', {
        eventId: event.id,
        tenantId: event.tenantId,
        url: destination.url,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);

      const isAbort = err instanceof Error && err.name === 'AbortError';
      console.error('[automation-forwarder] forward failed', {
        eventId: event.id,
        tenantId: event.tenantId,
        reason: isAbort ? 'timeout' : (err instanceof Error ? err.message : err),
      });

      // Increment failure count
      const newCount = destination.failureCount + 1;
      await this.db
        .update(automationDestinations)
        .set({
          failureCount: newCount,
          updatedAt: new Date(),
        })
        .where(eq(automationDestinations.tenantId, event.tenantId));

      // Record circuit open time when threshold is crossed
      if (newCount >= this.threshold && !this.circuitOpenedAt.has(event.tenantId)) {
        this.circuitOpenedAt.set(event.tenantId, Date.now());
        console.warn('[automation-forwarder] circuit opened', {
          tenantId: event.tenantId,
          failureCount: newCount,
        });
      }

      // Clear probe flag on failure
      this.probeInFlight.delete(event.tenantId);
    }
  }

  // ============================================================
  // T055: CIRCUIT BREAKER STATE CHECK
  // ============================================================

  /**
   * Determine whether a forward attempt should proceed.
   *
   * Returns false when the circuit is open and the half-open probe
   * window hasn't elapsed yet, or a probe is already in-flight.
   */
  isCircuitOpen(destination: AutomationDestination): boolean {
    if (destination.failureCount < this.threshold) {
      return false;
    }

    const openedAt = this.circuitOpenedAt.get(destination.tenantId);
    if (!openedAt) {
      // Threshold reached but no open timestamp recorded yet — treat as open
      this.circuitOpenedAt.set(destination.tenantId, Date.now());
      return true;
    }

    const elapsed = Date.now() - openedAt;
    return elapsed < this.halfOpenMs;
  }

  /**
   * Reset circuit breaker state for a tenant (called after successful PUT /automation).
   */
  resetCircuit(tenantId: string): void {
    this.circuitOpenedAt.delete(tenantId);
    this.probeInFlight.delete(tenantId);
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private _shouldAttempt(destination: AutomationDestination): boolean {
    if (destination.failureCount < this.threshold) {
      return true;
    }

    const openedAt = this.circuitOpenedAt.get(destination.tenantId);
    if (!openedAt) {
      // Record the opening timestamp now
      this.circuitOpenedAt.set(destination.tenantId, Date.now());
      return false;
    }

    const elapsed = Date.now() - openedAt;
    if (elapsed < this.halfOpenMs) {
      return false;
    }

    // Half-open: allow exactly one probe at a time
    if (this.probeInFlight.get(destination.tenantId)) {
      return false;
    }

    this.probeInFlight.set(destination.tenantId, true);
    return true;
  }
}
