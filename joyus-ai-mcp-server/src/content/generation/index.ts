/**
 * GenerationService — orchestrates the full content-aware generation pipeline:
 *   retrieve → generate → extract citations → audit log
 */

import { createId } from '@paralleldrive/cuid2';

import type { DrizzleClient } from '../../db/types.js';
import { contentGenerationLogs, contentOperationLogs } from '../schema.js';
import type { SearchService } from '../search/index.js';
import type { ResolvedEntitlements, GenerationResult } from '../types.js';

import { CitationManager, type CitationResult } from './citations.js';
import {
  ContentGenerator,
  PlaceholderGenerationProvider,
  type GenerationProvider,
  type GenerationOutput,
} from './generator.js';
import { ContentRetriever, type RetrievalResult, type RetrievedItem } from './retriever.js';

export interface GenerateOptions {
  profileId?: string;
  sourceIds?: string[];
  maxSources?: number;
  sessionId?: string;
}

export class GenerationService {
  private retriever: ContentRetriever;
  private generator: ContentGenerator;
  private citationManager: CitationManager;

  constructor(
    searchService: SearchService,
    provider: GenerationProvider,
    private db: DrizzleClient,
  ) {
    this.retriever = new ContentRetriever(searchService, db);
    this.generator = new ContentGenerator(provider);
    this.citationManager = new CitationManager();
  }

  async generate(
    query: string,
    userId: string,
    tenantId: string,
    entitlements: ResolvedEntitlements,
    options?: GenerateOptions,
  ): Promise<GenerationResult> {
    const startMs = Date.now();

    // 1. Retrieve relevant content
    const retrieval = await this.retriever.retrieve(query, entitlements, {
      sourceIds: options?.sourceIds,
      maxSources: options?.maxSources,
    });

    // 2. Generate with optional voice profile
    const genOutput = await this.generator.generate(query, retrieval, options?.profileId);

    // 3. Extract citations from generated text
    const citationResult = this.citationManager.extractCitations(
      genOutput.text,
      retrieval.items,
    );

    const durationMs = Date.now() - startMs;
    const generationLogId = createId();
    const operationLogId = createId();

    // 4. Log to generation_logs (no durationMs column in this table)
    await this.db.insert(contentGenerationLogs).values({
      id: generationLogId,
      tenantId,
      userId,
      sessionId: options?.sessionId ?? null,
      profileId: options?.profileId ?? null,
      query,
      sourcesUsed: retrieval.items.map(i => i.itemId),
      citationCount: citationResult.citationCount,
      responseLength: citationResult.text.length,
    });

    // 5. Audit log via operation_logs (includes durationMs)
    await this.db.insert(contentOperationLogs).values({
      id: operationLogId,
      tenantId,
      operation: 'generate',
      userId,
      sessionId: options?.sessionId ?? null,
      durationMs,
      success: true,
      metadata: {
        generationLogId,
        citationCount: citationResult.citationCount,
        sourcesUsed: retrieval.items.length,
        profileId: options?.profileId ?? null,
      },
    });

    return {
      text: citationResult.text,
      citations: citationResult.citations,
      profileUsed: genOutput.profileUsed,
      metadata: {
        generationLogId,
        totalSearchResults: retrieval.totalSearchResults,
        sourcesUsed: retrieval.items.length,
        durationMs,
      },
    };
  }
}

// Re-exports so callers can import everything from this module
export {
  ContentRetriever,
  type RetrievalResult,
  type RetrievedItem,
} from './retriever.js';
export type { SearchService } from '../search/index.js';
export { AnthropicGenerationProvider } from './anthropic-provider.js';
export {
  ContentGenerator,
  PlaceholderGenerationProvider,
  type GenerationProvider,
  type GenerationOutput,
} from './generator.js';
export { CitationManager, type CitationResult } from './citations.js';
