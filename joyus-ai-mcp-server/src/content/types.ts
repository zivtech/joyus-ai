/**
 * Content Infrastructure — Shared Types & Constants
 *
 * TypeScript types and constants shared across content modules.
 */

// ============================================================
// STRING LITERAL UNION TYPES
// ============================================================

export type SourceType = 'relational-database' | 'rest-api';

export type SyncStrategy = 'mirror' | 'pass-through' | 'hybrid';

export type SourceStatus = 'active' | 'syncing' | 'error' | 'disconnected';

export type SyncRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type SyncTrigger = 'scheduled' | 'manual';

export type ContentOperationType = 'sync' | 'search' | 'resolve' | 'generate' | 'mediate';

// ============================================================
// CONNECTOR CONFIGURATION TYPES
// ============================================================

export interface ConnectorConfig {
  [key: string]: unknown;
}

export interface DatabaseConnectorConfig extends ConnectorConfig {
  host: string;
  port: number;
  database: string;
  table: string;
  columns: {
    id: string;
    title: string;
    body?: string;
    metadata?: string[];
  };
  ssl?: boolean;
  schema?: string;
}

export interface ApiConnectorConfig extends ConnectorConfig {
  baseUrl: string;
  authType: 'bearer' | 'api-key' | 'basic' | 'none';
  headers?: Record<string, string>;
  endpoints: {
    list: string;
    detail?: string;
  };
  pagination?: {
    type: 'cursor' | 'offset';
    paramName: string;
    limitParam?: string;
    defaultLimit?: number;
  };
}

// ============================================================
// SERVICE RESULT TYPES
// ============================================================

export interface SearchResult {
  itemId: string;
  sourceId: string;
  title: string;
  excerpt: string;
  score: number;
  metadata: Record<string, unknown>;
  isStale: boolean;
}

export interface ResolvedEntitlements {
  productIds: string[];
  sourceIds: string[];
  profileIds: string[];
  resolvedFrom: string;
  resolvedAt: Date;
  /** TTL hint from the resolver backend, in seconds. Used by cache and persistence. */
  ttlSeconds?: number;
}

export interface GenerationResult {
  text: string;
  citations: Citation[];
  profileUsed: string | null;
  metadata: {
    totalSearchResults: number;
    sourcesUsed: number;
    durationMs: number;
  };
}

export interface Citation {
  sourceId: string;
  itemId: string;
  title: string;
  excerpt: string;
  sourceType: string;
}

// ============================================================
// CONSTANTS
// ============================================================

export const DEFAULT_BATCH_SIZE = 100;
export const MAX_SEARCH_LIMIT = 100;
export const DEFAULT_FRESHNESS_WINDOW_MINUTES = 1440; // 24 hours
