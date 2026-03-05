/**
 * Content Monitoring — Public API
 *
 * Barrel export for all monitoring components.
 * Router is mounted at /api/content in WP12 (src/index.ts).
 */

export { ContentLogger } from './logger.js';
export type { ContentLogEntry } from './logger.js';

export { HealthChecker } from './health.js';
export type { HealthReport, ComponentHealth, HealthStatus } from './health.js';

export { MetricsCollector } from './metrics.js';
export type {
  ContentMetrics,
  SyncMetrics,
  SearchMetrics,
  EntitlementMetrics,
  GenerationMetrics,
  DriftMetrics,
} from './metrics.js';

export { createMonitoringRouter } from './routes.js';

export type { DriftAnalysis, VoiceAnalyzer, HttpVoiceAnalyzerConfig } from './voice-analyzer.js';
export { StubVoiceAnalyzer, HttpVoiceAnalyzer } from './voice-analyzer.js';

export { DriftMonitor, getLatestDriftReport, getDriftSummary } from './drift.js';
