import axios from 'axios';

import type { GenerationProvider } from './generator.js';

export interface HttpGenerationProviderConfig {
  url: string;
  timeoutMs?: number;
  apiKey?: string;
}

/**
 * HTTP-backed generation provider.
 *
 * Expected response body:
 *   { "text": "..." }
 * or plain string body.
 */
export class HttpGenerationProvider implements GenerationProvider {
  private readonly timeoutMs: number;

  constructor(private readonly config: HttpGenerationProviderConfig) {
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  async generate(prompt: string, systemPrompt: string): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await axios.post(
      this.config.url,
      { prompt, systemPrompt },
      { headers, timeout: this.timeoutMs },
    );

    if (typeof response.data === 'string') {
      return response.data;
    }

    if (response.data && typeof response.data.text === 'string') {
      return response.data.text;
    }

    throw new Error('Invalid generation provider response shape');
  }
}

