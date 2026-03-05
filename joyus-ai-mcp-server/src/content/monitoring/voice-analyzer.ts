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

export interface HttpVoiceAnalyzerConfig {
  url: string;
  timeoutMs?: number;
  apiKey?: string;
}

/**
 * HTTP-backed voice analyzer.
 *
 * Expected response body:
 * {
 *   overallScore: number,
 *   dimensionScores: Record<string, number>,
 *   sampleSize: number,
 *   recommendations: string[]
 * }
 */
export class HttpVoiceAnalyzer implements VoiceAnalyzer {
  private readonly timeoutMs: number;

  constructor(private readonly config: HttpVoiceAnalyzerConfig) {
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  async analyze(content: string, profileId: string, tenantId: string): Promise<DriftAnalysis> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await axios.post(
      this.config.url,
      { content, profileId, tenantId },
      { headers, timeout: this.timeoutMs },
    );

    const data = response.data;
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid voice analyzer response shape');
    }

    const overallScore = Number((data as { overallScore?: unknown }).overallScore);
    const sampleSize = Number((data as { sampleSize?: unknown }).sampleSize);
    const dimensionScores = (data as { dimensionScores?: unknown }).dimensionScores;
    const recommendations = (data as { recommendations?: unknown }).recommendations;

    if (!Number.isFinite(overallScore) || !Number.isFinite(sampleSize)) {
      throw new Error('Invalid voice analyzer response metrics');
    }

    if (!dimensionScores || typeof dimensionScores !== 'object') {
      throw new Error('Invalid voice analyzer dimensionScores');
    }

    if (!Array.isArray(recommendations) || !recommendations.every((r) => typeof r === 'string')) {
      throw new Error('Invalid voice analyzer recommendations');
    }

    return {
      overallScore,
      sampleSize,
      dimensionScores: dimensionScores as Record<string, number>,
      recommendations,
    };
  }
}
