/**
 * PDF document parser.
 *
 * Uses pdf-parse (v2.x) to extract plain text and structural metadata from
 * PDF files. The v2.x API uses a class-based `PDFParse` instance rather than
 * the old functional call of v1.x.
 *
 * Recoverable errors (corrupt / password-protected PDFs) are returned as a
 * ParseResult with empty text and a warning rather than throwing.
 */

import { PDFParse } from 'pdf-parse';
import type { ParseResult } from '../../types.js';
import type { DocumentParser } from './interface.js';
import { normalizeText } from './normalize.js';

export class PdfParser implements DocumentParser {
  readonly name = 'pdf';
  readonly supportedMimeTypes = ['application/pdf'];
  readonly supportedExtensions = ['pdf'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    try {
      const parser = new PDFParse({ data: buffer });

      const [textResult, infoResult] = await Promise.all([
        parser.getText(),
        parser.getInfo(),
      ]);

      const rawText = textResult.text ?? '';
      const text = normalizeText(rawText);

      // Info dictionary: v2.x exposes raw PDF info dict on infoResult.info
      const info = infoResult.info ?? {};
      const title =
        typeof info['Title'] === 'string' && info['Title']
          ? (info['Title'] as string)
          : undefined;
      const author =
        typeof info['Author'] === 'string' && info['Author']
          ? (info['Author'] as string)
          : undefined;
      const pageCount =
        typeof infoResult.total === 'number' ? infoResult.total : undefined;

      const words = text ? text.split(/\s+/).filter(Boolean) : [];
      const wordCount = words.length > 0 ? words.length : undefined;

      const warnings: string[] = [];
      if (!text) {
        warnings.push(`No text extracted from PDF: ${filename}`);
      }

      await parser.destroy();

      return {
        text,
        metadata: { title, author, pageCount, wordCount },
        warnings,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        text: '',
        metadata: {},
        warnings: [`Failed to parse PDF "${filename}": ${message}`],
      };
    }
  }
}
