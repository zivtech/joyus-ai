/**
 * Unit tests for TextParser.
 *
 * No mocks needed — TextParser operates purely on Buffer/string.
 */

import { describe, it, expect } from 'vitest';
import { TextParser } from '../../../../src/profiles/intake/parsers/text-parser.js';

describe('TextParser', () => {
  const parser = new TextParser();

  it('exposes correct name, extensions, and MIME types', () => {
    expect(parser.name).toBe('text');
    expect(parser.supportedExtensions).toContain('txt');
    expect(parser.supportedExtensions).toContain('html');
    expect(parser.supportedExtensions).toContain('htm');
    expect(parser.supportedExtensions).toContain('md');
    expect(parser.supportedExtensions).toContain('markdown');
    expect(parser.supportedMimeTypes).toContain('text/plain');
    expect(parser.supportedMimeTypes).toContain('text/html');
    expect(parser.supportedMimeTypes).toContain('text/markdown');
  });

  // ------------------------------------------------------------------
  // Plain text
  // ------------------------------------------------------------------

  describe('plain text (.txt)', () => {
    it('passes through and normalizes plain text', async () => {
      const buf = Buffer.from('  Hello   World\r\n  ');
      const result = await parser.parse(buf, 'notes.txt');
      expect(result.text).toBe('Hello World');
      expect(result.warnings).toHaveLength(0);
    });

    it('computes word count', async () => {
      const buf = Buffer.from('one two three');
      const result = await parser.parse(buf, 'words.txt');
      expect(result.metadata.wordCount).toBe(3);
    });

    it('returns warning for empty file', async () => {
      const result = await parser.parse(Buffer.from('   '), 'empty.txt');
      expect(result.text).toBe('');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('applies NFC normalization', async () => {
      const nfd = 'cafe\u0301';
      const nfc = 'caf\u00e9';
      const result = await parser.parse(Buffer.from(nfd), 'nfd.txt');
      expect(result.text).toBe(nfc);
    });
  });

  // ------------------------------------------------------------------
  // Markdown
  // ------------------------------------------------------------------

  describe('markdown (.md)', () => {
    it('preserves markdown syntax as part of author voice', async () => {
      const md = '# Title\n\nSome **bold** text.';
      const result = await parser.parse(Buffer.from(md), 'doc.md');
      // Markdown syntax is preserved, only whitespace normalized
      expect(result.text).toContain('#');
      expect(result.text).toContain('**bold**');
    });

    it('also handles .markdown extension', async () => {
      const result = await parser.parse(Buffer.from('Hello markdown'), 'doc.markdown');
      expect(result.text).toBe('Hello markdown');
    });
  });

  // ------------------------------------------------------------------
  // HTML
  // ------------------------------------------------------------------

  describe('HTML (.html / .htm)', () => {
    it('strips HTML tags', async () => {
      const html = '<p>Hello <strong>World</strong></p>';
      const result = await parser.parse(Buffer.from(html), 'page.html');
      expect(result.text).toBe('Hello World');
    });

    it('extracts <title> element content', async () => {
      const html = '<html><head><title>  My Page  </title></head><body>Content</body></html>';
      const result = await parser.parse(Buffer.from(html), 'page.html');
      expect(result.metadata.title).toBe('My Page');
      expect(result.text).toContain('Content');
    });

    it('leaves title undefined when no <title> element present', async () => {
      const html = '<p>No title here</p>';
      const result = await parser.parse(Buffer.from(html), 'frag.html');
      expect(result.metadata.title).toBeUndefined();
    });

    it('handles .htm extension the same as .html', async () => {
      const html = '<title>HTM Page</title><p>body</p>';
      const result = await parser.parse(Buffer.from(html), 'page.htm');
      expect(result.metadata.title).toBe('HTM Page');
    });

    it('normalizes whitespace after tag stripping', async () => {
      const html = '<p>  multiple   spaces  </p>';
      const result = await parser.parse(Buffer.from(html), 'spaced.html');
      expect(result.text).toBe('multiple spaces');
    });
  });
});
