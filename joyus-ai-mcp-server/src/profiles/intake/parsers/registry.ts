/**
 * Parser registry — maps file extensions and MIME types to DocumentParser
 * implementations.
 *
 * Parsers are registered at startup and looked up at intake time. The
 * registry is intentionally simple: first-match wins for both extension
 * and MIME type lookups.
 */

import type { DocumentParser } from './interface.js';

/**
 * Central registry for document parsers.
 *
 * Usage:
 * ```ts
 * const registry = new ParserRegistry();
 * registry.register(new PdfParser());
 * registry.register(new DocxParser());
 *
 * const parser = registry.getParserForFile('report.pdf');
 * if (parser) {
 *   const result = await parser.parse(buffer, 'report.pdf');
 * }
 * ```
 */
export class ParserRegistry {
  private readonly parsers: DocumentParser[] = [];

  /**
   * Register a parser. Later registrations do not override earlier ones for
   * the same extension or MIME type — first-registered wins.
   *
   * @param parser  Parser implementation to register.
   */
  register(parser: DocumentParser): void {
    this.parsers.push(parser);
  }

  /**
   * Find a parser for the given filename based on its extension.
   *
   * @param filename  Original filename (may include path components).
   * @returns         Matching parser, or undefined if none registered.
   */
  getParserForFile(filename: string): DocumentParser | undefined {
    const ext = this.extractExtension(filename);
    if (!ext) return undefined;
    return this.parsers.find((p) =>
      p.supportedExtensions.includes(ext),
    );
  }

  /**
   * Find a parser for the given MIME type.
   *
   * @param mimeType  MIME type string (e.g. "application/pdf").
   * @returns         Matching parser, or undefined if none registered.
   */
  getParserForMimeType(mimeType: string): DocumentParser | undefined {
    const normalized = mimeType.toLowerCase().trim();
    return this.parsers.find((p) =>
      p.supportedMimeTypes.includes(normalized),
    );
  }

  /**
   * Return a flat list of all extensions supported by registered parsers.
   */
  getSupportedExtensions(): string[] {
    return this.parsers.flatMap((p) => p.supportedExtensions);
  }

  /**
   * Check whether a filename's extension is handled by any registered parser.
   *
   * @param filename  Filename to check.
   */
  isSupported(filename: string): boolean {
    return this.getParserForFile(filename) !== undefined;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private extractExtension(filename: string): string | undefined {
    const base = filename.split('/').pop() ?? filename;
    const dotIdx = base.lastIndexOf('.');
    if (dotIdx === -1 || dotIdx === base.length - 1) return undefined;
    return base.slice(dotIdx + 1).toLowerCase();
  }
}
