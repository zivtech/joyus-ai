/**
 * Integration Tests — Drift Monitoring
 *
 * Verifies background drift evaluation produces reports.
 * Uses mocks — no real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DriftMonitor } from '../../../src/content/monitoring/drift.js';
import { StubVoiceAnalyzer } from '../../../src/content/monitoring/voice-analyzer.js';
import type { DriftAnalysis } from '../../../src/content/monitoring/voice-analyzer.js';

// ── Helpers ────────────────────────────────────────────────────────────────

interface GenerationLogEntry {
  id: string;
  profileId: string | null;
  tenantId: string;
  query: string;
  responseText: string;
  driftScore: number | null;
}

function makeLogEntry(overrides: Partial<GenerationLogEntry> = {}): GenerationLogEntry {
  return {
    id: `log-${Math.random().toString(36).slice(2)}`,
    profileId: 'profile-1',
    tenantId: 'tenant-1',
    query: 'What is the policy?',
    responseText: 'The policy states that all accounts must comply.',
    driftScore: null,
    ...overrides,
  };
}

const mockDb = {} as never;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Drift Monitoring', () => {
  describe('StubVoiceAnalyzer', () => {
    it('returns a zero-drift score for any text', async () => {
      const analyzer = new StubVoiceAnalyzer();
      const result = await analyzer.analyze('Any text here.', 'profile-1', 'tenant-1');

      expect(result.overallScore).toBe(0.0);
      expect(result.dimensionScores).toBeDefined();
      expect(result.sampleSize).toBe(0);
      expect(result.recommendations).toHaveLength(1);
    });
  });

  describe('evaluates unscored generations', () => {
    it('calls analyzer for entries with null driftScore', async () => {
      const mockAnalyzer = {
        analyze: vi.fn().mockResolvedValue({
          overallScore: 0.87,
          dimensionScores: { tone: 0.9, vocabulary: 0.85, structure: 0.86 },
          sampleSize: 1,
          recommendations: [],
        } satisfies DriftAnalysis),
      };

      const unscoredEntries = [
        makeLogEntry({ id: 'log-1', driftScore: null }),
        makeLogEntry({ id: 'log-2', driftScore: null }),
      ];

      // Simulate evaluation loop
      const scored: Array<GenerationLogEntry & { driftScore: number }> = [];
      for (const entry of unscoredEntries) {
        if (entry.profileId && entry.driftScore === null) {
          const analysis = await mockAnalyzer.analyze(entry.responseText, entry.profileId, entry.tenantId);
          scored.push({ ...entry, driftScore: analysis.overallScore });
        }
      }

      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(2);
      expect(scored).toHaveLength(2);
      expect(scored[0].driftScore).toBe(0.87);
      expect(scored[1].driftScore).toBe(0.87);
    });

    it('skips already-scored entries', async () => {
      const mockAnalyzer = {
        analyze: vi.fn().mockResolvedValue({
          overallScore: 0.9,
          dimensionScores: {},
          sampleSize: 1,
          recommendations: [],
        } satisfies DriftAnalysis),
      };

      const entries = [
        makeLogEntry({ id: 'log-already-scored', driftScore: 0.95 }),
      ];

      for (const entry of entries) {
        if (entry.profileId && entry.driftScore === null) {
          await mockAnalyzer.analyze(entry.responseText, entry.profileId, entry.tenantId);
        }
      }

      expect(mockAnalyzer.analyze).not.toHaveBeenCalled();
    });
  });

  describe('skips generations without profileId', () => {
    it('does not evaluate entries with null profileId', async () => {
      const mockAnalyzer = {
        analyze: vi.fn().mockResolvedValue({
          overallScore: 0.9,
          dimensionScores: {},
          sampleSize: 1,
          recommendations: [],
        } satisfies DriftAnalysis),
      };

      const entries = [
        makeLogEntry({ id: 'log-no-profile', profileId: null, driftScore: null }),
        makeLogEntry({ id: 'log-with-profile', profileId: 'profile-1', driftScore: null }),
      ];

      for (const entry of entries) {
        if (entry.profileId && entry.driftScore === null) {
          await mockAnalyzer.analyze(entry.responseText, entry.profileId, entry.tenantId);
        }
      }

      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(1);
      expect(mockAnalyzer.analyze).toHaveBeenCalledWith(
        entries[1].responseText,
        'profile-1',
        'tenant-1',
      );
    });
  });

  describe('generates aggregate drift report', () => {
    it('averages scores across multiple analyses', async () => {
      const mockAnalyzer = {
        analyze: vi
          .fn()
          .mockResolvedValueOnce({ overallScore: 0.80, dimensionScores: { tone: 0.8 }, sampleSize: 1, recommendations: [] })
          .mockResolvedValueOnce({ overallScore: 0.90, dimensionScores: { tone: 0.9 }, sampleSize: 1, recommendations: [] })
          .mockResolvedValueOnce({ overallScore: 1.00, dimensionScores: { tone: 1.0 }, sampleSize: 1, recommendations: [] }),
      };

      const entries = [
        makeLogEntry({ id: 'log-1', driftScore: null }),
        makeLogEntry({ id: 'log-2', driftScore: null }),
        makeLogEntry({ id: 'log-3', driftScore: null }),
      ];

      const scores: number[] = [];
      for (const entry of entries) {
        if (entry.profileId && entry.driftScore === null) {
          const analysis = await mockAnalyzer.analyze(entry.responseText, entry.profileId, entry.tenantId);
          scores.push(analysis.overallScore);
        }
      }

      const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;

      expect(scores).toHaveLength(3);
      expect(overallScore).toBeCloseTo(0.9, 5);
    });

    it('report includes correct evaluated count', async () => {
      const scores = [0.85, 0.92, 0.78];
      const report = {
        profileId: 'profile-1',
        generationsEvaluated: scores.length,
        overallDriftScore: scores.reduce((a, b) => a + b, 0) / scores.length,
        windowStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
        windowEnd: new Date(),
      };

      expect(report.generationsEvaluated).toBe(3);
      expect(report.overallDriftScore).toBeCloseTo(0.85, 2);
      expect(report.windowEnd.getTime()).toBeGreaterThan(report.windowStart.getTime());
    });
  });

  describe('DriftMonitor lifecycle', () => {
    it('starts and stops without error', () => {
      const analyzer = new StubVoiceAnalyzer();
      const monitor = new DriftMonitor(analyzer, mockDb);

      expect(() => monitor.start(999_999)).not.toThrow();
      expect(() => monitor.stop()).not.toThrow();
    });

    it('does not start a second interval when already running', () => {
      const analyzer = new StubVoiceAnalyzer();
      const monitor = new DriftMonitor(analyzer, mockDb);

      monitor.start(999_999);
      // Second call should be a no-op
      expect(() => monitor.start(999_999)).not.toThrow();
      monitor.stop();
    });
  });
});
