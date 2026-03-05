import { describe, expect, it, vi } from 'vitest';

import { ContentGenerator, PlaceholderGenerationProvider } from '../../../src/content/generation/index.js';
import { StubVoiceAnalyzer } from '../../../src/content/monitoring/index.js';

describe('Content provider wiring baseline', () => {
  it('placeholder provider returns sentinel output', async () => {
    const provider = new PlaceholderGenerationProvider();
    const result = await provider.generate('What changed?', 'system prompt');

    expect(result).toContain('[Generation not configured]');
  });

  it('content generator passes query/system prompt to provider', async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue('Provider response text'),
    };

    const generator = new ContentGenerator(provider);
    const output = await generator.generate(
      'Explain policy',
      {
        items: [],
        contextText: '[Source 1: "Doc"] Body',
        totalSearchResults: 1,
      },
      'profile-1',
    );

    expect(provider.generate).toHaveBeenCalledOnce();
    expect(output.text).toBe('Provider response text');
    expect(output.profileUsed).toBe('profile-1');
  });

  it('stub voice analyzer returns deterministic zero-drift baseline', async () => {
    const analyzer = new StubVoiceAnalyzer();
    const result = await analyzer.analyze('Generated content', 'profile-1', 'tenant-1');

    expect(result.overallScore).toBe(0);
    expect(result.sampleSize).toBe(0);
    expect(result.dimensionScores).toEqual({});
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});
