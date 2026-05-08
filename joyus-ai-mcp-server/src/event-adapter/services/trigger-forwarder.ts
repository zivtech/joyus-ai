/**
 * Event Adapter — Trigger Forwarder
 *
 * Publishes trigger calls to Inngest as pipeline/* events.
 * Mapping rules (corpus-change with corpusId metadata) → pipeline/corpus.changed,
 * schedule events (scheduleId / scheduledAt metadata) → pipeline/schedule.tick,
 * everything else → pipeline/manual.triggered.
 */

import { inngest as defaultInngest } from '../../inngest/client.js';

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

// Inngest send() signature — typed loosely so callers can pass either the real
// Inngest client or a vitest mock without coupling to the internal generic.
type InngestLike = {
  send: (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
};

export interface TriggerForwarderConfig {
  /** Inngest client used for publishing — defaults to the shared singleton. */
  inngest?: InngestLike;
}

// ============================================================
// FORWARDER
// ============================================================

export class TriggerForwarder {
  private readonly inngest: InngestLike;

  constructor(config: TriggerForwarderConfig = {}) {
    this.inngest = config.inngest ?? (defaultInngest as unknown as InngestLike);
  }

  /**
   * Forward a trigger call by publishing the appropriate pipeline/* event to Inngest.
   * Never throws — returns { success: false, error } on any failure.
   */
  async forwardTrigger(call: TriggerCall): Promise<TriggerResult> {
    try {
      const event = mapToInngestEvent(call);
      const response = (await this.inngest.send(event)) as
        | { ids?: string[] }
        | { ids?: string[] }[]
        | undefined;

      const runId = extractRunId(response);
      return runId ? { success: true, runId } : { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

// ============================================================
// EVENT MAPPING
// ============================================================

function mapToInngestEvent(call: TriggerCall): { name: string; data: Record<string, unknown> } {
  const { tenantId, pipelineId, triggerType, metadata } = call;

  // Corpus change with explicit corpusId → pipeline/corpus.changed.
  if (triggerType === 'corpus-change' && typeof metadata['corpusId'] === 'string') {
    const changeType = typeof metadata['changeType'] === 'string'
      ? (metadata['changeType'] as string)
      : 'updated';
    return {
      name: 'pipeline/corpus.changed',
      data: {
        tenantId,
        corpusId: metadata['corpusId'] as string,
        changeType,
      },
    };
  }

  // Schedule events → pipeline/schedule.tick.
  if (metadata['scheduleId'] !== undefined || metadata['scheduledAt'] !== undefined) {
    const scheduledAt = (metadata['scheduledAt'] as string | undefined)
      ?? (metadata['firedAt'] as string | undefined)
      ?? new Date().toISOString();
    return {
      name: 'pipeline/schedule.tick',
      data: {
        tenantId,
        pipelineId,
        scheduledAt,
      },
    };
  }

  // Default: manual trigger.
  return {
    name: 'pipeline/manual.triggered',
    data: {
      tenantId,
      pipelineId,
      payload: metadata,
    },
  };
}

function extractRunId(response: unknown): string | undefined {
  if (!response) return undefined;
  if (Array.isArray(response)) {
    const first = response[0] as { ids?: string[] } | undefined;
    return first?.ids?.[0];
  }
  const single = response as { ids?: string[] };
  return single.ids?.[0];
}
