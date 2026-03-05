import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

import {
  HttpGenerationProvider,
  PlaceholderGenerationProvider,
} from '../../../src/content/generation/index.js';
import { HttpVoiceAnalyzer, StubVoiceAnalyzer } from '../../../src/content/monitoring/index.js';
import {
  createGenerationProviderFromEnv,
  createVoiceAnalyzerFromEnv,
  describeProviderWiring,
  enforceProviderReadiness,
} from '../../../src/content/runtime-config.js';

vi.mock('axios');

describe('Content runtime provider readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses placeholder generation provider by default', () => {
    const provider = createGenerationProviderFromEnv({});
    expect(provider).toBeInstanceOf(PlaceholderGenerationProvider);
  });

  it('throws when HTTP generation provider is selected without URL', () => {
    expect(() =>
      createGenerationProviderFromEnv({
        CONTENT_GENERATION_PROVIDER: 'http',
      }),
    ).toThrow('CONTENT_GENERATION_HTTP_URL');
  });

  it('builds HTTP voice analyzer when configured', () => {
    const analyzer = createVoiceAnalyzerFromEnv({
      CONTENT_VOICE_ANALYZER_PROVIDER: 'http',
      CONTENT_VOICE_ANALYZER_HTTP_URL: 'http://localhost:8000/analyze',
    });
    expect(analyzer).toBeInstanceOf(HttpVoiceAnalyzer);
  });

  it('fails closed in production with placeholder generation provider', () => {
    const provider = new PlaceholderGenerationProvider();
    const analyzer = new StubVoiceAnalyzer();

    expect(() =>
      enforceProviderReadiness(provider, analyzer, {
        NODE_ENV: 'production',
        CONTENT_DRIFT_ENABLED: 'false',
      }),
    ).toThrow('placeholder generation provider');
  });

  it('fails closed when drift is enabled with stub analyzer', () => {
    const provider = createGenerationProviderFromEnv({
      CONTENT_GENERATION_PROVIDER: 'http',
      CONTENT_GENERATION_HTTP_URL: 'http://localhost:7000/generate',
    });
    const analyzer = new StubVoiceAnalyzer();

    expect(() =>
      enforceProviderReadiness(provider, analyzer, {
        NODE_ENV: 'development',
        CONTENT_DRIFT_ENABLED: 'true',
      }),
    ).toThrow('drift monitoring enabled with stub voice analyzer');
  });

  it('reports provider wiring status for health endpoint', () => {
    const wiring = describeProviderWiring(
      createGenerationProviderFromEnv({}),
      createVoiceAnalyzerFromEnv({}),
      { CONTENT_DRIFT_ENABLED: 'true' },
    );

    expect(wiring).toEqual({
      generationProvider: 'placeholder',
      voiceAnalyzer: 'stub',
      driftMonitoringEnabled: true,
    });
  });

  it('uses configured HTTP generation provider output (not placeholder sentinel)', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { text: 'Real model output with citation [Source 1].' },
    } as never);

    const provider = new HttpGenerationProvider({
      url: 'https://provider.example.com/generate',
      timeoutMs: 1000,
    });

    const result = await provider.generate('What changed?', 'Use references only');
    expect(result).toContain('Real model output');
    expect(result).not.toContain('[Generation not configured]');
  });

  it('uses configured HTTP voice analyzer output with non-zero sample size and dimensions', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        overallScore: 0.37,
        dimensionScores: { tone: 0.31, vocabulary: 0.42, structure: 0.38 },
        sampleSize: 9,
        recommendations: ['Reduce jargon density'],
      },
    } as never);

    const analyzer = new HttpVoiceAnalyzer({
      url: 'https://analyzer.example.com/analyze',
      timeoutMs: 1000,
    });

    const result = await analyzer.analyze('Generated content body', 'profile-1', 'tenant-1');
    expect(result.sampleSize).toBeGreaterThan(0);
    expect(result.dimensionScores.tone).toBe(0.31);
    expect(result.dimensionScores.vocabulary).toBe(0.42);
    expect(result.overallScore).toBe(0.37);
  });
});
