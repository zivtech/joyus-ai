/**
 * Automated Pipelines Framework — Express REST Routes
 *
 * Tenant-scoped routes for pipeline CRUD, execution management,
 * review decisions, and manual triggers.
 *
 * TENANT ISOLATION: Every query includes tenantId. Cross-tenant access
 * returns 404 (not 403) to avoid leaking resource existence.
 */

import { createId } from '@paralleldrive/cuid2';
import { eq, and, desc, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Router, type Request, type Response } from 'express';

import {
  pipelines,
  pipelineSteps,
  pipelineExecutions,
  executionSteps,
  reviewDecisions,
  triggerEvents,
  pipelineTemplates,
} from './schema.js';
import type { StepType } from './types.js';
import { MAX_PIPELINES_PER_TENANT } from './types.js';
import {
  CreatePipelineInput,
  UpdatePipelineInput,
  ReviewDecisionInput,
  PipelineQueryInput,
  ExecutionQueryInput,
} from './validation.js';
import { validateNoCycle } from './graph/cycle-detector.js';
import type { StepRegistry } from './steps/registry.js';
import type { DecisionRecorder } from './review/decision.js';
import { inngest } from '../inngest/client.js';

// ============================================================
// TYPES
// ============================================================

export interface PipelineRouterDeps {
  db: NodePgDatabase;
  stepRegistry: StepRegistry;
  decisionRecorder: DecisionRecorder;
}

// ============================================================
// TENANT EXTRACTION
// ============================================================

/**
 * Extract tenantId from request. Derives from authenticated user only
 * — never trust headers for tenant identity.
 */
function getTenantId(req: Request): string {
  // Derive from authenticated user — never trust headers
  if (req.session?.userId) return req.session.userId;
  const user = (req as unknown as Record<string, unknown>)['mcpUser'] as
    | { id: string }
    | undefined;
  if (user?.id) return user.id;
  return '';
}

// ============================================================
// ROUTER FACTORY
// ============================================================

export function createPipelineRouter(deps: PipelineRouterDeps): Router {
  const { db, stepRegistry, decisionRecorder } = deps;
  const router = Router();

  // ----------------------------------------------------------
  // PIPELINE CRUD
  // ----------------------------------------------------------

  /** POST /pipelines — Create a new pipeline */
  router.post('/pipelines', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }

    // Validate input
    const parsed = CreatePipelineInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid pipeline input',
        details: parsed.error.issues,
      });
    }
    const input = parsed.data;

    try {
      // Check tenant pipeline limit
      const existing = await db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(eq(pipelines.tenantId, tenantId));

      if (existing.length >= MAX_PIPELINES_PER_TENANT) {
        return res.status(409).json({
          error: `Tenant pipeline limit reached (${MAX_PIPELINES_PER_TENANT})`,
        });
      }

      // Validate step types via registry
      for (const step of input.steps) {
        const errors = stepRegistry.validateStepConfig(
          step.stepType as StepType,
          step.config as Record<string, unknown>,
        );
        if (errors.length > 0) {
          return res.status(400).json({
            error: `Invalid step configuration for "${step.name}"`,
            details: errors,
          });
        }
      }

      // Cycle detection
      const existingPipelines = await db.select().from(pipelines);
      const existingSteps = await db.select().from(pipelineSteps);
      const newPipelineId = createId();

      try {
        validateNoCycle(
          newPipelineId,
          input.triggerType,
          input.steps.map((s) => s.stepType as StepType),
          existingPipelines,
          existingSteps,
        );
      } catch (cycleError) {
        return res.status(400).json({
          error: cycleError instanceof Error
            ? cycleError.message
            : 'Pipeline cycle detected',
        });
      }

      // Create pipeline
      const [pipeline] = await db
        .insert(pipelines)
        .values({
          id: newPipelineId,
          tenantId,
          name: input.name,
          description: input.description ?? null,
          triggerType: input.triggerType,
          triggerConfig: input.triggerConfig,
          retryPolicy: input.retryPolicy ?? {
            maxRetries: 3,
            baseDelayMs: 30000,
            maxDelayMs: 300000,
            backoffMultiplier: 2,
          },
          concurrencyPolicy: input.concurrencyPolicy,
          reviewGateTimeoutHours: input.reviewGateTimeoutHours,
          maxPipelineDepth: input.maxPipelineDepth,
          status: 'active',
        })
        .returning();

      // Create steps
      const stepRecords = input.steps.map((step, idx) => ({
        id: createId(),
        pipelineId: pipeline.id,
        position: idx,
        name: step.name,
        stepType: step.stepType as StepType,
        config: step.config,
        inputRefs: step.inputRefs,
        retryPolicyOverride: step.retryPolicyOverride ?? null,
      }));

      if (stepRecords.length > 0) {
        await db.insert(pipelineSteps).values(stepRecords);
      }

      return res.status(201).json({
        pipeline: { ...pipeline, steps: stepRecords },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: message });
    }
  });

  /** GET /pipelines — List pipelines for tenant */
  router.get('/pipelines', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }

    const parsed = PipelineQueryInput.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.issues,
      });
    }
    const { status, limit, offset } = parsed.data;

    try {
      const condition = status
        ? and(eq(pipelines.tenantId, tenantId), eq(pipelines.status, status))
        : eq(pipelines.tenantId, tenantId);

      const rows = await db
        .select()
        .from(pipelines)
        .where(condition)
        .orderBy(desc(pipelines.createdAt))
        .limit(limit)
        .offset(offset);

      return res.json({ pipelines: rows, total: rows.length, limit, offset });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: message });
    }
  });

  /** GET /pipelines/:id — Get pipeline by ID */
  router.get('/pipelines/:id', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }

    try {
      const [pipeline] = await db
        .select()
        .from(pipelines)
        .where(
          and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, tenantId)),
        )
        .limit(1);

      if (!pipeline) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      const steps = await db
        .select()
        .from(pipelineSteps)
        .where(eq(pipelineSteps.pipelineId, pipeline.id))
        .orderBy(pipelineSteps.position);

      return res.json({ pipeline: { ...pipeline, steps } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: message });
    }
  });

  /** PUT /pipelines/:id — Update pipeline */
  router.put('/pipelines/:id', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }

    const parsed = UpdatePipelineInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid pipeline update input',
        details: parsed.error.issues,
      });
    }
    const input = parsed.data;

    try {
      // Verify pipeline belongs to tenant
      const [existing] = await db
        .select()
        .from(pipelines)
        .where(
          and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, tenantId)),
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      // If steps are being updated, re-run cycle detection
      if (input.steps) {
        const existingPipelines = await db.select().from(pipelines);
        const existingSteps = await db.select().from(pipelineSteps);

        // Remove this pipeline's steps from existing for cycle check
        const otherPipelines = existingPipelines.filter(
          (p) => p.id !== req.params.id,
        );
        const otherSteps = existingSteps.filter(
          (s) => s.pipelineId !== req.params.id,
        );

        try {
          validateNoCycle(
            req.params.id,
            input.triggerType ?? existing.triggerType,
            input.steps.map((s) => s.stepType as StepType),
            otherPipelines,
            otherSteps,
          );
        } catch (cycleError) {
          return res.status(400).json({
            error: cycleError instanceof Error
              ? cycleError.message
              : 'Pipeline cycle detected',
          });
        }
      }

      // Build update payload (exclude undefined fields)
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData['name'] = input.name;
      if (input.description !== undefined) updateData['description'] = input.description;
      if (input.triggerType !== undefined) updateData['triggerType'] = input.triggerType;
      if (input.triggerConfig !== undefined) updateData['triggerConfig'] = input.triggerConfig;
      if (input.retryPolicy !== undefined) updateData['retryPolicy'] = input.retryPolicy;
      if (input.concurrencyPolicy !== undefined) updateData['concurrencyPolicy'] = input.concurrencyPolicy;
      if (input.reviewGateTimeoutHours !== undefined) updateData['reviewGateTimeoutHours'] = input.reviewGateTimeoutHours;
      if (input.maxPipelineDepth !== undefined) updateData['maxPipelineDepth'] = input.maxPipelineDepth;
      if (input.status !== undefined) updateData['status'] = input.status;

      await db
        .update(pipelines)
        .set(updateData)
        .where(eq(pipelines.id, req.params.id));

      // Replace steps if provided
      if (input.steps) {
        await db
          .delete(pipelineSteps)
          .where(eq(pipelineSteps.pipelineId, req.params.id));

        const stepRecords = input.steps.map((step, idx) => ({
          id: createId(),
          pipelineId: req.params.id,
          position: idx,
          name: step.name,
          stepType: step.stepType as StepType,
          config: step.config,
          inputRefs: step.inputRefs,
          retryPolicyOverride: step.retryPolicyOverride ?? null,
        }));

        if (stepRecords.length > 0) {
          await db.insert(pipelineSteps).values(stepRecords);
        }
      }

      // Fetch updated pipeline with steps
      const [updated] = await db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, req.params.id))
        .limit(1);

      const steps = await db
        .select()
        .from(pipelineSteps)
        .where(eq(pipelineSteps.pipelineId, req.params.id))
        .orderBy(pipelineSteps.position);

      return res.json({ pipeline: { ...updated, steps } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: message });
    }
  });

  /** DELETE /pipelines/:id — Delete pipeline */
  router.delete('/pipelines/:id', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }

    try {
      const [existing] = await db
        .select()
        .from(pipelines)
        .where(
          and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, tenantId)),
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      // Cascade delete handled by DB constraints
      await db.delete(pipelines).where(eq(pipelines.id, req.params.id));

      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: message });
    }
  });

  /** POST /pipelines/:id/trigger — Manual trigger */
  router.post('/pipelines/:id/trigger', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }

    try {
      const [pipeline] = await db
        .select()
        .from(pipelines)
        .where(
          and(eq(pipelines.id, req.params.id), eq(pipelines.tenantId, tenantId)),
        )
        .limit(1);

      if (!pipeline) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      if (pipeline.status !== 'active') {
        return res.status(400).json({
          error: `Pipeline is ${pipeline.status}, must be active to trigger`,
        });
      }

      const payload = (req.body?.payload as Record<string, unknown>) ?? {};
      await inngest.send({
        name: 'pipeline/manual.triggered',
        data: { tenantId, pipelineId: pipeline.id, payload },
      });
      const eventId = createId();

      return res.status(202).json({ eventId, pipelineId: pipeline.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: message });
    }
  });

  // ----------------------------------------------------------
  // EXECUTION ROUTES
  // ----------------------------------------------------------

  /** GET /pipelines/:id/executions — Execution history for a pipeline */
  router.get(
    '/pipelines/:id/executions',
    async (req: Request, res: Response) => {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(401).json({ error: 'Tenant context required' });
      }

      const parsed = ExecutionQueryInput.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: parsed.error.issues,
        });
      }
      const { status, limit, offset } = parsed.data;

      try {
        // Verify pipeline belongs to tenant
        const [pipeline] = await db
          .select({ id: pipelines.id })
          .from(pipelines)
          .where(
            and(
              eq(pipelines.id, req.params.id),
              eq(pipelines.tenantId, tenantId),
            ),
          )
          .limit(1);

        if (!pipeline) {
          return res.status(404).json({ error: 'Pipeline not found' });
        }

        const condition = status
          ? and(
              eq(pipelineExecutions.pipelineId, req.params.id),
              eq(pipelineExecutions.tenantId, tenantId),
              eq(pipelineExecutions.status, status),
            )
          : and(
              eq(pipelineExecutions.pipelineId, req.params.id),
              eq(pipelineExecutions.tenantId, tenantId),
            );

        const rows = await db
          .select()
          .from(pipelineExecutions)
          .where(condition)
          .orderBy(desc(pipelineExecutions.startedAt))
          .limit(limit)
          .offset(offset);

        return res.json({
          executions: rows,
          total: rows.length,
          limit,
          offset,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        return res.status(500).json({ error: message });
      }
    },
  );

  /** GET /executions/:id — Execution detail */
  router.get('/executions/:id', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }

    try {
      const [execution] = await db
        .select()
        .from(pipelineExecutions)
        .where(
          and(
            eq(pipelineExecutions.id, req.params.id),
            eq(pipelineExecutions.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      const steps = await db
        .select()
        .from(executionSteps)
        .where(eq(executionSteps.executionId, execution.id))
        .orderBy(executionSteps.position);

      const decisions = await db
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.executionId, execution.id));

      return res.json({ execution: { ...execution, steps, decisions } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: message });
    }
  });

  /** POST /executions/:id/cancel — Cancel an execution */
  router.post('/executions/:id/cancel', async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' });
    }

    const cancellableStatuses = [
      'pending',
      'paused_at_gate',
      'paused_on_failure',
    ] as const;

    try {
      const [execution] = await db
        .select()
        .from(pipelineExecutions)
        .where(
          and(
            eq(pipelineExecutions.id, req.params.id),
            eq(pipelineExecutions.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      if (
        !cancellableStatuses.includes(
          execution.status as (typeof cancellableStatuses)[number],
        )
      ) {
        return res.status(400).json({
          error: `Execution status "${execution.status}" cannot be cancelled`,
        });
      }

      await db
        .update(pipelineExecutions)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(pipelineExecutions.id, req.params.id));

      return res.json({ executionId: req.params.id, status: 'cancelled' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      return res.status(500).json({ error: message });
    }
  });

  // ----------------------------------------------------------
  // REVIEW ROUTES
  // ----------------------------------------------------------

  /** POST /review-decisions/:id/decide — Record a review decision */
  router.post(
    '/review-decisions/:id/decide',
    async (req: Request, res: Response) => {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(401).json({ error: 'Tenant context required' });
      }

      const parsed = ReviewDecisionInput.safeParse({
        ...req.body,
        decisionId: req.params.id,
      });
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid review decision input',
          details: parsed.error.issues,
        });
      }
      const input = parsed.data;

      try {
        const result = await decisionRecorder.recordDecision(
          input.decisionId,
          tenantId,
          input.status,
          tenantId, // reviewerId — use tenantId as reviewer for now
          input.feedback,
        );

        return res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';

        if (message.includes('not found')) {
          return res.status(404).json({ error: message });
        }
        if (message.includes('Cross-tenant')) {
          return res.status(404).json({ error: 'Review decision not found' });
        }
        if (message.includes('already resolved')) {
          return res.status(409).json({ error: message });
        }

        return res.status(500).json({ error: message });
      }
    },
  );

  /** GET /pipelines/:id/review-decisions — List pending decisions */
  router.get(
    '/pipelines/:id/review-decisions',
    async (req: Request, res: Response) => {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(401).json({ error: 'Tenant context required' });
      }

      try {
        // Verify pipeline belongs to tenant
        const [pipeline] = await db
          .select({ id: pipelines.id })
          .from(pipelines)
          .where(
            and(
              eq(pipelines.id, req.params.id),
              eq(pipelines.tenantId, tenantId),
            ),
          )
          .limit(1);

        if (!pipeline) {
          return res.status(404).json({ error: 'Pipeline not found' });
        }

        // Get executions for this pipeline
        const executions = await db
          .select({ id: pipelineExecutions.id })
          .from(pipelineExecutions)
          .where(eq(pipelineExecutions.pipelineId, req.params.id));

        if (executions.length === 0) {
          return res.json({ decisions: [], total: 0 });
        }

        const executionIds = executions.map((e) => e.id);
        const decisions = await db
          .select()
          .from(reviewDecisions)
          .where(
            and(
              inArray(reviewDecisions.executionId, executionIds),
              eq(reviewDecisions.tenantId, tenantId),
              eq(reviewDecisions.status, 'pending'),
            ),
          )
          .orderBy(desc(reviewDecisions.createdAt));

        return res.json({ decisions, total: decisions.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        return res.status(500).json({ error: message });
      }
    },
  );

  return router;
}
