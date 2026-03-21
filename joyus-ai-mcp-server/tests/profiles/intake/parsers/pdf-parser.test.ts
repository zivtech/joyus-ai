/**
 * Unit tests for PdfParser.
 *
 * pdf-parse (v2.x) is mocked at the module level to avoid requiring a
 * real PDF file or a running PDF.js worker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pdf-parse — must appear before the import that uses it
// ---------------------------------------------------------------------------

const mockGetText = vi.fn();
const mockGetInfo = vi.fn();
const mockDestroy = vi.fn().mockResolvedValue(undefined);

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText: mockGetText,
    getInfo: mockGetInfo,
    destroy: mockDestroy,
  })),
}));

import { PdfParser } from '../../../../src/profiles/intake/parsers/pdf-parser.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PdfParser', () => {
  let parser: PdfParser;

  beforeEach(() => {
    parser = new PdfParser();
    vi.clearAllMocks();
    mockDestroy.mockResolvedValue(undefined);
  });

  it('exposes correct name, extensions, and MIME types', () => {
    expect(parser.name).toBe('pdf');
    expect(parser.supportedExtensions).toEqual(['pdf']);
    expect(parser.supportedMimeTypes).toEqual(['application/pdf']);
  });

  it('extracts and normalizes text from a valid PDF', async () => {
    mockGetText.mockResolvedValue({ text: '  Hello   World\r\n  ', total: 3 });
    mockGetInfo.mockResolvedValue({
      total: 3,
      info: { Title: 'My Doc', Author: 'Author A' },
    });

    const result = await parser.parse(Buffer.from('fake'), 'doc.pdf');

    expect(result.text).toBe('Hello World');
    expect(result.metadata.title).toBe('My Doc');
    expect(result.metadata.author).toBe('Author A');
    expect(result.metadata.pageCount).toBe(3);
    expect(result.metadata.wordCount).toBe(2);
    expect(result.warnings).toHaveLength(0);
  });

  it('applies NFC normalization', async () => {
    // café with combining accent (NFD) vs precomposed (NFC)
    const nfd = 'cafe\u0301'; // NFD form
    const nfc = 'caf\u00e9';  // NFC form
    mockGetText.mockResolvedValue({ text: nfd, total: 1 });
    mockGetInfo.mockResolvedValue({ total: 1, info: {} });

    const result = await parser.parse(Buffer.from('fake'), 'doc.pdf');
    expect(result.text).toBe(nfc);
  });

  it('returns empty text and warning when PDF contains no text', async () => {
    mockGetText.mockResolvedValue({ text: '   ', total: 1 });
    mockGetInfo.mockResolvedValue({ total: 1, info: {} });

    const result = await parser.parse(Buffer.from('fake'), 'empty.pdf');

    expect(result.text).toBe('');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('No text extracted');
  });

  it('returns empty text and warning on parse error instead of throwing', async () => {
    mockGetText.mockRejectedValue(new Error('Corrupt PDF'));
    mockGetInfo.mockRejectedValue(new Error('Corrupt PDF'));

    const result = await parser.parse(Buffer.from('garbage'), 'corrupt.pdf');

    expect(result.text).toBe('');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Failed to parse PDF');
    expect(result.warnings[0]).toContain('Corrupt PDF');
  });

  it('handles missing title and author gracefully', async () => {
    mockGetText.mockResolvedValue({ text: 'Some content here', total: 2 });
    mockGetInfo.mockResolvedValue({ total: 2, info: {} });

    const result = await parser.parse(Buffer.from('fake'), 'doc.pdf');

    expect(result.metadata.title).toBeUndefined();
    expect(result.metadata.author).toBeUndefined();
    expect(result.metadata.pageCount).toBe(2);
  });
});
