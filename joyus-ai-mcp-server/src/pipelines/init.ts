/**
 * Automated Pipelines Framework — Module Initialization
 *
 * Wires all pipeline components in dependency order and returns
 * a PipelineModule with references to all services, the Express
 * router, and MCP tool definitions.
 *
 * Follows the same pattern as content/index.ts (initializeContentModule).
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Router } from 'express';

import { createEventBus } from './event-bus/index.js';
import type { EventBus } from './event-bus/interface.js';
import { PipelineExecutor } from './engine/executor.js';
import { StepRunner } from './engine/step-runner.js';
import { createStepRegistry, StepRegistry } from './steps/registry.js';
import type { StepHandlerDependencies } from './steps/interface.js';
import { TriggerRegistry, defaultTriggerRegistry } from './triggers/registry.js';
import { ReviewGate } from './review/gate.js';
import { DecisionRecorder } from './review/decision.js';
import { EscalationChecker } from './review/escalation.js';
import { startEscalationJob, stopEscalationJob } from './review/index.js';
import { createPipelineRouter, type PipelineRouterDeps } from './routes.js';
import type { ToolDefinition } from '../tools/index.js';
import { pipelineTools } from '../tools/pipeline-tools.js';

// ============================================================
// CONFIG & MODULE INTERFACE
// ============================================================

export interface PipelineModuleConfig {
  db: NodePgDatabase;
  connectionString: string;
  stepHandlerDeps?: StepHandlerDependencies;
}

export interface PipelineModule {
  executor: PipelineExecutor;
  eventBus: EventBus;
  triggerRegistry: TriggerRegistry;
  stepRegistry: StepRegistry;
  reviewGate: ReviewGate;
  decisionRecorder: DecisionRecorder;
  router: Router;
  tools: ToolDefinition[];
  shutdown(): Promise<void>;
}

// ============================================================
// INITIALIZER
// ============================================================

export async function initializePipelineModule(
  config: PipelineModuleConfig,
): Promise<PipelineModule> {
  const { db, connectionString, stepHandlerDeps } = config;

  // 1. Event bus
  const eventBus = await createEventBus(db, connectionString);

  // 2. Registries
  const triggerRegistry = defaultTriggerRegistry;
  const stepRegistry = createStepRegistry(stepHandlerDeps ?? {});

  // 3. Step runner
  const stepRunner = new StepRunner(db, stepRegistry);

  // 4. Pipeline executor
  const executor = new PipelineExecutor(db, eventBus, triggerRegistry, stepRunner);

  // 5. Review components
  const reviewGate = new ReviewGate(db);
  const decisionRecorder = new DecisionRecorder(db);
  const escalationChecker = new EscalationChecker(db);

  // 6. Express router
  const routerDeps: PipelineRouterDeps = {
    db,
    stepRegistry,
    decisionRecorder,
    eventBus,
  };
  const router = createPipelineRouter(routerDeps);

  // 7. Start executor subscriptions
  executor.start();

  // 8. Start escalation cron job
  startEscalationJob(escalationChecker);

  console.log('[pipelines] Module initialized successfully');

  return {
    executor,
    eventBus,
    triggerRegistry,
    stepRegistry,
    reviewGate,
    decisionRecorder,
    router,
    tools: pipelineTools,
    async shutdown(): Promise<void> {
      stopEscalationJob();
      await executor.stop();
      console.log('[pipelines] Module shut down');
    },
  };
}
