/**
 * Voice Analyzer — Interface and stub implementation.
 *
 * Real implementations (e.g. profile-engine-backed) are provided by
 * downstream packages and injected into DriftMonitor at startup.
 */

import axios from 'axios';

export interface DriftAnalysis {
  /** 0.0 = perfect match, 1.0 = maximum drift */
  overallScore: number;
  /** Per-dimension drift scores (e.g. formality, tone) */
  dimensionScores: Record<string, number>;
  /** Number of samples used to compute this analysis */
  sampleSize: number;
  /** Human-readable remediation suggestions */
  recommendations: string[];
}

export interface VoiceAnalyzer {
  analyze(content: string, profileId: string, tenantId: string): Promise<DriftAnalysis>;
}

export interface HttpVoiceAnalyzerConfig {
  url: string;
  timeoutMs?: number;
  authHeader?: string;
  authToken?: string;
}

/**
 * No-op analyzer used when no provider is configured.
 * Returns a zero-drift score so monitoring continues without blocking.
 */
export class StubVoiceAnalyzer implements VoiceAnalyzer {
  async analyze(
    _content: string,
    _profileId: string,
    _tenantId: string,
  ): Promise<DriftAnalysis> {
    return {
      overallScore: 0.0,
      dimensionScores: {},
      sampleSize: 0,
      recommendations: [
        'Voice analysis not configured — install a VoiceAnalyzer provider',
      ],
    };
  }
}

/**
 * HTTP-backed voice analyzer. Endpoint must return DriftAnalysis fields.
 */
export class HttpVoiceAnalyzer implements VoiceAnalyzer {
  constructor(private config: HttpVoiceAnalyzerConfig) {}

  async analyze(content: string, profileId: string, tenantId: string): Promise<DriftAnalysis> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.authHeader && this.config.authToken) {
      headers[this.config.authHeader] = this.config.authToken;
    }

    const response = await axios.post(
      this.config.url,
      { content, profileId, tenantId },
      {
        timeout: this.config.timeoutMs ?? 8_000,
        headers,
      },
    );

    const payload = response.data as Partial<DriftAnalysis> | undefined;
    if (!payload || typeof payload !== 'object') {
      throw new Error('Voice analyzer returned invalid payload');
    }

    if (typeof payload.overallScore !== 'number') {
      throw new Error('Voice analyzer returned invalid overallScore');
    }

    return {
      overallScore: payload.overallScore,
      dimensionScores:
        payload.dimensionScores && typeof payload.dimensionScores === 'object'
          ? payload.dimensionScores
          : {},
      sampleSize:
        typeof payload.sampleSize === 'number' && payload.sampleSize >= 0
          ? payload.sampleSize
          : 0,
      recommendations: Array.isArray(payload.recommendations)
        ? payload.recommendations.filter((item): item is string => typeof item === 'string')
        : [],
    };
  }
}
