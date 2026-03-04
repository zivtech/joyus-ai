/**
 * ApiConnector
 *
 * ContentConnector implementation for REST and GraphQL APIs.
 * Supports offset-based, cursor-based, and Link-header pagination.
 * Supports none / bearer / api-key / basic authentication.
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { decryptToken } from '../../db/encryption.js';
import type { ConnectorConfig, ApiConnectorConfig } from '../types.js';
import {
  type ContentConnector,
  type ContentPayload,
  type DiscoveryResult,
  type HealthStatus,
  type IndexBatchResult,
  ConnectorError,
  measureHealth,
} from './interface.js';

// ============================================================
// HELPERS
// ============================================================

function asApiConfig(config: ConnectorConfig): ApiConnectorConfig {
  return config as ApiConnectorConfig;
}

/**
 * Build an Axios instance pre-configured with auth and custom headers.
 * Credentials stored in connectionConfig are encrypted; decrypt before use.
 */
function buildClient(cfg: ApiConnectorConfig): AxiosInstance {
  const headers: Record<string, string> = { ...(cfg.headers ?? {}) };

  if (cfg.authType === 'bearer' && cfg.token) {
    const token = decryptToken(cfg.token as string);
    headers['Authorization'] = `Bearer ${token}`;
  } else if (cfg.authType === 'api-key' && cfg.apiKey) {
    const key = decryptToken(cfg.apiKey as string);
    const headerName = (cfg.apiKeyHeader as string | undefined) ?? 'X-Api-Key';
    headers[headerName] = key;
  }

  const axiosCfg: AxiosRequestConfig = {
    baseURL: cfg.baseUrl,
    headers,
    timeout: 15_000,
  };

  if (cfg.authType === 'basic' && cfg.username && cfg.password) {
    axiosCfg.auth = {
      username: cfg.username as string,
      password: decryptToken(cfg.password as string),
    };
  }

  return axios.create(axiosCfg);
}

/**
 * Extract next-page URL from Link response header.
 * Returns null when no "next" relation is present.
 */
function parseLinkHeader(linkHeader: string | undefined): string | null {
  if (!linkHeader) return null;
  // Format: <https://api.example.com/items?page=2>; rel="next", ...
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

/**
 * Map a raw API response item to ContentPayload using field mapping config.
 */
function mapItem(
  raw: Record<string, unknown>,
  cfg: ApiConnectorConfig
): ContentPayload {
  const fieldMap = cfg.fieldMapping as Record<string, string> | undefined;

  const refField = fieldMap?.['sourceRef'] ?? 'id';
  const titleField = fieldMap?.['title'] ?? 'title';
  const bodyField = fieldMap?.['body'] ?? 'body';

  const sourceRef = String(raw[refField] ?? '');
  const title = String(raw[titleField] ?? '');
  const body = raw[bodyField] != null ? String(raw[bodyField]) : null;

  // Everything else goes into metadata
  const knownFields = new Set([refField, titleField, bodyField]);
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!knownFields.has(k)) {
      metadata[k] = v;
    }
  }

  return { sourceRef, title, body, contentType: 'text', metadata };
}

/**
 * Safely extract an array of items from a response body.
 * Handles both top-level arrays and objects with a data/items/results key.
 */
function extractItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['data', 'items', 'results', 'records']) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

// ============================================================
// CONNECTOR
// ============================================================

export class ApiConnector implements ContentConnector {
  readonly type = 'rest-api';

  async discover(config: ConnectorConfig): Promise<DiscoveryResult> {
    const cfg = asApiConfig(config);
    const client = buildClient(cfg);

    try {
      // Call the list endpoint with limit=0 to enumerate the collection
      const listPath = cfg.endpoints.list;
      const limitParam = cfg.pagination?.limitParam ?? 'limit';

      const res = await client.get(listPath, {
        params: { [limitParam]: 0 },
      });

      const items = extractItems(res.data);
      // Try to get a total count from common response fields
      let totalEstimate = 0;
      if (res.data && typeof res.data === 'object') {
        const obj = res.data as Record<string, unknown>;
        for (const key of ['total', 'count', 'totalCount', 'total_count']) {
          if (typeof obj[key] === 'number') {
            totalEstimate = obj[key] as number;
            break;
          }
        }
      }
      if (totalEstimate === 0) totalEstimate = items.length;

      return {
        collections: [
          {
            name: listPath,
            itemEstimate: totalEstimate,
            fields: items.length > 0 ? Object.keys(items[0]!) : [],
          },
        ],
        totalEstimate,
      };
    } catch (err) {
      throw new ConnectorError(
        'Failed to discover API collections',
        cfg.baseUrl,
        this.type,
        'discover',
        err
      );
    }
  }

  async indexBatch(
    config: ConnectorConfig,
    cursor: string | null,
    batchSize: number
  ): Promise<IndexBatchResult> {
    const cfg = asApiConfig(config);
    const client = buildClient(cfg);
    const pagination = cfg.pagination;

    try {
      let items: Record<string, unknown>[];
      let nextCursor: string | null = null;

      if (pagination?.type === 'cursor') {
        // Cursor-based pagination
        const params: Record<string, unknown> = {
          [pagination.limitParam ?? 'limit']: batchSize,
        };
        if (cursor != null) {
          params[pagination.paramName] = cursor;
        }

        const res = await client.get(cfg.endpoints.list, { params });
        items = extractItems(res.data);

        // Extract next cursor from response body or Link header
        const linkNext = parseLinkHeader(res.headers['link']);
        if (linkNext) {
          nextCursor = linkNext;
        } else if (res.data && typeof res.data === 'object') {
          const obj = res.data as Record<string, unknown>;
          const next = obj['next_cursor'] ?? obj['nextCursor'] ?? obj['cursor'];
          nextCursor = next != null ? String(next) : null;
        }
      } else if (pagination?.type === 'offset') {
        // Offset / page-based pagination
        const offset = cursor != null ? parseInt(cursor, 10) : 0;
        const params: Record<string, unknown> = {
          [pagination.limitParam ?? 'limit']: batchSize,
          [pagination.paramName]: offset,
        };

        const res = await client.get(cfg.endpoints.list, { params });
        items = extractItems(res.data);
        nextCursor = items.length === batchSize ? String(offset + batchSize) : null;
      } else {
        // Link-header pagination (default / no pagination config)
        const url = cursor ?? cfg.endpoints.list;
        const res = await client.get(url, {
          params: cursor ? undefined : { limit: batchSize },
        });
        items = extractItems(res.data);
        nextCursor = parseLinkHeader(res.headers['link']);
      }

      const payloads = items.map((item) => mapItem(item, cfg));
      return { items: payloads, nextCursor, totalProcessed: payloads.length };
    } catch (err) {
      throw new ConnectorError(
        'Failed to index batch from API',
        cfg.baseUrl,
        this.type,
        'indexBatch',
        err
      );
    }
  }

  async fetchContent(config: ConnectorConfig, itemRef: string): Promise<ContentPayload> {
    const cfg = asApiConfig(config);
    const client = buildClient(cfg);

    const detailPath = cfg.endpoints.detail
      ? cfg.endpoints.detail.replace('{ref}', encodeURIComponent(itemRef))
      : `${cfg.endpoints.list}/${encodeURIComponent(itemRef)}`;

    try {
      const res = await client.get(detailPath);
      const data = res.data as Record<string, unknown>;
      return mapItem(data, cfg);
    } catch (err) {
      throw new ConnectorError(
        `Failed to fetch content item ${itemRef} from API`,
        cfg.baseUrl,
        this.type,
        'fetchContent',
        err
      );
    }
  }

  async healthCheck(config: ConnectorConfig): Promise<HealthStatus> {
    const cfg = asApiConfig(config);
    const client = buildClient(cfg);

    return measureHealth(async () => {
      await client.get(cfg.endpoints.list, { params: { limit: 1 } });
    });
  }
}
