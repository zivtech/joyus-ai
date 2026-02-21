/**
 * Content Connector Interface & Shared Utilities
 *
 * Defines the pluggable ContentConnector contract that all connector
 * implementations must satisfy, plus shared health-check utilities.
 */

import type { ConnectorConfig } from '../types.js';

// ============================================================
// CORE INTERFACE
// ============================================================

export interface ContentConnector {
  readonly type: string;
  discover(config: ConnectorConfig): Promise<DiscoveryResult>;
  indexBatch(config: ConnectorConfig, cursor: string | null, batchSize: number): Promise<IndexBatchResult>;
  fetchContent(config: ConnectorConfig, itemRef: string): Promise<ContentPayload>;
  healthCheck(config: ConnectorConfig): Promise<HealthStatus>;
}

// ============================================================
// RESULT TYPES
// ============================================================

export interface DiscoveryResult {
  collections: DiscoveredCollection[];
  totalEstimate: number;
}

export interface DiscoveredCollection {
  name: string;
  itemEstimate: number;
  fields: string[];
}

export interface IndexBatchResult {
  items: ContentPayload[];
  nextCursor: string | null;
  totalProcessed: number;
}

export interface ContentPayload {
  sourceRef: string;
  title: string;
  body: string | null;
  contentType: string;
  metadata: Record<string, unknown>;
}

export interface HealthStatus {
  healthy: boolean;
  message: string | null;
  latencyMs: number;
}

// ============================================================
// SHARED UTILITIES
// ============================================================

/**
 * Measures health of an async operation, returning latency and success status.
 */
export async function measureHealth(
  fn: () => Promise<void>
): Promise<HealthStatus> {
  const start = Date.now();
  try {
    await fn();
    return { healthy: true, message: null, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      healthy: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - start,
    };
  }
}

// ============================================================
// STRUCTURED ERROR
// ============================================================

/**
 * Structured connector error carrying context for logging and debugging.
 * Does NOT expose connection credentials in the message.
 */
export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly sourceId: string,
    public readonly connectorType: string,
    public readonly operation: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'ConnectorError';
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}
