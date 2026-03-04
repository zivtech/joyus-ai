/**
 * Voice Analyzer — Interface and stub implementation.
 *
 * Real implementations (e.g. profile-engine-backed) are provided by
 * downstream packages and injected into DriftMonitor at startup.
 */

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
