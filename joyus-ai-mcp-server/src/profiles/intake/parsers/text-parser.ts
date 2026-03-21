/**
 * Plain-text, HTML, and Markdown parser.
 *
 * Strategy by format:
 *  - txt / md / markdown : pass through as-is (markup is part of the author's voice)
 *  - html / htm          : strip tags, extract <title> element content
 *
 * All formats share the standard normalization pipeline.
 */

import type { ParseResult } from '../../types.js';
import type { DocumentParser } from './interface.js';
import { normalizeText } from './normalize.js';

/** HTML-bearing extensions for which tag stripping is applied. */
const HTML_EXTENSIONS = new Set(['html', 'htm']);

export class TextParser implements DocumentParser {
  readonly name = 'text';
  readonly supportedMimeTypes = ['text/plain', 'text/html', 'text/markdown'];
  readonly supportedExtensions = ['txt', 'html', 'htm', 'md', 'markdown'];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const raw = buffer.toString('utf8');
    const ext = this.extractExtension(filename);

    const warnings: string[] = [];
    let title: string | undefined;
    let text: string;

    if (HTML_EXTENSIONS.has(ext)) {
      // Extract <title> content before stripping tags
      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        title = normalizeText(titleMatch[1]);
        if (!title) title = undefined;
      }
      // Strip all HTML tags
      text = normalizeText(raw.replace(/<[^>]+>/g, ''));
    } else {
      // Plain text and Markdown: pass through as author's voice
      text = normalizeText(raw);
    }

    if (!text) {
      warnings.push(`No text extracted from file: ${filename}`);
    }

    const words = text ? text.split(/\s+/).filter(Boolean) : [];
    const wordCount = words.length > 0 ? words.length : undefined;

    return {
      text,
      metadata: { title, wordCount },
      warnings,
    };
  }

  private extractExtension(filename: string): string {
    const base = filename.split('/').pop() ?? filename;
    const dotIdx = base.lastIndexOf('.');
    if (dotIdx === -1 || dotIdx === base.length - 1) return '';
    return base.slice(dotIdx + 1).toLowerCase();
  }
}
