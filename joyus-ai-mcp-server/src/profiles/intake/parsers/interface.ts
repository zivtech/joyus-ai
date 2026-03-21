/**
 * Document parser interface for corpus intake.
 *
 * Each parser handles one or more file formats and extracts plain text
 * plus structured metadata from a raw file buffer.
 */

import type { ParseResult } from '../../types.js';

/**
 * Contract for all document parsers in the intake pipeline.
 *
 * Implementations must be stateless — a single instance may be used to
 * parse many documents concurrently.
 */
export interface DocumentParser {
  /** Unique identifier for this parser (e.g. "pdf", "docx", "text"). */
  readonly name: string;

  /** MIME types handled by this parser (e.g. ["application/pdf"]). */
  readonly supportedMimeTypes: string[];

  /** File extensions handled by this parser, without leading dot (e.g. ["pdf"]). */
  readonly supportedExtensions: string[];

  /**
   * Parse a document buffer and return extracted text with metadata.
   *
   * Implementations must NOT throw on recoverable errors (e.g. corrupt
   * documents). Instead, return a ParseResult with empty text and a
   * descriptive entry in `warnings`.
   *
   * @param buffer    Raw file bytes.
   * @param filename  Original filename (used for format hints / metadata).
   * @returns         Extracted text, structured metadata, and any warnings.
   */
  parse(buffer: Buffer, filename: string): Promise<ParseResult>;
}
