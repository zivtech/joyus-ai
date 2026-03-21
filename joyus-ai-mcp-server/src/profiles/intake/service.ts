/**
 * Intake orchestrator — coordinates parsing, deduplication, and storage
 * for corpus document ingestion.
 *
 * Design principles:
 *  - Per-document errors are non-fatal: unsupported formats, parse failures,
 *    and duplicates are all recorded in the result and execution continues.
 *  - A corpus snapshot is created only when at least one document was stored.
 *  - All DB writes are tenant-scoped (tenantId injected from auth layer).
 */

import { createId } from '@paralleldrive/cuid2';
import { eq, and, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { corpusDocuments, corpusSnapshots } from '../schema.js';
import { requireTenantId } from '../tenant-scope.js';
import type { DocumentParser } from './parsers/interface.js';
import { ParserRegistry } from './parsers/registry.js';
import { DeduplicationService } from './dedup.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

/** A single document submitted for ingestion. */
export interface IntakeDocument {
  /** Raw file bytes. */
  buffer: Buffer;
  /** Original filename (used for format detection and storage). */
  filename: string;
  /** Author identity string (optional; defaults recorded as empty string). */
  authorId?: string;
  /** Human-readable author name (optional). */
  authorName?: string;
}

/** Per-document outcome within an IntakeResult. */
export interface IntakeDocumentResult {
  /** Original filename. */
  filename: string;
  /** Terminal status for this document. */
  status: 'stored' | 'duplicate' | 'unsupported' | 'parse_error' | 'empty';
  /** ID of the newly stored corpus document (status === 'stored' only). */
  documentId?: string;
  /** ID of the document this is a duplicate of (status === 'duplicate' only). */
  duplicateOf?: string;
  /** Error detail for status === 'parse_error'. */
  error?: string;
  /** Non-fatal warnings from the parser. */
  warnings: string[];
}

/** Aggregate result from an ingest() call. */
export interface IntakeResult {
  /** Total documents submitted. */
  processed: number;
  /** Documents successfully stored in the corpus. */
  stored: number;
  /** Documents that were already in the corpus (content hash match). */
  duplicates: number;
  /** Documents rejected (unsupported format, parse error, or empty). */
  rejected: number;
  /** Fatal error messages (rare — most errors appear per-document). */
  errors: string[];
  /** Aggregate non-fatal warnings. */
  warnings: string[];
  /** IDs of newly stored corpus documents. */
  documentIds: string[];
  /** ID of the corpus snapshot created from this batch (undefined if nothing stored). */
  snapshotId?: string;
  /** Per-document results in input order. */
  documentResults: IntakeDocumentResult[];
}

// ============================================================
// SERVICE
// ============================================================

export class IntakeService {
  private readonly dedup: DeduplicationService;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly db: NodePgDatabase<any>,
    private readonly registry: ParserRegistry,
  ) {
    this.dedup = new DeduplicationService(db);
  }

  /**
   * Register an additional parser at runtime. Useful for testing or for
   * loading optional parsers after construction.
   */
  registerParser(parser: DocumentParser): void {
    this.registry.register(parser);
  }

  /**
   * Ingest a batch of documents into the tenant's corpus.
   *
   * Processing order per document:
   *  1. Check format support — skip (unsupported) if not recognized.
   *  2. Parse the buffer — skip (parse_error) on failure.
   *  3. Skip empty documents after parsing (empty).
   *  4. Compute content hash from normalized text.
   *  5. Dedup check — skip (duplicate) if hash already in corpus.
   *  6. Insert into corpus_documents.
   *
   * After all documents are processed, a corpus snapshot is created if at
   * least one document was stored.
   *
   * @param tenantId   Tenant identifier from the authenticated session.
   * @param documents  Documents to ingest.
   * @param snapshotName  Name for the resulting corpus snapshot.
   * @returns          Aggregate intake result.
   */
  async ingest(
    tenantId: string,
    documents: IntakeDocument[],
    snapshotName: string,
  ): Promise<IntakeResult> {
    requireTenantId(tenantId);

    // Empty batch — return early
    if (documents.length === 0) {
      return this.emptyResult();
    }

    const documentResults: IntakeDocumentResult[] = [];
    const storedIds: string[] = [];
    let duplicateCount = 0;
    let rejectedCount = 0;
    const aggregateWarnings: string[] = [];

    for (const doc of documents) {
      const result = await this.processDocument(tenantId, doc);
      documentResults.push(result);

      if (result.status === 'stored') {
        if (result.documentId) storedIds.push(result.documentId);
      } else if (result.status === 'duplicate') {
        duplicateCount++;
      } else {
        // unsupported | parse_error | empty
        rejectedCount++;
      }

      aggregateWarnings.push(...result.warnings);
    }

    // Create snapshot only when something was stored
    let snapshotId: string | undefined;
    if (storedIds.length > 0) {
      snapshotId = await this.createSnapshot(tenantId, snapshotName, storedIds);
    }

    return {
      processed: documents.length,
      stored: storedIds.length,
      duplicates: duplicateCount,
      rejected: rejectedCount,
      errors: [],
      warnings: aggregateWarnings,
      documentIds: storedIds,
      snapshotId,
      documentResults,
    };
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private async processDocument(
    tenantId: string,
    doc: IntakeDocument,
  ): Promise<IntakeDocumentResult> {
    // Step 1: format support check
    if (!this.registry.isSupported(doc.filename)) {
      return {
        filename: doc.filename,
        status: 'unsupported',
        warnings: [`Unsupported file format: ${doc.filename}`],
      };
    }

    // Step 2: parse
    const parser = this.registry.getParserForFile(doc.filename);
    if (!parser) {
      // Shouldn't happen after isSupported(), but guard defensively
      return {
        filename: doc.filename,
        status: 'unsupported',
        warnings: [`No parser found for: ${doc.filename}`],
      };
    }

    let parseResult;
    try {
      parseResult = await parser.parse(doc.buffer, doc.filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        filename: doc.filename,
        status: 'parse_error',
        error: message,
        warnings: [],
      };
    }

    // Step 3: empty text check
    if (!parseResult.text) {
      return {
        filename: doc.filename,
        status: 'empty',
        warnings: parseResult.warnings,
      };
    }

    // Step 4: content hash (from normalized text)
    const contentHash = this.dedup.computeContentHash(parseResult.text);

    // Step 5: dedup check
    const dupCheck = await this.dedup.checkDuplicate(tenantId, contentHash);
    if (dupCheck.isDuplicate) {
      return {
        filename: doc.filename,
        status: 'duplicate',
        duplicateOf: dupCheck.existingDocumentId,
        warnings: parseResult.warnings,
      };
    }

    // Step 6: store
    const documentId = createId();
    const ext = this.extractExtension(doc.filename);
    const format = this.extToFormat(ext);
    const authorId = doc.authorId ?? '';
    const authorName = doc.authorName ?? '';
    const wordCount = parseResult.metadata.wordCount ?? 0;

    await this.db.insert(corpusDocuments).values({
      id: documentId,
      tenantId,
      contentHash,
      originalFilename: doc.filename,
      format,
      title: parseResult.metadata.title ?? null,
      authorId,
      authorName,
      extractedText: parseResult.text,
      wordCount,
      metadata: parseResult.metadata as Record<string, unknown>,
    });

    return {
      filename: doc.filename,
      status: 'stored',
      documentId,
      warnings: parseResult.warnings,
    };
  }

  private async createSnapshot(
    tenantId: string,
    name: string,
    storedIds: string[],
  ): Promise<string> {
    const snapshotId = createId();

    // Fetch stored docs to get hashes + author counts
    const storedRows = await this.db
      .select({
        contentHash: corpusDocuments.contentHash,
        authorId: corpusDocuments.authorId,
        wordCount: corpusDocuments.wordCount,
      })
      .from(corpusDocuments)
      .where(
        and(
          eq(corpusDocuments.tenantId, tenantId),
          inArray(corpusDocuments.id, storedIds),
        ),
      );

    const documentHashes = storedRows.map((r) => r.contentHash);
    const uniqueAuthors = new Set(storedRows.map((r) => r.authorId).filter(Boolean));
    const totalWordCount = storedRows.reduce((sum, r) => sum + (r.wordCount ?? 0), 0);

    await this.db.insert(corpusSnapshots).values({
      id: snapshotId,
      tenantId,
      name,
      documentHashes,
      documentCount: storedIds.length,
      authorCount: uniqueAuthors.size,
      totalWordCount,
    });

    return snapshotId;
  }

  private extractExtension(filename: string): string {
    const base = filename.split('/').pop() ?? filename;
    const dotIdx = base.lastIndexOf('.');
    if (dotIdx === -1) return '';
    return base.slice(dotIdx + 1).toLowerCase();
  }

  private extToFormat(ext: string): 'pdf' | 'docx' | 'txt' | 'html' | 'md' {
    switch (ext) {
      case 'pdf': return 'pdf';
      case 'docx': return 'docx';
      case 'html':
      case 'htm': return 'html';
      case 'md':
      case 'markdown': return 'md';
      default: return 'txt';
    }
  }

  private emptyResult(): IntakeResult {
    return {
      processed: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      errors: [],
      warnings: [],
      documentIds: [],
      snapshotId: undefined,
      documentResults: [],
    };
  }
}
