/**
 * Pipeline Tool Executor
 *
 * Routes pipeline_ and template_ tool calls to pipeline module operations.
 * Follows the same pattern as content-executor.ts.
 */

import { createId } from '@paralleldrive/cuid2';
import { eq, and, desc, or, isNull, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  pipelines,
  pipelineSteps,
  pipelineExecutions,
  reviewDecisions,
  pipelineTemplates,
} from '../../pipelines/schema.js';
import type { StepType } from '../../pipelines/types.js';
import { MAX_PIPELINES_PER_TENANT } from '../../pipelines/types.js';
import { CreatePipelineInput, PipelineQueryInput, ExecutionQueryInput } from '../../pipelines/validation.js';
import { validateNoCycle } from '../../pipelines/graph/cycle-detector.js';
import type { StepRegistry } from '../../pipelines/steps/registry.js';
import type { DecisionRecorder } from '../../pipelines/review/decision.js';
import type { EventBus } from '../../pipelines/event-bus/interface.js';

// ============================================================
// CONTEXT
// ============================================================

export interface PipelineExecutorContext {
  tenantId: string;
  db: NodePgDatabase;
  stepRegistry: StepRegistry;
  decisionRecorder: DecisionRecorder;
  eventBus: EventBus;
}

// ============================================================
// EXECUTOR
// ============================================================

export async function executePipelineTool(
  toolName: string,
  input: Record<string, unknown>,
  context: PipelineExecutorContext,
): Promise<unknown> {
  const { db, tenantId, stepRegistry, decisionRecorder, eventBus } = context;

  switch (toolName) {
    // ── Pipeline Management ──────────────────────────────────────────────────

    case 'pipeline_create': {
      const parsed = CreatePipelineInput.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Invalid pipeline input: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        );
      }
      const data = parsed.data;

      // Check tenant limit
      const existing = await db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(eq(pipelines.tenantId, tenantId));

      if (existing.length >= MAX_PIPELINES_PER_TENANT) {
        throw new Error(
          `Tenant pipeline limit reached (${MAX_PIPELINES_PER_TENANT})`,
        );
      }

      // Validate steps
      for (const step of data.steps) {
        const errors = stepRegistry.validateStepConfig(
          step.stepType as StepType,
          step.config as Record<string, unknown>,
        );
        if (errors.length > 0) {
          throw new Error(
            `Invalid step "${step.name}": ${errors.join(', ')}`,
          );
        }
      }

      // Cycle detection
      const existingPipelines = await db.select().from(pipelines);
      const existingSteps = await db.select().from(pipelineSteps);
      const newId = createId();

      validateNoCycle(
        newId,
        data.triggerType,
        data.steps.map((s) => s.stepType as StepType),
        existingPipelines,
        existingSteps,
      );

      // Create pipeline + steps
      const [pipeline] = await db
        .insert(pipelines)
        .values({
          id: newId,
          tenantId,
          name: data.name,
          description: data.description ?? null,
          triggerType: data.triggerType,
          triggerConfig: data.triggerConfig,
          retryPolicy: data.retryPolicy ?? {
            maxRetries: 3,
            baseDelayMs: 30000,
            maxDelayMs: 300000,
            backoffMultiplier: 2,
          },
          concurrencyPolicy: data.concurrencyPolicy,
          reviewGateTimeoutHours: data.reviewGateTimeoutHours,
          maxPipelineDepth: data.maxPipelineDepth,
          status: 'active',
        })
        .returning();

      const stepRecords = data.steps.map((step, idx) => ({
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

      return { pipeline: { ...pipeline, steps: stepRecords } };
    }

    case 'pipeline_list': {
      const parsed = PipelineQueryInput.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Invalid query: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        );
      }
      const { status, limit, offset } = parsed.data;

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

      return { pipelines: rows, total: rows.length, limit, offset };
    }

    case 'pipeline_trigger': {
      const pipelineId = input.pipelineId as string;
      if (!pipelineId) {
        throw new Error('pipelineId is required');
      }

      const [pipeline] = await db
        .select()
        .from(pipelines)
        .where(
          and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId)),
        )
        .limit(1);

      if (!pipeline) {
        throw new Error(`Pipeline not found: ${pipelineId}`);
      }

      if (pipeline.status !== 'active') {
        throw new Error(
          `Pipeline is ${pipeline.status}, must be active to trigger`,
        );
      }

      const payload = (input.payload as Record<string, unknown>) ?? {};
      const eventId = await eventBus.publish(tenantId, 'manual_request', {
        pipelineId: pipeline.id,
        ...payload,
      });

      return { eventId, pipelineId: pipeline.id, status: 'triggered' };
    }

    case 'pipeline_status': {
      const pipelineId = input.pipelineId as string;
      if (!pipelineId) {
        throw new Error('pipelineId is required');
      }

      const [pipeline] = await db
        .select()
        .from(pipelines)
        .where(
          and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId)),
        )
        .limit(1);

      if (!pipeline) {
        throw new Error(`Pipeline not found: ${pipelineId}`);
      }

      const steps = await db
        .select()
        .from(pipelineSteps)
        .where(eq(pipelineSteps.pipelineId, pipeline.id))
        .orderBy(pipelineSteps.position);

      return { pipeline: { ...pipeline, steps } };
    }

    case 'pipeline_history': {
      const pipelineId = input.pipelineId as string;
      if (!pipelineId) {
        throw new Error('pipelineId is required');
      }

      // Verify ownership
      const [pipeline] = await db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(
          and(eq(pipelines.id, pipelineId), eq(pipelines.tenantId, tenantId)),
        )
        .limit(1);

      if (!pipeline) {
        throw new Error(`Pipeline not found: ${pipelineId}`);
      }

      const parsed = ExecutionQueryInput.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Invalid query: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        );
      }
      const { status, limit, offset } = parsed.data;

      const condition = status
        ? and(
            eq(pipelineExecutions.pipelineId, pipelineId),
            eq(pipelineExecutions.tenantId, tenantId),
            eq(pipelineExecutions.status, status),
          )
        : and(
            eq(pipelineExecutions.pipelineId, pipelineId),
            eq(pipelineExecutions.tenantId, tenantId),
          );

      const rows = await db
        .select()
        .from(pipelineExecutions)
        .where(condition)
        .orderBy(desc(pipelineExecutions.startedAt))
        .limit(limit)
        .offset(offset);

      return { executions: rows, total: rows.length, limit, offset };
    }

    // ── Review ───────────────────────────────────────────────────────────────

    case 'review_decide': {
      const decisionId = input.decisionId as string;
      const status = input.status as 'approved' | 'rejected';
      const feedback = input.feedback as
        | { reason: string; category: string; details?: string; suggestedAction?: string }
        | undefined;

      if (!decisionId || !status) {
        throw new Error('decisionId and status are required');
      }

      const result = await decisionRecorder.recordDecision(
        decisionId,
        tenantId,
        status,
        tenantId, // reviewerId
        feedback,
      );

      return result;
    }

    // ── Templates ────────────────────────────────────────────────────────────

    case 'template_list': {
      const category = input.category as string | undefined;

      // Templates visible to this tenant: built-in (null tenantId) or own tenant
      const condition = category
        ? and(
            or(
              isNull(pipelineTemplates.tenantId),
              eq(pipelineTemplates.tenantId, tenantId),
            ),
            eq(pipelineTemplates.isActive, true),
            eq(pipelineTemplates.category, category),
          )
        : and(
            or(
              isNull(pipelineTemplates.tenantId),
              eq(pipelineTemplates.tenantId, tenantId),
            ),
            eq(pipelineTemplates.isActive, true),
          );

      const rows = await db
        .select()
        .from(pipelineTemplates)
        .where(condition)
        .orderBy(pipelineTemplates.category, pipelineTemplates.name);

      return {
        templates: rows.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          parameters: t.parameters,
          assumptions: t.assumptions,
          version: t.version,
          isBuiltIn: t.tenantId === null,
        })),
        total: rows.length,
      };
    }

    case 'template_instantiate': {
      const templateId = input.templateId as string;
      const name = input.name as string;
      const paramOverrides =
        (input.parameterOverrides as Record<string, unknown>) ?? {};

      if (!templateId || !name) {
        throw new Error('templateId and name are required');
      }

      // Load template (must be visible to tenant)
      const [template] = await db
        .select()
        .from(pipelineTemplates)
        .where(
          and(
            eq(pipelineTemplates.id, templateId),
            eq(pipelineTemplates.isActive, true),
            or(
              isNull(pipelineTemplates.tenantId),
              eq(pipelineTemplates.tenantId, tenantId),
            ),
          ),
        )
        .limit(1);

      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }

      // Check tenant limit
      const existingCount = await db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(eq(pipelines.tenantId, tenantId));

      if (existingCount.length >= MAX_PIPELINES_PER_TENANT) {
        throw new Error(
          `Tenant pipeline limit reached (${MAX_PIPELINES_PER_TENANT})`,
        );
      }

      // Merge template definition with parameter overrides
      const definition = template.definition as Record<string, unknown>;
      const mergedDef = { ...definition, ...paramOverrides };

      // Extract pipeline fields from template definition
      const triggerType = (mergedDef.triggerType as string) ?? 'manual_request';
      const triggerConfig = (mergedDef.triggerConfig as Record<string, unknown>) ?? {
        type: 'manual_request',
      };
      const steps = (mergedDef.steps as Array<Record<string, unknown>>) ?? [];

      const pipelineId = createId();

      const [pipeline] = await db
        .insert(pipelines)
        .values({
          id: pipelineId,
          tenantId,
          name,
          description: template.description,
          triggerType: triggerType as 'corpus_change' | 'schedule_tick' | 'manual_request',
          triggerConfig,
          templateId: template.id,
          status: 'active',
        })
        .returning();

      // Create steps from template
      const stepRecords = steps.map((step, idx) => ({
        id: createId(),
        pipelineId: pipeline.id,
        position: idx,
        name: (step.name as string) ?? `Step ${idx + 1}`,
        stepType: (step.stepType as StepType) ?? 'notification',
        config: (step.config as Record<string, unknown>) ?? {},
        inputRefs: (step.inputRefs as Array<Record<string, unknown>>) ?? [],
        retryPolicyOverride: null,
      }));

      if (stepRecords.length > 0) {
        await db.insert(pipelineSteps).values(stepRecords);
      }

      return {
        pipeline: { ...pipeline, steps: stepRecords },
        templateId: template.id,
        templateName: template.name,
      };
    }

    default:
      throw new Error(`Unknown pipeline tool: ${toolName}`);
  }
}
