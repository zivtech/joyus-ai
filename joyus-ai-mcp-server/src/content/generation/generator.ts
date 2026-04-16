/**
 * ContentGenerator — model-agnostic text generation with voice profile support.
 *
 * Accepts any GenerationProvider (injected at runtime) and builds a grounded
 * system prompt from the retrieved context and optional voice profile.
 */

import Anthropic from '@anthropic-ai/sdk';

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

export class AnthropicGenerationProvider implements GenerationProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(options?: { model?: string; maxTokens?: number }) {
    this.client = new Anthropic();
    this.model = options?.model ?? process.env.JOYUS_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    this.maxTokens = options?.maxTokens ?? 4096;
  }

  async generate(prompt: string, systemPrompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Anthropic response contained no text block');
    }
    return textBlock.text;
  }
}
