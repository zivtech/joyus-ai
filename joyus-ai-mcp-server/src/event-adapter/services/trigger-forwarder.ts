/**
 * Event Adapter — Trigger Forwarder
 *
 * Makes outbound HTTP calls to Spec 009's event bus to fire pipeline triggers.
 * Abstracts the call behind an interface so the API can change independently.
 *
 * If SPEC009_EVENT_BUS_URL is not configured, returns a graceful failure
 * for every call (allows the module to start without Spec 009).
 */

// ============================================================
// TYPES
// ============================================================

export interface TriggerCall {
  tenantId: string;
  pipelineId: string;
  triggerType: 'corpus-change' | 'manual-request';
  metadata: Record<string, unknown>;
  sourceEventId: string;
}

export interface TriggerResult {
  success: boolean;
  runId?: string;
  error?: string;
}

export interface TriggerForwarderConfig {
  /** Spec 009 event bus URL (default: process.env.SPEC009_EVENT_BUS_URL) */
  eventBusUrl?: string;
  /** Service-to-service auth token (default: process.env.SPEC009_SERVICE_TOKEN) */
  serviceToken?: string;
  /** Request timeout in ms (default: 5000) */
  timeoutMs?: number;
}

// ============================================================
// FORWARDER
// ============================================================

const DEFAULT_TIMEOUT_MS = 5000;

export class TriggerForwarder {
  private readonly eventBusUrl: string | undefined;
  private readonly serviceToken: string | undefined;
  private readonly timeoutMs: number;

  constructor(config: TriggerForwarderConfig = {}) {
    this.eventBusUrl = config.eventBusUrl ?? process.env.SPEC009_EVENT_BUS_URL;
    this.serviceToken = config.serviceToken ?? process.env.SPEC009_SERVICE_TOKEN;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!this.eventBusUrl) {
      console.warn('[event-adapter] SPEC009_EVENT_BUS_URL not set — trigger forwarding will return errors');
    }
  }

  /**
   * Forward a trigger call to Spec 009's event bus.
   * Never throws — returns { success: false, error } on any failure.
   */
  async forwardTrigger(call: TriggerCall): Promise<TriggerResult> {
    if (!this.eventBusUrl) {
      return { success: false, error: 'Spec 009 event bus not configured' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.eventBusUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.serviceToken ? { 'Authorization': `Bearer ${this.serviceToken}` } : {}),
          'X-Source-Event-Id': call.sourceEventId,
        },
        body: JSON.stringify({
          tenant_id: call.tenantId,
          pipeline_id: call.pipelineId,
          trigger_type: call.triggerType,
          metadata: call.metadata,
          source_event_id: call.sourceEventId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorBody.slice(0, 500)}`,
        };
      }

      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      return {
        success: true,
        runId: typeof body.run_id === 'string' ? body.run_id
          : typeof body.pipeline_run_id === 'string' ? body.pipeline_run_id
          : undefined,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: `Timeout after ${this.timeoutMs}ms` };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }
}
