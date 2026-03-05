import { describe, expect, it } from 'vitest';

import { PlaceholderGenerationProvider } from '../../../src/content/generation/index.js';
import { HttpVoiceAnalyzer, StubVoiceAnalyzer } from '../../../src/content/monitoring/index.js';
import {
  createGenerationProviderFromEnv,
  createVoiceAnalyzerFromEnv,
  describeProviderWiring,
  enforceProviderReadiness,
} from '../../../src/content/runtime-config.js';

describe('Content runtime provider readiness', () => {
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
});
