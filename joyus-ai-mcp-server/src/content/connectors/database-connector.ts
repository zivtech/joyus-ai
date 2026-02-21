/**
 * DatabaseConnector
 *
 * ContentConnector implementation for relational databases (PostgreSQL/MySQL).
 * Queries tables/views directly using a dedicated connection pool — NOT the
 * application's Drizzle client. Credentials are decrypted before use.
 */

import { Pool } from 'pg';
import { decryptToken } from '../../db/encryption.js';
import type { ConnectorConfig, DatabaseConnectorConfig } from '../types.js';
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

function asDbConfig(config: ConnectorConfig): DatabaseConnectorConfig {
  return config as DatabaseConnectorConfig;
}

/**
 * Creates a short-lived Pool for a single external source.
 * The password field is expected to be encrypted via encryptToken.
 */
function buildPool(cfg: DatabaseConnectorConfig): Pool {
  // Decrypt the password stored in connectionConfig
  const password = cfg.password ? decryptToken(cfg.password as string) : undefined;

  return new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user as string | undefined,
    password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

function qualifiedTable(cfg: DatabaseConnectorConfig): string {
  const schema = cfg.schema ?? 'public';
  return `"${schema}"."${cfg.table}"`;
}

function rowToPayload(
  row: Record<string, unknown>,
  cfg: DatabaseConnectorConfig
): ContentPayload {
  const { id: idCol, title: titleCol, body: bodyCol, metadata: metaCols } = cfg.columns;

  const sourceRef = String(row[idCol] ?? '');
  const title = String(row[titleCol] ?? '');
  const body = bodyCol != null && row[bodyCol] != null ? String(row[bodyCol]) : null;

  const metadata: Record<string, unknown> = {};
  if (metaCols) {
    for (const col of metaCols) {
      if (row[col] !== undefined) {
        metadata[col] = row[col];
      }
    }
  }

  return { sourceRef, title, body, contentType: 'text', metadata };
}

// ============================================================
// CONNECTOR
// ============================================================

export class DatabaseConnector implements ContentConnector {
  readonly type = 'relational-database';

  async discover(config: ConnectorConfig): Promise<DiscoveryResult> {
    const cfg = asDbConfig(config);
    const pool = buildPool(cfg);
    try {
      const schema = cfg.schema ?? 'public';

      // List tables and views in the target schema
      const tablesRes = await pool.query<{
        table_name: string;
        table_type: string;
      }>(
        `SELECT table_name, table_type
         FROM information_schema.tables
         WHERE table_schema = $1
           AND table_type IN ('BASE TABLE', 'VIEW')
         ORDER BY table_name`,
        [schema]
      );

      const collections = await Promise.all(
        tablesRes.rows.map(async (tbl) => {
          // Estimate row count from pg stats (fast, approximate)
          const countRes = await pool.query<{ estimate: string }>(
            `SELECT reltuples::bigint AS estimate
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2`,
            [schema, tbl.table_name]
          );
          const itemEstimate = parseInt(countRes.rows[0]?.estimate ?? '0', 10);

          // List column names
          const colRes = await pool.query<{ column_name: string }>(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2
             ORDER BY ordinal_position`,
            [schema, tbl.table_name]
          );
          const fields = colRes.rows.map((r) => r.column_name);

          return { name: tbl.table_name, itemEstimate, fields };
        })
      );

      const totalEstimate = collections.reduce((sum, c) => sum + c.itemEstimate, 0);
      return { collections, totalEstimate };
    } catch (err) {
      throw new ConnectorError(
        'Failed to discover database schema',
        cfg.host,
        this.type,
        'discover',
        err
      );
    } finally {
      await pool.end();
    }
  }

  async indexBatch(
    config: ConnectorConfig,
    cursor: string | null,
    batchSize: number
  ): Promise<IndexBatchResult> {
    const cfg = asDbConfig(config);
    const pool = buildPool(cfg);
    const idCol = cfg.columns.id;
    const table = qualifiedTable(cfg);

    try {
      // Keyset pagination: cursor is the last seen id value (as string)
      let rows: Record<string, unknown>[];

      if (cursor != null) {
        const res = await pool.query(
          `SELECT * FROM ${table}
           WHERE "${idCol}" > $1
           ORDER BY "${idCol}" ASC
           LIMIT $2`,
          [cursor, batchSize]
        );
        rows = res.rows as Record<string, unknown>[];
      } else {
        const res = await pool.query(
          `SELECT * FROM ${table}
           ORDER BY "${idCol}" ASC
           LIMIT $1`,
          [batchSize]
        );
        rows = res.rows as Record<string, unknown>[];
      }

      const items = rows.map((row) => rowToPayload(row, cfg));
      const nextCursor =
        rows.length === batchSize ? String(rows[rows.length - 1]![idCol]) : null;

      return { items, nextCursor, totalProcessed: items.length };
    } catch (err) {
      throw new ConnectorError(
        'Failed to index batch from database',
        cfg.host,
        this.type,
        'indexBatch',
        err
      );
    } finally {
      await pool.end();
    }
  }

  async fetchContent(config: ConnectorConfig, itemRef: string): Promise<ContentPayload> {
    const cfg = asDbConfig(config);
    const pool = buildPool(cfg);
    const idCol = cfg.columns.id;
    const table = qualifiedTable(cfg);

    try {
      const res = await pool.query(
        `SELECT * FROM ${table} WHERE "${idCol}" = $1 LIMIT 1`,
        [itemRef]
      );

      if (res.rows.length === 0) {
        throw new ConnectorError(
          `Item not found: ${itemRef}`,
          cfg.host,
          this.type,
          'fetchContent'
        );
      }

      return rowToPayload(res.rows[0] as Record<string, unknown>, cfg);
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(
        'Failed to fetch content item from database',
        cfg.host,
        this.type,
        'fetchContent',
        err
      );
    } finally {
      await pool.end();
    }
  }

  async healthCheck(config: ConnectorConfig): Promise<HealthStatus> {
    const cfg = asDbConfig(config);
    const pool = buildPool(cfg);

    const status = await measureHealth(async () => {
      await pool.query('SELECT 1');
    });

    await pool.end();
    return status;
  }
}
