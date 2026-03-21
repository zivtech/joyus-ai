/**
 * Unit tests for DocxParser.
 *
 * mammoth is mocked to avoid requiring a real DOCX file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocxParser } from '../../../../src/profiles/intake/parsers/docx-parser.js';

// ---------------------------------------------------------------------------
// Mock mammoth
// ---------------------------------------------------------------------------

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

import mammoth from 'mammoth';
const mockExtractRawText = vi.mocked(mammoth.extractRawText);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocxParser', () => {
  let parser: DocxParser;

  beforeEach(() => {
    parser = new DocxParser();
    vi.clearAllMocks();
  });

  it('exposes correct name, extensions, and MIME types', () => {
    expect(parser.name).toBe('docx');
    expect(parser.supportedExtensions).toEqual(['docx']);
    expect(parser.supportedMimeTypes).toEqual([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
  });

  it('extracts and normalizes text from a DOCX buffer', async () => {
    mockExtractRawText.mockResolvedValue({
      value: '  Hello   World\r\n  ',
      messages: [],
    } as never);

    const result = await parser.parse(Buffer.from('fake'), 'report.docx');

    expect(result.text).toBe('Hello World');
    expect(result.metadata.wordCount).toBe(2);
    expect(result.metadata.title).toBeUndefined();
    expect(result.metadata.author).toBeUndefined();
    // Always includes the "no metadata" warning
    expect(result.warnings.some((w) => w.includes('title or author'))).toBe(true);
  });

  it('applies NFC normalization', async () => {
    const nfd = 'cafe\u0301';
    const nfc = 'caf\u00e9';
    mockExtractRawText.mockResolvedValue({ value: nfd, messages: [] } as never);

    const result = await parser.parse(Buffer.from('fake'), 'doc.docx');
    expect(result.text).toBe(nfc);
  });

  it('includes mammoth warning messages in result warnings', async () => {
    mockExtractRawText.mockResolvedValue({
      value: 'Some content',
      messages: [{ type: 'warning', message: 'Unsupported element ignored' }],
    } as never);

    const result = await parser.parse(Buffer.from('fake'), 'doc.docx');

    expect(result.warnings.some((w) => w.includes('Unsupported element ignored'))).toBe(true);
  });

  it('returns empty text and warning when DOCX yields no text', async () => {
    mockExtractRawText.mockResolvedValue({ value: '   ', messages: [] } as never);

    const result = await parser.parse(Buffer.from('fake'), 'empty.docx');

    expect(result.text).toBe('');
    expect(result.warnings.some((w) => w.includes('No text extracted'))).toBe(true);
  });

  it('returns empty text and warning on error instead of throwing', async () => {
    mockExtractRawText.mockRejectedValue(new Error('Not a valid DOCX'));

    const result = await parser.parse(Buffer.from('garbage'), 'bad.docx');

    expect(result.text).toBe('');
    expect(result.warnings.some((w) => w.includes('Failed to parse DOCX'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Not a valid DOCX'))).toBe(true);
  });
});
