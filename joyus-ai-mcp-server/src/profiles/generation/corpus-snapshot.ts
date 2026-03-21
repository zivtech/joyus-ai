/**
 * Profile Generation — Corpus Snapshot Service
 *
 * Creates and retrieves immutable corpus snapshots.
 * Snapshots are append-only — no update or delete methods.
 * All operations are tenant-scoped via requireTenantId / assertTenantOwnership.
 */

import { eq, desc } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { createHash } from 'crypto';

import { db } from '../../db/client.js';
import {
  corpusSnapshots,
  corpusDocuments,
  type CorpusSnapshot,
  type CorpusDocument,
} from '../schema.js';
import { requireTenantId, assertTenantOwnership, tenantWhere } from '../tenant-scope.js';

// ============================================================
// TYPES
// ============================================================

export interface CreateSnapshotOptions {
  /** Human-readable label for this snapshot. Defaults to an ISO timestamp. */
  name?: string;
}

export interface SnapshotListOptions {
  limit?: number;
  offset?: number;
}

// ============================================================
// SERVICE
// ============================================================

export class CorpusSnapshotService {
  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  /**
   * Create an immutable snapshot of the current active corpus for a tenant.
   * Computes document hashes and aggregate counts at snapshot time.
   */
  async createSnapshot(
    tenantId: string,
    options?: CreateSnapshotOptions,
  ): Promise<CorpusSnapshot> {
    requireTenantId(tenantId);

    // Fetch all active documents for this tenant
    const docs = await db
      .select()
      .from(corpusDocuments)
      .where(
        tenantWhere(corpusDocuments, tenantId, eq(corpusDocuments.isActive, true)),
      );

    const documentHashes = docs.map((d) => d.contentHash);
    const documentCount = docs.length;
    const totalWordCount = docs.reduce((sum, d) => sum + (d.wordCount ?? 0), 0);

    // Count unique authors
    const authorSet = new Set(docs.map((d) => d.authorId));
    const authorCount = authorSet.size;

    const name =
      options?.name ??
      `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}`;

    const [inserted] = await db
      .insert(corpusSnapshots)
      .values({
        id: createId(),
        tenantId,
        name,
        documentHashes,
        documentCount,
        authorCount,
        totalWordCount,
      })
      .returning();

    return inserted;
  }

  /**
   * Fetch a single snapshot by ID, asserting it belongs to the given tenant.
   */
  async getSnapshot(tenantId: string, snapshotId: string): Promise<CorpusSnapshot | null> {
    requireTenantId(tenantId);

    const [row] = await db
      .select()
      .from(corpusSnapshots)
      .where(tenantWhere(corpusSnapshots, tenantId, eq(corpusSnapshots.id, snapshotId)))
      .limit(1);

    if (!row) {
      return null;
    }

    assertTenantOwnership(row, tenantId);
    return row;
  }

  /**
   * List snapshots for a tenant, ordered newest-first.
   */
  async listSnapshots(
    tenantId: string,
    options?: SnapshotListOptions,
  ): Promise<CorpusSnapshot[]> {
    requireTenantId(tenantId);

    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    return db
      .select()
      .from(corpusSnapshots)
      .where(tenantWhere(corpusSnapshots, tenantId))
      .orderBy(desc(corpusSnapshots.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Fetch the corpus documents that were captured in a snapshot.
   * Matches on content hash to reconstruct the snapshot's document set.
   */
  async getSnapshotDocuments(
    tenantId: string,
    snapshotId: string,
  ): Promise<CorpusDocument[]> {
    requireTenantId(tenantId);

    const snapshot = await this.getSnapshot(tenantId, snapshotId);
    if (!snapshot) {
      return [];
    }

    const hashes = snapshot.documentHashes as string[];
    if (hashes.length === 0) {
      return [];
    }

    // Fetch all active docs for this tenant, then filter to snapshot hashes
    const docs = await db
      .select()
      .from(corpusDocuments)
      .where(tenantWhere(corpusDocuments, tenantId));

    return docs.filter((d) => hashes.includes(d.contentHash));
  }

  // ----------------------------------------------------------
  // INTERNAL HELPERS
  // ----------------------------------------------------------

  /** Compute a SHA-256 content hash for deduplication. */
  static hashContent(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }
}
