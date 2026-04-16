import { describe, expect, it } from 'vitest';

import { AnthropicGenerationProvider } from '../generator.js';

describe('AnthropicGenerationProvider integration', () => {
  it('skips clearly when ANTHROPIC_API_KEY is not set', ({ skip }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      skip();
    }

    expect(process.env.ANTHROPIC_API_KEY).toBeTruthy();
  });

  it('returns a non-empty string containing 4 when ANTHROPIC_API_KEY is set', async ({ skip }) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      skip();
    }

    const provider = new AnthropicGenerationProvider();
    const response = await provider.generate(
      'What is 2+2?',
      'You are a math tutor. Be concise.',
    );

    expect(response.trim().length).toBeGreaterThan(0);
    expect(response).toContain('4');
  });
});
