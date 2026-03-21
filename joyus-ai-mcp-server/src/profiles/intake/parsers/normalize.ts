/**
 * Shared text normalization pipeline for all document parsers.
 *
 * All parsers in the intake pipeline MUST apply this exact pipeline so that
 * content hashes computed downstream are consistent regardless of which
 * parser produced the text.
 *
 * Pipeline steps (in order):
 *  1. Unicode NFC normalization
 *  2. Collapse all whitespace runs to a single space
 *  3. Normalize line endings to LF
 *  4. Trim leading/trailing whitespace
 */

/**
 * Normalize extracted text through the standard four-step pipeline.
 *
 * @param text  Raw extracted text from a parser.
 * @returns     Normalized text.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}
