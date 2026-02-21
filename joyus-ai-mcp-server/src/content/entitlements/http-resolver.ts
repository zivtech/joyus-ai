/**
 * Content Infrastructure — HTTP Entitlement Resolver
 *
 * Generic HTTP-based resolver that queries any REST endpoint for
 * user entitlements. Supports GET and POST, three auth types, and
 * configurable response field mapping.
 *
 * SC-004: Resolution must complete <500ms. Default timeout: 2000ms (conservative).
 */

import axios, { type AxiosRequestConfig } from 'axios';

import type { ResolvedEntitlements } from '../types.js';
import type {
  EntitlementResolver,
  EntitlementResolverConfig,
  ResolverContext,
} from './interface.js';

// ============================================================
// CONFIG
// ============================================================

export interface HttpResolverConfig extends EntitlementResolverConfig {
  baseUrl: string;
  endpoint: string;
  method: 'GET' | 'POST';
  authType: 'none' | 'bearer' | 'api-key';
  /** Encrypted auth credential (bearer token or API key value) */
  authValue?: string;
  /** Header name for api-key auth type. Defaults to 'X-Api-Key'. */
  apiKeyHeader?: string;
  timeoutMs: number;
  responseMapping: {
    /** Top-level field name in the JSON response that contains the products array */
    productsField: string;
    /** Optional top-level field name for TTL value (seconds) */
    ttlField?: string;
  };
}

// ============================================================
// IMPLEMENTATION
// ============================================================

export class HttpEntitlementResolver implements EntitlementResolver {
  constructor(private readonly config: HttpResolverConfig) {}

  async resolve(
    userId: string,
    tenantId: string,
    context: ResolverContext,
  ): Promise<ResolvedEntitlements> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/${this.config.endpoint.replace(/^\//, '')}`;

    const requestConfig: AxiosRequestConfig = {
      method: this.config.method,
      url,
      timeout: this.config.timeoutMs ?? 2000,
      headers: this.buildHeaders(),
    };

    if (this.config.method === 'GET') {
      requestConfig.params = { userId, tenantId, sessionId: context.sessionId };
    } else {
      requestConfig.data = { userId, tenantId, sessionId: context.sessionId };
    }

    let response: Record<string, unknown>;
    try {
      const res = await axios(requestConfig);
      response = res.data as Record<string, unknown>;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNABORTED') {
          throw new Error(`Entitlement resolver timed out after ${this.config.timeoutMs}ms`);
        }
        const status = err.response?.status ?? 0;
        if (status >= 400 && status < 500) {
          throw new Error(`Entitlement resolver returned client error: ${status}`);
        }
        if (status >= 500) {
          throw new Error(`Entitlement resolver returned server error: ${status}`);
        }
      }
      throw new Error('Entitlement resolver request failed');
    }

    const rawProducts = response[this.config.responseMapping.productsField];
    if (!Array.isArray(rawProducts)) {
      throw new Error(
        `Entitlement resolver response missing expected field: ${this.config.responseMapping.productsField}`,
      );
    }
    const productIds = rawProducts.filter((p): p is string => typeof p === 'string');

    let ttlSeconds = this.config.defaultTtlSeconds;
    if (this.config.responseMapping.ttlField) {
      const rawTtl = response[this.config.responseMapping.ttlField];
      if (typeof rawTtl === 'number' && rawTtl > 0) {
        ttlSeconds = rawTtl;
      }
    }

    return {
      productIds,
      sourceIds: [],   // Populated by EntitlementService after DB join
      profileIds: [],  // Populated by EntitlementService after DB join
      resolvedFrom: this.config.name,
      resolvedAt: new Date(),
      ttlSeconds,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    switch (this.config.authType) {
      case 'bearer':
        if (this.config.authValue) {
          headers['Authorization'] = `Bearer ${this.config.authValue}`;
        }
        break;
      case 'api-key': {
        const headerName = this.config.apiKeyHeader ?? 'X-Api-Key';
        if (this.config.authValue) {
          headers[headerName] = this.config.authValue;
        }
        break;
      }
      case 'none':
      default:
        break;
    }

    return headers;
  }
}
