/**
 * CitationManager — parses [Source N] markers from generated text and builds
 * structured citation records referencing the original retrieved items.
 */

import type { Citation } from '../types.js';
import type { RetrievedItem } from './retriever.js';

export interface CitationResult {
  text: string;
  citations: Citation[];
  citationCount: number;
}

export class CitationManager {
  extractCitations(generatedText: string, retrievedItems: RetrievedItem[]): CitationResult {
    const citations: Citation[] = [];
    const seen = new Set<string>();

    // Parse [Source N] markers (1-based index into retrievedItems)
    const markerRegex = /\[Source\s+(\d+)\]/g;
    let match;
    while ((match = markerRegex.exec(generatedText)) !== null) {
      const index = parseInt(match[1], 10) - 1;
      if (index >= 0 && index < retrievedItems.length) {
        const item = retrievedItems[index];
        const key = `${item.sourceId}:${item.itemId}`;
        if (!seen.has(key)) {
          seen.add(key);
          citations.push({
            sourceId: item.sourceId,
            itemId: item.itemId,
            title: item.title,
            excerpt: item.body.substring(0, 200),
            sourceType: 'content-item',
          });
        }
      }
    }

    return { text: generatedText, citations, citationCount: citations.length };
  }
}
