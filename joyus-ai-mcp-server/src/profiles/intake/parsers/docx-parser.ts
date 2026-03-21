/**
 * DOCX document parser.
 *
 * Uses mammoth to extract plain text from Word (.docx) files. mammoth
 * does not expose title/author metadata, so those fields are left
 * undefined with a warning informing the caller.
 */

import mammoth from 'mammoth';
import type { ParseResult } from '../../types.js';
import type { DocumentParser } from './interface.js';
import { normalizeText } from './normalize.js';

export class DocxParser implements DocumentParser {
  readonly name = 'docx';
  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  readonly supportedExtensions = ['docx'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });

      const rawText = result.value ?? '';
      const text = normalizeText(rawText);

      const warnings: string[] = [
        'DOCX format does not expose title or author metadata; fields left undefined.',
      ];

      if (result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          if (msg.type === 'warning' || msg.type === 'error') {
            warnings.push(`mammoth: ${msg.message}`);
          }
        }
      }

      if (!text) {
        warnings.push(`No text extracted from DOCX: ${filename}`);
      }

      const words = text ? text.split(/\s+/).filter(Boolean) : [];
      const wordCount = words.length > 0 ? words.length : undefined;

      return {
        text,
        metadata: {
          title: undefined,
          author: undefined,
          wordCount,
        },
        warnings,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        text: '',
        metadata: {},
        warnings: [`Failed to parse DOCX "${filename}": ${message}`],
      };
    }
  }
}
