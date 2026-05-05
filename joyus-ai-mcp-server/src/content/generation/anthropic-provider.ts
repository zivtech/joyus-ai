import Anthropic from '@anthropic-ai/sdk';

import type { GenerationProvider } from './generator.js';

export class AnthropicGenerationProvider implements GenerationProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(options?: {
    model?: string;
    maxTokens?: number;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    this.client = new Anthropic({
      timeout: options?.timeoutMs ?? 120_000,
      maxRetries: options?.maxRetries ?? 2,
    });
    this.model = options?.model ?? process.env.JOYUS_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    this.maxTokens = options?.maxTokens ?? 4096;
  }

  async generate(prompt: string, systemPrompt: string): Promise<string> {
    const response = await this.client.messages
      .create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: prompt }],
      })
      .catch((err: unknown) => {
        if (err instanceof Anthropic.RateLimitError) {
          throw Object.assign(
            new Error('Anthropic rate limit exceeded — request is retryable'),
            { retryable: true, cause: err },
          );
        }
        if (err instanceof Anthropic.AuthenticationError) {
          throw Object.assign(
            new Error('Anthropic authentication failed — check ANTHROPIC_API_KEY'),
            { retryable: false, cause: err },
          );
        }
        throw err;
      });

    if (response.stop_reason === 'max_tokens') {
      console.warn(
        `[AnthropicGenerationProvider] Response truncated at max_tokens=${this.maxTokens} for model ${this.model}`,
      );
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw new Error('Anthropic response contained no text block');
    }
    return textBlock.text;
  }
}
