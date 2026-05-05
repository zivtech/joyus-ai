/**
 * ContentGenerator — model-agnostic text generation with voice profile support.
 *
 * Accepts any GenerationProvider (injected at runtime) and builds a grounded
 * system prompt from the retrieved context and optional voice profile.
 */

import type { RetrievalResult } from './retriever.js';

export interface GenerationProvider {
  generate(prompt: string, systemPrompt: string): Promise<string>;
}

export interface GenerationOutput {
  text: string;
  profileUsed: string | null;
  sourcesProvided: number;
}

export class ContentGenerator {
  constructor(private provider: GenerationProvider) {}

  async generate(
    query: string,
    retrieval: RetrievalResult,
    profileId?: string,
  ): Promise<GenerationOutput> {
    const systemPrompt = this.buildSystemPrompt(retrieval, profileId);
    const text = await this.provider.generate(query, systemPrompt);
    return {
      text,
      profileUsed: profileId ?? null,
      sourcesProvided: retrieval.items.length,
    };
  }

  private buildSystemPrompt(retrieval: RetrievalResult, profileId?: string): string {
    let prompt =
      'You are a helpful assistant that answers questions using the provided reference material.\n\n';

    if (profileId) {
      prompt += `Apply the voice profile "${profileId}" characteristics in your response.\n\n`;
    }

    prompt += 'REFERENCE MATERIAL:\n';
    prompt += retrieval.contextText;
    prompt += '\n\nINSTRUCTIONS:\n';
    prompt += '- Use ONLY the reference material above to answer\n';
    prompt += '- Cite sources using [Source N] markers matching the numbers above\n';
    prompt += '- Do NOT reference content not in the provided sources\n';
    prompt +=
      '- If the reference material does not contain relevant information, say so\n';

    return prompt;
  }
}

/**
 * Placeholder provider — used when no real AI provider is configured.
 * Returns a descriptive message so the pipeline can still run end-to-end.
 */
export class PlaceholderGenerationProvider implements GenerationProvider {
  async generate(prompt: string, _systemPrompt: string): Promise<string> {
    return (
      `[Generation not configured] Query received: "${prompt}". ` +
      `Configure a GenerationProvider to enable AI responses.`
    );
  }
}
