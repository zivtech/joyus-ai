/**
 * Deduplication service for corpus document intake.
 *
 * Deduplication is scoped strictly per-tenant (FR-007): the same document
 * content uploaded by two different tenants is NOT considered a duplicate.
 * Content hashes are computed from NORMALIZED text (not raw file bytes) so
 * that minor formatting differences do not produce false negatives.
 */

import { createHash } from 'node:crypto';
import { eq, and, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { corpusDocuments } from '../schema.js';
import { requireTenantId } from '../tenant-scope.js';

/** Result from a single duplicate check. */
export interface DuplicateCheckResult {
  /** True when an identical document already exists in this tenant's corpus. */
  isDuplicate: boolean;
  /** ID of the existing document, if a duplicate was found. */
  existingDocumentId?: string;
  /** Original filename of the existing document, if a duplicate was found. */
  existingFilename?: string;
}

/** Result entry from a batch duplicate check. */
export interface BatchDuplicateCheckResult {
  contentHash: string;
  isDuplicate: boolean;
  existingDocumentId?: string;
  existingFilename?: string;
}

export class DeduplicationService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly db: NodePgDatabase<any>,
  ) {}

  /**
   * Compute a SHA-256 hex hash of the supplied normalized text.
   * The input MUST already be normalized via `normalizeText()`.
   *
   * @param normalizedText  Text after the standard normalization pipeline.
   * @returns               Lowercase hex SHA-256 digest.
   */
  computeContentHash(normalizedText: string): string {
    return createHash('sha256').update(normalizedText, 'utf8').digest('hex');
  }

  /**
   * Check whether a document with the given content hash already exists in
   * the specified tenant's corpus.
   *
   * @param tenantId     Tenant identifier (required, fail-closed).
   * @param contentHash  SHA-256 hex hash of the document's normalized text.
   */
  async checkDuplicate(
    tenantId: string,
    contentHash: string,
  ): Promise<DuplicateCheckResult> {
    requireTenantId(tenantId);

    const rows = await this.db
      .select({
        id: corpusDocuments.id,
        originalFilename: corpusDocuments.originalFilename,
      })
      .from(corpusDocuments)
      .where(
        and(
          eq(corpusDocuments.tenantId, tenantId),
          eq(corpusDocuments.contentHash, contentHash),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return { isDuplicate: false };
    }

    return {
      isDuplicate: true,
      existingDocumentId: rows[0].id,
      existingFilename: rows[0].originalFilename,
    };
  }

  /**
   * Batch-check a list of content hashes for duplicates within the tenant's
   * corpus. Uses a single IN-clause query for efficiency.
   *
   * @param tenantId      Tenant identifier (required, fail-closed).
   * @param contentHashes Array of SHA-256 hex hashes to check.
   * @returns             One result entry per hash, preserving input order.
   */
  async checkDuplicateBatch(
    tenantId: string,
    contentHashes: string[],
  ): Promise<BatchDuplicateCheckResult[]> {
    requireTenantId(tenantId);

    if (contentHashes.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({
        id: corpusDocuments.id,
        contentHash: corpusDocuments.contentHash,
        originalFilename: corpusDocuments.originalFilename,
      })
      .from(corpusDocuments)
      .where(
        and(
          eq(corpusDocuments.tenantId, tenantId),
          inArray(corpusDocuments.contentHash, contentHashes),
        ),
      );

    // Build a lookup map for O(1) access per hash
    const found = new Map(rows.map((r) => [r.contentHash, r]));

    return contentHashes.map((hash) => {
      const existing = found.get(hash);
      if (!existing) {
        return { contentHash: hash, isDuplicate: false };
      }
      return {
        contentHash: hash,
        isDuplicate: true,
        existingDocumentId: existing.id,
        existingFilename: existing.originalFilename,
      };
    });
  }
}
