/**
 * GenerationService — orchestrates the full content-aware generation pipeline:
 *   retrieve → generate → extract citations → audit log
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { createId } from '@paralleldrive/cuid2';
import { contentGenerationLogs, contentOperationLogs } from '../schema.js';
import type { ResolvedEntitlements, GenerationResult } from '../types.js';
import { assertProfileAccessOrAudit } from '../profiles/access.js';
import { ContentRetriever, type SearchService, type RetrievalResult, type RetrievedItem } from './retriever.js';
import {
  ContentGenerator,
  PlaceholderGenerationProvider,
  type GenerationProvider,
  type GenerationOutput,
} from './generator.js';
import { CitationManager, type CitationResult } from './citations.js';
import { HttpGenerationProvider, type HttpGenerationProviderConfig } from './providers.js';

type DrizzleClient = ReturnType<typeof drizzle>;

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

    await assertProfileAccessOrAudit(this.db, {
      profileId: options?.profileId,
      tenantId,
      userId,
      entitlements,
      sessionId: options?.sessionId,
    });

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

    // 4. Log to generation_logs (no durationMs column in this table)
    await this.db.insert(contentGenerationLogs).values({
      id: createId(),
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
      id: createId(),
      tenantId,
      operation: 'generate',
      userId,
      durationMs,
      success: true,
      metadata: {
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
  type SearchService,
  type RetrievalResult,
  type RetrievedItem,
} from './retriever.js';
export {
  ContentGenerator,
  PlaceholderGenerationProvider,
  type GenerationProvider,
  type GenerationOutput,
} from './generator.js';
export { HttpGenerationProvider, type HttpGenerationProviderConfig } from './providers.js';
export { CitationManager, type CitationResult } from './citations.js';
