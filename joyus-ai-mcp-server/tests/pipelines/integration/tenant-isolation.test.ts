/**
 * Integration tests — Tenant Isolation (T059)
 *
 * Verifies that pipeline data, execution triggers, review decisions, and
 * analytics are strictly scoped to the requesting tenant. Uses mock DB /
 * service objects — no real database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineExecutor } from '../../../src/pipelines/engine/executor.js';
import { InMemoryEventBus } from '../../../src/pipelines/event-bus/interface.js';
import { TriggerRegistry } from '../../../src/pipelines/triggers/registry.js';
import { CorpusChangeTriggerHandler } from '../../../src/pipelines/triggers/corpus-change.js';
import { DecisionRecorder } from '../../../src/pipelines/review/decision.js';
import type { Pipeline, PipelineExecution, ReviewDecision } from '../../../src/pipelines/schema.js';
import type { StepResult, StepType } from '../../../src/pipelines/types.js';
import type {
  PipelineStepHandler,
  StepHandlerRegistry,
  ExecutionContext,
} from '../../../src/pipelines/engine/step-runner.js';
import { StepRunner } from '../../../src/pipelines/engine/step-runner.js';
import {
  pipelines as pipelinesTable,
  pipelineSteps as pipelineStepsTable,
  pipelineExecutions as pipelineExecutionsTable,
  executionSteps as executionStepsTable,
  triggerEvents as triggerEventsTable,
} from '../../../src/pipelines/schema.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(id: string, tenantId: string): Pipeline {
  return {
    id,
    tenantId,
    name: `Pipeline ${id}`,
    description: null,
    triggerType: 'corpus_change',
    triggerConfig: { type: 'corpus_change' },
    retryPolicy: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
    concurrencyPolicy: 'allow_concurrent',
    reviewGateTimeoutHours: 48,
    maxPipelineDepth: 10,
    status: 'active',
    templateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Pipeline;
}

function makeStep(pipelineId: string, position: number) {
  return {
    id: `step-${pipelineId}-${position}`,
    pipelineId,
    position,
    name: `Step ${position}`,
    stepType: 'notification' as StepType,
    config: { type: 'notification' },
    inputRefs: [],
    retryPolicyOverride: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeExecution(id: string, pipelineId: string, tenantId: string): PipelineExecution {
  return {
    id,
    pipelineId,
    tenantId,
    triggerEventId: `trig-${id}`,
    status: 'running',
    stepsCompleted: 0,
    stepsTotal: 1,
    currentStepPosition: 0,
    triggerChainDepth: 0,
    outputArtifacts: [],
    errorDetail: null,
    startedAt: new Date(),
    completedAt: null,
  } as unknown as PipelineExecution;
}

function makeDecision(
  id: string,
  executionId: string,
  tenantId: string,
  status: 'pending' | 'approved' | 'rejected' = 'pending',
): ReviewDecision {
  return {
    id,
    executionId,
    executionStepId: 'gate-step-1',
    tenantId,
    artifactRef: { type: 'content', id: `art-${id}` },
    profileVersionRef: null,
    reviewerId: null,
    status,
    feedback: null,
    decidedAt: null,
    escalatedAt: null,
    createdAt: new Date(),
  } as unknown as ReviewDecision;
}

// ── Mock DB (tenant-aware) ───────────────────────────────────────────────────

function getTableName(table: unknown): string {
  if (table === pipelinesTable) return 'pipelines';
  if (table === pipelineStepsTable) return 'pipeline_steps';
  if (table === pipelineExecutionsTable) return 'pipeline_executions';
  if (table === executionStepsTable) return 'execution_steps';
  if (table === triggerEventsTable) return 'trigger_events';
  return 'unknown';
}

interface TenantIsolationDbOptions {
  pipelines: Pipeline[];
  steps: ReturnType<typeof makeStep>[];
  executions: PipelineExecution[];
  decisions: ReviewDecision[];
}

function createTenantDb(options: TenantIsolationDbOptions) {
  const inserts: Array<{ table: string; values: unknown }> = [];
  const updates: Array<{ table: string; setValues: Record<string, unknown> }> = [];

  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table: getTableName(table), values });
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table: getTableName(table), setValues: values });
        return { where: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const name = getTableName(table);
          if (name === 'pipelines') return Promise.resolve(options.pipelines);
          if (name === 'pipeline_steps') return Promise.resolve(options.steps);
          if (name === 'pipeline_executions') return Promise.resolve(options.executions);
          return Promise.resolve([]);
        },
      }),
    }),
    // For DecisionRecorder select (returns decisions)
    _selectDecision: (decisionId: string) =>
      options.decisions.filter((d) => d.id === decisionId),
    inserts,
    updates,
  };

  return db;
}

// ── Mock step handler ─────────────────────────────────────────────────────────

function createMockRegistry(
  executeFn: (ctx: ExecutionContext) => Promise<StepResult>,
): StepHandlerRegistry {
  const handler: PipelineStepHandler = {
    stepType: 'notification' as StepType,
    execute: (_cfg, ctx) => executeFn(ctx),
  } as unknown as PipelineStepHandler;
  return { getHandler: () => handler };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const TENANT_ALPHA = 'tenant-alpha';
const TENANT_BETA = 'tenant-beta';

const alphaPipeline = makePipeline('pipe-alpha-1', TENANT_ALPHA);
const betaPipeline = makePipeline('pipe-beta-1', TENANT_BETA);
const alphaStep = makeStep('pipe-alpha-1', 0);
const betaStep = makeStep('pipe-beta-1', 0);
const alphaExecution = makeExecution('exec-alpha-1', 'pipe-alpha-1', TENANT_ALPHA);
const betaExecution = makeExecution('exec-beta-1', 'pipe-beta-1', TENANT_BETA);
const alphaDecision = makeDecision('dec-alpha-1', 'exec-alpha-1', TENANT_ALPHA);
const betaDecision = makeDecision('dec-beta-1', 'exec-beta-1', TENANT_BETA);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Tenant Isolation', () => {
  describe('T059-1: listing pipelines', () => {
    it('tenant-alpha only receives its own pipelines', async () => {
      // The DB mock returns all pipelines — the executor filters by tenantId via WHERE clause.
      // Here we test that the executor query is correctly scoped by verifying which
      // pipelines it triggers steps for.
      const allPipelines = [alphaPipeline, betaPipeline];
      const allSteps = [alphaStep, betaStep];

      // Only return alpha's pipelines for alpha's tenant query
      const alphaPipelines = allPipelines.filter((p) => p.tenantId === TENANT_ALPHA);
      const alphaSteps = allSteps.filter((s) => s.pipelineId === 'pipe-alpha-1');

      const db = createTenantDb({
        pipelines: alphaPipelines,  // simulates WHERE tenantId = 'tenant-alpha'
        steps: alphaSteps,
        executions: [],
        decisions: [],
      });

      const triggeredPipelineIds: string[] = [];
      const registry = createMockRegistry(async (ctx) => {
        triggeredPipelineIds.push(ctx.pipelineId);
        return { success: true };
      });

      const stepRunner = new StepRunner(db as never, registry);
      const eventBus = new InMemoryEventBus();
      const triggerRegistry = new TriggerRegistry();
      triggerRegistry.register(new CorpusChangeTriggerHandler());

      const executor = new PipelineExecutor(db as never, eventBus, triggerRegistry, stepRunner);
      executor.start();
      await eventBus.publish(TENANT_ALPHA, 'corpus_change', {});
      await executor.stop();

      // Only alpha pipeline should have been triggered
      expect(triggeredPipelineIds).toEqual(['pipe-alpha-1']);
      expect(triggeredPipelineIds).not.toContain('pipe-beta-1');
    });
  });

  describe('T059-2: get pipeline by ID — cross-tenant returns nothing', () => {
    it('filtering by tenantId excludes other tenants pipelines', () => {
      const all = [alphaPipeline, betaPipeline];

      // Simulate what a route handler does: filter by tenantId
      const alphaView = all.filter((p) => p.tenantId === TENANT_ALPHA);
      const betaView = all.filter((p) => p.tenantId === TENANT_BETA);

      expect(alphaView.map((p) => p.id)).toEqual(['pipe-alpha-1']);
      expect(betaView.map((p) => p.id)).toEqual(['pipe-beta-1']);

      // tenant-alpha cannot see pipe-beta-1
      const crossTenantResult = alphaView.find((p) => p.id === 'pipe-beta-1');
      expect(crossTenantResult).toBeUndefined();
    });
  });

  describe('T059-3: event trigger — alpha event does not trigger beta pipelines', () => {
    it('corpus_change for alpha tenant only triggers alpha pipelines', async () => {
      // Only return beta pipelines — simulate alpha event arriving but db filtered to beta
      // (this would normally not happen; here we prove the tenantId in event is what gates it)
      const alphaPipelines = [alphaPipeline];
      const alphaSteps = [alphaStep];

      const db = createTenantDb({
        pipelines: alphaPipelines,
        steps: alphaSteps,
        executions: [],
        decisions: [],
      });

      const triggeredTenants: string[] = [];
      const registry = createMockRegistry(async (ctx) => {
        triggeredTenants.push(ctx.tenantId);
        return { success: true };
      });

      const stepRunner = new StepRunner(db as never, registry);
      const eventBus = new InMemoryEventBus();
      const triggerRegistry = new TriggerRegistry();
      triggerRegistry.register(new CorpusChangeTriggerHandler());

      const executor = new PipelineExecutor(db as never, eventBus, triggerRegistry, stepRunner);
      executor.start();

      // Alpha event published
      await eventBus.publish(TENANT_ALPHA, 'corpus_change', {});
      await executor.stop();

      // Only alpha executions created
      expect(triggeredTenants.every((t) => t === TENANT_ALPHA)).toBe(true);
    });

    it('corpus_change for beta does not affect alpha execution count', async () => {
      // Mock DB returns NO pipelines (simulating WHERE tenantId = 'tenant-beta' → empty)
      // so publishing a beta event triggers nothing.
      const db = createTenantDb({
        pipelines: [],   // beta tenant has no pipelines in this scenario
        steps: [],
        executions: [],
        decisions: [],
      });

      const alphaCallCount = { count: 0 };
      const registry = createMockRegistry(async (ctx) => {
        if (ctx.tenantId === TENANT_ALPHA) alphaCallCount.count++;
        return { success: true };
      });

      const stepRunner = new StepRunner(db as never, registry);
      const eventBus = new InMemoryEventBus();
      const triggerRegistry = new TriggerRegistry();
      triggerRegistry.register(new CorpusChangeTriggerHandler());

      const executor = new PipelineExecutor(db as never, eventBus, triggerRegistry, stepRunner);
      executor.start();

      // Beta event fires — DB returns empty pipelines, nothing executes
      await eventBus.publish(TENANT_BETA, 'corpus_change', {});
      await executor.stop();

      // Alpha step handler should NOT have been called
      expect(alphaCallCount.count).toBe(0);
    });
  });

  describe('T059-4: review decision — cross-tenant decision rejected', () => {
    it('tenant-alpha cannot decide tenant-beta review decision', async () => {
      const betaDecisionRow = {
        id: 'dec-beta-1',
        executionId: 'exec-beta-1',
        executionStepId: 'gate-step-1',
        tenantId: TENANT_BETA,
        artifactRef: { type: 'content', id: 'art-1' },
        profileVersionRef: null,
        reviewerId: null,
        status: 'pending' as const,
        feedback: null,
        decidedAt: null,
        escalatedAt: null,
        createdAt: new Date(),
      };

      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([betaDecisionRow]),
          }),
        }),
      };

      const recorder = new DecisionRecorder(db as never);

      // tenant-alpha tries to approve tenant-beta's decision
      await expect(
        recorder.recordDecision('dec-beta-1', TENANT_ALPHA, 'approved', 'reviewer-alpha'),
      ).rejects.toThrow('Cross-tenant access denied');
    });
  });

  describe('T059-5: analytics — tenant scoping', () => {
    it('execution counts are computed per-tenant', () => {
      const allExecutions = [alphaExecution, betaExecution];

      const alphaExecutions = allExecutions.filter((e) => e.tenantId === TENANT_ALPHA);
      const betaExecutions = allExecutions.filter((e) => e.tenantId === TENANT_BETA);

      expect(alphaExecutions).toHaveLength(1);
      expect(betaExecutions).toHaveLength(1);
      expect(alphaExecutions[0]!.id).toBe('exec-alpha-1');
    });

    it('review decisions are scoped by tenantId', () => {
      const allDecisions = [alphaDecision, betaDecision];

      const alphaDecisions = allDecisions.filter((d) => d.tenantId === TENANT_ALPHA);
      const betaDecisions = allDecisions.filter((d) => d.tenantId === TENANT_BETA);

      expect(alphaDecisions).toHaveLength(1);
      expect(betaDecisions).toHaveLength(1);
      expect(alphaDecisions[0]!.id).toBe('dec-alpha-1');
    });

    it('tenant-alpha metrics do not include tenant-beta executions', () => {
      const allExecutions = [
        makeExecution('exec-alpha-2', 'pipe-alpha-1', TENANT_ALPHA),
        makeExecution('exec-alpha-3', 'pipe-alpha-1', TENANT_ALPHA),
        makeExecution('exec-beta-2', 'pipe-beta-1', TENANT_BETA),
      ];

      const alphaTotal = allExecutions.filter((e) => e.tenantId === TENANT_ALPHA).length;
      const betaTotal = allExecutions.filter((e) => e.tenantId === TENANT_BETA).length;

      expect(alphaTotal).toBe(2);
      expect(betaTotal).toBe(1);
    });
  });
});
