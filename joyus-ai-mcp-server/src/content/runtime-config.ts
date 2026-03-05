/**
 * Content runtime provider configuration.
 *
 * Centralizes provider selection and readiness gates for production safety.
 */

import {
  HttpGenerationProvider,
  PlaceholderGenerationProvider,
  type GenerationProvider,
} from './generation/index.js';
import {
  HttpVoiceAnalyzer,
  StubVoiceAnalyzer,
  type VoiceAnalyzer,
} from './monitoring/voice-analyzer.js';

export type GenerationProviderKind = 'placeholder' | 'http';
export type VoiceAnalyzerKind = 'stub' | 'http';

export interface ProviderWiringStatus {
  generationProvider: GenerationProviderKind;
  voiceAnalyzer: VoiceAnalyzerKind;
  driftMonitoringEnabled: boolean;
}

type EnvMap = Record<string, string | undefined>;

function parseTimeoutMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createGenerationProviderFromEnv(env: EnvMap = process.env): GenerationProvider {
  const provider = (env.CONTENT_GENERATION_PROVIDER ?? 'placeholder').toLowerCase();

  if (provider === 'http') {
    const url = env.CONTENT_GENERATION_HTTP_URL;
    if (!url) {
      throw new Error('CONTENT_GENERATION_HTTP_URL is required when CONTENT_GENERATION_PROVIDER=http');
    }

    return new HttpGenerationProvider({
      url,
      timeoutMs: parseTimeoutMs(env.CONTENT_GENERATION_HTTP_TIMEOUT_MS, 12_000),
      authHeader: env.CONTENT_GENERATION_HTTP_AUTH_HEADER,
      authToken: env.CONTENT_GENERATION_HTTP_AUTH_TOKEN,
    });
  }

  return new PlaceholderGenerationProvider();
}

export function createVoiceAnalyzerFromEnv(env: EnvMap = process.env): VoiceAnalyzer {
  const analyzer = (env.CONTENT_VOICE_ANALYZER_PROVIDER ?? 'stub').toLowerCase();

  if (analyzer === 'http') {
    const url = env.CONTENT_VOICE_ANALYZER_HTTP_URL;
    if (!url) {
      throw new Error('CONTENT_VOICE_ANALYZER_HTTP_URL is required when CONTENT_VOICE_ANALYZER_PROVIDER=http');
    }

    return new HttpVoiceAnalyzer({
      url,
      timeoutMs: parseTimeoutMs(env.CONTENT_VOICE_ANALYZER_HTTP_TIMEOUT_MS, 8_000),
      authHeader: env.CONTENT_VOICE_ANALYZER_HTTP_AUTH_HEADER,
      authToken: env.CONTENT_VOICE_ANALYZER_HTTP_AUTH_TOKEN,
    });
  }

  return new StubVoiceAnalyzer();
}

export function describeProviderWiring(
  generationProvider: GenerationProvider,
  voiceAnalyzer: VoiceAnalyzer,
  env: EnvMap = process.env,
): ProviderWiringStatus {
  const driftMonitoringEnabled = env.CONTENT_DRIFT_ENABLED === 'true';

  return {
    generationProvider:
      generationProvider instanceof PlaceholderGenerationProvider ? 'placeholder' : 'http',
    voiceAnalyzer: voiceAnalyzer instanceof StubVoiceAnalyzer ? 'stub' : 'http',
    driftMonitoringEnabled,
  };
}

export function enforceProviderReadiness(
  generationProvider: GenerationProvider,
  voiceAnalyzer: VoiceAnalyzer,
  env: EnvMap = process.env,
): void {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const driftEnabled = env.CONTENT_DRIFT_ENABLED === 'true';
  const requireRealProviders = env.CONTENT_REQUIRE_REAL_PROVIDERS === 'true';
  const requireRealAnalyzer = env.CONTENT_REQUIRE_REAL_ANALYZER === 'true';

  if (
    (nodeEnv === 'production' || requireRealProviders) &&
    generationProvider instanceof PlaceholderGenerationProvider
  ) {
    throw new Error(
      'Unsafe content runtime: placeholder generation provider configured in production/strict mode',
    );
  }

  if (
    (driftEnabled || requireRealAnalyzer) &&
    voiceAnalyzer instanceof StubVoiceAnalyzer
  ) {
    throw new Error(
      'Unsafe content runtime: drift monitoring enabled with stub voice analyzer',
    );
  }
}
