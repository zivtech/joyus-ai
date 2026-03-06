import { Router, type Request, type Response } from 'express';

import { PipelineEngine } from './engine.js';
import {
  PipelineQueueBackpressureError,
  PipelineRunner,
  type PipelineQueueMetrics,
} from './runner.js';
import type { PipelineDefinition, PipelineMode, StagePolicyGate } from './types.js';

function estimateSeverity(text: string): 'low' | 'medium' | 'high' | 'critical' {
  const t = text.toLowerCase();
  if (/(outage|data loss|breach|security|payments down|production down)/.test(t)) return 'critical';
  if (/(error|fails|broken|regression|timeout|incident)/.test(t)) return 'high';
  if (/(warning|slow|degraded|intermittent)/.test(t)) return 'medium';
  return 'low';
}

function createBugTriagePipeline(): PipelineDefinition {
  return {
    id: 'bug-triage-v1',
    name: 'Bug Triage Pilot',
    stages: [
      {
        id: 'trigger',
        async handler(ctx) {
          return {
            output: {
              issueTitle: String(ctx.input.issueTitle ?? ''),
              issueBody: String(ctx.input.issueBody ?? ''),
            },
            evidence: { source: 'manual-api-trigger' },
          };
        },
      },
      {
        id: 'enrich',
        async handler(ctx) {
          const issueTitle = String(ctx.state.trigger && (ctx.state.trigger as Record<string, unknown>).issueTitle || '');
          const issueBody = String(ctx.state.trigger && (ctx.state.trigger as Record<string, unknown>).issueBody || '');
          const combined = `${issueTitle} ${issueBody}`.trim();
          const keywords = combined
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length > 3)
            .slice(0, 12);
          return {
            output: { combined, keywords },
            evidence: { keywordCount: keywords.length },
          };
        },
      },
      {
        id: 'analyze',
        async handler(ctx) {
          const enriched = (ctx.state.enrich as Record<string, unknown>) ?? {};
          const combined = String(enriched.combined ?? '');
          const severity = estimateSeverity(combined);
          return {
            output: { severity, priority: severity === 'critical' ? 'P0' : severity === 'high' ? 'P1' : 'P2' },
            evidence: { model: 'heuristic-v1' },
          };
        },
      },
      {
        id: 'act',
        privileged: true,
        async handler(ctx) {
          const analysis = (ctx.state.analyze as Record<string, unknown>) ?? {};
          const severity = String(analysis.severity ?? 'low');
          return {
            output: {
              suggestedOwnerTeam: severity === 'critical' ? 'platform-oncall' : 'feature-team',
              suggestedAction: severity === 'critical' ? 'page-oncall-and-open-incident' : 'open-triage-ticket',
            },
            evidence: { mode: ctx.mode },
          };
        },
      },
      {
        id: 'deliver',
        async handler(ctx) {
          const analysis = (ctx.state.analyze as Record<string, unknown>) ?? {};
          const action = (ctx.state.act as Record<string, unknown>) ?? {};
          return {
            output: {
              summary: `Severity=${analysis.severity ?? 'unknown'} priority=${analysis.priority ?? 'unknown'}`,
              recommendedAction: action.suggestedAction ?? 'manual-review',
              ownerTeam: action.suggestedOwnerTeam ?? 'unassigned',
            },
            evidence: { deliveredAt: new Date().toISOString() },
          };
        },
      },
    ],
  };
}

export function createPipelineRouter(): Router {
  const router = Router();

  const policyGate: StagePolicyGate = async ({ mode, stage }) => {
    if (stage.privileged && mode === 'apply' && process.env.PIPELINE_APPLY_ENABLED !== 'true') {
      return {
        allow: false,
        reason: 'apply mode is disabled for privileged stages',
        evidenceRef: 'policy:pipeline-apply-disabled',
      };
    }
    return { allow: true };
  };

  const engine = new PipelineEngine(policyGate);
  const runner = new PipelineRunner(engine, {
    concurrency: Number(process.env.PIPELINE_CONCURRENCY ?? 2),
    maxQueueDepth: Number(process.env.PIPELINE_QUEUE_MAX_DEPTH ?? 200),
  });

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  router.get('/metrics', (_req: Request, res: Response) => {
    const metrics: PipelineQueueMetrics = runner.getMetrics();
    res.json({ queue: metrics, collectedAt: new Date().toISOString() });
  });

  router.post('/bug-triage/run', async (req: Request, res: Response) => {
    try {
      const mode: PipelineMode = req.body?.mode === 'apply' ? 'apply' : 'dry-run';
      const issueTitle = String(req.body?.issueTitle ?? '');
      const issueBody = String(req.body?.issueBody ?? '');

      if (!issueTitle) {
        res.status(400).json({ error: 'missing_issue_title', message: 'issueTitle is required' });
        return;
      }

      const report = await runner.enqueue(
        createBugTriagePipeline(),
        { issueTitle, issueBody },
        { mode },
      );
      res.json({ report });
    } catch (err) {
      if (err instanceof PipelineQueueBackpressureError) {
        res.status(429).json({
          error: 'pipeline_queue_saturated',
          message: err.message,
        });
        return;
      }
      res.status(500).json({
        error: 'pipeline_execution_failed',
        message: err instanceof Error ? err.message : 'internal error',
      });
    }
  });

  return router;
}
