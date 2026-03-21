/**
 * Unit tests for ParserRegistry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ParserRegistry } from '../../../../src/profiles/intake/parsers/registry.js';
import type { DocumentParser } from '../../../../src/profiles/intake/parsers/interface.js';
import type { ParseResult } from '../../../../src/profiles/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParser(
  name: string,
  extensions: string[],
  mimeTypes: string[],
): DocumentParser {
  return {
    name,
    supportedExtensions: extensions,
    supportedMimeTypes: mimeTypes,
    async parse(_buffer: Buffer, _filename: string): Promise<ParseResult> {
      return { text: '', metadata: {}, warnings: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParserRegistry', () => {
  let registry: ParserRegistry;

  beforeEach(() => {
    registry = new ParserRegistry();
  });

  describe('register / getParserForFile', () => {
    it('returns undefined when no parsers are registered', () => {
      expect(registry.getParserForFile('report.pdf')).toBeUndefined();
    });

    it('resolves a registered parser by extension', () => {
      const pdf = makeParser('pdf', ['pdf'], ['application/pdf']);
      registry.register(pdf);
      expect(registry.getParserForFile('report.pdf')).toBe(pdf);
    });

    it('is case-insensitive for extensions', () => {
      const pdf = makeParser('pdf', ['pdf'], ['application/pdf']);
      registry.register(pdf);
      expect(registry.getParserForFile('REPORT.PDF')).toBe(pdf);
    });

    it('returns undefined for an unregistered extension', () => {
      const pdf = makeParser('pdf', ['pdf'], ['application/pdf']);
      registry.register(pdf);
      expect(registry.getParserForFile('doc.xlsx')).toBeUndefined();
    });

    it('returns the first matching parser when multiple parsers support the same extension', () => {
      const first = makeParser('first', ['txt'], ['text/plain']);
      const second = makeParser('second', ['txt'], ['text/plain']);
      registry.register(first);
      registry.register(second);
      expect(registry.getParserForFile('notes.txt')).toBe(first);
    });

    it('handles filenames without extensions gracefully', () => {
      const txt = makeParser('text', ['txt'], ['text/plain']);
      registry.register(txt);
      expect(registry.getParserForFile('README')).toBeUndefined();
    });

    it('handles filenames with path separators', () => {
      const pdf = makeParser('pdf', ['pdf'], ['application/pdf']);
      registry.register(pdf);
      expect(registry.getParserForFile('uploads/2024/report.pdf')).toBe(pdf);
    });
  });

  describe('getParserForMimeType', () => {
    it('resolves a parser by MIME type', () => {
      const pdf = makeParser('pdf', ['pdf'], ['application/pdf']);
      registry.register(pdf);
      expect(registry.getParserForMimeType('application/pdf')).toBe(pdf);
    });

    it('is case-insensitive for MIME types', () => {
      const pdf = makeParser('pdf', ['pdf'], ['application/pdf']);
      registry.register(pdf);
      expect(registry.getParserForMimeType('Application/PDF')).toBe(pdf);
    });

    it('returns undefined for an unregistered MIME type', () => {
      expect(registry.getParserForMimeType('application/zip')).toBeUndefined();
    });
  });

  describe('getSupportedExtensions', () => {
    it('returns empty array when no parsers registered', () => {
      expect(registry.getSupportedExtensions()).toEqual([]);
    });

    it('returns all extensions from all registered parsers', () => {
      registry.register(makeParser('pdf', ['pdf'], []));
      registry.register(makeParser('text', ['txt', 'md'], []));
      const exts = registry.getSupportedExtensions();
      expect(exts).toContain('pdf');
      expect(exts).toContain('txt');
      expect(exts).toContain('md');
    });
  });

  describe('isSupported', () => {
    it('returns true for a supported filename', () => {
      registry.register(makeParser('pdf', ['pdf'], []));
      expect(registry.isSupported('report.pdf')).toBe(true);
    });

    it('returns false for an unsupported filename', () => {
      registry.register(makeParser('pdf', ['pdf'], []));
      expect(registry.isSupported('data.csv')).toBe(false);
    });
  });
});
