/**
 * Content Monitoring Routes
 *
 * Exposes health and metrics as HTTP endpoints.
 * No authentication required — needed for external monitoring systems.
 *
 * GET /health  — aggregate subsystem health (200 or 503)
 * GET /metrics — operational metrics computed from operation_logs
 *
 * These routes are mounted at /api/content in WP12.
 */

import { Router, Request, Response } from 'express';

import { HealthChecker } from './health.js';
import { MetricsCollector } from './metrics.js';

export function createMonitoringRouter(
  healthChecker: HealthChecker,
  metricsCollector: MetricsCollector,
): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const report = await healthChecker.check();
      res.status(report.status === 'unhealthy' ? 503 : 200).json(report);
    } catch (err) {
      res.status(500).json({
        status: 'unhealthy',
        components: {},
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'internal error',
      });
    }
  });

  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const metrics = await metricsCollector.getMetrics();
      res.json(metrics);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'internal error',
      });
    }
  });

  return router;
}
